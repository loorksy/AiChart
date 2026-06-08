import { Client } from "ssh2";

const password = process.env.SSH_PASS;
if (!password) {
  console.error("SSH_PASS required");
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
    password,
    readyTimeout: 30000,
  });
