import os from "node:os";
import winston from "winston";
import { config } from "@/config";

export const logger = winston.createLogger({
	level: config.LOG_LEVEL,
	format: winston.format.combine(
		winston.format.timestamp(),
		winston.format.errors({ stack: true }),
		winston.format.json(),
	),
	defaultMeta: {
		service: "storage-proxy",
		hostname: os.hostname(),
	},
	transports: [
		new winston.transports.File({ filename: "error.log", level: "error" }),
		new winston.transports.File({ filename: "combined.log" }),
		new winston.transports.Console({
			format: winston.format.simple(),
		}),
	],
});
