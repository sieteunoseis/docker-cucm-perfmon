module.exports = [
  {
    script: "perfmonCollectCounterData.js",
    name: "Counter Data",
    autorestart: true,
    exp_backoff_restart_delay: 60000,
    stop_exit_codes: [1],
    env: {
      NODE_ENV: "development"
    }
  },
  {
    script: "perfmonCollectSessionData.js",
    name: "Session Data",
    autorestart: true,
    exp_backoff_restart_delay: 60000,
    stop_exit_codes: [1],
    env: {
      NODE_ENV: "development"
    }
  }
];
