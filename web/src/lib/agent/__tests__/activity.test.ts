import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createActivityEvent, shouldShowActivity } from "@/lib/agent/activity";

describe("shouldShowActivity", () => {
  it("suppresses scripted intent-narration phrases", () => {
    const ev = createActivityEvent({
      type: "analysis",
      status: "started",
      message: "فهمت أن السؤال عام، سأجيب دون تشغيل أدوات التداول غير اللازمة.",
    });
    assert.equal(shouldShowActivity(ev), false);
  });

  it("suppresses the 'preparing a general answer' phrase", () => {
    const ev = createActivityEvent({
      type: "analysis",
      status: "started",
      message: "أجهّز إجابة عامة دون تشغيل وكلاء التداول.",
    });
    assert.equal(shouldShowActivity(ev), false);
  });

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
