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
    assert.ok(corpus.includes("ربط MT5"), "corpus carries the docs");
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
