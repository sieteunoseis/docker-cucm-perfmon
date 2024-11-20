module.exports = [
  {
    script: "main.js",
    name: "Perfmon Data",
    autorestart: true,
    exp_backoff_restart_delay: 1000,
    env: {
      NODE_ENV: "development"
    }
  }
];
