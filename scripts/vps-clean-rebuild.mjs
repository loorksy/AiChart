import { Client } from "ssh2";
import fs from "fs";
import path from "path";

const keyPath = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".ssh",
  "id_ed25519_aichart",
);
const privateKey = fs.existsSync(keyPath) ? fs.readFileSync(keyPath) : null;

// Force a full clean rebuild and restart
const remoteCmd = `
echo "=== Git status ===" &&
cd /opt/aichart/web &&
git log --oneline -5 &&
echo "=== Cleaning .next cache ===" &&
rm -rf .next &&
echo "=== Building ===" &&
npm run build 2>&1 | tail -20 &&
echo "=== Restarting PM2 ===" &&
pm2 restart aichart-web &&
echo "=== Done ==="
`.trim();

function run() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => {
        console.log("SSH connected. Running clean rebuild...");
        conn.exec(remoteCmd, (err, stream) => {
          if (err) return reject(err);
          stream
            .on("close", () => {
              conn.end();
              resolve();
            })
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

run().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
