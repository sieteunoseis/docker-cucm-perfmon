# Cisco CUCM Perfmon Docker Gateway

NodeJS application using Cisco Perfmon API to send data to InfluxDB cloud.

## Install

```node
npm run docker:build
npm run docker:run
```

## Needed Enviromental Variables

```node
# Nodejs Settings - Comment out if you get certificate errors
# NODE_OPTIONS=--experimental-vm-modules
# NODE_NO_WARNINGS=1
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
# PERFMON_SERVERS={ "servers": ["cucm02-sub.automate.builders"]} - Remove comment if you'd only like to run on a single server or set of servers
PERFMON_COUNTERS=Cisco Annunciator Device,Cisco AXL Web Service,Cisco Call Restriction,Cisco CallManager,Cisco CallManager System Performance,Cisco CAR DB,Cisco CTI Manager,Cisco Device Activation,Cisco Dual-Mode Mobility,Cisco Extension Mobility,Cisco Hunt Lists,Cisco IP Manager Assistant,Cisco IVR Device,Cisco LBM Service,Cisco LDAP Directory,Cisco Locations RSVP,Cisco Media Streaming App,Cisco Mobility Manager,Cisco MOH Device,Cisco MTP Device,Cisco Presence Features,Cisco QSIG Features,Cisco Recording,Cisco SAF Client,Cisco Signaling,Cisco SIP,Cisco SIP Normalization,Cisco SIP Stack,Cisco SIP Station,Cisco SW Conference Bridge Device,Cisco TFTP,Cisco Tomcat Connector,Cisco Tomcat JVM,Cisco Tomcat Web Application,Cisco WebDialer,DB Local_DSN,DB User Host Information Counters,Enterprise Replication DBSpace Monitors,IP,IP6,Memory,Network Interface,Number of Replicates Created and State of Replication,Partition,Ramfs,SAML SSO,System,TCP,Thread
PERFMON_SESSIONS=Memory,Processor,Process,Partition,Thread
PERFMON_RETRIES=10
PERFMON_RETRY_DELAY=20000
PERFMON_SERVER_CONCURRENCY=2
PERFMON_COUNTER_CONCURRENCY=5
PERFMON_COOLDOWN_TIMER=3000
PERFMON_SESSION_INTERVAL=15000
PERFMON_COUNTER_INTERVAL=15000
PERFMON_SESSIONS_SLEEP=15000
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

## Running Docker

- Create folder directory /docker/perfmon
- cd to new folder
- Create docker-compose.yml > touch docker-compose.yml
- Create .env from above > touch .env
- Run > docker-compose up -d

Docker Compose file:

```docker
version: '3'
services:
  perfmon:
    image: sieteunoseis/docker-cucm-perfmon:latest
    env_file:
      - .env
```

## Troubleshooting

Verifing data

show perf query counter "Cisco CallManager" "CallsActive"

Rate Limiting

Increase the limit to 18 under the CUCM Enterprise Parameters for Rate Control → Allowed Device Queries Per Minute web interface.

Number of Nodes in the Cluster

In large cluster, configure your application to point SOAP clients to individual servers that have server
specific Perfmon counters.
  
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
