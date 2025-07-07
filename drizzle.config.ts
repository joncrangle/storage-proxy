import { defineConfig } from "drizzle-kit";

export default defineConfig({
	out: "./drizzle",
	schema: "./src/services/db.schemas.ts",
	dialect: "sqlite",
	dbCredentials: {
		url: "file:./storage-proxy.sqlite",
	},
});
