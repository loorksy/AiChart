import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const TELEGRAM_ID = Number(process.argv[2] || "5969744996");
const WEB_DIR = process.env.WEB_DIR || "/opt/aichart/web";
const require = createRequire(path.join(WEB_DIR, "package.json"));
const pg = require("pg");

for (const line of fs.readFileSync(path.join(WEB_DIR, ".env"), "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq < 0) continue;
  const key = trimmed.slice(0, eq);
  let val = trimmed.slice(eq + 1);
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1);
  }
  if (process.env[key] === undefined) process.env[key] = val;
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const before = await client.query(
  "SELECT id, email, role, telegram_id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1",
);
console.log("admin before:", before.rows[0] ?? null);

await client.query(
  `UPDATE users SET telegram_id = NULL
   WHERE telegram_id = $1
     AND id != (SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1)`,
  [TELEGRAM_ID],
);

await client.query(
  `UPDATE users SET telegram_id = $1
   WHERE id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1)`,
  [TELEGRAM_ID],
);

await client.query(
  `INSERT INTO trading_settings (user_id, telegram_chat_id, updated_at)
   SELECT id, $1::text, NOW()
   FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1
   ON CONFLICT (user_id) DO UPDATE
   SET telegram_chat_id = EXCLUDED.telegram_chat_id, updated_at = NOW()`,
  [String(TELEGRAM_ID)],
);

const after = await client.query(
  `SELECT u.id, u.email, u.role, u.telegram_id, ts.telegram_chat_id
   FROM users u
   LEFT JOIN trading_settings ts ON ts.user_id = u.id
   WHERE u.role = 'admin'
   ORDER BY u.id ASC LIMIT 1`,
);
console.log("admin after:", after.rows[0] ?? null);

const lookup = await client.query(
  "SELECT id, email, role FROM users WHERE telegram_id = $1",
  [TELEGRAM_ID],
);
console.log("lookup by telegram_id:", lookup.rows[0] ?? null);

await client.end();
console.log(`Done: linked telegram_id=${TELEGRAM_ID} to admin.`);
