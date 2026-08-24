import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "support-")), "test.db");
delete process.env.DATABASE_URL;
// No LLM keys in tests: the bot must skip gracefully, never block a ticket.
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let store: any;
let content: any;

before(async () => {
  db = await import("@/lib/db");
  store = await import("../supportStore");
  content = await import("@/lib/content/seedContent");
  await db.initDb();
  await db.execute(
    "INSERT INTO users (id, email, password_hash, role, status) VALUES (50, 'ask@t.local', 'x', 'user', 'active')",
  );
});

describe("content seeding", () => {
  it("seeds docs and blog posts idempotently and builds the bot corpus", async () => {
    await content.seedContentPages();
    await content.seedContentPages();
    const docs = await db.query(
      "SELECT slug FROM dynamic_pages WHERE kind = 'doc'",
    );
    assert.equal(docs.length, content.DOC_SLUGS.length);
    const blog = await db.query(
      "SELECT slug FROM dynamic_pages WHERE kind = 'blog'",
    );
    assert.ok(blog.length >= 2);

    const corpus = await content.docsCorpus();
    assert.ok(corpus.includes("الشارت الذكي"), "corpus carries the docs");
  });
});

describe("support tickets", () => {
  it("creates a ticket with the first message; bot absence never blocks", async () => {
    const id = await store.createTicket(50, "مشكلة في الرصيد", "لماذا نفد رصيدي بسرعة؟");
    const thread = await store.getTicket(id, 50);
    assert.ok(thread);
    assert.equal(thread.ticket.status, "open");
    assert.equal(thread.messages.length, 1);
    assert.equal(thread.messages[0].author, "user");
  });

  it("scopes reads to the owner and supports the full admin flow", async () => {
    const id = await store.createTicket(50, "سؤال عام", "كيف أربط حسابي؟");
    assert.equal(await store.getTicket(id, 999), null, "stranger sees nothing");

    await store.requestHuman(id);
    await store.assignTicket(id, 20);
    await store.addMessage(id, "admin", "تم — إليك الخطوات…", 20);
    let thread = await store.getTicket(id);
    assert.equal(thread.ticket.status, "in_progress");
    assert.equal(thread.ticket.needs_human, 1);
    assert.equal(thread.ticket.assigned_to, 20);
    assert.equal(thread.messages.at(-1).author, "admin");

    await store.closeTicket(id);
    thread = await store.getTicket(id);
    assert.equal(thread.ticket.status, "closed");
  });
});

/**
 * Item 12 turned support from a ticket queue into a conversation. What follows
 * pins the two things that distinction actually rests on — ONE thread per
 * person, and read state that is per-side — plus the server-side judgement of
 * files, which is the only judgement that counts.
 */
describe("support as a conversation", () => {
  before(async () => {
    await db.execute(
      "INSERT INTO users (id, email, password_hash, role, status) VALUES (51, 'chat@t.local', 'x', 'user', 'active')",
    );
  });

  it("gives one person one thread, reopened where they left it", async () => {
    const first = await store.getOrCreateConversation(51);
    const again = await store.getOrCreateConversation(51);
    assert.equal(again, first, "a second visit continues the same conversation");

    await store.addMessage(first, "user", "still broken", 51);
    assert.equal(await store.getOrCreateConversation(51), first, "history is not abandoned");

    // Closing it ends that conversation; the next visit starts a new one
    // rather than writing into something an admin has filed away.
    await store.closeTicket(first);
    const next = await store.getOrCreateConversation(51);
    assert.notEqual(next, first);
  });

  it("counts unread per side, and never counts a message to its own sender", async () => {
    const id = await store.getOrCreateConversation(51);
    await store.markConversationRead(id, "admin");
    await store.markConversationRead(id, "user");
    assert.equal(await store.unreadCount(id, "admin"), 0);
    assert.equal(await store.unreadCount(id, "user"), 0);

    // Deliberately in the same tick as the read above. Read state used to be a
    // `Date.now()` watermark, and this exact sequence produced 0: the message's
    // `created_at` equalled `admin_last_read_at`, so `created_at > last_read`
    // was false and the message was never unread to anyone. Read state is a
    // message id now, and this assertion is what holds it there.
    await store.addMessage(id, "user", "the chart will not load", 51);
    assert.equal(await store.unreadCount(id, "admin"), 1, "the admin has something waiting");
    assert.equal(
      await store.unreadCount(id, "user"),
      0,
      "a person does not have unread mail from themselves",
    );

    await store.markConversationRead(id, "admin");
    assert.equal(await store.unreadCount(id, "admin"), 0, "opening it IS reading it");

    await store.addMessage(id, "admin", "which browser?", 20);
    assert.equal(await store.unreadCount(id, "user"), 1);
    assert.equal(await store.unreadCount(id, "admin"), 0, "the admin's own reply is not news");

    // The two totals answer different questions on purpose: the user's badge
    // says how many MESSAGES are waiting for them, the console's says how many
    // CONVERSATIONS need someone.
    assert.equal(await store.userUnreadTotal(51), 1);
    assert.ok((await store.adminUnreadTotal()) >= 0);
    await store.addMessage(id, "admin", "and which symbol?", 20);
    assert.equal(await store.userUnreadTotal(51), 2);
  });

  it("carries a file with a message, including a message that is only a file", async () => {
    const id = await store.getOrCreateConversation(51);
    await store.addMessage(id, "user", "", 51, {
      path: "abc123.png",
      name: "screenshot.png",
      bytes: 2048,
    });
    const thread = await store.getTicket(id, 51);
    const last = thread.messages.at(-1);
    assert.equal(last.body, "", "a file with no words is a message");
    assert.equal(last.attachment_path, "abc123.png");
    assert.equal(last.attachment_name, "screenshot.png");
    assert.equal(last.attachment_bytes, 2048);

    // And it is still someone else's conversation to everyone else.
    assert.equal(await store.getTicket(id, 999), null);
  });
});

