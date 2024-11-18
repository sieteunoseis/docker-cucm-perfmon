# Perfmon Influx Exporter

NodeJS application using Cisco Perfmon API to export data to InfluxDB.

## Install

```node
npm run docker:build
npm run docker:run
```

## Needed Enviromental Variables

```node
# Nodejs Settings - Comment out if you get certificate errors
# NODE_TLS_REJECT_UNAUTHORIZED=0

# PM2 Settings - Comment out if not using pm2.io
# PM2_PUBLIC_KEY=
# PM2_SECRET_KEY=

# AXL Settings
CUCM_HOSTNAME=<INSERT IP ADDRESS>
CUCM_USERNAME=<INSERT USERNAME>
CUCM_PASSWORD=<INSERT PASSWORD>
CUCM_VERSION=<INSERT VERSION I.E. 12.5>

# InfluxDB Settings
INFLUXDB_TOKEN=<INSERT INFLUXDB TOKEN>
INFLUXDB_ORG=<INSERT INFLUXDB ORG>
INFLUXDB_BUCKET=<INSERT INFLUXDB BUCKET>
INFLUXDB_URL=<INSERT INFLUXDB URL>

# Perfmon Settings
# PM_SERVERS=hq-cucm-pub.abc.inc - Remove comment if you'd only like to run on a single server or set of servers
PM_INTERVAL=5000
PM_COOLDOWN_TIMER=3000
PM_RETRY=3
PM_RETRY_DELAY=20000
PM_SERVER_CONCURRENCY=2

PM_OBJECT_COLLECT_ALL=Cisco Annunciator Device,Cisco AXL Web Service,Cisco Call Restriction,Cisco CallManager,Cisco CallManager System Performance,Cisco CAR DB,Cisco CTI Manager,Cisco Device Activation,Cisco Dual-Mode Mobility,Cisco Extension Mobility,Cisco Hunt Lists,Cisco Hunt Pilots,Cisco IP Manager Assistant,Cisco IVR Device,Cisco LBM Service,Cisco LDAP Directory,Cisco Locations LBM,Cisco Locations RSVP,Cisco Media Streaming App,Cisco Mobility Manager,Cisco MOH Device,Cisco MTP Device,Cisco Presence Features,Cisco QSIG Features,Cisco Recording,Cisco SAF Client,Cisco Signaling,Cisco SIP,Cisco SIP Line Normalization,Cisco SIP Normalization,Cisco SIP Stack,Cisco SIP Station,Cisco SW Conference Bridge Device,Cisco TFTP,Cisco Tomcat Connector,Cisco Tomcat JVM,Cisco Tomcat Web Application,Cisco Transcode Device,Cisco WebDialer,DB Local_DSN,DB User Host Information Counters,Enterprise Replication DBSpace Monitors,IP,IP6,Memory,Network Interface,Number of Replicates Created and State of Replication,Partition,Ramfs,SAML SSO,System,TCP,Thread
PM_OBJECT_COLLECT_ALL_CONCURRENCY=10

PM_OBJECT_SESSION_PERCENTANGE=Memory,Processor,Process,Partition,Thread
PM_OBJECT_SESSION_PERCENTANGE_SLEEP=15000
```

Save to .env file within project. 

DO NOT USE QUOTES OR DOUBLE QUOTES IN ENV FILE, THEY ARE NOT SUPPORTED.

https://docs.docker.com/compose/environment-variables/env-file/#syntax-rules

To view Docker enviromental variables within container run:

```linux
env
```

If you get a certificate error you can try adding the following to your .env file:

```node
NODE_OPTIONS=--experimental-vm-modules
NODE_NO_WARNINGS=1
NODE_TLS_REJECT_UNAUTHORIZED=0
```

## Running via Docker

- Create folder directory /docker/perfmon
- cd to new folder
- Create docker-compose.yml > touch docker-compose.yml
- Create .env from above > touch .env
- Run > docker-compose up -d

Docker Compose file:

```docker
services:
  perfmon:
    image: sieteunoseis/perfmon-influx-exporter:latest
    env_file:
      - .env
    volumes:
      - ./data:/usr/src/app
```
## Environment Variables

