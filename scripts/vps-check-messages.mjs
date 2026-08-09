import { Client } from "ssh2";
import fs from "fs";
import path from "path";

const keyPath = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".ssh",
  "id_ed25519_aichart",
);
const password = process.env.SSH_PASS;
const privateKey = fs.existsSync(keyPath) ? fs.readFileSync(keyPath) : null;

// Query last 5 chat messages and check if they contain image metadata
const remoteCmd = `sudo -u postgres psql -d aichart -c "SELECT id, role, content, substring(metadata_json from 1 for 100) as meta_preview, length(metadata_json) as meta_len FROM chat_messages ORDER BY id DESC LIMIT 5"`;

function run() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => {
        conn.exec(remoteCmd, (err, stream) => {
          if (err) return reject(err);
          stream
            .on("close", (code) => {
              conn.end();
              if (code === 0) resolve();
              else reject(new Error(`remote exit ${code}`));
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
        ...(privateKey ? { privateKey } : { password }),
        readyTimeout: 60000,
        keepaliveInterval: 10000,
      });
  });
}

run().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
