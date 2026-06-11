#!/usr/bin/env bash
# Disable exec approval prompts so Telegram bot runs curl/wget without timeout.
set -euo pipefail
openclaw config set tools.exec.ask off
openclaw config set tools.exec.security full
openclaw config get tools.exec
pm2 stop aichart-agent && sleep 4 && pm2 start aichart-agent --update-env
sleep 6
echo "exec approval disabled - retry in Telegram"
