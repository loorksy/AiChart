import { Client } from "ssh2";

const password = process.env.SSH_PASS;
if (!password) process.exit(1);

const cmd = `set -e
cd /opt/aichart/web
set -a
source .env
set +a
export DB_PATH=data/aichart.db
export ADMIN_EMAIL=loorksy@gmail.com

echo "==> Migrate SQLite -> PostgreSQL"
node scripts/migrate-sqlite-to-pg.mjs

echo "==> Build"
npm run build

echo "==> Restart PM2"
pm2 delete aichart-web 2>/dev/null || true
PORT=3010 NODE_ENV=production pm2 start npm --name aichart-web --cwd /opt/aichart/web --update-env -- start
pm2 save

sleep 4
echo "==> Verify"
pm2 list | grep aichart || true
curl -s -o /dev/null -w "HTTPS %{http_code}\\n" https://aichart.lork.cloud/
sudo -u postgres psql -d aichart -c "SELECT id,email,role,status FROM users ORDER BY id;"
grep -E '^ADMIN_EMAIL=' .env
`;

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
