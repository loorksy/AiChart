import { Client } from "ssh2";
import fs from "fs";
import path from "path";

const keyPath = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".ssh",
  "id_ed25519_aichart",
);
const privateKey = fs.readFileSync(keyPath);
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "../..");

const uploads = [
  ["web/src/lib/markets/forexDataSource.ts", "/opt/aichart/web/src/lib/markets/forexDataSource.ts"],
  ["web/src/lib/ohlc/fetchOhlc.ts", "/opt/aichart/web/src/lib/ohlc/fetchOhlc.ts"],
  ["web/src/app/api/market/klines/route.ts", "/opt/aichart/web/src/app/api/market/klines/route.ts"],
  ["web/src/app/api/instruments/route.ts", "/opt/aichart/web/src/app/api/instruments/route.ts"],
  ["web/src/components/SmartChartWorkspace.tsx", "/opt/aichart/web/src/components/SmartChartWorkspace.tsx"],
  ["web/src/app/api/agent/chart/layout/route.ts", "/opt/aichart/web/src/app/api/agent/chart/layout/route.ts"],
  ["web/src/app/api/agent/market/analyze/route.ts", "/opt/aichart/web/src/app/api/agent/market/analyze/route.ts"],
  ["web/src/app/api/agent/market/ohlc/route.ts", "/opt/aichart/web/src/app/api/agent/market/ohlc/route.ts"],
  ["mcp/src/lib/forexSymbol.ts", "/opt/aichart/mcp/src/lib/forexSymbol.ts"],
  ["mcp/src/tools/charts.ts", "/opt/aichart/mcp/src/tools/charts.ts"],
  ["mcp/src/tools/market.ts", "/opt/aichart/mcp/src/tools/market.ts"],
  ["mcp/src/ui/widgets.ts", "/opt/aichart/mcp/src/ui/widgets.ts"],
];

const remoteCmd = `
set -euo pipefail
ENV=/opt/aichart/web/.env
if grep -q '^FOREX_DATA_SOURCE=' "$ENV"; then
  sed -i 's|^FOREX_DATA_SOURCE=.*|FOREX_DATA_SOURCE=oanda|' "$ENV"
else
  echo 'FOREX_DATA_SOURCE=oanda' >> "$ENV"
fi
grep FOREX_DATA_SOURCE "$ENV"

cd /opt/aichart/web
node --input-type=module <<'NODE'
import fs from "fs";
import pg from "pg";
const env = fs.readFileSync(".env", "utf8");
const dbUrl = env.match(/^DATABASE_URL=(.*)$/m)?.[1];
if (!dbUrl) { console.log("no DATABASE_URL"); process.exit(0); }
const client = new pg.Client({ connectionString: dbUrl });
await client.connect();
const { rows } = await client.query(
  "SELECT id, state_json FROM chart_layouts WHERE state_json IS NOT NULL AND state_json <> ''"
);
let layoutsUpdated = 0;
for (const row of rows) {
  try {
    const state = JSON.parse(row.state_json);
    let dirty = false;
    if (state.dataSource === "ea") {
      state.dataSource = "oanda";
      dirty = true;
    }
    if (dirty) {
      await client.query(
        "UPDATE chart_layouts SET state_json = $1, updated_at = NOW() WHERE id = $2",
        [JSON.stringify(state), row.id]
      );
      layoutsUpdated++;
    }
  } catch { /* skip invalid json */ }
}
const symRows = await client.query("SELECT id, symbol FROM chart_layouts");
let symbolsUpdated = 0;
for (const row of symRows.rows) {
  const raw = String(row.symbol || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const canon = raw.length >= 6 ? raw.slice(0, 6) : raw;
  if (canon && canon !== row.symbol) {
    await client.query(
      "UPDATE chart_layouts SET symbol = $1, updated_at = NOW() WHERE id = $2",
      [canon, row.id]
    );
    symbolsUpdated++;
  }
}
console.log("chart_layouts state updated:", layoutsUpdated, "symbols:", symbolsUpdated);
await client.end();
NODE

echo "==> build web"
npm run build

echo "==> build mcp"
cd /opt/aichart/mcp
npm run build

pm2 restart aichart-web aichart-mcp --update-env
pm2 save

echo "==> smoke oanda klines"
cd /opt/aichart/web
node scripts/vps-test-oanda.mjs
`;

function upload(sftp, localRel, remote) {
  return new Promise((resolve, reject) => {
    const local = path.join(repo, localRel);
    const rs = fs.createReadStream(local);
    const ws = sftp.createWriteStream(remote);
    ws.on("close", resolve);
    ws.on("error", reject);
    rs.pipe(ws);
  });
}

const conn = new Client();
conn
  .on("ready", () => {
    conn.sftp(async (err, sftp) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      try {
        await new Promise((resolve, reject) => {
          conn.exec("mkdir -p /opt/aichart/mcp/src/lib", (eMk, stream) => {
            if (eMk) return reject(eMk);
            stream.on("close", (code) =>
              code === 0 ? resolve() : reject(new Error(`mkdir exit ${code}`)),
            );
          });
        });
        for (const [local, remote] of uploads) {
          await upload(sftp, local, remote);
          console.log("uploaded", local);
        }
        conn.exec(remoteCmd, (e2, stream) => {
          if (e2) {
            console.error(e2);
            process.exit(1);
          }
          stream.on("data", (d) => process.stdout.write(d));
          stream.stderr.on("data", (d) => process.stderr.write(d));
          stream.on("close", (code) => {
            conn.end();
            process.exit(code ?? 0);
          });
        });
      } catch (e) {
        console.error(e);
        process.exit(1);
      }
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
    privateKey,
    readyTimeout: 120000,
  });
