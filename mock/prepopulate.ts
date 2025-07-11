import { STORAGE_PROVIDER } from "../src/config";

// Prepopulate local development/test storage providers
if (STORAGE_PROVIDER === "azure") {
	import("./azure/prepopulate-azurite")
		.then(({ prepopulateContainers }) => prepopulateContainers())
		.then(() => console.log("Azurite blobs prepopulated."))
		.catch((err) =>
			console.warn(
				{
					error: err.message,
				},
				"Azurite blobs prepopulation failed",
			),
		);
}
if (STORAGE_PROVIDER === "s3") {
	import("./aws/prepopulate-moto")
		.then(({ prepopulateBuckets }) => prepopulateBuckets())
		.then(() => console.log("Moto S3 buckets prepopulated."))
		.catch((err) =>
			console.warn({ error: err.message }, "Moto S3 prepopulation failed"),
		);
}
