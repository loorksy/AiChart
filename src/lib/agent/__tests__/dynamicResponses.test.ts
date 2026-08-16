import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { composeStatusReply, bilingual } from "@/lib/agent/statusReply";

const read = (rel: string) =>
  readFileSync(resolve(process.cwd(), "src", rel), "utf8");

test("normal-flow acknowledgments are composed dynamically, not canned", () => {
  const orchestrator = read("lib/agent/orchestrator.ts");
  // The old fixed final answers are gone from normal flows.
  assert.doesNotMatch(orchestrator, /ألغيت التوصية النشطة في هذه الجلسة\. إذا أردت تحليلًا جديدًا اطلبه صراحة\./);
  assert.doesNotMatch(orchestrator, /اطلب تحليلًا جديدًا أو أرسل التوصية التي تريد مراجعتها/);
  assert.doesNotMatch(orchestrator, /الدخول والوقف والأهداف ومنطقة الإبطال\. لم أُنشئ توصية جديدة\./);
  // The dynamic composer drives those paths.
  const composerCalls = orchestrator.match(/composeStatusReply\(/g) ?? [];
  assert.ok(composerCalls.length >= 3, "cancel/no-stored/redraw paths must use the composer");
});

test("drawing-only commands compose their replies dynamically", () => {
  const drawing = read("lib/agent/drawingCommands/handleDrawingCommand.ts");
  assert.match(drawing, /composeStatusReply\(/);
  assert.doesNotMatch(drawing, /summary: "مسحت رسومات الوكيل/);
});

test("safety and protocol messages respect the operator locale", () => {
  const orchestrator = read("lib/agent/orchestrator.ts");
  // Safety/blocker texts localize through the dictionary: `t(locale, …)`
  // resolves both languages from src/lib/i18n, where the compiler enforces
  // that every key exists in ar AND en. Inline literals are banned — the
  // arabicInSystemFiles ratchet pins that repo-wide; here the orchestrator
  // specifically must sit at zero.
  const dictionaryCalls = orchestrator.match(/\bt\(\s*locale/g) ?? [];
  assert.ok(dictionaryCalls.length >= 10, "safety gates must localize via t(locale, …)");
  // bilingual() survives only where it SELECTS between two computed values
  // (dataQuality coverage summaries), never for literals.
  const bilingualCalls = orchestrator.match(/bilingual\(\s*locale/g) ?? [];
  assert.ok(bilingualCalls.length >= 1, "computed ar/en pairs still select via bilingual()");
  assert.doesNotMatch(orchestrator, /[؀-ۿ]/, "no Arabic literals in the orchestrator");
});

test("composer never adds greetings/introductions and falls back honestly without an LLM", async () => {
  const source = read("lib/agent/statusReply.ts");
  assert.match(source, /Do not add greetings, introductions, or capability lists/);
  assert.match(source, /canonicalIdentityCore\(\)/);

  // Without an LLM key the composer must return the deterministic fallback —
  // never fake a model-composed reply.
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const en = await composeStatusReply({
      situation: "test situation",
      facts: { a: 1 },
      locale: "en",
      fallback: "fallback-en",
    });
    assert.equal(en, "fallback-en");
  } finally {
    if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
  }
});

test("bilingual helper switches on locale", () => {
  assert.equal(bilingual("ar", "عربي", "english"), "عربي");
  assert.equal(bilingual("en", "عربي", "english"), "english");
});

test("follow-up and drawing composers mirror the operator language (no forced Arabic)", () => {
  const followup = read("lib/agent/recommendation/followupAnswer.ts");
  const drawingAnswer = read("lib/agent/chartDrawingAnswer.ts");
  assert.doesNotMatch(followup, /اكتب إجابة عربية/);
  assert.match(followup, /Mirror the language of the operator's question/);
  assert.doesNotMatch(drawingAnswer, /أجب بالعربية/);
  assert.match(drawingAnswer, /SAME language as the operator's question/);
});

test("no transcription or analysis-only identity anywhere in agent prompts", () => {
  for (const rel of [
    "lib/agent/systemPrompt.ts",
    "lib/agent/canonicalIdentity.ts",
    "lib/agent/statusReply.ts",
  ]) {
    const source = read(rel);
    assert.doesNotMatch(source, /You only convert speech to text/i, rel);
    assert.doesNotMatch(source, /analysis-only assistant/i, rel);
  }
});
