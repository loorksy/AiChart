/**
 * Onboarding bootstrap — single source of truth for the "first message" that
 * primes any model (Claude / ChatGPT) on connect. The canonical text lives in
 * `agent/onboarding/bootstrap.ar.md`; this module reads it (resolved upward from
 * cwd / this file) and derives the short `instructions` extract from the same
 * text so the three surfaces (copy panel, MCP prompt, server instructions)
 * never drift.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REL = "agent/onboarding/bootstrap.ar.md";

const MISSING_BOOTSTRAP =
  "تعذّر تحميل رسالة البدء من agent/onboarding/bootstrap.ar.md.";

let cached: string | null = null;

function here(): string {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

/** Full canonical bootstrap text (read once, cached). */
export function bootstrapText(): string {
  if (cached != null) return cached;
  const base = here();
  const candidates = [
    join(process.cwd(), REL),
    join(process.cwd(), "..", REL),
    join(base, "../../..", REL), // dist/onboarding → repo root
    join(base, "../../../..", REL),
    join(base, "../..", REL),
  ];
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, "utf8").trim();
      if (raw) {
        cached = raw;
        return cached;
      }
    } catch {
      /* try next */
    }
  }
  cached = MISSING_BOOTSTRAP;
  return cached;
}

/**
 * Short core extract for the MCP `instructions` field — identity + the
 * non-negotiable bullet rules only (never the full onboarding dump). Derived
 * from the same text so it can't drift.
 */
export function instructionsCore(): string {
  const text = bootstrapText();
  const rules = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("•"));
  const body = rules.length
    ? rules.join("\n")
    : "• احترم Risk Guard دائماً. • لا تنفّذ بلا موافقة صريحة (رمز + مبلغ + وقف + «نفّذ»). • احسب الحجم على الرصيد الحقيقي.";
  return [
    "منصة AiChart للتداول — أنت شريك تنفيذ (صيغة «نحن»)، لا مستشار.",
    "عند بدء أي جلسة، نادِ get_agent_capabilities واقرأ مهارات AGENTS/SOUL، ثم لخّص الحساب عبر get_risk_status + get_portfolio + get_live_account.",
    "القواعد غير القابلة للكسر:",
    body,
    "لتهيئة كاملة استعمل الأمر aichart_start (MCP prompt) أو الصق رسالة البدء من شاشة الربط.",
  ].join("\n");
}
