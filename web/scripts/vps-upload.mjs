import { Client } from "ssh2";
import fs from "fs";
import path from "path";

const password = process.env.SSH_PASS;
const local = process.argv[2];
const remote = process.argv[3];
if (!password || !local || !remote) {
  console.error("usage: SSH_PASS=... node vps-upload.mjs <local> <remote>");
  process.exit(1);
}

const conn = new Client();
conn
  .on("ready", () => {
    conn.sftp((err, sftp) => {
      if (err) process.exit(1);
      const rs = fs.createReadStream(local);
      const ws = sftp.createWriteStream(remote);
      ws.on("close", () => {
        conn.end();
        console.log(`uploaded ${local} -> ${remote}`);
      });
      rs.pipe(ws);
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
    readyTimeout: 30000,
  });
