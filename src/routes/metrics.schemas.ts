import { resolver } from "hono-openapi/zod";
import * as z from "zod";
import {
	accessedFilesSchema,
	containerStatsSchema,
	summaryStatsSchema,
} from "../services/metrics.schemas";
import { containerNameSchema } from "../services/storage.schemas";
import {
	forbiddenResponse,
	unauthorizedResponse,
	unknownErrorResponse,
} from "./index.schemas";

/**
 * Route input schemas
 */
export const filesSchema = z
	.object({
		limit: z.coerce.number().nonnegative().optional(),
		startDate: z.coerce.date().optional(),
		endDate: z.coerce.date().optional(),
	})
	.refine(
		(data) => {
			if (data.startDate !== undefined) {
				return !data.endDate || data.endDate >= data.startDate;
			}
			return true;
		},
		{
			message: "endDate cannot be before startDate",
			path: ["endDate"],
		},
	);

export const containerFilesSchema = z.object({
	container: containerNameSchema,
});

export const exportFormatSchema = z
	.object({
		format: z.enum(["json", "csv"]).default("json"),
		startDate: z.coerce.date().optional(),
		endDate: z.coerce.date().optional(),
	})
	.refine(
		(data) => {
			if (data.startDate !== undefined) {
				return !data.endDate || data.endDate >= data.startDate;
			}
			return true;
		},
		{
			message: "endDate cannot be before startDate",
			path: ["endDate"],
		},
	);

export const exportActionSchema = z.object({
	action: z.enum(["clear", "persist"]),
});

/**
 * Route schemas
 */
export const filesAPI = {
	description: "List top accessed files among containers",
	tags: ["metrics"],
	responses: {
		200: {
			description: "List of top accessed files among containers",
			content: {
				"application/json": {
					schema: resolver(
						z.object({
							success: z.boolean(),
							data: z.array(accessedFilesSchema),
							limit: z.number().int().nonnegative(),
							requestId: z.string(),
						}),
					),
					example: {
						success: true,
						data: [
							{
								container: "container-name",
								blob: "test-file.txt",
								totalAccesses: 10,
								firstAccessed: new Date("2025-01-01T00:00:00Z"),
								lastAccessed: new Date("2025-01-02T00:00:00Z"),
								recentUsersCount: 3,
							},
						],
						limit: 10,
						requestId: "abc123",
					},
				},
			},
		},
		...unauthorizedResponse,
		...forbiddenResponse,
		...unknownErrorResponse,
	},
};

export const containersAPI = {
	description: "Get aggregated statistics for all containers",
	tags: ["metrics"],
	responses: {
		200: {
			description: "Successful response with aggregated container metrics",
			content: {
				"application/json": {
					schema: resolver(
						z.object({
							success: z.boolean(),
							data: z.array(containerStatsSchema),
							requestId: z.string(),
						}),
					),
					example: {
						success: true,
						data: [
							{
								container: "container-name",
								totalAccesses: 10,
								uniqueFiles: 5,
								uniqueUsers: 3,
							},
						],
						requestId: "abc123",
					},
				},
			},
		},
		...unauthorizedResponse,
		...forbiddenResponse,
		...unknownErrorResponse,
	},
};

export const summaryAPI = {
	description: "Get summary statistics for all containers",
	tags: ["metrics"],
	responses: {
		200: {
			description: "Successful response with summary statistics",
			content: {
				"application/json": {
					schema: resolver(
						z.object({
							success: z.boolean(),
							data: summaryStatsSchema,
							requestId: z.string(),
						}),
					),
					example: {
						success: true,
						data: {
							totalFiles: 100,
							totalAccesses: 200,
							uniqueUsers: 50,
							uniqueContainers: 10,
							averageAccessesPerFile: 2,
						},
						requestId: "abc123",
					},
				},
			},
		},
		...unauthorizedResponse,
		...forbiddenResponse,
		...unknownErrorResponse,
	},
};

export const getContainerFilesAPI = {
	description: "Get files metadata for a specific container",
	tags: ["metrics"],
	responses: {
		200: {
			description: "Successful response with files metadata",
			content: {
				"application/json": {
					schema: resolver(
						z.object({
							success: z.boolean(),
							data: accessedFilesSchema,
							limit: z.number().int().nonnegative().optional(),
							requestId: z.string(),
						}),
					),
					example: {
						success: true,
						data: {
							container: "container-name",
							blob: "blob-data",
							totalAccesses: 5,
							firstAccessed: new Date("2025-01-01T00:00:00Z"),
							lastAccessed: new Date("2025-01-02T00:00:00Z"),
							recentUsersCount: 2,
						},
						requestId: "abc123",
					},
				},
			},
		},
		...unauthorizedResponse,
		...forbiddenResponse,
		...unknownErrorResponse,
	},
};

export const exportMetricsAPI = {
	description: "Export metrics data",
	tags: ["metrics"],
	responses: {
		200: {
			description: "Successful response with metrics data",
			content: {
				"application/json": {
					schema: resolver(
						z.object({
							exportedAt: z.date(),
							exportedBy: z.string(),
							metrics: z.array(accessedFilesSchema),
							requestId: z.string(),
						}),
					),
					example: {
						exportedAt: new Date("2025-01-01T00:00:00Z"),
						exportedBy: "First.Last@email.com",
						metrics: [
							{
								container: "container-name",
								blob: "blob-data",
								totalAccesses: 10,
								firstAccessed: new Date("2025-01-01T00:00:00Z"),
								lastAccessed: new Date("2025-01-10T00:00:00Z"),
								recentUsersCount: 5,
							},
						],
						requestId: "abc123",
					},
				},
				"text/csv": {
					schema: resolver(z.string()),
					example: `Path,Container/Bucket,Blob/Key,Storage Type,Total Accesses,First Accessed,Last Accessed,Recent Users Count
container-name,blob-data,10,2025-01-01T00:00:00Z,2025-01-10T00:00:00Z,5`,
				},
			},
		},
		...unauthorizedResponse,
		...forbiddenResponse,
		...unknownErrorResponse,
	},
};

export const clearOrPersistMetricsAPI = {
	description: "Clear or persist metrics data",
	tags: ["metrics"],
	responses: {
		200: {
			description: "Successful operation",
			content: {
				"application/json": {
					schema: resolver(
						z.object({
							success: z.boolean(),
							message: z.string(),
							requestId: z.string(),
						}),
					),
					example: {
						success: true,
						message: "Metrics cleared.",
						requestId: "abc123",
					},
				},
			},
		},
		403: {
			description: "Forbidden",
			content: {
				"application/json": {
					schema: resolver(
						z.object({
							error: z.string(),
							message: z.string(),
							requestId: z.string(),
						}),
					),
					example: {
						error: "Forbidden",
						message: "Not allowed in production",
						requestId: "abc123",
					},
				},
			},
		},
		...unauthorizedResponse,
		...unknownErrorResponse,
	},
};

export const getContainerSummaryAPI = {
	description: "Get summary statistics for a container",
	tags: ["metrics"],
	responses: {
		200: {
			description: "Successful response with summary statistics",
			content: {
				"application/json": {
					schema: resolver(
						z.object({
							success: z.boolean(),
							data: summaryStatsSchema,
							requestId: z.string(),
						}),
					),
					example: {
						success: true,
						data: {
							totalFiles: 100,
							totalAccesses: 200,
							uniqueUsers: 50,
							uniqueContainers: 10,
							averageAccessesPerFile: 2,
						},
						requestId: "abc123",
					},
				},
			},
		},
		...unauthorizedResponse,
		...forbiddenResponse,
		...unknownErrorResponse,
	},
};
