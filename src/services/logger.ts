import pino from "pino";
import * as z from "zod";
import { LOG_LEVEL } from "../config";

/**
 * Types
 */
type LogContext = z.infer<typeof LogContextSchema>;
type ErrorLogData = z.infer<typeof ErrorLogDataSchema>;
type LogData = LogContext | ErrorLogData;

/**
 * Schemas
 */
const LogContextSchema = z.record(z.string(), z.unknown());
const ErrorLogDataSchema = z
	.object({
		error: z.string(),
		stack: z.string().optional(),
		path: z.string().optional(),
		method: z.string().optional(),
		userId: z.string().optional(),
		requestId: z.string().optional(),
	})
	.and(LogContextSchema);

/**
 * Define custom log format
 */
const transport = pino.transport({
	targets: [
		{
			target: "pino-pretty",
			options: {
				colorize: true,
				translateTime: "HH:MM:ss Z",
			},
			level: LOG_LEVEL,
		},
		{
			target: "pino/file",
			options: {
				destination: "./logs/error.log",
			},
			level: "error",
		},
		{
			target: "pino/file",
			options: {
				destination: "./logs/combined.log",
			},
			level: "debug",
		},
	],
});

const customLogger = pino(
	{
		level: LOG_LEVEL,
		base: {
			service: "storage-proxy",
		},
		timestamp: pino.stdTimeFunctions.isoTime,
	},
	transport,
);

/**
 * Reusable logging function with validation
 */
function logWithValidation(
	level: "info" | "warn" | "error" | "debug",
	data: LogData | string,
	msg?: string,
	isError: boolean = false,
) {
	if (typeof data === "string") {
		customLogger[level](data);
		return;
	}

	const schema = isError ? ErrorLogDataSchema : LogContextSchema;
	const validated = schema.safeParse(data);

	if (validated.success) {
		customLogger[level](validated.data, msg);
	} else {
		customLogger.warn(
			{
				invalidLogData: data,
				validationError: validated.error,
			},
			`Invalid ${level} log data`,
		);
		customLogger[level](msg || `Log with invalid data`);
	}
}

/**
 * Global logger
 */
export const logger = {
	info: (data: LogData | string, msg?: string) => {
		logWithValidation("info", data, msg);
	},
	warn: (data: LogData | string, msg?: string) => {
		logWithValidation("warn", data, msg);
	},
	error: (data: ErrorLogData | string, msg?: string) => {
		logWithValidation("error", data, msg, true);
	},
	debug: (data: LogData | string, msg?: string) => {
		logWithValidation("debug", data, msg);
	},
};
