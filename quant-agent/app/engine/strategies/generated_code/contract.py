"""The quant-agent-sized contract for sandboxed-code strategies.

Deliberately NOT a port of QuantDinger's 876-line `strategy_v2/contract.py`
-- that file's `compile_strategy_v2` discovers a manifest for a full
portfolio/order/schedule trading engine (universe, subscriptions,
schedules, handlers, leverage) that has no equivalent in quant-agent at
all. quant-agent's `Strategy` ABC has exactly one method,
`evaluate(features) -> Signal | None` (`app/engine/strategies/base.py`),
so the contract here is correspondingly small:

  - Generated code must define one module-level function:
        def evaluate(features: dict) -> dict | None:
    `features` is a plain read-only dict (see `_features_view`) mirroring
    `app.engine.features.Features`'s fields. Returning `None` means "no
    signal"; returning a dict must validate against `GeneratedCodeOutput`.
  - `compile_and_discover(code)` is the one-time "does this even work"
    check run when a strategy is first generated: validate safety, then
    actually call `evaluate()` once inside an isolated subprocess against
    a neutral stub `Features`, and confirm the result is `None` or a
    valid `GeneratedCodeOutput`.
  - `run_evaluate_in_sandbox(code, features_view, ...)` is the SAME
    underlying mechanism, reused both by `compile_and_discover` (discovery
    time, stub data) and by `GeneratedCodeStrategy.evaluate` (live
    evaluation, real data) -- there is exactly one code path that ever
    actually calls user-authored `evaluate()`.

No `eval`/`exec` of anything outside this one sandboxed call. Fail-closed
throughout: any exception, timeout, or validation failure is treated as
"no signal" / "invalid", never surfaced as a crash.
"""

from __future__ import annotations

import multiprocessing
import pickle
import sys
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from app.sandbox.safe_exec import (
    build_safe_builtins,
    safe_exec_isolated_batch,
    timeout_context,
    validate_code_safety,
)

# Backtest-only batch execution bounds (app/engine/backtest/ is the sole
# caller) -- deliberately separate from EVALUATE_TIMEOUT_SECONDS/
# DISCOVERY_TIMEOUT_SECONDS above, which govern the live per-call path this
# batch path never touches. See `run_evaluate_batch_in_sandbox`'s docstring.
BACKTEST_BATCH_TIMEOUT_SECONDS = 90
BACKTEST_PER_BAR_TIMEOUT_SECONDS = 1

# Same bounds as app.engine.strategies.generated.schema.GeneratedStrategySpec
# -- one v1 target mechanism (ATR-multiple stop, R-multiple ladder) shared
# by both generation modes, not two independently-invented numeric ranges.
_STOP_LOSS_ATR_MULTIPLE_BOUNDS = (0.1, 10.0)
_MAX_TARGETS = 5

DISCOVERY_TIMEOUT_SECONDS = 5
EVALUATE_TIMEOUT_SECONDS = 3
SANDBOX_MAX_MEMORY_MB = 200

_FEATURES_FIELDS = (
    "ema20",
    "ema50",
    "ema200",
    "rsi14",
    "macd_line",
    "macd_signal",
    "macd_hist",
    "atr14",
    "bb_lower",
    "bb_middle",
    "bb_upper",
    "adx14",
    "closes",
    "regime",
    "last",
)


class GeneratedCodeOutput(BaseModel):
    """What a generated `evaluate()` call must return (as a dict) to count
    as a signal. Deliberately the same rigor as the declarative path's
    `GeneratedStrategySpec` output fields -- code that passes the AST/regex
    sandbox check can still return nonsensical numbers, so this is an
    independent second gate that has nothing to do with code safety."""

    model_config = ConfigDict(extra="forbid", strict=True)

    direction: Literal["buy", "sell"]
    stop_loss_atr_multiple: float = Field(
        ge=_STOP_LOSS_ATR_MULTIPLE_BOUNDS[0], le=_STOP_LOSS_ATR_MULTIPLE_BOUNDS[1]
    )
    take_profit_r_multiples: list[float] = Field(min_length=1, max_length=_MAX_TARGETS)
    rationale: str = Field(default="", max_length=2_000)

    @model_validator(mode="after")
    def _validate_targets(self) -> GeneratedCodeOutput:
        multiples = self.take_profit_r_multiples
        if any(value <= 0 for value in multiples):
            raise ValueError("take_profit_r_multiples must all be positive")
        if list(multiples) != sorted(multiples) or len(set(multiples)) != len(multiples):
            raise ValueError("take_profit_r_multiples must be strictly ascending")
        return self


