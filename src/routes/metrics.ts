import { zValidator } from "@hono/zod-validator";
import { type Context, Hono, type Next } from "hono";
import { describeRoute } from "hono-openapi";
import { requireAuth } from "../middleware/auth";
import { logger } from "../services/logger";
import { metricsCollector } from "../services/metrics";
import {
	containersAPI,
	containerTopFilesSchema,
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
	zValidator("param", topFilesSchema),
	async (c) => {
		try {
			const { limit } = c.req.valid("param");
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
	zValidator("param", rangeRouteSchema),
	(c) => {
		try {
			const { startDate, endDate } = c.req.valid("param");

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
	describeRoute(getRangeAPI),
	zValidator("param", containerTopFilesSchema),
	(c) => {
		try {
			const { container, limit } = c.req.valid("param");
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
 * @openapi
 * /v1/metrics/{container}/files:
 *   get:
 *     tags:
 *       - metrics
 *     summary: Get files metadata for a specific container
 *     parameters:
 *       - in: path
 *         name: container
 *         required: true
 *         schema:
 *           type: string
 *         description: Container name
 *     responses:
 *       200:
 *         description: List of files metadata in the container
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   description: Array of file metadata objects
 *                   items:
 *                     type: object
 *                     properties:
 *                       path:
 *                         type: string
 *                       container:
 *                         type: string
 *                       blob:
 *                         type: string
 *                       totalAccesses:
 *                         type: integer
 *                       firstAccessed:
 *                         type: string
 *                         format: date-time
 *                       lastAccessed:
 *                         type: string
 *                         format: date-time
 *                       recentUsersCount:
 *                         type: integer
 *                 requestId:
 *                   type: string
 *       401:
 *         description: Unauthorized (authentication required)
 *       403:
 *         description: Forbidden (organization access required)
 *       500:
 *         description: Server error retrieving container metrics
 */
/**
 * Get files metadata for a container.
 */
// app.get("/:container/files", (c) => {
// 	try {
// 		const { container } = req.params;
// 		const containerStats = metricsCollector.getContainerMetrics(container);
// 		res.json({
// 			success: true,
// 			data: containerStats,
// 			requestId: req.id,
// 		});
// 	} catch (err) {
// 		const message = err instanceof Error ? err.message : String(err);
// 		logger.error("Error retrieving container metrics", {
// 			requestId: req.id,
// 			error: message,
// 		});
// 		res.status(500).json({
// 			error: "Server Error",
// 			message: "Unable to retrieve container metrics",
// 			requestId: req.id,
// 		});
// 	}
// });

/**
 * @openapi
 * /v1/metrics/{container}/range:
 *   get:
 *     tags:
 *       - metrics
 *     summary: Get metrics for a specific container by date range
 *     parameters:
 *       - in: path
 *         name: container
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the container to filter metrics
 *       - in: query
 *         name: startDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for the metrics range
 *       - in: query
 *         name: endDate
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for the metrics range (optional)
 *     responses:
 *       200:
 *         description: Filtered container metrics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       path:
 *                         type: string
 *                       container:
 *                         type: string
 *                       blob:
 *                         type: string
 *                       totalAccesses:
 *                         type: integer
 *                       firstAccessed:
 *                         type: string
 *                         format: date-time
 *                       lastAccessed:
 *                         type: string
 *                         format: date-time
 *                       recentUsersCount:
 *                         type: integer
 *                 range:
 *                   type: object
 *                   properties:
 *                     startDate:
 *                       type: string
 *                     endDate:
 *                       type: string
 *                 requestId:
 *                   type: string
 *       400:
 *         description: Missing or invalid query parameters
 *       500:
 *         description: Server error retrieving metrics
 */
/**
 * Get file metrics for a container by a time range.
 * startdate parameter is required, enddate is optional.
 */
// router.get("/:container/range", (req: CustomRequest, res: Response) => {
// 	try {
// 		const { container } = req.params;
// 		const { startDate, endDate } = req.query;
//
// 		if (!startDate) {
// 			res.status(400).json({
// 				error: "Missing required query parameters",
// 				message: "startDate is required",
// 				requestId: req.id,
// 			});
// 			return;
// 		}
//
// 		const start = new Date(String(startDate));
// 		const end = endDate ? new Date(String(endDate)) : new Date();
//
// 		const data = metricsCollector.getMetricsByTimeRange(start, end, container);
//
// 		res.json({
// 			success: true,
// 			data,
// 			range: { startDate, end },
// 			requestId: req.id,
// 		});
// 	} catch (err) {
// 		const message = err instanceof Error ? err.message : String(err);
// 		logger.error("Failed to get metrics for container by date range", {
// 			container: req.params.container,
// 			requestId: req.id,
// 			error: message,
// 		});
// 		res.status(500).json({
// 			error: "Server Error",
// 			message: "Could not retrieve metrics for container and date range",
// 			requestId: req.id,
// 		});
// 	}
// });

/**
 * Handler for exporting metrics. Used by both GET and POST.
 */
// const exportMetricsHandler = async (c: Context, next: Next) => {
// 	try {
// 		const user = c.get("user");
// 		const body = await c.req.json().catch(() => ({}));
// 		const format = (
// 			c.req.query("format") ||
// 			body.format ||
// 			"json"
// 		).toLowerCase();
//
// 		if (!["json", "csv"].includes(format)) {
// 			return c.json(
// 				{
// 					error: "Invalid format",
// 					message: "Format must be 'json' or 'csv'",
// 					requestId: c.get("requestId"),
// 				},
// 				400,
// 			);
// 		}
//
// 		await metricsCollector.forcePersist();
// 		const allMetrics = metricsCollector.getAccessedFiles();
// 		const timestamp = new Date().toISOString().split("T")[0];
//
// 		if (format === "csv") {
// 			const csvHeader =
// 				"Path,Container/Bucket,Blob/Key,Storage Type,Total Accesses,First Accessed,Last Accessed,Recent Users Count\n";
// 			const csvRows = allMetrics
// 				.map((m) =>
// 					[
// 						m.container,
// 						`"${m.blob}"`,
// 						m.totalAccesses,
// 						m.firstAccessed && typeof m.firstAccessed.toISOString === "function"
// 							? m.firstAccessed.toISOString()
// 							: (m.firstAccessed ?? ""),
// 						m.lastAccessed && typeof m.lastAccessed.toISOString === "function"
// 							? m.lastAccessed.toISOString()
// 							: (m.lastAccessed ?? ""),
// 						m.recentUsersCount,
// 					].join(","),
// 				)
// 				.join("\n");
//
// 			c.header("Content-Type", "text/csv");
// 			c.header(
// 				"Content-Disposition",
// 				`attachment; filename="metrics-${timestamp}.csv"`,
// 			);
// 			return c.text(csvHeader + csvRows);
// 		} else {
// 			// JSON
// 			c.header("Content-Type", "application/json");
// 			return c.json({
// 				exportedAt: new Date().toISOString(),
// 				exportedBy: user?.email ?? "unknown",
// 				metrics: allMetrics,
// 				fieldDescriptions: {
// 					container: "Azure: container, S3: bucket",
// 					blob: "Azure: blob, S3: key",
// 					storageType: "azure or s3 (inferred)",
// 				},
// 			});
// 		}
// 	} catch (error) {
// 		logger.error(
// 			{
// 				error: error instanceof Error ? error.message : String(error),
// 				stack: error instanceof Error ? error.stack : undefined,
// 				requestId: c.get("requestId"),
// 			},
// 			"Error during metrics export",
// 		);
// 		next();
// 	}
// };

/**
 * @openapi
 * /v1/metrics/{container}/export:
 *   get:
 *     tags:
 *       - metrics
 *     summary: Export metrics data
 *     parameters:
 *       - in: path
 *         name: container
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: format
 *         required: false
 *         schema:
 *           type: string
 *           enum: [json, csv]
 *           default: json
 *         description: Export format
 *     responses:
 *       200:
 *         description: Metrics export (JSON or CSV)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 exportedAt:
 *                   type: string
 *                   format: date-time
 *                 exportedBy:
 *                   type: string
 *                 metrics:
 *                   type: array
 *                   items:
 *                     type: object
 *       text/csv:
 *         schema:
 *           type: string
 *         description: CSV export of metrics
 *       400:
 *         description: Invalid format
 *       401:
 *         description: Unauthorized (authentication required)
 *       403:
 *         description: Forbidden (organization access required)
 *       500:
 *         description: Server error during export
 *
 *   post:
 *     tags:
 *       - metrics
 *     summary: Export metrics data (POST)
 *     requestBody:
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               format:
 *                 type: string
 *                 enum: [json, csv]
 *     responses:
 *       200:
 *         description: Metrics export (JSON or CSV)
 *       400:
 *         description: Invalid format
 *       401:
 *         description: Unauthorized (authentication required)
 *       403:
 *         description: Forbidden (organization access required)
 *       500:
 *         description: Server error during export
 */
/**
 * Export metrics data as either JSON or CSV.
 */
// router.get("/:container/export", exportMetricsHandler);
// router.post("/:container/export", exportMetricsHandler);

/**
 * @openapi
 * /v1/metrics:
 *   post:
 *     tags:
 *       - metrics
 *     summary: Perform metrics actions (clear or persist)
 *     description: |
 *       Perform actions on metrics. Use query parameter `action=clear` to clear metrics (not allowed in production), or `action=persist` to persist metrics.
 *     parameters:
 *       - in: query
 *         name: action
 *         required: true
 *         schema:
 *           type: string
 *           enum: [clear, persist]
 *         description: The metrics action to perform
 *     responses:
 *       200:
 *         description: Action performed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 requestId:
 *                   type: string
 *       400:
 *         description: Bad Request - missing or invalid action query parameter
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 message:
 *                   type: string
 *                 requestId:
 *                   type: string
 *       403:
 *         description: Forbidden in production for clear action
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 message:
 *                   type: string
 *                 requestId:
 *                   type: string
 *       500:
 *         description: Server error while performing action
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 message:
 *                   type: string
 *                 requestId:
 *                   type: string
 */
/**
 * Clear or persist metrics based on the action specified in the query parameter.
 * action=clear will clear all metrics (not allowed in production).
 * action=persist will force persist the current metrics to database.
 */
// router.post("/", async (req: CustomRequest, res: Response) => {
// 	const action = req.query.action;
// 	try {
// 		if (action === "clear") {
// 			if (process.env.NODE_ENV === "production") {
// 				res.status(403).json({
// 					error: "Forbidden",
// 					message: "Not allowed in production",
// 					requestId: req.id,
// 				});
// 				return;
// 			}
//
// 			metricsCollector.clearMetrics();
// 			res.json({
// 				success: true,
// 				message: "Metrics cleared",
// 				requestId: req.id,
// 			});
// 			return;
// 		}
//
// 		if (action === "persist") {
// 			await metricsCollector.forcePersist();
// 			res.json({
// 				success: true,
// 				message: "Metrics persisted",
// 				requestId: req.id,
// 			});
// 			return;
// 		}
//
// 		res.status(400).json({
// 			error: "Invalid action",
// 			message: `Unsupported action: ${action}`,
// 			requestId: req.id,
// 		});
// 	} catch (err) {
// 		const message = err instanceof Error ? err.message : String(err);
// 		logger.error(`Failed to perform metrics action: ${action}`, {
// 			requestId: req.id,
// 			error: message,
// 		});
// 		res.status(500).json({
// 			error: "Server Error",
// 			message: `Could not ${action} metrics`,
// 			requestId: req.id,
// 		});
// 	}
// });

/**
 * @openapi
 * /v1/metrics/{container}:
 *   get:
 *     tags:
 *       - metrics
 *     summary: Get metrics summary for a specific container
 *     parameters:
 *       - in: path
 *         name: container
 *         required: true
 *         schema:
 *           type: string
 *         description: Container name
 *     responses:
 *       200:
 *         description: Metrics summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalFiles:
 *                       type: integer
 *                     totalAccesses:
 *                       type: integer
 *                     uniqueUsers:
 *                       type: integer
 *                     uniqueContainers:
 *                       type: integer
 *                     averageAccessesPerFile:
 *                       type: integer
 *                 requestId:
 *                   type: string
 *       401:
 *         description: Unauthorized (authentication required)
 *       403:
 *         description: Forbidden (organization access required)
 *       500:
 *         description: Server error retrieving metrics summary
 */
/**
 * Get metrics summary for a specific container.
 */
// router.get("/:container", (req: CustomRequest, res: Response) => {
// 	try {
// 		const { container } = req.params;
// 		const summary = metricsCollector.getSummaryStats(container);
//
// 		res.json({
// 			success: true,
// 			data: {
// 				...summary,
// 			},
// 			requestId: req.id,
// 		});
// 	} catch (err) {
// 		const message = err instanceof Error ? err.message : String(err);
// 		logger.error("Error retrieving metrics summary", {
// 			requestId: req.id,
// 			error: message,
// 		});
// 		res.status(500).json({
// 			error: "Server Error",
// 			message: "Unable to retrieve metrics summary",
// 			requestId: req.id,
// 		});
// 	}
// });

export default app;
