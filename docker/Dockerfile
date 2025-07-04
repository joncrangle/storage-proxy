# Dockerfile for Azure Blob / S3 Bucket Proxy Server

# Use official Node.js LTS image
FROM node:20-alpine AS base

# Set working directory
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package.json and pnpm-lock.yaml
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY . .

# Build the app
RUN pnpm build

# Use a minimal image for running
FROM node:20-alpine AS runner
WORKDIR /app

# Copy only built files and node_modules from build stage
COPY --from=base /app/dist ./dist
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./

# Expose the port (default Express port, change if needed)
EXPOSE 3000

# Start the app
CMD ["node", "./dist/app.js"]

