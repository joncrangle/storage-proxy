import { randomBytes } from "node:crypto";
import { z } from "zod";

const configSchema = z.object({
	STORAGE_PROVIDER: z.string().optional().default("azure"),
	AWS_ACCESS_KEY_ID: z.string().optional(),
	AWS_SECRET_ACCESS_KEY: z.string().optional(),
	AWS_REGION: z.string().optional(),
	AWS_S3_BUCKET: z.string().optional(),
	AZURE_TENANT_ID: z.string().min(1, "AZURE_TENANT_ID is required"),
	AZURE_CLIENT_ID: z.string().min(1, "AZURE_CLIENT_ID is required"),
	AZURE_CLIENT_SECRET: z.string().min(1, "AZURE_CLIENT_SECRET is required"),
	AZURE_STORAGE_CONNECTION_STRING: z.string().optional(),
	AZURITE_CONNECTION_STRING: z.string().optional(),
	SESSION_SECRET: z.string().min(1, "SESSION_SECRET is required"),
	PORT: z
		.string()
		.optional()
		.default("3000")
		.transform((val) => {
			const port = Number(val);
			if (Number.isNaN(port) || port <= 0 || port > 65535)
				throw new Error("Invalid PORT");
			return port;
		}),
	BASE_URL: z.string().url().optional(),
	ALLOWED_ORGANIZATION_ID: z.string().optional(),
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.optional()
		.default("development"),
	LOG_LEVEL: z
		.enum(["error", "warn", "info", "debug"])
		.optional()
		.default("info"),
	CACHE_TTL: z
		.string()
		.default("3600")
		.transform((v) => Number.parseInt(v, 10)),
	MAX_FILE_SIZE: z
		.string()
		.default("100000000")
		.transform((v) => Number.parseInt(v, 10)), // 100MB
	JWT_ENABLED: z
		.string()
		.optional()
		.default("false")
		.transform((v) => v.toLowerCase() === "true"),
	JWT_AUDIENCE: z.string().optional(),
	JWT_ISSUER: z.string().optional(),
	JWT_ALLOWED_APPS: z.string().optional(), // Comma-separated list of allowed app IDs
	REDIS_HOST: z.string().optional().default("valkey"),
	REDIS_PORT: z
		.string()
		.optional()
		.default("6379")
		.transform((val) => {
			const port = Number(val);
			if (Number.isNaN(port) || port <= 0 || port > 65535)
				throw new Error("Invalid REDIS_PORT");
			return port;
		}),
	REDIS_PASSWORD: z.string().optional(),
	REDIS_DB: z
		.string()
		.optional()
		.default("0")
		.transform((val) => {
			const port = Number(val);
			if (Number.isNaN(val)) throw new Error("Invalid REDIS_DB");
			return port;
		}),
	METRICS_STORAGE_PATH: z.string().optional().default("./metrics"),
	METRICS_RETENTION_DAYS: z
		.string()
		.optional()
		.default("90")
		.transform((v) => Number.parseInt(v, 10)),
});

export const config = configSchema.parse(process.env);

// Derived Constants
const isLocalEnv =
	config.NODE_ENV === "development" || config.NODE_ENV === "test";
export const PORT = config.PORT;
export const BASE_URL = config.BASE_URL ?? `http://localhost:${PORT}`;
export const SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
export const CACHE_TTL = config.CACHE_TTL;
export const MAX_FILE_SIZE = config.MAX_FILE_SIZE;
export const SESSION_SECRET =
	config.SESSION_SECRET ?? randomBytes(32).toString("hex");

// Determine storage configuration based on environment
export const STORAGE_CONNECTION_STRING =
	isLocalEnv && config.AZURITE_CONNECTION_STRING
		? config.AZURITE_CONNECTION_STRING
		: config.AZURE_STORAGE_CONNECTION_STRING;
