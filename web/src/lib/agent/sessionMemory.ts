/**
 * Short-term, in-process session memory for the Smart Chart Agent. Holds only
 * per-session PREFERENCES (never account secrets) so the agent honors requests
 * like "لا ترسم كثير" / "ركز على سكالبينغ" / "راقب فقط" / "فقط اشرح" for the
 * rest of the chart session. In-memory is sufficient: these are ephemeral UX
 * preferences, not durable state.
 */
import type { AgentSessionMemory } from "./types";

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2h idle expiry
const store = new Map<string, AgentSessionMemory>();

function now(): number {
  return Date.now();
}

export function getSession(sessionId: string): AgentSessionMemory {
  const existing = store.get(sessionId);
  if (existing && now() - existing.updatedAt <= SESSION_TTL_MS) {
    return existing;
  }
  const fresh: AgentSessionMemory = {
    sessionId,
    preferences: {},
    updatedAt: now(),
  };
  store.set(sessionId, fresh);
  return fresh;
}

/** Detect preference directives in a message and fold them into the session. */
export function updateSessionFromMessage(
  sessionId: string,
  message: string,
): AgentSessionMemory {
  const s = getSession(sessionId);
  const t = message.toLowerCase();
  const prefs = { ...s.preferences };

  if (/لا ترسم كثير|رسومات أقل|قلل الرسم|minimal draw/.test(t)) {
    prefs.preferMinimalDrawings = true;
  }
  if (/سكالب|scalp/.test(t)) prefs.tradingStyle = "scalping";
  else if (/سوينغ|swing/.test(t)) prefs.tradingStyle = "swing";
  else if (/انترادي|يومي|intraday/.test(t)) prefs.tradingStyle = "intraday";

  if (/لا تنفذ|راقب فقط|بدون تنفيذ|monitor only|do not execute/.test(t)) {
    prefs.allowExecution = false;
  } else if (/فعّل التنفيذ|allow execution/.test(t)) {
    prefs.allowExecution = true;
  }

  if (/فقط اشرح|بدون توصيات|تعليمي فقط|educational only|explain only/.test(t)) {
    prefs.educationalOnly = true;
  }

  const updated: AgentSessionMemory = {
    ...s,
    preferences: prefs,
    updatedAt: now(),
  };
  store.set(sessionId, updated);
  return updated;
}

export function rememberContext(
  sessionId: string,
  ctx: { symbol?: string; interval?: string; analysisId?: string },
): void {
  const s = getSession(sessionId);
  store.set(sessionId, {
    ...s,
    lastSymbol: ctx.symbol ?? s.lastSymbol,
    lastInterval: ctx.interval ?? s.lastInterval,
    lastAnalysisId: ctx.analysisId ?? s.lastAnalysisId,
    updatedAt: now(),
  });
}
