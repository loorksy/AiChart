import { createResearchJob } from "./client";
import { ResearchServiceError } from "./errors";
import type {
  BacktestRunReferenceInput,
  BacktestValidationConfig,
  ForexBacktestRunConfig,
  ResearchCallerContext,
  ResearchDatasetInput,
  ResearchDatasetLimits,
  ResearchJob,
  ResearchJsonObject,
  RunBacktestValidationInput,
  RunForexBacktestInput,
  ValidateResearchDatasetInput,
  ValidateStrategySpecInput,
} from "./types";

const SAFE_ID = /^[A-Za-z0-9._:-]{3,128}$/;
const MAX_STRATEGY_SPEC_BYTES = 48 * 1024;
const MAX_PHASE3_PAYLOAD_BYTES = 8 * 1024 * 1024;
/** Mirrors MAX_EXPORT_ROWS in ./warehouse — keep the two in step. */
const MAX_WAREHOUSE_ENVELOPE_BARS = 50_000;
const STRATEGY_SENSITIVITY_PATH = /^(?:entry\.offset_value|stop_loss\.value|position_sizing\.(?:lots|notional|risk_percent)|management\.(?:trailing_stop\.(?:value|activation_r)|move_to_break_even\.trigger_value)|risk_controls\.minimum_reward_risk|targets\.[0-9]\.value)$/;

type CreateResult = { job: ResearchJob; created: boolean };

function invalid(message: string): never {
  throw new ResearchServiceError("RESEARCH_INPUT_INVALID", message, 400);
}

