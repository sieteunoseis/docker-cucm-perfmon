const axlModule = require("cisco-axl-perfmon");
const { InfluxDB, Point } = require("@influxdata/influxdb-client");
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

const timer = process.env.TIMER; // Timer in milliseconds

var settings = {
  version: process.env.CUCM_VERSION,
  cucmip: process.env.CUCM_PUB,
  cucmuser: process.env.CUCM_USERNAME,
  cucmpass: process.env.CUCM_PASSWORD,
};

const perfmonObjectArr = JSON.parse(process.env.PERFMON_COUNTER_ARR);

var service = axlModule(
  settings.version,
  settings.cucmip,
  settings.cucmuser,
  settings.cucmpass
);

setInterval(function () {
  console.log("PERFMONCOLLECTCOUNTERDATA: STARTING INTERVAL. WILL RERUN 5 MINS AFTER COMPLETION");
  (async () => {
    // Let's get the servers via AXL
    var servers = await service.getServers().catch((err) => {
      console.log("PERFMONCOLLECTCOUNTERDATA(GET SERVERS): " + err);
      process.exit(1); // Restart if hit an error
    });
  
    console.log("PERFMONCOLLECTCOUNTERDATA(GET SERVERS): Found the following servers: " + JSON.stringify(servers));
  
    for (const server of servers) {
      for (const object of perfmonObjectArr) {
        const writeApi = client.getWriteApi(org, bucket);
        var points = [];
        await sleep(timer).then(async () => {
          var perfmonCounters = await service
            .getPerfmonCounterData(server, object)
            .catch((err) => {
              console.log(server + " PERFMONCOLLECTCOUNTERDATA(GET COUNTER DATA): " + err + " " + object);
            });
          if (Array.isArray(perfmonCounters)) {
            for (const counter of perfmonCounters) {
              var regExp = /\(([^)]+)\)/;
              var nameSplit = counter["NS1:NAME"].split("\\");
              nameSplit = nameSplit.filter(function (el) {
                return el;
              });
  
              var matches = regExp.exec(nameSplit[1]);
              writeApi.useDefaultTags({ host: server });
              if (!Array.isArray(matches)) {
                points.push(
                  new Point(object).floatField(nameSplit[2], counter["NS1:VALUE"])
                );
              } else {
                points.push(
                  new Point(object)
                    .tag("instance", matches[1])
                    .floatField(nameSplit[2], counter["NS1:VALUE"])
                );
              }
            }
  
            writeApi.writePoints(points);
            writeApi
              .close()
              .then(() => {
                console.log(
                  server + " PERFMONCOLLECTCOUNTERDATA(INFLUXDB WRITE): FINISHED WRITING " + object.toUpperCase() + " DATA TO INFLUXDB"
                );
              })
              .catch((e) => {
                console.log(server + " PERFMONCOLLECTCOUNTERDATA(INFLUXDB WRITE): Finished ERROR");
              });
  
            console.log(
              server + " PERFMONCOLLECTCOUNTERDATA(INTERVAL): Sleeping for " +
                timer +
                " between Perfmon Object. Finished processing: " +
                object
            );
          }
        });
      }
    }
  })();
}, 300000);