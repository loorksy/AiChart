#!/usr/bin/env bash
# Archive heavy OpenClaw Telegram sessions to cut input-token cost per message.
set -euo pipefail

SESSIONS="/root/.openclaw/agents/main/sessions"
ARCHIVE="/root/.openclaw/agents/main/sessions-archive-$(date +%Y%m%d-%H%M%S)"

if [[ ! -d "$SESSIONS" ]]; then
  echo "no sessions dir"
  exit 0
fi

BEFORE=$(du -sh "$SESSIONS" | cut -f1)
echo "Before: $BEFORE"

pm2 stop aichart-agent 2>/dev/null || true
sleep 2

mkdir -p "$ARCHIVE"
shopt -s nullglob
for f in "$SESSIONS"/*; do
  mv "$f" "$ARCHIVE/"
done

cat > "$SESSIONS/sessions.json" <<'EOF'
{}
EOF

pm2 start aichart-agent --update-env 2>/dev/null || pm2 restart aichart-agent --update-env
sleep 3

AFTER=$(du -sh "$SESSIONS" | cut -f1)
echo "After: $AFTER"
echo "Archived to: $ARCHIVE"
pm2 list | grep aichart-agent || true
