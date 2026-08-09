import { Client } from "ssh2";

const password = process.env.SSH_PASS;
if (!password) {
  console.error("SSH_PASS required");
  process.exit(1);
}

const cmd = String.raw`set -e
echo "==> VPS status"
hostname
pm2 list | grep -E "aichart|Name" || true
test -f /opt/aichart/web/.env && grep -E '^(ADMIN_EMAIL|APP_URL)=' /opt/aichart/web/.env || echo "no env"
which psql || echo "no psql"
test -f /opt/aichart/web/data/aichart.db && ls -la /opt/aichart/web/data/aichart.db || echo "no sqlite"

echo "==> Pull latest from GitHub"
cd /opt/aichart
git fetch origin main
git checkout main
git pull --ff-only origin main || true

echo "==> Install PostgreSQL if needed"
if ! command -v psql >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-contrib
  systemctl enable postgresql
  systemctl start postgresql
fi

DB_NAME=aichart
DB_USER=aichart
DB_PASS=$(openssl rand -hex 16)
echo "==> Create PG user/db"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aichart') THEN
    CREATE ROLE aichart LOGIN PASSWORD '\${DB_PASS}';
  ELSE
    ALTER ROLE aichart WITH PASSWORD '\${DB_PASS}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE aichart OWNER aichart'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'aichart')\gexec
GRANT ALL PRIVILEGES ON DATABASE aichart TO aichart;
SQL

DATABASE_URL="postgresql://aichart:\${DB_PASS}@localhost:5432/aichart"
ENV_FILE=/opt/aichart/web/.env
touch "\$ENV_FILE"
if grep -q '^DATABASE_URL=' "\$ENV_FILE"; then
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=\${DATABASE_URL}|" "\$ENV_FILE"
else
  echo "DATABASE_URL=\${DATABASE_URL}" >> "\$ENV_FILE"
fi
if grep -q '^ADMIN_EMAIL=' "\$ENV_FILE"; then
  sed -i 's|^ADMIN_EMAIL=.*|ADMIN_EMAIL=loorksy@gmail.com|' "\$ENV_FILE"
else
  echo "ADMIN_EMAIL=loorksy@gmail.com" >> "\$ENV_FILE"
fi

echo "==> npm install + migrate"
cd /opt/aichart/web
npm install
export DATABASE_URL ADMIN_EMAIL=loorksy@gmail.com DB_PATH=data/aichart.db
if [ -f data/aichart.db ]; then
  node scripts/migrate-sqlite-to-pg.mjs
else
  echo "No SQLite file — schema will init on first app start"
fi

echo "==> Build"
npm run build

echo "==> Restart PM2"
pm2 delete aichart-web 2>/dev/null || true
cd /opt/aichart/web
PORT=3010 NODE_ENV=production pm2 start npm --name aichart-web --cwd /opt/aichart/web --update-env -- start
pm2 save

sleep 4
echo "==> Verify"
pm2 list | grep aichart || true
curl -s -o /dev/null -w "HTTPS %{http_code}\n" https://aichart.lork.cloud/
sudo -u postgres psql -d aichart -c "SELECT id,email,role,status FROM users ORDER BY id;"
`;

function run() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => {
        conn.exec(cmd, (err, stream) => {
          if (err) return reject(err);
          stream
            .on("close", (code) => {
              conn.end();
              if (code === 0) resolve();
              else reject(new Error(`exit ${code}`));
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
        password,
        readyTimeout: 30000,
      });
  });
}

run().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
