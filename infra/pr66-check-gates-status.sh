#!/usr/bin/env bash
set -euo pipefail
echo "=== gates process ==="
ps aux | grep -E 'pr66-rc-4a817d0-gates|npm ci|tsc|next build' | grep -v grep | head -15 || echo no_gate_proc
echo "=== summary so far ==="
cat /tmp/pr66-4a817d0-gates-summary.txt 2>/dev/null || echo no_summary
echo "=== log tail ==="
tail -n 40 /tmp/pr66-4a817d0-gates.log 2>/dev/null || tail -n 40 /tmp/pr66-4a817d0-gates.nohup 2>/dev/null || echo no_log
echo "=== markers ==="
grep -E '^(PASS|FAIL|SKIP|DONE|HEAD=)' /tmp/pr66-4a817d0-gates.log 2>/dev/null | tail -40 || true
