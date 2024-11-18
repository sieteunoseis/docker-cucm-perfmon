const { makeValidator, cleanEnv, str, host, num } = require("envalid");
const path = require("path");
const axlService = require("cisco-axl");
const perfMonService = require("cisco-perfmon");

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
    PM_SERVERS: str({
      default: null,
      desc: "Comma separated string of servers to collect data from. If not provided, it will get the servers from AXL.",
    }),
    PM_SERVER_CONCURRENCY: num({
      default: 1,
      desc: "How many servers to query at once. Decrease if you are getting rate limited or 503 errors.",
    }),
    PM_RETRY: num({
      default: 3,
      desc: "How many times to retry a failed query. Default is 3.",
    }),
    PM_RETRY_DELAY: num({
      default: 15000,
      desc: "How long to wait between retries. Default is 15 seconds.",
    }),
    PM_COOLDOWN_TIMER: num({
      default: 5000,
      desc: "Cool down timer. Time between collecting data for each object.",
    }),
    PM_OBJECT_COLLECT_ALL: str({
      default: null,
      desc: "Comma separated string of what object to collect. Returns the perfmon data for all counters that belong to an object on a particular host",
    }),
    PM_OBJECT_COLLECT_ALL_CONCURRENCY: num({
      default: 1,
      desc: "How many objects to query at once. Decrease if you are getting rate limited or 503 errors.",
    }),
    PM_INTERVAL: num({
      default: 5000,
      desc: "Interval timer. Time between starting new collection period.",
    }),
    PM_OBJECT_SESSION_PERCENTANGE: str({
      default: null,
      desc: "Comma separated string of what counters to query. These are percentage counters that two or more samples to collect data.",
    }),
    PM_OBJECT_SESSION_PERCENTANGE_SLEEP: num({
      default: 15000,
      desc: "How long to sleep between adding objects to a session and collecting data. This is for percentage counters that need time to collect data.",
    }),
  }),
  getServers: async (env) => {
    // AXL Settings
    const settings = {
      version: env.CUCM_VERSION,
      cucmip: env.CUCM_HOSTNAME,
      cucmuser: env.CUCM_USERNAME,
      cucmpass: env.CUCM_PASSWORD,
    };
    var serverArr = (env.PM_SERVERS || "").split(",");
    var servers = {
      callManager: serverArr.map((server) => {
        return { processNodeName: { value: server } };
      }),
    };

    if (!env.PM_SERVERS) {
      var axl_service = new axlService(settings.cucmip, settings.cucmuser, settings.cucmpass, settings.version);
      // Let's get the servers via AXL
      var operation = "listCallManager";
      var tags = await axl_service.getOperationTags(operation);
      tags.searchCriteria.name = "%%";
      servers = await axl_service.executeOperation(operation, tags).catch((error) => {
        console.log(error);
      });
    }
    return servers;
  },
  getSessionConfig: async (server, counterArr) => {
    const env = module.exports.getBaseEnv;
    return new Promise(async (resolve, reject) => {
      let service = new perfMonService(server, env.CUCM_USERNAME, env.CUCM_PASSWORD);
      let sessionArray = [];

      try {
        var listCounterResults = await service.listCounter(server);
      } catch (error) {
        if (error.message.faultcode) {
          reject(`Error: ${error.message.faultcode} for ${server}.`);
          return;
        } else if (error.message == 503) {
          reject(`Error: ${error.message} received for ${server}.`);
          return;
        } else {
          reject(`Error: ${error} for ${server}.`);
          return;
        }
      }

      // Filter out the one we want for now
      var filteredArr = listCounterResults.results.filter((counter) => {
        return counterArr.includes(counter.Name);
      });

      // let counter of listCounterResults.results
      for (let counter of filteredArr) {
        if (counter.ArrayOfCounter.item.length > 0) {
          if (counter.MultiInstance === "true") {
            try {
              var listInstanceResults = await service.listInstance(server, counter.Name);
              const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
              await delay(env.PM_COOLDOWN_TIMER); // sleeping to avoid rate limiting
            } catch (error) {
              if (error.message.faultcode) {
                reject(`Error: ${error.message.faultcode} for ${server}.`);
                return;
              } else if (error.message == 503) {
                reject(`Error: ${error.message} received for ${server}.`);
                return;
              } else {
                reject(`Error: ${error} for ${server}.`);
                return;
              }
            }
            if (listInstanceResults.results.length > 0) {
              for (const instance of listInstanceResults.results) {
                for (const item of counter.ArrayOfCounter.item) {
                  let output = {
                    host: "",
                    object: "",
                    instance: "",
                    counter: "",
                  };
                  output.host = server;
                  output.object = counter.Name;
                  output.instance = instance.Name;
                  output.counter = item.Name;
                  sessionArray.push(output);
                }
              }
            } else {
              let output = {
                host: "",
                object: "",
                instance: "",
                counter: "",
              };
              output.host = server;
              output.object = counter.Name;
              sessionArray.push(output);
            }
          } else {
            for (const item of counter.ArrayOfCounter.item) {
              let output = {
                host: "",
                object: "",
                instance: "",
                counter: "",
              };
              output.host = server;
              output.object = counter.Name;
              output.counter = item.Name;
              sessionArray.push(output);
            }
          }
        }
      }
      resolve(sessionArray);
    });
  }
};
