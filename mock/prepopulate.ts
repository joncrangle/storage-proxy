import { STORAGE_PROVIDER } from "../src/config";

const isTest = process.env.NODE_ENV === "test";

const promises = [];

if (STORAGE_PROVIDER === "azure" || isTest) {
	const azurePromise = import("./azure/prepopulate-azurite")
		.then(({ prepopulateContainers }) => prepopulateContainers())
		.then(() => console.log("Azurite blobs prepopulated."))
		.catch((err) => {
			console.warn(
				{ error: err.message },
				"Azurite blobs prepopulation failed",
			);
			throw err;
		});
	promises.push(azurePromise);
}

if (STORAGE_PROVIDER === "s3" || isTest) {
	const s3Promise = import("./aws/prepopulate-moto")
		.then(({ prepopulateBuckets }) => prepopulateBuckets())
		.then(() => console.log("Moto S3 buckets prepopulated."))
		.catch((err) => {
			console.warn({ error: err.message }, "Moto S3 prepopulation failed");
			throw err;
		});
	promises.push(s3Promise);
}

await Promise.all(promises);
