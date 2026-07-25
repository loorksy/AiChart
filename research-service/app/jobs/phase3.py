from __future__ import annotations

import asyncio
import copy
import json
import math
from collections.abc import Callable
from dataclasses import asdict
from typing import Any, cast

from pydantic import ValidationError

from app.backtest import BacktestEngine
from app.backtest.models import BacktestResult, Order, Trade
from app.data import DatasetValidationResult, validate_dataset
from app.data.errors import DatasetError, DatasetInputError
from app.data.loaders.aichart_candle_warehouse import load_aichart_candle_warehouse
from app.data.registry import DatasetFormat, DatasetLoaderRegistry
from app.config import load_settings
from app.errors import ServiceError
from app.jobs.backtest_process import run_backtest_in_child
from app.jobs.cancellation import JobCancelled
from app.jobs.process_worker import run_in_killable_process
from app.jobs.payloads import (
    BacktestValidationConfig,
    DatasetArtifactFormat,
    DatasetInput,
    RunBacktestValidationPayload,
    RunForexBacktestPayload,
    ValidateDatasetPayload,
    ValidateStrategySpecPayload,
    WarehouseDatasetInput,
)
from app.jobs.progress import ProgressReporter
from app.models.jobs import JobRecord, JobStatus, JobType
from app.services.artifacts import JobArtifactService
from app.storage.artifacts import ArtifactStore
from app.storage.base import JobStore
from app.strategies import (
    StrategyError,
    StrategyValidationError,
    parse_strategy_specification,
    validate_strategy_specification,
)
from app.validation.bootstrap import run_bootstrap
from app.validation.models import (
    BootstrapConfig,
    BootstrapMetric,
    MonteCarloConfig,
    MonteCarloMethod,
    ReadinessEvidence,
    SensitivityConfig,
    SensitivityOutcome,
    SensitivityParameter,
    SensitivityResult,
    ValidationSuiteRequest,
    ValidationSuiteResult,
    WalkForwardConfig,
)
from app.validation.monte_carlo import run_monte_carlo
from app.validation.readiness import classify_readiness
from app.validation.sensitivity import (
    generate_combinations,
    run_sensitivity,
    summarize_sensitivity,
)
from app.validation.walk_forward import run_walk_forward


async def execute_phase3_task(
    job: JobRecord,
    store: JobStore,
    artifacts: ArtifactStore,
    cancelled: asyncio.Event,
) -> str:
    reporter = ProgressReporter(store, job.job_id)
    service = JobArtifactService(artifacts, store)
    if job.job_type.value == "validate_strategy_spec":
        strategy_payload = ValidateStrategySpecPayload.model_validate(job.payload)
        return await _validate_strategy(job, strategy_payload, service, reporter, cancelled)
    if job.job_type.value == "validate_dataset":
        dataset_payload = ValidateDatasetPayload.model_validate(job.payload)
        return await _validate_dataset_job(job, dataset_payload, service, reporter, cancelled)
    if job.job_type.value == "run_forex_backtest":
        backtest_payload = RunForexBacktestPayload.model_validate(job.payload)
        return await _run_backtest(job, backtest_payload, service, reporter, cancelled)
    if job.job_type.value == "run_backtest_validation":
        validation_payload = RunBacktestValidationPayload.model_validate(job.payload)
        return await _run_validation(job, validation_payload, service, reporter, cancelled)
    raise ValueError("unsupported Phase 3 job type")


async def _validate_strategy(
    job: JobRecord,
    payload: ValidateStrategySpecPayload,
    artifacts: JobArtifactService,
    reporter: ProgressReporter,
    cancelled: asyncio.Event,
) -> str:
    await reporter.emit(10, "validate_input", "validating strategy payload")
    await _checkpoint(cancelled)
    result = validate_strategy_specification(payload.strategy_spec)
    await reporter.emit(60, "validate_strategy", "strategy validation completed")
    await _checkpoint(cancelled)
    await artifacts.write_json(job, "strategy_validation.json", result)
    if result.valid and result.canonical_spec is not None:
        await artifacts.write_json(job, "strategy_spec.json", result.canonical_spec)
    await reporter.emit(95, "write_artifacts", "strategy artifacts written")
    return (
        "strategy specification is valid" if result.valid else "strategy specification is invalid"
    )


