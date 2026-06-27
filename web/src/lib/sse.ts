import type { AgentActivity } from "./agentActivity";

export function sseEncode(event: string, data: unknown): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export interface SseHandlers<TDone = unknown> {
  onActivity?: (activity: AgentActivity) => void;
  onDelta?: (text: string) => void;
  onMeta?: (payload: unknown) => void;
  onDone?: (payload: TDone) => void;
  onError?: (message: string) => void;
  signal?: AbortSignal;
}

/** Parse an SSE response body from fetch (client-side). */
export async function consumeSse<TDone = unknown>(
  response: Response,
  handlers: SseHandlers<TDone>,
): Promise<TDone | null> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("لا يوجد تدفّق من الخادم.");

  const decoder = new TextDecoder();
  let buffer = "";
  let donePayload: TDone | null = null;

  const dispatch = (block: string) => {
    const lines = block.split("\n");
    let event = "message";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data) as unknown;
    } catch {
      handlers.onError?.("وصل حدث غير صالح من الخادم، وتم تجاهله.");
      return;
    }
    if (event === "activity") handlers.onActivity?.(parsed as AgentActivity);
    else if (event === "meta") handlers.onMeta?.(parsed);
    else if (event === "delta") {
      const text =
        typeof parsed === "object" && parsed && "text" in parsed
          ? String((parsed as { text: string }).text)
          : "";
      if (text) handlers.onDelta?.(text);
    } else if (event === "done") {
      donePayload = parsed as TDone;
      handlers.onDone?.(donePayload);
    } else if (event === "error") {
      const msg =
        typeof parsed === "object" && parsed && "error" in parsed
          ? String((parsed as { error: string }).error)
          : "حدث خطأ.";
      handlers.onError?.(msg);
    }
  };

  while (true) {
    if (handlers.signal?.aborted) {
      await reader.cancel().catch(() => undefined);
      break;
    }
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) dispatch(part);
  }
  if (buffer.trim()) dispatch(buffer);

  return donePayload;
}
