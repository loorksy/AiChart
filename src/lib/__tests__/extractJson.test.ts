import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractJson } from "@/lib/extractJson";

describe("extractJson recovers model replies that are not bare JSON", () => {
  it("returns a bare object unchanged", () => {
    assert.equal(extractJson('{"direction":"buy"}'), '{"direction":"buy"}');
  });

  it("unwraps a fenced block", () => {
    assert.equal(
      extractJson('Here:\n```json\n{"direction":"sell"}\n```\n'),
      '{"direction":"sell"}',
    );
  });

  it("strips <think> wrappers and reads the object after them", () => {
    const raw = `<think>I will weigh both sides...</think>\n{"direction":"buy","planType":"immediate"}`;
    assert.equal(
      extractJson(raw),
      '{"direction":"buy","planType":"immediate"}',
    );
  });

  it("drops an unclosed think tag so leftover thinking is not parsed", () => {
    const raw = `<think>still reasoning {"inner":1}`;
    assert.equal(extractJson(raw), "");
  });

  it("salvages the last complete object when the root is truncated", () => {
    const withNested =
      '{"direction":"buy","drawingAdvice":{"shouldDraw":true,"reason":"ok"},"summary":"cut';
    assert.equal(
      extractJson(withNested),
      '{"shouldDraw":true,"reason":"ok"}',
    );
  });

  it("does not invent braces when nothing closed", () => {
    const raw =
      '{"direction":"buy","drawingAdvice":{"shouldDraw":true,"reason":"cut';
    assert.equal(extractJson(raw), raw);
  });

  it("prefers the outermost complete object over a nested one", () => {
    const raw =
      'prefix {"direction":"sell","drawingAdvice":{"shouldDraw":false,"reason":"x"}} trailing';
    assert.equal(
      extractJson(raw),
      '{"direction":"sell","drawingAdvice":{"shouldDraw":false,"reason":"x"}}',
    );
  });
});
