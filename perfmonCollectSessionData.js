const perfMonService = require("cisco-perfmon");
const { setIntervalAsync, clearIntervalAsync } = require("set-interval-async/fixed");
const { InfluxDB, Point } = require("@influxdata/influxdb-client");
const pLimit = require("p-limit");
const { getBaseEnv, getSessionEnv, getServers } = require("./js/helpers");
const env = { ...getBaseEnv, ...getSessionEnv(true) };
const sessionSSO = require("./js/sessionSSO");
const { port } = require("envalid");
// Add timestamp to console logs, after this point
require("log-timestamp");

// This creates a gatekeeper that only allows 2 promises to run at once
const serverLimit = pLimit(env.PERFMON_SERVER_CONCURRENCY);

// InfluxDB setup
const token = env.INFLUXDB_TOKEN;
const org = env.INFLUXDB_ORG;
const bucket = env.INFLUXDB_BUCKET;
const client = new InfluxDB({
  url: env.INFLUXDB_URL,
  token: token,
});

// Timer and interval setup
const coolDownTimer = parseInt(env.PERFMON_COOLDOWN_TIMER);
var interval = parseInt(env.PERFMON_SESSION_INTERVAL);

// Perfmon object array
const perfmonObjectArr = env.PERFMON_SESSIONS.split(",");

//SSO Array to store cookies for each server. This is used to keep the session alive and reduce the number of logins per interval.
var ssoArr = sessionSSO.getSSOArray();

const transactionType = "PERFMON SESSION DATA";
var rateControl = false;

