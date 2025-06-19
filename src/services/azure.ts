import { BlobServiceClient } from "@azure/storage-blob";
import { LRUCache } from "lru-cache";
import { AZURE_STORAGE_CONNECTION_STRING, CACHE_TTL } from "../config";
import { logger } from "../services/logger";
import {
	containerNameSchema,
	type StorageBlobProperties,
} from "./storage.schemas";

if (!AZURE_STORAGE_CONNECTION_STRING) {
	logger.error("Azure storage connection string is missing.");
	process.exit(1);
}

const blobServiceClient = BlobServiceClient.fromConnectionString(
	AZURE_STORAGE_CONNECTION_STRING,
	{
		retryOptions: { maxTries: 3, tryTimeoutInMs: 30000, retryDelayInMs: 1000 },
	},
);

const blobCache = new LRUCache<string, StorageBlobProperties>({
	max: 500,
	ttl: CACHE_TTL * 1000,
});

/**
 * Gets a sanitized Azure Blob ContainerClient.
 */
function getContainerClient(containerName: string) {
	const sanitized = containerNameSchema.parse(containerName);
	return blobServiceClient.getContainerClient(sanitized);
}

/**
 * Gets blob properties from cache or Azure.
 */
export async function getBlobProperties(container: string, blobPath: string) {
	const cacheKey = `props:${container}:${blobPath}`;
	const cached = blobCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const containerClient = getContainerClient(container);
	const blobClient = containerClient.getBlobClient(blobPath);

	try {
		const properties = await blobClient.getProperties();
		const result = {
			exists: true,
			contentType: properties.contentType ?? "application/octet-stream",
			contentLength: properties.contentLength,
			lastModified: properties.lastModified,
			etag: properties.etag,
		};
		blobCache.set(cacheKey, result);
		return result;
	} catch (err) {
		if (err instanceof Error) {
			logger.error(
				{
					container,
					blobPath,
					error: err.message,
				},
				"Error in getBlobProperties",
			);
		} else {
			logger.error(
				{
					container,
					blobPath,
					error: String(err),
				},
				"Unknown error in getBlobProperties",
			);
		}
		return new Error(
			`Failed to get blob properties for ${container}/${blobPath}`,
		);
	}
}

/**
 * Downloads a blob from an Azure container.
 */
export function downloadBlob(container: string, blobPath: string) {
	const containerClient = getContainerClient(container);
	const blobClient = containerClient.getBlobClient(blobPath);
	return blobClient.download();
}

/**
 * Lists all containers and their blobs in the Azure Blob Storage account.
 * If listing blobs for a container fails, that container will include an `error` property.
 */
export async function listContainersAndBlobs() {
	const containers = [];
	for await (const container of blobServiceClient.listContainers()) {
		try {
			const containerClient = blobServiceClient.getContainerClient(
				container.name,
			);
			const blobs = [];

			// List blobs in this container
			for await (const blob of containerClient.listBlobsFlat()) {
				blobs.push({
					name: blob.name,
					properties: {
						contentLength: blob.properties.contentLength,
						lastModified: blob.properties.lastModified,
						etag: blob.properties.etag,
					},
				});
			}

			containers.push({
				name: container.name,
				blobs,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logger.error(
				`Error listing blobs for container ${container.name}:`,
				message,
			);
			containers.push({
				name: container.name,
				blobs: [],
				error: message,
			});
		}
	}
	return containers;
}
