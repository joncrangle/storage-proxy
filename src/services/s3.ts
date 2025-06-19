import {
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	S3Client,
	S3ServiceException,
} from "@aws-sdk/client-s3";
import { config } from "@/config";
import { logger } from "@/services/logger";

let s3: S3Client;
if (
	(config.NODE_ENV === "development" || config.NODE_ENV === "test") &&
	config.STORAGE_PROVIDER === "s3"
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
	s3 = new S3Client({
		region: config.AWS_REGION ?? "",
		credentials: {
			accessKeyId: config.AWS_ACCESS_KEY_ID ?? "",
			secretAccessKey: config.AWS_SECRET_ACCESS_KEY ?? "",
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
			return { exists: false };
		}

		const message = err instanceof Error ? err.message : String(err);
		logger.error("Error in getBlobProperties", {
			container,
			blobPath,
			error: message,
		});
		throw new Error(`Failed to get blob properties: ${message}`);
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
		logger.error("Error in downloadBlob", {
			container,
			blobPath,
			error: message,
		});
		throw err;
	}
}

/**
 * Lists all blobs (objects) in the configured S3 bucket.
 */
export async function listContainersAndBlobs() {
	try {
		const Bucket = config.AWS_S3_BUCKET;

		if (!Bucket) {
			logger.error("AWS_S3_BUCKET not configured");
			throw new Error("AWS_S3_BUCKET not configured");
		}

		const blobs = [];
		let ContinuationToken: string | undefined;

		do {
			try {
				const res = await s3.send(
					new ListObjectsV2Command({
						Bucket,
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
						`Bucket ${Bucket} does not exist, returning empty container with error`,
					);
					return [
						{
							name: Bucket,
							blobs: [],
							error: `Bucket ${Bucket} does not exist`,
						},
					];
				}

				logger.error("Unexpected error while listing objects", {
					bucket: Bucket,
					error:
						listError instanceof Error ? listError.message : String(listError),
				});

				throw listError;
			}
		} while (ContinuationToken);

		return [{ name: Bucket, blobs }];
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);

		logger.error("Error in listContainersAndBlobs", {
			error: message,
			bucket: config.AWS_S3_BUCKET,
		});

		return [
			{
				name: config.AWS_S3_BUCKET || "unknown",
				blobs: [],
				error: message,
			},
		];
	}
}
