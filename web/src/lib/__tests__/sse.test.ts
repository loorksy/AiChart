import assert from "node:assert/strict";
import test from "node:test";
import { consumeSse, sseEncode } from "../sse";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

test("consumeSse handles split events, deltas, malformed payloads, and done", async () => {
  const deltas: string[] = [];
  const errors: string[] = [];
  const done = { ok: true };
  const validDelta = new TextDecoder().decode(sseEncode("delta", { text: "مرحبا" }));
  const validDone = new TextDecoder().decode(sseEncode("done", done));

  const result = await consumeSse<{ ok: boolean }>(
    new Response(
      streamFromChunks([
        validDelta.slice(0, 12),
        validDelta.slice(12),
        "event: delta\ndata: {bad json}\n\n",
        validDone,
      ]),
    ),
    {
      onDelta: (text) => deltas.push(text),
      onError: (message) => errors.push(message),
    },
  );

  assert.deepEqual(deltas, ["مرحبا"]);
  assert.equal(errors.length, 1);
  assert.deepEqual(result, done);
});
