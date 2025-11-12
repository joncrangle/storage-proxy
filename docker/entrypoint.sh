#!/bin/sh

set -e

# Get the path from the DB_PATH, removing the 'file:' prefix.
DB_FILE_PATH=${DB_PATH#file:}
DB_DIR=$(dirname "$DB_FILE_PATH")

echo "Ensuring data directory exists at $DB_DIR..."
mkdir -p "$DB_DIR"

# Run migrations only if a drizzle config is present
if [ -f /app/drizzle.config.ts ] || [ -f /app/drizzle.config.mts ] || [ -f /app/drizzle.config.cjs ] || [ -f /app/drizzle.config.js ] || [ -f /app/drizzle.config.json ]; then
  echo "Applying database schema..."
  bun run drizzle-kit push
else
  echo "No drizzle.config.* found in /app; skipping migrations"
fi

chown -R bun:bun "$DB_DIR"

exec "$@"