describe("support attachments — the server decides", () => {
  let att: any;
  before(async () => {
    att = await import("../attachments");
  });

  const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

  it("judges the bytes, not the name or the claimed type", () => {
    // A .png that is actually a script is refused; the extension is a claim.
    const lying = Buffer.from("#!/bin/sh\nrm -rf /\n");
    assert.equal(att.validateSupportAttachment(lying).ok, false);

    const real = att.validateSupportAttachment(png());
    assert.equal(real.ok, true);
    assert.equal(real.ext, "png");
  });

  it("accepts what a support conversation actually contains, and refuses the rest", () => {
    const cases: Array<[string, Buffer, string | null]> = [
      ["png", png(), "png"],
      ["jpeg", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]), "jpg"],
      ["gif", Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(32)]), "gif"],
      [
        "webp",
        Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(32)]),
        "webp",
      ],
      ["pdf", Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(32)]), "pdf"],
      ["empty", Buffer.alloc(0), null],
      ["zip", Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(32)]), null],
      ["mp4", Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom"), Buffer.alloc(32)]), null],
    ];
    for (const [label, bytes, expected] of cases) {
      const verdict = att.validateSupportAttachment(bytes);
      assert.equal(verdict.ok, expected !== null, label);
      if (expected) assert.equal(verdict.ext, expected, label);
    }
  });

  it("refuses a file past the cap before it is ever written", () => {
    const huge = Buffer.concat([png(), Buffer.alloc(att.SUPPORT_ATTACHMENT_MAX_BYTES)]);
    const verdict = att.validateSupportAttachment(huge);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, "too_large");
  });

  it("stores under a generated name and refuses to serve one it did not generate", () => {
    const stored = att.storeSupportAttachment(png(), "png");
    assert.match(stored, /^[a-z0-9]+-[0-9a-f]{16}\.png$/, "the server names the file");
    assert.equal(att.safeAttachmentName(stored), stored);

    // The traversal the serving route must never resolve.
    for (const hostile of [
      "../../.env",
      "..%2f..%2f.env",
      "/etc/passwd",
      "sub/dir/a.png",
      "a.png/../../b.png",
      "notes.txt",
      "shell.sh",
      "",
    ]) {
      assert.equal(att.safeAttachmentName(hostile), null, hostile);
    }
  });

  it("intake decodes, validates and stores in one step for both sides", () => {
    const good = att.intakeSupportAttachment({
      name: "shot.png",
      data_base64: png().toString("base64"),
    });
    assert.equal(good.ok, true);
    assert.match(good.attachment.path, /\.png$/);
    assert.equal(good.attachment.name, "shot.png", "the claimed name survives only as a label");

    const bad = att.intakeSupportAttachment({
      name: "shot.png",
      data_base64: Buffer.from("not an image at all").toString("base64"),
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.status, 415);
  });
});

describe("what counts as a message — one rule, both ends", () => {
  let input: any;
  before(async () => {
    input = await import("../messageInput");
  });

  const check = (payload: unknown) => {
    const parsed = input.supportMessageSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, error: "invalid payload" };
    return input.checkSupportMessage(parsed.data);
  };

  it("accepts text alone, a file alone, and both together", () => {
    const file = { name: "a.png", data_base64: "aGVsbG8td29ybGQ=" };
    assert.equal(check({ body: "hello" }).ok, true);
    assert.equal(check({ attachment: file }).ok, true, "a file with no words is a message");
    const both = check({ body: " hello ", attachment: file });
    assert.equal(both.ok, true);
    assert.equal(both.text, "hello", "the body is trimmed before it is stored");
    assert.deepEqual(both.attachment, file);
  });

  it("refuses the empty message, including one made of whitespace", () => {
    for (const payload of [{}, { body: "" }, { body: "   \n\t " }]) {
      const result = check(payload);
      assert.equal(result.ok, false, JSON.stringify(payload));
      assert.equal(result.error, "empty_message");
    }
  });

  it("bounds what it will read before anything is decoded", () => {
    assert.equal(check({ body: "x".repeat(4001) }).ok, false, "an oversized body is refused");
    assert.equal(
      check({ attachment: { name: "x".repeat(201), data_base64: "aGVsbG8td29ybGQ=" } }).ok,
      false,
      "an absurd filename is refused",
    );
    assert.equal(check("not an object").ok, false);
  });

  it("is the same rule both routes run", async () => {
    // The two ends validated separately once, and drifted: the console demanded
    // words while the user's side did not. Pinning the shared import is what
    // keeps them one conversation.
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const repo = path.join(import.meta.dirname, "..", "..", "..", "..");
    for (const route of [
      ["src", "app", "api", "support", "conversation", "route.ts"],
      ["src", "app", "api", "admin", "support", "route.ts"],
    ]) {
      const source = readFileSync(path.join(repo, ...route), "utf8");
      assert.match(
        source,
        /checkSupportMessage/,
        `${route.join("/")} must use the shared message rule`,
      );
    }
  });
});
