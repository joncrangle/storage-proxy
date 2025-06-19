import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { testClient } from "hono/testing";
import { resetDb, seedDb } from "../mock/seed";

const mockAuthWithSession = async (c: Context, next: Next) => {
	c.set("session", {
		id: "mock-session",
		token: "mock-token",
		userId: "mock-user",
		expiresAt: new Date(),
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	return next();
};

const mockAuthWithoutSession = async (c: Context) => {
	c.set("user", null);
	c.set("session", null);
	throw new HTTPException(401, { message: "Authentication required." });
};

const runAuthTests = (app: any, label: string, auth: boolean): void => {
	describe(label, () => {
		beforeEach(async () => {
			// 1. Clear cache
			Object.keys(require.cache).forEach((key) => {
				if (key.includes("/src/")) {
					delete require.cache[key];
				}
			});

			// 2. Set up mock BEFORE any imports
			mock.module("../src/middleware/auth", () => ({
				requireAuth: auth ? mockAuthWithSession : mockAuthWithoutSession,
			}));

			// 3. THEN import the app
			const { app: appModule } = await import("../src/app");
			app = testClient(appModule);
		});

		const tests: {
			desc: string;
			itt: string;
			getPath: (app: any) => any;
			param?: any;
			query?: any;
			expectBody: (body: any) => void;
			expectHeaders?: Record<string, string>;
			expectedStatus?: number;
			expectedType?: "json" | "text";
			method?: "GET" | "POST" | "PUT" | "DELETE";
		}[] = [
			{
				desc: "files endpoints",
				itt: "download files",
				getPath: (app) => app.v1.files.download[":container"][":filename"],
				param: { container: "test-container", filename: "sastestblob.txt" },
				expectedType: "text",
				expectBody: (body: string): void => {
					expect(typeof body).toBe("string");
					expect(body).toContain("Hello from");
				},
			},
			{
				desc: "files endpoints",
				itt: "view files",
				getPath: (app) => app.v1.files[":container"][":filename"],
				param: { container: "test-container", filename: "sastestblob.txt" },
				expectedType: "text",
				expectBody: (body: string): void => {
					expect(typeof body).toBe("string");
					expect(body).toContain("Hello from");
				},
			},
			{
				desc: "files endpoints",
				itt: "non-existent file",
				getPath: (app) => app.v1.files[":container"][":filename"],
				param: { container: "test-container", filename: "non-existent.txt" },
				expectedStatus: 404,
				expectBody: () => {},
			},
			{
				desc: "files endpoints",
				itt: "non-supported file extension",
				getPath: (app) => app.v1.files[":container"][":filename"],
				param: { container: "test-container", filename: "non-existent" },
				expectedStatus: 400,
				expectBody: () => {},
			},
			{
				desc: "files endpoints",
				itt: "serves file with correct content type",
				getPath: (app) => app.v1.files[":container"][":filename"],
				param: { container: "test-container", filename: "sastestblob.pdf" },
				expectedStatus: 200,
				expectedType: "text",
				expectBody: (body: string): void => {
					expect(typeof body).toBe("string");
				},
				expectHeaders: {
					"content-type": "application/pdf",
					"content-disposition": 'inline; filename="sastestblob.pdf"',
				},
			},
			{
				desc: "files endpoints",
				itt: "list files",
				getPath: (app) => app.v1.files.list,
				expectedType: "json",
				expectBody: (body): void => {
					expect(body).toHaveProperty("success", true);
					expect(Array.isArray(body.containers)).toBe(true);
				},
			},
			{
				desc: "metrics endpoints",
				itt: "list accessed files",
				getPath: (app) => app.v1.metrics.files,
				expectedType: "json",
				expectBody: (body): void => {
					expect(body).toHaveProperty("success");
					expect(body).toHaveProperty("data");
					expect(body.data).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								container: expect.any(String),
								blob: expect.any(String),
								totalAccesses: expect.any(Number),
								firstAccessed: expect.any(String),
								lastAccessed: expect.any(String),
								recentUsersCount: expect.any(Number),
							}),
						]),
					);
					expect(body).toHaveProperty("requestId");
				},
			},
			{
				desc: "metrics endpoints",
				itt: "list accessed files with limit",
				getPath: (app) => app.v1.metrics.files,
				query: { limit: 1 },
				expectedType: "json",
				expectBody: (body): void => {
					expect(body).toHaveProperty("success");
					expect(body).toHaveProperty("data");
					expect(body.data).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								container: expect.any(String),
								blob: expect.any(String),
								totalAccesses: expect.any(Number),
								firstAccessed: expect.any(String),
								lastAccessed: expect.any(String),
								recentUsersCount: expect.any(Number),
							}),
						]),
					);
					expect(body).toHaveProperty("limit");
					expect(body).toHaveProperty("requestId");
				},
			},
			{
				desc: "metrics endpoints",
				itt: "list accessed files with startDate",
				getPath: (app) => app.v1.metrics.files,
				query: { startDate: "2024-12-31" },
				expectedType: "json",
				expectBody: (body): void => {
					expect(body).toHaveProperty("success");
					expect(body).toHaveProperty("data");
					expect(body.data).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								container: expect.any(String),
								blob: expect.any(String),
								totalAccesses: expect.any(Number),
								firstAccessed: expect.any(String),
								lastAccessed: expect.any(String),
								recentUsersCount: expect.any(Number),
							}),
						]),
					);
					expect(body).toHaveProperty("startDate");
					expect(body).toHaveProperty("requestId");
				},
			},
			{
				desc: "metrics endpoints",
				itt: "list accessed files with startDate and endDate",
				getPath: (app) => app.v1.metrics.files,
				query: { startDate: "2024-12-31", endDate: "2025-06-01" },
				expectedType: "json",
				expectBody: (body): void => {
					expect(body).toHaveProperty("success");
					expect(body).toHaveProperty("data");
					expect(body.data).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								container: expect.any(String),
								blob: expect.any(String),
								totalAccesses: expect.any(Number),
								firstAccessed: expect.any(String),
								lastAccessed: expect.any(String),
								recentUsersCount: expect.any(Number),
							}),
						]),
					);
					expect(body).toHaveProperty("startDate");
					expect(body).toHaveProperty("requestId");
				},
			},
			{
				desc: "metrics endpoints",
				itt: "error get files with startDate after endDate",
				getPath: (app) => app.v1.metrics.files,
				query: { endDate: "2024-12-31", startDate: "2025-06-01" },
				expectedType: "json",
				expectBody: (body): void => {
					expect(body).toHaveProperty("error");
				},
				expectedStatus: 400,
			},
			{
				desc: "metrics endpoints",
				itt: "get container statistics",
				getPath: (app) => app.v1.metrics.containers,
				expectedType: "json",
				expectBody: (body): void => {
					expect(body).toHaveProperty("success");
					expect(body).toHaveProperty("data");
					expect(body.data).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								container: expect.any(String),
								totalAccesses: expect.any(Number),
								uniqueFiles: expect.any(Number),
								uniqueUsers: expect.any(Number),
							}),
						]),
					);
					expect(body).toHaveProperty("requestId");
				},
			},
			{
				desc: "metrics endpoints",
				itt: "get summary statistics",
				getPath: (app) => app.v1.metrics.summary,
				expectedType: "json",
				expectBody: (body): void => {
					expect(body).toHaveProperty("success");
					expect(body).toHaveProperty("data");
					expect(body.data).toEqual(
						expect.objectContaining({
							totalFiles: expect.any(Number),
							totalAccesses: expect.any(Number),
							uniqueUsers: expect.any(Number),
							uniqueContainers: expect.any(Number),
						}),
					);
					expect(body).toHaveProperty("requestId");
				},
			},
			{
				desc: "metrics endpoints",
				itt: "get container files statistics",
				getPath: (app) => app.v1.metrics[":container"].files,
				param: { container: "test-container" },
				expectedType: "json",
				expectBody: (body): void => {
					expect(body).toHaveProperty("success");
					expect(body).toHaveProperty("data");
					expect(body.data).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								container: expect.any(String),
								blob: expect.any(String),
								totalAccesses: expect.any(Number),
								firstAccessed: expect.any(String),
								lastAccessed: expect.any(String),
								recentUsersCount: expect.any(Number),
							}),
						]),
					);
					expect(body).toHaveProperty("requestId");
				},
			},
			{
				desc: "metrics endpoints",
				itt: "get container files statistics with limit",
				getPath: (app) => app.v1.metrics[":container"].files,
				param: { container: "test-container" },
				query: { limit: 1 },
				expectedType: "json",
				expectBody: (body): void => {
					expect(body).toHaveProperty("success");
					expect(body).toHaveProperty("data");
					expect(body.data).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								container: expect.any(String),
								blob: expect.any(String),
								totalAccesses: expect.any(Number),
								firstAccessed: expect.any(String),
								lastAccessed: expect.any(String),
								recentUsersCount: expect.any(Number),
							}),
						]),
					);
					expect(body).toHaveProperty("limit");
					expect(body).toHaveProperty("requestId");
				},
			},
			{
				desc: "metrics endpoints",
				itt: "get container files statistics with startDate",
				getPath: (app) => app.v1.metrics[":container"].files,
				param: { container: "test-container" },
				query: { startDate: "2024-12-31" },
				expectedType: "json",
				expectBody: (body): void => {
					expect(body).toHaveProperty("success");
					expect(body).toHaveProperty("data");
					expect(body.data).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								container: expect.any(String),
								blob: expect.any(String),
								totalAccesses: expect.any(Number),
								firstAccessed: expect.any(String),
								lastAccessed: expect.any(String),
								recentUsersCount: expect.any(Number),
							}),
						]),
					);
					expect(body).toHaveProperty("startDate");
					expect(body).toHaveProperty("requestId");
				},
			},
			{
				desc: "metrics endpoints",
				itt: "get container files statistics with startDate and endDate",
				getPath: (app) => app.v1.metrics[":container"].files,
				param: { container: "test-container" },
				query: { startDate: "2023-12-31", endDate: "2025-06-01" },
				expectedType: "json",
				expectBody: (body): void => {
					expect(body).toHaveProperty("success");
					expect(body).toHaveProperty("data");
					expect(body.data).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								container: expect.any(String),
								blob: expect.any(String),
								totalAccesses: expect.any(Number),
								firstAccessed: expect.any(String),
								lastAccessed: expect.any(String),
								recentUsersCount: expect.any(Number),
							}),
						]),
					);
					expect(body).toHaveProperty("startDate");
					expect(body).toHaveProperty("endDate");
					expect(body).toHaveProperty("requestId");
				},
			},
			{
				desc: "metrics endpoints",
				itt: "error get files with startDate after endDate",
				getPath: (app) => app.v1.metrics[":container"].files,
				param: { container: "test-container" },
				query: { endDate: "2024-12-31", startDate: "2025-06-01" },
				expectedType: "json",
				expectBody: (body): void => {
					expect(body).toHaveProperty("error");
				},
				expectedStatus: 400,
			},
			{
				desc: "metrics endpoints",
				itt: "get container summary statistics",
				getPath: (app) => app.v1.metrics[":container"].summary,
				param: { container: "test-container" },
				expectedType: "json",
				expectBody: (body): void => {
					expect(body).toHaveProperty("success");
					expect(body).toHaveProperty("data");
					expect(body.data).toEqual(
						expect.objectContaining({
							totalFiles: expect.any(Number),
							totalAccesses: expect.any(Number),
							uniqueUsers: expect.any(Number),
							uniqueContainers: expect.any(Number),
						}),
					);
					expect(body).toHaveProperty("requestId");
				},
			},
			{
				desc: "metrics endpoints",
				itt: "export container metrics",
				getPath: (app) => app.v1.metrics[":container"].export,
				param: { container: "test-container" },
				method: "GET",
				expectedType: "json",
				expectBody: (body): void => {
					expect(body).toHaveProperty("exportedAt");
					expect(body).toHaveProperty("exportedBy");
					expect(body).toHaveProperty("metrics");
					expect(body.metrics).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								container: expect.any(String),
								blob: expect.any(String),
								totalAccesses: expect.any(Number),
								firstAccessed: expect.any(String),
								lastAccessed: expect.any(String),
								recentUsersCount: expect.any(Number),
							}),
						]),
					);
				},
			},
			{
				desc: "metrics endpoints",
				itt: "export container metrics",
				getPath: (app) => app.v1.metrics[":container"].export,
				param: { container: "test-container" },
				query: { format: "json" },
				method: "POST",
				expectedType: "json",
				expectBody: (body): void => {
					expect(body).toHaveProperty("exportedAt");
					expect(body).toHaveProperty("exportedBy");
					expect(body).toHaveProperty("metrics");
					expect(body.metrics).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								container: expect.any(String),
								blob: expect.any(String),
								totalAccesses: expect.any(Number),
								firstAccessed: expect.any(String),
								lastAccessed: expect.any(String),
								recentUsersCount: expect.any(Number),
							}),
						]),
					);
				},
			},
			{
				desc: "metrics endpoints",
				itt: "export container metrics to csv",
				getPath: (app) => app.v1.metrics[":container"].export,
				param: { container: "test-container" },
				query: { format: "csv" },
				method: "POST",
				expectedType: "text",
				expectBody: (body): void => {
					expect(typeof body).toBe("string");

					// Check for CSV headers
					expect(body).toContain("Total Accesses");
					expect(body).toContain("First Accessed");
					expect(body).toContain("Last Accessed");

					// Split into lines
					const lines = body.split("\n").filter((line: string) => line.trim());
					expect(lines.length).toBeGreaterThan(1);

					expect(body).toContain("test-container");
					expect(body).toContain("sastestblob.txt");
					expect(body).toContain("sastestblob.pdf");

					for (let i = 1; i < lines.length; i++) {
						const line = lines[i];
						expect(line).toContain("test-container");
						expect(line).toMatch(/\d+/); // Should contain numbers
						expect(line).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // Should contain timestamps
					}
				},
			},
			{
				desc: "metrics endpoints",
				itt: "unsupported method",
				getPath: (app) => app.v1.metrics,
				query: { action: "persist" },
				expectedType: "json",
				expectBody: (body): void => {
					expect(body).toHaveProperty("error");
				},
				expectedStatus: 404,
			},
			{
				desc: "metrics endpoints",
				itt: "unsupported action",
				getPath: (app) => app.v1.metrics,
				query: { action: "nonexistent" },
				method: "POST",
				expectedType: "json",
				expectBody: (body): void => {
					expect(body).toHaveProperty("error");
				},
				expectedStatus: 400,
			},
			{
				desc: "metrics endpoints",
				itt: "persist metrics",
				getPath: (app) => app.v1.metrics,
				query: { action: "persist" },
				method: "POST",
				expectedType: "json",
				expectBody: (body): void => {
					expect(body).toHaveProperty("success", true);
					expect(body).toHaveProperty("message", "Metrics persisted");
					expect(body).toHaveProperty("requestId");
				},
			},
			{
				desc: "metrics endpoints",
				itt: "clear metrics in development",
				getPath: (app) => app.v1.metrics,
				query: { action: "clear" },
				method: "POST",
				expectedType: "json",
				expectBody: (body): void => {
					expect(body).toHaveProperty("success", true);
					expect(body).toHaveProperty("message", "Metrics cleared");
					expect(body).toHaveProperty("requestId");
				},
			},
		];

		tests.forEach(
			({
				desc,
				itt,
				getPath,
				param,
				query,
				expectBody,
				expectHeaders,
				expectedType,
				expectedStatus = 200,
				method = "GET",
			}) => {
				describe(desc, () => {
					it(`${method} > ${auth ? "allows" : "requires authentication for"} ${itt}`, async () => {
						const path = getPath(app);
						let res: Response;

						switch (method) {
							case "GET":
								res = await path.$get({ param, query });
								break;
							case "POST":
								res = await path.$post({ param, json: query });
								break;
							case "PUT":
								res = await path.$put({ param, query });
								break;
							case "DELETE":
								res = await path.$delete({ param, query });
								break;
							default:
								res = await path.$get({ param, query });
						}

						if (auth) {
							expect(res.status).toBe(expectedStatus);
							const body =
								expectedType === "json" ? await res.json() : await res.text();

							expectBody(body);
							if (expectHeaders) {
								for (const [key, value] of Object.entries(expectHeaders)) {
									expect(res.headers.get(key)).toBe(value);
								}
							}
						} else {
							expect(res.status).toBe(401);
						}
					});
				});
			},
		);
	});
};

