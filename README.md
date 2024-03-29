# Cisco CUCM Perfmon Docker Gateway

NodeJS application using Cisco Perfmon API to send data to InfluxDB cloud.

## Install

```node
npm run docker:build
npm run docker:run
```

## Needed Enviromental Variables

```node
NODE_ENV=production
PM2_PUBLIC_KEY=
PM2_SECRET_KEY=
CUCM_VERSION=<INSERT VERSION I.E. 12.5>
CUCM_HOSTNAME=<INSERT IP ADDRESS>
CUCM_USERNAME=<INSERT USERNAME>
CUCM_PASSWORD=<INSERT PASSWORD>
CUCM_VERSION=14.0
COOLDOWN_TIMER=3000
SESSION_INTERVAL=1000
COUNTER_INTERVAL=5000
INFLUXDB_TOKEN=<INSERT INFLUXDB TOKEN>
INFLUXDB_ORG=<INSERT INFLUXDB ORG>
INFLUXDB_BUCKET=cisco_cucm
INFLUXDB_URL=<INSERT INFLUXDB URL>
PERFMON_COUNTERS=Cisco CAR DB,Cisco CallManager,Cisco Phones,Cisco Lines,Cisco H323,Cisco MGCP Gateways,Cisco MOH Device,Cisco Analog Access,Cisco MGCP FXS Device,Cisco MGCP FXO Device,Cisco MGCP T1CAS Device,Cisco MGCP PRI Device,Cisco MGCP BRI Device,Cisco MTP Device,Cisco Transcode Device,Cisco SW Conference Bridge Device,Cisco HW Conference Bridge Device,Cisco Locations RSVP,Cisco Gatekeeper,Cisco CallManager System Performance,Cisco Video Conference Bridge Device,Cisco Hunt Lists,Cisco SIP,Cisco Annunciator Device,Cisco QSIG Features,Cisco SIP Stack,Cisco Presence Features,Cisco WSMConnector,Cisco Dual-Mode Mobility,Cisco SIP Station,Cisco Mobility Manager,Cisco Signaling,Cisco Call Restriction,External Call Control,Cisco SAF Client,IME Client,IME Client Instance,Cisco SIP Normalization,Cisco Telepresence MCU Conference Bridge Device,Cisco SIP Line Normalization,Cisco Hunt Pilots,Cisco Video On Hold Device,Cisco Recording,Cisco IVR Device,Cisco AXL Tomcat Connector,Cisco AXL Tomcat Web Application,Cisco AXL Tomcat JVM,Cisco LDAP Directory,Cisco Media Streaming App,Cisco SSOSP Tomcat Connector,Cisco SSOSP Tomcat Web Application,Cisco SSOSP Tomcat JVM,Cisco TFTP,Cisco Tomcat Connector,Cisco Tomcat Web Application,Cisco Tomcat JVM,Cisco UDS Tomcat Connector,Cisco UDS Tomcat Web Application,Cisco UDS Tomcat JVM,Cisco AXL Web Service,Cisco Device Activation,Cisco Extension Mobility,Cisco IP Manager Assistant,Cisco WebDialer,Cisco CTI Manager,Cisco CTI Proxy,DB Local_DSN,DB Change Notification Server,DB Change Notification Client,DB Change Notification Subscriptions,Enterprise Replication Perfmon Counters,Enterprise Replication DBSpace Monitors,Number of Replicates Created and State of Replication,DB User Host Information Counters,Cisco Locations LBM,Cisco LBM Service,Process,Partition,Memory,Thread,IP,TCP,Network Interface,System,IP6,Ramfs,Cisco HAProxy,Docker Container,SAML SSO
PERFMON_SESSIONS=Memory,Processor,Docker Container,Process,Partition,Thread
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

## Giving Back

If you would like to support my work and the time I put in creating the code, you can click the image below to get me a coffee. I would really appreciate it (but is not required).

[![Buy Me A Coffee](https://www.buymeacoffee.com/assets/img/custom_images/black_img.png)](https://www.buymeacoffee.com/automatebldrs)

-Jeremy Worden

Enjoy!
