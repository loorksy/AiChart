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
if (!privateKey && !password) {
  console.error("Need ~/.ssh/id_ed25519_aichart or SSH_PASS");
  process.exit(1);
}

const remoteCmd = `set -e
echo "==> Before"
cd /opt/aichart
git rev-parse --short HEAD || true
git status -sb || true

echo "==> Sync with GitHub origin/main"
git fetch origin main
git checkout main
git reset --hard origin/main
echo "HEAD now: $(git rev-parse --short HEAD)"
git log -1 --oneline

echo "==> Stop web before build (avoid ChunkLoadError)"
pm2 stop aichart-web 2>/dev/null || true

echo "==> npm install + build"
cd /opt/aichart/web
rm -rf .next
npm install
npm run build

echo "==> Start PM2"
pm2 start aichart-web --update-env || (
  PORT=3010 NODE_ENV=production pm2 start npm --name aichart-web --cwd /opt/aichart/web --update-env -- start
)
pm2 save
sleep 3

echo "==> Verify"
pm2 list | grep aichart || true
curl -s -o /dev/null -w "HTTPS %{http_code}\\n" https://aichart.lork.cloud/
test -f /opt/aichart/web/src/lib/tradeClose.ts && echo "tradeClose.ts OK"
test -f /opt/aichart/docs/SUGGESTIONS_FEASIBLE.md && echo "docs OK"
test -f /opt/aichart/web/scripts/vps-sync-build.mjs && echo "scripts OK"
echo "==> Done"
`;

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
