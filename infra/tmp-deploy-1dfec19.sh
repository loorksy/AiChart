#!/usr/bin/env bash
set -euo pipefail

REAL="$(readlink -f /opt/aichart)"
cd "$REAL"
echo "REAL=$REAL"

git fetch origin
git reset --hard origin/main
SHORT="$(git rev-parse --short HEAD)"
echo "AT=$SHORT"

python3 - <<'PY'
from pathlib import Path
import subprocess
env = Path("/opt/aichart/web/.env")
commit = subprocess.check_output(["git", "-C", "/opt/aichart", "rev-parse", "HEAD"], text=True).strip()
text = env.read_text(encoding="utf-8", errors="ignore")
lines = [ln for ln in text.splitlines() if not ln.startswith("GIT_COMMIT=")]
lines.append(f"GIT_COMMIT={commit}")
env.write_text("\n".join(lines) + "\n", encoding="utf-8")
print("GIT_COMMIT synced", commit[:12])
PY

echo "== web =="
cd "$REAL/web"
npm install --no-audit --no-fund
npm run build
pm2 restart aichart-web --update-env
pm2 restart aichart-worker --update-env || true
bash "$REAL/infra/vps-mcp-deploy.sh" "$REAL" || true

echo "== research =="
OVERRIDE="/root/aichart-runtime/research-override.yml"
set -a
# shellcheck disable=SC1091
source <(grep -E '^(RESEARCH_SERVICE_INTERNAL_TOKEN|RESEARCH_SWARM_ENABLED|RESEARCH_SWARM_PRESETS_ENABLED)=' "$REAL/web/.env" | sed 's/\r$//')
set +a
docker compose -p aichart-production \
  -f "$REAL/infra/docker-compose.yml" \
  -f "$OVERRIDE" \
  --profile research build research
docker compose -p aichart-production \
  -f "$REAL/infra/docker-compose.yml" \
  -f "$OVERRIDE" \
  --profile research up -d --no-deps research

sleep 4
curl -fsS -o /dev/null -w "web_root %{http_code}\n" "http://127.0.0.1:3010/"
curl -fsS -o /dev/null -w "research_live %{http_code}\n" "http://127.0.0.1:8090/health/live"
docker ps --filter name=aichart-production-research --format '{{.Names}} {{.Status}}'
echo "DEPLOY_OK $SHORT"
