import type { Context, Next } from "hono";
import { logger as honoLogger } from "hono/logger";
import { logger } from "../services/logger";

/**
 * Hono logger middleware
 */
export const pinoHonoLogger = () => {
	return honoLogger((message: string, ...rest: string[]) => {
		const [method, path, status, time] = rest;
		logger.info({
			http: {
				method,
				path,
				status: parseInt(status) || 0,
				responseTime: parseFloat(time?.replace("ms", "")) || 0,
			},
			msg: message,
		});
	});
};

/**
 * Structured request completion logger
 */
export const requestCompletionLogger = async (c: Context, next: Next) => {
	const start = Date.now();
	await next();
	const duration = Date.now() - start;
	const requestId = c.get("requestId");
	const user = c.get("user");

	logger.info(
		{
			requestId: typeof requestId === "string" ? requestId : undefined,
			method: c.req.method,
			url: c.req.url,
			statusCode: c.res.status,
			duration,
			ip: c.req.header("x-forwarded-for") ?? c.req.header("cf-connecting-ip"),
			user: user?.email,
		},
		"Request completed",
	);
};
