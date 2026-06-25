/** SSH to VPS and install /etc/cron.d/aichart from infra/aichart.cron */
import { Client } from "ssh2";
import fs from "fs";
import path from "path";

const keyPath = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".ssh",
  "id_ed25519_aichart",
);
const privateKey = fs.existsSync(keyPath) ? fs.readFileSync(keyPath) : null;

const script = `
set -e
cd /opt/aichart
CRON_SECRET=$(grep '^CRON_SECRET=' web/.env | cut -d= -f2-)
sed -e 's|YOUR_DOMAIN|aichart.lork.cloud|g' -e "s|YOUR_CRON_SECRET|\${CRON_SECRET}|g" infra/aichart.cron > /etc/cron.d/aichart
chmod 644 /etc/cron.d/aichart
echo "cron lines: $(wc -l < /etc/cron.d/aichart)"
grep cron/bots /etc/cron.d/aichart || echo "WARN: bots cron missing"
curl -sS -X POST -H "Authorization: Bearer \${CRON_SECRET}" https://aichart.lork.cloud/api/cron/bots
echo ""
PGPASSWORD=$(grep DATABASE_URL web/.env | sed 's/.*:\\([^@]*\\)@.*/\\1/') psql -h 127.0.0.1 -U aichart -d aichart -t -c "SELECT id,status,substring(state_json,1,80) FROM bot_sessions WHERE status='active';"
`.trim();

const conn = new Client();
conn
  .on("ready", () => {
    conn.exec(script, (err, stream) => {
      if (err) process.exit(1);
      stream
        .on("close", (code) => {
          conn.end();
          process.exit(code ?? 0);
        })
        .on("data", (d) => process.stdout.write(d))
        .stderr.on("data", (d) => process.stderr.write(d));
    });
  })
  .on("error", (e) => {
    console.error(e.message);
    process.exit(1);
  })
  .connect({
    host: "72.60.83.140",
    port: 22,
    username: "root",
    privateKey,
  });
