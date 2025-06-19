import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { auth } from "../services/auth";
import { logger } from "../services/logger";

/**
 * Authentication middleware
 */
export const requireAuth = async (c: Context, next: Next) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	const requestId = c.get("requestId");

	if (session) {
		c.set("user", session.user);
		c.set("session", session.session);
		return next();
	}

	c.set("user", null);
	c.set("session", null);

	if (c.req.method === "GET") {
		try {
			const callbackURL = `${encodeURIComponent(c.req.url)}`;
			const { url: oauthUrl } = await auth.api.signInSocial({
				body: {
					provider: "microsoft",
					callbackURL: callbackURL,
				},
				request: c.req.raw,
			});

			if (!oauthUrl) {
				logger.error({
					requestId,
					path: c.req.url,
					method: c.req.method,
					error: "Failed to generate Microsoft OAuth URL",
				});
				throw new HTTPException(500, {
					message: "Failed to generate Microsoft OAuth URL.",
				});
			}

			return c.redirect(oauthUrl);
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : String(err);
			const errorStack = err instanceof Error ? err.stack : undefined;

			logger.error(
				{
					requestId,
					path: c.req.url,
					method: c.req.method,
					error: errorMessage,
					stack: errorStack,
				},
				"OAuth URL generation failed",
			);

			throw new HTTPException(500, {
				message: "Authentication service unavailable.",
			});
		}
	}

	throw new HTTPException(401, { message: "Authentication required." });
};
