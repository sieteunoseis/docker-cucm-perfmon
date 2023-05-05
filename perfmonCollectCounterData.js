const axlService = require("cisco-axl");
const perfMonService = require("cisco-perfmon");
const { setIntervalAsync } = require("set-interval-async");
const { InfluxDB, Point } = require("@influxdata/influxdb-client");
const { cleanEnv, str, host, num } = require("envalid");

// If not production load the local env file
if (process.env.NODE_ENV === "production") {
  require("dotenv").config();
}else if(process.env.NODE_ENV === "development"){
  require('dotenv').config({ path: `${__dirname}/env/development.env` })
}else if(process.env.NODE_ENV === "test"){
  require('dotenv').config({ path: `${__dirname}/env/test.env` })
}else if(process.env.NODE_ENV === "staging"){
  require('dotenv').config({ path: `${__dirname}/env/staging.env` })
}

const env = cleanEnv(process.env, {
  NODE_ENV: str({
    choices: ["development", "test", "production", "staging"],
    desc: "Node environment",
  }),
  CUCM_HOSTNAME: host({ desc: "Cisco CUCM Hostname or IP Address." }),
  CUCM_USERNAME: str({ desc: "Cisco CUCM AXL Username." }),
  CUCM_PASSWORD: str({ desc: "Cisco CUCM AXL Password." }),
  CUCM_VERSION: str({ desc: "Cisco CUCM Version." }),
  COOLDOWN_TIMER: num({
    default: 5000,
    desc: "Cool down timer. Time between collecting data for each object.",
  }),
  COUNTER_INTERVAL: num({
    default: 5000,
    desc: "Interval timer. Time between starting new collection period.",
  }),
  INFLUXDB_TOKEN: str({ desc: "InfluxDB API token." }),
  INFLUXDB_ORG: str({ desc: "InfluxDB organization id." }),
  INFLUXDB_BUCKET: str({ desc: "InfluxDB bucket to save data to." }),
  INFLUXDB_URL: str({ desc: "URL of InfluxDB. i.e. http://hostname:8086." }),
  PERFMON_COUNTERS: str({
    desc: "Comma separated string of what counters to query.",
  }),
});

// Add timestamp to console logs, after this point
require("log-timestamp");

// Cool down function
const sleep = (waitTimeInMs) =>
  new Promise((resolve) => setTimeout(resolve, waitTimeInMs));

// If there are no counters skip polling
if (env.PERFMON_COUNTERS) {
  try {
    const token = env.INFLUXDB_TOKEN;
    const org = env.INFLUXDB_ORG;
    const bucket = env.INFLUXDB_BUCKET;
    const client = new InfluxDB({
      url: env.INFLUXDB_URL,
      token: token,
    });

    const timer = env.COOLDOWN_TIMER;
    const interval = env.COUNTER_INTERVAL;

    var settings = {
      version: env.CUCM_VERSION,
      cucmip: env.CUCM_HOSTNAME,
      cucmuser: env.CUCM_USERNAME,
      cucmpass: env.CUCM_PASSWORD,
    };

    const perfmonObjectArr = env.PERFMON_COUNTERS.split(",");

    var axl_service = new axlService(
      settings.cucmip,
      settings.cucmuser,
      settings.cucmpass,
      settings.version
    );

    var perfmon_service = new perfMonService(
      settings.cucmip,
      settings.cucmuser,
      settings.cucmpass,
      settings.version
    );

    setIntervalAsync(async () => {
      console.log(
        "----------------------------------------------------------------------------------------------------------"
      );
      console.log(
        `PERFMON COUNTER DATA: Starting interval, collection will run every ${
          interval / 1000
        } seconds after last counter collected.`
      );

      // Let's get the servers via AXL
      var operation = "listCallManager";
      var tags = await axl_service.getOperationTags(operation);
      tags.searchCriteria.name = "%%";
      var servers = await axl_service
        .executeOperation(operation, tags)
        .catch((error) => {
          console.log(error);
        });

      console.log(
        `PERFMON COUNTER DATA: Found ${servers.callManager.length} servers from ${env.CUCM_HOSTNAME}.`
      );

      for (const server of servers.callManager) {
        for (const object of perfmonObjectArr) {
          const writeApi = client.getWriteApi(org, bucket);
          var points = [];
          await sleep(timer).then(async () => {
            console.log(
              `PERFMON COUNTER DATA: Starting cooldown between each object for ${
                timer / 1000
              } seconds.`
            );
            var perfmonOutput = await perfmon_service
              .collectCounterData(server.name, object)
              .catch((error) => {
                console.log("Error", error);
              });

            if (Array.isArray(perfmonOutput)) {
              // Filtering out non percentage values. We want to use session data to log this values
              const nonPercentage = perfmonOutput.filter(
                (object) =>
                  !object.counter.includes("%") &&
                  !object.counter.includes("Percentage")
              );

              nonPercentage.forEach((object) => {
                points.push(
                  new Point(object.object)
                    .tag("host", object.host)
                    .tag("cstatus", object.cstatus)
                    .tag("instance", object.instance)
                    .floatField(object.counter, object.value)
                );
              });
            } else {
              if (perfmonOutput.response === "empty") {
                console.log(`PERFMON COUNTER DATA: No data for ${object}`);
              } else {
                console.log("PERFMON COUNTER DATA: Sending exit to system");
                process.exit(1);
              }
            }

            writeApi.writePoints(points);
            writeApi
              .close()
              .then(() => {
                console.log(
                  `PERFMON COUNTER DATA: Wrote point for ${object} to InfluxDB bucket ${bucket}`
                );
              })
              .catch((e) => {
                console.log("PERFMON COUNTER DATA: InfluxDB write failed", e);
                process.exit(2);
              });
          });
        }
      }
    }, parseInt(interval));
  } catch (error) {
    console.log(error);
    process.exit(1);
  }
} else {
  console.log("PERFMON COUNTER DATA: No counters defined. Exiting.");
  process.exit(1);
}
