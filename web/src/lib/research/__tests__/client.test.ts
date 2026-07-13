import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  cancelResearchJob,
  createResearchJob,
  getResearchJob,
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
  process.env.RESEARCH_SERVICE_URL = "http://research.internal:8090";
  process.env.RESEARCH_SERVICE_INTERNAL_TOKEN = "server-secret-token-32-characters";
}

test("disabled feature makes no network call", async () => {
  delete process.env.RESEARCH_SERVICE_ENABLED;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response();
  };
  await assert.rejects(
    createResearchJob(
      { userId: 7, requestId: "req-7" },
      { jobType: "service_smoke_test", idempotencyKey: "research-key-07" },
    ),
    (error: unknown) =>
      error instanceof ResearchServiceError && error.code === "RESEARCH_SERVICE_DISABLED",
  );
  assert.equal(called, false);
});

test("create propagates authenticated tenant, request and idempotency headers", async () => {
  enable();
  let captured: { url: string; init: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    captured = { url: String(input), init: init || {} };
    return Response.json({ job: { job_id: "rj_1" }, created: true });
  };
  await createResearchJob(
    { userId: 42, requestId: "req-client-42" },
    {
      jobType: "service_smoke_test",
      idempotencyKey: "research-client-key",
      payload: { steps: 2 },
    },
  );
  const headers = captured?.init.headers as Record<string, string>;
  const body = JSON.parse(String(captured?.init.body)) as Record<string, unknown>;
  assert.equal(captured?.url, "http://research.internal:8090/internal/research/jobs");
  assert.equal(headers["X-AiChart-User-Id"], "42");
  assert.equal(headers["X-AiChart-Request-Id"], "req-client-42");
  assert.equal(headers["X-AiChart-Idempotency-Key"], "research-client-key");
  assert.equal(body.user_id, 42);
  assert.equal(body.request_id, "req-client-42");
  assert.equal(headers.Authorization, "Bearer server-secret-token-32-characters");
});

test("normalizes service errors without leaking the internal token", async () => {
  enable();
  globalThis.fetch = async () =>
    Response.json(
      { error: { code: "IDEMPOTENCY_CONFLICT", message: "conflict" } },
      { status: 409 },
    );
  await assert.rejects(
    getResearchJob({ userId: 1, requestId: "req-one" }, "rj_x"),
    (error: unknown) => {
      assert.ok(error instanceof ResearchServiceError);
      assert.equal(error.code, "IDEMPOTENCY_CONFLICT");
      assert.equal(error.status, 409);
      assert.doesNotMatch(error.message, /server-secret/);
      return true;
    },
  );
});

test("bounded timeout aborts the internal request", async () => {
  enable();
  process.env.RESEARCH_SERVICE_CLIENT_TIMEOUT_MS = "100";
  globalThis.fetch = async (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    });
  await assert.rejects(
    getResearchJob({ userId: 1, requestId: "req-timeout" }, "rj_timeout"),
    (error: unknown) =>
      error instanceof ResearchServiceError && error.code === "RESEARCH_SERVICE_TIMEOUT",
  );
});

test("cancellation uses POST and tenant identity comes only from server context", async () => {
  enable();
  let captured: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    captured = init;
    return Response.json({ job_id: "rj_cancel", status: "cancelled" });
  };
  await cancelResearchJob({ userId: 9, requestId: "req-cancel" }, "rj_cancel");
  assert.equal(captured?.method, "POST");
  assert.equal((captured?.headers as Record<string, string>)["X-AiChart-User-Id"], "9");
  assert.equal(captured?.body, undefined);
});

test("client source contains no browser-public secret variable", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../client.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /NEXT_PUBLIC_.*TOKEN/);
  assert.match(source, /server-only/);
});
