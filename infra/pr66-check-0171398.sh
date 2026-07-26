#!/usr/bin/env bash
echo "=== proc ==="
ps aux | grep pr66-rc-0171398-qualify | grep -v grep || echo no_qualify_proc
echo "=== summary ==="
cat /tmp/pr66-0171398-qualify-summary.txt 2>/dev/null || echo no_summary
echo "=== tail ==="
tail -n 30 /tmp/pr66-0171398-qualify.log 2>/dev/null || tail -n 30 /tmp/pr66-0171398-qualify.nohup
echo "=== markers ==="
grep -E '^(PASS|FAIL|SKIP|DONE|CHECKED|provider_|rc_)' /tmp/pr66-0171398-qualify.log 2>/dev/null | tail -50 || true
