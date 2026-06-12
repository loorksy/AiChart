const pg = require("pg");
const fs = require("fs");
const crypto = require("crypto");

const env = Object.fromEntries(
  fs
    .readFileSync("/opt/aichart/web/.env", "utf8")
    .split(/\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

(async () => {
  const p = new pg.Pool({ connectionString: env.DATABASE_URL });
  await p.query(
    `INSERT INTO platform_config (key, value, plain, updated_at)
     VALUES ('AI_MODEL', 'gemini-2.5-flash', 1, NOW())
     ON CONFLICT(key) DO UPDATE SET value = 'gemini-2.5-flash', plain = 1, updated_at = NOW()`,
  );
  console.log("AI_MODEL -> gemini-2.5-flash");
  await p.end();
})();
