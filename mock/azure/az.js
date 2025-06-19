const { createHmac } = require("node:crypto");

// Azurite default credentials.
const SCRIPT_INTERNAL_ACCOUNT_NAME = "devstoreaccount1";
const SCRIPT_INTERNAL_ACCOUNT_KEY =
	"Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";

/**
 * Generate a flexible SAS URI for different Azure Storage resource types
 * @param {Object} localClient - The client for logging
 * @param {Object} localRequest - The request context
 * @param {string} resourceType - 'blob', 'container', or 'account'
 * @param {string} containerName - Container name (required for blob and container)
 * @param {string} blobPath - Blob path (required only for blob)
 * @param {string} permissionsString - SAS permissions
 * @param {number} expiryInMinutes - Expiry time in minutes
 * @param {string} currentAccountName - Storage account name
 * @param {string} currentAccountKey - Storage account key
 * @param {string} azuriteHost - Azurite host
 * @param {number} azuritePort - Azurite port
 */
function createSasUriForAzurite(
	localClient,
	_localRequest,
	resourceType,
	containerName,
	blobPath,
	permissionsString,
	expiryInMinutes,
	currentAccountName,
	currentAccountKey,
	azuriteHost = "127.0.0.1",
	azuritePort = 10000,
) {
	if (!currentAccountName || !currentAccountKey) {
		localClient.log("SAS Gen Error: Account name or key missing.");
		return null;
	}
	if (!resourceType || !permissionsString || !expiryInMinutes) {
		localClient.log("SAS Gen Error: Required parameters missing.");
		return null;
	}

	// Validate resource type and required parameters
	if (resourceType === "blob" && (!containerName || !blobPath)) {
		localClient.log(
			"SAS Gen Error: Blob SAS requires containerName and blobPath.",
		);
		return null;
	}
	if (resourceType === "container" && !containerName) {
		localClient.log("SAS Gen Error: Container SAS requires containerName.");
		return null;
	}

	const signedVersion = "2021-12-02";
	const signedProtocol = "https,http";
	const startsOn = new Date(Date.now() - 5 * 60 * 1000);
	const expiresOn = new Date(startsOn.getTime() + expiryInMinutes * 60 * 1000);
	const signedStartTime = startsOn.toISOString().substring(0, 19) + "Z";
	const signedExpiryTime = expiresOn.toISOString().substring(0, 19) + "Z";

	// Determine signed resource and canonicalized resource based on type
	let signedResource, canonicalizedResource, urlPath;

	switch (resourceType) {
		case "blob":
			signedResource = "b";
			canonicalizedResource = `/blob/${currentAccountName}/${containerName}/${blobPath}`;
			urlPath = `${containerName}/${blobPath}`;
			break;
		case "container":
			signedResource = "c";
			canonicalizedResource = `/blob/${currentAccountName}/${containerName}`;
			urlPath = `${containerName}`;
			break;
		case "service":
			signedResource = "s";
			canonicalizedResource = `/blob/${currentAccountName}`;
			urlPath = "";
			break;
		default:
			localClient.log(`SAS Gen Error: Invalid resource type: ${resourceType}`);
			return null;
	}

	// Based on Azure docs: https://learn.microsoft.com/en-us/rest/api/storageservices/create-service-sas
	const stringToSignFields = [
		permissionsString, // sp - signed permissions
		signedStartTime, // st - signed start time
		signedExpiryTime, // se - signed expiry time
		canonicalizedResource, // canonicalized resource
		"", // signed identifier (empty for ad-hoc SAS)
		"", // signed IP (empty)
		signedProtocol, // spr - signed protocol
		signedVersion, // sv - signed version
		signedResource, // sr - signed resource
		"", // signed snapshot time (empty for non-snapshot)
		"", // signed encryption scope (empty)
		"", // rscc - response cache control (empty)
		"", // rscd - response content disposition (empty)
		"", // rsce - response content encoding (empty)
		"", // rscl - response content language (empty)
		"", // rsct - response content type (empty)
	];
	const stringToSign = stringToSignFields.join("\n");

	// DEBUG: logging to help troubleshoot signature issues
	// localClient.log(
	// 	`[DEBUG] String-to-sign for ${resourceType}: ${JSON.stringify(stringToSign)}`,
	// );
	// localClient.log(`[DEBUG] Canonicalized resource: ${canonicalizedResource}`);

	try {
		const hmac = createHmac("sha256", Buffer.from(currentAccountKey, "base64"));
		hmac.update(stringToSign, "utf8");
		const signature = hmac.digest("base64");

		const sasParams = new URLSearchParams();
		sasParams.append("sv", signedVersion);
		sasParams.append("sp", permissionsString);
		sasParams.append("st", signedStartTime);
		sasParams.append("se", signedExpiryTime);
		sasParams.append("spr", signedProtocol);
		sasParams.append("sr", signedResource);
		sasParams.append("sig", signature);

		const baseUrl = `http://${azuriteHost}:${azuritePort}/${currentAccountName}`;
		const fullUrl = urlPath ? `${baseUrl}/${urlPath}` : baseUrl;
		return `${fullUrl}?${sasParams.toString()}`;
	} catch (e) {
		localClient.log(
			"SAS Gen Crypto Error: " + e.message + (e.stack ? "\n" + e.stack : ""),
		);
		return null;
	}
}

