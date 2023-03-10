FROM zinen2/alpine-pigpiod
USER root
WORKDIR /app
COPY api/ .
#RUN apt-get install -y libpigpio-dev libpigpio1 libpigpiod-if-dev libpigpiod-if1 libpigpiod-if2-1 pigpio pigpio-tools pigpiod
RUN ls -la
RUN apk update
RUN apk add nodejs
RUN apk add npm
RUN apk add python3
RUN apk add make
RUN apk add g++
# RUN apk add libpigpio-dev libpigpio1 libpigpiod-if-dev libpigpiod-if1 libpigpiod-if2-1 pigpio pigpio-tools pigpiod
RUN npm install
RUN ls -la
CMD ["node", "index.js"]
EXPOSE 36637