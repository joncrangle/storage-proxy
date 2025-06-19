import { config, STORAGE_CONNECTION_STRING } from "@/config";
import type { StorageImpl } from "@/types";

let storageImpl: StorageImpl;

if (config.STORAGE_PROVIDER === "s3") {
	// Validate required AWS config
	if (
		!config.AWS_ACCESS_KEY_ID ||
		!config.AWS_SECRET_ACCESS_KEY ||
		!config.AWS_S3_BUCKET ||
		!config.AWS_REGION
	) {
		throw new Error(
			"Missing required AWS S3 configuration. Please set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET, and AWS_REGION.",
		);
	}
	storageImpl = await import("./s3.js");
} else if (config.STORAGE_PROVIDER === "azure") {
	// Validate required Azure config
	if (!STORAGE_CONNECTION_STRING) {
		throw new Error(
			"Missing required Azure Storage configuration. Please set AZURE_STORAGE_CONNECTION_STRING and AZURE_STORAGE_CONTAINER_NAME.",
		);
	}
	storageImpl = await import("./azure.js");
} else {
	throw new Error(`Unsupported STORAGE_PROVIDER: ${config.STORAGE_PROVIDER}`);
}

export const getBlobProperties = storageImpl.getBlobProperties;
export const downloadBlob = storageImpl.downloadBlob;
export const listContainersAndBlobs = storageImpl.listContainersAndBlobs;
