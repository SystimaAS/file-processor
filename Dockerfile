# Node 22 based on Debian Bookworm (stable and secure)
FROM node:22-bookworm-slim

# Install Ghostscript
RUN apt-get update && apt-get install -y \
    ghostscript \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only necessary files for installation
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built code (dist must be created via npm run build)
COPY dist/ ./dist/

# Azure App Service / Container Apps typically listen on 8080
ENV PORT=8080
EXPOSE 8080

USER node
CMD ["node", "dist/index.js"]

