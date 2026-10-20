module.exports = {
  apps: [
    {
      name: "allinoneview-web",
      script: "npm",
      args: "start",
      cwd: __dirname,
      env: {
        NODE_ENV: "production"
      },
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 20,
      time: true
    },
    {
      name: "allinoneview-orderflow",
      script: "npm",
      args: "run collector:orderflow",
      cwd: __dirname,
      env: {
        NODE_ENV: "production"
      },
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 50,
      time: true
    }
  ]
};
