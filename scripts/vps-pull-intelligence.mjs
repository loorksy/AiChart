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

echo "==> Reset to origin/main"
git fetch origin main
git checkout main
git reset --hard origin/main
echo "HEAD now: $(git rev-parse --short HEAD)"
git log -1 --oneline

echo "==> pgvector"
if [ -f web/.env ]; then
  DATABASE_URL=$(grep -E '^DATABASE_URL=' web/.env | cut -d= -f2- | tr -d '\\r')
  if [ -n "$DATABASE_URL" ]; then
    psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;" || echo "pgvector warn"
  else
    echo "DATABASE_URL empty — skip pgvector"
  fi
fi

echo "==> npm ci + build"
cd /opt/aichart/web
npm ci
npm run build

echo "==> Sync MCP workspace"
bash /opt/aichart/agent/scripts/sync-workspace.sh || true

echo "==> Restart PM2"
pm2 restart aichart-web --update-env
pm2 restart aichart-agent --update-env 2>/dev/null || echo "aichart-agent skip"
pm2 save
sleep 4

echo "==> Verify"
test -f src/lib/tradePostMortem.ts && echo "tradePostMortem.ts OK"
test -f src/lib/productModel.ts && echo "productModel.ts OK"
test -f src/lib/agent/agents/finalDecisionSynthesizer.ts && echo "canonical decision synthesizer OK"
test ! -f src/lib/committee.ts && echo "legacy committee removed OK"
test -f src/app/command/page.tsx && echo "command page OK"
curl -fsS -o /dev/null -w "HTTPS %{http_code}\\n" https://aichart.lork.cloud/
pm2 list | grep aichart || true
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
        readyTimeout: 120000,
        keepaliveInterval: 10000,
      });
  });
}

run().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
