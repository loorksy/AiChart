import { getResearchJob } from "@/lib/research/client";
import type { ResearchCallerContext } from "@/lib/research/types";
import type { BacktestEvidenceReference } from "./types";

const MAX_BACKTEST_REFERENCES = 20;

export async function verifyBacktestEvidence(
  context: ResearchCallerContext,
  jobIds: string[],
): Promise<BacktestEvidenceReference[]> {
  const unique = [...new Set(jobIds)].sort().slice(0, MAX_BACKTEST_REFERENCES);
  const jobs = await Promise.all(unique.map((jobId) => getResearchJob(context, jobId)));
  return jobs.map((job) => {
    if (
      job.user_id !== context.userId ||
      job.status !== "succeeded" ||
      (job.job_type !== "run_forex_backtest" && job.job_type !== "run_backtest_validation")
    ) {
      throw new Error("Research backtest evidence is not tenant-verified and successful");
    }
    return {
      jobId: job.job_id,
      userId: context.userId,
      verifiedAt: Date.now(),
      jobType: job.job_type,
      status: "succeeded" as const,
      artifactIds: job.artifact_refs.map((item) => item.artifact_id).sort(),
      resultSummary: job.result_summary?.slice(0, 500) || undefined,
    };
  });
}
