/**
 * Copy the dedicated release-test user (+ entitlement/EA rows) into the RC DB.
 * Paths via env: PROD_ENV, RC_ENV, RELEASE_TEST_ENV
 */
import fs from "fs";
import { createRequire } from "module";

const RC_WEB = process.env.RC_WEB || "/opt/aichart-rc/web";
const require = createRequire(`${RC_WEB}/package.json`);
const pg = require("pg");

function readEnvFile(path) {
  const out = {};
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return out;
}

async function copyTable(src, dst, table, whereSql, params) {
  const { rows } = await src.query(`SELECT * FROM ${table} WHERE ${whereSql}`, params);
  if (!rows.length) return 0;
  const cols = Object.keys(rows[0]);
  await dst.query(`DELETE FROM ${table} WHERE ${whereSql}`, params);
  for (const row of rows) {
    const values = cols.map((c) => row[c]);
    const ph = cols.map((_, i) => `$${i + 1}`).join(",");
    await dst.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${ph})`, values);
  }
  return rows.length;
}

const prodUrl = readEnvFile(process.env.PROD_ENV || "/opt/aichart/web/.env").DATABASE_URL;
const relUrl = readEnvFile(process.env.RC_ENV || `${RC_WEB}/.env`).DATABASE_URL;
const secret = readEnvFile(process.env.RELEASE_TEST_ENV || "/root/.config/aichart/release-test.env");
const email = (secret.WEB_TEST_EMAIL || secret.MCP_TEST_EMAIL || "").toLowerCase();
if (!email) throw new Error("WEB_TEST_EMAIL/MCP_TEST_EMAIL missing");

const prod = new pg.Pool({ connectionString: prodUrl });
const rel = new pg.Pool({ connectionString: relUrl });
try {
  const u = await prod.query("SELECT * FROM users WHERE lower(email)=lower($1)", [email]);
  if (!u.rows.length) throw new Error("test_user_missing");
  const user = u.rows[0];
  const uid = user.id;
  const cols = Object.keys(user);
  const values = cols.map((c) => user[c]);
  const ph = cols.map((_, i) => `$${i + 1}`).join(",");
  const updates = cols
    .filter((c) => c !== "id")
    .map((c) => `${c}=EXCLUDED.${c}`)
    .join(",");
  await rel.query(
    `INSERT INTO users (${cols.join(",")}) VALUES (${ph}) ON CONFLICT (id) DO UPDATE SET ${updates}`,
    values,
  );
  await rel.query(
    "SELECT setval(pg_get_serial_sequence('users','id'), GREATEST((SELECT MAX(id) FROM users), 1))",
  );
  console.log("users_seeded=configured id=" + uid);
  console.log(
    "entitlements_seeded=" + (await copyTable(prod, rel, "user_entitlements", "user_id=$1", [uid])),
  );
  console.log(
    "trading_settings_seeded=" +
      (await copyTable(prod, rel, "trading_settings", "user_id=$1", [uid])),
  );
  console.log(
    "ea_connections_seeded=" + (await copyTable(prod, rel, "ea_connections", "user_id=$1", [uid])),
  );
} finally {
  await prod.end();
  await rel.end();
}
