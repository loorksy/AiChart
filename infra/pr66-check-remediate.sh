#!/usr/bin/env bash
set -euo pipefail
echo "=== proc ==="
ps aux | grep pr66-rc-4a817d0-remediate | grep -v grep || echo no_proc
echo "=== summary ==="
cat /tmp/pr66-4a817d0-remediate-summary.txt 2>/dev/null || echo no_summary
echo "=== tail ==="
tail -n 50 /tmp/pr66-4a817d0-remediate.log 2>/dev/null || tail -n 50 /tmp/pr66-4a817d0-remediate.nohup
echo "=== markers ==="
grep -E '^(PASS|FAIL|SKIP|DONE|HEAD=|PG_|provider_)' /tmp/pr66-4a817d0-remediate.log 2>/dev/null | tail -40 || true
