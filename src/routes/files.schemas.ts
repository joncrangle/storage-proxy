import { resolver } from "hono-openapi/zod";
import * as z from "zod";
import {
	ContainerInfoSchema,
	containerNameSchema,
	filenameSchema,
} from "../services/storage.schemas";
import {
	errorSchema,
	forbiddenResponse,
	unauthorizedResponse,
	unknownErrorResponse,
} from "./index.schemas";

/**
 * Types
 */
export type FileRoute = z.infer<typeof fileRouteSchema>;

/**
 * Route input schemas
 */
export const fileRouteSchema = z
	.object({
		container: containerNameSchema,
		// Expect `blob` to be an array of one or more strings
		blob: z.array(z.string()).min(1, "Blob path cannot be empty."),
	})
	.transform((data) => {
		// Transform the blob array into a single, URL-decoded path string
		const blobPath = data.blob
			.map((segment) => decodeURIComponent(segment))
			.join("/");

		filenameSchema.parse(blobPath);

		return {
			container: data.container,
			blob: blobPath,
		};
	});

export const fileRequestSchema = z
	.object({
		container: z.string(),
		filename: z.string(),
	})
	.transform((data) => {
		const validatedContainer = containerNameSchema.parse(data.container);
		const validatedFilename = filenameSchema.parse(data.filename);

		return {
			container: validatedContainer,
			filename: validatedFilename,
		};
	});

/**
 * Route schemas
 */
export const filesAPI = {
	description: "File download endpoint",
	tags: ["files"],
	responses: {
		200: {
			description: "File accessed/downloaded successfully",
			content: {
				"application/octet-stream": {
					schema: resolver(z.any()),
				},
			},
		},
		400: {
			description: "Bad request",
			content: {
				"application/json": {
					schema: resolver(errorSchema),
					example: {
						error: "Validation failed",
						message: "Zod errors",
						requestId: "abc123",
					},
				},
			},
		},
		...unauthorizedResponse,
		...forbiddenResponse,
		...unknownErrorResponse,
		404: {
			description: "File not found",
			content: {
				"application/json": {
					schema: resolver(errorSchema),
					example: {
						error: "File not found",
						message:
							"The file 'name.pdf' was not found in container 'container'.",
						requestId: "abc123",
					},
				},
			},
		},
		415: {
			description: "Unsupported Media Type",
			content: {
				"application/json": {
					schema: resolver(errorSchema),
					example: {
						error: "Unsupported Media Type",
						message: "File content type does not match its extension.",
						requestId: "abc123",
					},
				},
			},
		},
	},
};

export const fileListAPI = {
	description: "List files in a container",
	tags: ["files"],
	responses: {
		200: {
			description: "File accessed/downloaded successfully",
			content: {
				"application/json": {
					schema: resolver(
						z.object({
							success: z.boolean(),
							container: z.array(ContainerInfoSchema.optional()),
							requestId: z.string(),
						}),
					),
					example: {
						success: true,
						container: [
							{
								name: "example-container",
								status: "connected",
								blobs: [
									{
										name: "example-file.txt",
										properties: {
											size: 1024,
											lastModified: new Date().toISOString(),
											contentType: "text/plain",
										},
									},
								],
							},
						],
						requestId: "abc123",
					},
				},
			},
		},
		...unauthorizedResponse,
		...forbiddenResponse,
		...unknownErrorResponse,
	},
};
