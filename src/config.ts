import * as z from "zod";

export const configSchema = z.object({
	STORAGE_PROVIDER: z.string().optional().default("azure"),
	DB_PATH: z.string().optional().default("storage-proxy.sqlite3"),
	AWS_ACCESS_KEY_ID: z.string().optional(),
	AWS_SECRET_ACCESS_KEY: z.string().optional(),
	AWS_REGION: z.string().optional(),
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
	BASE_URL: z.url().min(1, "BASE_URL is required"),
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
	METRICS_RETENTION_DAYS: z
		.string()
		.optional()
		.default("90")
		.transform((v) => Number.parseInt(v, 10)),
});

const config = configSchema.parse(process.env);

export const NODE_ENV = config.NODE_ENV;
export const isLocalEnv =
	config.NODE_ENV === "development" || config.NODE_ENV === "test";
export const DB_PATH = !isLocalEnv
	? config.DB_PATH
	: `${NODE_ENV}-storage-proxy.sqlite3`;
export const PORT = config.PORT;
export const BASE_URL = config.BASE_URL ?? `http://localhost:${PORT}`;
export const SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
export const TOUCH_INTERVAL = 60 * 1000; // 1 minute
export const CACHE_TTL = config.CACHE_TTL;
export const MAX_FILE_SIZE = config.MAX_FILE_SIZE;
export const SESSION_SECRET = config.SESSION_SECRET;
export const STORAGE_PROVIDER = config.STORAGE_PROVIDER;
export const AZURE_STORAGE_CONNECTION_STRING =
	isLocalEnv && config.AZURITE_CONNECTION_STRING
		? config.AZURITE_CONNECTION_STRING
		: config.AZURE_STORAGE_CONNECTION_STRING;
export const ENTRA = {
	TENANT_ID: config.AZURE_TENANT_ID,
	CLIENT_SECRET: config.AZURE_CLIENT_SECRET,
	CLIENT_ID: config.AZURE_CLIENT_ID,
	JWT_AUDIENCE: config.JWT_AUDIENCE,
	JWT_ISSUER: config.JWT_ISSUER,
	JWT_ALLOWED_APPS: config.JWT_ALLOWED_APPS,
	ALLOWED_ORGANIZATION_ID: config.ALLOWED_ORGANIZATION_ID,
};
export const AWS = {
	ACCESS_KEY_ID: config.AWS_ACCESS_KEY_ID,
	SECRET_ACCESS_KEY: config.AWS_SECRET_ACCESS_KEY,
	REGION: config.AWS_REGION,
};
export const LOG_LEVEL = config.LOG_LEVEL;
export const METRICS_RETENTION_DAYS = config.METRICS_RETENTION_DAYS;
