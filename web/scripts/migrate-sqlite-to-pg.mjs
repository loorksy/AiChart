#!/usr/bin/env node
/**
 * Copy all data from SQLite (DB_PATH) into PostgreSQL (DATABASE_URL).
 * Usage (from web/): node scripts/migrate-sqlite-to-pg.mjs
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import pg from "pg";

const { Pool } = pg;

const DB_PATH = process.env.DB_PATH || "data/aichart.db";
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sqlitePath = path.resolve(process.cwd(), DB_PATH);
if (!fs.existsSync(sqlitePath)) {
  console.error(`SQLite file not found: ${sqlitePath}`);
  process.exit(1);
}

const sqlite = new Database(sqlitePath, { readonly: true });
const pool = new Pool({ connectionString: DATABASE_URL });

// FK-safe order for parent tables; any other table in the SQLite DB is migrated
// afterwards automatically (discovered dynamically), so the list never drifts
// out of date as the schema grows.
const PRIORITY_ORDER = [
  "users",
  "platform_config",
  "system_flags",
  "dynamic_pages",
  "binance_accounts",
  "trading_settings",
  "admin_limits",
  "scalp_sessions",
  "claude_usage",
  "mt_accounts",
  "ea_connections",
  "ea_commands",
  "ea_market_cache",
  "recommendations",
  "trade_intents",
  "trades",
  "trade_lessons",
  "conversations",
  "chat_messages",
  "copilot_events",
  "semantic_memories",
  "audit_logs",
  "scan_cooldowns",
  "alert_log",
  "idempotency_keys",
  "telegram_link_codes",
  "telegram_pending",
  "mcp_oauth_clients",
  "mcp_oauth_refresh_tokens",
];

// Ephemeral/runtime-only tables that must NOT be copied across.
const SKIP_TABLES = new Set(["locks"]);

// Resolved from the target's information_schema so booleans (PG) coming from
// integers (SQLite) are coerced correctly without a brittle hand-maintained list.
const pgColumns = new Map(); // table -> Map<col, dataType>

async function loadPgColumns(client) {
  const res = await client.query(
    `SELECT table_name, column_name, data_type
     FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  for (const r of res.rows) {
    if (!pgColumns.has(r.table_name)) pgColumns.set(r.table_name, new Map());
    pgColumns.get(r.table_name).set(r.column_name, r.data_type);
  }
}

function discoverSqliteTables() {
  const rows = sqlite
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    )
    .all();
  const names = rows.map((r) => r.name).filter((n) => !SKIP_TABLES.has(n));
  const ordered = PRIORITY_ORDER.filter((t) => names.includes(t));
  const rest = names.filter((t) => !PRIORITY_ORDER.includes(t)).sort();
  return [...ordered, ...rest];
}

function normalizeValue(dataType, val) {
  if (val === null || val === undefined) return null;
  if (dataType === "boolean") return Boolean(Number(val));
  return val;
}

async function resetSequences(client) {
  for (const [table, cols] of pgColumns) {
    if (!cols.has("id")) continue;
    await client
      .query(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'),
                COALESCE((SELECT MAX(id) FROM ${table}), 1))`,
      )
      .catch(() => {}); // tables without a serial id sequence are fine to skip
  }
}

async function migrateTable(client, table) {
  const target = pgColumns.get(table);
  if (!target) {
    console.log(`  ${table}: not in target schema (skip)`);
    return;
  }
  const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
  if (rows.length === 0) {
    console.log(`  ${table}: 0 rows (skip)`);
    return;
  }

  // Only migrate columns that exist in BOTH sides (handles backend drift such
  // as SQLite's embedding_json vs Postgres' native vector column).
  const cols = Object.keys(rows[0]).filter((c) => target.has(c));
  if (cols.length === 0) {
    console.log(`  ${table}: no overlapping columns (skip)`);
    return;
  }
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})
    ON CONFLICT DO NOTHING`;

  let inserted = 0;
  for (const row of rows) {
    const values = cols.map((c) => normalizeValue(target.get(c), row[c]));
    try {
      const result = await client.query(sql, values);
      inserted += result.rowCount ?? 0;
    } catch (err) {
      if (err.code === "23505") continue; // duplicate — already migrated
      console.error(`  Error inserting into ${table}:`, err.message);
      throw err;
    }
  }
  console.log(`  ${table}: ${rows.length} source rows, ${inserted} inserted`);
}

async function promoteAdmin(client) {
  const adminEmail = (process.env.ADMIN_EMAIL || "loorksy@gmail.com").toLowerCase();
  await client.query(
    "UPDATE users SET role = 'admin', status = 'active' WHERE email = $1",
    [adminEmail],
  );
  const r = await client.query("SELECT id FROM users WHERE email = $1", [
    adminEmail,
  ]);
  if (r.rows[0]) {
    const userId = r.rows[0].id;
    await client.query(
      "INSERT INTO trading_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
      [userId],
    );
    await client.query(
      `INSERT INTO admin_limits (user_id, can_execute) VALUES ($1, TRUE)
       ON CONFLICT (user_id) DO UPDATE SET can_execute = TRUE`,
      [userId],
    );
    console.log(`  Promoted admin: ${adminEmail} (id=${userId})`);
  }
}

async function ensureSchemaReady(client) {
  // The authoritative schema is created by the app itself (initPg + migratePg).
  // Requiring it here avoids the historical drift of a hand-maintained
  // pg-schema.sql that lagged behind the live schema.
  const probes = ["users", "semantic_memories", "mt_accounts", "trade_lessons"];
  for (const t of probes) {
    const r = await client.query(`SELECT to_regclass($1) AS reg`, [
      `public.${t}`,
    ]);
    if (!r.rows[0]?.reg) {
      throw new Error(
        `Target schema not initialized (missing table "${t}").\n` +
          `Start the AiChart app once with DATABASE_URL set so it auto-creates ` +
          `the full schema, then re-run this migration.`,
      );
    }
  }
}

async function main() {
  console.log(`Source: ${sqlitePath}`);
  console.log(`Target: ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}`);
  const client = await pool.connect();
  try {
    await ensureSchemaReady(client);
    await loadPgColumns(client);
    const tables = discoverSqliteTables();
    console.log(`Migrating ${tables.length} tables…`);
    await client.query("BEGIN");
    for (const table of tables) {
      await migrateTable(client, table);
    }
    await resetSequences(client);
    await promoteAdmin(client);
    await client.query("COMMIT");
    console.log("Migration complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

main();
