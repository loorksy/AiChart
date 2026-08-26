/**
 * The RTL-safe timestamp contract.
 *
 * The regression this pins: the support thread formatted "day/month + clock"
 * with numeric fields, the Arabic pattern put a bidi mark before the slash,
 * and the RTL page reassembled the pieces as "/08، 03:04 ص26". The shared
 * formatter must therefore (1) never emit a slashed numeric date for Arabic —
 * the month is a word, or the day is a word — and (2) wrap every fragment in
 * a first-strong isolate so the surrounding paragraph cannot reorder it.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bidiIsolate,
  formatClock,
  formatDayLabel,
  formatFullDate,
  formatMessageStamp,
  isSameCalendarDay,
} from "@/lib/display/timestamp";

const FSI = "\u2068";
const PDI = "\u2069";

const ARABIC_DIGITS = /[\u0660-\u0669]/;
const ARABIC_LETTERS = /[\u0621-\u064A]/;

// A stable "now" at LOCAL noon, so the today/yesterday/date branches land on
// the same calendar day in every timezone the suite runs in.
const NOW = new Date(2026, 7, 26, 12, 0, 0).getTime();
const HOURS = 3_600_000;
const DAYS = 24 * HOURS;

describe("bidiIsolate", () => {
  it("wraps text in FSI…PDI and leaves empty strings alone", () => {
    assert.equal(bidiIsolate("x"), `${FSI}x${PDI}`);
    assert.equal(bidiIsolate(""), "");
  });
});

describe("formatClock", () => {
  it("Arabic clocks use Arabic-Indic digits and an Arabic day period, isolated", () => {
    const clock = formatClock(NOW, "ar");
    assert.ok(clock.startsWith(FSI) && clock.endsWith(PDI), "isolated");
    assert.match(clock, ARABIC_DIGITS);
    assert.match(clock, /[صم]/);
    assert.doesNotMatch(clock, /[0-9]/, "never Latin digits for ar");
  });

  it("English clocks use Latin digits", () => {
    const clock = formatClock(NOW, "en");
    assert.match(clock, /\d{1,2}:\d{2}/);
    assert.doesNotMatch(clock, ARABIC_DIGITS);
  });

  it("an invalid timestamp renders as nothing, never 'Invalid Date'", () => {
    assert.equal(formatClock(Number.NaN, "ar"), "");
    assert.equal(formatClock(Number.NaN, "en"), "");
  });
});

describe("formatDayLabel", () => {
  it("today and yesterday are words from the dictionaries", () => {
    assert.equal(formatDayLabel(NOW - 2 * HOURS, "ar", NOW), "اليوم");
    assert.equal(formatDayLabel(NOW - 1 * DAYS, "ar", NOW), "أمس");
    assert.equal(formatDayLabel(NOW - 2 * HOURS, "en", NOW), "Today");
    assert.equal(formatDayLabel(NOW - 1 * DAYS, "en", NOW), "Yesterday");
  });

  it("an older Arabic day is a WORDY month — no slashes to scramble", () => {
    const label = formatDayLabel(NOW - 30 * DAYS, "ar", NOW);
    assert.ok(label.startsWith(FSI) && label.endsWith(PDI), "isolated");
    assert.match(label, ARABIC_LETTERS, "the month is a word");
    assert.match(label, ARABIC_DIGITS, "the day is in Arabic-Indic digits");
    assert.doesNotMatch(label, /[/\\.]/, "never a slashed numeric date");
    assert.doesNotMatch(label, /[0-9]/);
  });

  it("the year appears only once the year differs", () => {
    const sameYear = formatDayLabel(new Date(2026, 2, 5, 12).getTime(), "en", NOW);
    const otherYear = formatDayLabel(new Date(2025, 5, 15, 12).getTime(), "en", NOW);
    assert.doesNotMatch(sameYear, /2026/);
    assert.match(otherYear, /2025/);
  });
});

describe("formatMessageStamp", () => {
  it("recent stamps read as 'اليوم ٠٣:٠٤ ص' — day word then isolated clock", () => {
    const stamp = formatMessageStamp(NOW - 2 * HOURS, "ar", NOW);
    assert.ok(stamp.startsWith("اليوم "), stamp);
    assert.ok(stamp.includes(FSI) && stamp.includes(PDI), "the clock is isolated");
    assert.doesNotMatch(stamp, /[0-9/]/, "no Latin digits, no slashes");
  });

  it("older Arabic stamps join a wordy date and the clock with the Arabic comma", () => {
    const stamp = formatMessageStamp(NOW - 30 * DAYS, "ar", NOW);
    assert.match(stamp, /، /, "Arabic comma between the two isolated fragments");
    // Both fragments individually isolated: two FSI…PDI pairs.
    assert.equal((stamp.match(new RegExp(FSI, "g")) ?? []).length, 2);
    assert.equal((stamp.match(new RegExp(PDI, "g")) ?? []).length, 2);
    assert.doesNotMatch(stamp, /[/\\]/);
  });

  it("English stamps use the Latin comma", () => {
    const stamp = formatMessageStamp(NOW - 30 * DAYS, "en", NOW);
    assert.match(stamp, /, /);
  });

  it("an invalid timestamp renders as nothing", () => {
    assert.equal(formatMessageStamp(Number.NaN, "ar"), "");
  });
});

describe("formatFullDate", () => {
  it("renders a full wordy date for renewal lines, isolated", () => {
    const ts = new Date(2026, 8, 22, 12).getTime();
    const ar = formatFullDate(ts, "ar");
    assert.ok(ar.startsWith(FSI) && ar.endsWith(PDI));
    assert.match(ar, ARABIC_LETTERS);
    assert.match(ar, ARABIC_DIGITS);
    assert.doesNotMatch(ar, /[/0-9]/);
    const en = formatFullDate(ts, "en");
    assert.match(en, /September/);
    assert.match(en, /2026/);
  });
});

describe("isSameCalendarDay", () => {
  it("compares calendar days, not 24-hour windows", () => {
    assert.equal(isSameCalendarDay(NOW, NOW - 2 * HOURS), true);
    assert.equal(isSameCalendarDay(NOW, NOW - 2 * DAYS), false);
    assert.equal(isSameCalendarDay(Number.NaN, NOW), false);
  });
});
