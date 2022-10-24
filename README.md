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
CUCM_VERSION=<INSERT VERSION I.E. 12.5>
CUCM_PUB=<INSERT IP ADDRESS>
CUCM_USERNAME=<INSERT USERNAME>
CUCM_PASSWORD=<INSERT PASSWORD>
TIMER=3000
INFLUXDB_TOKEN=<INSERT INFLUXDB TOKEN>
INFLUXDB_ORG=<INSERT INFLUXDB ORG>
INFLUXDB_BUCKET=cisco_cucm
INFLUXDB_URL=<INSERT INFLUXDB URL>
PERFMON_COUNTER_ARR=["Cisco Annunciator Device","Cisco AXL Web Service","Cisco Call Restriction","Cisco CallManager","Cisco CallManager System Performance","Cisco CAR DB","Cisco CTI Manager","Cisco Device Activation","Cisco Dual-Mode Mobility","Cisco Extension Mobility","Cisco Hunt Lists","Cisco Hunt Pilots","Cisco IP Manager Assistant","Cisco IVR Device","Cisco LBM Service","Cisco LDAP Directory","Cisco Locations LBM","Cisco Locations RSVP","Cisco Media Streaming App","Cisco Mobility Manager","Cisco MOH Device","Cisco MTP Device","Cisco Presence Features","Cisco QSIG Features","Cisco Recording","Cisco SAF Client","Cisco Signaling","Cisco SIP","Cisco SIP Line Normalization","Cisco SIP Normalization","Cisco SIP Stack","Cisco SIP Station","Cisco SW Conference Bridge Device","Cisco TFTP","Cisco Tomcat Connector","Cisco Tomcat JVM","Cisco Tomcat Web Application","Cisco Transcode Device","Cisco WebDialer","DB Local_DSN","DB User Host Information Counters","Enterprise Replication DBSpace Monitors","IP","IP6","Memory","Network Interface","Number of Replicates Created and State of Replication","Partition","Ramfs","SAML SSO","System","TCP","Thread"]
PERFMON_SESSION_ARR=["Processor"]
```

Save to docker.txt file within project.

To view Docker enviromental variables within container run:

```linux
env
```

## Giving Back

If you would like to support my work and the time I put in creating the code, you can click the image below to get me a coffee. I would really appreciate it (but is not required).

[![Buy Me A Coffee](https://www.buymeacoffee.com/assets/img/custom_images/black_img.png)](https://www.buymeacoffee.com/automatebldrs)

-Jeremy Worden

Enjoy!
