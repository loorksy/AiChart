import { execute, queryOne } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { sanitizeContextText } from "./context/contextSafety";
import { redactedPreview } from "./tools/toolTelemetry";
import type { AgentDecision, AgentIntent } from "./types";
import type { AgentToolTelemetryEvent, AgentToolTelemetrySink } from "./tools/types";

const log = createLogger("agent:run-trace");
export type AgentRunStatus = "running" | "completed" | "failed" | "cancelled";
export interface StartAgentRunInput {
  userId: number; chatId?: string; sessionId?: string; requestId: string;
  symbol?: string; timeframe?: string; intents?: AgentIntent[];
  featureFlags?: Record<string, boolean>; contextVersion?: string;
  contextMessageCount?: number; recalledMemoryCount?: number;
  skillNames?: string[]; toolNames?: string[]; startedAt?: number;
}
export interface FinalizeAgentRunInput {
  userId: number; runId: string; status: Exclude<AgentRunStatus, "running">;
  decision?: AgentDecision; confidence?: number; riskVeto?: boolean;
  errorCode?: string; tokenUsage?: Record<string, number>; completedAt?: number;
}
export interface AgentRunStepInput {
  userId: number; runId: string; type: string;
  status: "started" | "completed" | "failed" | "warning";
  summary?: string; evidence?: Record<string, unknown>; createdAt?: number;
}
export interface AgentArtifactReference {
  id: string; runId: string; kind: string; uri: string; contentType?: string; sizeBytes?: number; checksum?: string;
}

function id(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}
function json(value: unknown, max = 2_000): string { return redactedPreview(value, max) || "{}"; }
function safeText(value: string | undefined, max = 1_000): string | null {
  if (!value) return null;
  const safe = sanitizeContextText(value, { maxChars: max, untrusted: true });
  return safe.rejected ? "[rejected sensitive content]" : safe.text;
}
function names(values: string[] | undefined): string {
  return JSON.stringify([...new Set(values ?? [])].filter((value) => /^[a-z0-9_.-]{1,80}$/i.test(value)).slice(0, 32));
}

export async function startAgentRun(input: StartAgentRunInput): Promise<string | null> {
  const runId = id("run");
  try {
    await execute(
      `INSERT INTO agent_runs
       (run_id,user_id,chat_id,session_id,request_id,symbol,timeframe,intent,status,started_at,
        feature_flags,context_version,context_message_count,recalled_memory_count,skill_names,tool_names)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [runId, input.userId, input.chatId ?? null, input.sessionId ?? null, input.requestId,
        input.symbol ?? null, input.timeframe ?? null, input.intents?.join(",") ?? null,
        "running", input.startedAt ?? Date.now(), json(input.featureFlags ?? {}, 1_000),
        input.contextVersion ?? null, input.contextMessageCount ?? 0, input.recalledMemoryCount ?? 0,
        names(input.skillNames), names(input.toolNames)],
    );
    return runId;
  } catch (error) {
    log.warn("start failed", { requestId: input.requestId, error: error instanceof Error ? error.message : "unknown" });
    return null;
  }
}

export async function addAgentRunStep(input: AgentRunStepInput): Promise<boolean> {
  try {
    const result = await execute(
      `INSERT INTO agent_run_steps (run_id,user_id,step_type,status,summary,evidence_json,created_at)
       SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM agent_runs WHERE run_id = ? AND user_id = ?)`,
      [input.runId, input.userId, input.type.slice(0, 80), input.status, safeText(input.summary),
        json(input.evidence ?? {}), input.createdAt ?? Date.now(), input.runId, input.userId],
    );
    return result.changes > 0;
  } catch (error) {
    log.warn("step failed", { runId: input.runId, error: error instanceof Error ? error.message : "unknown" });
    return false;
  }
}

export async function finalizeAgentRun(input: FinalizeAgentRunInput): Promise<boolean> {
  try {
    const completedAt = input.completedAt ?? Date.now();
    const result = await execute(
      `UPDATE agent_runs SET status=?,completed_at=?,cancelled_at=?,decision=?,confidence=?,risk_veto=?,error_code=?,token_usage=?
       WHERE run_id=? AND user_id=?`,
      [input.status, completedAt, input.status === "cancelled" ? completedAt : null,
        input.decision ?? null, input.confidence ?? null, input.riskVeto ? 1 : 0,
        input.errorCode?.slice(0, 80) ?? null, json(input.tokenUsage ?? {}, 1_000), input.runId, input.userId],
    );
    return result.changes > 0;
  } catch (error) {
    log.warn("finalize failed", { runId: input.runId, error: error instanceof Error ? error.message : "unknown" });
    return false;
  }
}

export async function recordAgentToolCall(input: {
  id?: string; runId: string; userId: number; event: AgentToolTelemetryEvent; retryCount?: number; startedAt?: number;
}): Promise<boolean> {
  try {
    const result = await execute(
      `INSERT INTO agent_tool_calls
       (id,run_id,user_id,tool_name,tool_version,permission,status,duration_ms,input_preview,output_preview,error_code,retry_count,started_at,completed_at)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM agent_runs WHERE run_id = ? AND user_id = ?)`,
      [input.id ?? id("tool"), input.runId, input.userId, input.event.tool.slice(0, 80),
        input.event.version ?? null, input.event.permission ?? null, input.event.status,
        Math.max(0, input.event.durationMs), safeText(input.event.inputPreview, 800),
        safeText(input.event.outputPreview, 800), input.event.errorCode ?? null,
        Math.max(0, input.retryCount ?? 0), input.startedAt ?? Date.now() - input.event.durationMs,
        Date.now(), input.runId, input.userId],
    );
    return result.changes > 0;
  } catch (error) {
    log.warn("tool trace failed", { runId: input.runId, error: error instanceof Error ? error.message : "unknown" });
    return false;
  }
}

export function createRunTraceTelemetrySink(runId: string, userId: number): AgentToolTelemetrySink {
  return (event) => { void recordAgentToolCall({ runId, userId, event }); };
}

export async function getAgentRunForUser<T = Record<string, unknown>>(userId: number, runId: string): Promise<T | null> {
  return queryOne<T>("SELECT * FROM agent_runs WHERE run_id = ? AND user_id = ?", [runId, userId]);
}
