# Cisco CUCM RisPort Docker Gateway

NodeJS application using Cisco RisPort API to send data to InfluxDB cloud.

## Install

```node
npm run docker:build
npm run docker:push
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
INFLUXDB_BUCKET=cisco_risport
INFLUXDB_URL=<INSERT INFLUXDB URL>
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
