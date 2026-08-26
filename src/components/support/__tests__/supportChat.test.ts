/**
 * The chat's client-side limits must be the SERVER's limits.
 *
 * The composer tells the person what it will accept before they wait through
 * an upload — an accept list on the file input and a size check on pick. That
 * is a courtesy, and a courtesy that disagrees with the server is worse than
 * none: it promises a file is fine and then the server answers 415, or it
 * refuses a file the server would have taken.
 *
 * So the two are pinned to each other here. The SERVER stays the authority —
 * it judges the magic bytes — and this only stops the client's promise from
 * drifting away from it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  SUPPORT_ATTACHMENT_ACCEPTED,
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SUPPORT_CONTENT_TYPES,
} from "@/lib/support/attachments";

const CHAT = readFileSync(
  path.join(import.meta.dirname, "..", "SupportChat.tsx"),
  "utf8",
);

test("the file input offers exactly the types the server accepts", () => {
  const accept = /const ACCEPT = "([^"]+)"/.exec(CHAT)?.[1];
  assert.ok(accept, "the composer declares an accept list");
  assert.deepEqual(
    accept.split(",").sort(),
    [...SUPPORT_ATTACHMENT_ACCEPTED].sort(),
    "the chooser must not offer a type the server refuses, nor hide one it takes",
  );
});

test("the composer's size cap is the server's cap", () => {
  const expression = /const MAX_BYTES = ([^;]+);/.exec(CHAT)?.[1];
  assert.ok(expression, "the composer declares a cap");
  // Evaluated rather than string-matched: `5 * 1024 * 1024` and `5242880` are
  // the same promise, and a test that only accepts one spelling is noise.
  const value = Number(new Function(`return (${expression})`)());
  assert.equal(value, SUPPORT_ATTACHMENT_MAX_BYTES);
});

test("what the thread renders inline is what the server can serve as an image", () => {
  const pattern = /const IMAGE_EXT = \/([^/]+)\/i;/.exec(CHAT)?.[1];
  assert.ok(pattern, "the thread declares which attachments render inline");
  const inline = new RegExp(pattern, "i");
  for (const [ext, type] of Object.entries(SUPPORT_CONTENT_TYPES)) {
    assert.equal(
      inline.test(`file.${ext}`),
      type.startsWith("image/"),
      `.${ext} is served as ${type}`,
    );
  }
});

test("every refusal the server can send has words the user can read", () => {
  // A 415 rendered as "failed" tells the person nothing about what to do next.
  for (const reason of ["too_large", "unsupported_type", "empty_message"]) {
    assert.match(
      CHAT,
      new RegExp(`support\\.error\\.${reason}`),
      `the chat must name the '${reason}' refusal`,
    );
  }
});

test("the support surface IS the agent chat surface", () => {
  // Owner's instruction: same chat, different counterpart. The thread lives
  // in the agent panel's shell — the same scroll region and the same docked
  // composer on the same fade wall — with NO page-header block above it.
  assert.match(CHAT, /chat-panel-shell/);
  assert.match(CHAT, /chat-scroll-region/);
  assert.match(CHAT, /chat-composer-fade/);
  assert.match(CHAT, /chat-composer-dock/);
  assert.match(CHAT, /--composer-height/, "thread padding tracks the live composer height");
  assert.doesNotMatch(CHAT, /PageHeader/);
  assert.doesNotMatch(CHAT, /support\.subtitle/, "no title block floating over the thread");
});

test("timestamps go through the shared RTL-safe formatter, never a local one", () => {
  // The thread used to build its own "day/month + clock" format with numeric
  // fields ("26/08، 03:04 ص"); inside the RTL page the bidi algorithm tore it
  // into "/08، 03:04 ص26". The shared formatter spells the day as a word,
  // isolates every fragment, and is the ONLY way a time may be rendered here.
  assert.match(CHAT, /from "@\/lib\/display\/timestamp"/);
  assert.match(CHAT, /formatClock\(/);
  assert.match(CHAT, /formatDayLabel\(/);
  assert.match(CHAT, /isSameCalendarDay\(/, "days are grouped under date separators");
  assert.doesNotMatch(CHAT, /new Intl\.DateTimeFormat/);
  assert.doesNotMatch(CHAT, /toLocale(?:Date|Time)?String/);
});

test("the badge counts without clearing what it counts", () => {
  const hook = readFileSync(
    path.join(import.meta.dirname, "..", "..", "..", "hooks", "useSupportUnread.ts"),
    "utf8",
  );
  // Reading the conversation marks it read. A badge that fetched the thread to
  // count it would zero the number it was asking for, forever.
  assert.match(hook, /conversation\?peek=1/);
  assert.doesNotMatch(
    hook,
    /fetch\("\/api\/support\/conversation"[^?]/,
    "the badge must never open the conversation",
  );
});
