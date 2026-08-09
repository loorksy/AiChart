import { Client } from "ssh2";
import fs from "fs";
import path from "path";

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

const cmd = process.argv[2];
if (!cmd) {
  console.error("usage: node ssh-remote.mjs '<shell command>'");
  process.exit(1);
}

const conn = new Client();
conn
  .on("ready", () => {
    conn.exec(cmd, (err, stream) => {
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
    ...(privateKey ? { privateKey } : { password }),
    readyTimeout: 30000,
  });
