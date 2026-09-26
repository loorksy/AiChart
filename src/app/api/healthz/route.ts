import { NextRequest, NextResponse } from "next/server";
import {
  githubVerifyPublic,
  shouldIncludeGithubOnHealthz,
  verifyGithub,
} from "@/lib/githubVerify";
import { gitCommit, releaseIdentity } from "@/lib/version";

export const dynamic = "force-dynamic";

/**
 * Liveness probe — process is up and serving. Dependency-free and public so
 * load balancers / container orchestrators / Docker HEALTHCHECK can hit it
 * cheaply without auth or DB access. Exposes the exact running release
 * identity so a stale build/container/process is externally detectable.
 *
 * `?deep=1` adds the internal-scheduler tick status — every candle fetch is
 * live off the user's own account now, so there is no warehouse tail-age to
 * report. Deep mode touches the DB, so keep orchestrator probes on the
 * default shallow mode.
 *
 * `?github=1` (or HEALTHZ_VERIFY_GITHUB=1) runs verifyGithub(). A GitHub
 * rate-limit 403 is a soft skip — this probe stays 200. A real GitHub
 * failure (404 / permission) is the only hard fail.
 */
export async function GET(req: NextRequest) {
  const base = {
    status: "ok" as const,
    ts: new Date().toISOString(),
    ...releaseIdentity(),
  };

  const githubWanted = shouldIncludeGithubOnHealthz({
    searchParams: req.nextUrl.searchParams,
  });
  const deep = req.nextUrl.searchParams.get("deep") === "1";

  if (!deep && !githubWanted) {
    return NextResponse.json(base);
  }

  const extra: Record<string, unknown> = {};

  if (deep) {
    try {
      const { internalSchedulerStatus } = await import("@/lib/scheduler/internalScheduler");
      extra.scheduler = internalSchedulerStatus();
    } catch (error) {
      extra.deepError = error instanceof Error ? error.message : String(error);
    }
  }

  if (githubWanted) {
    const sha = gitCommit();
    const result = await verifyGithub({
      locale: "ar",
      sha: sha !== "unknown" ? sha : undefined,
    });
    extra.github = githubVerifyPublic(result);
    if (result.hardFailure) {
      return NextResponse.json(
        { ...base, status: "error", ...extra },
        { status: 503 },
      );
    }
  }

  return NextResponse.json({ ...base, ...extra });
}
