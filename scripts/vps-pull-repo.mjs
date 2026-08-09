import { Client } from "ssh2";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const keyPath = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".ssh",
  "id_ed25519_aichart",
);
const outTar = path.join(repoRoot, ".vps-repo-pull.tgz");

if (!fs.existsSync(keyPath)) {
  console.error(`missing private key: ${keyPath}`);
  process.exit(1);
}

const inspectCmd = `set -e
cd /opt/aichart
echo "=== VPS git ==="
git rev-parse --short HEAD 2>/dev/null || echo no-git
git log -1 --oneline 2>/dev/null || true
git status -sb 2>/dev/null || true
echo "=== Key files ==="
ls -la web/src/lib/tradeClose.ts docs/SUGGESTIONS_FEASIBLE.md web/scripts/vps-sync-build.mjs 2>&1 || true
`;

const tarCmd = `cd /opt/aichart && tar -czf - \
  --exclude=web/node_modules \
  --exclude=web/.next \
  --exclude=web/data \
  --exclude='web/.env' \
  --exclude='.git/objects/pack' \
  .`;

function connect() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => resolve(conn))
      .on("error", reject)
      .connect({
        host: "72.60.83.140",
        port: 22,
        username: "root",
        privateKey: fs.readFileSync(keyPath),
        readyTimeout: 60000,
        keepaliveInterval: 10000,
      });
  });
}

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = "";
      stream
        .on("close", (code) => {
          if (code === 0) resolve(out);
          else reject(new Error(`exit ${code}: ${out}`));
        })
        .on("data", (d) => {
          process.stdout.write(d);
          out += d;
        })
        .stderr.on("data", (d) => process.stderr.write(d));
    });
  });
}

function downloadTar(conn) {
  return new Promise((resolve, reject) => {
    conn.exec(tarCmd, (err, stream) => {
      if (err) return reject(err);
      const ws = fs.createWriteStream(outTar);
      let stderr = "";
      stream.stderr.on("data", (d) => {
        stderr += d;
        process.stderr.write(d);
      });
      stream.pipe(ws);
      ws.on("finish", () => {
        if (stderr.trim()) reject(new Error(stderr));
        else resolve();
      });
      ws.on("error", reject);
      stream.on("close", (code) => {
        if (code !== 0) reject(new Error(`tar exit ${code}`));
      });
    });
  });
}

async function main() {
  const conn = await connect();
  console.log("==> VPS inspect");
  await exec(conn, inspectCmd);
  console.log("\n==> Download repo tarball");
  await downloadTar(conn);
  conn.end();

  const sizeMb = (fs.statSync(outTar).size / 1024 / 1024).toFixed(2);
  console.log(`\n==> Downloaded ${outTar} (${sizeMb} MB)`);
  console.log("==> Extract into repo (preserving local web/.env if any)");
  const envBackup = path.join(repoRoot, "web", ".env");
  let envTmp = null;
  if (fs.existsSync(envBackup)) {
    envTmp = path.join(repoRoot, "web", ".env.local-backup");
    fs.copyFileSync(envBackup, envTmp);
  }

  execSync(`tar -xzf "${outTar}" -C "${repoRoot}"`, { stdio: "inherit" });

  if (envTmp && fs.existsSync(envTmp)) {
    fs.copyFileSync(envTmp, envBackup);
    fs.unlinkSync(envTmp);
  }
  fs.unlinkSync(outTar);
  console.log("==> Done — review git diff then commit/push");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
