# Debian image with Chromium + libs required by Puppeteer/whatsapp-web.js
# Fixes: libglib-2.0.so.0 / "Failed to launch the browser process" on slim Linux hosts.

FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Use OS Chromium instead of Puppeteer's downloaded binary (needs full glibc stack).
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

COPY frontend/package*.json frontend/
WORKDIR /app/frontend
RUN npm ci 2>/dev/null || npm install

WORKDIR /app
COPY . .

RUN cd frontend && npm run build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
