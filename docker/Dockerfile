# Dockerfile for Azure Blob / S3 Bucket Proxy Server

# Use official Bun image
FROM oven/bun:latest AS base

# Set working directory
WORKDIR /app

# Install system dependencies for native modules
RUN apt-get update && \
  apt-get install -y python3 make g++ && \
  ln -s /usr/bin/python3 /usr/bin/python && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy package.json, bun.lock, and all source files
COPY package.json bun.lock ./
COPY . .

# Install dependencies
RUN bun install --frozen-lockfile

# Build the app
RUN bun run build --target=bun

# Use a minimal image for running
FROM oven/bun:alpine AS runner
WORKDIR /app

ENV DB_PATH=file:/app/data/storage-proxy.sqlite3

# Copy only built files and dependencies from build stage
COPY --from=base /app/dist ./dist
COPY --from=base /app/package.json ./
COPY --from=base /app/bun.lock ./
COPY --from=base /app/node_modules ./node_modules

RUN mkdir -p /app/data && chown bun:bun /app/data

COPY docker/entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3000

USER bun

ENTRYPOINT ["entrypoint.sh"]

# Start the app
CMD ["bun", "./dist/src/server.js"]
