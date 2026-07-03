import { Client } from "ssh2";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const keyPath = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".ssh",
  "id_ed25519_aichart",
);
const privateKey = fs.existsSync(keyPath) ? fs.readFileSync(keyPath) : null;
const password = process.env.SSH_PASS;

if (!password && !privateKey) {
  console.error("SSH_PASS or id_ed25519_aichart required");
  process.exit(1);
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node vps-download.mjs <remote-path>...");
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, "..", "..");

const conn = new Client();
conn
  .on("ready", () => {
    conn.sftp((err, sftp) => {
      if (err) {
        console.error(err.message);
        process.exit(1);
      }

      let pending = files.length;
      for (const remote of files) {
        const rel = remote.replace(/^\//, "");
        const local = path.join(repoRoot, rel);
        fs.mkdirSync(path.dirname(local), { recursive: true });
        sftp.fastGet(`/opt/aichart/${rel}`, local, (getErr) => {
          if (getErr) console.error(`FAIL ${remote}: ${getErr.message}`);
          else console.log(`OK ${remote}`);
          if (--pending === 0) conn.end();
        });
      }
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
    ...(privateKey ? { privateKey } : { password }),
    readyTimeout: 30000,
  });
