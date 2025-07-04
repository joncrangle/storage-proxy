import { readFile } from "node:fs/promises";
import path from "node:path";
import {
	BlobServiceClient,
	StorageSharedKeyCredential,
} from "@azure/storage-blob";

// Create a proper credential object
const accountName = "devstoreaccount1";
const accountKey =
	"Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";
const sharedKeyCredential = new StorageSharedKeyCredential(
	accountName,
	accountKey,
);

// Pass the credential to the client
const blobServiceClient = new BlobServiceClient(
	"http://127.0.0.1:10000/devstoreaccount1",
	sharedKeyCredential,
);

async function ensureContainer(name: string) {
	try {
		const containerClient = blobServiceClient.getContainerClient(name);
		const exists = await containerClient.exists();
		if (exists) {
			console.log(`Container "${name}" already exists.`);
		} else {
			await containerClient.create();
			console.log(`Container "${name}" created.`);
		}
	} catch (err) {
		console.error(`Error ensuring container "${name}":`, err);
	}
}

async function putBlob(
	container: string,
	key: string,
	body: string | Uint8Array | Buffer,
	contentType: string,
) {
	const containerClient = blobServiceClient.getContainerClient(container);
	const blockBlobClient = containerClient.getBlockBlobClient(key);

	await blockBlobClient.upload(body, Buffer.byteLength(body), {
		blobHTTPHeaders: { blobContentType: contentType },
	});
	console.log(`Put blob "${key}" in container "${container}".`);
}

export async function prepopulateContainers() {
	try {
		await ensureContainer("test-container");
		await ensureContainer("test-container2");

		await putBlob(
			"test-container",
			"sastestblob.txt",
			"Hello from Azurite test-container",
			"text/plain",
		);

		const pdfPath = path.resolve("./mock/test.pdf");
		const pdfBuffer = await readFile(pdfPath);
		await putBlob(
			"test-container",
			"sastestblob.pdf",
			pdfBuffer,
			"application/pdf",
		);

		await putBlob(
			"test-container2",
			"sastestblob2.txt",
			"Hello from Azurite test-container2!",
			"text/plain",
		);
	} catch (err) {
		console.error("Error in prepopulateContainers:", err);
	}
}

prepopulateContainers();
