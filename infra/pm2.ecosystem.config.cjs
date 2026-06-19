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
      max_memory_restart: "256M",
    },
  ],
};
