FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ghostscript \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

RUN chown -R node:node /app
ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080

USER node

CMD sh -c "\
    echo '--- DIAGNOSTICS START ---'; \
    echo '1. Current User: '$(whoami); \
    echo '2. Node Version: '$(node -v); \
    echo '3. Ghostscript Version: '$(gs --version); \
    echo '4. Directory Structure:'; \
    ls -R /app/dist; \
    echo '5. Environment Check:'; \
    if [ -z \"\$COMPRESSION_SERVICE_SECRET\" ]; then echo '!!! WARNING: SECRET IS MISSING !!!'; else echo 'Secret is set'; fi; \
    echo '--- DIAGNOSTICS END. STARTING APP ---'; \
    node dist/index.js"