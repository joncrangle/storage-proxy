import { defineConfig } from "drizzle-kit";

const dbPath = process.env.DB_PATH || "./storage-proxy.sqlite3";

export default defineConfig({
	out: "./drizzle",
	schema: "./src/services/db.schemas.ts",
	dialect: "sqlite",
	dbCredentials: {
		url: dbPath,
	},
});
