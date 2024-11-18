#!/bin/bash

if [ "$1" = "start" ]; then
    pm2-runtime start ecosystem.config.js --env=production
elif [ "$1" = "config" ]; then
    NODE_ENV=development node main.js config -s $2 -o "$3"
else
    echo "Invalid command: $1"
    exit 1
fi