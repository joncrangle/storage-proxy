import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireAuth } from "../middleware/auth";
import { logger } from "../services/logger";
import { metricsCollector } from "../services/metrics";
import {
	clearOrPersistMetricsAPI,
	containerFilesSchema,
	containersAPI,
	exportActionSchema,
	exportFormatSchema,
	exportMetricsAPI,
	filesAPI,
	filesSchema,
	getContainerFilesAPI,
	getContainerSummaryAPI,
	summaryAPI,
} from "./metrics.schemas";

const app = new Hono();

// Require auth for all metrics routes
app.use("*", requireAuth);

/**
 * Get files accessed across all containers.
 * Optional limit parameter to control number of results.
 * Optional startDate and endDate parameters to filter by date range.
 */
app.get(
	"/files",
	describeRoute(filesAPI),
	zValidator("query", filesSchema),
	async (c) => {
		try {
			const { limit, startDate, endDate } = c.req.valid("query");

			const data = await metricsCollector.getAccessedFiles(
				limit,
				undefined,
				startDate,
				endDate,
			);

			return c.json({
				success: true,
				data,
				limit,
				startDate,
				endDate,
				requestId: c.get("requestId"),
			});
		} catch (error) {
			logger.error(
				{
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					requestId: c.get("requestId"),
				},
				"Failed to get accessed files",
			);
			return c.json(
				{
					error: "Server Error",
					message: "Could not retrieve accessed files",
					requestId: c.get("requestId"),
				},
				500,
			);
		}
	},
);

/**
 * Get container statistics.
 */
app.get("/containers", describeRoute(containersAPI), async (c) => {
	try {
		const data = await metricsCollector.getContainerStats();
		return c.json({
			success: true,
			data,
			requestId: c.get("requestId"),
		});
	} catch (error) {
		logger.error(
			{
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				requestId: c.get("requestId"),
			},
			"Failed to get container stats",
		);
		return c.json(
			{
				error: "Server Error",
				message: "Could not retrieve container stats",
				requestId: c.get("requestId"),
			},
			500,
		);
	}
});

/**
 * Get container summary statistics.
 */
app.get("/summary", describeRoute(summaryAPI), async (c) => {
	try {
		const data = await metricsCollector.getSummaryStats();
		return c.json({
			success: true,
			data,
			requestId: c.get("requestId"),
		});
	} catch (error) {
		logger.error(
			{
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				requestId: c.get("requestId"),
			},
			"Failed to get summary stats",
		);
		return c.json({
			error: "Server Error",
			message: "Could not retrieve summary stats",
			requestId: c.get("requestId"),
		});
	}
});

/**
 * Get files accessed within a container.
 * Optional limit parameter to control number of results.
 * Optional startDate and endDate parameters to filter by date range.
 */
app.get(
	"/:container/files",
	describeRoute(getContainerFilesAPI),
	zValidator("param", containerFilesSchema),
	zValidator("query", filesSchema),
	async (c) => {
		try {
			const { container } = c.req.valid("param");
			const { limit, startDate, endDate } = c.req.valid("query");

			const data = await metricsCollector.getAccessedFiles(
				limit,
				container,
				startDate,
				endDate,
			);

			return c.json({
				success: true,
				data,
				limit,
				startDate,
				endDate,
				requestId: c.get("requestId"),
			});
		} catch (error) {
			logger.error(
				{
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					requestId: c.get("requestId"),
				},
				"Error retrieving files metrics",
			);
			return c.json(
				{
					error: "Server Error",
					message: "Could not retrieve metrics",
					requestId: c.get("requestId"),
				},
				500,
			);
		}
	},
);

/**
 * Get metrics summary for a specific container.
 */
app.get(
	"/:container/summary",
	describeRoute(getContainerSummaryAPI),
	zValidator("param", containerFilesSchema),
	async (c) => {
		try {
			const { container } = c.req.valid("param");
			const summary = await metricsCollector.getSummaryStats(container);
			return c.json({
				success: true,
				data: {
					...summary,
				},
				requestId: c.get("requestId"),
			});
		} catch (error) {
			logger.error(
				{
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					requestId: c.get("requestId"),
				},
				"Error retrieving metrics summary",
			);
			return c.json(
				{
					error: "Server Error",
					message: "Unable to retrieve metrics summary",
					requestId: c.get("requestId"),
				},
				500,
			);
		}
	},
);

