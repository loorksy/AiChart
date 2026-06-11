#!/usr/bin/env bash
# Fix Anthropic "Invalid signature in thinking block" by resetting session via doctor.
# Do NOT set agents.defaults.thinking manually — invalid schema breaks the gateway.
set -euo pipefail
openclaw doctor --fix
pm2 stop aichart-agent || true
sleep 3
pm2 restart aichart-agent --update-env
sleep 4
echo "doctor applied + agent restarted — send a fresh Telegram message"
