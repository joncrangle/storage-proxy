import { type Response, Router } from "express";
import z from "zod";
import { BASE_URL, config } from "@/config";
import { getCCA } from "@/middleware/auth";
import { sessionUserSchema } from "@/schemas";
import { logger } from "@/services/logger";
import type { CustomRequest } from "@/types";

const router: Router = Router();

/**
 * @openapi
 * tags:
 *   - name: auth
 *     description: Auth endpoints for user authentication and login
 */

/**
 * @openapi
 * /auth/login:
 *   get:
 *     tags:
 *       - auth
 *     summary: Initiate Microsoft login via redirect.
 *     description: Redirects user to Microsoft login page.
 *     responses:
 *       302:
 *         description: Redirect to Microsoft OAuth login page.
 */
router.get("/login", async (req: CustomRequest, res: Response) => {
	const authCodeUrlParameters = {
		scopes: ["openid", "profile", "email"],
		redirectUri: `${BASE_URL}/auth/callback`,
		prompt: "select_account",
	};

	try {
		const cca = getCCA();
		const authUrl = await cca.getAuthCodeUrl(authCodeUrlParameters);
		res.redirect(authUrl);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error("Failed to generate MSAL auth URL", {
			error: message,
			requestId: req.id,
		});
		res.status(500).send("Error initiating authentication flow.");
	}
});

/**
 * @openapi
 * /auth/callback:
 *   get:
 *     tags:
 *       - auth
 *     summary: OAuth2 callback for Microsoft login.
 *     parameters:
 *       - name: code
 *         in: query
 *         required: true
 *         description: Authorization code returned from Microsoft.
 *         schema:
 *           type: string
 *     responses:
 *       302:
 *         description: Redirect to original requested page or home after login.
 *       400:
 *         description: Missing authorization code.
 *       403:
 *         description: Unauthorized organization.
 *       500:
 *         description: Authentication failure.
 */
router.get("/callback", async (req: CustomRequest, res: Response) => {
	if (!req.query.code) {
		logger.warn("MSAL callback received without an authorization code.", {
			query: req.query,
			requestId: req.id,
		});
		res
			.status(400)
			.send("Authentication failed: No authorization code provided.");
		return;
	}

	const code = Array.isArray(req.query.code)
		? req.query.code[0]
		: req.query.code;

	if (typeof code !== "string") {
		res.status(400).send("Invalid code in query.");
		return;
	}

	const tokenRequest = {
		code,
		scopes: ["openid", "profile", "email"],
		redirectUri: `${BASE_URL}/auth/callback`,
	};

	try {
		const cca = getCCA();
		const response = await cca.acquireTokenByCode(tokenRequest);
		const account = response.account;

		if (!account?.homeAccountId || !account.username || !account.tenantId) {
			res.status(500).send("Missing required user information from MSAL.");
			return;
		}

		const userPayload = {
			id: account.homeAccountId ?? "",
			email: account.username ?? "",
			name: account.name ?? "",
			tenantId: account.tenantId ?? "",
			username: account.username ?? "",
		};

		const validatedUser = sessionUserSchema.parse(userPayload);

		// Enforce organization restriction during login
		if (
			config.ALLOWED_ORGANIZATION_ID &&
			userPayload.tenantId !== config.ALLOWED_ORGANIZATION_ID
		) {
			logger.warn("Login attempt from unauthorized organization", {
				tenantId: userPayload.tenantId,
				username: userPayload.username,
				requestId: req.id,
			});
			res
				.status(403)
				.send(
					"Access denied. Your organization is not permitted to use this application.",
				);
			return;
		}

		req.session.user = validatedUser;

		logger.info("User authenticated via session successfully", {
			userId: account.homeAccountId,
			email: account.username,
			requestId: req.id,
		});

		// Redirect user back to their original destination or the homepage
		const redirectTo = req.session.returnTo || "/";
		delete req.session.returnTo;
		res.redirect(redirectTo);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error("MSAL token acquisition or user validation failed", {
			error: message,
			details: err instanceof z.ZodError ? err.issues : undefined,
			requestId: req.id,
		});
		res.status(500).send("Authentication failed. Please try again.");
	}
});

/**
 * @openapi
 * /auth/logout:
 *   get:
 *     tags:
 *       - auth
 *     summary: Logout and redirect to Microsoft logout.
 *     responses:
 *       302:
 *         description: Redirect to Microsoft logout endpoint.
 */
router.get("/logout", (req: CustomRequest, res: Response) => {
	const logoutUrl = `https://login.microsoftonline.com/${config.AZURE_TENANT_ID}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(BASE_URL)}`;

	req.session.destroy((err) => {
		if (err) {
			logger.error("Session destruction error", {
				requestId: req.id,
				error: err.message,
			});
		}
		res.clearCookie("blob-proxy-session");
		res.redirect(logoutUrl);
	});
});

export default router;