def _features_view(features: Any) -> dict[str, Any]:
    """Build the plain, read-only dict handed to sandboxed code -- a dict
    has no methods to abuse and cannot be used to reach back into
    quant-agent's internal state, unlike passing the real `Features`
    object (or any object) would."""
    return {name: getattr(features, name) for name in _FEATURES_FIELDS}


def _stub_features_view() -> dict[str, Any]:
    """A neutral, all-empty features view for the discovery/compile step --
    real market data is never used at generation time."""
    view: dict[str, Any] = {name: [] for name in _FEATURES_FIELDS}
    view["regime"] = "range"
    view["last"] = -1
    return view


def _sandbox_worker(
    code: str,
    features_view: dict[str, Any],
    max_memory_mb: int,
    timeout_seconds: int,
    result_pipe: Any,
) -> None:
    """Runs in an isolated subprocess (see `run_evaluate_in_sandbox`):
    define the (already safety-validated) user code, look up `evaluate`,
    call it once with `features_view`, and send back either its return
    value or a structured failure -- never raises past this function."""
    try:
        if sys.platform != "win32":
            try:
                import resource

                mem = max_memory_mb * 1024 * 1024
                resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
            except Exception:  # noqa: S110 - best-effort memory cap, not fatal if unsupported
                pass

        namespace: dict[str, Any] = {"__builtins__": build_safe_builtins()}

        with timeout_context(timeout_seconds):
            # code was validate_code_safety()-checked by run_evaluate_in_sandbox.
            exec(code, namespace)  # noqa: S102
            evaluate = namespace.get("evaluate")
            if not callable(evaluate):
                result_pipe.send(
                    {
                        "success": False,
                        "error": "code does not define evaluate(features)",
                        "result": None,
                    }
                )
                return
            output = evaluate(features_view)

        if output is not None and not isinstance(output, dict):
            result_pipe.send(
                {"success": False, "error": "evaluate() must return None or a dict", "result": None}
            )
            return
        try:
            pickle.dumps(output)
        except Exception:
            result_pipe.send(
                {
                    "success": False,
                    "error": "evaluate() returned an unpicklable value",
                    "result": None,
                }
            )
            return
        result_pipe.send({"success": True, "error": None, "result": output})
    except Exception as exc:
        error_message = f"{type(exc).__name__}: {exc}"
        result_pipe.send({"success": False, "error": error_message, "result": None})
    finally:
        try:
            result_pipe.close()
        except Exception:  # noqa: S110 - best-effort pipe close on an already-failing path
            pass


def run_evaluate_in_sandbox(
    code: str,
    features_view: dict[str, Any],
    *,
    timeout_seconds: int = EVALUATE_TIMEOUT_SECONDS,
    max_memory_mb: int = SANDBOX_MAX_MEMORY_MB,
) -> tuple[bool, dict[str, Any] | None, str | None]:
    """Validate + run `evaluate(features_view)` from `code` once, isolated
    in a subprocess. Returns `(success, output_or_None, error_or_None)`.
    `success=True, output=None` means "the code ran and evaluate() returned
    None (no signal)" -- a legitimate, common outcome, not a failure.

    Always subprocess-isolated (never in-process), unlike QuantDinger's own
    default: quant-agent evaluates generated strategies inside the same
    FastAPI worker process that serves other requests, so a hang or crash
    in generated code must only take down a throwaway child process, never
    the service."""
    is_safe, err = validate_code_safety(code)
    if not is_safe:
        return False, None, f"Unsafe code rejected: {err}"

    parent_conn, child_conn = multiprocessing.Pipe(duplex=False)
    proc = multiprocessing.Process(
        target=_sandbox_worker,
        args=(code, features_view, max_memory_mb, timeout_seconds, child_conn),
        daemon=True,
    )
    proc.start()
    child_conn.close()

    proc.join(timeout=timeout_seconds + 2)

    if proc.is_alive():
        proc.kill()
        proc.join(timeout=5)
        return False, None, f"Code execution timed out after {timeout_seconds} seconds"

    if proc.exitcode != 0 and not parent_conn.poll():
        return False, None, f"Subprocess exited abnormally (exit code: {proc.exitcode})"

    try:
        if parent_conn.poll(timeout=1):
            response = parent_conn.recv()
        else:
            return False, None, "Subprocess returned no result"
    except Exception as exc:
        return False, None, f"Failed to read subprocess result: {exc}"
    finally:
        parent_conn.close()

    if not response.get("success"):
        return False, None, str(response.get("error") or "sandboxed execution failed")
    return True, response.get("result"), None


