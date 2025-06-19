import { randomBytes } from "node:crypto";
import type { NextFunction, Response } from "express";
import { logger } from "@/services/logger";
import type { CustomRequest } from "@/types";

/**
 * Assigns a unique request ID.
 */
export function requestId(
	req: CustomRequest,
	res: Response,
	next: NextFunction,
) {
	req.id = randomBytes(16).toString("hex");
	res.setHeader("X-Request-ID", req.id);
	next();
}

/**
 * Logs details of each request.
 */
export function requestLogger(
	req: CustomRequest,
	res: Response,
	next: NextFunction,
) {
	const start = Date.now();
	res.on("finish", () => {
		const duration = Date.now() - start;
		logger.info("Request completed", {
			requestId: req.id,
			method: req.method,
			url: req.originalUrl,
			statusCode: res.statusCode,
			duration,
			ip: req.ip,
			userId: req.session?.user?.id ?? req.jwtUser?.id,
		});
	});
	next();
}

/**
 * Global error handler.
 */
export function globalErrorHandler(
	err: Error,
	req: CustomRequest,
	res: Response,
	next: NextFunction,
) {
	logger.error("Unhandled error", {
		requestId: req.id,
		error: err.message,
		stack: err.stack,
		url: req.originalUrl,
	});

	if (res.headersSent) {
		return next(err);
	}

	res.status(500).json({
		error: "Server Error",
		message: "An internal server error occurred.",
		requestId: req.id,
	});
}