/**
 * Export metrics data as either JSON or CSV.
 */
app.on(
	["GET", "POST"],
	"/:container/export",
	describeRoute(exportMetricsAPI),
	zValidator("query", exportFormatSchema),
	zValidator("json", exportFormatSchema),
	zValidator("param", containerFilesSchema),
	async (c) => {
		try {
			const { container } = c.req.valid("param");
			const { format, startDate, endDate } =
				c.req.method === "POST" ? c.req.valid("json") : c.req.valid("query");
			const user = c.get("user");

			await metricsCollector.forcePersist();
			const allMetrics = await metricsCollector.getAccessedFiles(
				undefined,
				container,
				startDate,
				endDate,
			);
			const timestamp = new Date().toISOString().split("T")[0];

			if (format === "csv") {
				const csvHeader =
					"Path,Container/Bucket,Blob/Key,Storage Type,Total Accesses,First Accessed,Last Accessed,Recent Users Count\n";
				const csvRows = allMetrics
					.map((m) =>
						[
							m.container,
							`"${m.blob}"`,
							m.totalAccesses,
							m.firstAccessed &&
							typeof m.firstAccessed.toISOString === "function"
								? m.firstAccessed.toISOString()
								: (m.firstAccessed ?? ""),
							m.lastAccessed && typeof m.lastAccessed.toISOString === "function"
								? m.lastAccessed.toISOString()
								: (m.lastAccessed ?? ""),
							m.recentUsersCount,
						].join(","),
					)
					.join("\n");

				c.header("Content-Type", "text/csv");
				c.header(
					"Content-Disposition",
					`attachment; filename="metrics-${timestamp}.csv"`,
				);
				return c.text(csvHeader + csvRows);
			} else {
				// JSON
				c.header("Content-Type", "application/json");
				return c.json({
					exportedAt: new Date().toISOString(),
					exportedBy: user?.email ?? "unknown",
					metrics: allMetrics,
					requestId: c.get("requestId"),
				});
			}
		} catch (error) {
			logger.error(
				{
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					requestId: c.get("requestId"),
				},
				"Error during metrics export",
			);
			return c.json({
				error: "Server Error",
				message: "Could not export metrics",
				requestId: c.get("requestId"),
			});
		}
	},
);

/**
 * Clear or persist metrics based on the action specified in the query parameter.
 * action=clear will clear all metrics (not allowed in production).
 * action=persist will force persist the current metrics to database.
 */
app.post(
	"/",
	describeRoute(clearOrPersistMetricsAPI),
	zValidator("json", exportActionSchema),
	async (c) => {
		const { action } = c.req.valid("json");
		try {
			if (action === "clear") {
				if (process.env.NODE_ENV === "production") {
					return c.json(
						{
							error: "Forbidden",
							message: "Not allowed in production",
							requestId: c.get("requestId"),
						},
						403,
					);
				}

				await metricsCollector.clearMetrics();
				return c.json({
					success: true,
					message: "Metrics cleared",
					requestId: c.get("requestId"),
				});
			}

			if (action === "persist") {
				await metricsCollector.forcePersist();
				return c.json({
					success: true,
					message: "Metrics persisted",
					requestId: c.get("requestId"),
				});
			}

			return c.json(
				{
					error: "Invalid action",
					message: `Unsupported action: ${action}`,
					requestId: c.get("requestId"),
				},
				400,
			);
		} catch (error) {
			logger.error(
				{
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					requestId: c.get("requestId"),
				},
				`Failed to perform metrics action: ${action}`,
			);
			return c.json(
				{
					error: "Server Error",
					message: `Could not ${action} metrics`,
					requestId: c.get("requestId"),
				},
				500,
			);
		}
	},
);

export default app;
