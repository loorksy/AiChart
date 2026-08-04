import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getJob, isTerminal, startJob, waitForJobs } from "../jobStore.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("jobStore: bucket-C async job queue", () => {
  it("startJob returns well under the 500ms budget even for slow work", async () => {
    const startedAt = Date.now();
    const job = startJob("run_backtest", () => sleep(300).then(() => ({ ok: true })));
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed < 100, `startJob took ${elapsed}ms — must return immediately, not await the work`);
    assert.equal(job.status, "queued");
    assert.ok(job.id.startsWith("job_"));
  });

  it("getJob reflects completion with the real result once the work resolves", async () => {
    const job = startJob("run_backtest", () => sleep(20).then(() => ({ sharpe: 1.4 })));
    await Promise.resolve(); // flush the microtask that flips queued -> running
    assert.equal(getJob(job.id)?.status, "running");
    await sleep(60);
    const done = getJob(job.id);
    assert.equal(done?.status, "completed");
    assert.deepEqual(done?.result, { sharpe: 1.4 });
  });

  it("getJob reflects a rejected job as failed with the error message, not a thrown exception", async () => {
    const job = startJob("run_market_analysis", () => sleep(10).then(() => {
      throw new Error("upstream timeout");
    }));
    await sleep(50);
    const done = getJob(job.id);
    assert.equal(done?.status, "failed");
    assert.equal(done?.error, "upstream timeout");
  });

  it("unknown job ids are never present", () => {
    assert.equal(getJob("job_does_not_exist"), undefined);
  });

  it("waitForJobs returns as soon as every job is terminal, without waiting the full budget", async () => {
    const job = startJob("run_backtest", () => sleep(30).then(() => ({ n: 1 })));
    const startedAt = Date.now();
    const result = await waitForJobs([job.id], 5000, 20);
    const elapsed = Date.now() - startedAt;
    assert.equal(result.all_terminal, true);
    assert.equal(result.poll_after_seconds, null);
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0]?.status, "completed");
    assert.deepEqual(result.jobs[0]?.result, { n: 1 });
    assert.ok(elapsed < 500, `waitForJobs took ${elapsed}ms after the job finished at ~30ms`);
  });

  it("waitForJobs reports all_terminal:false and a retry hint when a job is still running at the deadline", async () => {
    const job = startJob("run_backtest", () => sleep(500).then(() => ({ n: 1 })));
    const result = await waitForJobs([job.id], 60, 20);
    assert.equal(result.all_terminal, false);
    assert.equal(result.poll_after_seconds, 5);
    assert.equal(result.jobs[0]?.status, "running");
    assert.equal("result" in (result.jobs[0] ?? {}), false, "a still-running job must never carry a result");
  });

  it("waitForJobs reports unknown job ids as not_found rather than throwing", async () => {
    const result = await waitForJobs(["job_never_existed"], 60, 20);
    assert.equal(result.jobs[0]?.status, "not_found");
    assert.equal(result.all_terminal, true);
  });

  it("waitForJobs handles a batch of up to 12 jobs together (the schema's own cap)", async () => {
    const jobs = Array.from({ length: 12 }, (_, i) =>
      startJob("run_backtest", () => sleep(10 + i).then(() => ({ i }))),
    );
    const result = await waitForJobs(
      jobs.map((j) => j.id),
      2000,
      20,
    );
    assert.equal(result.all_terminal, true);
    assert.equal(result.jobs.length, 12);
    for (const j of result.jobs) assert.equal(j.status, "completed");
  });

  it("isTerminal is exactly completed/failed", () => {
    assert.equal(isTerminal("completed"), true);
    assert.equal(isTerminal("failed"), true);
    assert.equal(isTerminal("queued"), false);
    assert.equal(isTerminal("running"), false);
  });
});
