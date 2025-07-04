import compression from "compression";
import cors from "cors";
import express, {
	type ErrorRequestHandler,
	type Express,
	json,
	type RequestHandler,
	type Response,
	urlencoded,
} from "express";
import { rateLimit } from "express-rate-limit";
import session from "express-session";
import helmet from "helmet";
import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { config, PORT, SESSION_SECRET, SESSION_TIMEOUT } from "@/config";
import {
	globalErrorHandler,
	requestId,
	requestLogger,
} from "@/middleware/core";
import apiRouter from "@/routes/index";
import { logger } from "@/services/logger";
import type { CustomRequest } from "@/types";

// Validate session secret in production
if (config.NODE_ENV === "production" && !config.SESSION_SECRET) {
	logger.error("SESSION_SECRET is required in production");
	process.exit(1);
}

// Prepopulate local development/test storage providers
if (config.NODE_ENV === "development" || config.NODE_ENV === "test") {
	if (config.STORAGE_PROVIDER === "azure") {
		import("../mock/azure/prepopulate-azurite")
			.then(({ prepopulateContainers }) => prepopulateContainers())
			.then(() => logger.info("Azurite blobs prepopulated."))
			.catch((err) =>
				logger.warn("Azurite blobs prepopulation failed", {
					error: err.message,
				}),
			);
	}
	if (config.STORAGE_PROVIDER === "s3") {
		import("../mock/aws/prepopulate-moto")
			.then(({ prepopulateBuckets }) => prepopulateBuckets())
			.then(() => logger.info("Moto S3 buckets prepopulated."))
			.catch((err) =>
				logger.warn("Moto S3 prepopulation failed", { error: err.message }),
			);
	}
}

const app: Express = express();

const swaggerDefinition = {
	openapi: "3.0.4",
	info: {
		title: "Azure / S3 Proxy Service API",
		version: "1.0.0",
		description: "Authenticated proxy service for Azure Blob Storage and S3",
	},
	components: {
		securitySchemes: {
			azureOAuth: {
				type: "oauth2",
				flows: {
					authorizationCode: {
						authorizationUrl: `https://login.microsoftonline.com/${config.AZURE_TENANT_ID}/oauth2/v2.0/authorize`,
						tokenUrl: `https://login.microsoftonline.com/${config.AZURE_TENANT_ID}/oauth2/v2.0/token`,
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
			url: "/",
			description: "Local dev server",
		},
	],
};

const swaggerSpec = swaggerJSDoc({
	swaggerDefinition,
	apis: ["./src/routes/*.js"],
});

// Serve Swagger UI
app.use(
	"/api",
	swaggerUi.serve,
	swaggerUi.setup(swaggerSpec, {
		swaggerOptions: {
			oauth2RedirectUrl: "http://localhost:3000/auth/callback",
			oauth: {
				clientId: config.AZURE_CLIENT_ID,
				clientSecret: config.AZURE_CLIENT_SECRET,
				appName: "Azure / S3 Proxy Service",
			},
		},
	}),
);
// Security and Core Middleware
app.set("trust proxy", 1);
app.use(
	helmet({
		crossOriginResourcePolicy: { policy: "same-origin" },
		contentSecurityPolicy: { directives: { defaultSrc: ["'self'"] } },
	}),
);
app.use(cors());
app.use(compression());
// @ts-ignore
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 100 }));
app.use(json({ limit: "10mb" }));
app.use(urlencoded({ extended: true, limit: "10mb" }));

// Request Lifecycle Middleware
app.use(requestId as RequestHandler);
app.use(requestLogger as RequestHandler);

// Session Configuration
app.use(
	session({
		secret: SESSION_SECRET,
		resave: false,
		saveUninitialized: false,
		name: "blob-proxy-session",
		cookie: {
			secure: config.NODE_ENV === "production",
			httpOnly: true,
			maxAge: SESSION_TIMEOUT,
			sameSite: "lax",
		},
	}),
);

// Mount All Routes
app.use("/", apiRouter);

// 404 Handler (after all routes)
app.use(((req: CustomRequest, res: Response) => {
	logger.warn("Route not found", { url: req.originalUrl, requestId: req.id });
	res.status(404).json({ error: "Not Found", requestId: req.id });
}) as RequestHandler);

// Global Error Handler (last middleware)
app.use(globalErrorHandler as ErrorRequestHandler);

// Server Startup
const server = app.listen(PORT, () => {
	logger.info("Azure / S3 Proxy Service started", {
		port: PORT,
		environment: config.NODE_ENV,
	});
});

// Graceful Shutdown
process.on("SIGTERM", () => {
	logger.info("SIGTERM received, shutting down gracefully");
	server.close(() => process.exit(0));
});
process.on("SIGINT", () => {
	logger.info("SIGINT received, shutting down gracefully");
	server.close(() => process.exit(0));
});

export default app;
