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
