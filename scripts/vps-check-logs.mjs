import { Client } from "ssh2";
import fs from "fs";
import path from "path";

const keyPath = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".ssh",
  "id_ed25519_aichart",
);
const privateKey = fs.existsSync(keyPath) ? fs.readFileSync(keyPath) : null;

const remoteCmd = `
echo "=== VPS git commit ===" &&
cd /opt/aichart/web && git log --oneline -3 &&
echo "" &&
echo "=== LocaleProvider.tsx on VPS (check fix) ===" &&
tail -15 src/components/LocaleProvider.tsx &&
echo "" &&
echo "=== Clear error log and wait for fresh errors ===" &&
truncate -s 0 /root/.pm2/logs/aichart-web-error.log &&
echo "Log cleared. Waiting 20s..." &&
sleep 20 &&
echo "=== Fresh error log ===" &&
cat /root/.pm2/logs/aichart-web-error.log 2>/dev/null | head -30 || echo "(no new errors!)"
`.trim();

function run() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => {
        conn.exec(remoteCmd, (err, stream) => {
          if (err) return reject(err);
          stream
            .on("close", () => { conn.end(); resolve(); })
            .on("data", (d) => process.stdout.write(d))
            .stderr.on("data", (d) => process.stderr.write(d));
        });
      })
      .on("error", reject)
      .connect({
        host: "72.60.83.140",
        port: 22,
        username: "root",
        ...(privateKey ? { privateKey } : {}),
        readyTimeout: 60000,
        keepaliveInterval: 10000,
      });
  });
}

run().catch((e) => { console.error(e.message || e); process.exit(1); });
