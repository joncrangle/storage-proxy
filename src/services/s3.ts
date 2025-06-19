import {
	GetObjectCommand,
	HeadObjectCommand,
	ListBucketsCommand,
	ListObjectsV2Command,
	S3Client,
	S3ServiceException,
} from "@aws-sdk/client-s3";
import { AWS, NODE_ENV, STORAGE_PROVIDER } from "../config";
import { logger } from "../services/logger";

let s3: S3Client;
if (
	(NODE_ENV === "development" || NODE_ENV === "test") &&
	STORAGE_PROVIDER === "s3"
) {
	s3 = new S3Client({
		region: "your-aws-region-here",
		endpoint: "http://127.0.0.1:4566",
		forcePathStyle: true,
		credentials: {
			accessKeyId: "your-aws-access-key-id-here",
			secretAccessKey: "your-aws-secret-access-key-here",
		},
	});
} else {
	if (!AWS.ACCESS_KEY_ID || !AWS.SECRET_ACCESS_KEY || !AWS.REGION) {
		logger.error("AWS credentials or region are missing.");
		process.exit(1);
	}
	s3 = new S3Client({
		region: AWS.REGION,
		credentials: {
			accessKeyId: AWS.ACCESS_KEY_ID,
			secretAccessKey: AWS.SECRET_ACCESS_KEY,
		},
	});
}

/**
 * Retrieves properties of a blob (object) from the specified S3 bucket.
 */
export async function getBlobProperties(container: string, blobPath: string) {
	try {
		const res = await s3.send(
			new HeadObjectCommand({
				Bucket: container,
				Key: blobPath,
			}),
		);
		return {
			exists: true,
			contentType: res.ContentType || "application/octet-stream",
			contentLength: res.ContentLength,
			lastModified: res.LastModified,
			etag: res.ETag,
		};
	} catch (err) {
		if (
			err instanceof S3ServiceException &&
			err.$metadata?.httpStatusCode === 404
		) {
			return new Error(`Blob does not exist: ${blobPath}`);
		}

		const message = err instanceof Error ? err.message : String(err);
		logger.error(
			{
				container,
				blobPath,
				error: message,
			},
			"Error in getBlobProperties",
		);
		return new Error(`Failed to get blob properties: ${message}`);
	}
}

/**
 * Downloads a blob (object) from the specified S3 bucket.
 */
export async function downloadBlob(container: string, blobPath: string) {
	try {
		const res = await s3.send(
			new GetObjectCommand({
				Bucket: container,
				Key: blobPath,
			}),
		);
		return { readableStreamBody: res.Body };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error(
			{
				container,
				blobPath,
				error: message,
			},
			"Error in downloadBlob",
		);
		return new Error(`Failed to download blob: ${message}`);
	}
}

/**
 * Lists all blobs (objects) in all S3 buckets.
 */
export async function listContainersAndBlobs() {
	try {
		const bucketsRes = await s3.send(new ListBucketsCommand({}));
		const buckets = bucketsRes.Buckets || [];
		const containers = [];

		for (const bucket of buckets) {
			const bucketName = bucket.Name;
			if (!bucketName) continue;
			const blobs = [];
			let ContinuationToken: string | undefined;

			do {
				try {
					const res = await s3.send(
						new ListObjectsV2Command({
							Bucket: bucketName,
							ContinuationToken,
						}),
					);

					for (const obj of res.Contents || []) {
						blobs.push({
							name: obj.Key,
							properties: {
								contentLength: obj.Size,
								lastModified: obj.LastModified,
								etag: obj.ETag,
							},
						});
					}

					ContinuationToken = res.IsTruncated
						? res.NextContinuationToken
						: undefined;
				} catch (listError: unknown) {
					if (
						listError instanceof S3ServiceException &&
						(listError.name === "NoSuchBucket" ||
							listError.$metadata?.httpStatusCode === 404)
					) {
						logger.warn(
							`Bucket ${bucketName} does not exist, returning empty container with error`,
						);
						containers.push({
							name: bucketName,
							blobs: [],
							error: `Bucket ${bucketName} does not exist`,
						});
						break;
					}

					const message =
						listError instanceof Error ? listError.message : String(listError);

					logger.error(
						{
							bucket: bucketName,
							error: message,
						},
						"Unexpected error while listing objects",
					);

					containers.push({
						name: bucketName,
						blobs: [],
						error: `Failed to list blobs: ${message}`,
					});
					break;
				}
			} while (ContinuationToken);

			if (!containers.some((c) => c.name === bucketName)) {
				containers.push({ name: bucketName, blobs });
			}
		}

		return containers;
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);

		logger.error(
			{
				error: message,
			},
			"Error in listContainersAndBlobs",
		);

		return [
			{
				name: "unknown",
				blobs: [],
				error: message,
			},
		];
	}
}
