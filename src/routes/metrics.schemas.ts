import { resolver } from "hono-openapi/zod";
import * as z from "zod";
import type { metricsCollector } from "../services/metrics";
import { containerNameSchema } from "../services/storage.schemas";
import {
	forbiddenResponse,
	unauthorizedResponse,
	unknownErrorResponse,
} from "./index.schemas";

/**
 * Route input schemas
 */
export const topFilesSchema = z
	.object({
		limit: z.string().transform((val) => {
			const parsedLimit = Number(val);
			return Number.isNaN(parsedLimit) ? 10 : Math.min(parsedLimit, 100);
		}),
	})
	.transform((data) => {
		const validatedLimit = data.limit;

		return {
			limit: validatedLimit,
		};
	});

export const rangeRouteSchema = z
	.object({
		startDate: z.iso.datetime().transform((value) => new Date(value)),
		endDate: z.iso
			.datetime()
			.transform((value) => new Date(value))
			.optional(),
	})
	.refine(
		(data) => {
			const start = new Date(data.startDate);
			const end = data.endDate ? new Date(data.endDate) : null;
			return !end || end >= start;
		},
		{
			message: "endDate cannot be before startDate",
			path: ["endDate"],
		},
	)
	.transform((data) => ({
		startDate: new Date(data.startDate),
		endDate: data.endDate ? new Date(data.endDate) : new Date(),
	}));

export const containerTopFilesSchema = z
	.object({
		container: containerNameSchema,
		limit: z.string().transform((val) => {
			const parsedLimit = Number(val);
			return Number.isNaN(parsedLimit) ? 10 : Math.min(parsedLimit, 100);
		}),
	})
	.transform((data) => {
		containerNameSchema.parse(data.container);
		return {
			container: data.container,
			limit: data.limit,
		};
	});

/**
 * Route schemas
 */
export const topFilesAPI = {
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
							data: z.array(
								z.custom<
									ReturnType<typeof metricsCollector.getAccessedFiles>
								>(),
							),
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

export const containerTopFilesAPI = {
	description: "List top accessed files in a specific container",
	tags: ["metrics"],
	responses: {
		200: {
			description: "List of top accessed files in a specific container",
			content: {
				"application/json": {
					schema: resolver(
						z.object({
							success: z.boolean(),
							data: z.array(
								z.custom<
									ReturnType<typeof metricsCollector.getAccessedFiles>
								>(),
							),
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
							data: z.array(
								z.custom<
									ReturnType<typeof metricsCollector.getContainerStats>
								>(),
							),
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
							data: z.custom<
								ReturnType<typeof metricsCollector.getSummaryStats>
							>(),
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

export const getRangeAPI = {
	description: "Get metrics by a date range",
	tags: ["metrics"],
	responses: {
		200: {
			description:
				"Successful response with access statistics for the specified date range",
			content: {
				"application/json": {
					schema: resolver(
						z.object({
							success: z.boolean(),
							data: z.array(
								z.custom<
									ReturnType<typeof metricsCollector.getMetricsByTimeRange>
								>(),
							),
							requestId: z.string(),
						}),
					),
					example: {
						success: true,
						data: [
							{
								container: "container-name",
								blob: "test-file.txt",
								totalAccesses: 100,
								firstAccessed: new Date("2025-01-01T00:00:00Z"),
								recentUsersCount: 20,
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
