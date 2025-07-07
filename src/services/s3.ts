import {
	GetObjectCommand,
	HeadObjectCommand,
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
	if (
		!AWS.ACCESS_KEY_ID ||
		!AWS.SECRET_ACCESS_KEY ||
		!AWS.REGION ||
		!AWS.S3_BUCKET
	) {
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
 * Lists all blobs (objects) in the configured S3 bucket.
 */
export async function listContainersAndBlobs() {
	const Bucket = AWS.S3_BUCKET ?? "";
	try {
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

				const message =
					listError instanceof Error ? listError.message : String(listError);

				logger.error(
					{
						bucket: Bucket,
						error: message,
					},
					"Unexpected error while listing objects",
				);

				return [
					{
						name: Bucket,
						blobs: [],
						error: `Failed to list blobs: ${message}`,
					},
				];
			}
		} while (ContinuationToken);

		return [{ name: Bucket, blobs }];
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);

		logger.error(
			{
				error: message,
				bucket: AWS.S3_BUCKET,
			},
			"Error in listContainersAndBlobs",
		);

		return [
			{
				name: AWS.S3_BUCKET || "unknown",
				blobs: [],
				error: message,
			},
		];
	}
}
