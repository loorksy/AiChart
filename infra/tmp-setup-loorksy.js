#!/usr/bin/env node
/** One-off: ensure operator account for MCP. Run on VPS from /opt/aichart/web */
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const EMAIL = "loorksy@gmail.com";
const PASS = process.argv[2] || "ahmetlork0009";

function loadDatabaseUrl() {
  const envPath = path.join(__dirname, "../web/.env");
  const raw = fs.readFileSync(envPath, "utf8");
  const m = raw.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error("DATABASE_URL missing in .env");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

async function main() {
  const pool = new Pool({ connectionString: loadDatabaseUrl() });
  const hash = bcrypt.hashSync(PASS, 10);
  const email = EMAIL.toLowerCase();

  const before = await pool.query(
    "SELECT id, email, role, status, access_expires_at, username FROM users WHERE email = $1",
    [email],
  );
  console.log("before:", before.rows[0] || null);

  if (before.rows[0]) {
    await pool.query(
      `UPDATE users SET password_hash = $1, role = 'admin', status = 'active',
       access_expires_at = NOW() + INTERVAL '365 days',
       username = COALESCE(username, 'loorksy')
       WHERE email = $2`,
      [hash, email],
    );
  } else {
    await pool.query(
      `INSERT INTO users (email, password_hash, role, status, access_expires_at, username)
       VALUES ($1, $2, 'admin', 'active', NOW() + INTERVAL '365 days', 'loorksy')`,
      [email, hash],
    );
  }

  const userId = (
    await pool.query("SELECT id FROM users WHERE email = $1", [email])
  ).rows[0].id;

  // Ensure default settings row exists
  await pool.query(
    `INSERT INTO trading_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  ).catch(() => {});

  const after = await pool.query(
    "SELECT id, email, role, status, access_expires_at, username FROM users WHERE email = $1",
    [email],
  );
  console.log("after:", after.rows[0]);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
