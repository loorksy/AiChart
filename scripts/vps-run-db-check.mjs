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

const remoteCmd = `sudo -u postgres psql -d aichart -c "SELECT key, CASE WHEN key LIKE '%KEY%' OR key LIKE '%TOKEN%' THEN '[SET]' ELSE value END AS val FROM platform_config"`;

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
