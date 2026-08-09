import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  handleIndicatorCommand,
  parseRequestedStudies,
} from "@/lib/agent/indicators/handleIndicatorCommand";

describe("parseRequestedStudies", () => {
  it("parses a simple Arabic enable request", () => {
    const studies = parseRequestedStudies("شغّل RSI");
    assert.equal(studies.length, 1);
    assert.equal(studies[0]!.name, "RSI");
    assert.equal(studies[0]!.id, "agent-rsi");
    assert.equal(studies[0]!.inputs, undefined);
  });

  it("parses a period next to the indicator (both orders + Arabic digits)", () => {
    assert.deepEqual(parseRequestedStudies("add EMA 50"), [
      { id: "agent-ema-50", name: "EMA", inputs: { length: 50 } },
    ]);
    assert.deepEqual(parseRequestedStudies("add the 200 sma"), [
      { id: "agent-sma-200", name: "SMA", inputs: { length: 200 } },
    ]);
    assert.deepEqual(parseRequestedStudies("أضف RSI ٢١"), [
      { id: "agent-rsi-21", name: "RSI", inputs: { length: 21 } },
    ]);
  });

  it("parses several indicators in one message", () => {
    const studies = parseRequestedStudies("فعّل الماكد وأضف بولينجر و VWAP");
    assert.deepEqual(
      studies.map((s) => s.name),
      ["MACD", "BB", "VWAP"],
    );
  });

  it("two periods of the same indicator become two studies", () => {
    const studies = parseRequestedStudies("add ema 50 and ema 200");
    assert.deepEqual(
      studies.map((s) => s.id).sort(),
      ["agent-ema-200", "agent-ema-50"],
    );
  });

  it("'moving average' alone is the simple MA, not EMA", () => {
    assert.deepEqual(
      parseRequestedStudies("add a moving average").map((s) => s.name),
      ["SMA"],
    );
  });

  it("does not misread 'demand' as EMA or 'small' as SMA", () => {
    assert.deepEqual(parseRequestedStudies("add a demand zone"), []);
    assert.deepEqual(parseRequestedStudies("add a small position"), []);
  });
});

describe("handleIndicatorCommand", () => {
  it("returns studies + an Arabic confirmation, never a recommendation", () => {
    const result = handleIndicatorCommand({ userMessage: "شغّل RSI والماكد", locale: "ar" });
    assert.equal(result.decision, "informational");
    assert.equal(result.recommendation, undefined);
    assert.deepEqual(result.studies?.map((s) => s.name), ["RSI", "MACD"]);
    assert.ok(result.summary.includes("RSI"));
    assert.ok(result.summary.includes("MACD"));
  });

  it("asks which indicator when none was recognized", () => {
    const result = handleIndicatorCommand({ userMessage: "أضف مؤشر", locale: "ar" });
    assert.equal(result.decision, "informational");
    assert.equal(result.studies, undefined);
    assert.ok(result.summary.length > 0);
  });
});
