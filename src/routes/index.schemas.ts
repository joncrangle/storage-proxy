import { resolver } from "hono-openapi/zod";
import * as z from "zod";
import { configSchema } from "../config";
import { containerInfoSchema } from "../services/storage.schemas";

/**
 * Route schemas
 */
export const errorSchema = z.object({
	error: z.string(),
	message: z.string(),
	requestId: z.string(),
});

export const unauthorizedResponse = {
	401: {
		content: {
			"application/json": {
				schema: resolver(errorSchema),
				example: {
					error: "Unauthorized",
					message: "Authentication required.",
					requestId: "abc123",
				},
			},
		},
		description: "Unauthorized",
	},
};

export const forbiddenResponse = {
	403: {
		content: {
			"application/json": {
				schema: resolver(errorSchema),
				example: {
					error: "Forbidden",
					message: "Access denied.",
					requestId: "abc123",
				},
			},
		},
		description: "Forbidden",
	},
};

export const unknownErrorResponse = {
	500: {
		content: {
			"application/json": {
				schema: resolver(errorSchema),
				example: {
					error: "Internal Server Error",
					message: "Something went wrong.",
					requestId: "abc123",
				},
			},
		},
		description: "Internal Server Error",
	},
};

const homeResponseSchema = z.object({
	name: z.string(),
	status: z.string(),
	environment: configSchema.shape.NODE_ENV,
	logging: z.enum(["error", "warn", "info", "debug"]),
	authenticated: z.boolean(),
	user: z
		.object({
			email: z.email(),
			name: z.string(),
		})
		.nullable(),
	requestId: z.string(),
});

const healthResponseSchema = z.object({
	status: z.enum(["healthy", "degraded"]),
	timestamp: z.string(),
	uptime: z.number(),
	requestId: z.string(),
	environment: configSchema.shape.NODE_ENV,
	storage: z.object({
		provider: z.string(),
		status: z.enum(["connected", "degraded"]),
		containers: z.array(containerInfoSchema).nullable(),
		error: z.string().nullable(),
	}),
});

export const homeAPI = {
	description: "Returns the current status of the app",
	tags: ["base"],
	security: [],
	responses: {
		200: {
			description: "Application status info",
			content: {
				"application/json": {
					schema: resolver(homeResponseSchema),
					example: {
						name: "Azure Blob Storage Proxy",
						status: "running",
						environment: "production",
						logging: "info",
						authenticated: true,
						user: {
							email: "user@example.com",
							name: "Example User",
						},
						requestId: "abc123",
					},
				},
			},
		},
	},
};

export const healthAPI = {
	description: "Health check endpoint",
	tags: ["base"],
	security: [],
	responses: {
		200: {
			description: "Successful health check response",
			content: {
				"application/json": {
					schema: resolver(healthResponseSchema),
					example: {
						status: "healthy",
						timestamp: new Date().toISOString(),
						uptime: 1000,
						requestId: "abc123",
						environment: "production",
						storage: {
							provider: "azure",
							status: "connected",
							containers: [],
							error: null,
						},
					},
				},
			},
		},
		503: {
			description: "Health check failed to connect to storage provider",
			content: {
				"application/json": {
					schema: resolver(healthResponseSchema),
					example: {
						status: "degraded",
						timestamp: new Date().toISOString(),
						uptime: 1000,
						requestId: "abc123",
						environment: "production",
						storage: {
							provider: "azure",
							status: "degraded",
							containers: null,
							error: "Failed to connect to storage provider",
						},
					},
				},
			},
		},
	},
};
