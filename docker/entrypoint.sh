#!/bin/sh

set -e

# Get the path from the DB_PATH, removing the 'file:' prefix.
DB_FILE_PATH=${DB_PATH#file:}
DB_DIR=$(dirname "$DB_FILE_PATH")

echo "Ensuring data directory exists at $DB_DIR..."
mkdir -p "$DB_DIR"

echo "Applying database schema..."
bun run drizzle-kit push

chown -R bun:bun "$DB_DIR"

exec "$@"
