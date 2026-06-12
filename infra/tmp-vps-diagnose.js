const pg = require("pg");
const fs = require("fs");

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

function dec(val, encKey) {
  const crypto = require("crypto");
  const [iv, tag, data] = val.split(":");
  if (!data) return val;
  const d = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(encKey, "hex"),
    Buffer.from(iv, "hex"),
  );
  d.setAuthTag(Buffer.from(tag, "hex"));
  return d.update(data, "hex", "utf8") + d.final("utf8");
}

(async () => {
  const cfg = JSON.parse(fs.readFileSync("/root/.openclaw/openclaw.json", "utf8"));
  console.log("=== openclaw primary ===");
  console.log(JSON.stringify(cfg.agents?.defaults?.model, null, 2));
  console.log("=== google provider ===");
  console.log(JSON.stringify(cfg.models?.providers?.google, null, 2));

  const p = new pg.Pool({ connectionString: env.DATABASE_URL });
  const { rows } = await p.query(
    "SELECT key, value, plain FROM platform_config WHERE key IN ('AI_PROVIDER','AI_MODEL','GEMINI_API_KEY','ANTHROPIC_API_KEY','OPENROUTER_API_KEY')",
  );
  console.log("=== platform ===");
  for (const r of rows) {
    let v = r.plain ? r.value : dec(r.value, env.ENCRYPTION_KEY);
    if (r.key.includes("KEY") && v) {
      v = `${v.slice(0, 10)}…${v.slice(-4)} (len=${v.length})`;
    }
    console.log(r.key, v);
  }
  await p.end();
})();
