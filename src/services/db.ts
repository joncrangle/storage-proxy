import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

/**
 * Create a SQLite database connection using Bun's SQLite driver.
 *
 * Drizzle ORM is used to manage the database schema and queries.
 */
const sqlite = new Database("file:./storage-proxy.sqlite");
export const db = drizzle({ client: sqlite });
