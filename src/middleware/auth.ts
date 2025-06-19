import { ConfidentialClientApplication, LogLevel } from "@azure/msal-node";
import type { NextFunction, Response } from "express";
import jwt, {
	type JwtHeader,
	type JwtPayload,
	type SigningKeyCallback,
} from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import { z } from "zod";
import { BASE_URL, config } from "@/config";
import { jwtUserSchema } from "@/schemas";
import { logger } from "@/services/logger";
import type { CustomRequest, JwtUser, SessionUser } from "@/types";

const msalConfig = {
	auth: {
		clientId: config.AZURE_CLIENT_ID,
		clientSecret: config.AZURE_CLIENT_SECRET,
		authority: `https://login.microsoftonline.com/${config.AZURE_TENANT_ID}`,
	},
	system: {
		loggerOptions: {
			loggerCallback: (level: LogLevel, message: string) => {
				const levelMap = {
					[LogLevel.Error]: "error",
					[LogLevel.Warning]: "warn",
					[LogLevel.Info]: "info",
					[LogLevel.Verbose]: "debug",
					[LogLevel.Trace]: "debug",
				};
				logger.log(levelMap[level] ?? "info", `[MSAL] ${message}`);
			},
			piiLoggingEnabled: false,
			logLevel: LogLevel.Info,
		},
	},
};

let _cca: ConfidentialClientApplication;

/**
 * Lazily initializes and returns the ConfidentialClientApplication.
 */
export function getCCA() {
	if (!_cca) {
		_cca = new ConfidentialClientApplication(msalConfig);
	}
	return _cca;
}

const jwksUri = `https://login.microsoftonline.com/${config.AZURE_TENANT_ID}/discovery/v2.0/keys`;
const jwksClientInstance = jwksClient({
	jwksUri,
	requestHeaders: {},
	timeout: 30000,
	cache: true,
	rateLimit: true,
	jwksRequestsPerMinute: 10,
	cacheMaxAge: 24 * 60 * 60 * 1000, // 24 hours
});

/**
 * Retrieves the signing key from the JWKS endpoint.
 * This is used by the jwt.verify function.
 */
function getSigningKey(header: JwtHeader, callback: SigningKeyCallback) {
	jwksClientInstance.getSigningKey(header.kid, (err, key) => {
		if (err || !key) {
			logger.error("Failed to get JWT signing key", {
				error: err ? err.message : "Key not found",
				kid: header.kid,
			});
			return callback(err || new Error("Key not found"));
		}
		const signingKey = key.getPublicKey();
		callback(null, signingKey);
	});
}

/**
 * Validates a JWT token against the Microsoft Identity Platform.
 */
function validateJwtToken(token: string): JwtPayload {
	return new Promise((resolve, reject) => {
		jwt.verify(
			token,
			getSigningKey,
			{
				audience: config.JWT_AUDIENCE ?? config.AZURE_CLIENT_ID,
				issuer:
					config.JWT_ISSUER ??
					`https://login.microsoftonline.com/${config.AZURE_TENANT_ID}/v2.0`,
				algorithms: ["RS256"],
				clockTolerance: 60, // 60 seconds
			},
			(err, decoded) => {
				if (err) {
					logger.warn("JWT validation failed", { error: err.message });
					return reject(err);
				}
				if (typeof decoded !== "object" || decoded === null) {
					throw new Error("Invalid JWT payload");
				}

				// Optional: Validate that the token is from an allowed application
				if (config.JWT_ALLOWED_APPS) {
					const allowedApps = config.JWT_ALLOWED_APPS.split(",").map((app) =>
						app.trim(),
					);
					const tokenAppId = decoded.appid ?? decoded.azp;
					if (!allowedApps.includes(tokenAppId)) {
						const error = new Error("Application not authorized");
						logger.warn("Unauthorized application in JWT", {
							appId: tokenAppId,
						});
						return reject(error);
					}
				}

				// Optional: Validate that the token is from the allowed organization/tenant
				if (
					config.ALLOWED_ORGANIZATION_ID &&
					decoded.tid !== config.ALLOWED_ORGANIZATION_ID
				) {
					const error = new Error("Organization not authorized");
					logger.warn("Unauthorized organization in JWT", {
						tenantId: decoded.tid,
					});
					return reject(error);
				}

				resolve(decoded);
			},
		);
	});
}

