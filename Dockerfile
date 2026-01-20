FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y \
    ghostscript \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080

USER node

CMD ["node", "dist/index.js"]