/**
 * Generate an Account SAS URI for Azure Storage operations requiring account-level permissions
 * @param {Object} localClient - The client for logging
 * @param {Object} localRequest - The request context
 * @param {string} permissionsString - SAS permissions
 * @param {number} expiryInMinutes - Expiry time in minutes
 * @param {string} currentAccountName - Storage account name
 * @param {string} currentAccountKey - Storage account key
 * @param {string} containerName - Container name for URL construction
 * @param {string} azuriteHost - Azurite host
 * @param {number} azuritePort - Azurite port
 */
function createAccountSasUriForAzurite(
	localClient,
	_localRequest,
	permissionsString,
	expiryInMinutes,
	currentAccountName,
	currentAccountKey,
	containerName,
	azuriteHost = "127.0.0.1",
	azuritePort = 10000,
) {
	if (!currentAccountName || !currentAccountKey) {
		localClient.log("Account SAS Gen Error: Account name or key missing.");
		return null;
	}
	if (!permissionsString || !expiryInMinutes) {
		localClient.log("Account SAS Gen Error: Required parameters missing.");
		return null;
	}

	const signedVersion = "2021-12-02";
	const signedServices = "b"; // Blob service
	const signedResourceTypes = "c"; // Container resource type
	const signedProtocol = "https,http";
	const startsOn = new Date(Date.now() - 5 * 60 * 1000);
	const expiresOn = new Date(startsOn.getTime() + expiryInMinutes * 60 * 1000);
	const signedStartTime = startsOn.toISOString().substring(0, 19) + "Z";
	const signedExpiryTime = expiresOn.toISOString().substring(0, 19) + "Z";

	// Account SAS string-to-sign format (based on Azure docs)
	const stringToSignFields = [
		currentAccountName, // account name
		permissionsString, // signed permissions
		signedServices, // signed services
		signedResourceTypes, // signed resource types
		signedStartTime, // signed start time
		signedExpiryTime, // signed expiry time
		"", // signed IP (empty)
		signedProtocol, // signed protocol
		signedVersion, // signed version
		"", // signed encryption scope (empty)
		"", // Important: Must end with empty string to add final trailing newline
	];
	const stringToSign = stringToSignFields.join("\n");

	// DEBUG: show each field separately
	// localClient.log(`[DEBUG] Account SAS Fields:`);
	// localClient.log(`  Account Name: "${currentAccountName}"`);
	// localClient.log(`  Permissions: "${permissionsString}"`);
	// localClient.log(`  Services: "${signedServices}"`);
	// localClient.log(`  Resource Types: "${signedResourceTypes}"`);
	// localClient.log(`  Start Time: "${signedStartTime}"`);
	// localClient.log(`  Expiry Time: "${signedExpiryTime}"`);
	// localClient.log(`  IP: ""`);
	// localClient.log(`  Protocol: "${signedProtocol}"`);
	// localClient.log(`  Version: "${signedVersion}"`);
	// localClient.log(`[DEBUG] Account SAS String-to-sign: ${JSON.stringify(stringToSign)}`);
	// localClient.log(`[DEBUG] String-to-sign length: ${stringToSign.length}`);
	// localClient.log(`[DEBUG] String-to-sign bytes: ${Buffer.from(stringToSign, 'utf8').toString('hex')}`);

	try {
		const hmac = createHmac("sha256", Buffer.from(currentAccountKey, "base64"));
		hmac.update(stringToSign, "utf8");
		const signature = hmac.digest("base64");

		const sasParams = new URLSearchParams();
		sasParams.append("sv", signedVersion);
		sasParams.append("ss", signedServices);
		sasParams.append("srt", signedResourceTypes);
		sasParams.append("sp", permissionsString);
		sasParams.append("st", signedStartTime);
		sasParams.append("se", signedExpiryTime);
		sasParams.append("spr", signedProtocol);
		sasParams.append("sig", signature);

		const baseUrl = `http://${azuriteHost}:${azuritePort}/${currentAccountName}`;
		const fullUrl = containerName ? `${baseUrl}/${containerName}` : baseUrl;
		return `${fullUrl}?${sasParams.toString()}`;
	} catch (e) {
		localClient.log(
			"Account SAS Gen Crypto Error: " +
				e.message +
				(e.stack ? "\n" + e.stack : ""),
		);
		return null;
	}
}

