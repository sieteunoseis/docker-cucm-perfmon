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
PERFMON_COUNTER_ARR=['Cisco CAR DB','Cisco CallManager','Cisco Phones','Cisco Lines','Cisco H323','Cisco MGCP Gateways','Cisco MOH Device','Cisco Analog Access','Cisco MGCP FXS Device','Cisco MGCP FXO Device','Cisco MGCP T1CAS Device','Cisco MGCP PRI Device','Cisco MGCP BRI Device','Cisco MTP Device','Cisco Transcode Device','Cisco SW Conference Bridge Device','Cisco HW Conference Bridge Device','Cisco Locations RSVP','Cisco Gatekeeper','Cisco CallManager System Performance','Cisco Video Conference Bridge Device','Cisco Hunt Lists','Cisco SIP','Cisco Annunciator Device','Cisco QSIG Features','Cisco SIP Stack','Cisco Presence Features','Cisco WSMConnector','Cisco Dual-Mode Mobility','Cisco SIP Station','Cisco Mobility Manager','Cisco Signaling','Cisco Call Restriction','External Call Control','Cisco SAF Client','IME Client','IME Client Instance','Cisco SIP Normalization','Cisco Telepresence MCU Conference Bridge Device','Cisco SIP Line Normalization','Cisco Hunt Pilots','Cisco Video On Hold Device','Cisco Recording','Cisco IVR Device','Cisco AXL Tomcat Connector','Cisco AXL Tomcat Web Application','Cisco AXL Tomcat JVM','Cisco LDAP Directory','Cisco Media Streaming App','Cisco SSOSP Tomcat Connector','Cisco SSOSP Tomcat Web Application','Cisco SSOSP Tomcat JVM','Cisco TFTP','Cisco Tomcat Connector','Cisco Tomcat Web Application','Cisco Tomcat JVM','Cisco UDS Tomcat Connector','Cisco UDS Tomcat Web Application','Cisco UDS Tomcat JVM','Cisco AXL Web Service','Cisco Device Activation','Cisco Extension Mobility','Cisco IP Manager Assistant','Cisco WebDialer','Cisco CTI Manager','Cisco CTI Proxy','DB Local_DSN','DB Change Notification Server','DB Change Notification Client','DB Change Notification Subscriptions','Enterprise Replication Perfmon Counters','Enterprise Replication DBSpace Monitors','Number of Replicates Created and State of Replication','DB User Host Information Counters','Cisco Locations LBM','Cisco LBM Service','Process','Partition','Memory','Thread','IP','TCP','Network Interface','System','IP6','Ramfs','Cisco HAProxy','Docker Container','SAML SSO']
PERFMON_SESSION_ARR=['Processor']
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
