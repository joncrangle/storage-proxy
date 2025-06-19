import path from "node:path";
import { Readable } from "node:stream";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import * as z from "zod";
import { MAX_FILE_SIZE } from "../config";
import { requireAuth } from "../middleware/auth";
import { logger } from "../services/logger";
import { metricsCollector } from "../services/metrics";
import {
	downloadBlob,
	getBlobProperties,
	listContainersAndBlobs,
} from "../services/storage";
import { fileContentSchema, mimeTypeMap } from "../services/storage.schemas";
import { fileListAPI, fileRequestSchema, filesAPI } from "./files.schemas";

const app = new Hono();

// Require auth for all file routes
app.use("*", requireAuth);

/**
 * Download a specified file from a container
 */
app.get(
	"/download/:container/:filename{.+\\.*}",
	describeRoute(filesAPI),
	zValidator("param", fileRequestSchema),
	async (c) => {
		const { container, filename } = c.req.valid("param");
		const user = c.get("user");

		try {
			const properties = await getBlobProperties(container, filename);

			if (properties instanceof Error || !properties.exists) {
				return c.json(
					{
						error: "File Not Found",
						message: `The file '${filename}' was not found in container '${container}'.`,
						requestId: c.get("requestId"),
					},
					404,
				);
			}

			c.header("Content-Type", "application/octet-stream");
			if (properties.contentLength) {
				c.header("Content-Length", properties.contentLength.toString());
			}
			c.header(
				"Content-Disposition",
				`attachment; filename="${path.basename(filename)}"`,
			);
			c.header("Cache-Control", "private, max-age=3600");
			c.header("ETag", properties.etag);

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
					logger.error(
						{
							error: err.message,
							stack: err.stack,
							container,
							filename,
							requestId: c.req.header("x-request-id"),
						},
						"Blob stream error:",
					);
					if (!c.finalized) {
						return c.text("Blob stream error", 500);
					}
				});

				c.req.raw.signal?.addEventListener("abort", () => {
					if (stream && typeof stream.destroy === "function") {
						stream.destroy();
					}
				});

				metricsCollector.recordAccess(
					container,
					filename,
					user?.id ?? "unknown",
				);
				logger.info(
					{
						container,
						filename,
						userId: user?.id,
						requestId: c.req.header("x-request-id"),
					},
					"File downloaded",
				);

				// biome-ignore lint/suspicious/noExplicitAny: let bun handle the stream type
				return new Response(stream as any, {
					status: 200,
					headers: {
						"Content-Type": "application/octet-stream",
						"Content-Disposition": `attachment; filename="${path.basename(filename)}"`,
						"Cache-Control": "private, max-age=3600",
						...(properties.contentLength && {
							"Content-Length": properties.contentLength.toString(),
						}),
						...(properties.etag && { ETag: properties.etag }),
					},
				});
			} else {
				throw new Error("No readable stream available");
			}
		} catch (error) {
			if (error instanceof z.ZodError) {
				return c.json(
					{
						error: "Validation failed",
						message: error.issues,
						requestId: c.get("requestId"),
					},
					400,
				);
			}
			logger.error(
				{
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					container,
					filename,
					requestId: c.req.header("x-request-id"),
				},
				"Download error:",
			);
			return c.json(
				{
					error: "Internal server error",
					message:
						"An unexpected error occurred while processing your request.",
					requestId: c.get("requestId"),
				},
				500,
			);
		}
	},
);

/**
 * View a specified file from a container
 */
app.get(
	"/:container/:filename{.+\\.*}",
	describeRoute(filesAPI),
	zValidator("param", fileRequestSchema),
	async (c) => {
		const { container, filename } = c.req.valid("param");
		const user = c.get("user");

		try {
			const properties = await getBlobProperties(container, filename);

			if (properties instanceof Error || !properties.exists) {
				logger.warn(
					{
						container,
						filename,
						userId: user?.id,
						requestId: c.get("requestId"),
					},
					"File not found access attempt",
				);
				return c.json(
					{
						error: "File Not Found",
						message: `The file '${filename}' was not found in container '${container}'.`,
						requestId: c.get("requestId"),
					},
					404,
				);
			}

			const fileExtension = path.extname(filename).toLowerCase();
			const correctMimeType =
				mimeTypeMap[fileExtension]?.[0] || "application/octet-stream";

			const validationResult = fileContentSchema.safeParse({
				filename,
				contentType: properties.contentType,
			});
			if (!validationResult.success) {
				logger.warn(
					{
						filename,
						contentType: properties.contentType,
						error: validationResult.error.issues[0].message,
						userId: user?.id,
					},
					"Mismatched content type",
				);
				return c.json(
					{
						error: "Unsupported Media Type",
						message: "File content type does not match its extension.",
						requestId: c.get("requestId"),
					},
					415,
				);
			}

			if (
				properties.contentLength &&
				properties.contentLength > MAX_FILE_SIZE
			) {
				return c.redirect(`/v1/files/download/${container}/${filename}`);
			}

			const headers = Object.fromEntries(
				Object.entries({
					"Content-Type": correctMimeType,
					"Content-Length": properties.contentLength?.toString(),
					"Content-Disposition": `inline; filename="${path.basename(filename)}"`,
					"Cache-Control": "private, max-age=3600",
					ETag: properties.etag,
					"Last-Modified": properties.lastModified?.toUTCString(),
				}).filter(([_, v]) => typeof v === "string" && v.length > 0),
			) as Record<string, string>;

			for (const [key, value] of Object.entries(headers)) {
				c.header(key, value);
			}

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
					logger.error(
						{
							error: err.message,
							stack: err.stack,
							container,
							filename,
							requestId: c.get("requestId"),
						},
						"Blob stream error:",
					);
					if (!c.finalized) {
						c.status(500);
						return c.body("Blob stream error");
					}
				});
				c.req.raw.signal?.addEventListener("abort", () => {
					if (typeof stream?.destroy === "function") {
						stream.destroy();
					}
				});

				metricsCollector.recordAccess(
					container,
					filename,
					user?.id ?? "unknown",
				);

				logger.info(
					{
						container,
						filename,
						userId: user?.id,
						requestId: c.get("requestId"),
					},
					"File accessed",
				);

				// biome-ignore lint/suspicious/noExplicitAny: let bun handle the stream type
				return new Response(stream as any, {
					status: 200,
					headers,
				});
			} else {
				throw new Error("No readable stream available");
			}
		} catch (error) {
			if (error instanceof z.ZodError) {
				return c.json(
					{
						error: "Validation failed",
						message: error.issues,
						requestId: c.get("requestId"),
					},
					400,
				);
			}
			logger.error(
				{
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					container,
					filename,
					requestId: c.req.header("x-request-id"),
				},
				"Unhandled file access error",
			);
			return c.json({ error: "Internal server error" }, 500);
		}
	},
);

/**
 * List containers and files
 */
app.get("/list", describeRoute(fileListAPI), async (c) => {
	try {
		const containers = await listContainersAndBlobs();
		return c.json({
			success: true,
			containers,
			requestId: c.get("requestId"),
		});
	} catch (error) {
		logger.error(
			{
				requestId: c.get("requestId"),
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			},
			"Failed to list files",
		);
		return c.json(
			{
				error: "Internal Server Error",
				message: "Could not retrieve files list",
				requestId: c.get("requestId"),
			},
			500,
		);
	}
});

export default app;
