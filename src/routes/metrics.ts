import { type NextFunction, type Response, Router } from "express";
import {
	getCurrentUser,
	requireAuth,
	requireOrgAccess,
} from "@/middleware/auth";
import { logger } from "@/services/logger";
import { metricsCollector } from "@/services/metrics";
import type { CustomRequest } from "@/types";

const router: Router = Router();

router.use(requireAuth, requireOrgAccess);

/**
 * @openapi
 * tags:
 *   - name: metrics
 *     description: Metrics endpoints for tracking file access and usage
 */

/**
 * @openapi
 * /v1/metrics/top-files:
 *   get:
 *     tags:
 *       - metrics
 *     summary: Get top accessed files among containers
 *     parameters:
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 100
 *         description: Max number of top files to return (max 100)
 *     responses:
 *       200:
 *         description: List of top accessed files
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
 *                   description: Array of file access metrics
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
 *                       lastAccessed:
 *                         type: string
 *                       recentUsersCount:
 *                         type: integer
 *                       recentUsers:
 *                         type: array
 *                         items:
 *                           type: string
 *                 limit:
 *                   type: integer
 *                 requestId:
 *                   type: string
 *       401:
 *         description: Unauthorized (authentication required)
 *       403:
 *         description: Forbidden (organization access required)
 *       500:
 *         description: Server error retrieving top files
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
router.get("/top-files", (req: CustomRequest, res: Response) => {
	try {
		const limit = Math.min(
			Number.parseInt(String(req.query.limit), 10) || 10,
			100,
		);
		const data = metricsCollector.getTopAccessedFiles(limit);

		res.json({
			success: true,
			data,
			limit,
			requestId: req.id,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error("Failed to get top accessed files", {
			requestId: req.id,
			error: message,
		});
		res.status(500).json({
			error: "Server Error",
			message: "Could not retrieve top accessed files",
			requestId: req.id,
		});
	}
});

/**
 * @openapi
 * /v1/metrics/containers:
 *   get:
 *     tags:
 *       - metrics
 *     summary: Get aggregated statistics for each container
 *     responses:
 *       200:
 *         description: Container statistics retrieved successfully
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
 *                   description: Aggregated statistics for each container
 *                   items:
 *                     type: object
 *                     properties:
 *                       container:
 *                         type: string
 *                       totalAccesses:
 *                         type: integer
 *                       uniqueFiles:
 *                         type: integer
 *                       uniqueUsers:
 *                         type: integer
 *                 requestId:
 *                   type: string
 *       401:
 *         description: Unauthorized (authentication required)
 *       403:
 *         description: Forbidden (organization access required)
 *       500:
 *         description: Server error retrieving container stats
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
router.get("/containers", (req: CustomRequest, res: Response) => {
	try {
		const data = metricsCollector.getContainerStats();
		res.json({
			success: true,
			data,
			requestId: req.id,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error("Failed to get container stats", {
			requestId: req.id,
			error: message,
		});
		res.status(500).json({
			error: "Server Error",
			message: "Could not retrieve container stats",
			requestId: req.id,
		});
	}
});

/**
 * @openapi
 * /v1/metrics/summary:
 *   get:
 *     tags:
 *       - metrics
 *     summary: Get summary statistics for all containers
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
router.get("/summary", (req: CustomRequest, res: Response) => {
	try {
		const data = metricsCollector.getSummaryStats();
		res.json({
			success: true,
			data,
			requestId: req.id,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error("Failed to get summary stats", {
			requestId: req.id,
			error: message,
		});
		res.status(500).json({
			error: "Server Error",
			message: "Could not retrieve summary stats",
			requestId: req.id,
		});
	}
});

/**
 * @openapi
 * /v1/metrics/range:
 *   get:
 *     tags:
 *       - metrics
 *     summary: Get metrics by date range
 *     parameters:
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
 *         description: Metrics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   description: Retrieved metrics data
 *                 requestId:
 *                   type: string
 *       400:
 *         description: Bad request, missing required parameters
 *       500:
 *         description: Server error retrieving metrics by date range
 */
