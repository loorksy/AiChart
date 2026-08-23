/**
 * pm2 process definitions for the VPS — kept in lockstep with the CURRENT
 * repo layout: the Next.js app lives at the repo ROOT (the old `web/`
 * subdirectory no longer exists), the MCP bridge lives in `mcp/`, and the
 * chart-host runs as a Docker container (see chart-host/README.md), not
 * under pm2.
 *
 * The previous revision of this file predated that layout: it pointed cwd at
 * ./web, launched mcp through a script that sourced the missing web/.env, and
 * capped processes at 512M while the live definitions run 1G — so any
 * `pm2 start/restart` from the file broke all three processes.
 *
 * Secrets are NOT in this file: web and worker read $ROOT/.env through
 * @next/env at boot, and infra/aichart-mcp.sh loads the same file before
 * exec'ing `node mcp/dist/index.js` (rebuilding dist first when sources are
 * newer — see the incident note inside the script).
 *
 * Every app execs its real binary DIRECTLY rather than going through `npm
 * run`. Under npm, the pid pm2 tracks is the npm shell: killing it (a
 * `kill -9`, an OOM kill, a segfault) left the actual node process alive and
 * still holding the worker's health port, so every restart died on
 * EADDRINUSE and the restart counter climbed past a hundred with nothing to
 * show for it. The process pm2 reports must be the process that holds the
 * resources.
 */
const ROOT = process.env.AICHART_INSTALL_DIR || "/opt/aichart";

module.exports = {
  apps: [
    {
      name: "aichart-web",
      cwd: ROOT,
      // `npm start` → `next start`, without the shell in between.
      script: "node_modules/.bin/next",
      args: "start",
      interpreter: "none",
      instances: 1,
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 3010,
      },
    },
    {
      // Claude Connectors bridge on host port 8787 (which is why the
      // chart-host container maps to 8788). The wrapper script loads the
      // env block from $ROOT/.env and rebuilds a stale dist before exec.
      name: "aichart-mcp",
      cwd: ROOT,
      script: "./infra/aichart-mcp.sh",
      interpreter: "bash",
      instances: 1,
      autorestart: true,
      // 256M tripped under chart-PNG buffers + accumulated MCP sessions and
      // each restart killed every live session (cards fail until re-init).
      max_memory_restart: "1G",
    },
    {
      // The resident agent process (src/worker.ts): one long-lived host on
      // the Redis Streams queue, plus the legacy BullMQ job tier in the same
      // process. Requires REDIS_URL in $ROOT/.env for durable events.
      name: "aichart-worker",
      cwd: ROOT,
      // `npm run worker` → `tsx src/worker.ts`, without the shell in
      // between: this pid is the one holding port 8791, so pm2's stop/kill
      // actually frees it.
      script: "node_modules/.bin/tsx",
      args: "src/worker.ts",
      interpreter: "none",
      // A stop must reach the real process; the worker drains on SIGTERM.
      kill_timeout: 10000,
      instances: 1,
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
