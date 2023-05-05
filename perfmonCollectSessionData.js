const axlService = require("cisco-axl");
const perfMonService = require("cisco-perfmon");
const { setIntervalAsync } = require("set-interval-async");
const { InfluxDB, Point } = require("@influxdata/influxdb-client");
const { cleanEnv, str, host, num } = require("envalid");

// If not production load the local env file
if(process.env.NODE_ENV === "development"){
  require('dotenv').config({ path: `${__dirname}/env/development.env` })
}else if(process.env.NODE_ENV === "test"){
  require('dotenv').config({ path: `${__dirname}/env/test.env` })
}else if(process.env.NODE_ENV === "staging"){
  require('dotenv').config({ path: `${__dirname}/env/staging.env` })
}

const versionValid = makeValidator(x => {
  if (/.*\..*[^\\]/.test(x)) return x.toUpperCase()
  else throw new Error('CUCM_VERSION must be in the format of ##.#')
})

const env = cleanEnv(process.env, {
  NODE_ENV: str({
    choices: ["development", "test", "production", "staging"],
    desc: "Node environment",
  }),
  CUCM_HOSTNAME: host({ desc: "Cisco CUCM Hostname or IP Address." }),
  CUCM_USERNAME: str({ desc: "Cisco CUCM AXL Username." }),
  CUCM_PASSWORD: str({ desc: "Cisco CUCM AXL Password." }),
  CUCM_VERSION: versionValid({ desc: "Cisco CUCM Version." , example: "12.5" }),
  COOLDOWN_TIMER: num({
    default: 5000,
    desc: "Cool down timer. Time between collecting data for each object.",
  }),
  SESSION_INTERVAL: num({
    default: 5000,
    desc: "Interval timer. Time between starting new collection period.",
  }),
  INFLUXDB_TOKEN: str({ desc: "InfluxDB API token." }),
  INFLUXDB_ORG: str({ desc: "InfluxDB organization id." }),
  INFLUXDB_BUCKET: str({ desc: "InfluxDB bucket to save data to." }),
  INFLUXDB_URL: str({ desc: "URL of InfluxDB. i.e. http://hostname:8086." }),
  PERFMON_SESSIONS: str({
    desc: "Comma separated string of what counters to query.",
  }),
});

// Add timestamp to console logs, after this point
require("log-timestamp");

// Cool down function
const sleep = (waitTimeInMs) =>
  new Promise((resolve) => setTimeout(resolve, waitTimeInMs));