/**
 * Middleware to process a JWT if present.
 * It does not block the request if the token is invalid or missing;
 * it simply populates `req.jwtUser` if authentication is successful.
 */
async function processJwt(
	req: CustomRequest,
	_res: Response,
	next: NextFunction,
) {
	const authHeader = req.headers.authorization;
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return next(); // No JWT present, move on
	}

	const token = authHeader.substring(7); // Remove 'Bearer '

	try {
		const decoded = validateJwtToken(token);

		// Handle both user tokens and app-only (service principal) tokens
		const isServicePrincipal = decoded.idtyp === "app" || !decoded.upn;

		const userPayload: JwtUser = {
			id: decoded.oid ?? decoded.sub ?? "",
			email:
				decoded.email ??
				decoded.upn ??
				`${decoded.appid}@serviceprincipal` ??
				"",
			name:
				decoded.name ??
				decoded.app_displayname ??
				`Service Principal: ${decoded.appid}` ??
				"",
			tenantId: decoded.tid ?? "",
			appId: decoded.appid ?? decoded.azp,
			roles: decoded.roles ?? [],
			scopes: decoded.scp ? decoded.scp.split(" ") : [],
			isServicePrincipal,
			appDisplayName: decoded.app_displayname,
		};

		req.jwtUser = jwtUserSchema.parse(userPayload);
	} catch (error) {
		logger.warn("JWT processing or validation failed", {
			error: error instanceof Error ? error.message : String(error),
			details: error instanceof z.ZodError ? error.issues : undefined,
			requestId: req.id,
		});
	}

	next();
}

/**
 * Middleware to require authentication.
 * It checks for a valid JWT user or a valid session user.
 * If neither is present, it returns a 401 Unauthorized error or redirects to login.
 */
export function requireAuth(
	req: CustomRequest,
	res: Response,
	next: NextFunction,
) {
	processJwt(req, res, (err: unknown) => {
		if (err) return next(err);

		if (req.jwtUser || req.session.user) {
			return next();
		}

		logger.warn("Authentication required but not provided", {
			url: req.originalUrl,
			ip: req.ip,
			requestId: req.id,
		});

		if (req.headers.accept?.includes("text/html")) {
			req.session.returnTo = req.originalUrl;
			return res.redirect(`/auth/login`);
		}

		res.status(401).json({
			error: "Authentication Required",
			message:
				"A valid session or JWT Bearer token is required to access this resource.",
			loginUrl: `${BASE_URL}/auth/login`,
			requestId: req.id,
		});
	});
}

/**
 * Returns the current authenticated user from either JWT or session.
 */
export function getCurrentUser(
	req: CustomRequest,
): SessionUser | JwtUser | null {
	return req.jwtUser ?? req.session.user ?? null;
}

/**
 * Middleware to ensure the user belongs to the allowed organization.
 * Must be used after `requireAuth`.
 */
export function requireOrgAccess(
	req: CustomRequest,
	res: Response,
	next: NextFunction,
) {
	if (!config.ALLOWED_ORGANIZATION_ID) {
		return next(); // If no organization is specified, allow access.
	}

	const user = getCurrentUser(req);
	if (!user) {
		// This should theoretically not be hit if `requireAuth` is used first.
		res
			.status(401)
			.json({ error: "Authentication required", requestId: req.id });
		return;
	}

	if (user.tenantId !== config.ALLOWED_ORGANIZATION_ID) {
		logger.warn("Unauthorized organization access attempt", {
			userId: user.id,
			userTenant: user.tenantId,
			allowedTenant: config.ALLOWED_ORGANIZATION_ID,
			requestId: req.id,
		});
		res.status(403).json({
			error: "Forbidden",
			message: "Your organization is not permitted to access this resource.",
			requestId: req.id,
		});
		return;
	}

	next();
}
