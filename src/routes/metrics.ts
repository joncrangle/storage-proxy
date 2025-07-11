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
	getContainerFilesAPI,
	getContainerRangeAPI,
	getContainerSummaryAPI,
	getContainerTopFilesAPI,
	getRangeAPI,
	rangeRouteSchema,
	summaryAPI,
	topFilesAPI,
	topFilesSchema,
} from "./metrics.schemas";

const app = new Hono();

// Require auth for all metrics routes
app.use("*", requireAuth);

/**
 * Get top files accessed across all containers.
 * Optional limit parameter to control number of results.
 */
app.get(
	"/top-files",
	describeRoute(topFilesAPI),
	zValidator("query", topFilesSchema),
	async (c) => {
		try {
			const { limit } = c.req.valid("query");
			const data = metricsCollector.getAccessedFiles(limit);

			return c.json({
				success: true,
				data,
				limit,
				requestId: c.get("requestId"),
			});
		} catch (error) {
			logger.error(
				{
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					requestId: c.get("requestId"),
				},
				"Failed to get top accessed files",
			);
			return c.json(
				{
					error: "Server Error",
					message: "Could not retrieve top accessed files",
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
app.get("/containers", describeRoute(containersAPI), (c) => {
	try {
		const data = metricsCollector.getContainerStats();
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
app.get("/summary", describeRoute(summaryAPI), (c) => {
	try {
		const data = metricsCollector.getSummaryStats();
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
 * Get file metrics by a time range.
 * startdate parameter is required, enddate is optional.
 */
app.get(
	"/range",
	describeRoute(getRangeAPI),
	zValidator("query", rangeRouteSchema),
	(c) => {
		try {
			const { startDate, endDate } = c.req.valid("query");

			const data = metricsCollector.getMetricsByTimeRange(startDate, endDate);

			return c.json({
				success: true,
				data,
				range: { startDate, endDate },
				requestId: c.get("requestId"),
			});
		} catch (error) {
			logger.error(
				{
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					requestId: c.get("requestId"),
				},
				"Failed to get metrics by date range",
			);
			return c.json(
				{
					error: "Server Error",
					message: "Could not retrieve metrics for date range",
					requestId: c.get("requestId"),
				},
				500,
			);
		}
	},
);

/**
 * Get top files accessed within a container.
 * Optional limit parameter to control number of results.
 */
app.get(
	"/:container/top-files",
	describeRoute(getContainerTopFilesAPI),
	zValidator("param", containerFilesSchema),
	zValidator("query", topFilesSchema),
	(c) => {
		try {
			const { container } = c.req.valid("param");
			const { limit } = c.req.valid("query");

			const topFiles = metricsCollector.getAccessedFiles(limit, container);

			return c.json({
				success: true,
				data: topFiles,
				limit,
				requestId: c.get("requestId"),
			});
		} catch (error) {
			logger.error(
				{
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					requestId: c.get("requestId"),
				},
				"Error retrieving top files metrics",
			);
			return c.json(
				{
					error: "Server Error",
					message: "Unable to retrieve metrics",
					requestId: c.get("requestId"),
				},
				500,
			);
		}
	},
);

/**
 * Get files metadata for a container.
 */
app.get(
	"/:container/files",
	describeRoute(getContainerFilesAPI),
	zValidator("param", containerFilesSchema),
	(c) => {
		try {
			const { container } = c.req.valid("param");
			const containerStats = metricsCollector.getContainerMetrics(container);
			return c.json({
				success: true,
				data: containerStats,
				requestId: c.get("requestId"),
			});
		} catch (error) {
			logger.error(
				{
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					requestId: c.get("requestId"),
				},
				"Error retrieving container metrics",
			);
			return c.json(
				{
					error: "Server Error",
					message: "Unable to retrieve container metrics",
					requestId: c.get("requestId"),
				},
				500,
			);
		}
	},
);

/**
 * Get file metrics for a container by a time range.
 * startdate parameter is required, enddate is optional.
 */
app.get(
	"/:container/range",
	describeRoute(getContainerRangeAPI),
	zValidator("param", containerFilesSchema),
	zValidator("query", rangeRouteSchema),
	(c) => {
		try {
			const { container } = c.req.valid("param");
			const { startDate, endDate } = c.req.valid("query");

			const data = metricsCollector.getMetricsByTimeRange(
				startDate,
				endDate,
				container,
			);

			return c.json({
				success: true,
				data,
				range: { startDate, endDate },
				requestId: c.get("requestId"),
			});
		} catch (error) {
			logger.error(
				{
					container: c.req.param("container"),
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					requestId: c.get("requestId"),
				},
				"Failed to get metrics for container by date range",
			);
			return c.json(
				{
					error: "Server Error",
					message: "Could not retrieve metrics for container and date range",
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
			const { format } =
				c.req.method === "POST" ? c.req.valid("json") : c.req.valid("query");
			const user = c.get("user");

			await metricsCollector.forcePersist();
			const allMetrics = metricsCollector.getAccessedFiles(
				undefined,
				container,
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
	zValidator("query", exportActionSchema),
	async (c) => {
		const { action } = c.req.valid("query");
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

				metricsCollector.clearMetrics();
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

/**
 * Get metrics summary for a specific container.
 */
app.get(
	"/:container",
	describeRoute(getContainerSummaryAPI),
	zValidator("param", containerFilesSchema),
	async (c) => {
		try {
			const { container } = c.req.valid("param");
			const summary = metricsCollector.getSummaryStats(container);
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

export default app;
