import { Client } from "ssh2";

const password = process.env.SSH_PASS;
if (!password) {
  console.error("SSH_PASS required");
  process.exit(1);
}

const host = process.env.VPS_HOST || "72.60.83.140";
const domain = process.env.APP_DOMAIN || "aichart.lork.cloud";

const remoteCmd = `set -e
echo "==> Cron file"
CRON_FILE=/etc/cron.d/aichart
if [ -f "$CRON_FILE" ]; then
  cat "$CRON_FILE"
else
  echo "MISSING: $CRON_FILE"
  exit 1
fi
echo ""
echo "==> CRON_SECRET in .env"
cd /opt/aichart/web
CRON_SECRET=$(grep '^CRON_SECRET=' .env 2>/dev/null | cut -d= -f2- || true)
if [ -z "$CRON_SECRET" ]; then
  echo "MISSING: CRON_SECRET in /opt/aichart/web/.env"
  exit 1
fi
echo "CRON_SECRET is set (${#CRON_SECRET} chars)"
echo ""
echo "==> Test monitor endpoint"
HTTP=$(curl -sS -o /tmp/aichart-cron-test.json -w "%{http_code}" -X POST \\
  -H "Authorization: Bearer $CRON_SECRET" \\
  "https://${domain}/api/cron/monitor")
echo "HTTP $HTTP"
head -c 500 /tmp/aichart-cron-test.json; echo ""
if [ "$HTTP" != "200" ]; then
  exit 1
fi
echo "==> Cron verification OK"
`;

const conn = new Client();
conn
  .on("ready", () => {
    conn.exec(remoteCmd, (err, stream) => {
      if (err) {
        console.error(err.message);
        process.exit(1);
      }
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
    host,
    port: 22,
    username: "root",
    password,
    readyTimeout: 30000,
  });
