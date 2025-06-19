const { createHmac, createHash } = require("node:crypto");

// Moto default credentials
const SCRIPT_INTERNAL_ACCESS_KEY_ID = "testing";
const SCRIPT_INTERNAL_SECRET_ACCESS_KEY = "testing";

/**
 * Generate AWS Signature presigned URLs for S3 (Moto) local server
 * @param {Object} localClient - Client for logging (assumed to have .log method)
 * @param {Object} localRequest - Request context with variables (bucket, key)
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @param {string} method - HTTP method (PUT, GET, DELETE, etc.)
 * @param {number} expiresInSeconds - Expiration time for presigned URL
 * @param {string} accessKeyId - AWS access key id
 * @param {string} secretAccessKey - AWS secret access key
 * @param {string} host - Hostname + port for Moto (e.g., "127.0.0.1:4566")
 * @param {string} region - AWS region (e.g., "us-east-1")
 * @returns {string} Presigned URL or null on error
 */
function createPresignedUrlForMoto(
	localClient,
	_localRequest,
	bucket,
	key,
	method,
	expiresInSeconds,
	accessKeyId,
	secretAccessKey,
	host = "127.0.0.1:4566",
	region = "your-aws-region-here",
) {
	try {
		if (!bucket || !key) {
			localClient.log("Presign Error: Missing bucket or key.");
			return null;
		}

		const service = "s3";
		const now = new Date();
		const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
		const dateStamp = amzDate.slice(0, 8);

		const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
		const algorithm = "AWS4-HMAC-SHA256";
		const signedHeaders = "host";
		const canonicalUri = `/${bucket}/${encodeURIComponent(key)}`;
		const canonicalHeaders = `host:${host}\n`;
		const payloadHash = "UNSIGNED-PAYLOAD";

		// Helper functions for HMAC SHA256
		function hmac(key, data) {
			return createHmac("sha256", key).update(data, "utf8").digest();
		}

		function sha256Hex(data) {
			return createHash("sha256").update(data, "utf8").digest("hex");
		}

		function getSigningKey(key, date, region, svc) {
			const kDate = hmac(`AWS4${key}`, date);
			const kRegion = hmac(kDate, region);
			const kService = hmac(kRegion, svc);
			return hmac(kService, "aws4_request");
		}

		const queryParams = new URLSearchParams({
			"X-Amz-Algorithm": algorithm,
			"X-Amz-Credential": `${accessKeyId}/${credentialScope}`,
			"X-Amz-Date": amzDate,
			"X-Amz-Expires": String(expiresInSeconds),
			"X-Amz-SignedHeaders": signedHeaders,
		});

		const canonicalQueryString = queryParams.toString();

		const canonicalRequest = [
			method,
			canonicalUri,
			canonicalQueryString,
			canonicalHeaders,
			signedHeaders,
			payloadHash,
		].join("\n");

		const stringToSign = [
			algorithm,
			amzDate,
			credentialScope,
			sha256Hex(canonicalRequest),
		].join("\n");

		const signingKey = getSigningKey(
			secretAccessKey,
			dateStamp,
			region,
			service,
		);
		const signature = createHmac("sha256", signingKey)
			.update(stringToSign, "utf8")
			.digest("hex");

		queryParams.append("X-Amz-Signature", signature);

		return `http://${host}${canonicalUri}?${queryParams.toString()}`;
	} catch (e) {
		let errMsg = "";
		if (e instanceof Error) {
			errMsg = `Presign Crypto Error: ${e.message}${e.stack ? `\n${e.stack}` : ""}`;
		} else {
			errMsg = `Presign Crypto Error: ${String(e)}`;
		}
		localClient.log(errMsg);
		return null;
	}
}

// Main execution logic for this script (following Azurite pattern)
const scriptName = request.scriptPath || "s3.js";

// const requestName = request.name || "generatePresignedUrls";
// client.log(`[${scriptName}] Script executing for request: ${requestName}`);

// Use the internally defined credentials
const awsAccessKeyId = SCRIPT_INTERNAL_ACCESS_KEY_ID;
const awsSecretAccessKey = SCRIPT_INTERNAL_SECRET_ACCESS_KEY;

if (!awsAccessKeyId || !awsSecretAccessKey) {
	client.log(
		`[${scriptName}] CRITICAL ERROR: Internal accessKeyId or secretAccessKey is not set in the script.`,
	);
} else {
	// client.log(
	// 	`[${scriptName}] Using internal credentials: ${awsAccessKeyId}. Generating presigned URLs...`,
	// );

	const bucket = request.variables.get("bucket") || "test-bucket";
	const key = request.variables.get("key") || "test.txt";
	const operation = request.variables.get("operation") || "presign";
	const expirySeconds = 3600; // 1 hour expiry

	if (operation === "create-bucket") {
		const bucketUrl = `http://127.0.0.1:4566/${bucket}`;
		if (bucketUrl) {
			// client.log(
			// 	`[${scriptName}] Bucket creation URL successfully generated: ${bucketUrl}`,
			// );
			request.variables.set("bucketUrl", bucketUrl);
		} else {
			client.log(`[${scriptName}] Bucket creation URL generation failed.`);
		}
	} else {
		// For presigned URLs (default behavior)
		const putUrl = createPresignedUrlForMoto(
			client,
			request,
			bucket,
			key,
			"PUT",
			expirySeconds,
			awsAccessKeyId,
			awsSecretAccessKey,
		);

		const getUrl = createPresignedUrlForMoto(
			client,
			request,
			bucket,
			key,
			"GET",
			expirySeconds,
			awsAccessKeyId,
			awsSecretAccessKey,
		);

		if (putUrl) {
			// client.log(
			// 	`[${scriptName}] PUT presigned URL successfully generated: ${putUrl}`,
			// );
			request.variables.set("signedPutUrl", putUrl);
		} else {
			client.log(`[${scriptName}] PUT presigned URL generation failed.`);
		}

		if (getUrl) {
			// client.log(
			// 	`[${scriptName}] GET presigned URL successfully generated: ${getUrl}`,
			// );
			request.variables.set("signedGetUrl", getUrl);
		} else {
			client.log(`[${scriptName}] GET presigned URL generation failed.`);
		}
	}
}
