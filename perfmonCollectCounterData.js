const perfMonService = require("cisco-perfmon");
const { setIntervalAsync, clearIntervalAsync } = require("set-interval-async/fixed");
const { InfluxDB, Point } = require("@influxdata/influxdb-client");
const pLimit = require("p-limit");
const { getBaseEnv, getCounterEnv, getServers } = require("./js/helpers");
const env = { ...getBaseEnv, ...getCounterEnv(true) };
const sessionSSO = require("./js/sessionSSO");
// Add timestamp to console logs
require("log-timestamp");

// This creates a gatekeeper that only allows 2 promises to run at once
const serverLimit = pLimit(env.PERFMON_SERVER_CONCURRENCY);
const objectLimit = pLimit(env.PERFMON_COUNTER_CONCURRENCY);

// Cool down function
const sleep = (waitTimeInMs) => new Promise((resolve) => setTimeout(resolve, waitTimeInMs));

// InfluxDB setup
const token = env.INFLUXDB_TOKEN;
const org = env.INFLUXDB_ORG;
const bucket = env.INFLUXDB_BUCKET;
const client = new InfluxDB({
  url: env.INFLUXDB_URL,
  token: token,
});

// Loop settings
const coolDownTimer = parseInt(env.PERFMON_COOLDOWN_TIMER);
var interval = parseInt(env.PERFMON_COUNTER_INTERVAL);

// Perfmon counters string to array
const perfmonObjectArr = env.PERFMON_COUNTERS.split(",");

//SSO Array to store cookies for each server. This is used to keep the session alive and reduce the number of logins per interval.
var ssoArr = sessionSSO.getSSOArray();

const transactionType = "PERFMON COUNTER DATA";
var rateControl = false;

