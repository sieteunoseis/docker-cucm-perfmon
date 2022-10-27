module.exports = [
  {
    script: "perfmonCollectCounterData.js",
    name: "Collect Counter Data",
    watch: true,
    autorestart: true,
    exp_backoff_restart_delay: 360000,
    exec_mode: "cluster",
    instances: 1,
  },
  {
    script: "perfmonCollectSessionData.js",
    name: "Collect Session Data",
    watch: true,
    autorestart: true,
    exp_backoff_restart_delay: 360000,
    exec_mode: "cluster",
    instances: 1,
  },
];
