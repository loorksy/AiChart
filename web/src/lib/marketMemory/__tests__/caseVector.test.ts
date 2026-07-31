/**
 * Contract tests for the dual similarity paths (plan phase G infra).
 *
 * The pgvector KNN path cannot run against a live Postgres in CI, so what is
 * proven here is the contract that makes it safe: both paths are built from
 * the same filters and the same column list, the vector ordering only ever
 * changes WHICH candidates are read, the SQL adapts cleanly to Postgres
 * placeholders, and SQLite never sees the vector path at all. The SQLite
 * runtime behaviour itself is covered end-to-end by caseIndexerDb.test.ts.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Force the SQLite backend before anything touches the db module.
delete process.env.DATABASE_URL;

import { adaptSql } from "@/lib/db/sql";
import { fingerprintVector, type CaseFingerprint } from "@/lib/marketMemory/caseFingerprint";
import {
  backfillCaseEmbeddings,
  CASE_EMBEDDING_DIM,
  caseEmbeddingLiteral,
  caseVectorSearchReady,
} from "@/lib/marketMemory/caseVector";
import { buildCandidateSql } from "@/lib/marketMemory/caseQuery";
import { INDEXER_VERSION } from "@/lib/marketMemory/caseIndexer";

const fingerprint: CaseFingerprint = {
  regime: "trend",
  trend: "up",
  rangeZone: "premium",
  pullbackDepth: 0.4,
  impulseAtr: 2.5,
  volatility: 0.0012,
  session: "london",
  structureRun: 3,
};

describe("case embeddings", () => {
  it("keeps the declared dimension in lockstep with the fingerprint vector", () => {
    assert.equal(fingerprintVector(fingerprint).length, CASE_EMBEDDING_DIM);
  });

  it("renders a pgvector literal", () => {
    const literal = caseEmbeddingLiteral(fingerprint);
    assert.match(literal, /^\[[-0-9.,e]+\]$/);
    assert.equal(literal.slice(1, -1).split(",").length, CASE_EMBEDDING_DIM);
    for (const part of literal.slice(1, -1).split(",")) {
      assert.ok(Number.isFinite(Number(part)), `non-numeric component: ${part}`);
    }
  });
});

describe("candidate SQL contract", () => {
  const base = {
    symbol: "EURUSD",
    interval: "1h",
    direction: "buy" as const,
    trend: "up" as const,
  };

  it("builds the recency-ordered JS path without any vector syntax", () => {
    const { sql, args } = buildCandidateSql({ ...base, embedding: null });
    assert.ok(!sql.includes("embedding"), "the JS path must never mention the column");
    assert.ok(sql.includes("ORDER BY case_time DESC"));
    assert.ok(sql.includes("outcome IS NOT NULL"));
    assert.deepEqual(args.slice(0, 5), ["EURUSD", "1h", INDEXER_VERSION, "buy", "up"]);
    assert.equal(typeof args.at(-1), "number", "the last arg is the candidate cap");
  });

  it("builds the KNN path with the same filters and a vector ordering", () => {
    const literal = caseEmbeddingLiteral(fingerprint);
    const knn = buildCandidateSql({ ...base, embedding: literal });
    const js = buildCandidateSql({ ...base, embedding: null });

    assert.ok(knn.sql.includes("ORDER BY embedding <-> ?::vector"));
    assert.ok(knn.sql.includes("embedding IS NOT NULL"));
    // Same filters: every JS-path condition survives verbatim.
    for (const condition of [
      "symbol = ?",
      "interval = ?",
      "indexer_version = ?",
      "direction = ?",
      "outcome IS NOT NULL",
      "trend = ?",
    ]) {
      assert.ok(knn.sql.includes(condition), `KNN path lost filter: ${condition}`);
      assert.ok(js.sql.includes(condition), `JS path lost filter: ${condition}`);
    }
    // Same shape: the SELECT list is byte-identical between the paths.
    assert.equal(
      knn.sql.slice(0, knn.sql.indexOf("FROM")),
      js.sql.slice(0, js.sql.indexOf("FROM")),
    );
    // Args: identical filters, then the vector, then the cap.
    assert.deepEqual(knn.args.slice(0, 5), js.args.slice(0, 5));
    assert.equal(knn.args.at(-2), literal);
    assert.equal(knn.args.at(-1), js.args.at(-1));
  });

  it("applies the replay cutoff on both paths", () => {
    const cutoff = Date.parse("2026-01-01T00:00:00Z");
    for (const embedding of [null, caseEmbeddingLiteral(fingerprint)]) {
      const { sql, args } = buildCandidateSql({ ...base, beforeMs: cutoff, embedding });
      assert.ok(sql.includes("case_time < ?"));
      assert.ok(args.includes(cutoff));
    }
  });

  it("adapts to Postgres placeholders with the vector cast intact", () => {
    const literal = caseEmbeddingLiteral(fingerprint);
    const { sql } = buildCandidateSql({ ...base, embedding: literal });
    const adapted = adaptSql(sql, "postgres");
    assert.ok(!adapted.includes("?"), "all placeholders must be numbered");
    assert.ok(
      /ORDER BY embedding <-> \$\d+::vector/.test(adapted),
      `the vector cast must survive adaptation: ${adapted}`,
    );
  });

  it("selects the partial-stage columns on both paths", () => {
    for (const embedding of [null, caseEmbeddingLiteral(fingerprint)]) {
      const { sql } = buildCandidateSql({ ...base, embedding });
      for (const column of [
        "forming_outcome",
        "forming_bars",
        "false_break",
        "early_net_r",
        "confirmed_net_r",
      ]) {
        assert.ok(sql.includes(column), `missing column ${column}`);
      }
    }
  });
});

describe("vector support detection", () => {
  it("answers false on SQLite without touching the database", async () => {
    assert.equal(await caseVectorSearchReady(), false);
  });

  it("makes the backfill a no-op off Postgres", async () => {
    assert.equal(await backfillCaseEmbeddings(), 0);
  });
});
