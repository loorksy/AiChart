#!/usr/bin/env bash
set -uo pipefail
ps -p 2910118 -o pid,etime,cmd 2>/dev/null || echo DEPLOY_PROCESS_DONE
ps aux | grep -E 'clean-redeploy|pr66-production-deploy|npm ci|next build' | grep -v grep | head -15 || true
echo '---SUMMARY---'
cat /tmp/pr66-production-deploy-summary.txt 2>/dev/null || true
echo '---TAIL---'
tail -n 40 /tmp/pr66-production-deploy.log 2>/dev/null || tail -n 40 /tmp/pr66-production-deploy-nohup.out 2>/dev/null || true
echo '---HEALTH---'
curl -fsS http://127.0.0.1:3010/api/healthz 2>/dev/null || echo 'web down'
echo
curl -fsS http://127.0.0.1:8787/health 2>/dev/null || echo 'mcp down'
echo
echo "symlink=$(readlink -f /opt/aichart 2>/dev/null || true)"
pm2 list 2>/dev/null | head -20
