const { makeValidator, cleanEnv, str, host, num, json } = require("envalid");
const path = require("path");
const axlService = require("cisco-axl");

// If not production load the local env file
if (process.env.NODE_ENV === "development") {
  require("dotenv").config({ path: path.join(__dirname, "..", "env", "development.env") });
} else if (process.env.NODE_ENV === "test") {
  require("dotenv").config({ path: path.join(__dirname, "..", "env", "test.env") });
} else if (process.env.NODE_ENV === "staging") {
  require("dotenv").config({ path: path.join(__dirname, "..", "env", "staging.env") });
}

const versionValid = makeValidator((x) => {
  if (/.*\..*[^\\]/.test(x)) return x.toUpperCase();
  else throw new Error("CUCM_VERSION must be in the format of ##.#");
});

module.exports = {
  getBaseEnv: cleanEnv(process.env, {
    NODE_ENV: str({
      choices: ["development", "test", "production", "staging"],
      desc: "Node environment",
    }),
    CUCM_HOSTNAME: host({ desc: "Cisco CUCM Hostname or IP Address." }),
    CUCM_USERNAME: str({ desc: "Cisco CUCM AXL Username." }),
    CUCM_PASSWORD: str({ desc: "Cisco CUCM AXL Password." }),
    CUCM_VERSION: versionValid({ desc: "Cisco CUCM Version.", example: "12.5" }),
    INFLUXDB_TOKEN: str({ desc: "InfluxDB API token." }),
    INFLUXDB_ORG: str({ desc: "InfluxDB organization id." }),
    INFLUXDB_BUCKET: str({ desc: "InfluxDB bucket to save data to." }),
    INFLUXDB_URL: str({ desc: "URL of InfluxDB. i.e. http://hostname:8086." }),
    PERFMON_SERVERS: json({ default: { servers: [] }, desc: "JSON object of servers to query. Note: If this blank or missing, AXL will be used to query all servers.", example: { servers: ["processNodeName1", "processNodeName2"] } }),
    PERFMON_SERVER_CONCURRENCY: num({
      default: 1,
      desc: "How many servers to query at once. Decrease if you are getting rate limited or 503 errors.",
    }),
    PERFMON_RETRIES: num({
      default: 10,
      desc: "How many retries to attempt before giving up.",
    }),
    PERFMON_RETRY_DELAY: num({
      default: 30000,
      desc: "How long to wait between retries. Default is 30 seconds.",
    }),
    PERFMON_COOLDOWN_TIMER: num({
      default: 5000,
      desc: "Cool down timer. Time between collecting data for each object.",
    }),
  }),
  getCounterEnv: (boolean = false) => {
    if (boolean) {
      return cleanEnv(process.env, {
        PERFMON_COUNTERS: str({
          desc: "Comma separated string of what counters to query.",
        }),
        PERFMON_COUNTER_CONCURRENCY: num({
          default: 2,
          desc: "How many counters to query at once. Decrease if you are getting rate limited or 503 errors.",
        }),
        PERFMON_COUNTER_INTERVAL: num({
          default: 5000,
          desc: "Interval timer. Time between starting new collection period.",
        }),
      });
    }
  },
  getSessionEnv: (boolean = false) => {
    if (boolean) {
      return cleanEnv(process.env, {
        PERFMON_SESSIONS: str({
          desc: "Comma separated string of what counters to query.",
        }),
        PERFMON_SESSIONS_SLEEP: num({
          default: 15000,
          desc: "How long to sleep between adding counters to a session and collecting data. This is for percentage counters that need time to collect data.",
        }),
        PERFMON_SESSION_INTERVAL: num({
          default: 5000,
          desc: "Interval timer. Time between starting new collection period.",
        }),
      });
    }
  },
  getServers: async (env) => {
    // AXL Settings
    const settings = {
      version: env.CUCM_VERSION,
      cucmip: env.CUCM_HOSTNAME,
      cucmuser: env.CUCM_USERNAME,
      cucmpass: env.CUCM_PASSWORD,
    };
    var servers = { callManager: env.PERFMON_SERVERS.servers }; // Default to user defined servers, otherwise we will get them from AXL and update this value
    if (Object.keys(env.PERFMON_SERVERS.servers).length == 0) {
      var axl_service = new axlService(settings.cucmip, settings.cucmuser, settings.cucmpass, settings.version);
      // Let's get the servers via AXL
      var operation = "listCallManager";
      var tags = await axl_service.getOperationTags(operation);
      tags.searchCriteria.name = "%%";
      servers = await axl_service.executeOperation(operation, tags).catch((error) => {
        console.log(error);
      });
    } else {
      // Convert the user defined servers to the correct format
      servers.callManager = servers.callManager.map((server) => {
        return { processNodeName: { value: server } };
      });
    }
    return servers;
  },
};
