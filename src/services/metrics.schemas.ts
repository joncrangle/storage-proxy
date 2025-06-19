import * as z from "zod";

/**
 * Types
 */
export type Metric = z.infer<typeof metricsSchema>;
export type ContainerStats = z.infer<typeof containerStatsSchema>;
export type SummaryStats = z.infer<typeof summaryStatsSchema>;
export type AccessedFiles = z.infer<typeof accessedFilesSchema>;
export type AccessEvent = z.infer<typeof accessEventSchema>;
export type MetricUpdate = z.infer<typeof metricUpdateSchema>;

/**
 * Schemas
 */
const metricsSchema = z.object({
	container: z.string(),
	blob: z.string(),
	totalAccesses: z.number().int().nonnegative(),
	firstAccessed: z.date(),
	lastAccessed: z.date(),
	recentUsers: z.set(z.string()).optional(),
});

export const containerStatsSchema = z.object({
	container: z.string(),
	totalAccesses: z.number().int().nonnegative(),
	uniqueFiles: z.number().int().nonnegative(),
	uniqueUsers: z.number().int().nonnegative(),
});

export const summaryStatsSchema = z.object({
	totalFiles: z.number().int().nonnegative(),
	totalAccesses: z.number().int().nonnegative(),
	uniqueUsers: z.number().int().nonnegative(),
	uniqueContainers: z.number().int().nonnegative(),
});

export const accessedFilesSchema = z.object({
	container: z.string(),
	blob: z.string(),
	totalAccesses: z.number().int().nonnegative(),
	firstAccessed: z.date(),
	lastAccessed: z.date(),
	recentUsersCount: z.number().int().nonnegative(),
});

export const accessEventSchema = z.object({
	container: z.string(),
	blob: z.string(),
	userId: z.string(),
	timestamp: z.date(),
});

export const metricUpdateSchema = z.object({
	container: z.string(),
	blob: z.string(),
	accessCount: z.number().int().positive(),
	firstAccessed: z.date(),
	lastAccessed: z.date(),
	recentUsers: z.set(z.string()),
});
