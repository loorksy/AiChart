import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  cancelResearchSwarmRun,
  createResearchSwarmRun,
  getResearchSwarmArtifacts,
  getResearchSwarmEvents,
  getResearchSwarmRun,
  getResearchSwarmTasks,
  researchSwarmEnabled,
  researchSwarmPresetsEnabled,
  ResearchServiceError,
} from "../index";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

function enable(): void {
  process.env.RESEARCH_SERVICE_ENABLED = "1";
  process.env.RESEARCH_SWARM_ENABLED = "1";
  process.env.RESEARCH_SWARM_PRESETS_ENABLED = "1";
  process.env.RESEARCH_SERVICE_URL = "http://research.internal:8090";
  process.env.RESEARCH_SERVICE_INTERNAL_TOKEN = "server-secret-token-32-characters";
}

test("both disabled-default swarm flags gate every network call", async () => {
  process.env.RESEARCH_SERVICE_ENABLED = "1";
  delete process.env.RESEARCH_SWARM_ENABLED;
  delete process.env.RESEARCH_SWARM_PRESETS_ENABLED;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response();
  };
  assert.equal(researchSwarmEnabled(), false);
  assert.equal(researchSwarmPresetsEnabled(), false);
  await assert.rejects(
    createResearchSwarmRun(
      { userId: 7, requestId: "req-swarm" },
      {
        preset: "forex_research_committee",
        title: "Disabled swarm",
        objective: "No network call",
        idempotencyKey: "disabled-swarm-key",
      },
    ),
    (error: unknown) =>
      error instanceof ResearchServiceError && error.code === "RESEARCH_SWARM_DISABLED",
  );
  assert.equal(called, false);

  process.env.RESEARCH_SWARM_ENABLED = "1";
  await assert.rejects(
    getResearchSwarmRun({ userId: 7, requestId: "req-swarm" }, "swr_disabled"),
    (error: unknown) =>
      error instanceof ResearchServiceError && error.code === "RESEARCH_SWARM_DISABLED",
  );
  assert.equal(called, false);
});

test("create sends tenant only in trusted headers and bounds evidence ownership", async () => {
  enable();
  let captured: { url: string; init: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    captured = { url: String(input), init: init || {} };
    return Response.json({ run: { swarm_run_id: "swr_1" }, created: true });
  };
  await createResearchSwarmRun(
    { userId: 42, requestId: "req-swarm-42" },
    {
      preset: "gold_strategy_lab",
      title: "Gold research",
      objective: "Review grounded evidence",
      idempotencyKey: "swarm-client-key",
      budgets: { maxWorkers: 2, tokenBudget: 4_000 },
      evidenceRefs: [
        { evidenceType: "artifact", referenceId: "artifact_42", artifactId: "ra_42" },
      ],
    },
  );
  const headers = captured?.init.headers as Record<string, string>;
  const body = JSON.parse(String(captured?.init.body)) as Record<string, unknown>;
  const evidence = body.evidence_refs as Array<Record<string, unknown>>;
  assert.equal(captured?.url, "http://research.internal:8090/internal/research/swarms");
  assert.equal(headers["X-AiChart-User-Id"], "42");
  assert.equal(headers["X-AiChart-Request-Id"], "req-swarm-42");
  assert.equal(headers["X-AiChart-Idempotency-Key"], "swarm-client-key");
  assert.equal("user_id" in body, false);
  assert.equal("request_id" in body, false);
  assert.equal(evidence[0].owner_user_id, 42);
  assert.deepEqual(body.budgets, { max_workers: 2, token_budget: 4_000 });
  assert.doesNotMatch(JSON.stringify(body), /server-secret-token/);
});

test("read, cancel, task, event and artifact methods use internal scoped endpoints", async () => {
  enable();
  const calls: Array<{ url: string; method?: string }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method });
    const url = String(input);
    if (url.endsWith("/tasks")) return Response.json({ tasks: [] });
    if (url.endsWith("/events")) return Response.json({ events: [] });
    if (url.endsWith("/artifacts")) return Response.json({ artifacts: [] });
    return Response.json({ swarm_run_id: "swr_1", status: "cancelled" });
  };
  const context = { userId: 9, requestId: "req-swarm-read" };
  await getResearchSwarmRun(context, "swr_1");
  await getResearchSwarmTasks(context, "swr_1");
  await getResearchSwarmEvents(context, "swr_1");
  await getResearchSwarmArtifacts(context, "swr_1");
  await cancelResearchSwarmRun(context, "swr_1");
  assert.deepEqual(
    calls.map((call) => call.url.split("8090")[1]),
    [
      "/internal/research/swarms/swr_1",
      "/internal/research/swarms/swr_1/tasks",
      "/internal/research/swarms/swr_1/events",
      "/internal/research/swarms/swr_1/artifacts",
      "/internal/research/swarms/swr_1/cancel",
    ],
  );
  assert.equal(calls.at(-1)?.method, "POST");
});
