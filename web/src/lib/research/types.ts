export type ResearchJobType =
  | "service_smoke_test"
  | "artifact_smoke_test"
  | "failure_smoke_test"
  | "timeout_smoke_test"
  | "validate_strategy_spec"
  | "validate_dataset"
  | "run_forex_backtest"
  | "run_backtest_validation";

export type ResearchJobStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "cancelled"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "retry_wait";

export interface ResearchCallerContext {
  userId: number;
  requestId: string;
}

export interface ResearchJobInput {
  jobType: ResearchJobType;
  idempotencyKey: string;
  timeoutSeconds?: number;
  maxRetries?: number;
  payload?: Record<string, unknown>;
}

export interface ResearchArtifactReference {
  artifact_id: string;
  job_id: string;
  user_id: number;
  artifact_type: "text" | "json" | "csv";
  name: string;
  relative_path: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
}

export interface ResearchJob {
  job_id: string;
  job_type: ResearchJobType;
  user_id: number;
  request_id: string;
  idempotency_key: string;
  status: ResearchJobStatus;
  progress_percent: number;
  progress_message: string;
  attempt: number;
  max_attempts: number;
  timeout_seconds: number;
  artifact_refs: ResearchArtifactReference[];
  error_code?: string | null;
  error_message?: string | null;
  result_summary?: string | null;
}

export interface ResearchProgressEvent {
  sequence: number;
  job_id: string;
  user_id: number;
  timestamp: string;
  percent: number;
  stage: string;
  message: string;
  metadata: Record<string, unknown>;
}

export type ResearchJsonObject = Record<string, unknown>;

export type ResearchTimeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d";

export interface AiChartWarehouseExportBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  spread: null;
  symbol: string;
  timeframe: ResearchTimeframe;
  source: "aichart_candle_warehouse";
  is_closed: true;
  timezone: "UTC";
}

export interface AiChartCandleWarehouseEnvelope {
  schema_version: "aichart-candle-warehouse-v1";
  source: "aichart_candle_warehouse";
  exported_at: string;
  closed_bars_only: true;
  bars: AiChartWarehouseExportBar[];
}

export interface AiChartWarehouseExportInput {
  symbol: string;
  timeframe: ResearchTimeframe;
  limit?: number;
  fromMs?: number;
  toMs?: number;
}

export interface ResearchArtifactDatasetInput {
  source: "artifact";
  artifactId: string;
  jobId: string;
  format: "csv" | "parquet" | "aichart_candle_warehouse";
  columnMapping?: Record<string, string>;
}

export interface ResearchWarehouseDatasetInput {
  source: "aichart_candle_warehouse";
  payload: AiChartCandleWarehouseEnvelope;
}

export type ResearchDatasetInput =
  | ResearchArtifactDatasetInput
  | ResearchWarehouseDatasetInput;

export interface ResearchDatasetLimits {
  maxRows?: number;
  maxFileBytes?: number;
  maxSymbols?: number;
  maxDateRangeDays?: number;
  parquetBatchRows?: number;
}

export type ResearchIntrabarPolicy =
  | "worst_case"
  | "best_case"
  | "stop_first"
  | "target_first"
  | "ohlc_path"
  | "reject_ambiguous";

export interface ForexBacktestRunConfig {
  initialCapital: number;
  accountCurrency: string;
  seed: number;
  intrabarPolicy: ResearchIntrabarPolicy;
  leverage?: number;
  dojiPath?: "conservative" | "low_first" | "high_first";
  startTime?: string;
  endTime?: string;
}

export type MonteCarloMethod =
  | "trade_order_permutation"
  | "trade_return_bootstrap"
  | "execution_cost_stress";

export interface BacktestRunReferenceInput {
  jobId: string;
  metricsArtifactId: string;
  tradesArtifactId: string;
  equityArtifactId: string;
  runConfigArtifactId: string;
}

export interface BacktestValidationConfig {
  seed: number;
  simulationCount: number;
  methods: MonteCarloMethod[];
  bootstrapSamples?: number;
  bootstrapMethod?: "iid" | "moving_block";
  bootstrapBlockSize?: number;
  walkForwardWindows?: number;
  costSensitivityPoints?: number;
  strategySensitivity?: StrategySensitivityInput;
}

export interface StrategySensitivityParameterInput {
  path: string;
  baseValue: number;
  lowerBound: number;
  upperBound: number;
  stepCount?: number;
}

export interface StrategySensitivityInput {
  parameters: StrategySensitivityParameterInput[];
  maximumCombinations?: number;
  maximumRelativeDegradation?: number;
  minimumPositiveFraction?: number;
}

export interface Phase3JobOptions {
  idempotencyKey: string;
  timeoutSeconds?: number;
}

export interface ValidateStrategySpecInput extends Phase3JobOptions {
  strategySpec: ResearchJsonObject;
}

export interface ValidateResearchDatasetInput extends Phase3JobOptions {
  dataset: ResearchDatasetInput;
  limits?: ResearchDatasetLimits;
}

export interface RunForexBacktestInput extends Phase3JobOptions {
  strategySpec: ResearchJsonObject;
  dataset: ResearchDatasetInput;
  runConfig: ForexBacktestRunConfig;
  limits?: ResearchDatasetLimits;
}

export interface RunBacktestValidationInput extends Phase3JobOptions {
  backtestRun: BacktestRunReferenceInput;
  validationConfig: BacktestValidationConfig;
}
