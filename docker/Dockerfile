# Dockerfile for Azure Blob / S3 Bucket Proxy Server

# Use official Bun image
FROM oven/bun:latest AS base

# Set working directory
WORKDIR /app

# Copy package.json, bun.lock, and all source files
COPY package.json bun.lock ./
COPY . .

# Install dependencies
RUN bun install --frozen-lockfile

# Build the app
RUN bun run build

# Use a minimal image for running
FROM oven/bun:alpine AS runner
WORKDIR /app

# Copy only built files and dependencies from build stage
COPY --from=base /app/dist ./dist
COPY --from=base /app/package.json ./
COPY --from=base /app/bun.lock ./
RUN bun install --production

# Expose port 3000
EXPOSE 3000

# Start the app
CMD ["bun", "./dist/src/server.js"]
