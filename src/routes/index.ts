import { type Response, Router } from "express";
import { config } from "@/config";
import authRoutes from "@/routes/auth";
import fileRoutes from "@/routes/files";
import metricsRoutes from "@/routes/metrics";
import { logger } from "@/services/logger";
import { listContainersAndBlobs } from "@/services/storage";
import type { ContainerInfo, CustomRequest } from "@/types";

const router = Router();

// @ts-ignore
router.get("/favicon.ico", (_req, res) => res.status(204).end());

/**
 * @openapi
 * tags:
 *   - name: default
 *     description: Base API endpoints
 */

// Mount the specific routers
router.use("/auth", authRoutes);
router.use("/v1/files", fileRoutes);
router.use("/v1/metrics", metricsRoutes);

/**
 * @openapi
 * /:
 *   get:
 *     summary: Returns the current status of the app
 *     description: Provides basic info about the app status and available endpoints.
 *     responses:
 *       200:
 *         description: Application status info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 name:
 *                   type: string
 *                 status:
 *                   type: string
 *                 environment:
 *                   type: string
 *                 authenticated:
 *                   type: boolean
 *                 user:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     email:
 *                       type: string
 *                     name:
 *                       type: string
 *                 endpoints:
 *                   type: object
 *                   additionalProperties:
 *                     type: string
 *                 requestId:
 *                   type: string
 */
router.get("/", (req: CustomRequest, res: Response) => {
	const user = req.session.user;
	res.json({
		name: "Azure Blob Storage Proxy",
		status: "running",
		environment: config.NODE_ENV,
		authenticated: !!user,
		user: user ? { email: user.email, name: user.name } : null,
		endpoints: {
			api: "/api",
			health: "/health",
		},
		requestId: req.id,
	});
});

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Check system health
 *     description: Returns uptime, environment, and Azure blob container status.
 *     responses:
 *       200:
 *         description: Healthy
 *       503:
 *         description: Degraded or unhealthy
 */
router.get("/health", async (req: CustomRequest, res: Response) => {
	const healthcheck = {
		status: "healthy",
		timestamp: new Date().toISOString(),
		uptime: process.uptime(),
		requestId: req.id,
		version: process.env.npm_package_version ?? "unknown",
		environment: config.NODE_ENV,
		storage: {
			provider: config.STORAGE_PROVIDER,
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
		logger.error("Health check failed to connect to storage provider", {
			error: message,
		});
		healthcheck.status = "degraded";
		healthcheck.storage.status = "error";
		healthcheck.storage.error = message;
	}

	const statusCode = healthcheck.status === "healthy" ? 200 : 503;
	res.status(statusCode).json(healthcheck);
});

export default router;
