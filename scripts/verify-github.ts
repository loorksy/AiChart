/**
 * Cursor / VPS GitHub verification gate.
 *
 * Exit 0 on a live success *or* an unauthenticated rate-limit skip.
 * Exit 1 only for a real verification failure (GitHub reachable and not limited).
 *
 * Usage (from the web/ package, production VPS):
 *   npx tsx scripts/verify-github.ts
 *   GITHUB_TOKEN=… npx tsx scripts/verify-github.ts
 */
import { t } from "../src/lib/i18n";
import {
  githubVerifyExitCode,
  isGithubRateLimitDetail,
  verifyGithub,
} from "../src/lib/githubVerify";

async function main(): Promise<void> {
  const result = await verifyGithub({
    locale: "ar",
    sha: process.env.GIT_COMMIT?.trim() || undefined,
  });

  console.log(result.message);
  if (result.detail && result.status === "failed") {
    console.log(result.detail);
  }
  process.exit(githubVerifyExitCode(result));
}

main().catch((err) => {
  const detail = err instanceof Error ? err.message : String(err);
  // A thrown GitHub 403 body must stay a soft skip — this is the CLI the
  // Cursor/VPS hook actually runs after "Cursor run FINISHED".
  if (isGithubRateLimitDetail(detail)) {
    console.log(t("ar", "github.verify.rate_limit_skip"));
    process.exit(0);
  }
  console.error(t("ar", "github.verify.failed", { detail }));
  process.exit(1);
});
