import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute, openAPISpecs } from "hono-openapi";
import { ENTRA, LOG_LEVEL, NODE_ENV, STORAGE_PROVIDER } from "../config";
import fileRoutes from "../routes/files";
import metricsRoutes from "../routes/metrics";
import { logger } from "../services/logger";
import { listContainersAndBlobs } from "../services/storage";
import type { ContainerInfo } from "../services/storage.schemas";
import { healthAPI, homeAPI } from "./index.schemas";

const app = new Hono();

app.get("/favicon.ico", (c) => c.body(null, 204));

// Mount file and metrics routes
app.route("/v1/files", fileRoutes);
app.route("/v1/metrics", metricsRoutes);

/**
 * Base route
 */
app.get("/", describeRoute(homeAPI), async (c) => {
	const user = c.get("user");
	return c.json({
		name: "Azure Blob Storage Proxy",
		version: process.env.npm_package_version ?? "unknown",
		status: "running",
		environment: NODE_ENV,
		logging: LOG_LEVEL,
		authenticated: !!user,
		user: user ? { email: user.email, name: user.name } : null,
		requestId: c.get("requestId"),
	});
});

/**
 * Health route
 */
app.get("/health", describeRoute(healthAPI), async (c) => {
	const healthcheck = {
		status: "healthy",
		timestamp: new Date().toISOString(),
		uptime: process.uptime(),
		requestId: c.get("requestId"),
		environment: NODE_ENV,
		storage: {
			provider: STORAGE_PROVIDER,
			status: "unknown",
			containers: [] as ContainerInfo[],
			error: "",
		},
	};
	try {
		let anyContainerError = false;

		const containers = await listContainersAndBlobs();

		for (const container of containers) {
			if (container.error) {
				anyContainerError = true;
				healthcheck.storage.containers.push({
					name: container.name,
					status: "error",
					error: container.error,
				});
			} else {
				healthcheck.storage.containers.push({
					name: container.name,
					status: "connected",
				});
			}
		}

		healthcheck.storage.status = anyContainerError ? "degraded" : "connected";
		if (anyContainerError) {
			healthcheck.status = "degraded";
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error(
			{
				error: message,
			},
			"Health check failed to connect to storage provider",
		);
		healthcheck.status = "degraded";
		healthcheck.storage.status = "error";
		healthcheck.storage.error = message;
	}

	c.status(healthcheck.status === "healthy" ? 200 : 503);
	return c.json(healthcheck);
});

/**
 * Serve generated openapi spec
 */
app.get(
	"/openapi",
	openAPISpecs(app, {
		documentation: {
			info: {
				title: "Azure / S3 Proxy Service API",
				version: "1.0.0",
				description:
					"Authenticated proxy service for Azure Blob Storage and S3",
			},
			components: {
				securitySchemes: {
					azureOAuth: {
						type: "oauth2",
						flows: {
							authorizationCode: {
								authorizationUrl: `https://login.microsoftonline.com/${ENTRA.TENANT_ID}/oauth2/v2.0/authorize`,
								tokenUrl: `https://login.microsoftonline.com/${ENTRA.TENANT_ID}/oauth2/v2.0/token`,
								scopes: {
									openid: "Sign in",
									profile: "View your profile",
									email: "View your email address",
								},
							},
						},
					},
				},
			},
			security: [{ azureOAuth: [] }],
			servers: [
				{
					url: "http://localhost:3000",
					description: "Local server",
				},
			],
		},
	}),
);

/**
 * Serve Scalar documentation site
 */
app.get(
	"/docs",
	Scalar({
		theme: "saturn",
		url: "/openapi",
		defaultOpenAllTags: true,
		tagsSorter: "alpha",
		authentication: {
			preferredSecurityScheme: "azureOAuth",
			securitySchemes: {
				azureOAuth: {
					flows: {
						authorizationCode: {
							"x-scalar-client-id": ENTRA.CLIENT_ID,
							clientSecret:
								NODE_ENV === "development" ? ENTRA.CLIENT_SECRET : "",
							"x-scalar-redirect-uri": "http://localhost:3000/auth/callback",
							selectedScopes: ["openid", "profile", "email"],
						},
					},
				},
			},
		},
	}),
);

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

export default app;
