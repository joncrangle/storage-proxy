import type { Hono } from "hono";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { BASE_URL } from "../config";
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
	app.use(csrf());
	app.use(secureHeaders());
};
