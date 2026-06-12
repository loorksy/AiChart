#!/usr/bin/env bash
set -euo pipefail
PID=$(pm2 pid aichart-web)
echo "web_pid=$PID"
tr '\0' '\n' < "/proc/$PID/environ" | grep -E '^OPENCLAW_|^PATH=' || true
cd /opt/aichart/web
node -e "
const { execFile } = require('child_process');
const { promisify } = require('util');
const exec = promisify(execFile);
(async () => {
  console.log('OPENCLAW_AUTO_RESTART=', process.env.OPENCLAW_AUTO_RESTART);
  try {
    const r = await exec('/usr/bin/pm2', ['jlist'], { timeout: 10000 });
    console.log('pm2 jlist ok, len', r.stdout.length);
  } catch (e) {
    console.log('pm2 jlist FAIL', e.message);
  }
})();
"