try {
  let timer = setIntervalAsync(request, interval);

  async function request() {
    console.log("-".repeat(100));
    console.log(`${transactionType}: Starting interval, collection will run every ${interval / 1000} seconds after last counter collected.`);

    // Get the servers in the cluster
    var servers = await getServers(env);
    console.log(`${transactionType}: Found ${servers.callManager.length} server(s) in the cluster. Starting collection for each server, up to ${env.PERFMON_SERVER_CONCURRENCY} at a time, if applicable.`);

    const writeApi = client.getWriteApi(org, bucket);
    var points = [];

    const getPerfMonData = async (server) => {
      var jsonResults = {
        server: "",
        authMethod: "Basic Auth",
        results: [],
        cooldownTimer: coolDownTimer / 1000 + " second(s)",
        intervalTimer: interval / 1000 + " second(s)",
      };

      return new Promise(async (resolve, reject) => {
        try {
          // Set the server name in our results. This is used for logging.
          jsonResults.server = server.processNodeName.value;
          console.log(`${transactionType}: Collecting data for ${jsonResults.server}.`);

          // Set up the perfmon service. We will use this to collect the data from each server.
          var perfmon_service = new perfMonService(jsonResults.server, env.CUCM_USERNAME, env.CUCM_PASSWORD);
          console.log(`${transactionType}: Found ${perfmonObjectArr.length} counters to collect on ${jsonResults.server}. Collecting ${env.PERFMON_COUNTER_CONCURRENCY} counters at a time.`);

          // Set up function to collect the data for each counter. We will be using a promise to handle the async nature of the perfmon service.
          const perfMonLoop = async (object) => {
            return new Promise(async function (resolve, reject) {
              await sleep(coolDownTimer).then(async () => {
                // Let's see if we have a cookie for this server, if so we will use it instead of basic auth.
                const ssoIndex = ssoArr.findIndex((element) => element.name === jsonResults.server);
                if (ssoIndex !== -1) {
                  jsonResults.authMethod = "SSO";
                  // Update the perfmon service with the SSO auth cookie
                  perfmon_service = new perfMonService(jsonResults.server, "", "", { cookie: ssoArr[ssoIndex].cookie });
                }

                try {
                  // Collect the counter data from the server
                  var perfmonOutput = await perfmon_service.collectCounterData(jsonResults.server, object);

                  // If we have a cookie, let's update the SSO array with the new cookie
                  if (perfmonOutput.cookie) {
                    ssoArr = sessionSSO.updateSSO(jsonResults.server, { cookie: perfmonOutput.cookie });
                  }

                  // If we have results, let's filter out the non percentage values and add them to the points array.
                  if (perfmonOutput.results) {
                    // Filtering out non percentage values. We want to use session data to log this values
                    const nonPercentage = perfmonOutput.results.filter((object) => !object.counter.includes("%") && !object.counter.includes("Percentage"));
                    nonPercentage.forEach((object) => {
                      points.push(new Point(object.object).tag("host", object.host).tag("cstatus", object.cstatus).tag("instance", object.instance).floatField(object.counter, object.value));
                    });
                    jsonResults.results.push(`Collected ${points.length} points for ${object}.`);
                    resolve();
                  } else {
                    jsonResults.results.push(`No data for ${object}. Suggest removing counter if this feature is not used by cluster.`);
                    resolve();
                  }
                } catch (error) {
                  if (error.message.faultcode) {
                    jsonResults.results.push(`Error: ${error.message.faultcode} for ${object} counter.`);
                    if (error.message.faultcode === "RateControl") {
                      rateControl = true;
                    }
                    resolve();
                  } else if (error.message == 503) {
                    console.error("Service Unavailable. Possible Perfmon Service Error, received 503 error. Suggest rate limiting the number of counters or increasing the cooldown timer.");
                    reject("Error");
                  } else {
                    console.error("error", error);
                    reject("Error");
                  }
                }
              });
            });
          };

          // Let's run the perfmon loop for each counter
          const objectPromises = await perfmonObjectArr.map(async (object) => {
            return objectLimit(() => perfMonLoop(object));
          });

          // Wait for all counters to be collected before moving on. Note this is limited by the objectLimit concurrency.
          await Promise.all(objectPromises);

          // Add the points to the influxDB API.
          writeApi.writePoints(points);
          resolve(jsonResults);
        } catch (error) {
          reject(error);
        }
      });
    };

    // Let's run the perfmon data collection for each server. Note this is limited by the serverLimit concurrency.
    const serverPromises = await servers.callManager.map(async (server) => {
      return serverLimit(() => getPerfMonData(server));
    });

    // Get the results from all servers via Promise.all. This will wait for all servers to be collected before moving on.
    const influxResults = await Promise.all(serverPromises);

    // Log the results to the console
    console.log("INFLUX RESULTS:", influxResults);

    // Close the influxDB API
    await writeApi
      .close()
      .then(() => {
        console.log(`${transactionType}: InfluxDB writeApi closed.`);
      })
      .catch((e) => {
        console.error("PERFMON COUNTER DATA: InfluxDB write failed", e);
        // Exit the process if we encounter an error. This will cause PM2 to restart the process if code is anything other than 1.
        process.exit(5);
      });
    // Rate control detected. Let's increase the interval to self heal.
    if (rateControl) {
      clearIntervalAsync(timer); // stop the setInterval()
      console.warn(`${transactionType}: RateControl detected. Doubling interval timer in attempt to self heal. If this doesn't work suggest increasing the interval, cooldown timer or reducing the concurrency number of counters collected.`);
      interval = interval * 2;
      rateControl = false;
      // Update the console before restarting the interval
      timer = setIntervalAsync(request, interval);
    } else if (interval != env.PERFMON_COUNTER_INTERVAL) {
      clearIntervalAsync(timer); // stop the setInterval()
      interval = env.PERFMON_COUNTER_INTERVAL;
      // Update the console before restarting the interval
      timer = setIntervalAsync(request, interval);
    }
    console.log(`${transactionType}: Waiting ${interval / 1000} seconds before restarting.`);
  }
} catch (error) {
  console.error("Main Try:", error);
  // Exit the process if we encounter an error. This will cause PM2 to restart the process if code is anything other than 1.
  process.exit(5);
}
