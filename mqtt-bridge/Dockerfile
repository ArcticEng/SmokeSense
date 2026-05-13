FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY mqtt_bridge.js ./
COPY alerts.js ./

EXPOSE 3500

CMD ["node", "mqtt_bridge.js"]
