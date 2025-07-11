import { Hono } from "hono";
import { NODE_ENV, SESSION_SECRET } from "./config";
import { setupCoreMiddleware } from "./middleware/core";
import apiRouter from "./routes/index";
import { logger } from "./services/logger";

if (NODE_ENV === "production" && !SESSION_SECRET) {
	logger.error("SESSION_SECRET is required in production");
	process.exit(1);
}

const app = new Hono();
await setupCoreMiddleware(app);
app.route("/", apiRouter);

export { app };

//TODO:
//1. Test all routes
//2. Test the MimeType detection and override on viewing files
//3. Investigate the file download issue with AWS S3 Storage (404)
//4. Update tests
//5. Update readme