router.get("/range", (req: CustomRequest, res: Response) => {
	try {
		const { startDate, endDate } = req.query;
		if (!startDate) {
			res.status(400).json({
				error: "Missing required query parameters",
				message: "startDate is required",
				requestId: req.id,
			});
		}

		const start = new Date(String(startDate));
		const end = endDate ? new Date(String(endDate)) : new Date();

		const data = metricsCollector.getMetricsByTimeRange(start, end);

		res.json({
			success: true,
			data,
			range: { startDate, end },
			requestId: req.id,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error("Failed to get metrics by date range", {
			requestId: req.id,
			error: message,
		});
		res.status(500).json({
			error: "Server Error",
			message: "Could not retrieve metrics for date range",
			requestId: req.id,
		});
	}
});

/**
 * @openapi
 * /v1/metrics/{container}/top-files:
 *   get:
 *     tags:
 *       - metrics
 *     summary: Get top accessed files in a container
 *     parameters:
 *       - in: path
 *         name: container
 *         required: true
 *         schema:
 *           type: string
 *         description: Azure blob container name
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 100
 *         description: Max number of top files to return (max 100)
 *     responses:
 *       200:
 *         description: List of top accessed files
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
 *                   description: Array of file access metrics
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
 *                       lastAccessed:
 *                         type: string
 *                       recentUsersCount:
 *                         type: integer
 *                       recentUsers:
 *                         type: array
 *                         items:
 *                           type: string
 *                 limit:
 *                   type: integer
 *                 requestId:
 *                   type: string
 *       401:
 *         description: Unauthorized (authentication required)
 *       403:
 *         description: Forbidden (organization access required)
 *       500:
 *         description: Server error retrieving top files
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
router.get("/:container/top-files", (req: CustomRequest, res: Response) => {
	try {
		const { container } = req.params;
		const limit = Math.min(
			Number.parseInt(String(req.query.limit), 10) || 10,
			100,
		);
		const topFiles = metricsCollector.getTopAccessedFiles(limit, container);

		res.json({
			success: true,
			data: topFiles,
			limit,
			requestId: req.id,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error("Error retrieving top files metrics", {
			requestId: req.id,
			error: message,
		});
		res.status(500).json({
			error: "Server Error",
			message: "Unable to retrieve metrics",
			requestId: req.id,
		});
	}
});

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
router.get("/:container/files", (req: CustomRequest, res: Response) => {
	try {
		const { container } = req.params;
		const containerStats = metricsCollector.getContainerMetrics(container);
		res.json({
			success: true,
			data: containerStats,
			requestId: req.id,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error("Error retrieving container metrics", {
			requestId: req.id,
			error: message,
		});
		res.status(500).json({
			error: "Server Error",
			message: "Unable to retrieve container metrics",
			requestId: req.id,
		});
	}
});

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
router.get("/:container/range", (req: CustomRequest, res: Response) => {
	try {
		const { container } = req.params;
		const { startDate, endDate } = req.query;

		if (!startDate) {
			res.status(400).json({
				error: "Missing required query parameters",
				message: "startDate is required",
				requestId: req.id,
			});
			return;
		}

		const start = new Date(String(startDate));
		const end = endDate ? new Date(String(endDate)) : new Date();

		const data = metricsCollector.getMetricsByTimeRange(start, end, container);

		res.json({
			success: true,
			data,
			range: { startDate, end },
			requestId: req.id,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error("Failed to get metrics for container by date range", {
			container: req.params.container,
			requestId: req.id,
			error: message,
		});
		res.status(500).json({
			error: "Server Error",
			message: "Could not retrieve metrics for container and date range",
			requestId: req.id,
		});
	}
});

/**
 * Handler for exporting metrics. Used by both GET and POST.
 */
const exportMetricsHandler = async (
	req: CustomRequest,
	res: Response,
	next: NextFunction,
) => {
	try {
		const format = (
			req.query.format ||
			req.body?.format ||
			"json"
		).toLowerCase();
		const user = getCurrentUser(req);

		if (!["json", "csv"].includes(format)) {
			res.status(400).json({
				error: "Invalid format",
				message: "Format must be 'json' or 'csv'",
				requestId: req.id,
			});
			return;
		}

		await metricsCollector.forcePersist();

		const allMetrics = metricsCollector.getAllFiles();
		const timestamp = new Date().toISOString().split("T")[0];

		if (format === "csv") {
			const csvHeader =
				"Path,Container/Bucket,Blob/Key,Storage Type,Total Accesses,First Accessed,Last Accessed,Recent Users Count\n";
			const csvRows = allMetrics
				.map((m) =>
					[
						`"${m.path}"`,
						m.container,
						`"${m.blob}"`,
						m.storageType,
						m.totalAccesses,
						m.firstAccessed && typeof m.firstAccessed.toISOString === "function"
							? m.firstAccessed.toISOString()
							: (m.firstAccessed ?? ""),
						m.lastAccessed && typeof m.lastAccessed.toISOString === "function"
							? m.lastAccessed.toISOString()
							: (m.lastAccessed ?? ""),
						m.recentUsersCount,
					].join(","),
				)
				.join("\n");

			res.setHeader("Content-Type", "text/csv");
			res.setHeader(
				"Content-Disposition",
				`attachment; filename="metrics-${timestamp}.csv"`,
			);
			res.send(csvHeader + csvRows);
		} else {
			// JSON
			res.setHeader("Content-Type", "application/json");
			res.json({
				exportedAt: new Date().toISOString(),
				exportedBy: user?.email ?? "unknown",
				metrics: allMetrics,
				fieldDescriptions: {
					container: "Azure: container, S3: bucket",
					blob: "Azure: blob, S3: key",
					storageType: "azure or s3 (inferred)",
				},
			});
		}
		logger.info("Metrics exported successfully", {
			requestId: req.id,
			userId: user?.id,
			format,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error("Error during metrics export", {
			requestId: req.id,
			message: message,
			stack: err instanceof Error ? err.stack : "",
		});
		next(err);
	}
};

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
router.get("/:container/export", exportMetricsHandler);
router.post("/:container/export", exportMetricsHandler);

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
router.post("/", async (req: CustomRequest, res: Response) => {
	const action = req.query.action;
	try {
		if (action === "clear") {
			if (process.env.NODE_ENV === "production") {
				res.status(403).json({
					error: "Forbidden",
					message: "Not allowed in production",
					requestId: req.id,
				});
				return;
			}

			metricsCollector.clearMetrics();
			res.json({
				success: true,
				message: "Metrics cleared",
				requestId: req.id,
			});
			return;
		}

		if (action === "persist") {
			await metricsCollector.forcePersist();
			res.json({
				success: true,
				message: "Metrics persisted",
				requestId: req.id,
			});
			return;
		}

		res.status(400).json({
			error: "Invalid action",
			message: `Unsupported action: ${action}`,
			requestId: req.id,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error(`Failed to perform metrics action: ${action}`, {
			requestId: req.id,
			error: message,
		});
		res.status(500).json({
			error: "Server Error",
			message: `Could not ${action} metrics`,
			requestId: req.id,
		});
	}
});
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
router.get("/:container", (req: CustomRequest, res: Response) => {
	try {
		const { container } = req.params;
		const summary = metricsCollector.getSummaryStats(container);

		res.json({
			success: true,
			data: {
				...summary,
			},
			requestId: req.id,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error("Error retrieving metrics summary", {
			requestId: req.id,
			error: message,
		});
		res.status(500).json({
			error: "Server Error",
			message: "Unable to retrieve metrics summary",
			requestId: req.id,
		});
	}
});

export default router;
