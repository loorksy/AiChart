#!/usr/bin/env bash
# Lonora runtime pieces that a plain `npm run build` does not create.
#
# Fills missing keys in $INSTALL_DIR/.env (never overwrites a value already
# set), starts the chart-host container on 127.0.0.1:8788, and inserts
# CHART_HOST_URL into platform_config when that table exists.
#
# Touches only /opt/aichart/.env, the docker container named chart-host,
# and the aichart database row CHART_HOST_URL. Does not restart pm2 and
# does not edit other Traefik files or other containers.
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/aichart}"
ENV_FILE="$INSTALL_DIR/.env"
CHART_HOST_PUBLISH_PORT="${CHART_HOST_PUBLISH_PORT:-8788}"
IMAGE="aichart-chart-host"

log() { echo "[aichart-runtime] $*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root" >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "FATAL: $ENV_FILE is missing. Run infra/vps-fresh-install.sh first." >&2
  exit 1
fi

python3 - "$ENV_FILE" "$CHART_HOST_PUBLISH_PORT" <<'PY'
import secrets, sys
from pathlib import Path
path, chart_port = sys.argv[1], sys.argv[2]
p = Path(path)
lines = p.read_text().splitlines()
vals = {}
order = []
for line in lines:
    if not line or line.startswith("#") or "=" not in line:
        order.append(("raw", line))
        continue
    k, v = line.split("=", 1)
    vals[k] = v
    order.append(("kv", k))

def strip_quotes(value):
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        return value[1:-1].strip()
    return value

def empty(key):
    return not strip_quotes(vals.get(key, ""))

added = []
def set_if_empty(key, value):
    if empty(key):
        vals[key] = value
        added.append(key)

port = strip_quotes(vals.get("PORT", "")) or "3010"
set_if_empty("AICHART_API_URL", f"http://127.0.0.1:{port}")
set_if_empty("CHART_HOST_URL", f"http://127.0.0.1:{chart_port}")
set_if_empty("MCP_AUTH_SECRET", secrets.token_hex(32))
set_if_empty("MCP_AUTH_MODE", "oauth")
set_if_empty("MCP_PORT", "8787")
app = strip_quotes(vals.get("APP_URL", "")).rstrip("/")
if app and empty("MCP_PUBLIC_URL"):
    set_if_empty("MCP_PUBLIC_URL", app + "/mcp")

out = []
seen = set()
for kind, val in order:
    if kind == "raw":
        out.append(val)
    else:
        out.append(f"{val}={vals[val]}")
        seen.add(val)
for key, value in vals.items():
    if key not in seen:
        out.append(f"{key}={value}")
p.write_text("\n".join(out) + "\n")
p.chmod(0o600)
print("env_filled=" + (",".join(added) if added else "none"))
PY

if ! command -v docker >/dev/null 2>&1; then
  echo "FATAL: docker is not installed. chart-host cannot run, so chart capture will fail." >&2
  exit 1
fi

if ss -lnt 2>/dev/null | grep -q ":${CHART_HOST_PUBLISH_PORT} "; then
  owner="$(docker ps --filter "publish=${CHART_HOST_PUBLISH_PORT}" --format '{{.Names}}' | head -1 || true)"
  if [ "$owner" != "chart-host" ] && ! curl -fsS "http://127.0.0.1:${CHART_HOST_PUBLISH_PORT}/healthz" >/dev/null 2>&1; then
    echo "FATAL: port ${CHART_HOST_PUBLISH_PORT} is in use by something other than chart-host" >&2
    ss -lntp | grep ":${CHART_HOST_PUBLISH_PORT} " || true
    exit 1
  fi
fi

if docker ps -a --format '{{.Names}}' | grep -qx chart-host; then
  img="$(docker inspect -f '{{.Config.Image}}' chart-host)"
  case "$img" in
    "$IMAGE"|"${IMAGE}:latest") ;;
    *)
      echo "FATAL: a container named chart-host exists but its image is '$img', not $IMAGE. Refusing to replace it." >&2
      exit 1
      ;;
  esac
fi

if curl -fsS "http://127.0.0.1:${CHART_HOST_PUBLISH_PORT}/healthz" >/dev/null 2>&1; then
  log "chart-host already healthy on :${CHART_HOST_PUBLISH_PORT}"
else
  log "building $IMAGE"
  docker build -t "$IMAGE" "$INSTALL_DIR/chart-host"
  token="$(python3 - "$ENV_FILE" AICHART_SERVICE_TOKEN <<'PY'
import sys
from pathlib import Path
key = sys.argv[2]
for line in Path(sys.argv[1]).read_text().splitlines():
    if line.startswith(key + "="):
        value = line.split("=", 1)[1].strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        print(value)
        break
PY
)"
  app_url="$(python3 - "$ENV_FILE" APP_URL <<'PY'
import sys
from pathlib import Path
key = sys.argv[2]
for line in Path(sys.argv[1]).read_text().splitlines():
    if line.startswith(key + "="):
        value = line.split("=", 1)[1].strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        print(value)
        break
PY
)"
  if [ -z "$token" ] || [ "${#token}" -lt 16 ]; then
    echo "FATAL: AICHART_SERVICE_TOKEN missing or shorter than 16 chars" >&2
    exit 1
  fi
  if [ -z "$app_url" ]; then
    echo "FATAL: APP_URL missing" >&2
    exit 1
  fi
  docker rm -f chart-host >/dev/null 2>&1 || true
  docker run -d --name chart-host \
    --init --memory=1500m --pids-limit=256 --restart=unless-stopped \
    -p "127.0.0.1:${CHART_HOST_PUBLISH_PORT}:8787" \
    -e "APP_URL=${app_url}" \
    -e "AICHART_SERVICE_TOKEN=${token}" \
    "$IMAGE" >/dev/null
  unset token
  ok=0
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${CHART_HOST_PUBLISH_PORT}/healthz" >/dev/null 2>&1; then
      ok=1
      break
    fi
    sleep 2
  done
  if [ "$ok" != 1 ]; then
    echo "FATAL: chart-host did not become healthy" >&2
    docker logs chart-host --tail 40 || true
    exit 1
  fi
  log "chart-host is up"
fi

# Panel row. Env remains the fallback when this insert cannot run yet
# (database still booting on a first install). `pg` resolves from the app.
cd "$INSTALL_DIR"
node --input-type=commonjs - "$ENV_FILE" "$CHART_HOST_PUBLISH_PORT" <<'NODE' || log "platform_config skipped"
const fs = require("fs");
const { Client } = require("pg");
const envPath = process.argv[2];
const port = process.argv[3];
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  env[line.slice(0, i)] = line.slice(i + 1);
}
const url = env.DATABASE_URL;
if (!url) {
  console.log("platform_config skipped: no DATABASE_URL");
  process.exit(0);
}
const value = `http://127.0.0.1:${port}`;
(async () => {
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query(
    `INSERT INTO platform_config (key, value, plain, updated_at)
     VALUES ('CHART_HOST_URL', $1, TRUE, NOW())
     ON CONFLICT (key) DO NOTHING`,
    [value],
  );
  const row = await c.query(
    "SELECT value FROM platform_config WHERE key = 'CHART_HOST_URL'",
  );
  console.log("platform_config", row.rows[0] ? "present" : "missing");
  await c.end();
})().catch((err) => {
  console.log("platform_config skipped:", err.message.split("\n")[0]);
  process.exit(0);
});
NODE

log "runtime ok. Restart aichart-web and aichart-worker if they were already up, so they reload .env."
