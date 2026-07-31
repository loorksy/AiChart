#!/usr/bin/env bash
set -uo pipefail
ps aux | grep -E 'pr66-rc-final-qualify-917a32a|next build' | grep -v grep | head -10 || echo QUALIFIER_IDLE
echo '---SUMMARY---'
cat /tmp/pr66-917a32a-qualify-summary.txt 2>/dev/null || echo '(no summary yet)'
echo '---COUNTS---'
echo -n 'PASS='; grep -c '^PASS ' /tmp/pr66-917a32a-qualify-summary.txt 2>/dev/null || echo 0
echo -n 'FAIL='; grep -c '^FAIL ' /tmp/pr66-917a32a-qualify-summary.txt 2>/dev/null || echo 0
echo '---TAIL---'
tail -n 25 /tmp/pr66-917a32a-qualify.log 2>/dev/null || true
grep -E 'DONE |browser matrix|create_recommendation|mcp-authenticated' /tmp/pr66-917a32a-qualify.log 2>/dev/null | tail -n 20 || true
