import { Client } from "ssh2";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const password = process.env.SSH_PASS;
const pubKeyPath =
  process.env.SSH_PUBKEY ||
  path.join(process.env.USERPROFILE || process.env.HOME || "", ".ssh", "id_ed25519_aichart.pub");

if (!password) {
  console.error("SSH_PASS required");
  process.exit(1);
}
if (!fs.existsSync(pubKeyPath)) {
  console.error(`missing pubkey: ${pubKeyPath}`);
  process.exit(1);
}

const pubKey = fs.readFileSync(pubKeyPath, "utf8").trim();
const cmd = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && grep -qxF '${pubKey.replace(/'/g, "'\\''")}' ~/.ssh/authorized_keys 2>/dev/null || echo '${pubKey.replace(/'/g, "'\\''")}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo KEY_INSTALLED_OK`;

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
    password,
    readyTimeout: 60000,
  });
