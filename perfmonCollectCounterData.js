const axlService = require("cisco-axl");
const perfMonService = require("cisco-perfmon");
const { setIntervalAsync, clearIntervalAsync } = require("set-interval-async");
const {
  InfluxDB,
  Point,
  consoleLogger,
} = require("@influxdata/influxdb-client");

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

const timer = process.env.COOLDOWN_TIMER || 3000; // Timer in milliseconds
const interval = process.env.COUNTER_INTERVAL || 30000; // Interval in milliseconds

var settings = {
  version: process.env.CUCM_VERSION,
  cucmip: process.env.CUCM_PUB,
  cucmuser: process.env.CUCM_USERNAME,
  cucmpass: process.env.CUCM_PASSWORD,
};

const perfmonObjectArr = process.env.PERFMON_COUNTERS.split(",");

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
    `PERFMON DATA: Starting interval, collection will run every ${
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

  console.log(`PERFMON DATA: Found ${servers.callManager.length} servers.`);

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
            console.log("Sending exit to system");
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
