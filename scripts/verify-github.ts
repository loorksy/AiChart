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
  verifyGithub,
} from "../src/lib/githubVerify";

async function main(): Promise<void> {
  const result = await verifyGithub({
    locale: "ar",
    sha: process.env.GIT_COMMIT?.trim() || undefined,
  });

  console.log(result.message);
  if (result.detail && result.status !== "ok") {
    console.log(result.detail);
  }
  process.exit(githubVerifyExitCode(result));
}

main().catch((err) => {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(t("ar", "github.verify.failed", { detail }));
  process.exit(1);
});
