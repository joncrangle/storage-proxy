import path from "node:path";
import { z } from "zod";

export const allowedExtensions = [
	".txt",
	".pdf",
	".jpg",
	".jpeg",
	".png",
	".csv",
	".json",
];

export const mimeTypeMap: Record<string, string[]> = {
	".txt": ["text/plain"],
	".pdf": ["application/pdf"],
	".jpg": ["image/jpeg"],
	".jpeg": ["image/jpeg"],
	".png": ["image/png"],
	".csv": ["text/csv", "application/csv"],
	".json": ["application/json", "text/json"],
};

export const containerNameSchema = z
	.string()
	.min(3, "Container name must be at least 3 characters")
	.max(63, "Container name must be at most 63 characters")
	.toLowerCase()
	.regex(
		/^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
		"Container name contains invalid characters",
	)
	.refine(
		(name) => !name.includes("--"),
		"Container name cannot contain consecutive hyphens",
	)
	.transform((name) => name.replace(/[^a-z0-9-]/g, ""));

export const filenameSchema = z
	.string()
	.min(1, "Filename cannot be empty")
	.max(1024, "Filename too long (max 1024 characters)")
	.refine((filename) => {
		const suspicious = [
			"../",
			"..\\",
			"%2e%2e",
			"%252e%252e",
			"%c0%ae",
			"%c1%9c",
			"0x2e0x2e",
			"..%c0%af",
			"..%5c",
			"%2e%2e%5c",
			"%2e%2e/",
		];
		const lowercasePath = filename.toLowerCase();
		return !suspicious.some((pattern) =>
			lowercasePath.includes(pattern.toLowerCase()),
		);
	}, "Path traversal attempt detected")
	.refine((filename) => {
		// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional
		return !filename.includes("\0") && !/[\x00-\x1f\x7f]/.test(filename);
	}, "Filename contains invalid control characters")
	.refine((filename) => {
		const segments = filename.split("/");
		return segments.every((segment, i) => {
			if (segment === "" && i === segments.length - 1) return true;
			if (segment === "" || segment.startsWith("..") || segment === ".")
				return false;
			// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional
			return !/[<>:"|?*\x00-\x1f\x7f]/.test(segment);
		});
	}, "Invalid path structure")
	.refine(
		(filename) => {
			const segments = filename.split("/");
			const actualFilename = segments[segments.length - 1];
			if (!actualFilename) return true; // Allows paths ending in a slash (directories)
			const ext = path.extname(actualFilename).toLowerCase();
			return allowedExtensions.includes(ext);
		},
		`File extension must be one of: ${allowedExtensions.join(", ")}`,
	);

export const fileContentSchema = z
	.object({
		filename: z.string(),
		contentType: z.string(),
	})
	.refine(
		(data) => {
			const ext = path.extname(data.filename).toLowerCase();
			const allowedTypes = mimeTypeMap[ext];

			if (!allowedTypes) {
				return false; // Extension not allowed
			}

			// Allow the proper MIME types OR application/octet-stream (for blob handling)
			return (
				allowedTypes.includes(data.contentType) ||
				data.contentType === "application/octet-stream"
			);
		},
		{
			message:
				"Content type doesn't match file extension or file extension is not allowed",
			path: ["contentType"],
		},
	);

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

export const jwtUserSchema = z.object({
	id: z.string(),
	email: z.string().email(),
	name: z.string(),
	tenantId: z.string(),
	appId: z.string().optional(),
	roles: z.array(z.string()).default([]),
	scopes: z.array(z.string()).default([]),
	isServicePrincipal: z.boolean().default(false),
	appDisplayName: z.string().optional(),
});

export const sessionUserSchema = z.object({
	id: z.string(),
	email: z.string().email(),
	name: z.string(),
	tenantId: z.string(),
});
