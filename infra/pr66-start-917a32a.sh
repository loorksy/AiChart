#!/usr/bin/env bash
set -uo pipefail
pkill -f 'pr66-rc-final-qualify.sh' 2>/dev/null || true
sleep 1
cp /tmp/pr66-rc-final-qualify.sh /tmp/pr66-rc-final-qualify-917a32a.sh
chmod +x /tmp/pr66-rc-final-qualify-917a32a.sh
nohup env RC_SHA=917a32a98c6fd31ef8d2349c9f35b72878d7d993 bash /tmp/pr66-rc-final-qualify-917a32a.sh \
  > /tmp/pr66-917a32a-qualify-nohup.out 2>&1 &
echo "STARTED_PID=$!"
sleep 2
ps -p $! -o pid,etime,cmd || true
head -n 20 /tmp/pr66-917a32a-qualify-nohup.out || true
