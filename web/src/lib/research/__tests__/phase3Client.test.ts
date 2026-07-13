import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  buildAiChartCandleWarehouseEnvelope,
  createResearchJob,
  ResearchServiceError,
  runBacktestValidation,
  runForexBacktest,
  validateResearchDataset,
  validateStrategySpec,
} from "../index";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

function enableBacktest(): void {
  process.env.RESEARCH_SERVICE_ENABLED = "1";
  process.env.RESEARCH_BACKTEST_ENABLED = "1";
  process.env.RESEARCH_SERVICE_URL = "http://research.internal:8090";
  process.env.RESEARCH_SERVICE_INTERNAL_TOKEN = "server-secret-token-32-characters";
}

function captureRequests(): Array<Record<string, unknown>> {
  const requests: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({ job: { job_id: "rj_phase3" }, created: true });
  };
  return requests;
}

const context = { userId: 42, requestId: "req-phase3" };
const artifactDataset = {
  source: "artifact" as const,
  artifactId: "ra_dataset_001",
  jobId: "rj_dataset_001",
  format: "csv" as const,
};

test("Phase 3 jobs cannot bypass the disabled backtest flag through the generic client", async () => {
  process.env.RESEARCH_SERVICE_ENABLED = "1";
  delete process.env.RESEARCH_BACKTEST_ENABLED;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response();
  };
  await assert.rejects(
    createResearchJob(context, {
      jobType: "run_forex_backtest",
      idempotencyKey: "bt-disabled-001",
    }),
    (error: unknown) =>
      error instanceof ResearchServiceError && error.code === "RESEARCH_BACKTEST_DISABLED",
  );
  assert.equal(called, false);
});

test("validation requires its independent disabled-default flag and makes no request", async () => {
  enableBacktest();
  delete process.env.RESEARCH_VALIDATION_ENABLED;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response();
  };
  await assert.rejects(
    runBacktestValidation(context, {
      idempotencyKey: "validation-disabled-001",
      backtestRun: {
        jobId: "rj_backtest_001",
        metricsArtifactId: "ra_metrics_001",
        tradesArtifactId: "ra_trades_001",
        equityArtifactId: "ra_equity_001",
        runConfigArtifactId: "ra_run_config_001",
      },
      validationConfig: { seed: 42, simulationCount: 100, methods: ["trade_order_permutation"] },
    }),
    (error: unknown) =>
      error instanceof ResearchServiceError && error.code === "RESEARCH_VALIDATION_DISABLED",
  );
  assert.equal(called, false);
});

test("typed strategy, dataset, and backtest wrappers emit bounded snake-case payloads", async () => {
  enableBacktest();
  const requests = captureRequests();
  await validateStrategySpec(context, {
    idempotencyKey: "spec-validation-001",
    strategySpec: { strategy_id: "strat-1", spec_version: "1" },
  });
  await validateResearchDataset(context, {
    idempotencyKey: "dataset-validation-001",
    dataset: artifactDataset,
  });
  await runForexBacktest(context, {
    idempotencyKey: "forex-backtest-001",
    timeoutSeconds: 300,
    strategySpec: { strategy_id: "strat-1", spec_version: "1" },
    dataset: artifactDataset,
    runConfig: {
      initialCapital: 10_000,
      accountCurrency: "USD",
      seed: 42,
      intrabarPolicy: "worst_case",
      leverage: 30,
      dojiPath: "low_first",
    },
  });

  assert.deepEqual(
    requests.map((request) => request.job_type),
    ["validate_strategy_spec", "validate_dataset", "run_forex_backtest"],
  );
  assert.ok(requests.every((request) => request.max_retries === 0));
  assert.deepEqual(requests[1]?.payload, {
    dataset: {
      source: "artifact",
      artifact_id: "ra_dataset_001",
      job_id: "rj_dataset_001",
      format: "csv",
    },
  });
  assert.deepEqual(requests[2]?.payload, {
    strategy_spec: { strategy_id: "strat-1", spec_version: "1" },
    dataset: {
      source: "artifact",
      artifact_id: "ra_dataset_001",
      job_id: "rj_dataset_001",
      format: "csv",
    },
    run_config: {
      initial_capital: 10_000,
      account_currency: "USD",
      seed: 42,
      intrabar_policy: "worst_case",
      leverage: 30,
      doji_path: "low_first",
    },
  });
  assert.ok(requests.every((request) => request.user_id === 42));
});

test("dataset validation sends a controlled warehouse export through the inline discriminator", async () => {
  enableBacktest();
  const requests = captureRequests();
  const envelope = buildAiChartCandleWarehouseEnvelope(
    { symbol: "EURUSD", timeframe: "1h", limit: 1 },
    [
      {
        time: new Date("2025-01-06T09:00:00Z").getTime(),
        open: 1.1,
        high: 1.2,
        low: 1,
        close: 1.15,
        volume: 100,
        complete: true,
      },
    ],
    new Date("2025-01-06T10:00:00Z"),
  );
  await validateResearchDataset(context, {
    idempotencyKey: "warehouse-dataset-001",
    dataset: { source: "aichart_candle_warehouse", payload: envelope },
  });
  assert.deepEqual(requests[0]?.payload, {
    dataset: { source: "aichart_candle_warehouse", payload: envelope },
  });
});

