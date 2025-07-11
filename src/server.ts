import { app } from "./app";
import { PORT } from "./config";

export default {
	port: PORT,
	fetch: app.fetch,
};
