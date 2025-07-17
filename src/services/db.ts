import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { DB_PATH } from "../config";
import { logger } from "./logger";

/**
 * Create a SQLite database connection using Bun's SQLite driver.
 *
 * Drizzle ORM is used to manage the database schema and queries.
 */
const sqlite = new Database(DB_PATH);

logger.info(`Connecting to SQLite database at ${DB_PATH}`);
export const db = drizzle({ client: sqlite });