function assertObject(value: ResearchJsonObject, label: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${label} must be an object`);
  }
}

function jsonSize(value: unknown): number {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    invalid("research payload must be JSON-compatible");
  }
  return Buffer.byteLength(encoded, "utf8");
}

function assertStrategySpec(value: ResearchJsonObject): void {
  assertObject(value, "strategy specification");
  if (jsonSize(value) > MAX_STRATEGY_SPEC_BYTES) {
    invalid("strategy specification exceeds its size limit");
  }
}

function assertPayloadSize(value: Record<string, unknown>): void {
  if (jsonSize(value) > MAX_PHASE3_PAYLOAD_BYTES) {
    invalid("research payload exceeds the web-to-service request limit");
  }
}

function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) invalid(`${label} is invalid`);
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    invalid(`${label} is outside the supported range`);
  }
  return value;
}

function datasetPayload(dataset: ResearchDatasetInput): Record<string, unknown> {
  if (dataset.source === "aichart_candle_warehouse") {
    const envelope = dataset.payload;
    // Must track MAX_EXPORT_ROWS in research/warehouse.ts. These are two
    // independent ceilings on the same payload: raising only the exporter
    // produced a valid 40k-bar envelope that this validator then rejected
    // with a message that named no dimension.
    if (
      envelope.schema_version !== "aichart-candle-warehouse-v1" ||
      envelope.source !== "aichart_candle_warehouse" ||
      envelope.closed_bars_only !== true ||
      !Array.isArray(envelope.bars) ||
      !envelope.bars.length
    ) {
      invalid("Lonora Candle Warehouse envelope is invalid");
    }
    if (envelope.bars.length > MAX_WAREHOUSE_ENVELOPE_BARS) {
      invalid(
        `Lonora Candle Warehouse envelope exceeds ${MAX_WAREHOUSE_ENVELOPE_BARS.toLocaleString()} bars (got ${envelope.bars.length.toLocaleString()})`,
      );
    }
    return { source: "aichart_candle_warehouse", payload: envelope };
  }
  assertSafeId(dataset.artifactId, "dataset artifact id");
  assertSafeId(dataset.jobId, "dataset source job id");
  let columnMapping: Record<string, string> | undefined;
  if (dataset.columnMapping !== undefined) {
    const entries = Object.entries(dataset.columnMapping);
    if (
      entries.length > 24 ||
      entries.some(
        ([target, source]) =>
          !target ||
          target.length > 64 ||
          !source ||
          source.length > 128 ||
          source.includes("\0"),
      ) ||
      new Set(entries.map(([, source]) => source)).size !== entries.length
    ) {
      invalid("dataset column mapping is invalid");
    }
    columnMapping = dataset.columnMapping;
  }
  return {
    source: "artifact",
    artifact_id: dataset.artifactId,
    job_id: dataset.jobId,
    format: dataset.format,
    ...(columnMapping === undefined ? {} : { column_mapping: columnMapping }),
  };
}

function limitsPayload(limits: ResearchDatasetLimits | undefined): Record<string, number> | undefined {
  if (!limits) return undefined;
  return {
    ...(limits.maxRows === undefined
      ? {}
      : { max_rows: boundedInteger(limits.maxRows, 1, 2_000_000, "maximum rows") }),
    ...(limits.maxFileBytes === undefined
      ? {}
      : {
          max_file_bytes: boundedInteger(
            limits.maxFileBytes,
            1024,
            256 * 1024 * 1024,
            "maximum file bytes",
          ),
        }),
    ...(limits.maxSymbols === undefined
      ? {}
      : { max_symbols: boundedInteger(limits.maxSymbols, 1, 100, "maximum symbols") }),
    ...(limits.maxDateRangeDays === undefined
      ? {}
      : {
          max_date_range_days: boundedInteger(
            limits.maxDateRangeDays,
            1,
            20_000,
            "maximum date range",
          ),
        }),
    ...(limits.parquetBatchRows === undefined
      ? {}
      : {
          parquet_batch_rows: boundedInteger(
            limits.parquetBatchRows,
            128,
            65_536,
            "Parquet batch rows",
          ),
        }),
  };
}

function normalizedIso(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    invalid(`${label} must be an offset-aware ISO timestamp`);
  }
  return parsed.toISOString();
}

function runConfigPayload(config: ForexBacktestRunConfig): Record<string, unknown> {
  if (
    !Number.isFinite(config.initialCapital) ||
    config.initialCapital <= 0 ||
    config.initialCapital > 1_000_000_000
  ) {
    invalid("initial capital is outside the supported range");
  }
  if (!/^[A-Z]{3}$/.test(config.accountCurrency)) invalid("account currency is invalid");
  boundedInteger(config.seed, 0, 2 ** 31 - 1, "backtest seed");
  if (
    config.leverage !== undefined &&
    (!Number.isFinite(config.leverage) || config.leverage < 1 || config.leverage > 500)
  ) {
    invalid("leverage is outside the supported range");
  }
  const startTime = normalizedIso(config.startTime, "backtest start time");
  const endTime = normalizedIso(config.endTime, "backtest end time");
  if (startTime && endTime && startTime >= endTime) {
    invalid("backtest start time must precede end time");
  }
  return {
    initial_capital: config.initialCapital,
    account_currency: config.accountCurrency,
    seed: config.seed,
    intrabar_policy: config.intrabarPolicy,
    ...(config.leverage === undefined ? {} : { leverage: config.leverage }),
    ...(config.dojiPath === undefined ? {} : { doji_path: config.dojiPath }),
    ...(startTime === undefined ? {} : { start_time: startTime }),
    ...(endTime === undefined ? {} : { end_time: endTime }),
  };
}

function backtestReferencePayload(reference: BacktestRunReferenceInput): Record<string, string> {
  const fields = {
    job_id: reference.jobId,
    metrics_artifact_id: reference.metricsArtifactId,
    trades_artifact_id: reference.tradesArtifactId,
    equity_artifact_id: reference.equityArtifactId,
    run_config_artifact_id: reference.runConfigArtifactId,
  };
  for (const [label, value] of Object.entries(fields)) assertSafeId(value, label);
  return fields;
}

function validationConfigPayload(config: BacktestValidationConfig): Record<string, unknown> {
  boundedInteger(config.seed, 0, Number.MAX_SAFE_INTEGER, "validation seed");
  boundedInteger(config.simulationCount, 100, 10_000, "validation simulation count");
  if (!config.methods.length || config.methods.length > 3) {
    invalid("validation methods must be non-empty and limited to three");
  }
  if (new Set(config.methods).size !== config.methods.length) {
    invalid("validation methods must be unique");
  }
  const bootstrapMethod = config.bootstrapMethod ?? "iid";
  if (
    bootstrapMethod === "moving_block" &&
    (config.bootstrapSamples === undefined || config.bootstrapBlockSize === undefined)
  ) {
    invalid("moving-block bootstrap requires samples and a block size");
  }
  if (bootstrapMethod === "iid" && config.bootstrapBlockSize !== undefined) {
    invalid("bootstrap block size is only valid for moving-block bootstrap");
  }
  let strategySensitivity: Record<string, unknown> | undefined;
  if (config.strategySensitivity !== undefined) {
    const sensitivity = config.strategySensitivity;
    if (!sensitivity.parameters.length || sensitivity.parameters.length > 3) {
      invalid("strategy sensitivity requires one to three parameters");
    }
    const names = new Set<string>();
    const parameters = sensitivity.parameters.map((parameter) => {
      if (!STRATEGY_SENSITIVITY_PATH.test(parameter.path) || names.has(parameter.path)) {
        invalid("strategy sensitivity parameter path is invalid or duplicated");
      }
      names.add(parameter.path);
      for (const [label, value] of [
        ["base", parameter.baseValue],
        ["lower", parameter.lowerBound],
        ["upper", parameter.upperBound],
      ] as const) {
        if (!Number.isFinite(value)) invalid(`strategy sensitivity ${label} value is invalid`);
      }
      if (!(parameter.lowerBound < parameter.baseValue && parameter.baseValue < parameter.upperBound)) {
        invalid("strategy sensitivity bounds must contain the baseline");
      }
      return {
        name: parameter.path,
        base_value: parameter.baseValue,
        lower_bound: parameter.lowerBound,
        upper_bound: parameter.upperBound,
        step_count: boundedInteger(
          parameter.stepCount ?? 3,
          2,
          7,
          "strategy sensitivity step count",
        ),
      };
    });
    const maximumCombinations = boundedInteger(
      sensitivity.maximumCombinations ?? 25,
      2,
      25,
      "strategy sensitivity maximum combinations",
    );
    const combinationCount = parameters.reduce(
      (count, parameter) => count * parameter.step_count,
      1,
    );
    if (combinationCount > maximumCombinations) {
      invalid("strategy sensitivity grid exceeds its combination limit");
    }
    const boundedFraction = (value: number | undefined, fallback: number, label: string) => {
      const resolved = value ?? fallback;
      if (!Number.isFinite(resolved) || resolved < 0 || resolved > 1) {
        invalid(`${label} must be between zero and one`);
      }
      return resolved;
    };
    strategySensitivity = {
      parameters,
      maximum_combinations: maximumCombinations,
      maximum_relative_degradation: boundedFraction(
        sensitivity.maximumRelativeDegradation,
        0.25,
        "strategy sensitivity maximum relative degradation",
      ),
      minimum_positive_fraction: boundedFraction(
        sensitivity.minimumPositiveFraction,
        0.6,
        "strategy sensitivity minimum positive fraction",
      ),
    };
  }
  return {
    seed: config.seed,
    simulation_count: config.simulationCount,
    methods: config.methods,
    ...(config.bootstrapSamples === undefined
      ? {}
      : {
          bootstrap_samples: boundedInteger(
            config.bootstrapSamples,
            100,
            10_000,
            "bootstrap samples",
          ),
        }),
    ...(config.bootstrapMethod === undefined ? {} : { bootstrap_method: bootstrapMethod }),
    ...(config.bootstrapBlockSize === undefined
      ? {}
      : {
          bootstrap_block_size: boundedInteger(
            config.bootstrapBlockSize,
            2,
            10_000,
            "bootstrap block size",
          ),
        }),
    ...(config.walkForwardWindows === undefined
      ? {}
      : {
          walk_forward_windows: boundedInteger(
            config.walkForwardWindows,
            1,
            100,
            "walk-forward windows",
          ),
        }),
    ...(config.costSensitivityPoints === undefined
      ? {}
      : {
          cost_sensitivity_points: boundedInteger(
            config.costSensitivityPoints,
            2,
            7,
            "cost sensitivity points",
          ),
        }),
    ...(strategySensitivity === undefined
      ? {}
      : { strategy_sensitivity: strategySensitivity }),
  };
}

function createPhase3Job(
  context: ResearchCallerContext,
  jobType:
    | "validate_strategy_spec"
    | "validate_dataset"
    | "run_forex_backtest"
    | "run_backtest_validation",
  input: { idempotencyKey: string; timeoutSeconds?: number },
  payload: Record<string, unknown>,
): Promise<CreateResult> {
  assertPayloadSize(payload);
  return createResearchJob(context, {
    jobType,
    idempotencyKey: input.idempotencyKey,
    timeoutSeconds: input.timeoutSeconds,
    maxRetries: 0,
    payload,
  });
}

export function validateStrategySpec(
  context: ResearchCallerContext,
  input: ValidateStrategySpecInput,
): Promise<CreateResult> {
  assertStrategySpec(input.strategySpec);
  return createPhase3Job(context, "validate_strategy_spec", input, {
    strategy_spec: input.strategySpec,
  });
}

export function validateResearchDataset(
  context: ResearchCallerContext,
  input: ValidateResearchDatasetInput,
): Promise<CreateResult> {
  return createPhase3Job(context, "validate_dataset", input, {
    dataset: datasetPayload(input.dataset),
    ...(input.limits === undefined ? {} : { limits: limitsPayload(input.limits) }),
  });
}

export function runForexBacktest(
  context: ResearchCallerContext,
  input: RunForexBacktestInput,
): Promise<CreateResult> {
  assertStrategySpec(input.strategySpec);
  return createPhase3Job(context, "run_forex_backtest", input, {
    strategy_spec: input.strategySpec,
    dataset: datasetPayload(input.dataset),
    ...(input.limits === undefined ? {} : { limits: limitsPayload(input.limits) }),
    run_config: runConfigPayload(input.runConfig),
  });
}

export function runBacktestValidation(
  context: ResearchCallerContext,
  input: RunBacktestValidationInput,
): Promise<CreateResult> {
  return createPhase3Job(context, "run_backtest_validation", input, {
    backtest_run: backtestReferencePayload(input.backtestRun),
    validation_config: validationConfigPayload(input.validationConfig),
  });
}
