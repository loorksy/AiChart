#!/usr/bin/env bash
set -euo pipefail
SRC="${1:-/tmp/model-sync}"
A="${AICHART:-/opt/aichart}"

cp -f "$SRC/openclawModelSync.ts" "$A/web/src/lib/"
mkdir -p "$A/web/src/app/api/admin/agent-model-status"
cp -f "$SRC/route.ts" "$A/web/src/app/api/admin/config/route.ts"
cp -f "$SRC/agent-model-status/route.ts" "$A/web/src/app/api/admin/agent-model-status/route.ts" 2>/dev/null || \
  cp -f "$SRC/route.ts" "$A/web/src/app/api/admin/agent-model-status/route.ts"
cp -f "$SRC/AdminKeysPanel.tsx" "$A/web/src/components/admin/"
cp -f "$SRC/sync-model.sh" "$A/agent/scripts/"
cp -f "$SRC/SOUL.md" "$A/agent/workspace/"
cp -f "$SRC/vps-openclaw-merge-config.sh" "$A/infra/"
cp -f "$SRC/vps-apply-model-sync.sh" "$A/infra/"
cp -f "$SRC/README.md" "$A/agent/README.md" 2>/dev/null || true

chmod +x "$A/agent/scripts/sync-model.sh" "$A/infra/vps-apply-model-sync.sh"
sed -i 's/\r//g' "$A/agent/scripts/sync-model.sh" "$A/infra/vps-apply-model-sync.sh"
bash "$A/infra/vps-apply-model-sync.sh"
