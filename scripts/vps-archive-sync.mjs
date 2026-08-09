import { Client } from "ssh2";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const password = process.env.SSH_PASS;
if (!password) { console.error("SSH_PASS required"); process.exit(1); }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tarball = path.join(__dirname, "..", ".deploy-full.tgz");
if (!fs.existsSync(tarball)) { console.error("missing tarball"); process.exit(1); }

const remoteCmd = `set -e
echo "==> Backup web/.env"
ENV_BAK=""
if [ -f /opt/aichart/web/.env ]; then
  ENV_BAK=$(mktemp)
  cp /opt/aichart/web/.env "$ENV_BAK"
  echo "env backed up"
fi

echo "==> Extract archive"
mkdir -p /opt/aichart
tar -xzf /tmp/aichart-full.tgz -C /opt/aichart

if [ -n "$ENV_BAK" ] && [ -f "$ENV_BAK" ]; then
  cp "$ENV_BAK" /opt/aichart/web/.env
  rm -f "$ENV_BAK"
  echo "env restored"
fi

cd /opt/aichart
echo "HEAD now: $(git rev-parse --short HEAD 2>/dev/null || echo 'no-git')"
if [ -d .git ]; then
  git rev-parse --short HEAD
  git log -1 --oneline
else
  echo "archive deploy (no .git in archive)"
fi

echo "==> npm install + build"
cd /opt/aichart/web
npm install
npm run build

echo "==> Restart PM2"
pm2 restart aichart-web --update-env || (
  PORT=3010 NODE_ENV=production pm2 start npm --name aichart-web --cwd /opt/aichart/web --update-env -- start
)
pm2 save
sleep 3

echo "==> Verify"
pm2 list | grep aichart || true
curl -s -o /dev/null -w "HTTPS %{http_code}\\n" https://aichart.lork.cloud/
test -f /opt/aichart/web/src/lib/tradeClose.ts && echo "tradeClose.ts OK" || echo "tradeClose.ts MISSING"
test -f /opt/aichart/docs/SUGGESTIONS_FEASIBLE.md && echo "docs OK" || echo "docs MISSING"
echo "==> Done"
`;

function connectAndDeploy() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => {
        conn.sftp((err, sftp) => {
          if (err) return reject(err);
          const rs = fs.createReadStream(tarball);
          const ws = sftp.createWriteStream("/tmp/aichart-full.tgz");
          ws.on("error", reject);
          rs.on("error", reject);
          ws.on("close", () => {
            console.log("uploaded tarball");
            conn.exec(remoteCmd, (e2, stream) => {
              if (e2) return reject(e2);
              stream
                .on("close", (code) => {
                  conn.end();
                  if (code === 0) resolve();
                  else reject(new Error(`remote exit ${code}`));
                })
                .on("data", (d) => process.stdout.write(d))
                .stderr.on("data", (d) => process.stderr.write(d));
            });
          });
          rs.pipe(ws);
        });
      })
      .on("error", reject)
      .connect({
        host: "72.60.83.140",
        port: 22,
        username: "root",
        password,
        readyTimeout: 120000,
        keepaliveInterval: 10000,
        tryKeyboard: true,
      });
  });
}

async function main() {
  const max = 5;
  for (let i = 1; i <= max; i++) {
    console.log(`Attempt ${i}/${max}`);
    try {
      await connectAndDeploy();
      console.log("SUCCESS");
      process.exit(0);
    } catch (e) {
      console.error(e.message || e);
      if (i < max) await new Promise((r) => setTimeout(r, 5000 * i));
    }
  }
  process.exit(1);
}
main();
