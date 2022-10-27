const ciscoRisPort = require("cisco-risport");
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
  cucmip: process.env.CUCM_PUB,
  cucmuser: process.env.CUCM_USERNAME,
  cucmpass: process.env.CUCM_PASSWORD,
};

setInterval(function () {
  console.log(
    "RISPORT DATA: Starting interval, process will run every 5 minutes"
  );
  (async () => {
    const writeApi = client.getWriteApi(org, bucket);
    var points = [];
    await sleep(timer).then(async () => {
      let output = await ciscoRisPort
        .selectCmDevice(
          settings.cucmip,
          settings.cucmuser,
          settings.cucmpass,
          "SelectCmDeviceExt", // Either SelectCmDevice or SelectCmDeviceExt
          1000, // The maximum number of devices to return. The maximum parameter value is 1000.
          "Any", // Device Class (Any, Phone, Gateway, H323, Cti, VoiceMail, MediaResources, HuntList, SIPTrunk, Unknown)
          255, // Model Enum. Use 255 for "any model". Can use a string of model name and it will convert it to the enum (Example "SIP Trunk").
          "Any", // Status (Any, Registered, UnRegistered, Rejected, PartiallyRegistered, Unknown)
          "Name", // Select By (Name, IPV4Address, IPV6Address, DirNumber, Description, SIPStatus)
          "", // Select Items. Can either be a single item string or an array of items. May include names, IP addresses, or directory numbers or * to return wildcard matches.
          "Any", // Protocol (Any, SCCP, SIP, Unknown)
          "Any" // Download Status (Any, Upgrading, Successful, Failed, Unknown)
        )
        .catch((err) => {
          console.log(err);
          return false;
        });
      console.log(JSON.stringify(output));
      // if (Array.isArray(perfmonCounters)) {
      //   for (const counter of perfmonCounters) {
      //     var regExp = /\(([^)]+)\)/;
      //     var nameSplit = counter["NS1:NAME"].split("\\");
      //     nameSplit = nameSplit.filter(function (el) {
      //       return el;
      //     });

      //     var matches = regExp.exec(nameSplit[1]);
      //     writeApi.useDefaultTags({ host: server });
      //     if (!Array.isArray(matches)) {
      //       points.push(
      //         new Point(object).floatField(nameSplit[2], counter["NS1:VALUE"])
      //       );
      //     } else {
      //       points.push(
      //         new Point(object)
      //           .tag("instance", matches[1])
      //           .floatField(nameSplit[2], counter["NS1:VALUE"])
      //       );
      //     }
      //   }

      //   writeApi.writePoints(points);
      //   writeApi
      //     .close()
      //     .then(() => {
      //       console.log(
      //         server + " PERFMONCOLLECTCOUNTERDATA(INFLUXDB WRITE): FINISHED WRITING " + object.toUpperCase() + " DATA TO INFLUXDB"
      //       );
      //     })
      //     .catch((e) => {
      //       console.log(server + " PERFMONCOLLECTCOUNTERDATA(INFLUXDB WRITE): Finished ERROR");
      //     });

      //   console.log(
      //     server + " PERFMONCOLLECTCOUNTERDATA(INTERVAL): Sleeping for " +
      //       timer +
      //       " between Perfmon Object. Finished processing: " +
      //       object
      //   );
      // }
    });
  })();
}, 30000);
