module.exports = [
  {
    script: "main.js",
    name: "Collect RisPort Data",
    watch: true,
    autorestart: true,
    exp_backoff_restart_delay: 360000,
    exec_mode: "cluster",
    instances: 1,
  }
];
