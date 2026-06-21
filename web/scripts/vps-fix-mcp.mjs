import { Client } from "ssh2";
import fs from "fs";
import path from "path";

const keyPath = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".ssh",
  "id_ed25519_aichart",
);
const privateKey = fs.existsSync(keyPath) ? fs.readFileSync(keyPath) : null;

// Deep fix: remove and reinstall better-sqlite3 with node-gyp
const remoteCmd = `
cd /opt/aichart/mcp &&
echo "=== Node version: $(node --version) ===" &&
echo "=== Removing old better-sqlite3 ===" &&
rm -rf node_modules/better-sqlite3 node_modules/bindings &&
echo "=== Reinstalling better-sqlite3 ===" &&
npm install better-sqlite3 --build-from-source 2>&1 | tail -20 &&
echo "=== Checking build output ===" &&
ls node_modules/better-sqlite3/build/Release/ 2>/dev/null || echo "(no Release dir)" &&
echo "=== Restarting MCP ===" &&
pm2 restart aichart-mcp &&
sleep 5 &&
echo "=== PM2 list ===" &&
pm2 list &&
echo "=== Recent MCP error ===" &&
tail -5 /root/.pm2/logs/aichart-mcp-error.log 2>/dev/null || echo "No errors!"
`.trim();

function run() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => {
        console.log("SSH connected. Reinstalling better-sqlite3...");
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
        readyTimeout: 120000,
        keepaliveInterval: 10000,
      });
  });
}

run().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