async def _validate_dataset_job(
    job: JobRecord,
    payload: ValidateDatasetPayload,
    artifacts: JobArtifactService,
    reporter: ProgressReporter,
    cancelled: asyncio.Event,
) -> str:
    await reporter.emit(10, "validate_input", "validating dataset reference")
    await _checkpoint(cancelled)
    result = await _load_dataset(job, payload.dataset, payload.limits, artifacts)
    await reporter.emit(70, "validate_data", "dataset validation completed")
    await _checkpoint(cancelled)
    await artifacts.write_json(job, "dataset_quality.json", result.quality)
    await reporter.emit(95, "write_artifacts", "data quality artifact written")
    return f"dataset validated: {result.quality.row_count} rows"


async def _run_backtest(
    job: JobRecord,
    payload: RunForexBacktestPayload,
    artifacts: JobArtifactService,
    reporter: ProgressReporter,
    cancelled: asyncio.Event,
) -> str:
    await reporter.emit(5, "validate_input", "validating strategy and run configuration")
    await _checkpoint(cancelled)
    strategy_result = validate_strategy_specification(payload.strategy_spec)
    if not strategy_result.valid or strategy_result.canonical_spec is None:
        raise StrategyValidationError("strategy specification is invalid")
    strategy = parse_strategy_specification(payload.strategy_spec)
    await reporter.emit(20, "load_dataset", "resolving tenant dataset artifact")
    dataset_result = await _load_dataset(job, payload.dataset, payload.limits, artifacts)
    if payload.run_config.end_time is not None:
        dataset_result = validate_dataset(
            dataset_result.dataset.bars,
            limits=payload.limits,
            run_end=payload.run_config.end_time,
        )
    await reporter.emit(35, "compile_strategy", "strategy compiled for deterministic execution")
    await _checkpoint(cancelled)
    engine = BacktestEngine(strategy, dataset_result.dataset, payload.run_config)
    await reporter.emit(45, "run_simulation", "deterministic simulation started")
    result = await _run_engine_off_loop(engine, cancelled)
    await reporter.emit(75, "calculate_metrics", "metrics and attribution calculated")
    await _checkpoint(cancelled)
    await _write_backtest_artifacts(
        job,
        artifacts,
        strategy_result.canonical_spec,
        dataset_result,
        result,
        cancelled,
    )
    await reporter.emit(95, "write_artifacts", "backtest artifacts written")
    return f"forex backtest completed: {len(result.trades)} trades"


async def _run_validation(
    job: JobRecord,
    payload: RunBacktestValidationPayload,
    artifacts: JobArtifactService,
    reporter: ProgressReporter,
    cancelled: asyncio.Event,
) -> str:
    await reporter.emit(10, "validate_input", "resolving tenant backtest artifacts")
    await _checkpoint(cancelled)
    request, metrics, source_job = await _validation_request(job, payload, artifacts)
    result = await _validation_stages(request, reporter, cancelled)
    cost_sensitivity = await asyncio.to_thread(
        _execution_cost_sensitivity,
        request,
        payload.validation_config,
        _cancel_check(cancelled),
    )
    strategy_sensitivity = await _strategy_parameter_sensitivity(
        job,
        source_job,
        payload.validation_config,
        artifacts,
        cancelled,
    )
    sensitivities = [item for item in (cost_sensitivity, strategy_sensitivity) if item is not None]
    if sensitivities:
        await artifacts.write_json(
            job,
            "sensitivity.json",
            {
                "execution_cost": cost_sensitivity,
                "strategy_parameters": strategy_sensitivity,
            },
        )
        await reporter.emit(80, "sensitivity", "bounded sensitivity checks completed")
    await _checkpoint(cancelled)
    readiness = classify_readiness(_readiness_evidence(metrics, result, sensitivities))
    metadata = dict(result.metadata)
    metadata["execution_cost_sensitivity"] = cost_sensitivity is not None
    metadata["strategy_parameter_sensitivity"] = strategy_sensitivity is not None
    result = result.model_copy(update={"readiness": readiness, "metadata": metadata})
    await reporter.emit(88, "classify_readiness", "research readiness classified")
    await artifacts.write_json(job, "validation.json", result)
    await artifacts.write_json(job, "readiness.json", readiness)
    await reporter.emit(95, "write_artifacts", "validation artifacts written")
    return "backtest validation and readiness classification completed"


