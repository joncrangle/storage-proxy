import { Hono } from "hono";
import { isLocalEnv, SESSION_SECRET } from "./config";
import { setupCoreMiddleware } from "./middleware/core";
import apiRouter from "./routes/index";
import { logger } from "./services/logger";

if (!isLocalEnv && !SESSION_SECRET) {
	logger.error("SESSION_SECRET is required in production");
	process.exit(1);
}

const app = new Hono();
await setupCoreMiddleware(app);

app.route("/", apiRouter);

export { app };
