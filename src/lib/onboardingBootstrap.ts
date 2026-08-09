import { readFileSync } from "node:fs";
import { join } from "node:path";

const BOOTSTRAP_REL = "agent/onboarding/bootstrap.en.md";

export function getOnboardingBootstrapText(): string {
  const candidates = [
    join(process.cwd(), BOOTSTRAP_REL),
    join(process.cwd(), "..", BOOTSTRAP_REL),
    join(process.cwd(), "..", "..", BOOTSTRAP_REL),
  ];

  for (const path of candidates) {
    try {
      const raw = readFileSync(path, "utf8").trim();
      if (raw) return raw;
    } catch {
      // Try the next monorepo layout candidate.
    }
  }

  return "Failed to load bootstrap from agent/onboarding/bootstrap.en.md.";
}
