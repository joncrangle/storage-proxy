import * as z from "zod";

/**
 * Types
 */
export type Metric = z.infer<typeof metricsSchema>;

/**
 * Schemas
 */
const metricsSchema = z.object({
	container: z.string(),
	blob: z.string(),
	totalAccesses: z.number().int().nonnegative(),
	firstAccessed: z.date().optional(),
	lastAccessed: z.date().optional(),
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
	averageAccessesPerFile: z.number().positive(),
});

export const accessedFilesSchema = z.object({
	container: z.string(),
	blob: z.string(),
	totalAccesses: z.number().int().nonnegative(),
	firstAccessed: z.date().optional(),
	lastAccessed: z.date().optional(),
	recentUsersCount: z.number().int().nonnegative(),
});
