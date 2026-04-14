FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY mqtt_bridge.js ./

EXPOSE 3500

CMD ["node", "mqtt_bridge.js"]
