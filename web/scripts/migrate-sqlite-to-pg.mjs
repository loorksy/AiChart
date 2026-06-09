#!/usr/bin/env node
/**
 * Copy all data from SQLite (DB_PATH) into PostgreSQL (DATABASE_URL).
 * Usage (from web/): node scripts/migrate-sqlite-to-pg.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
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

const TABLES_ORDER = [
  "users",
  "binance_accounts",
  "trading_settings",
  "admin_limits",
  "recommendations",
  "claude_usage",
  "trade_intents",
  "trades",
  "system_flags",
  "platform_config",
  "telegram_link_codes",
  "conversations",
  "chat_messages",
  "audit_logs",
  "scan_cooldowns",
];

const BOOL_COLS = new Set([
  "send_screenshot",
  "kill_switch",
  "onboarding_done",
  "can_execute",
  "archived",
  "plain",
]);

function normalizeValue(table, col, val) {
  if (val === null || val === undefined) return null;
  if (BOOL_COLS.has(col)) return Boolean(Number(val));
  return val;
}

async function resetSequences(client) {
  const tables = [
    "users",
    "recommendations",
    "trade_intents",
    "trades",
    "conversations",
    "chat_messages",
    "audit_logs",
  ];
  for (const t of tables) {
    await client.query(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`,
    );
  }
}

async function migrateTable(client, table) {
  const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
  if (rows.length === 0) {
    console.log(`  ${table}: 0 rows (skip)`);
    return;
  }

  const cols = Object.keys(rows[0]);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})
    ON CONFLICT DO NOTHING`;

  let inserted = 0;
  for (const row of rows) {
    const values = cols.map((c) => normalizeValue(table, c, row[c]));
    try {
      const result = await client.query(sql, values);
      inserted += result.rowCount ?? 0;
    } catch (err) {
      if (table === "users" && err.code === "23505") {
        continue;
      }
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

async function ensureSchema(client) {
  const schemaPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "pg-schema.sql",
  );
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  console.log("Ensuring PostgreSQL schema…");
  await client.query(schemaSql);
}

async function main() {
  console.log(`Source: ${sqlitePath}`);
  console.log(`Target: ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}`);
  const client = await pool.connect();
  try {
    await ensureSchema(client);
    await client.query("BEGIN");
    for (const table of TABLES_ORDER) {
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
