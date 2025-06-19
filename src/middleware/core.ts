import type { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import * as z from "zod";
import { BASE_URL } from "../config";
import { logger } from "../services/logger";
import { pinoHonoLogger, requestCompletionLogger } from "./logger";

/**
 * Setup all core middleware for the app
 */
export const setupCoreMiddleware = async (app: Hono) => {
	app.use(requestId());
	app.use(pinoHonoLogger());
	app.use(requestCompletionLogger);
	app.use(
		"*",
		cors({
			origin: BASE_URL,
			allowHeaders: ["Content-Type", "Authorization"],
			allowMethods: ["POST", "GET", "OPTIONS"],
			exposeHeaders: ["Content-Length"],
			maxAge: 600,
			credentials: true,
		}),
	);
	app.use(secureHeaders());

	/**
	 * Global error handlers
	 */
	app.onError((err, c) => {
		const requestId = c.get("requestId");
		const user = c.get("user");
		const userId = user?.id;

		logger.error(
			{
				requestId,
				userId,
				error: err.message,
				stack: err.stack,
				path: c.req.url,
				method: c.req.method,
			},
			"Unhandled error",
		);

		if (err instanceof z.ZodError) {
			return c.json(
				{
					error: "Validation failed",
					message: err.issues.map((issue) => issue.message).join(", "),
					requestId: c.get("requestId"),
				},
				400,
			);
		}

		if (err instanceof HTTPException && err.status === 401) {
			return c.json(
				{
					error: "Unauthorized",
					message: err.message ?? "Authentication required.",
					requestId,
				},
				401,
			);
		}

		if (err instanceof HTTPException && err.status === 403) {
			return c.json(
				{
					error: "Forbidden",
					message: err.message ?? "Access denied.",
					requestId,
				},
				403,
			);
		}

		return c.json(
			{
				error: "Internal Server Error",
				message: err.message ?? "Something went wrong.",
				requestId,
			},
			500,
		);
	});

	app.notFound((c) => {
		console.log("Route not found:", c.req.path, c.req.method);
		const path = c.req.path;
		const method = c.req.method;
		const requestId = c.get("requestId");
		const user = c.get("user");

		logger.warn(
			{
				path,
				method,
				requestId: typeof requestId === "string" ? requestId : undefined,
				userId: user?.id || undefined,
			},
			"Route not found",
		);

		return c.json(
			{
				error: "Not Found",
				message: "The requested resource was not found.",
				requestId,
			},
			404,
		);
	});
};
