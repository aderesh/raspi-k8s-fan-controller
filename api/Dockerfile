FROM node:18-alpine
WORKDIR /app
COPY . .
#RUN apt-get install -y libpigpio-dev libpigpio1 libpigpiod-if-dev libpigpiod-if1 libpigpiod-if2-1 pigpio pigpio-tools pigpiod
RUN ls -la
RUN apk update
RUN apk add libpigpio-dev libpigpio1 libpigpiod-if-dev libpigpiod-if1 libpigpiod-if2-1 pigpio pigpio-tools pigpiod
RUN yarn install --production
RUN ls -la
CMD ["node", "index.js"]
EXPOSE 36637