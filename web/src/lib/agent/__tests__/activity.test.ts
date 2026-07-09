import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createActivityEvent,
  shouldShowActivity,
  sanitizePublicText,
} from "@/lib/agent/activity";

describe("shouldShowActivity", () => {
  it("suppresses events explicitly marked visible: false", () => {
    const ev = createActivityEvent({
      type: "data",
      status: "completed",
      message: "أفحص بيانات EUR/USD من مخزن الشموع.",
      visible: false,
    });
    assert.equal(shouldShowActivity(ev), false);
  });

  it("suppresses empty messages", () => {
    const ev = createActivityEvent({ type: "data", status: "completed", message: "   " });
    assert.equal(shouldShowActivity(ev), false);
  });

  it("shows real tool/agent work", () => {
    const ev = createActivityEvent({
      type: "data",
      status: "completed",
      message: "أقرأ بيانات EUR/USD من مخزن الشموع.",
    });
    assert.equal(shouldShowActivity(ev), true);
  });
});

describe("sanitizePublicText", () => {
  it("strips chain-of-thought phrasing without truncating long text", () => {
    const long = `سلسلة التفكير: ${"تحليل مفصل ".repeat(50)}`;
    const out = sanitizePublicText(long);
    assert.ok(!out.includes("سلسلة التفكير"));
    assert.ok(out.length > 240); // no 240-char cap
  });
});
