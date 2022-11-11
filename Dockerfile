FROM node:18-alpine
# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

RUN npm install pm2 -g
RUN npm install

# Bundle app source
COPY . .

# Start PM2 Process
CMD ["pm2-runtime", "ecosystem.config.js"]