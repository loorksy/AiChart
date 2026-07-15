/**
 * MCP runtime release identity — same resolution rules as the web runtime:
 * GIT_COMMIT env first (container builds), then the git checkout (PM2
 * deploys run from the repository), then "unknown" — never invented.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let cachedCommit: string | null = null;

function readCommitFromGitDir(repoRoot: string): string | null {
  try {
    const head = readFileSync(resolve(repoRoot, ".git", "HEAD"), "utf8").trim();
    if (/^[0-9a-f]{40}$/i.test(head)) return head;
    const refMatch = /^ref:\s*(.+)$/.exec(head);
    if (!refMatch) return null;
    const ref = refMatch[1]!.trim();
    try {
      const sha = readFileSync(resolve(repoRoot, ".git", ref), "utf8").trim();
      return /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
    } catch {
      const packed = readFileSync(resolve(repoRoot, ".git", "packed-refs"), "utf8");
      for (const line of packed.split("\n")) {
        const [sha, name] = line.split(" ");
        if (name?.trim() === ref && sha && /^[0-9a-f]{40}$/i.test(sha)) return sha;
      }
      return null;
    }
  } catch {
    return null;
  }
}

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
