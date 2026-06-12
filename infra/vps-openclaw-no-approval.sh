#!/usr/bin/env bash
# Disable exec approval prompts so Telegram bot runs curl/wget without timeout.
set -euo pipefail
openclaw exec-policy preset yolo
openclaw exec-policy show 2>&1 | tail -8
pm2 stop aichart-agent && sleep 4 && pm2 start aichart-agent --update-env
sleep 6
echo "exec approval disabled (effective ask=off) — retry in Telegram"
