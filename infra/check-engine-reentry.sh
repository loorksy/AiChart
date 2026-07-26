#!/usr/bin/env bash
set -euo pipefail
echo "=== containers ==="
docker ps --format '{{.Names}}' | grep -E 'aichart|research|web' || true
echo "=== research engine ==="
docker ps --format '{{.Names}}' | grep -i research | head -1 | while read -r name; do
  docker exec "$name" python3 <<'PY'
import inspect
from app.backtest import engine as e
src = inspect.getsource(e.BacktestEngine._close_fraction)
print("container_ok")
print("has_discard", "discard" in src)
print("has_pause_in_close", "risk_consecutive_loss_pause" in src or "consecutive" in src)
run_src = inspect.getsource(e.BacktestEngine.run)
print("run_has_pause", "risk_consecutive_loss_pause" in run_src)
for line in src.splitlines():
    if "entered" in line or "discard" in line:
        print("CLOSE:", line.strip())
PY
done
echo "=== web catalog in image ==="
docker ps --format '{{.Names}}' | grep -iE 'web|next' | head -3 | while read -r name; do
  echo "checking $name"
  docker exec "$name" sh -c 'find /app -name "*.js" 2>/dev/null | head -5; ls /app 2>/dev/null | head -20' || true
done