// Start the interval
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
      let jsonResults = {
        server: "",
        authMethod: "Basic Auth",
        results: [],
        cooldownTimer: coolDownTimer / 1000 + " second(s)",
        intervalTimer: interval / 1000 + " second(s)",
      };
      return new Promise(async (resolve, reject) => {
        jsonResults.server = server.processNodeName.value;
        console.log(`${transactionType}: Collecting data for ${jsonResults.server}.`);

        var perfmon_service = new perfMonService(jsonResults.server, env.CUCM_USERNAME, env.CUCM_PASSWORD);
        console.log(`${transactionType}: Found ${perfmonObjectArr.length} counters to collect on ${jsonResults.server}.`);

        // Let's see if we have a cookie for this server, if so we will use it instead of basic auth.
        const ssoIndex = ssoArr.findIndex((element) => element.name === jsonResults.server);
        if (ssoIndex !== -1) {
          jsonResults.authMethod = "SSO";
          // Update the perfmon service with the SSO auth cookie
          perfmon_service = new perfMonService(jsonResults.server, "", "", { cookie: ssoArr[ssoIndex].cookie });
        }

        var counterObjArr = [];

        await perfmon_service
          .listCounter(jsonResults.server, perfmonObjectArr)
          .then(async (response) => {
            const listCounterResults = response.results;
            const listCounterCookie = response.cookie;
            if (listCounterCookie) {
              ssoArr = sessionSSO.updateSSO(jsonResults.server, { cookie: listCounterCookie });
            }
            for (item of perfmonObjectArr) {
              await perfmon_service
                .listInstance(jsonResults.server, item)
                .then((response) => {
                  var listInstanceResults = response;
                  const findCounter = listCounterResults.find((counter) => counter.Name === item);
                  var MultiInstance = findCounter.MultiInstance;
                  var locatePercentCounter = findCounter.ArrayOfCounter.item.filter(function (item) {
                    if (item.Name.includes("Percentage") || item.Name.includes("%")) {
                      return item;
                    }
                  });

                  // Loop through the list of instances and counters
                  for (const counter of locatePercentCounter) {
                    for (const instance of listInstanceResults.results) {
                      let output = {
                        host: "",
                        object: "",
                        counter: "",
                      };
                      output.host = jsonResults.server;
                      output.object = MultiInstance != "false" ? `${item}(${instance.Name})` : `${item}`;
                      output.counter = counter.Name;
                      counterObjArr.push(output);
                    }
                  }
                })
                .catch((error) => {
                  if (error.message.faultcode) {
                    jsonResults.results.push(`listInstance Error: ${error.message.faultcode} for ${jsonResults.server}.`);
                    if (error.message.faultcode === "RateControl") {
                      rateControl = true;
                    }
                    resolve(jsonResults);
                  } else if (error.message == 503) {
                    console.error("listInstance Error: Service Unavailable. Possible Perfmon Service Error, received 503 error. Suggest rate limiting the number of counters or increasing the cooldown timer.");
                    process.exit(5);
                  } else {
                    console.error("listInstance Error:", error);
                    process.exit(5);
                  }
                });
            }
          })
          .catch((error) => {
            if (error.message.faultcode) {
              jsonResults.results.push(`listCounter Error: ${error.message.faultcode} for ${jsonResults.server}.`);
              if (error.message.faultcode === "RateControl") {
                rateControl = true;
              }
              resolve(jsonResults);
            } else if (error.message == 503) {
              console.error("listCounter Error: Service Unavailable. Possible Perfmon Service Error, received 503 error. Suggest rate limiting the number of counters or increasing the cooldown timer.");
              process.exit(5);
            } else {
              console.error("listCounter Error:", error);
              process.exit(5);
            }
          });

        try {
          // Collect the counter data from the server
          var sessionIdResults = await perfmon_service.openSession();

          if (sessionIdResults.results) {
            var sessionId = sessionIdResults.results;
            jsonResults.results.push(`openSession: Opening session for ${jsonResults.server} = ${sessionId}.`);
          } else {
            console.log("openSession Error: No results returned.");
            process.exit(5);
          }
        } catch (error) {
          if (error.message.faultcode) {
            jsonResults.results.push(`openSession Error: ${error.message.faultcode} for ${jsonResults.server}.`);
            if (error.message.faultcode === "RateControl") {
              rateControl = true;
            }
            resolve(jsonResults);
          } else if (error.message == 503) {
            console.error("openSession Error: Service Unavailable. Possible Perfmon Service Error, received 503 error. Suggest rate limiting the number of counters or increasing the cooldown timer.");
            process.exit(5);
          } else {
            console.error("openSession Error:", error);
            process.exit(5);
          }
        }

        try {
          // Collect the counter data from the server
          let addCounterResults = await perfmon_service.addCounter(sessionId, counterObjArr);
          if (addCounterResults.results) {
            jsonResults.results.push(`addCounter: Adding counter for ${jsonResults.server} with SessionId ${sessionIdResults.results} = ${addCounterResults.results}.`);
          } else {
            console.log("addCounter Error: No results returned.");
            process.exit(5);
          }
        } catch (error) {
          if (error.message.faultcode) {
            jsonResults.results.push(`addCounter Error: ${error.message.faultcode} for ${jsonResults.server}.`);
            if (error.message.faultcode === "RateControl") {
              rateControl = true;
            }
            resolve(jsonResults);
          } else if (error.message == 503) {
            console.error("addCounter Error: Service Unavailable. Possible Perfmon Service Error, received 503 error. Suggest rate limiting the number of counters or increasing the cooldown timer.");
            process.exit(5);
          } else {
            console.error("addCounter Error:", error);
            process.exit(5);
          }
        }

        try {
          // Collect the counter data from the server
          var baseLineResults = await perfmon_service.collectSessionData(sessionId);

          if (baseLineResults.results) {
            jsonResults.results.push(`collectSessionData: Collected ${baseLineResults.results.length} baseline points for ${jsonResults.server}.`);
          } else {
            console.log("collectSessionData Error: No results returned.");
            process.exit(5);
          }
        } catch (error) {
          if (error.message.faultcode) {
            jsonResults.results.push(`collectSessionData Error: ${error.message.faultcode} for ${jsonResults.server}.`);
            if (error.message.faultcode === "RateControl") {
              rateControl = true;
            }
            resolve(jsonResults);
          } else if (error.message == 503) {
            console.error("collectSessionData Error: Service Unavailable. Possible Perfmon Service Error, received 503 error. Suggest rate limiting the number of counters or increasing the cooldown timer.");
            process.exit(5);
          } else {
            console.error("collectSessionData Error:", error);
            process.exit(5);
          }
        }

        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        await delay(env.PERFMON_SESSIONS_SLEEP); // sleeping for percentage counters to collect data

        console.log(`PERFMON SESSION DATA: Waiting 15 seconds for ${jsonResults.server} to generate counter data.`);

        try {
          // Collect the counter data from the server
          let collectSessionResults = await perfmon_service.collectSessionData(sessionId);

          if (collectSessionResults.results) {
            collectSessionResults.results.forEach(function (result) {
              points.push(new Point(result.object).tag("host", result.host).tag("cstatus", result.cstatus).tag("instance", result.instance).floatField(result.counter, result.value));
            });
            jsonResults.results.push(`collectSessionData: Collected ${collectSessionResults.results.length} observation points for ${jsonResults.server} after sleeping for ${env.PERFMON_SESSIONS_SLEEP}ms.`);
          } else {
            console.log("collectSessionData Error: No results returned.");
            process.exit(5);
          }
        } catch (error) {
          if (error.message.faultcode) {
            jsonResults.results.push(`collectSessionData Error: ${error.message.faultcode} for ${jsonResults.server}.`);
            if (error.message.faultcode === "RateControl") {
              rateControl = true;
            }
            resolve(jsonResults);
          } else if (error.message == 503) {
            console.error("collectSessionData Error: Service Unavailable. Possible Perfmon Service Error, received 503 error. Suggest rate limiting the number of counters or increasing the cooldown timer.");
            process.exit(5);
          } else {
            console.error("collectSessionData Error:", error);
            process.exit(5);
          }
        }

        try {
          // Collect the counter data from the server
          let removeCounterResults = await perfmon_service.removeCounter(sessionId, counterObjArr);
          if (removeCounterResults.results) {
            jsonResults.results.push(`removeCounter: Removing counters for ${jsonResults.server} = ${removeCounterResults.results}.`);
          } else {
            console.log("removeCounter Error: No results returned.");
            process.exit(5);
          }
        } catch (error) {
          if (error.message.faultcode) {
            jsonResults.results.push(`removeCounter Error: ${error.message.faultcode} for ${jsonResults.server}.`);
            if (error.message.faultcode === "RateControl") {
              rateControl = true;
            }
            resolve(jsonResults);
          } else if (error.message == 503) {
            console.error("removeCounter Error: Service Unavailable. Possible Perfmon Service Error, received 503 error. Suggest rate limiting the number of counters or increasing the cooldown timer.");
            process.exit(5);
          } else {
            console.error("removeCounter Error:", error);
            process.exit(5);
          }
        }

        try {
          // Collect the counter data from the server
          var closeSession = await perfmon_service.closeSession(sessionId);
          if (closeSession.results) {
            jsonResults.results.push(`closeSession: Closing session for ${jsonResults.server} = ${closeSession.results}.`);

            // Write the points to InfluxDB only if we made it this far.
            writeApi.writePoints(points);
            console.log(`${transactionType}: Wrote ${points.length} points to InfluxDB bucket ${bucket} for ${jsonResults.server}.`);
            // Resolve the promise
            resolve(jsonResults);
          } else {
            console.log("closeSession Error: No results returned.");
            process.exit(5);
          }
        } catch (error) {
          if (error.message.faultcode) {
            jsonResults.results.push(`closeSession Error: ${error.message.faultcode} for ${jsonResults.server}.`);
            if (error.message.faultcode === "RateControl") {
              rateControl = true;
            }
            resolve(jsonResults);
          } else if (error.message == 503) {
            console.error("closeSession Error: Service Unavailable. Possible Perfmon Service Error, received 503 error. Suggest rate limiting the number of counters or increasing the cooldown timer.");
            process.exit(5);
          } else {
            console.error("closeSession Error:", error);
            process.exit(5);
          }
        }
      });
    };

    const serverPromises = await servers.callManager.map(async (server) => {
      return serverLimit(() => getPerfMonData(server));
    });

    const influxResults = await Promise.all(serverPromises);

    console.log("INFLUX RESULTS:", influxResults);

    await writeApi
      .close()
      .then(() => {
        console.log(`${transactionType}: InfluxDB writeApi closed.`);
      })
      .catch((e) => {
        console.log("PERFMON SESSION DATA: InfluxDB write failed", e);
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
    } else if (interval != env.PERFMON_SESSION_INTERVAL) {
      clearIntervalAsync(timer); // stop the setInterval()
      interval = parseInt(env.PERFMON_SESSION_INTERVAL);
      // Update the console before restarting the interval
      timer = setIntervalAsync(request, interval);
    }
    console.log(`${transactionType}: Waiting ${interval / 1000} seconds before restarting.`);
  }
} catch (error) {
  console.log(error);
  process.exit(5);
}
