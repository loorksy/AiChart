#!/usr/bin/env bash
set -uo pipefail
cp /tmp/pr66-production-deploy.sh /tmp/pr66-production-deploy-run.sh
chmod +x /tmp/pr66-production-deploy-run.sh
nohup env EXPECTED_MERGE=522e372866d606cafe8ceb40ff2615d68d2807e0 \
  bash /tmp/pr66-production-deploy-run.sh > /tmp/pr66-production-deploy-nohup.out 2>&1 &
echo "STARTED_PID=$!"
sleep 2
ps -p $! -o pid,etime,cmd || true
head -n 30 /tmp/pr66-production-deploy-nohup.out || true