| Variable                            | Default    | Description                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| NODE_ENV                            | production | environment variable in Node.js that determines the current environment an application is running in, such as development, production, or testing                                                                                                                                                                                                            |
| PM2_PUBLIC_KEY                      | null       | pm2.io access. Optional if you want to view application metrics on pm2.io                                                                                                                                                                                                                                                                                    |
| PM2_SECRET_KEY                      | null       | pm2.io access. Optional if you want to view application metrics on pm2.io                                                                                                                                                                                                                                                                                    |
| CUCM_HOSTNAME                       | null       | CUCM IP Address                                                                                                                                                                                                                                                                                                                                              |
| CUCM_USERNAME                       | null       | CUCM Username                                                                                                                                                                                                                                                                                                                                                |
| CUCM_PASSWORD                       | null       | CUCM Password                                                                                                                                                                                                                                                                                                                                                |
| CUCM_VERSION                        | null       | CUCM Version                                                                                                                                                                                                                                                                                                                                                 |
| INFLUXDB_TOKEN                      | null       | InfluxDB API token.                                                                                                                                                                                                                                                                                                                                          |
| INFLUXDB_ORG                        | null       | InfluxDB organization id.                                                                                                                                                                                                                                                                                                                                    |
| INFLUXDB_BUCKET                     | null       | InfluxDB bucket to save data to.                                                                                                                                                                                                                                                                                                                             |
| INFLUXDB_URL                        | null       | URL of InfluxDB. i.e. http://hostname:8086.                                                                                                                                                                                                                                                                                                                  |
| PM_SERVERS                          | null       | Perfmon CUCM Server(s) to poll. If this is blank, application will use AXL to retrieve servers from cluster. Setting this is useful if you are collecting objects that only pertain to a specific set of servers. Example would be "Cisco MGCP PRI Device" would only return results for servers that match the device pools of your MGCP device.            |
| PM_INTERVAL                         | 5000       | Perfmon Interval to poll CUCM                                                                                                                                                                                                                                                                                                                                |
| PM_COOLDOWN_TIMER                   | 5000       | Perfmon Cooldown timer to wait before polling again                                                                                                                                                                                                                                                                                                          |
| PM_RETRY                            | 3          | Perfmon retries before failing                                                                                                                                                                                                                                                                                                                               |
| PM_RETRY_DELAY                      | 15000      | Perfmon delay between retries                                                                                                                                                                                                                                                                                                                                |
| PM_SERVER_CONCURRENCY               | 1          | Perfmon number of servers to poll at once                                                                                                                                                                                                                                                                                                                    |
| PM_OBJECT_COLLECT_ALL               | null       | Perfmon comma separated list of all objects to collect. Returns the perfmon data for all counters that belong to an object on a particular host. Unlike the session-based perfmon data collection, this operation collects all data in a single request and response transaction. For an object with multiple instances, data for all instances is returned. |
| PM_OBJECT_COLLECT_ALL_CONCURRENCY   | 1          | Perfmon number of objects to poll at once. Increasing this number runs the risk of being rate limited by CUCM API.                                                                                                                                                                                                                                           |
| PM_OBJECT_SESSION_PERCENTANGE       | null       | Perfmon comma separated list of all objects to collect. Performance counters that return percentage values require two or more samples to calculate performance counter changes.                                                                                                                                                                             |
| PM_OBJECT_SESSION_PERCENTANGE_SLEEP | 15000      | Perfmon sleep time between polling percentage objects.                                                                                                                                                                                                                                                                                                       |

## Troubleshooting

##### Verifing data via CUCM CLI:

```linux
show perf query counter "Cisco CallManager" "CallsActive"
```

##### Rate Limiting

If you are seeing errors in the logs:

```linux
{
  "status": 500,
  "code": "Internal Server Error",
  "host": "hq-cucm-pub.abc.inc",
  "object": "SAML SSO",
  "message": "Exceeded allowed rate for Perfmon information. Current allowed rate for perfmon information is 80 requests per minute.PerfmonService"
}
```

Suggest increasing the limit to 18 under the CUCM Enterprise Parameters for Rate Control → Allowed Device Queries Per Minute web interface.

##### Number of Nodes in the Cluster

In large cluster, configure your application to point SOAP clients to individual servers that have server specific Perfmon counters. This can be done via the PM_SERVERS enviromental variable.
  
##### Debugging CUCM Log files

To view the log files on the CUCM server:

```linux

file list activelog /tomcat/logs/soap/csv/ratecontrol*.csv page detail date reverse
file view activelog /tomcat/logs/soap/csv/ratecontrol*.csv

file list activelog /tomcat/logs/soap/csv/axis2ratecontrol*.csv page detail date reverse
file view activelog /tomcat/logs/soap/csv/axis2ratecontrol*.csv

file list activelog /tomcat/logs/soap/log4j/soap*.log page detail date reverse
file view activelog /tomcat/logs/soap/log4j/soap*.log
```

## Giving Back

If you would like to support my work and the time I put in creating the code, you can click the image below to get me a coffee. I would really appreciate it (but is not required).

[![Buy Me A Coffee](https://www.buymeacoffee.com/assets/img/custom_images/black_img.png)](https://www.buymeacoffee.com/automatebldrs)

-Jeremy Worden

Enjoy!
