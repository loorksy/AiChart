#!/usr/bin/env bash
# Full MCP deploy on VPS (run after tarball extract to /opt/aichart).
set -euo pipefail

REPO="/opt/aichart"
NGINX="/etc/nginx/sites-available/aichart.lork.cloud"
ENV_FILE="$REPO/web/.env"

cd "$REPO"

echo "==> MCP env in web/.env"
touch "$ENV_FILE"
if ! grep -q '^MCP_AUTH_SECRET=' "$ENV_FILE" 2>/dev/null; then
  echo "MCP_AUTH_SECRET=$(openssl rand -hex 32)" >>"$ENV_FILE"
  echo "added MCP_AUTH_SECRET"
fi
grep -q '^MCP_PUBLIC_URL=' "$ENV_FILE" || echo 'MCP_PUBLIC_URL=https://aichart.lork.cloud/mcp' >>"$ENV_FILE"
grep -q '^MCP_PORT=' "$ENV_FILE" || echo 'MCP_PORT=8787' >>"$ENV_FILE"
grep -q '^MCP_AUTH_MODE=' "$ENV_FILE" || echo 'MCP_AUTH_MODE=oauth' >>"$ENV_FILE"

chmod +x "$REPO/infra/aichart-mcp.sh" "$REPO/infra/vps-mcp-deploy.sh" 2>/dev/null || true
find "$REPO/infra" -name '*.sh' -exec sed -i 's/\r$//' {} + 2>/dev/null || true

echo "==> nginx MCP locations"
if ! grep -q 'aichart-mcp-proxy' "$NGINX" 2>/dev/null; then
  python3 - "$NGINX" "$REPO/infra/nginx/aichart-mcp.conf" <<'PY'
import sys
nginx_path, snippet_path = sys.argv[1], sys.argv[2]
lines = [
    ln for ln in open(snippet_path, encoding="utf-8")
    if ln.strip() and not ln.strip().startswith("#")
]
marker = "    # aichart-mcp-proxy\n" + "".join(lines) + "\n"
text = open(nginx_path, encoding="utf-8").read()
if "aichart-mcp-proxy" in text:
    print("nginx already has mcp")
    raise SystemExit(0)
needle = "    location / {"
if needle not in text:
    raise SystemExit("nginx: location / not found")
text = text.replace(needle, marker + needle, 1)
open(nginx_path, "w", encoding="utf-8").write(text)
print("nginx patched")
PY
else
  echo "nginx already has mcp"
fi

echo "==> web build (mcp-auth route)"
cd "$REPO/web"
npm run build
pm2 restart aichart-web --update-env

echo "==> mcp build + pm2"
bash "$REPO/infra/vps-mcp-deploy.sh" "$REPO"

echo "==> nginx reload"
nginx -t
systemctl reload nginx

echo "==> verify"
curl -sf "http://127.0.0.1:8787/health"
echo ""
curl -sfI "https://aichart.lork.cloud/health" | head -3
curl -sfI "https://aichart.lork.cloud/.well-known/oauth-protected-resource" | head -3
echo "MCP URL: https://aichart.lork.cloud/mcp"
pm2 list | grep aichart-mcp || true