test("warehouse payloads may exceed 48 KiB but remain bounded by the 8 MiB job limit", async () => {
  enableBacktest();
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json({ job: { job_id: "rj_large_dataset" }, created: true });
  };
  const start = new Date("2025-01-01T00:00:00Z").getTime();
  const candles = Array.from({ length: 600 }, (_, index) => ({
    time: start + index * 60_000,
    open: 1.1,
    high: 1.2,
    low: 1,
    close: 1.15,
    volume: 100,
    complete: true,
  }));
  const envelope = buildAiChartCandleWarehouseEnvelope(
    { symbol: "EURUSD", timeframe: "1m", limit: candles.length },
    candles,
    new Date(start + candles.length * 60_000),
  );
  assert.ok(Buffer.byteLength(JSON.stringify(envelope), "utf8") > 48 * 1024);
  await validateResearchDataset(context, {
    idempotencyKey: "large-warehouse-dataset-001",
    dataset: { source: "aichart_candle_warehouse", payload: envelope },
  });
  assert.equal(called, true);

  const oversized = {
    ...envelope,
    padding: "x".repeat(8 * 1024 * 1024),
  };
  called = false;
  assert.throws(
    () =>
      validateResearchDataset(context, {
        idempotencyKey: "oversized-warehouse-dataset-001",
        dataset: {
          source: "aichart_candle_warehouse",
          payload: oversized,
        },
      }),
    /web-to-service request limit/,
  );
  assert.equal(called, false);
});

test("strategy specifications retain their independent 48 KiB limit", () => {
  enableBacktest();
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response();
  };
  assert.throws(
    () =>
      validateStrategySpec(context, {
        idempotencyKey: "oversized-strategy-spec-001",
        strategySpec: { description: "x".repeat(49 * 1024) },
      }),
    /strategy specification exceeds its size limit/,
  );
  assert.equal(called, false);
});

test("typed validation wrapper emits only bounded references and validation configuration", async () => {
  enableBacktest();
  process.env.RESEARCH_VALIDATION_ENABLED = "1";
  const requests = captureRequests();
  await runBacktestValidation(context, {
    idempotencyKey: "backtest-validation-001",
    timeoutSeconds: 300,
    backtestRun: {
      jobId: "rj_backtest_001",
      metricsArtifactId: "ra_metrics_001",
      tradesArtifactId: "ra_trades_001",
      equityArtifactId: "ra_equity_001",
      runConfigArtifactId: "ra_run_config_001",
    },
    validationConfig: {
      seed: 7,
      simulationCount: 500,
      methods: ["trade_order_permutation", "execution_cost_stress"],
      bootstrapSamples: 300,
      walkForwardWindows: 5,
      costSensitivityPoints: 5,
      strategySensitivity: {
        parameters: [
          {
            path: "stop_loss.value",
            baseValue: 10,
            lowerBound: 8,
            upperBound: 12,
            stepCount: 3,
          },
        ],
        maximumCombinations: 3,
      },
    },
  });
  assert.equal(requests[0]?.job_type, "run_backtest_validation");
  assert.deepEqual(requests[0]?.payload, {
    backtest_run: {
      job_id: "rj_backtest_001",
      metrics_artifact_id: "ra_metrics_001",
      trades_artifact_id: "ra_trades_001",
      equity_artifact_id: "ra_equity_001",
      run_config_artifact_id: "ra_run_config_001",
    },
    validation_config: {
      seed: 7,
      simulation_count: 500,
      methods: ["trade_order_permutation", "execution_cost_stress"],
      bootstrap_samples: 300,
      walk_forward_windows: 5,
      cost_sensitivity_points: 5,
      strategy_sensitivity: {
        parameters: [
          {
            name: "stop_loss.value",
            base_value: 10,
            lower_bound: 8,
            upper_bound: 12,
            step_count: 3,
          },
        ],
        maximum_combinations: 3,
        maximum_relative_degradation: 0.25,
        minimum_positive_fraction: 0.6,
      },
    },
  });
});

test("typed wrappers reject invalid bounds before any network request", () => {
  enableBacktest();
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response();
  };
  assert.throws(
    () =>
      runForexBacktest(context, {
        idempotencyKey: "invalid-config-001",
        strategySpec: { strategy_id: "strat-1" },
        dataset: artifactDataset,
        runConfig: {
          initialCapital: -1,
          accountCurrency: "USD",
          seed: 42,
          intrabarPolicy: "worst_case",
        },
      }),
    (error: unknown) =>
      error instanceof ResearchServiceError && error.code === "RESEARCH_INPUT_INVALID",
  );
  assert.equal(called, false);
});
