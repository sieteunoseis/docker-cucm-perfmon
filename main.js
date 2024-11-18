const { Command } = require("commander");
const { getBaseEnv, getServers, getSessionConfig } = require("./js/helpers");
const { InfluxDB, Point } = require("@influxdata/influxdb-client");
const { setIntervalAsync, clearIntervalAsync } = require("set-interval-async/fixed");
const env = getBaseEnv;
const fs = require("fs").promises;
const path = require("path");
const perfMonService = require("cisco-perfmon");
const pLimit = require("p-limit");
const program = new Command();
const sessionSSO = require("./js/sessionSSO");
const validator = require("validator");

// Add timestamp to console logs, after this point
require("log-timestamp");

// This creates a gatekeeper that only allows 2 promises to run at once
const serverLimit = pLimit(env.PM_SERVER_CONCURRENCY);
const objectLimit = pLimit(env.PM_OBJECT_COLLECT_ALL_CONCURRENCY);

// InfluxDB setup
const token = env.INFLUXDB_TOKEN;
const org = env.INFLUXDB_ORG;
const bucket = env.INFLUXDB_BUCKET;
const client = new InfluxDB({
  url: env.INFLUXDB_URL,
  token: token,
});

// Loop settings
const coolDownTimer = parseInt(env.PM_COOLDOWN_TIMER);
var interval = parseInt(env.PM_INTERVAL);

//SSO Array to store cookies for each server. This is used to keep the session alive and reduce the number of logins per interval.
var ssoArr = sessionSSO.getSSOArray();

// Rate control flag
var rateControl = false;

async function roundRobin(tasks, interval, increaseIntervalOnFailure) {
  let currentIndex = 0;
  let currentInterval = interval;
  const executeTask = async () => {
    try {
      const task = tasks[currentIndex];
      await task.fn(...task.args);
      console.log("-".repeat(100));
      // If task is successful, reset interval
      if (interval != currentInterval) {
        currentInterval = interval; // Reset interval if successful
        console.log("Reseting Interval:", currentInterval);
        clearIntervalAsync(intervalId);
        intervalId = setIntervalAsync(executeTask, currentInterval);
      }
    } catch (error) {
      if (error.action != "break") {
        console.error("Error executing task:", error);
        if (increaseIntervalOnFailure) {
          currentInterval *= 2; // Increase interval on failure
          clearIntervalAsync(intervalId);
          console.log("Interval set to:", currentInterval);
          intervalId = setIntervalAsync(executeTask, currentInterval);
        }
      } else {
        // Break out of the loop and remove from tasks array
        console.error("Error executing task:", error.message);
        if (tasks.length > 1) {
          tasks.splice(currentIndex, 1);
          clearIntervalAsync(intervalId);
          console.log("Interval set to:", currentInterval);
          intervalId = setIntervalAsync(executeTask, currentInterval);
        } else {
          clearIntervalAsync(intervalId);
        }
      }
    } finally {
      currentIndex = (currentIndex + 1) % tasks.length;
    }
  };
  var intervalId = setIntervalAsync(executeTask, currentInterval);
}

const retry = (fn, retriesLeft = env.PM_RETRY, retryInterval = env.PM_RETRY_DELAY, promiseDelay = env.PM_COOLDOWN_TIMER) => {
  return new Promise(async (resolve, reject) => {
    await new Promise((resolve) => setTimeout(resolve, promiseDelay));
    fn()
      .then(resolve)
      .catch((error) => {
        if (retriesLeft > 0) {
          setTimeout(() => {
            retry(fn, retriesLeft - 1, retryInterval).then(resolve, reject);
          }, retryInterval);
        } else {
          reject(error);
        }
      });
  });
};