async def _load_dataset(
    job: JobRecord,
    reference: DatasetInput,
    limits: Any,
    artifacts: JobArtifactService,
) -> DatasetValidationResult:
    if isinstance(reference, WarehouseDatasetInput):
        return load_aichart_candle_warehouse(reference.payload, limits=limits)
    suffix = {
        DatasetArtifactFormat.CSV: ".csv",
        DatasetArtifactFormat.PARQUET: ".parquet",
        DatasetArtifactFormat.AICHART_CANDLE_WAREHOUSE: ".json",
    }[reference.format]
    resolved = await artifacts.resolve_input(
        user_id=job.user_id,
        source_job_id=reference.job_id,
        artifact_id=reference.artifact_id,
        expected_suffix=suffix,
        max_bytes=limits.max_file_bytes,
    )
    if reference.format is DatasetArtifactFormat.AICHART_CANDLE_WAREHOUSE:
        try:
            value = json.loads(resolved.path.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise DatasetInputError("warehouse artifact must contain valid UTF-8 JSON") from exc
        if not isinstance(value, dict):
            raise DatasetInputError("warehouse artifact must contain a JSON object")
        return load_aichart_candle_warehouse(cast(dict[str, object], value), limits=limits)
    registry = DatasetLoaderRegistry(max_file_bytes=limits.max_file_bytes)
    dataset_format = (
        DatasetFormat.CSV
        if reference.format is DatasetArtifactFormat.CSV
        else DatasetFormat.PARQUET
    )
    return registry.load(
        dataset_format,
        resolved.path,
        allowed_root=artifacts.artifacts.root,
        limits=limits,
        column_mapping=reference.column_mapping,
    )


async def _validation_request(
    job: JobRecord,
    payload: RunBacktestValidationPayload,
    artifacts: JobArtifactService,
) -> tuple[ValidationSuiteRequest, dict[str, Any], JobRecord]:
    reference = payload.backtest_run
    source_job = await artifacts.jobs.get_for_user(reference.job_id, job.user_id)
    if (
        source_job is None
        or source_job.job_type is not JobType.RUN_FOREX_BACKTEST
        or source_job.status is not JobStatus.SUCCEEDED
    ):
        raise ValueError("backtest_run must reference a succeeded tenant backtest job")
    max_bytes = 16 * 1024 * 1024
    max_rows = 250_000
    metrics = await artifacts.read_json_object(
        user_id=job.user_id,
        source_job_id=reference.job_id,
        artifact_id=reference.metrics_artifact_id,
        max_bytes=max_bytes,
    )
    run_config = await artifacts.read_json_object(
        user_id=job.user_id,
        source_job_id=reference.job_id,
        artifact_id=reference.run_config_artifact_id,
        max_bytes=max_bytes,
    )
    trade_rows = await artifacts.read_csv_rows(
        user_id=job.user_id,
        source_job_id=reference.job_id,
        artifact_id=reference.trades_artifact_id,
        required_fields=frozenset(
            {
                "net_pnl",
                "gross_pnl",
                "spread_cost",
                "slippage_cost",
                "commission_cost",
                "carry_cost",
            }
        ),
        max_bytes=max_bytes,
        max_rows=max_rows,
    )
    equity_rows = await artifacts.read_csv_rows(
        user_id=job.user_id,
        source_job_id=reference.job_id,
        artifact_id=reference.equity_artifact_id,
        required_fields=frozenset({"equity"}),
        max_bytes=max_bytes,
        max_rows=max_rows,
    )
    initial_capital = _positive_float(run_config.get("initial_capital"), "initial capital")
    trade_returns = [
        _finite_float(row["net_pnl"], "net_pnl") / initial_capital for row in trade_rows
    ]
    trade_exit_indices: list[int] | None = None
    if (
        equity_rows
        and trade_rows
        and "timestamp" in equity_rows[0]
        and "exit_time" in trade_rows[0]
    ):
        equity_timestamps = [str(row["timestamp"]) for row in equity_rows]
        timestamp_to_index = {stamp: index for index, stamp in enumerate(equity_timestamps)}
        trade_exit_indices = []
        for row in trade_rows:
            exit_stamp = str(row["exit_time"])
            if exit_stamp in timestamp_to_index:
                trade_exit_indices.append(timestamp_to_index[exit_stamp])
            else:
                matched = next(
                    (
                        index
                        for index in range(len(equity_timestamps) - 1, -1, -1)
                        if equity_timestamps[index] <= exit_stamp
                    ),
                    0,
                )
                trade_exit_indices.append(matched)
    gross_returns = [
        _finite_float(row["gross_pnl"], "gross_pnl") / initial_capital for row in trade_rows
    ]
    cost_returns = [
        sum(
            _finite_float(row[field], field)
            for field in ("spread_cost", "slippage_cost", "commission_cost", "carry_cost")
        )
        / initial_capital
        for row in trade_rows
    ]
    equity_values = [_positive_float(row["equity"], "equity") for row in equity_rows]
    config = payload.validation_config
    monte_carlo = [
        MonteCarloConfig(
            method=method,
            simulations=config.simulation_count,
            seed=config.seed,
        )
        for method in config.methods
    ]
    bootstrap = (
        BootstrapConfig(
            simulations=config.bootstrap_samples,
            seed=config.seed,
            method=config.bootstrap_method,
            block_size=config.bootstrap_block_size,
        )
        if config.bootstrap_samples is not None
        else None
    )
    walk_forward = _walk_forward_config(len(equity_values), config)
    return (
        ValidationSuiteRequest(
            trade_returns=trade_returns,
            gross_trade_returns=gross_returns,
            trade_cost_returns=cost_returns,
            equity_values=equity_values,
            trade_exit_indices=trade_exit_indices,
            monte_carlo=monte_carlo,
            bootstrap=bootstrap,
            walk_forward=walk_forward,
        ),
        metrics,
        source_job,
    )


async def _validation_stages(
    request: ValidationSuiteRequest,
    reporter: ProgressReporter,
    cancelled: asyncio.Event,
) -> ValidationSuiteResult:
    cancel_check = _cancel_check(cancelled)
    monte_carlo_results = []
    total = max(len(request.monte_carlo), 1)
    for index, config in enumerate(request.monte_carlo):
        await _checkpoint(cancelled)
        if config.method is MonteCarloMethod.EXECUTION_COST_STRESS:
            if request.gross_trade_returns is None or request.trade_cost_returns is None:
                raise ValueError(
                    "execution_cost_stress requires gross_trade_returns and trade_cost_returns"
                )
            result = await asyncio.to_thread(
                run_monte_carlo,
                request.gross_trade_returns,
                config,
                costs=request.trade_cost_returns,
                cancel_check=cancel_check,
            )
        else:
            result = await asyncio.to_thread(
                run_monte_carlo,
                request.trade_returns,
                config,
                cancel_check=cancel_check,
            )
        monte_carlo_results.append(result)
        await reporter.emit(
            20 + int(20 * (index + 1) / total),
            "monte_carlo",
            f"completed {config.method.value}",
        )
    await _checkpoint(cancelled)
    bootstrap_result = None
    if request.bootstrap is not None:
        bootstrap_result = await asyncio.to_thread(
            run_bootstrap,
            request.trade_returns,
            request.bootstrap,
            cancel_check=cancel_check,
        )
    await reporter.emit(55, "bootstrap", "bootstrap confidence intervals completed")
    await _checkpoint(cancelled)
    walk_forward_result = None
    if request.walk_forward is not None:
        walk_forward_result = await asyncio.to_thread(
            run_walk_forward,
            request.equity_values,
            request.walk_forward,
            cancel_check=cancel_check,
            trade_exit_indices=request.trade_exit_indices,
            trade_returns=(
                request.trade_returns if request.trade_exit_indices is not None else None
            ),
        )
    await reporter.emit(70, "walk_forward", "walk-forward summaries completed")
    await _checkpoint(cancelled)
    return ValidationSuiteResult(
        monte_carlo=monte_carlo_results,
        bootstrap=bootstrap_result,
        walk_forward=walk_forward_result,
        readiness=None,
        metadata={
            "deterministic": True,
            "trade_return_observations": len(request.trade_returns),
            "equity_observations": len(request.equity_values),
        },
    )


async def _write_backtest_artifacts(
    job: JobRecord,
    artifacts: JobArtifactService,
    canonical_spec: dict[str, Any],
    dataset_result: DatasetValidationResult,
    result: BacktestResult,
    cancelled: asyncio.Event,
) -> None:
    json_artifacts = (
        ("strategy_spec.json", canonical_spec),
        ("dataset_quality.json", dataset_result.quality),
        ("run_config.json", result.run_config),
        ("metrics.json", result.metrics),
        ("events.json", result.events),
        ("attribution.json", result.attribution),
        ("chart_annotations.json", _chart_annotations(result)),
    )
    for name, value in json_artifacts:
        await _checkpoint(cancelled)
        await artifacts.write_json(job, name, value)
    await _checkpoint(cancelled)
    await artifacts.write_csv(
        job, "trades.csv", _TRADE_FIELDS, [_trade_row(t) for t in result.trades]
    )
    await _checkpoint(cancelled)
    await artifacts.write_csv(
        job, "orders.csv", _ORDER_FIELDS, [_order_row(o) for o in result.orders]
    )
    equity_rows = [asdict(point) for point in result.equity]
    await _checkpoint(cancelled)
    await artifacts.write_csv(job, "equity.csv", _EQUITY_FIELDS, equity_rows)
    await _checkpoint(cancelled)
    await artifacts.write_csv(
        job,
        "drawdown.csv",
        ("timestamp", "drawdown"),
        [{"timestamp": point.timestamp, "drawdown": point.drawdown} for point in result.equity],
    )


def _trade_row(trade: Trade) -> dict[str, Any]:
    value = asdict(trade)
    value["side"] = trade.side.value
    return value


def _order_row(order: Order) -> dict[str, Any]:
    return {
        "order_id": order.order_id,
        "symbol": order.symbol,
        "side": order.side.value,
        "order_type": order.order_type.value,
        "status": order.status.value,
        "signal_time": order.signal_time,
        "created_index": order.created_index,
        "activation_index": order.activation_index,
        "expiry_index": order.expiry_index,
        "requested_price": order.requested_price,
        "size_lots": order.size_lots,
        "stop_price": order.stop_price,
        "fill_time": order.fill_time,
        "fill_price": order.fill_price,
        "cancellation_reason": order.cancellation_reason,
        "target_prices": [asdict(target) for target in order.target_prices],
    }


def _chart_annotations(result: BacktestResult) -> dict[str, Any]:
    return {
        "entry_markers": [
            {
                "order_id": order.order_id,
                "symbol": order.symbol,
                "side": order.side.value,
                "time": order.fill_time,
                "price": order.fill_price,
            }
            for order in result.orders
            if order.fill_time is not None
        ],
        "exit_markers": [
            {
                "trade_id": trade.trade_id,
                "symbol": trade.symbol,
                "time": trade.exit_time,
                "price": trade.exit_price,
                "reason": trade.exit_reason,
            }
            for trade in result.trades
        ],
        "stop_levels": [
            {"order_id": order.order_id, "price": order.stop_price} for order in result.orders
        ],
        "target_levels": [
            {
                "order_id": order.order_id,
                "targets": [asdict(target) for target in order.target_prices],
            }
            for order in result.orders
        ],
        "partial_exits": [event for event in result.events if event.get("type") == "partial_exit"],
        "ambiguity_warnings": [
            event
            for event in result.events
            if str(event.get("type", "")).startswith("intrabar_ambiguous")
        ],
    }


async def _checkpoint(cancelled: asyncio.Event) -> None:
    if cancelled.is_set():
        raise JobCancelled
    await asyncio.sleep(0)
    if cancelled.is_set():
        raise JobCancelled


async def _run_engine_off_loop(
    engine: BacktestEngine, cancelled: asyncio.Event | None
) -> Any:
    """Run the CPU-bound simulation off the API loop.

    On the main loop a 40k-bar run starved everything sharing it — health
    checks, job submissions, and even the job-timeout machinery, so a wedged
    simulation could never be timed out by the very loop it was blocking.

    Two isolation modes:

    - **thread** (default): the interpreter's ~5ms GIL switch keeps the API
      responsive regardless of simulation size. The engine consumes `cancelled`
      only via thread-safe ``Event.is_set()`` checks, and its awaits are bare
      cooperative ``asyncio.sleep(0)`` yields — both correct inside the nested
      loop ``asyncio.run`` creates for the thread. Limitation: a run that
      ignores the flag CANNOT be stopped.
    - **process** (``RESEARCH_SERVICE_PROCESS_ISOLATION=1``): the simulation runs
      in a killable child with a heartbeat lease, so cancellation and timeouts
      are enforceable rather than advisory (RELIABILITY_PLAN item 3).
    """
    settings = load_settings()
    if settings.process_isolation:
        return await run_in_killable_process(
            run_backtest_in_child,
            engine.strategy_input,
            engine.dataset,
            engine.config,
            timeout_seconds=float(settings.max_timeout_seconds),
            cancelled=cancelled,
            lease_seconds=settings.process_lease_seconds,
            kill_grace_seconds=settings.process_kill_grace_seconds,
        )

    def _runner() -> Any:
        return asyncio.run(engine.run(cancelled))

    return await asyncio.to_thread(_runner)


def _walk_forward_config(
    observation_count: int, config: BacktestValidationConfig
) -> WalkForwardConfig | None:
    """Build sequential windows with ~70% training and ~30% out-of-sample per window.

    A tiny validation segment (>=2 points) is retained for schema compatibility; it is
    not used for parameter fitting (strategy remains fixed).
    """
    if config.walk_forward_windows is None:
        return None
    window_count = config.walk_forward_windows
    window_size = observation_count // window_count
    if window_size < 10:
        raise ValueError("walk-forward windows require at least ten equity points each")
    training = max(2, int(window_size * 0.70))
    out_of_sample = max(2, int(window_size * 0.30))
    validation = window_size - training - out_of_sample
    if validation < 2:
        # Steal from the larger of training/OOS to keep a minimal holdout slice.
        donor = "training" if training >= out_of_sample else "oos"
        need = 2 - validation
        if donor == "training" and training - need >= 2:
            training -= need
            validation = 2
        elif out_of_sample - need >= 2:
            out_of_sample -= need
            validation = 2
        else:
            raise ValueError("walk-forward windows are too small for a 70/30 split")
    if training + validation + out_of_sample != window_size:
        # Absorb integer rounding remainder into training.
        training += window_size - (training + validation + out_of_sample)
    return WalkForwardConfig(
        training_observations=training,
        validation_observations=validation,
        out_of_sample_observations=out_of_sample,
        minimum_windows=window_count,
        maximum_windows=window_count,
    )


def _readiness_evidence(
    metrics: dict[str, Any],
    validation: ValidationSuiteResult,
    sensitivities: list[SensitivityResult],
) -> ReadinessEvidence:
    cost_stress = next(
        (
            result
            for result in validation.monte_carlo
            if result.method is MonteCarloMethod.EXECUTION_COST_STRESS
        ),
        None,
    )
    return_bootstrap = next(
        (
            result
            for result in validation.monte_carlo
            if result.method is MonteCarloMethod.TRADE_RETURN_BOOTSTRAP
        ),
        None,
    )
    expectancy_lower = None
    if validation.bootstrap is not None:
        interval = next(
            (
                item
                for item in validation.bootstrap.intervals
                if item.metric is BootstrapMetric.EXPECTANCY
            ),
            None,
        )
        expectancy_lower = interval.lower if interval is not None else None
    return ReadinessEvidence(
        strategy_valid=True,
        data_quality_valid=True,
        trade_count=int(_finite_float(metrics.get("trade_count", 0), "trade_count")),
        out_of_sample_windows=(
            len(validation.walk_forward.windows) if validation.walk_forward is not None else 0
        ),
        maximum_drawdown=_optional_float(
            metrics.get("maximum_drawdown_percent"), "maximum_drawdown_percent"
        ),
        profit_factor=_optional_float(metrics.get("profit_factor"), "profit_factor"),
        expectancy=_optional_float(metrics.get("expectancy"), "expectancy"),
        cost_stress_profitable_probability=(
            1.0 - cost_stress.probability_of_loss if cost_stress is not None else None
        ),
        walk_forward_profitable_fraction=(
            validation.walk_forward.out_of_sample_profitable_fraction
            if validation.walk_forward is not None
            else None
        ),
        walk_forward_likely_overfit=(
            validation.walk_forward.likely_overfit
            if validation.walk_forward is not None
            else None
        ),
        bootstrap_expectancy_lower_bound=expectancy_lower,
        monte_carlo_probability_of_loss=(
            return_bootstrap.probability_of_loss if return_bootstrap is not None else None
        ),
        intrabar_ambiguity_rate=_optional_float(
            metrics.get("intrabar_ambiguity_rate"), "intrabar_ambiguity_rate"
        ),
        sensitivity_stable=(all(item.stable for item in sensitivities) if sensitivities else None),
    )


async def _strategy_parameter_sensitivity(
    job: JobRecord,
    source_job: JobRecord,
    config: BacktestValidationConfig,
    artifacts: JobArtifactService,
    cancelled: asyncio.Event,
) -> SensitivityResult | None:
    sensitivity = config.strategy_sensitivity
    if sensitivity is None:
        return None
    try:
        source_payload = RunForexBacktestPayload.model_validate(source_job.payload)
    except ValidationError as exc:
        raise ValueError("source backtest payload is unavailable for sensitivity") from exc
    base_spec = copy.deepcopy(source_payload.strategy_spec)
    for parameter in sensitivity.parameters:
        current = _strategy_numeric_value(base_spec, parameter.name)
        if not math.isclose(
            current,
            parameter.base_value,
            rel_tol=1e-12,
            abs_tol=1e-12,
        ):
            raise ValueError(f"strategy sensitivity baseline does not match {parameter.name}")
    dataset = await _load_dataset(
        job,
        source_payload.dataset,
        source_payload.limits,
        artifacts,
    )
    outcomes: list[SensitivityOutcome] = []
    for combination in generate_combinations(sensitivity):
        await _checkpoint(cancelled)
        candidate = copy.deepcopy(base_spec)
        for path, value in combination.parameters.items():
            _set_strategy_numeric_value(candidate, path, value)
        strategy = parse_strategy_specification(candidate)
        result = await _run_engine_off_loop(
            BacktestEngine(strategy, dataset.dataset, source_payload.run_config),
            cancelled,
        )
        score = _finite_float(result.metrics.get("total_return"), "sensitivity score")
        outcomes.append(
            SensitivityOutcome(
                **combination.model_dump(),
                score=score,
            )
        )
    await _checkpoint(cancelled)
    return summarize_sensitivity(sensitivity, outcomes)


def _strategy_numeric_value(spec: dict[str, Any], path: str) -> float:
    value: Any = spec
    for segment in path.split("."):
        if isinstance(value, list):
            try:
                value = value[int(segment)]
            except (ValueError, IndexError) as exc:
                raise ValueError("strategy sensitivity target index is invalid") from exc
        elif isinstance(value, dict) and segment in value:
            value = value[segment]
        else:
            raise ValueError("strategy sensitivity parameter is absent from the strategy")
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError("strategy sensitivity parameter must reference a numeric field")
    return _finite_float(value, path)


def _set_strategy_numeric_value(spec: dict[str, Any], path: str, value: float) -> None:
    segments = path.split(".")
    parent: Any = spec
    for segment in segments[:-1]:
        if isinstance(parent, list):
            try:
                parent = parent[int(segment)]
            except (ValueError, IndexError) as exc:
                raise ValueError("strategy sensitivity target index is invalid") from exc
        elif isinstance(parent, dict) and segment in parent:
            parent = parent[segment]
        else:
            raise ValueError("strategy sensitivity parameter is absent from the strategy")
    leaf = segments[-1]
    if not isinstance(parent, dict) or leaf not in parent:
        raise ValueError("strategy sensitivity parameter is absent from the strategy")
    parent[leaf] = value


def _execution_cost_sensitivity(
    request: ValidationSuiteRequest,
    config: BacktestValidationConfig,
    cancel_check: Callable[[], None] | None = None,
) -> SensitivityResult | None:
    if config.cost_sensitivity_points is None:
        return None
    if request.gross_trade_returns is None or request.trade_cost_returns is None:
        raise ValueError("execution-cost sensitivity requires gross returns and costs")
    points = config.cost_sensitivity_points
    sensitivity_config = SensitivityConfig(
        parameters=[
            SensitivityParameter(
                name="execution_cost_multiplier",
                base_value=2.0,
                lower_bound=1.0,
                upper_bound=3.0,
                step_count=points,
            )
        ],
        maximum_combinations=points + 1,
        maximum_relative_degradation=0.50,
        minimum_positive_fraction=0.60,
    )

    def evaluator(parameters: dict[str, float]) -> float:
        multiplier = parameters["execution_cost_multiplier"]
        equity = 1.0
        for gross, cost in zip(
            request.gross_trade_returns or [],
            request.trade_cost_returns or [],
            strict=True,
        ):
            stressed_return = gross - cost * multiplier
            if stressed_return <= -1.0:
                raise ValueError("execution-cost sensitivity produced an invalid return")
            equity *= 1.0 + stressed_return
        return equity - 1.0

    return run_sensitivity(sensitivity_config, evaluator, cancel_check=cancel_check)


def _cancel_check(cancelled: asyncio.Event) -> Callable[[], None]:
    def check() -> None:
        if cancelled.is_set():
            raise JobCancelled

    return check


def _finite_float(value: object, label: str) -> float:
    try:
        result = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} artifact value is invalid") from exc
    if not math.isfinite(result):
        raise ValueError(f"{label} artifact value must be finite")
    return result


