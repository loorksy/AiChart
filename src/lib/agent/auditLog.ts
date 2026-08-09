/**
 * Agent decision audit. One row per Smart Chart Agent run. NEVER stores raw
 * model reasoning — only the public decision, intents, and risk/news/execution
 * outcomes needed for compliance + debugging.
 */
import { execute } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import type { AgentDecision, AgentIntent } from "./types";

const log = createLogger("agent:audit");

export interface AgentAuditEntry {
  userId?: number;
  requestId: string;
  sessionId?: string;
  symbol?: string;
  interval?: string;
  intents?: AgentIntent[];
  decision?: AgentDecision;
  confidence?: number;
  newsRisk?: string;
  executionRequiresConfirmation?: boolean;
  executionConfirmed?: boolean;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export async function writeAgentAudit(entry: AgentAuditEntry): Promise<void> {
  try {
    await execute(
      `INSERT INTO agent_audit_logs
         (user_id, request_id, session_id, symbol, interval, intent, decision,
          confidence, news_risk, execution_requires_confirmation,
          execution_confirmed, summary, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.userId ?? null,
        entry.requestId,
        entry.sessionId ?? null,
        entry.symbol ?? null,
        entry.interval ?? null,
        entry.intents?.join(",") ?? null,
        entry.decision ?? null,
        entry.confidence ?? null,
        entry.newsRisk ?? null,
        entry.executionRequiresConfirmation ? 1 : 0,
        entry.executionConfirmed ? 1 : 0,
        entry.summary ?? null,
        JSON.stringify(entry.metadata ?? {}),
      ],
    );
  } catch (error) {
    // Audit must never break the user request.
    log.error("audit write failed", {
      requestId: entry.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
