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
  console.error("Need SSH key or SSH_PASS");
  process.exit(1);
}

const remoteCmd = `set -e
echo "==> HEAD"
cd /opt/aichart && git rev-parse --short HEAD
echo "==> New files"
test -f web/src/hooks/useChartAnalysis.ts && echo useChartAnalysis OK
test -f infra/tradingview/bridge.py && echo bridge.py OK
echo "==> TradingView TA"
pip3 install -q --break-system-packages tradingview-ta 2>/dev/null || pip3 install -q tradingview-ta --break-system-packages
python3 /opt/aichart/infra/tradingview/bridge.py crypto BTCUSDT 1h | head -c 300
echo ""
echo "==> Enable TRADINGVIEW_MCP_ENABLED"
if grep -q '^TRADINGVIEW_MCP_ENABLED=' /opt/aichart/web/.env; then
  sed -i 's/^TRADINGVIEW_MCP_ENABLED=.*/TRADINGVIEW_MCP_ENABLED=1/' /opt/aichart/web/.env
else
  echo 'TRADINGVIEW_MCP_ENABLED=1' >> /opt/aichart/web/.env
fi
pm2 restart aichart-web --update-env
sleep 2
echo "==> Health"
curl -s -o /dev/null -w "healthz %{http_code}\\n" https://aichart.lork.cloud/api/healthz
curl -s -o /dev/null -w "readyz %{http_code}\\n" https://aichart.lork.cloud/api/readyz
curl -s -o /dev/null -w "chat %{http_code}\\n" https://aichart.lork.cloud/chat
curl -s -o /dev/null -w "market %{http_code}\\n" https://aichart.lork.cloud/market
pm2 list | grep aichart-web || true
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