def _positive_float(value: object, label: str) -> float:
    result = _finite_float(value, label)
    if result <= 0.0:
        raise ValueError(f"{label} artifact value must be positive")
    return result


def _optional_float(value: object, label: str) -> float | None:
    return None if value is None else _finite_float(value, label)


_TRADE_FIELDS = (
    "trade_id",
    "symbol",
    "side",
    "entry_time",
    "exit_time",
    "entry_price",
    "exit_price",
    "initial_size",
    "gross_pnl",
    "spread_cost",
    "slippage_cost",
    "commission_cost",
    "carry_cost",
    "net_pnl",
    "r_multiple",
    "holding_bars",
    "exit_reason",
    "session",
    "market_regime",
    "condition_set",
    "intrabar_ambiguous",
    "intrabar_policy",
)

_ORDER_FIELDS = (
    "order_id",
    "symbol",
    "side",
    "order_type",
    "status",
    "signal_time",
    "created_index",
    "activation_index",
    "expiry_index",
    "requested_price",
    "size_lots",
    "stop_price",
    "fill_time",
    "fill_price",
    "cancellation_reason",
    "target_prices",
)

_EQUITY_FIELDS = ("timestamp", "balance", "equity", "drawdown", "exposure")


def normalize_phase3_failure(exc: Exception) -> tuple[str, str]:
    """Map Phase 3 failures to bounded messages without persisting raw details."""

    if isinstance(exc, ServiceError):
        messages = {
            "ARTIFACT_TOO_LARGE": "research artifact exceeds its approved size limit",
            "ARTIFACT_INVALID_PATH": "research artifact reference is invalid",
            "JOB_NOT_FOUND": "research input artifact not found",
            "JOB_INPUT_INVALID": "research input artifact is invalid",
        }
        return exc.code, messages.get(exc.code, "research artifact operation failed")
    if isinstance(exc, DatasetError):
        return "DATASET_INVALID", "dataset validation failed"
    if isinstance(exc, StrategyError | ValidationError):
        return "STRATEGY_INVALID", "strategy or research payload validation failed"
    if isinstance(exc, ValueError):
        return "RESEARCH_VALIDATION_FAILED", "backtest or statistical validation failed"
    return "JOB_FAILED", "research job failed"
