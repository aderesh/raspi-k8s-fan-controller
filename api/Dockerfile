FROM node:18-alpine
WORKDIR /app
COPY . .
RUN apt-get install -y libpigpio-dev libpigpio1 libpigpiod-if-dev libpigpiod-if1 libpigpiod-if2-1 pigpio pigpio-tools pigpiod
RUN yarn install --production
CMD ["node", "index.js"]
EXPOSE 3000