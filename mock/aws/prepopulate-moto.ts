import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {
	CreateBucketCommand,
	HeadBucketCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";

const s3 = new S3Client({
	region: "your-aws-region-here",
	endpoint: "http://127.0.0.1:4566",
	credentials: {
		accessKeyId: "your-aws-access-key-id-here",
		secretAccessKey: "your-aws-secret-access-key-here",
	},
	forcePathStyle: true,
});

async function waitForMoto(url: string, timeoutMs = 10000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			await new Promise((resolve, reject) => {
				const req = http.get(url, (res) => {
					if (res.statusCode && res.statusCode < 500) {
						resolve(true);
					} else {
						reject(new Error(`Status ${res.statusCode}`));
					}
				});
				req.on("error", reject);
			});
			console.log("Moto is ready");
			return;
		} catch {
			await new Promise((r) => setTimeout(r, 200));
		}
	}
	throw new Error("Timeout waiting for Moto");
}

async function ensureBucket(name: string) {
	await s3.send(new CreateBucketCommand({ Bucket: name }));
	console.log(`Bucket "${name}" created.`);
}

async function putObject(
	bucket: string,
	key: string,
	body: string | Uint8Array | Buffer,
	contentType: string,
) {
	await s3.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: key,
			Body: body,
			ContentType: contentType,
		}),
	);
	console.log(`Put object "${key}" in bucket "${bucket}".`);
}

export async function prepopulateBuckets() {
	try {
		await waitForMoto("http://127.0.0.1:4566");
		await ensureBucket("test-container");
		await ensureBucket("test-container2");

		await putObject(
			"test-container",
			"sastestblob.txt",
			"Hello from Moto test-container",
			"text/plain",
		);

		const pdfPath = path.resolve("./mock/test.pdf");
		const pdfBuffer = await readFile(pdfPath);
		await putObject(
			"test-container",
			"sastestblob.pdf",
			pdfBuffer,
			"application/pdf",
		);

		await putObject(
			"test-container2",
			"sastestblob2.txt",
			"Hello from Moto test-container2!",
			"text/plain",
		);
	} catch (err) {
		console.error("Error in prepopulateBuckets:", err);
	}
}
