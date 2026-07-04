module.exports = {
  apps: [
    {
      name: "aichart-web",
      cwd: "./web",
      script: "npm",
      args: "start",
      instances: 1,
      autorestart: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: 3010,
      },
    },
    {
      name: "aichart-mcp",
      script: "./infra/aichart-mcp.sh",
      interpreter: "bash",
      instances: 1,
      autorestart: true,
      // 256M tripped under chart-PNG buffers + accumulated MCP sessions and
      // each restart killed every live session (cards fail until re-init).
      max_memory_restart: "512M",
    },
    {
      // Background job tier (BullMQ). Only useful when REDIS_URL is set; with it
      // unset the web process runs jobs inline and this worker idles. Scale by
      // raising `instances` and/or WORKER_CONCURRENCY.
      name: "aichart-worker",
      cwd: "./web",
      script: "npm",
      args: "run worker",
      instances: 1,
      autorestart: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
