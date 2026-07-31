#!/usr/bin/env bash
pkill -f 'pr66-rc-0171398-qualify.sh' >/dev/null 2>&1 || true
nohup bash /tmp/pr66-rc-0171398-continue.sh > /tmp/pr66-0171398-continue.nohup 2>&1 &
echo "CONTINUE_PID=$!"
sleep 1
head -n 8 /tmp/pr66-0171398-continue.nohup || true
