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
        PORT: 3000,
      },
    },
    {
      // OpenClaw gateway — the live trading agent (Telegram + heartbeat).
      // Requires: npm install -g openclaw && bash agent/scripts/sync-workspace.sh
      name: "aichart-agent",
      script: "openclaw",
      args: "gateway",
      instances: 1,
      autorestart: true,
      max_memory_restart: "768M",
      env: {
        NODE_ENV: "production",
        AICHART_API_URL: process.env.AICHART_API_URL || "http://localhost:3000",
        AICHART_SERVICE_TOKEN: process.env.AICHART_SERVICE_TOKEN || "",
      },
    },
  ],
};
