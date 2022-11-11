const axlService = require("cisco-axl");
const perfMonService = require("cisco-perfmon");
const { setIntervalAsync } = require("set-interval-async");
const { InfluxDB, Point } = require("@influxdata/influxdb-client");

// Cool down function
const sleep = (waitTimeInMs) =>
  new Promise((resolve) => setTimeout(resolve, waitTimeInMs));

if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const token = process.env.INFLUXDB_TOKEN;
const org = process.env.INFLUXDB_ORG;
const bucket = process.env.INFLUXDB_BUCKET;

const client = new InfluxDB({
  url: process.env.INFLUXDB_URL,
  token: token,
});

const timer = process.env.COOLDOWN_TIMER; // Timer in milliseconds
const interval = process.env.SESSION_INTERVAL; // Timer in milliseconds

var settings = {
  version: process.env.CUCM_VERSION,
  cucmip: process.env.CUCM_PUB,
  cucmuser: process.env.CUCM_USERNAME,
  cucmpass: process.env.CUCM_PASSWORD,
};

const perfmonObjectArr = process.env.PERFMON_SESSIONS.split(",");

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
    `PERFMON SESSION DATA: Found ${servers.callManager.length} servers.`
  );

  for (const server of servers.callManager) {
    for (const object of perfmonObjectArr) {
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
        var SessionID = await perfmon_service.openSession().catch((error) => {
          console.log(error);
        });

        console.log(`PERFMON SESSION DATA: ${SessionID}`);

        var counterObjArr = [];

        for (let instance of objInstance) {
          // loop thru each counter and add to session id
          for (let item of filteredArr[0].ArrayOfCounter.item) {
            if (item.Name.includes("Percentage") || item.Name.includes("%")) {
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

        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        console.log(
          "PERFMON SESSION DATA: Waiting 15 seconds before collecting data"
        );
        await delay(15000); /// waiting 30 second.

        let results = await perfmon_service
          .collectSessionData(SessionID)
          .catch((error) => {
            console.log(error);
          });

        results.forEach(function (result) {
          points.push(
            new Point(object.object)
              .tag("host", object.host)
              .tag("cstatus", object.cstatus)
              .floatField(object.counter, object.value)
          );
        });

        console.log(
          `PERFMON SESSION DATA: Collecting results, ${results.length} results collected.`
        );

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
