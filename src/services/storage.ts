import {
	AWS,
	AZURE_STORAGE_CONNECTION_STRING,
	STORAGE_PROVIDER,
} from "../config";
import type { StorageImpl } from "./storage.schemas";

let storageImpl: StorageImpl;

if (STORAGE_PROVIDER === "s3") {
	// Validate required AWS config
	if (!AWS.ACCESS_KEY_ID || !AWS.SECRET_ACCESS_KEY || !AWS.REGION) {
		throw new Error(
			"Missing required AWS S3 configuration. Please set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION.",
		);
	}
	storageImpl = await import("./s3.js");
} else if (STORAGE_PROVIDER === "azure") {
	// Validate required Azure config
	if (!AZURE_STORAGE_CONNECTION_STRING) {
		throw new Error(
			"Missing required Azure Storage configuration. Please set AZURE_STORAGE_CONNECTION_STRING and AZURE_STORAGE_CONTAINER_NAME.",
		);
	}
	storageImpl = await import("./azure.js");
} else {
	throw new Error(`Unsupported STORAGE_PROVIDER: ${STORAGE_PROVIDER}`);
}

/**
 * Export unified storage functions.
 */
export const getBlobProperties = storageImpl.getBlobProperties;
export const downloadBlob = storageImpl.downloadBlob;
export const listContainersAndBlobs = storageImpl.listContainersAndBlobs;
