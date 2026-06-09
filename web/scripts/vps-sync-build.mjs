import { Client } from "ssh2";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const password = process.env.SSH_PASS;
if (!password) {
  console.error("SSH_PASS required");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, "..");
const tarball = path.join(webDir, ".deploy-src.tgz");

execSync(`tar -czf "${tarball}" -C "${webDir}" src`, { stdio: "inherit" });

const remoteCmd = `set -e
cd /opt/aichart/web
echo "==> Extract src"
tar -xzf /tmp/aichart-deploy-src.tgz
echo "==> Build"
npm run build
echo "==> Restart PM2"
pm2 restart aichart-web --update-env || (
  PORT=3010 NODE_ENV=production pm2 start npm --name aichart-web --cwd /opt/aichart/web --update-env -- start
)
pm2 save
sleep 3
curl -s -o /dev/null -w "HTTPS %{http_code}\\n" https://aichart.lork.cloud/
pm2 list | grep aichart || true
echo "==> Cron check"
CRON_SECRET=$(grep '^CRON_SECRET=' .env 2>/dev/null | cut -d= -f2- || true)
if [ -n "$CRON_SECRET" ]; then
  CRON_FILE=/etc/cron.d/aichart
  if [ ! -f "$CRON_FILE" ]; then
    cat > "$CRON_FILE" <<CRON
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
*/15 * * * * root curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" https://aichart.lork.cloud/api/cron/monitor >/dev/null 2>&1
0 20 * * * root curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" https://aichart.lork.cloud/api/cron/daily-summary >/dev/null 2>&1
CRON
    chmod 644 "$CRON_FILE"
    echo "Cron installed at $CRON_FILE"
  else
    echo "Cron already exists"
  fi
else
  echo "CRON_SECRET not in .env — skip cron install"
fi
echo "==> Done"
`;

function uploadAndDeploy() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => {
        conn.sftp((err, sftp) => {
          if (err) return reject(err);
          const rs = fs.createReadStream(tarball);
          const ws = sftp.createWriteStream("/tmp/aichart-deploy-src.tgz");
          ws.on("close", () => {
            conn.exec(remoteCmd, (e2, stream) => {
              if (e2) return reject(e2);
              stream
                .on("close", (code) => {
                  conn.end();
                  try {
                    fs.unlinkSync(tarball);
                  } catch {
                    /* ignore */
                  }
                  if (code === 0) resolve();
                  else reject(new Error(`remote exit ${code}`));
                })
                .on("data", (d) => process.stdout.write(d))
                .stderr.on("data", (d) => process.stderr.write(d));
            });
          });
          ws.on("error", reject);
          rs.pipe(ws);
        });
      })
      .on("error", reject)
      .connect({
        host: "72.60.83.140",
        port: 22,
        username: "root",
        password,
        readyTimeout: 30000,
      });
  });
}

uploadAndDeploy().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