def run_evaluate_batch_in_sandbox(
    code: str,
    features_views: list[dict[str, Any]],
    *,
    wall_clock_timeout_seconds: int = BACKTEST_BATCH_TIMEOUT_SECONDS,
    per_bar_timeout_seconds: int = BACKTEST_PER_BAR_TIMEOUT_SECONDS,
    max_memory_mb: int = SANDBOX_MAX_MEMORY_MB,
) -> tuple[bool, list[dict[str, Any] | None] | None, str | None]:
    """Backtest-only sibling of `run_evaluate_in_sandbox`: calls
    `evaluate()` once per entry in `features_views`, all inside ONE isolated
    subprocess for the whole batch, instead of one fresh subprocess per bar
    (see `safe_exec_isolated_batch`'s docstring for why -- subprocess spawn
    overhead alone makes a per-bar-fresh-process replay of thousands of
    historical bars impractical for an interactive chat flow).

    `run_evaluate_in_sandbox` (the live path, used by
    `GeneratedCodeStrategy.evaluate` and `compile_and_discover`) is NOT
    modified and NOT called by this function -- they are independent
    siblings sharing only the safety validator and builtins, not each
    other's execution mechanics.

    Returns `(success, outputs_or_None, error_or_None)`. On success,
    `outputs` is aligned 1:1 with `features_views` UNLESS the batch was
    truncated by its wall-clock budget, in which case it is a strict prefix
    (shorter than the input) -- callers must handle a short list, not assume
    full-length output. Each entry is `None` ("no signal that bar") or a raw
    dict that the caller must still validate as `GeneratedCodeOutput`
    (mirrors `run_evaluate_in_sandbox`, which returns the same raw,
    unvalidated shape for its own single call)."""
    result = safe_exec_isolated_batch(
        code,
        features_views,
        wall_clock_timeout=wall_clock_timeout_seconds,
        per_call_timeout=per_bar_timeout_seconds,
        max_memory_mb=max_memory_mb,
    )
    if not result.get("success"):
        return False, None, str(result.get("error") or "sandboxed batch execution failed")

    payload = result.get("result") or {}
    outputs = payload.get("outputs")
    if not isinstance(outputs, list):
        return False, None, "sandboxed batch execution returned an unexpected shape"

    for output in outputs:
        if output is not None and not isinstance(output, dict):
            return False, None, "evaluate() must return None or a dict"

    return True, outputs, None


def compile_and_discover(code: str) -> tuple[bool, str | None]:
    """One-time discovery check run when a strategy is first generated
    (mirrors the *spirit* of QuantDinger's `compile_strategy_v2`, not its
    trading-engine-specific mechanics): the code must be safe, must define
    `evaluate(features)`, and calling it once against a neutral stub must
    either return `None` or a dict that validates as `GeneratedCodeOutput`.
    Fail-closed: any unexpected exception is treated as invalid, never
    silently accepted."""
    try:
        success, output, error = run_evaluate_in_sandbox(
            code, _stub_features_view(), timeout_seconds=DISCOVERY_TIMEOUT_SECONDS
        )
    except Exception as exc:  # noqa: BLE001 - fail-closed on anything unexpected
        return False, f"discovery failed: {exc}"

    if not success:
        return False, error

    if output is None:
        return True, None

    try:
        GeneratedCodeOutput.model_validate(output, strict=True)
    except ValidationError as exc:
        return False, f"evaluate() output failed validation: {exc.errors(include_url=False)}"
    except Exception as exc:  # noqa: BLE001 - fail-closed
        return False, f"evaluate() output could not be validated: {exc}"
    return True, None
