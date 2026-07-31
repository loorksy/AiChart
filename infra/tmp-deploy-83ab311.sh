#!/usr/bin/env bash
set -euo pipefail

REAL="$(readlink -f /opt/aichart)"
cd "$REAL"
echo "REAL=$REAL"

git fetch origin
git reset --hard origin/main
COMMIT="$(git rev-parse HEAD)"
SHORT="$(git rev-parse --short HEAD)"
echo "AT=$SHORT"

# Preserve .env; only sync GIT_COMMIT via Python (never shell rewrite).
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
COMPOSE_FILES=(-f "$REAL/infra/docker-compose.yml")
if [[ -f "$OVERRIDE" ]]; then
  COMPOSE_FILES+=(-f "$OVERRIDE")
fi
# Compose interpolates RESEARCH_SERVICE_INTERNAL_TOKEN from the shell env.
set -a
# shellcheck disable=SC1091
source <(grep -E '^(RESEARCH_SERVICE_INTERNAL_TOKEN|RESEARCH_SWARM_ENABLED|RESEARCH_SWARM_PRESETS_ENABLED)=' "$REAL/web/.env" | sed 's/\r$//')
set +a
docker compose -p aichart-production "${COMPOSE_FILES[@]}" --profile research build research
docker compose -p aichart-production "${COMPOSE_FILES[@]}" --profile research up -d --no-deps research

PORT="$(grep -E '^PORT=' "$REAL/web/.env" | cut -d= -f2- | tr -d '\r')"
echo "PORT=$PORT"
curl -fsS -o /dev/null -w "HTTP_ROOT %{http_code}\n" "http://127.0.0.1:${PORT}/"
curl -fsS "http://127.0.0.1:${PORT}/api/healthz" || true
echo
docker ps --format '{{.Names}} {{.Status}}' | grep -E 'aichart|NAME' || true
pm2 list | grep -E 'aichart|NAME' || true
echo "DEPLOY_OK $SHORT"
