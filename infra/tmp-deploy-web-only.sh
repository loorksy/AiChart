#!/usr/bin/env bash
set -euo pipefail
REAL="$(readlink -f /opt/aichart)"
cd "$REAL"
git fetch origin
git reset --hard origin/main
SHORT="$(git rev-parse --short HEAD)"
python3 - <<'PY'
from pathlib import Path
import subprocess
env = Path("/opt/aichart/web/.env")
commit = subprocess.check_output(["git", "-C", "/opt/aichart", "rev-parse", "HEAD"], text=True).strip()
lines = [ln for ln in env.read_text(encoding="utf-8", errors="ignore").splitlines() if not ln.startswith("GIT_COMMIT=")]
lines.append(f"GIT_COMMIT={commit}")
env.write_text("\n".join(lines) + "\n", encoding="utf-8")
print("AT", commit[:12])
PY
cd "$REAL/web"
npm install --no-audit --no-fund
npm run build
pm2 restart aichart-web --update-env
pm2 restart aichart-worker --update-env || true
curl -fsS -o /dev/null -w "web %{http_code}\n" http://127.0.0.1:3010/
echo "DEPLOY_OK $SHORT"
