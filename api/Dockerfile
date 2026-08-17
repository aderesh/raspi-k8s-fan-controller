FROM node:24-bookworm-slim

RUN apt-get update \
		&& apt-get install -y --no-install-recommends ca-certificates curl gnupg \
		&& curl -fsSL https://archive.raspberrypi.org/debian/raspberrypi.gpg.key \
			| gpg --dearmor --output /usr/share/keyrings/raspberrypi-archive-keyring.gpg \
		&& echo "deb [signed-by=/usr/share/keyrings/raspberrypi-archive-keyring.gpg] http://archive.raspberrypi.org/debian/ bookworm main" \
			> /etc/apt/sources.list.d/raspberrypi.list \
		&& apt-get update \
		&& apt-get install -y --no-install-recommends raspi-gpio \
		&& rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY api/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY api/ ./

STOPSIGNAL SIGTERM
CMD ["node", "index.js"]
EXPOSE 36637