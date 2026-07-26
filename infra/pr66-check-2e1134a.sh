#!/usr/bin/env bash
set -euo pipefail
echo "=== setup ==="
tail -n 40 /tmp/pr66-2e1134a-setup.log 2>/dev/null || echo no_setup_log
ps aux | grep pr66-rc-2e1134a-setup | grep -v grep || echo no_setup_proc
echo "=== gates ==="
cat /tmp/pr66-2e1134a-gates-summary.txt 2>/dev/null || echo no_gates_summary
ps aux | grep pr66-rc-2e1134a-gates | grep -v grep || echo no_gates_proc
tail -n 20 /tmp/pr66-2e1134a-gates.log 2>/dev/null || true
test -d /opt/aichart-rc-pr66-2e1134a && git -C /opt/aichart-rc-pr66-2e1134a rev-parse HEAD || echo rc_missing
