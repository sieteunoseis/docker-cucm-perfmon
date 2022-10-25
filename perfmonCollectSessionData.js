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

var service = axlModule(
  settings.version,
  settings.cucmip,
  settings.cucmuser,
  settings.cucmpass
);

const perfmonObjectArr = JSON.parse(process.env.PERFMON_SESSION_ARR);
var perfmonSessionID;
var perfmonCounterArr = [];

setInterval(function () {
  console.log(
    "PERFMONCOLLECTSESSIONDATA(STARTING INTERVAL): WILL RERUN 5 MINS AFTER COMPLETION"
  );
  (async () => {
    // Let's get the servers via AXL
    var servers = await service.getServers().catch((err) => {
      console.log("PERFMONCOLLECTSESSIONDATA(GET SERVERS): " + err);
      process.exit(1); // Restart if hit an error
    });

    console.log(
      "PERFMONCOLLECTSESSIONDATA(GET SERVERS): Found the following servers: " +
        JSON.stringify(servers)
    );
    for (const server of servers) {
      for (const object of perfmonObjectArr) {
        const writeApi = client.getWriteApi(org, bucket);
        var points = [];
        // BUILD ARRAY FOR COLLECT SESSION DATA
        var perfmonCounterData = service
          .getPerfmonCounterData(server, object)
          .catch((err) => {
            console.log(
              server + " PERFMONCOLLECTSESSIONDATA(GET COUNTER DATA): " + err
            );
          });

        perfmonCounterData.then(function (results) {
          results.forEach((element) => {
            perfmonCounterArr.push(
              element["NS1:NAME"].replace(/\\\\/g, "\\").replace(/^/, "\\")
            ); // Replace double backslash with single
          });
        });

        // OPEN SESSION
        var ciscoPerfmonSession = service.getPerfmonSession().catch((err) => {
          console.log(
            server + " PERFMONCOLLECTSESSIONDATA(GET SESSION): " + err
          );
        });

        ciscoPerfmonSession.then(function (result) {
          console.log(
            server + " PERFMONCOLLECTSESSIONDATA(GET SESSION): " + result
          );
          perfmonSessionID = result;

          // ADD COUNTERS
          var ciscoPerfmonAddCounter = service
            .addPerfmonCounter(perfmonSessionID, perfmonCounterArr)
            .catch((err) => {
              console.log(
                server + " PERFMONCOLLECTSESSIONDATA(ADD COUNTER): " + err
              );
              // Close session
              var ciscoClosePerfmonSession = service
                .closePerfmonSessionData(perfmonSessionID)
                .catch((err) => {
                  console.log(
                    server + " PERFMONCOLLECTSESSIONDATA(CLOSE COUNTER): " + err
                  );
                });

              ciscoClosePerfmonSession.then(function (result) {
                console.log(
                  server +
                    " PERFMONCOLLECTSESSIONDATA(CLOSE COUNTER): " +
                    JSON.stringify(result)
                );
              });
            });

          // Get base line 0 value counters
          ciscoPerfmonAddCounter.then(function (result) {
            console.log(
              server +
                " PERFMONCOLLECTSESSIONDATA(ADD COUNTER): " +
                JSON.stringify(result)
            );

            var ciscoPerfmonSessionData = service
              .getPerfmonSessionData(perfmonSessionID)
              .catch((err) => {
                console.log(
                  server +
                    " PERFMONCOLLECTSESSIONDATA(GET SESSION DATA): " +
                    err
                );
              });

            ciscoPerfmonSessionData.then(async function (result) {
              console.log(
                server +
                  " PERFMONCOLLECTSESSIONDATA(GET SESSION DATA): Retrieving baseline data for " +
                  object
              );

              // Sleep 15 seconds to allow counters to increment
              console.log(
                server +
                  " PERFMONCOLLECTSESSIONDATA(GET SESSION DATA): Sleeping for 15000"
              );
              await sleep(15000).then(() => {
                // This will execute 15 seconds from now
                var ciscoPerfmonSessionData = service
                  .getPerfmonSessionData(perfmonSessionID)
                  .catch((err) => {
                    console.log(
                      server +
                        " PERFMONCOLLECTSESSIONDATA(GET SESSION DATA): " +
                        err
                    );
                  });
                if (Array.isArray(ciscoPerfmonSessionData)) {
                  ciscoPerfmonSessionData.then(async function (result) {
                    console.log(
                      server +
                        " PERFMONCOLLECTSESSIONDATA(GET SESSION DATA): Retrieving updated data for " +
                        object
                    );

                    for (const counter of result) {
                      var regExp = /\(([^)]+)\)/;
                      var nameSplit = counter["NS1:NAME"].split("\\");
                      nameSplit = nameSplit.filter(function (el) {
                        return el;
                      });

                      var matches = regExp.exec(nameSplit[1]);
                      writeApi.useDefaultTags({ host: server });
                      if (!Array.isArray(matches)) {
                        points.push(
                          new Point(object).floatField(
                            nameSplit[2],
                            counter["NS1:VALUE"]
                          )
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
                          server +
                            " PERFMONCOLLECTSESSIONDATA(INFLUXDB WRITE): FINISHED WRITING " +
                            object.toUpperCase() +
                            " DATA TO INFLUXDB"
                        );
                      })
                      .catch((e) => {
                        console.log(
                          server +
                            " PERFMONCOLLECTSESSIONDATA(INFLUXDB WRITE): Finished ERROR"
                        );
                      });

                    // Close session
                    var closeResults = await service
                      .closePerfmonSessionData(perfmonSessionID)
                      .catch((err) => {
                        console.log(
                          server +
                            " PERFMONCOLLECTSESSIONDATA(CLOSE SESSION): " +
                            err
                        );
                      });

                    console.log(
                      server +
                        " PERFMONCOLLECTSESSIONDATA(CLOSE SESSION): " +
                        JSON.stringify(closeResults)
                    );
                  });
                }
              });
            });
          });
        });
      }
    }
  })();
}, 300000);
