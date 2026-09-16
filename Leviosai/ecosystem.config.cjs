/** PM2 process file — production on EC2 (nginx :80 → app :3000, ngrok → :80). */
module.exports = {
  apps: [
    {
      name: "leviosai",
      cwd: __dirname,
      script: "npx",
      args: "tsx server.ts",
      interpreter: "none",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 20,
      min_uptime: "10s",
      kill_timeout: 10_000,
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
      env_production: {
        NODE_ENV: "production",
        PORT: "3000",
      },
      error_file: `${process.env.HOME || "/home/ubuntu"}/logs/leviosai-error.log`,
      out_file: `${process.env.HOME || "/home/ubuntu"}/logs/leviosai-out.log`,
      merge_logs: true,
    },
  ],
};