describe.each(["azure", "s3"])("%s storage provider:", (provider) => {
	let app: any;

	// Set environment variables
	process.env = {
		NODE_ENV: "test",
		BASE_URL: "http://localhost:3000",
		PORT: "3000",
		LOG_LEVEL: "error",
		AZURE_CLIENT_SECRET: "client-secret-here",
		AZURE_TENANT_ID: "your-tenant-id-here",
		AZURE_CLIENT_ID: "your-client-id-here",
		AZURITE_CONNECTION_STRING:
			"DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;",
		AZURITE_CONTAINER_NAME: "devstoreaccount1",
		AWS_ACCESS_KEY_ID: "your-aws-access-key-id-here",
		AWS_SECRET_ACCESS_KEY: "your-aws-secret-access-key-here",
		AWS_REGION: "your-aws-region-here",
		SESSION_SECRET: "session-secret",
	};

	beforeEach(async () => {
		await seedDb();
	});

	afterAll(async () => {
		await resetDb();
	});

	beforeEach(async () => {
		// 1. Clear cache
		Object.keys(require.cache).forEach((key) => {
			if (key.includes("/src/")) {
				delete require.cache[key];
			}
		});

		// 2. Set up ENV
		process.env.STORAGE_PROVIDER = provider;

		// 3. THEN import the app
		const { app: appModule } = await import("../src/app");
		app = testClient(appModule);
	});

	it("should return app status at /", async () => {
		const res = await app.$get();
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toHaveProperty("name");
		expect(body).toHaveProperty("status", "running");
	});

	it("should serve Scalar Docs", async () => {
		const res = await app.docs.$get();
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toContain("Scalar");
	});

	it("should return 404 for unknown routes", async () => {
		const res = await app.nonexistent.$get();
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error).toBe("Not Found");
	});

	it("should return health status at /health", async () => {
		const res = await app.health.$get();
		expect([200, 503]).toContain(res.status);
		const body = await res.json();
		expect(body).toHaveProperty("status");
		expect(["azure", "s3"]).toContain(body.storage.provider);
		expect(body).toHaveProperty("requestId");
	});

	runAuthTests(app, "without auth", false);
	runAuthTests(app, "with auth", true);
});

