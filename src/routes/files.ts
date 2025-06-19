import path from "node:path";
import { Readable } from "node:stream";
import { type NextFunction, type Response, Router } from "express";
import { MAX_FILE_SIZE } from "@/config";
import {
	getCurrentUser,
	requireAuth,
	requireOrgAccess,
} from "@/middleware/auth";
import { validateRequest } from "@/middleware/validate";
import { fileContentSchema, fileRouteSchema, mimeTypeMap } from "@/schemas";
import { logger } from "@/services/logger";
import { metricsCollector } from "@/services/metrics";
import {
	downloadBlob,
	getBlobProperties,
	listContainersAndBlobs,
} from "@/services/storage";
import type { CustomRequest } from "@/types";

const router = Router();

const validateFileRequest = validateRequest({ params: fileRouteSchema });
router.use(requireAuth, requireOrgAccess);

/**
 * @openapi
 * tags:
 *   - name: blobs
 *     description: Blob management endpoints for handling file downloads and uploads
 */

/**
 * @openapi
 * /v1/files/download/{container}/{blob}:
 *   get:
 *     tags:
 *       - blobs
 *     summary: Download a blob/file
 *     description: >
 *       Forces a download of the specified file from the container.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: container
 *         in: path
 *         required: true
 *         description: The name of the Azure Blob Storage container.
 *         schema:
 *           type: string
 *       - name: blob
 *         in: path
 *         required: true
 *         description: The blob/file path inside the container (may include slashes).
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: File downloaded successfully.
 *         headers:
 *           Content-Type:
 *             schema:
 *               type: string
 *             description: Content-Type (application/octet-stream)
 *           Content-Length:
 *             schema:
 *               type: integer
 *             description: Size of the file in bytes
 *           Content-Disposition:
 *             schema:
 *               type: string
 *             description: Content disposition header forcing download
 *           Cache-Control:
 *             schema:
 *               type: string
 *             description: Cache control header
 *           ETag:
 *             schema:
 *               type: string
 *             description: Entity tag for caching
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: File not found in the specified container.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 requestId:
 *                   type: string
 *       401:
 *         description: Unauthorized (authentication required)
 *       403:
 *         description: Forbidden (organization access required)
 */
router.get(
	"/download/:container/{*blob}",
	validateFileRequest,
	async (req: CustomRequest, res: Response, next: NextFunction) => {
		const { container, blob: filename } = req.params;
		const user = getCurrentUser(req);

		try {
			const properties = await getBlobProperties(container, filename);

			if (!properties.exists) {
				res.status(404).json({ error: "File Not Found", requestId: req.id });
				return;
			}

			res.set({
				"Content-Type": "application/octet-stream", // Force download
				"Content-Length": properties.contentLength,
				"Content-Disposition": `attachment; filename="${path.basename(filename)}"`,
				"Cache-Control": "private, max-age=3600",
				ETag: properties.etag,
			});

			const downloadStream = await downloadBlob(container, filename);
			let stream: Readable | undefined;

			if ("readableStreamBody" in downloadStream) {
				const body = downloadStream.readableStreamBody;
				if (body instanceof Readable) {
					stream = body;
				} else if (body && typeof body === "object" && "pipe" in body) {
					stream = body as Readable;
				}
			}

			if (stream && stream instanceof Readable) {
				stream.on("error", (err: Error) => {
					logger.error("Blob stream error:", err);
					if (!res.headersSent) {
						res.status(500).send("Blob stream error");
					} else if (!res.writableEnded) {
						res.destroy();
					}
				});

				res.on("close", () => {
					if (stream && typeof stream.destroy === "function") {
						stream.destroy();
					}
				});

				res.on("error", (err) => {
					console.error("Response stream error:", err);
				});

				stream.pipe(res);
			} else {
				throw new Error("No readable stream available");
			}

			metricsCollector.recordAccess(container, filename, user?.id ?? "unknown");
			logger.info("File downloaded", {
				container,
				filename,
				userId: user?.id,
				requestId: req.id,
			});
		} catch (error) {
			next(error);
		}
	},
);

/**
 * @openapi
 * /v1/files/{container}/{blob}:
 *   get:
 *     tags:
 *       - blobs
 *     summary: View a blob/file inline
 *     description: >
 *       Retrieves a file from the specified container and streams it inline if supported.
 *       Validates file existence, content type, and size before streaming.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: container
 *         in: path
 *         required: true
 *         description: The name of the Azure Blob Storage container.
 *         schema:
 *           type: string
 *       - name: blob
 *         in: path
 *         required: true
 *         description: The blob/file path inside the container (may include slashes).
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: File streamed inline.
 *         headers:
 *           Content-Type:
 *             schema:
 *               type: string
 *             description: Content-Type of the file
 *           Content-Length:
 *             schema:
 *               type: integer
 *             description: Size of the file in bytes
 *           Content-Disposition:
 *             schema:
 *               type: string
 *             description: Content disposition header with filename
 *           Cache-Control:
 *             schema:
 *               type: string
 *             description: Cache control header
 *           ETag:
 *             schema:
 *               type: string
 *             description: Entity tag for caching
 *           Last-Modified:
 *             schema:
 *               type: string
 *               format: date-time
 *             description: Last modified date of the file
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       304:
 *         description: Not Modified (client cache is up to date)
 *       404:
 *         description: File not found in the specified container.
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
 *       413:
 *         description: File too large to display inline; use download instead.
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
 *       415:
 *         description: Unsupported Media Type (content type mismatch).
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
 *       401:
 *         description: Unauthorized (authentication required)
 *       403:
 *         description: Forbidden (organization access required)
 */
