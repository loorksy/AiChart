import type { AgentActivity, ActivityListener } from "./agentActivity";
import { emitActivity } from "./agentActivity";

/** Initial SSE connection phase — shown until the first server activity arrives. */
export const SSE_CONNECT_ACTIVITY: AgentActivity = {
  id: "sse-connect",
  label: "جاري الاتصال…",
  status: "running",
};

export function emitPipeline(
  listener: ActivityListener | undefined,
  activity: AgentActivity,
) {
  emitActivity(listener, activity);
}

export function emitSseConnect(listener: ActivityListener | undefined) {
  emitActivity(listener, SSE_CONNECT_ACTIVITY);
}

export function markSseConnected(listener: ActivityListener | undefined) {
  emitActivity(listener, {
    id: "sse-connect",
    label: "متصل بالخادم",
    status: "done",
  });
}

export function emitAgentLlm(
  listener: ActivityListener | undefined,
  step = 1,
  status: AgentActivity["status"] = "running",
) {
  emitActivity(listener, {
    id: "agent-llm",
    label: step > 1 ? `تحليل Claude · خطوة ${step}` : "تحليل Claude",
    status,
    tool: "claude",
  });
}

export function emitCompose(
  listener: ActivityListener | undefined,
  status: AgentActivity["status"] = "running",
) {
  emitActivity(listener, {
    id: "compose",
    label: "صياغة الرد",
    status,
  });
}
