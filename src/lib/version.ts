/**
 * Runtime release identity. Production must expose the exact running commit
 * so a stale build/container/process is detectable from the outside.
 *
 * Resolution order:
 *   1. GIT_COMMIT env (injected at image build / deploy time)
 *   2. The repository .git checkout (PM2/bare-metal deploys run from git)
 *   3. "unknown" — never guessed
 */
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/** Application release version (bump on release tags). */
export const APP_VERSION = "1.2.0";

let cachedCommit: string | null = null;

function readCommitFromGitDir(repoRoot: string): string | null {
  try {
    const dotGit = resolve(repoRoot, ".git");
    let gitDir = dotGit;
    try {
      const pointer = readFileSync(dotGit, "utf8").trim();
      const match = /^gitdir:\s*(.+)$/i.exec(pointer);
      if (match) {
        gitDir = isAbsolute(match[1]!)
          ? match[1]!
          : resolve(repoRoot, match[1]!);
      }
    } catch {
      // Normal checkout: .git is a directory, not a worktree pointer file.
    }
    const head = readFileSync(resolve(gitDir, "HEAD"), "utf8").trim();
    if (/^[0-9a-f]{40}$/i.test(head)) return head;
    const refMatch = /^ref:\s*(.+)$/.exec(head);
    if (!refMatch) return null;
    const ref = refMatch[1]!.trim();
    const candidates = [gitDir];
    try {
      const common = readFileSync(resolve(gitDir, "commondir"), "utf8").trim();
      candidates.push(resolve(gitDir, common));
    } catch {
      // A normal checkout has no separate common directory.
    }
    for (const candidate of candidates) {
      try {
        const sha = readFileSync(resolve(candidate, ref), "utf8").trim();
        if (/^[0-9a-f]{40}$/i.test(sha)) return sha;
      } catch {
        try {
          const packed = readFileSync(
            resolve(candidate, "packed-refs"),
            "utf8",
          );
          for (const line of packed.split("\n")) {
            const [sha, name] = line.split(" ");
            if (
              name?.trim() === ref &&
              sha &&
              /^[0-9a-f]{40}$/i.test(sha)
            ) {
              return sha;
            }
          }
        } catch {
          // Try the next candidate directory.
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** The exact commit serving this process, or "unknown" (never invented). */
export function gitCommit(): string {
  if (cachedCommit) return cachedCommit;
  const fromEnv = process.env.GIT_COMMIT?.trim();
  if (fromEnv && /^[0-9a-f]{7,40}$/i.test(fromEnv)) {
    cachedCommit = fromEnv.toLowerCase();
    return cachedCommit;
  }
  for (const root of [resolve(process.cwd(), ".."), process.cwd()]) {
    const sha = readCommitFromGitDir(root);
    if (sha) {
      cachedCommit = sha.toLowerCase();
      return cachedCommit;
    }
  }
  cachedCommit = "unknown";
  return cachedCommit;
}

/** Compact release identity for health/version endpoints. */
export function releaseIdentity(): { version: string; commit: string } {
  return { version: APP_VERSION, commit: gitCommit() };
}