router.get(
	"/:container/{*blob}",
	validateFileRequest,
	async (req: CustomRequest, res: Response, next: NextFunction) => {
		const { container, blob: filename } = req.params;
		const user = getCurrentUser(req);

		try {
			const properties = await getBlobProperties(container, filename);

			if (!properties.exists) {
				logger.warn("File not found access attempt", {
					container,
					filename,
					userId: user?.id,
					requestId: req.id,
				});
				res.status(404).json({
					error: "File Not Found",
					message: `The file '${filename}' was not found in container '${container}'.`,
					requestId: req.id,
				});
				return;
			}

			const fileExtension = path.extname(filename).toLowerCase();
			const correctMimeType =
				mimeTypeMap[fileExtension]?.[0] || "application/octet-stream";

			// TEST: since the mime type will be octet-stream, set headers to preview in browser
			// Validate content type against file extension
			const validationResult = fileContentSchema.safeParse({
				filename,
				contentType: properties.contentType,
			});
			if (!validationResult.success) {
				logger.warn("Mismatched content type", {
					filename,
					contentType: properties.contentType,
					error: validationResult.error.issues[0].message,
					userId: user?.id,
				});
				res.status(415).json({
					error: "Unsupported Media Type",
					message: "File content type does not match its extension.",
					requestId: req.id,
				});
				return;
			}

			if (
				properties.contentLength &&
				properties.contentLength > MAX_FILE_SIZE
			) {
				// TODO: forward to download link instead of json return
				res.status(413).json({
					error: "File Too Large",
					message:
						"This file is too large to view directly. Please use the download link.",
					requestId: req.id,
				});
				return;
			}

			if (req.headers["if-none-match"] === properties.etag) {
				res.status(304).end();
				return;
			}

			res.set({
				"Content-Type": correctMimeType,
				"Content-Length": properties.contentLength,
				"Content-Disposition": `inline; filename="${path.basename(filename)}"`,
				"Cache-Control": "private, max-age=3600",
				ETag: properties.etag,
				"Last-Modified": properties.lastModified?.toUTCString(),
			});

			const downloadStream = await downloadBlob(container, filename);
			let stream: Readable | undefined;

			if ("readableStreamBody" in downloadStream) {
				const body = downloadStream.readableStreamBody;
				if (body instanceof Readable) {
					stream = body;
				} else if (body && typeof body === "object" && "pipe" in body) {
					stream = body as Readable;
				}
			}
			if (stream && stream instanceof Readable) {
				stream.on("error", (err: Error) => {
					logger.error("Blob stream error:", err);
					if (!res.headersSent) {
						res.status(500).send("Blob stream error");
					} else if (!res.writableEnded) {
						res.destroy();
					}
				});

				res.on("close", () => {
					stream.destroy();
				});

				res.on("error", (err) => {
					logger.error("Response stream error:", err);
				});

				stream.pipe(res);
			} else {
				throw new Error("No readable stream available");
			}

			metricsCollector.recordAccess(container, filename, user?.id ?? "unknown");
			logger.info("File accessed", {
				container,
				filename,
				userId: user?.id,
				requestId: req.id,
			});
		} catch (error) {
			next(error);
		}
	},
);

/**
 * @openapi
 * /v1/files/list:
 *   get:
 *     tags:
 *       - blobs
 *     summary: List containers and their blobs
 *     description: Retrieves all containers and their contained blobs from the configured storage provider (Azure Blob Storage or AWS S3).
 *     responses:
 *       200:
 *         description: Successfully retrieved containers and blobs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 containers:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       blobs:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             name:
 *                               type: string
 *                             properties:
 *                               type: object
 *                 requestId:
 *                   type: string
 *       401:
 *         description: Unauthorized (authentication required)
 *       403:
 *         description: Forbidden (organization access required)
 *       500:
 *         description: Server error retrieving containers and blobs
 */
router.get("/list", async (req: CustomRequest, res: Response) => {
	try {
		const containers = await listContainersAndBlobs();
		res.json({
			success: true,
			containers,
			requestId: req.id,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error("Failed to list files", {
			requestId: req.id,
			error: message,
		});
		res.status(500).json({
			error: "Server Error",
			message: "Could not retrieve files list",
			requestId: req.id,
		});
	}
});

export default router;