// If there are no counters skip polling
if (env.PERFMON_SESSIONS) {
  // InfluxDB setup
  const token = env.INFLUXDB_TOKEN;
  const org = env.INFLUXDB_ORG;
  const bucket = env.INFLUXDB_BUCKET;
  const client = new InfluxDB({
    url: env.INFLUXDB_URL,
    token: token,
  });

  // Timer and interval setup
  const timer = env.COOLDOWN_TIMER;
  const interval = env.SESSION_INTERVAL;

  // CUCM settings
  var settings = {
    version: env.CUCM_VERSION,
    cucmip: env.CUCM_HOSTNAME,
    cucmuser: env.CUCM_USERNAME,
    cucmpass: env.CUCM_PASSWORD,
  };

  // Perfmon object array
  const perfmonObjectArr = env.PERFMON_SESSIONS.split(",");

  //  AXL and Perfmon service setup
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

  // Start the interval
  try {
    setIntervalAsync(async () => {
      console.log(
        "----------------------------------------------------------------------------------------------------------"
      );
      console.log(
        `PERFMON SESSION DATA: Starting interval, collection will run every ${
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
      
      // Loop thru each server and collect the counters
      for (const server of servers.callManager) {
        for (const object of perfmonObjectArr) {
          console.log("PERFMON SESSION DATA: Pulling data for", object);
          const writeApi = client.getWriteApi(org, bucket);
          var points = [];
          await sleep(timer).then(async () => {
            console.log(
              `PERFMON SESSION DATA: Starting cooldown between each object for ${
                timer / 1000
              } seconds.`
            );

            var counters = await perfmon_service.listCounter(server.name); // Get all the counters from the server

            if (!Array.isArray(counters)) {
              process.exit(2);
            }

            // Filter out the one we want for now
            var filteredArr = counters.filter((counter) => {
              return counter.Name === object;
            });

            var objInstance = await perfmon_service.listInstance(
              server.name,
              object
            );

            // If we only get back a single value, lets put it in an array anyways :/
            if (!Array.isArray(objInstance)) {
              var temp = objInstance;
              objInstance = [];
              objInstance.push(temp);
            }

            // Get session id for this counter
            var SessionID = await perfmon_service
              .openSession()
              .catch((error) => {
                console.log(error);
              });

            console.log(`PERFMON SESSION DATA: ${SessionID}`);

            var counterObjArr = [];

            for (let instance of objInstance) {
              // loop thru each counter and add to session id
              for (let item of filteredArr[0]?.ArrayOfCounter.item) {
                if (
                  item.Name.includes("Percentage") ||
                  item.Name.includes("%")
                ) {
                  let counterObj = {
                    host: server.name,
                    object: `${object}(${instance.Name})`,
                    counter: item.Name,
                  };
                  counterObjArr.push(counterObj);
                }
              }
            }

            let addCounter = await perfmon_service
              .addCounter(SessionID, counterObjArr)
              .catch((error) => {
                console.log(error);
              });

            console.log(
              `PERFMON SESSION DATA: addCounter status ${addCounter.response}`
            );

            var baseLineResults = await perfmon_service
              .collectSessionData(SessionID)
              .catch((error) => {
                console.log(error);
              });

            console.log(
              `PERFMON SESSION DATA: Collecting baseline results, ${baseLineResults.length} results collected.`
            );

            const delay = (ms) =>
              new Promise((resolve) => setTimeout(resolve, ms));
            console.log(
              "PERFMON SESSION DATA: Allowing 15 seconds to pass before collecting session data."
            );
            await delay(15000); /// waiting 15 second.

            let results = await perfmon_service
              .collectSessionData(SessionID)
              .catch((error) => {
                console.log(error);
              });

            if (Array.isArray(results)) {
              results.forEach(function (result) {
                points.push(
                  new Point(result.object)
                    .tag("host", result.host)
                    .tag("cstatus", result.cstatus)
                    .tag("instance", result.instance)
                    .floatField(result.counter, result.value)
                );
              });
              console.log(
                `PERFMON SESSION DATA: Collecting results, ${results.length} results collected.`
              );
            } else {
              if (results.response === "empty") {
                console.log(`PERFMON SESSION DATA: No data for ${object}`);
              } else {
                console.log("PERFMON SESSION DATA: Sending exit to system");
                process.exit(1);
              }
            }

            let removeCounter = await perfmon_service
              .removeCounter(SessionID, counterObjArr)
              .catch((error) => {
                console.log(error);
              });

            console.log(
              `PERFMON SESSION DATA: Removing counters ${removeCounter.response}.`
            );

            var closeSession = await perfmon_service
              .closeSession(SessionID)
              .catch((error) => {
                console.log(error);
              });

            console.log(
              `PERFMON SESSION DATA: Closing session ${closeSession.response}.`
            );

            writeApi.writePoints(points);
            writeApi
              .close()
              .then(() => {
                console.log(
                  `PERFMON SESSION DATA: Wrote point for ${object} to InfluxDB bucket ${bucket}`
                );
              })
              .catch((e) => {
                console.log("PERFMON SESSION DATA: InfluxDB write failed", e);
                process.exit(2);
              });
          });
        }
      }
    }, parseInt(interval));
  } catch (error) {
    process.exit(1);
  }
} else {
  console.log("PERFMON SESSION DATA: No counters defined. Exiting.");
  process.exit(1);
}