describe("production", async () => {
	let app: any;

	beforeEach(async () => {
		// Set environment variables
		process.env = {
			NODE_ENV: "production",
			BASE_URL: "http://localhost:3000",
			STORAGE_PROVIDER: "s3",
			PORT: "3000",
			LOG_LEVEL: "error",
			AZURE_CLIENT_SECRET: "client-secret-here",
			AZURE_TENANT_ID: "your-tenant-id-here",
			AZURE_CLIENT_ID: "your-client-id-here",
			AZURITE_CONNECTION_STRING:
				"DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;",
			AZURITE_CONTAINER_NAME: "devstoreaccount1",
			AWS_ACCESS_KEY_ID: "your-aws-access-key-id-here",
			AWS_SECRET_ACCESS_KEY: "your-aws-secret-access-key-here",
			AWS_REGION: "your-aws-region-here",
			SESSION_SECRET: "session-secret",
		};
		// 1. Clear cache
		Object.keys(require.cache).forEach((key) => {
			if (key.includes("/src/")) {
				delete require.cache[key];
			}
		});

		// 2. Set up mock auth
		mock.module("../src/middleware/auth", () => ({
			requireAuth: mockAuthWithSession,
		}));

		// 3. THEN import the app
		const { app: appModule } = await import("../src/app");
		app = testClient(appModule);
	});

	it("should prevent clearing metrics", async () => {
		const path = app.v1.metrics;
		const res = await path.$post({ json: { action: "clear" } });
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body).toHaveProperty("error");
		expect(body).toHaveProperty("message");
		expect(body).toHaveProperty("requestId");
	});
});