// Main execution logic for this script
const scriptName = request.scriptPath || "az.js";
const requestName = request.name || "generateSasUrl";

client.log(`[${scriptName}] Script executing for request: ${requestName}`);

// Use the internally defined account details
const azAccountName = SCRIPT_INTERNAL_ACCOUNT_NAME;
const azAccountKey = SCRIPT_INTERNAL_ACCOUNT_KEY;

if (!azAccountName || !azAccountKey) {
	// This case should not be hit if the constants are set above.
	client.log(
		`[${scriptName}] CRITICAL ERROR: Internal accountName or accountKey is not set in the script.`,
	);
} else {
	client.log(
		`[${scriptName}] Using internal account details: ${azAccountName}. Calling SAS generator...`,
	);

	const container = request.variables.get("container") || "test-container";
	const blob = request.variables.get("blob") || "sastestblob.txt";
	const permissions = "racwd"; // Desired permissions
	const expiryMins = 60; // Expiry time

	// Generate Account SAS for container creation (required for container operations)
	const containerSasUri = createAccountSasUriForAzurite(
		client,
		request,
		"c", // create permissions for containers
		expiryMins,
		azAccountName,
		azAccountKey,
		container,
	);

	const blobSasUri = createSasUriForAzurite(
		client,
		request,
		"blob",
		container,
		blob,
		permissions,
		expiryMins,
		azAccountName,
		azAccountKey,
	);

	if (containerSasUri) {
		client.log(
			`[${scriptName}] Container SAS URI successfully generated: ${containerSasUri}`,
		);
		request.variables.set("containerSasUrl", containerSasUri); // Set for container operations
	} else {
		client.log(
			`[${scriptName}] Container SAS URI generation failed (returned null).`,
		);
	}

	if (blobSasUri) {
		client.log(
			`[${scriptName}] Blob SAS URI successfully generated: ${blobSasUri}`,
		);
		request.variables.set("blobSasUrl", blobSasUri); // Set for blob operations
	} else {
		client.log(
			`[${scriptName}] Blob SAS URI generation failed (returned null).`,
		);
	}
}
