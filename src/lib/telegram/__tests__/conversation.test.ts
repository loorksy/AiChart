/**
 * Commands resolve; conversation does not.
 *
 * This file used to pin a phrase classifier — "مرحبا" → canned greeting,
 * "حالة السوق" → canned session paragraph. Those were a bot's reflexes: the
 * same fixed reply forever, drifting from what the agent would actually say,
 * and one extra word away from falling through to the wrong path. The
 * classifier is gone; these tests pin its ABSENCE and the one mechanical
 * survivor: explicit commands.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  resolveTelegramCommand,
  telegramLinkedWelcome,
} from "@/lib/telegram/conversation";

const SRC = path.join(import.meta.dirname, "..", "..", "..");

describe("resolveTelegramCommand", () => {
  it("maps the chart command — the one thing the agent cannot say as prose", () => {
    assert.deepEqual(resolveTelegramCommand("/chart"), { kind: "chart_photo" });
    assert.deepEqual(resolveTelegramCommand("صورة الشارت"), { kind: "chart_photo" });
    assert.deepEqual(resolveTelegramCommand("أرسل صورة الشارت"), { kind: "chart_photo" });
  });

  it("expands menu commands to the prompt they stand for", () => {
    assert.deepEqual(resolveTelegramCommand("/tawsia"), {
      kind: "prompt",
      message: "أعطني توصية على الذهب",
    });
  });

  it("leaves free text alone — the agent's, untouched", () => {
    // Greetings, identity questions, session questions: all null. The
    // orchestrator routes and ANSWERS them live; nothing here may intercept.
    assert.equal(resolveTelegramCommand("مرحبا"), null);
    assert.equal(resolveTelegramCommand("من انت"), null);
    assert.equal(resolveTelegramCommand("هل السوق مفتوح؟"), null);
    assert.equal(resolveTelegramCommand("اعطني توصية"), null);
  });
});

describe("no canned conversation survives", () => {
  it("the module exports no greeting, menu, or session paragraphs", () => {
    const source = readFileSync(
      path.join(SRC, "lib", "telegram", "conversation.ts"),
      "utf8",
    );
    // The reflexes this file replaced, banned by name.
    assert.doesNotMatch(source, /telegramGreeting|telegramMenu|telegramSessionStatus/);
    assert.doesNotMatch(source, /GREETING|const MENU|const SESSION/);
    assert.doesNotMatch(source, /classifyTelegramTurn/);
  });

  it("the link receipt stays mechanical and free of envelope vocabulary", () => {
    const text = telegramLinkedWelcome();
    assert.ok(text.includes("تم الربط"));
    for (const leak of [
      "informational",
      "descriptive_only",
      "operational_blocker",
      "not_applicable",
    ]) {
      assert.equal(text.includes(leak), false);
    }
  });
});