const collectCounterData = async (servers, logPrefix) => {
  return new Promise(async (resolve, reject) => {
    const perfmonObjectArr = env.PM_OBJECT_COLLECT_ALL.split(",");
    const writeApi = client.getWriteApi(org, bucket);
    console.log(`${logPrefix}: Found ${servers.callManager.length} server(s) in the cluster. Starting collection for each server, up to ${env.PM_SERVER_CONCURRENCY} at a time, if applicable.`);

    const getPerfMonData = async (server) => {
      var jsonResults = {
        server: "",
        authMethod: {
          basic: 0,
          sso: 0,
        },
        results: {},
        cooldownTimer: coolDownTimer / 1000 + " second(s)",
        intervalTimer: interval / 1000 + " second(s)",
      };

      return new Promise(async (resolve, reject) => {
        try {
          // Set the server name in our results. This is used for logging.
          jsonResults.server = server.processNodeName.value;
          console.log(`${logPrefix}: Collecting data for ${jsonResults.server}.`);

          // Set up the perfmon service. We will use this to collect the data from each server.
          var perfmon_service = new perfMonService(jsonResults.server, env.CUCM_USERNAME, env.CUCM_PASSWORD);
          console.log(`${logPrefix}: Found ${perfmonObjectArr.length} object(s) to collect on ${jsonResults.server}. Collecting ${env.PM_OBJECT_COLLECT_ALL_CONCURRENCY} objects at a time.`);

          try {
            const ssoIndex = ssoArr.findIndex((element) => element.name === jsonResults.server);
            if (ssoIndex !== -1) {
              jsonResults.authMethod.sso++;
              // Update the perfmon service with the SSO auth cookie
              perfmon_service = new perfMonService(jsonResults.server, "", "", { cookie: ssoArr[ssoIndex].cookie });
            } else {
              jsonResults.authMethod.basic++;
              var listCounterResults = await perfmon_service.listCounter(jsonResults.server);
              // If we have a cookie, let's update the SSO array with the new cookie
              if (listCounterResults.cookie) {
                ssoArr = sessionSSO.updateSSO(jsonResults.server, { cookie: listCounterResults.cookie });
              }
            }
          } catch (error) {
            reject;
          }

          console.log(`${logPrefix}: Will attempt to collect up to ${env.PM_RETRY} times with a ${env.PM_RETRY_DELAY/1000} second delay between attempts.`);
          console.log(`${logPrefix}: Will wait ${env.PM_COOLDOWN_TIMER/1000} seconds between collecting each object.`);

          // Let's run the perfmon data collection for each counter. Note this is limited by the counterLimit concurrency.
          const promises = await perfmonObjectArr.map((object) => {
            return objectLimit(() => retry(() => perfmon_service.collectCounterData(jsonResults.server, object), env.PM_RETRY, env.PM_RETRY_DELAY, env.PM_COOLDOWN_TIMER));
          });

          // Wait for all promises to resolve
          let output = await Promise.allSettled(promises);

          // Map the output to a new array
          output = output.map((el) => {
            if (el.status === "fulfilled") {
              return el.value;
            } else {
              return el.reason;
            }
          });

          output = output.flat(1); // Flatten the array
          var points = []; // Set up array for InfluxDB points

          // Filter out the percentage counters
          const nonPercentageObjects = output.reduce((acc, obj) => {
            if(obj?.results && obj?.results.length > 0) {
              const matchingItems = obj.results.filter(item => !item?.counter.includes("%") && !item.counter?.includes("Percentage"));
              if (matchingItems.length > 0) {
                acc.push(matchingItems);
              }  
              return acc.flat(1);
            }else {
              return acc;
            }
          }, []);

          nonPercentageObjects.forEach((object) => {
            points.push(new Point(object.object).tag("host", object.host).tag("cstatus", object.cstatus).tag("instance", object.instance).floatField(object.counter, object.value));
          });

          let errors = {};
          let success = {};

          output.forEach((el) => {
            if(el?.status > 400) {
              errors[el.object] = (errors[el.object] || 0) + 1;
            }else if(el?.results && el?.results.length > 0) {
              el.results.forEach((result) => {
                success[result.object] = (success[result.object] || 0) + 1;
              })
            }
          });

          let results = {
            success: success,
            errors: errors,
          };

          // If we have errors, we will rate control
          if (Object.keys(errors).length) {
            rateControl = true;
          }

          jsonResults.results = results;

          // Add the points to the influxDB API.
          writeApi.writePoints(points);
          console.log(`${logPrefix}: Wrote ${points.length} points to InfluxDB bucket ${bucket} for ${jsonResults.server}.`);
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
    console.log(`${logPrefix}: INFLUX RESULTS =`, influxResults);

    // Close the influxDB API
    await writeApi
      .close()
      .then(() => {
        console.log(`${logPrefix}: InfluxDB writeApi closed.`);
      })
      .catch((e) => {
        console.error("PERFMON COUNTER DATA: InfluxDB write failed", e);
        // Exit the process if we encounter an error. This will cause PM2 to restart the process if code is anything other than 1.
        process.exit(0);
      });

    // Check if we need to rate control
    if (rateControl) {
      // Reset rate control back to false
      rateControl = false;
      // Reject the promise to increase the interval
      reject("RateControl detected.");
    } else {
      resolve();
    }
  });
};

const collectSessionData = async (servers, logPrefix) => {
  return new Promise(async (resolve, reject) => {
    const perfmonSessionArr = env.PM_OBJECT_SESSION_PERCENTANGE.split(",");
    const writeApi = client.getWriteApi(org, bucket);
    console.log(`${logPrefix}: Found ${servers.callManager.length} server(s) in the cluster. Starting collection for each server, up to ${env.PM_SERVER_CONCURRENCY} at a time, if applicable.`);
    let points = [];
    const getPerfMonData = async (server) => {
      let jsonResults = {
        server: "",
        authMethod: {
          basic: 0,
          sso: 0,
        },
        results: [],
        cooldownTimer: coolDownTimer / 1000 + " second(s)",
        intervalTimer: interval / 1000 + " second(s)",
      };
      return new Promise(async (resolve, reject) => {
        jsonResults.server = server.processNodeName.value;
        console.log(`${logPrefix}: Collecting data for ${jsonResults.server}.`);

        var perfmon_service = new perfMonService(jsonResults.server, env.CUCM_USERNAME, env.CUCM_PASSWORD);
        console.log(`${logPrefix}: Found ${perfmonSessionArr.length} objects to collect on ${jsonResults.server}.`);

        // Let's see if we have a cookie for this server, if so we will use it instead of basic auth.
        const ssoIndex = ssoArr.findIndex((element) => element.name === jsonResults.server);
        if (ssoIndex !== -1) {
          jsonResults.authMethod.sso++;
          // Update the perfmon service with the SSO auth cookie
          perfmon_service = new perfMonService(jsonResults.server, "", "", { cookie: ssoArr[ssoIndex].cookie });
        } else {
          jsonResults.authMethod.basic++;
        }

        var objectCollectArr = [];

        await perfmon_service
          .listCounter(jsonResults.server, perfmonSessionArr)
          .then(async (response) => {
            const listCounterResults = response.results;
            const listCounterCookie = response.cookie;
            if (listCounterCookie) {
              ssoArr = sessionSSO.updateSSO(jsonResults.server, { cookie: listCounterCookie });
            }
            for (item of perfmonSessionArr) {
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
                        instance: "",
                        counter: "",
                      };
                      output.host = jsonResults.server;
                      output.object = item;
                      output.instance = MultiInstance != "false" ? instance.Name : "";
                      output.counter = counter.Name;
                      objectCollectArr.push(output);
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
                    jsonResults.results.push(`Error: Received ${error.message} for listInstance. Application can only retry on SSO authentication.`);
                    resolve();
                  } else {
                    console.error("listInstance Error:", error);
                    process.exit(0);
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
              jsonResults.results.push(`Error: Received ${error.message} for listCounter. Application can only retry on SSO authentication.`);
              resolve();
            } else {
              console.error("listCounter Error:", error);
              process.exit(0);
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
            process.exit(0);
          }
        } catch (error) {
          if (error.message.faultcode) {
            jsonResults.results.push(`openSession Error: ${error.message.faultcode} for ${jsonResults.server}.`);
            if (error.message.faultcode === "RateControl") {
              rateControl = true;
            }
            resolve(jsonResults);
          } else if (error.message == 503) {
            jsonResults.results.push(`Error: Received ${error.message} for openSession. Application can only retry on SSO authentication.`);
            resolve();
          } else {
            console.error("openSession Error:", error);
            process.exit(0);
          }
        }

        try {
          // Collect the counter data from the server
          let addCounterResults = await perfmon_service.addCounter(sessionId, objectCollectArr);
          if (addCounterResults.results) {
            jsonResults.results.push(`addCounter: Adding object(s) for ${jsonResults.server} with SessionId ${sessionIdResults.results} = ${addCounterResults.results}.`);
          } else {
            console.log("addCounter Error: No results returned.");
            process.exit(0);
          }
        } catch (error) {
          if (error.message.faultcode) {
            jsonResults.results.push(`addCounter Error: ${error.message.faultcode} for ${jsonResults.server}.`);
            if (error.message.faultcode === "RateControl") {
              rateControl = true;
            }
            resolve(jsonResults);
          } else if (error.message == 503) {
            jsonResults.results.push(`Error: Received ${error.message} for addCounter. Application can only retry on SSO authentication.`);
            resolve();
          } else {
            console.error("addCounter Error:", error);
            process.exit(0);
          }
        }

        try {
          // Collect the counter data from the server. This baseline data is used to calculate the percentage counters. We do not save this data to InfluxDB.
          var baseLineResults = await perfmon_service.collectSessionData(sessionId);
          if (baseLineResults.results) {
            jsonResults.results.push(`collectSessionData: Collected ${baseLineResults.results.length} baseline points for ${jsonResults.server}.`);
          } else {
            console.log("collectSessionData Error: No results returned.");
            process.exit(0);
          }
        } catch (error) {
          if (error.message.faultcode) {
            jsonResults.results.push(`collectSessionData Error: ${error.message.faultcode} for ${jsonResults.server}.`);
            if (error.message.faultcode === "RateControl") {
              rateControl = true;
            }
            resolve(jsonResults);
          } else if (error.message == 503) {
            jsonResults.results.push(`Error: Received ${error.message} for collectSessionData. Application can only retry on SSO authentication.`);
            resolve();
          } else {
            console.error("collectSessionData Error:", error);
            process.exit(0);
          }
        }

        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        await delay(env.PM_OBJECT_SESSION_PERCENTANGE_SLEEP); // sleeping for 15 seconds to allow the server to generate the counter data

        console.log(`${logPrefix}: Waiting 15 seconds for ${jsonResults.server} to generate counter data.`);

        try {
          // Collect the counter data from the server
          let collectSessionResults = await perfmon_service.collectSessionData(sessionId);

          if (collectSessionResults.results) {
            collectSessionResults.results.forEach(function (result) {
              points.push(new Point(result.object).tag("host", result.host).tag("cstatus", result.cstatus).tag("instance", result.instance).floatField(result.counter, result.value));
            });
            jsonResults.results.push(`collectSessionData: Collected ${collectSessionResults.results.length} observation points for ${jsonResults.server} after sleeping for ${env.PM_OBJECT_SESSION_PERCENTANGE_SLEEP}ms.`);
          } else {
            console.log("collectSessionData Error: No results returned.");
            process.exit(0);
          }
        } catch (error) {
          if (error.message.faultcode) {
            jsonResults.results.push(`collectSessionData Error: ${error.message.faultcode} for ${jsonResults.server}.`);
            if (error.message.faultcode === "RateControl") {
              rateControl = true;
            }
            resolve(jsonResults);
          } else if (error.message == 503) {
            jsonResults.results.push(`Error: Received ${error.message} for collectSessionData. Application can only retry on SSO authentication.`);
            resolve();
          } else {
            console.error("collectSessionData Error:", error);
            process.exit(0);
          }
        }

        try {
          // Collect the counter data from the server
          let removeCounterResults = await perfmon_service.removeCounter(sessionId, objectCollectArr);
          if (removeCounterResults.results) {
            jsonResults.results.push(`removeCounter: Removing objects for ${jsonResults.server} = ${removeCounterResults.results}.`);
          } else {
            console.log("removeCounter Error: No results returned.");
            process.exit(0);
          }
        } catch (error) {
          if (error.message.faultcode) {
            jsonResults.results.push(`removeCounter Error: ${error.message.faultcode} for ${jsonResults.server}.`);
            if (error.message.faultcode === "RateControl") {
              rateControl = true;
            }
            resolve(jsonResults);
          } else if (error.message == 503) {
            jsonResults.results.push(`Error: Received ${error.message} for removeCounter. Application can only retry on SSO authentication.`);
            resolve();
          } else {
            console.error("removeCounter Error:", error);
            process.exit(0);
          }
        }

        try {
          // Collect the counter data from the server
          var closeSession = await perfmon_service.closeSession(sessionId);
          if (closeSession.results) {
            jsonResults.results.push(`closeSession: Closing session for ${jsonResults.server} = ${closeSession.results}.`);

            // Write the points to InfluxDB only if we made it this far.
            writeApi.writePoints(points);
            console.log(`${logPrefix}: Wrote ${points.length} points to InfluxDB bucket ${bucket} for ${jsonResults.server}.`);
            // Resolve the promise
            resolve(jsonResults);
          } else {
            console.log("closeSession Error: No results returned.");
            process.exit(0);
          }
        } catch (error) {
          if (error.message.faultcode) {
            jsonResults.results.push(`closeSession Error: ${error.message.faultcode} for ${jsonResults.server}.`);
            if (error.message.faultcode === "RateControl") {
              rateControl = true;
            }
            resolve(jsonResults);
          } else if (error.message == 503) {
            jsonResults.results.push(`Error: Received ${error.message} for closeSession. Application can only retry on SSO authentication.`);
            resolve();
          } else {
            console.error("closeSession Error:", error);
            process.exit(0);
          }
        }
      });
    };

    const serverPromises = await servers.callManager.map(async (server) => {
      return serverLimit(() => getPerfMonData(server));
    });

    const influxResults = await Promise.all(serverPromises);

    console.log(`${logPrefix}: INFLUX RESULTS =`, influxResults);

    await writeApi
      .close()
      .then(() => {
        console.log(`${logPrefix}: InfluxDB writeApi closed.`);
      })
      .catch((e) => {
        console.log("${sessionLogInfo}: InfluxDB write failed", e);
        process.exit(0);
      });

    // Check if we need to rate control
    if (rateControl) {
      // Reset rate control back to false
      rateControl = false;
      // Reject the promise to increase the interval
      reject("RateControl detected.");
    } else {
      resolve();
    }
  });
};

const collectSessionConfig = async (data, logPrefix) => {
  return new Promise(async (resolve, reject) => {
    const writeApi = client.getWriteApi(org, bucket);
    console.log(`${logPrefix}: Starting collection from ${env.CUCM_HOSTNAME}, using config.json file`);
    var parsedData = JSON.parse(data);
    let points = [];

    var collectSessionData = () => {
      return new Promise(async (resolve) => {
        let jsonResults = {
          server: "",
          authMethod: {
            basic: 0,
            sso: 0,
          },
          results: [],
          cooldownTimer: coolDownTimer / 1000 + " second(s)",
          intervalTimer: interval / 1000 + " second(s)",
        };
        var perfmon_service = new perfMonService(env.CUCM_HOSTNAME, env.CUCM_USERNAME, env.CUCM_PASSWORD);
        console.log(`${logPrefix}: Found ${parsedData.length} objects to collect on ${env.CUCM_HOSTNAME}.`);

        // Let's see if we have a cookie for this server, if so we will use it instead of basic auth.
        const ssoIndex = ssoArr.findIndex((element) => element.name === env.CUCM_HOSTNAME);
        if (ssoIndex !== -1) {
          jsonResults.authMethod.sso++;
          // Update the perfmon service with the SSO auth cookie
          perfmon_service = new perfMonService(env.CUCM_HOSTNAME, "", "", { cookie: ssoArr[ssoIndex].cookie });
        } else {
          jsonResults.authMethod.basic++;
        }

        try {
          // Collect the object data from the server
          var sessionIdResults = await perfmon_service.openSession();

          if (sessionIdResults?.results) {
            var sessionId = sessionIdResults.results;
            jsonResults.results.push(`openSession: Opening session for ${env.CUCM_HOSTNAME} = ${sessionId}.`);
          } else {
            console.log("openSession Error: No results returned.");
            process.exit(0);
          }
        } catch (error) {
          if (error.message.faultcode) {
            jsonResults.results.push(`openSession Error: ${error.message.faultcode} for ${env.CUCM_HOSTNAME}.`);
            if (error.message.faultcode === "RateControl") {
              rateControl = true;
            }
            resolve(jsonResults);
          } else if (error.message == 503) {
            jsonResults.results.push(`Error: Received ${error.message} for openSession. Application can only retry on SSO authentication.`);
            resolve();
          } else {
            console.error("openSession Error:", error);
            process.exit(0);
          }
        }

        try {
          // Collect the counter data from the server
          let addCounterResults = await perfmon_service.addCounter(sessionId, parsedData);
          if (addCounterResults.results) {
            jsonResults.results.push(`addCounter: Adding object(s) for ${env.CUCM_HOSTNAME} with SessionId ${sessionIdResults.results} = ${addCounterResults.results}.`);
          } else {
            console.log("addCounter Error: No results returned.");
            process.exit(0);
          }
        } catch (error) {
          if (error.message.faultcode) {
            jsonResults.results.push(`addCounter Error: ${error.message.faultcode} for ${env.CUCM_HOSTNAME}.`);
            if (error.message.faultcode === "RateControl") {
              rateControl = true;
            }
            resolve(jsonResults);
          } else if (error.message == 503) {
            jsonResults.results.push(`Error: Received ${error.message} for addCounter. Application can only retry on SSO authentication.`);
            resolve();
          } else {
            console.error("addCounter Error:", error);
            process.exit(0);
          }
        }

        try {
          // Collect the counter data from the server
          let collectSessionResults = await perfmon_service.collectSessionData(sessionId);

          if (collectSessionResults.results) {
            collectSessionResults.results.forEach(function (result) {
              points.push(new Point(result.object).tag("host", result.host).tag("cstatus", result.cstatus).tag("instance", result.instance).floatField(result.counter, result.value));
            });
            jsonResults.results.push(`collectSessionData: Collected ${collectSessionResults.results.length} observation points from ${env.CUCM_HOSTNAME}.`);
          } else {
            console.log("collectSessionData Error: No results returned.");
            process.exit(0);
          }
        } catch (error) {
          if (error.message.faultcode) {
            jsonResults.results.push(`collectSessionData Error: ${error.message.faultcode} for ${env.CUCM_HOSTNAME}.`);
            if (error.message.faultcode === "RateControl") {
              rateControl = true;
            }
            resolve(jsonResults);
          } else if (error.message == 503) {
            jsonResults.results.push(`Error: Received ${error.message} for collectSessionData. Application can only retry on SSO authentication.`);
            resolve();
          } else {
            console.error("collectSessionData Error:", error);
            process.exit(0);
          }
        }

        try {
          // Collect the counter data from the server
          let removeCounterResults = await perfmon_service.removeCounter(sessionId, parsedData);
          if (removeCounterResults.results) {
            jsonResults.results.push(`removeCounter: Removing object(s) for ${env.CUCM_HOSTNAME} = ${removeCounterResults.results}.`);
          } else {
            console.log("removeCounter Error: No results returned.");
            process.exit(0);
          }
        } catch (error) {
          if (error.message.faultcode) {
            jsonResults.results.push(`removeCounter Error: ${error.message.faultcode} for ${env.CUCM_HOSTNAME}.`);
            if (error.message.faultcode === "RateControl") {
              rateControl = true;
            }
            resolve(jsonResults);
          } else if (error.message == 503) {
            jsonResults.results.push(`Error: Received ${error.message} for removeCounter. Application can only retry on SSO authentication.`);
            resolve();
          } else {
            console.error("removeCounter Error:", error);
            process.exit(0);
          }
        }

        try {
          // Collect the counter data from the server
          var closeSession = await perfmon_service.closeSession(sessionId);
          if (closeSession.results) {
            jsonResults.results.push(`closeSession: Closing session for ${env.CUCM_HOSTNAME} = ${closeSession.results}.`);

            // Write the points to InfluxDB only if we made it this far.
            writeApi.writePoints(points);
            console.log(`${logPrefix}: Wrote ${points.length} points to InfluxDB bucket ${bucket} from ${env.CUCM_HOSTNAME}.`);
            // Resolve the promise
            resolve(jsonResults);
          } else {
            console.log("closeSession Error: No results returned.");
            process.exit(0);
          }
        } catch (error) {
          if (error.message.faultcode) {
            jsonResults.results.push(`closeSession Error: ${error.message.faultcode} for ${env.CUCM_HOSTNAME}.`);
            if (error.message.faultcode === "RateControl") {
              rateControl = true;
            }
            resolve(jsonResults);
          } else if (error.message == 503) {
            jsonResults.results.push(`Error: Received ${error.message} for closeSession. Application can only retry on SSO authentication.`);
            resolve();
          } else {
            console.error("closeSession Error:", error);
            process.exit(0);
          }
        }
      });
    };

    var influxResults = await collectSessionData();

    console.log(`${logPrefix}: INFLUX RESULTS =`, influxResults);

    await writeApi
      .close()
      .then(() => {
        console.log(`${logPrefix}: InfluxDB writeApi closed.`);
      })
      .catch((e) => {
        console.log("${sessionLogInfo}: InfluxDB write failed", e);
        process.exit(0);
      });

    // Check if we need to rate control
    if (rateControl) {
      // Reset rate control back to false
      rateControl = false;
      // Reject the promise to increase the interval
      reject("RateControl detected.");
    } else {
      resolve();
    }
  });
};

async function checkAndRead(filePath) {
  try {
    // Check if the file exists
    await fs.access(filePath);

    // Read the file contents
    const data = await fs.readFile(filePath, "utf-8");
    return data;
  } catch (err) {
    if (err.code === "ENOENT") {
      console.error("PERFMON SESSION CONFIG: File does not exist:", filePath, "Skipping collection via config file.");
    } else {
      console.error("PERFMON SESSION CONFIG Error accessing file:", err);
    }
    return null;
  }
}

function commaSeparatedList(value) {
  return value.split(",");
}

function validateFQDN(value) {
  if (validator.isFQDN(value) || validator.isIP(value)) {
    return value;
  } else {
    throw new commander.InvalidOptionArgumentError("Invalid FQDN/IP Address format");
  }
}

(async () => {
  program
    .command("config")
    .description("download config file")
    .requiredOption("-s,--server <fqdn>", "Fully qualified domain name or IP Address.", validateFQDN)
    .requiredOption("-o, --objects <objects>", "Comma separated list of objects.", commaSeparatedList)
    .action(async (options) => {
      try {
        const config = await getSessionConfig(options.server, options.objects);
        // Convert JSON object to string
        const jsonString = JSON.stringify(config);
        // Write JSON string to file
        // Get the current date
        const currentDate = new Date();

        // Format the date as YYYY-MM-DD
        const formattedDate = currentDate.toISOString().slice(0, 10);

        // Create a filename with the formatted date
        const filename = `config.${formattedDate}.json`;
        await fs.writeFile(path.join(__dirname, "data", filename), jsonString);
        console.log(`PERFMON SESSION CONFIG: ${filename} successfully saved.`);
      } catch (err) {
        console.error("Error:", err);
      }
    });

  program
    .command("run", { isDefault: true })
    .description("Run the server natively")
    .action(async () => {
      // Get the servers from the AXL API or ENV. If we can't get the servers, we will exit the process.
      try {
        var servers = await getServers(env);
      } catch (error) {
        console.error(error);
        process.exit(0);
      }

      try {
        var tasks = [];
        await checkAndRead(path.join(__dirname, "data", "config.json")).then((data) => {
          if (data) {
            tasks.push({ fn: collectSessionConfig, args: [data, "PERFMON SESSION CONFIG"] });
          }
        });

        if (env.PM_OBJECT_COLLECT_ALL) {
          tasks.push({ fn: collectCounterData, args: [servers, "PERFMON COUNTER DATA"] });
        } else {
          console.log("PM_OBJECT_COLLECT_ALL env variable not set. Skipping collection.");
        }

        if (env.PM_OBJECT_SESSION_PERCENTANGE) {
          tasks.push({ fn: collectSessionData, args: [servers, "PERFMON SESSION DATA"] });
        } else {
          console.log("PM_OBJECT_SESSION_PERCENTANGE env variable not set. Skipping collection.");
        }

        if (tasks.length > 0) {
          roundRobin(tasks, interval, true); // Start round-robin execution
        } else {
          console.log("No tasks to execute found. Exiting.");
          process.exit(0);
        }
      } catch (error) {
        console.error(error);
        process.exit(0);
      }
    });

  program.parse(process.argv);
})();
