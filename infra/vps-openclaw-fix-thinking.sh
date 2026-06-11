#!/usr/bin/env bash
# Fix Anthropic "Invalid signature in thinking block" by clearing stale session transcripts.
# Happens when thinking was enabled (medium) then disabled — old thinking blocks in history
# are rejected by the API. Do NOT set agents.defaults.thinking manually — invalid schema breaks gateway.
set -euo pipefail

SESSION_KEY="${1:-agent:main:telegram:direct:5969744996}"
SESSIONS_DIR="${OPENCLAW_SESSIONS_DIR:-/root/.openclaw/agents/main/sessions}"
SESSIONS_JSON="$SESSIONS_DIR/sessions.json"

if [[ ! -f "$SESSIONS_JSON" ]]; then
  echo "sessions store not found: $SESSIONS_JSON"
  exit 1
fi

SESSION_ID="$(jq -r --arg k "$SESSION_KEY" '.[$k].sessionId // empty' "$SESSIONS_JSON")"
if [[ -z "$SESSION_ID" ]]; then
  echo "no session row for key=$SESSION_KEY — running doctor only"
else
  echo "reset session key=$SESSION_KEY id=$SESSION_ID"
  pm2 stop aichart-agent 2>/dev/null || true
  sleep 2
  STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
  for f in "$SESSIONS_DIR/${SESSION_ID}.jsonl" \
           "$SESSIONS_DIR/${SESSION_ID}.trajectory.jsonl" \
           "$SESSIONS_DIR/${SESSION_ID}.trajectory-path.json"; do
    if [[ -f "$f" ]]; then
      mv "$f" "${f}.reset.${STAMP}"
      echo "archived $(basename "$f")"
    fi
  done
  tmp="$(mktemp)"
  jq --arg k "$SESSION_KEY" 'del(.[$k])' "$SESSIONS_JSON" > "$tmp"
  mv "$tmp" "$SESSIONS_JSON"
  echo "removed $SESSION_KEY from sessions.json"
fi

openclaw doctor --fix --non-interactive --yes 2>/dev/null || openclaw doctor --fix
pm2 restart aichart-agent --update-env 2>/dev/null || true
sleep 4
echo "done — send a fresh Telegram message (or /reset) to start a clean session"
