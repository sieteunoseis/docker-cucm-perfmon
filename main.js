const { Command } = require("commander");
const { getBaseEnv, getServers, getSessionConfig } = require("./js/helpers");
const { InfluxDB, Point } = require("@influxdata/influxdb-client");
const { setIntervalAsync, clearIntervalAsync } = require("set-interval-async/fixed");
const env = getBaseEnv;
const fs = require("fs").promises;
const log = require("fancy-log");
const path = require("path");
const perfMonService = require("cisco-perfmon");
const pLimit = require("p-limit");
const program = new Command();
const sessionSSO = require("./js/sessionSSO");
const validator = require("validator");


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
        log("Reseting Interval:", currentInterval);
        clearIntervalAsync(intervalId);
        intervalId = setIntervalAsync(executeTask, currentInterval);
      }
    } catch (error) {
      if (error.action != "break") {
        log.error("Error executing task:", error);
        if (increaseIntervalOnFailure) {
          currentInterval *= 2; // Increase interval on failure
          clearIntervalAsync(intervalId);
          log("Interval set to:", currentInterval);
          intervalId = setIntervalAsync(executeTask, currentInterval);
        }
      } else {
        // Break out of the loop and remove from tasks array
        log.error("Error executing task:", error.message);
        if (tasks.length > 1) {
          tasks.splice(currentIndex, 1);
          clearIntervalAsync(intervalId);
          log("Interval set to:", currentInterval);
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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const collectCounterData = async (servers, logPrefix) => {
  return new Promise(async (resolve, reject) => {
    const perfmonObjectArr = env.PM_OBJECT_COLLECT_ALL.split(",");
    const writeApi = client.getWriteApi(org, bucket);
    log(`${logPrefix}: Found ${servers.callManager.length} server(s) in the cluster. Starting collection for each server, up to ${env.PM_SERVER_CONCURRENCY} at a time, if applicable.`);

    const getPerfMonData = async (server) => {
      return new Promise(async (resolve, reject) => {
        try {
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
          // Set the server name in our results. This is used for logging.
          jsonResults.server = server.processNodeName.value;
          log(`${logPrefix}: Collecting data for ${jsonResults.server}.`);

          // Set up the perfmon service. We will use this to collect the data from each server.
          var perfmon_service = new perfMonService(jsonResults.server, env.CUCM_USERNAME, env.CUCM_PASSWORD, {}, env.PM_RETRY_FLAG);
          log(`${logPrefix}: Found ${perfmonObjectArr.length} object(s) to collect on ${jsonResults.server}. Collecting ${env.PM_OBJECT_COLLECT_ALL_CONCURRENCY} objects at a time.`);

          try {
            const ssoIndex = ssoArr.findIndex((element) => element.name === jsonResults.server);
            if (ssoIndex !== -1) {
              // Update the perfmon service with the SSO auth cookie
              perfmon_service = new perfMonService(jsonResults.server, "", "", { cookie: ssoArr[ssoIndex].cookie }, env.PM_RETRY_FLAG);
            } else {
              jsonResults.authMethod.basic++;
              // If we don't have a cookie, let's try to get one but doing a listCounter call.
              var listCounterResults = await perfmon_service.listCounter(jsonResults.server);
              // If we have a cookie, let's update the SSO array with the new cookie
              if (listCounterResults.cookie) {
                ssoArr = sessionSSO.updateSSO(jsonResults.server, { cookie: listCounterResults.cookie });
              }
            }
          } catch (error) {
            reject;
          }

          log(`${logPrefix}: Will attempt to collect up to ${env.PM_RETRY} times with a ${env.PM_RETRY_DELAY / 1000} second delay between attempts.`);
          log(`${logPrefix}: Will wait ${env.PM_COOLDOWN_TIMER / 1000} seconds between collecting each object.`);

          const objectSSOIndex = ssoArr.findIndex((element) => element.name === jsonResults.server);

          // Let's run the perfmon data collection for each counter. Note this is limited by the counterLimit concurrency.
          const promises = await perfmonObjectArr.map((object) => {
            if (objectSSOIndex !== -1) {
              jsonResults.authMethod.sso++;
            }
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
            if (obj?.results && obj?.results?.length > 0) {
              const matchingItems = obj.results.filter((item) => !item?.counter.includes("%") && !item.counter?.includes("Percentage"));
              if (matchingItems.length > 0) {
                acc.push(matchingItems);
              }
              return acc.flat(1);
            } else {
              return acc;
            }
          }, []);

          nonPercentageObjects.forEach((object) => {
            points.push(new Point(object.object).tag("host", object.host).tag("cstatus", object.cstatus).tag("instance", object.instance).floatField(object.counter, object.value));
          });

          let success = {};
          let returnResults = [];

          output.forEach((el) => {
            if (el?.status > 400) {
              rateControl = true;
              returnResults.push({ object: el.object, count: -1 });
            } else if (el?.results && el?.results?.length > 0) {
              el.results.forEach((result) => {
                let count = (success[result.object] || 0) + 1;
                success[result.object] = count;
              });
              returnResults.push({ object: el.object, count: success[el.object] ? success[el.object] : -1 });
            }
          });

          jsonResults.results = returnResults;

          // Add the points to the influxDB API.
          writeApi.writePoints(points);
          log(`${logPrefix}: Wrote ${points.length} points to InfluxDB bucket ${bucket} for ${jsonResults.server}.`);
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

    try {
      // Get the results from all servers via Promise.all. This will wait for all servers to be collected before moving on.
      const influxResults = await Promise.all(serverPromises);

      // Log the results to the console
      log(`${logPrefix} RESULTS:`);
      for (const result of influxResults) {
        var table = result.results;
        var authTable = result.authMethod;
        delete result.authMethod;
        delete result.results;
        console.table(result);
        log(`${logPrefix} Auth Counts:`);
        console.table(authTable);
        log(`${logPrefix} Object Results:`);
        console.table(table);
      }
    } catch (error) {
      log.error(error);
      process.exit(0);
    }

    // Close the influxDB API
    await writeApi
      .close()
      .then(() => {
        log(`${logPrefix}: InfluxDB writeApi closed.`);
      })
      .catch((e) => {
        log.error("PERFMON COUNTER DATA: InfluxDB write failed", e);
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
    const perfmonSessionArr = env.PM_OBJECT_SESSION_PERCENTAGE.split(",");
    const writeApi = client.getWriteApi(org, bucket);
    log(`${logPrefix}: Found ${servers.callManager.length} server(s) in the cluster. Starting collection for each server, up to ${env.PM_SERVER_CONCURRENCY} at a time, if applicable.`);
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
        log(`${logPrefix}: Collecting data for ${jsonResults.server}.`);

        var perfmon_service = new perfMonService(jsonResults.server, env.CUCM_USERNAME, env.CUCM_PASSWORD, {}, env.PM_RETRY_FLAG);
        log(`${logPrefix}: Found ${perfmonSessionArr.length} objects to collect on ${jsonResults.server}.`);

        // Let's see if we have a cookie for this server, if so we will use it instead of basic auth.
        const ssoIndex = ssoArr.findIndex((element) => element.name === jsonResults.server);
        if (ssoIndex !== -1) {
          jsonResults.authMethod.sso++;
          // Update the perfmon service with the SSO auth cookie
          perfmon_service = new perfMonService(jsonResults.server, "", "", { cookie: ssoArr[ssoIndex].cookie }, env.PM_RETRY_FLAG);
        } else {
          jsonResults.authMethod.basic++;
        }

        var objectCollectArr = [];
        var listCounterResults;
        var listInstanceResults;

        try {
          listCounterResults = await perfmon_service.listCounter(jsonResults.server, perfmonSessionArr);
          if (listCounterResults?.cookie) {
            ssoArr = sessionSSO.updateSSO(jsonResults.server, { cookie: listCounterResults?.cookie });
          }
        } catch (error) {
          console.log(error);
          process.exit(0);
        }

        try {
          for (let i = 0; i < perfmonSessionArr.length; i++) {
            listInstanceResults = await perfmon_service.listInstance(jsonResults.server, perfmonSessionArr[i]);
            const findCounter = listCounterResults.results.find((counter) => counter.Name === perfmonSessionArr[i]);
            let MultiInstanceVal = findCounter?.MultiInstance;
            let MultiInstance = /true/.test(MultiInstanceVal);
            let locatePercentCounter = findCounter.ArrayOfCounter.item.filter(function (item) {
              if (item.Name.includes("Percentage") || item.Name.includes("%")) {
                return item;
              }
            });

            // Loop through the list of instances and counters
            for (let j = 0; j < locatePercentCounter.length; j++) {
              for (let k = 0; k < listInstanceResults.results.length; k++) {
                var collectSessionObj = {
                  host: jsonResults.server,
                  object: "",
                  instance: "",
                  counter: "",
                };
                collectSessionObj.object = perfmonSessionArr[i];
                collectSessionObj.instance = MultiInstance ? listInstanceResults.results[k].Name : "";
                collectSessionObj.counter = locatePercentCounter[j].Name;
                objectCollectArr.push(collectSessionObj);
              }
            }
          }
        } catch (error) {
          console.log(error);
          process.exit(0);
        }

        var functionName = "openSession";
        try {
          // Collect the counter data from the server
          var sessionIdResults = await perfmon_service.openSession();

          if (sessionIdResults.results) {
            var sessionId = sessionIdResults.results;
            jsonResults.results.push({ name: `${functionName}`, message: `Opening session for ${jsonResults.server} = ${sessionId}.` });
          } else {
            log("openSession Error: No results returned.");
            process.exit(0);
          }
        } catch (error) {
          if (error.status >= 500) {
            rateControl = true;
            jsonResults.results.push({ name: `${functionName}`, message: `Error: ${error.message} for ${jsonResults.server}.` });
            resolve();
          } else {
            log.error("openSession Error:", error);
            process.exit(0);
          }
        }

        functionName = "addCounter";
        try {
          // Collect the counter data from the server
          let addCounterResults = await perfmon_service.addCounter(sessionId, objectCollectArr);
          if (addCounterResults.results) {
            jsonResults.results.push({ name: `${functionName}`, message: `Adding ${objectCollectArr.length} object(s) for ${jsonResults.server} with SessionId ${sessionIdResults.results} = ${addCounterResults.results}.` });
          } else {
            log("addCounter Error: No results returned.");
            process.exit(0);
          }
        } catch (error) {
          if (error.status >= 500) {
            rateControl = true;
            jsonResults.results.push({ name: `${functionName}`, message: `Error: ${error.message} for ${jsonResults.server}.` });
            resolve();
          } else {
            log.error("addCounter Error:", error);
            process.exit(0);
          }
        }

        functionName = "collectSessionData";
        try {
          // Collect the counter data from the server. This baseline data is used to calculate the percentage counters. We do not save this data to InfluxDB.
          var baseLineResults = await perfmon_service.collectSessionData(sessionId);
          if (baseLineResults.results) {
            jsonResults.results.push({ name: `${functionName}`, message: `Collected ${baseLineResults.results.length} baseline points for ${jsonResults.server}.` });
          } else {
            log("collectSessionData Error: No results returned.");
            process.exit(0);
          }
        } catch (error) {
          if (error.status >= 500) {
            rateControl = true;
            jsonResults.results.push({ name: `${functionName}`, message: `Error: ${error.message} for ${jsonResults.server}.` });
            resolve();
          } else {
            log.error(`${functionName} Error:`, error);
            process.exit(0);
          }
        }

        await delay(env.PM_OBJECT_SESSION_PERCENTAGE_SLEEP); // sleeping for 15 seconds to allow the server to generate the counter data

        log(`${logPrefix}: Waiting 15 seconds for ${jsonResults.server} to generate counter data.`);

        functionName = "collectSessionData";
        try {
          // Collect the counter data from the server
          let collectSessionResults = await perfmon_service.collectSessionData(sessionId);

          if (collectSessionResults.results) {
            collectSessionResults.results.forEach(function (result) {
              points.push(new Point(result.object).tag("host", result.host).tag("cstatus", result.cstatus).tag("instance", result.instance).floatField(result.counter, result.value));
            });
            jsonResults.results.push({ name: `${functionName}`, message: `Collected ${collectSessionResults.results.length} observation points for ${jsonResults.server} after sleeping for ${env.PM_OBJECT_SESSION_PERCENTAGE_SLEEP}ms.` });
          } else {
            log("collectSessionData Error: No results returned.");
            process.exit(0);
          }
        } catch (error) {
          let functionName = "collectSessionData";
          if (error.status >= 500) {
            rateControl = true;
            jsonResults.results.push({ name: `${functionName}`, message: `Error: ${error.message} for ${jsonResults.server}.` });
            resolve();
          } else {
            log.error(`${functionName} Error:`, error);
            process.exit(0);
          }
        }

        functionName = "removeCounter";
        try {
          // Collect the counter data from the server
          let removeCounterResults = await perfmon_service.removeCounter(sessionId, objectCollectArr);
          if (removeCounterResults.results) {
            jsonResults.results.push({ name: `${functionName}`, message: `Removing objects for ${jsonResults.server} = ${removeCounterResults.results}.` });
          } else {
            log("removeCounter Error: No results returned.");
            process.exit(0);
          }
        } catch (error) {
          if (error.status >= 500) {
            rateControl = true;
            jsonResults.results.push({ name: `${functionName}`, message: `Error: ${error.message} for ${jsonResults.server}.` });
            resolve();
          } else {
            log.error(`${functionName} Error:`, error);
            process.exit(0);
          }
        }

        functionName = "closeSession";
        try {
          // Collect the counter data from the server
          var closeSession = await perfmon_service.closeSession(sessionId);
          if (closeSession.results) {
            jsonResults.results.push({ name: `${functionName}`, message: `Closing session for ${jsonResults.server} = ${closeSession.results}.` });

            // Write the points to InfluxDB only if we made it this far.
            writeApi.writePoints(points);
            log(`${logPrefix}: Wrote ${points.length} points to InfluxDB bucket ${bucket} for ${jsonResults.server}.`);
            // Resolve the promise
            resolve(jsonResults);
          } else {
            log("closeSession Error: No results returned.");
            process.exit(0);
          }
        } catch (error) {
          if (error.status >= 500) {
            rateControl = true;
            jsonResults.results.push({ name: `${functionName}`, message: `Error: ${error.message} for ${jsonResults.server}.` });
            resolve();
          } else {
            log.error(`${functionName} Error:`, error);
            process.exit(0);
          }
        }
      });
    };

    const serverPromises = await servers.callManager.map(async (server) => {
      return serverLimit(() => getPerfMonData(server));
    });

    try {
      const influxResults = await Promise.all(serverPromises);

      log(`${logPrefix} RESULTS:`);
      for (const result of influxResults) {
        const table = result?.results;
        const authTable = result?.authMethod;
        delete result.authMethod;
        delete result.results;
        console.table(result);
        log(`${logPrefix} Auth Counts:`);
        console.table(authTable);
        log(`${logPrefix} Object Results:`);
        console.table(table);
      }
    } catch (error) {
      log.error(error);
      process.exit(0);
    }

    await writeApi
      .close()
      .then(() => {
        log(`${logPrefix}: InfluxDB writeApi closed.`);
      })
      .catch((e) => {
        log("${sessionLogInfo}: InfluxDB write failed", e);
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
    log(`${logPrefix}: Starting collection from ${env.CUCM_HOSTNAME} using config.json file`);
    var parsedData = JSON.parse(data);
    let points = [];

    var collectSessionData = () => {
      return new Promise(async (resolve) => {
        let jsonResults = {
          server: env.CUCM_HOSTNAME,
          authMethod: {
            basic: 0,
            sso: 0,
          },
          results: [],
          cooldownTimer: coolDownTimer / 1000 + " second(s)",
          intervalTimer: interval / 1000 + " second(s)",
        };
        var perfmon_service = new perfMonService(env.CUCM_HOSTNAME, env.CUCM_USERNAME, env.CUCM_PASSWORD, {}, env.PM_RETRY_FLAG);
        log(`${logPrefix}: Found ${parsedData.length} objects to collect on ${env.CUCM_HOSTNAME}.`);

        // Let's see if we have a cookie for this server, if so we will use it instead of basic auth.
        const ssoIndex = ssoArr.findIndex((element) => element.name === env.CUCM_HOSTNAME);
        if (ssoIndex !== -1) {
          jsonResults.authMethod.sso++;
          // Update the perfmon service with the SSO auth cookie
          perfmon_service = new perfMonService(env.CUCM_HOSTNAME, "", "", { cookie: ssoArr[ssoIndex].cookie }, env.PM_RETRY_FLAG);
        } else {
          jsonResults.authMethod.basic++;
        }

        var functionName = "openSession";

        try {
          // Collect the object data from the server
          var sessionIdResults = await perfmon_service.openSession();
          if (sessionIdResults.cookie) {
            ssoArr = sessionSSO.updateSSO(env.CUCM_HOSTNAME, { cookie: sessionIdResults.cookie });
          }
          if (sessionIdResults?.results) {
            var sessionId = sessionIdResults.results;
            jsonResults.results.push({ name: `${functionName}`, message: `Opening session for ${env.CUCM_HOSTNAME} = ${sessionId}.` });
          } else {
            log("openSession Error: No results returned.");
            process.exit(0);
          }
        } catch (error) {
          if (error.status >= 500) {
            rateControl = true;
            jsonResults.results.push({ name: `${functionName}`, message: `Error: ${error.message} for ${jsonResults.server}` });
            resolve();
          } else {
            log.error(`${functionName} Error:`, error);
            process.exit(0);
          }
        }

        functionName = "addCounter";
        try {
          // Collect the counter data from the server
          let addCounterResults = await perfmon_service.addCounter(sessionId, parsedData);
          if (addCounterResults.results) {
            jsonResults.results.push({ name: `${functionName}`, message: `Adding ${objectCollectArr.length} object(s) for ${env.CUCM_HOSTNAME} with SessionId ${sessionIdResults.results} = ${addCounterResults.results}.` });
          } else {
            log("addCounter Error: No results returned.");
            process.exit(0);
          }
        } catch (error) {
          if (error.status >= 500) {
            rateControl = true;
            jsonResults.results.push({ name: `${functionName}`, message: `Error: ${error.message} for ${jsonResults.server}.` });
            resolve();
          } else {
            log.error(`${functionName} Error:`, error);
            process.exit(0);
          }
        }

        functionName = "collectSessionData";
        try {
          // Collect the counter data from the server
          let collectSessionResults = await perfmon_service.collectSessionData(sessionId);

          if (collectSessionResults.results) {
            collectSessionResults.results.forEach(function (result) {
              points.push(new Point(result.object).tag("host", result.host).tag("cstatus", result.cstatus).tag("instance", result.instance).floatField(result.counter, result.value));
            });
            jsonResults.results.push({ name: `${functionName}`, message: `Collected ${collectSessionResults.results.length} observation points from ${env.CUCM_HOSTNAME}.` });
          } else {
            log("collectSessionData Error: No results returned.");
            process.exit(0);
          }
        } catch (error) {
          if (error.status >= 500) {
            rateControl = true;
            jsonResults.results.push({ name: `${functionName}`, message: `Error: ${error.message} for ${jsonResults.server}.` });
            resolve();
          } else {
            log.error(`${functionName} Error:`, error);
            process.exit(0);
          }
        }

        functionName = "removeCounter";
        try {
          // Collect the counter data from the server
          let removeCounterResults = await perfmon_service.removeCounter(sessionId, parsedData);
          if (removeCounterResults.results) {
            jsonResults.results.push({ name: `${functionName}`, message: `Removing object(s) for ${env.CUCM_HOSTNAME} = ${removeCounterResults.results}.` });
          } else {
            log("removeCounter Error: No results returned.");
            process.exit(0);
          }
        } catch (error) {
          if (error.status >= 500) {
            rateControl = true;
            jsonResults.results.push({ name: `${functionName}`, message: `Error: ${error.message} for ${jsonResults.server}.` });
            resolve();
          } else {
            log.error(`${functionName} Error:`, error);
            process.exit(0);
          }
        }

        functionName = "closeSession";
        try {
          // Collect the counter data from the server
          var closeSession = await perfmon_service.closeSession(sessionId);
          if (closeSession.results) {
            jsonResults.results.push({ name: `${functionName}`, message: `Closing session for ${env.CUCM_HOSTNAME} = ${closeSession.results}.` });

            // Write the points to InfluxDB only if we made it this far.
            writeApi.writePoints(points);
            log(`${logPrefix}: Wrote ${points.length} points to InfluxDB bucket ${bucket} from ${env.CUCM_HOSTNAME}.`);
            // Resolve the promise
            resolve(jsonResults);
          } else {
            log("closeSession Error: No results returned.");
            process.exit(0);
          }
        } catch (error) {
          if (error.status >= 500) {
            rateControl = true;
            jsonResults.results.push({ name: `${functionName}`, message: `Error: ${error.message} for ${jsonResults.server}.` });
            resolve();
          } else {
            log.error(`${functionName} Error:`, error);
            process.exit(0);
          }
        }
      });
    };

    try {
      const influxResults = await collectSessionData();

      log(`${logPrefix} Basic Settings:`);
      const table = influxResults.results;
      const authTable = influxResults.authMethod;
      delete influxResults.authMethod;
      delete influxResults.results;
      console.table(influxResults);
      log(`${logPrefix} Auth Counts:`);
      console.table(authTable);
      log(`${logPrefix} Object Results:`);
      console.table(table);
    } catch (error) {
      log.error(error);
      process.exit(0);
    }

    await writeApi
      .close()
      .then(() => {
        log(`${logPrefix}: InfluxDB writeApi closed.`);
      })
      .catch((e) => {
        log("${sessionLogInfo}: InfluxDB write failed", e);
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
      log.error("PERFMON SESSION CONFIG: File does not exist:", filePath, "Skipping collection via config file.");
    } else {
      log.error("PERFMON SESSION CONFIG Error accessing file:", err);
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
        log(`PERFMON SESSION CONFIG: ${filename} successfully saved.`);
      } catch (err) {
        log.error("Error:", err);
      }
    });

  program
    .command("start", { isDefault: true })
    .description("Run the server natively")
    .action(async () => {
      if (process.env.PM_DELAYED_START) {
        log("Delaying start for", process.env.PM_DELAYED_START / 1000, "seconds.");
        await delay(process.env.PM_DELAYED_START);
      }

      // Get the servers from the AXL API or ENV. If we can't get the servers, we will exit the process.
      try {
        var servers = await getServers(env);
      } catch (error) {
        log.error(error);
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
          log("PM_OBJECT_COLLECT_ALL env variable not set. Skipping collection.");
        }

        if (env.PM_OBJECT_SESSION_PERCENTAGE) {
          tasks.push({ fn: collectSessionData, args: [servers, "PERFMON SESSION DATA"] });
        } else {
          log("PM_OBJECT_SESSION_PERCENTAGE env variable not set. Skipping collection.");
        }

        if (tasks.length > 0) {
          roundRobin(tasks, interval, true); // Start round-robin execution
        } else {
          log("No tasks to execute found. Exiting.");
          process.exit(0);
        }
      } catch (error) {
        log.error(error);
        process.exit(0);
      }
    });

  program.parse(process.argv);
})();
