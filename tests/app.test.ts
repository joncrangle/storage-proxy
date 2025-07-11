import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { testClient } from "hono/testing";

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

const runAuthTests = (label: string, auth: boolean) => {
	describe(label, () => {
		let app: any;

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
			getPath: (app: any) => any;
			param?: any;
			query?: any;
			expectBody: (body: any) => void;
			expectedType?: "json" | "text";
		}[] = [
			{
				desc: "/v1/files/download/test-container/sastestblob.txt",
				getPath: (app) => app.v1.files.download[":container"][":file"],
				param: { container: "test-container", file: "sastestblob.txt" },
				expectedType: "text",
				expectBody: (body: string): void => {
					expect(typeof body).toBe("string");
					expect(body).toContain("Hello from");
				},
			},
			{
				desc: "/v1/files/test-container/sastestblob.txt",
				getPath: (app) => app.v1.files[":container"][":file"],
				param: { container: "test-container", file: "sastestblob.txt" },
				expectedType: "text",
				expectBody: (body: string): void => {
					expect(typeof body).toBe("string");
					expect(body).toContain("Hello from");
				},
			},
			{
				desc: "/v1/files/list",
				getPath: (app) => app.v1.files.list,
				expectedType: "json",
				expectBody: (body): void => {
					expect(body).toHaveProperty("success", true);
					expect(Array.isArray(body.containers)).toBe(true);
				},
			},
		];

		tests.forEach(
			({ desc, getPath, param, query, expectBody, expectedType }) => {
				it(`${auth ? "allows" : "requires authentication for"} ${desc}`, async () => {
					const path = getPath(app);
					const res = await path.$get({ param, query });

					if (auth) {
						expect(res.status).toBe(200);
						const body =
							expectedType === "json" ? await res.json() : await res.text();
						expectBody(body);
					} else {
						expect(res.status).toBe(401);
					}
				});
			},
		);
	});
};

describe.each(["azure", "s3"])("%s storage provider:", (provider) => {
	let app: any;

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

	runAuthTests("without auth", false);
	runAuthTests("with auth", true);
});

// 	// Clear module cache
// 	delete require.cache[require.resolve("../src/app")];
// 	delete require.cache[require.resolve("../src/middleware/auth")];
//
// 		describe("Metrics endpoints", () => {
// 			it(`should ${authType === "auth" ? "allow" : "require authentication for"} top-files endpoint`, async () => {
// 				const res = await client.get("/v1/metrics/top-files");
//
// 				if (authType === "auth") {
// 					expect(res.status).toBe(200);
// 					const body = await res.json();
// 					expect(body).toHaveProperty("success");
// 					expect(body).toHaveProperty("data");
// 					expect(body.data).toEqual(
// 						expect.arrayContaining([
// 							expect.objectContaining({
// 								blob: expect.any(String),
// 								container: expect.any(String),
// 								firstAccessed: expect.any(String),
// 								lastAccessed: expect.any(String),
// 								path: expect.any(String),
// 								recentUsers: expect.any(Array),
// 								recentUsersCount: expect.any(Number),
// 								totalAccesses: expect.any(Number),
// 							}),
// 						]),
// 					);
// 					expect(body).toHaveProperty("limit");
// 					expect(body).toHaveProperty("requestId");
// 				} else {
// 					expect([401, 403]).toContain(res.status);
// 				}
// 			});
//
// 			it(`should ${authType === "auth" ? "allow" : "require authentication for"} containers endpoint`, async () => {
// 				const res = await client.get("/v1/metrics/containers");
//
// 				if (authType === "auth") {
// 					expect(res.status).toBe(200);
// 					const body = await res.json();
// 					expect(body).toHaveProperty("success");
// 					expect(body).toHaveProperty("data");
// 					expect(body.data).toEqual(
// 						expect.arrayContaining([
// 							expect.objectContaining({
// 								container: expect.any(String),
// 								totalAccesses: expect.any(Number),
// 								uniqueFiles: expect.any(Number),
// 								uniqueUsers: expect.any(Number),
// 							}),
// 						]),
// 					);
// 					expect(body).toHaveProperty("requestId");
// 				} else {
// 					expect([401, 403]).toContain(res.status);
// 				}
// 			});
//
// 			it(`should ${authType === "auth" ? "allow" : "require authentication for"} summary endpoint`, async () => {
// 				const res = await client.get("/v1/metrics/summary");
//
// 				if (authType === "auth") {
// 					expect(res.status).toBe(200);
// 					const body = await res.json();
// 					expect(body).toHaveProperty("success");
// 					expect(body).toHaveProperty("data");
// 					expect(body.data).toEqual(
// 						expect.objectContaining({
// 							totalFiles: expect.any(Number),
// 							totalAccesses: expect.any(Number),
// 							uniqueUsers: expect.any(Number),
// 							uniqueContainers: expect.any(Number),
// 							averageAccessesPerFile: expect.any(Number),
// 						}),
// 					);
// 					expect(body).toHaveProperty("requestId");
// 				} else {
// 					expect([401, 403]).toContain(res.status);
// 				}
// 			});
//
// 			it(`should ${authType === "auth" ? "allow" : "require authentication for"} range endpoint`, async () => {
// 				const res = await client.get("/v1/metrics/range?startDate=2025-06-18");
//
// 				if (authType === "auth") {
// 					expect(res.status).toBe(200);
// 					const body = await res.json();
// 					expect(body).toHaveProperty("success");
// 					expect(body).toHaveProperty("data");
// 					expect(body.data).toEqual(
// 						expect.arrayContaining([
// 							expect.objectContaining({
// 								path: expect.any(String),
// 								container: expect.any(String),
// 								blob: expect.any(String),
// 								totalAccesses: expect.any(Number),
// 								firstAccessed: expect.any(String),
// 								lastAccessed: expect.any(String),
// 								recentUsersCount: expect.any(Number),
// 							}),
// 						]),
// 					);
// 					expect(body).toHaveProperty("requestId");
// 				} else {
// 					expect([401, 403]).toContain(res.status);
// 				}
// 			});
//
// 			it(`should ${authType === "auth" ? "allow" : "require authentication for"} container top-files endpoint`, async () => {
// 				const res = await client.get("/v1/metrics/test-container/top-files");
//
// 				if (authType === "auth") {
// 					expect(res.status).toBe(200);
// 					const body = await res.json();
// 					expect(body).toHaveProperty("success");
// 					expect(body).toHaveProperty("data");
// 					expect(body.data).toEqual(
// 						expect.arrayContaining([
// 							expect.objectContaining({
// 								blob: expect.any(String),
// 								container: expect.any(String),
// 								firstAccessed: expect.any(String),
// 								lastAccessed: expect.any(String),
// 								path: expect.any(String),
// 								recentUsers: expect.any(Array),
// 								recentUsersCount: expect.any(Number),
// 								totalAccesses: expect.any(Number),
// 							}),
// 						]),
// 					);
// 					expect(body).toHaveProperty("requestId");
// 				} else {
// 					expect([401, 403]).toContain(res.status);
// 				}
// 			});
//
// 			it(`should ${authType === "auth" ? "allow" : "require authentication for"} container files endpoint`, async () => {
// 				const res = await client.get("/v1/metrics/test-container/files");
//
// 				if (authType === "auth") {
// 					expect(res.status).toBe(200);
// 					const body = await res.json();
// 					expect(body).toHaveProperty("success");
// 					expect(body).toHaveProperty("data");
// 					expect(body.data).toEqual(
// 						expect.arrayContaining([
// 							expect.objectContaining({
// 								path: expect.any(String),
// 								container: expect.any(String),
// 								blob: expect.any(String),
// 								totalAccesses: expect.any(Number),
// 								firstAccessed: expect.any(String),
// 								lastAccessed: expect.any(String),
// 								recentUsersCount: expect.any(Number),
// 							}),
// 						]),
// 					);
// 					expect(body).toHaveProperty("requestId");
// 				} else {
// 					expect([401, 403]).toContain(res.status);
// 				}
// 			});
//
// 			it(`should ${authType === "auth" ? "allow" : "require authentication for"} container range endpoint`, async () => {
// 				const res = await client.get("/v1/metrics/test-container/range?startDate=2025-06-18");
//
// 				if (authType === "auth") {
// 					expect(res.status).toBe(200);
// 					const body = await res.json();
// 					expect(body).data).toEqual(
// 						expect.arrayContaining([
// 							expect.objectContaining({
// 								path: expect.any(String),
// 								container: expect.any(String),
// 								blob: expect.any(String),
// 								totalAccesses: expect.any(Number),
// 								firstAccessed: expect.any(String),
// 								lastAccessed: expect.any(String),
// 								recentUsersCount: expect.any(Number),
// 							}),
// 						]),
// 					);
// 					expect(body).toHaveProperty("requestId");
// 				} else {
// 					expect([401, 403]).toContain(res.status);
// 				}
// 			});
//
// 			it(`should ${authType === "auth" ? "allow" : "require authentication for"} container endpoint`, async () => {
// 				const res = await client.get("/v1/metrics/test-container");
//
// 				if (authType === "auth") {
// 					expect(res.status).toBe(200);
// 					const body = await res.json();
// 					expect(body).toHaveProperty("success");
// 					expect(body).toHaveProperty("data");
// 					expect(body.data).toEqual(
// 						expect.objectContaining({
// 							totalFiles: expect.any(Number),
// 							totalAccesses: expect.any(Number),
// 							uniqueUsers: expect.any(Number),
// 							uniqueContainers: expect.any(Number),
// 							averageAccessesPerFile: expect.any(Number),
// 						}),
// 					);
// 					expect(body).toHaveProperty("requestId");
// 				} else {
// 					expect([401, 403]).toContain(res.status);
// 				}
// 			});
//
// 			it(`should ${authType === "auth" ? "allow" : "require authentication for"} export endpoint`, async () => {
// 				const res = await client.get("/v1/metrics/test-container/export");
//
// 				if (authType === "auth") {
// 					expect(res.status).toBe(200);
// 					const body = await res.json();
// 					expect(body).toHaveProperty("exportedAt");
// 					expect(body).toHaveProperty("exportedBy");
// 					expect(body).toHaveProperty("metrics");
// 					expect(body.metrics).toEqual(
// 						expect.arrayContaining([
// 							expect.objectContaining({
// 								path: expect.any(String),
// 								container: expect.any(String),
// 								blob: expect.any(String),
// 								totalAccesses: expect.any(Number),
// 								firstAccessed: expect.any(String),
// 								lastAccessed: expect.any(String),
// 								recentUsersCount: expect.any(Number),
// 							}),
// 						]),
// 					);
// 				} else {
// 					expect([401, 403]).toContain(res.status);
// 				}
// 			});
//
// 			describe("Metrics actions", () => {
// 				afterEach(() => {
// 					process.env.NODE_ENV = "test";
// 				});
//
// 				it(`should ${authType === "auth" ? (process.env.NODE_ENV === "production" ? "prevent" : "allow") : "require authentication for"} clearing metrics`, async () => {
// 					if (authType === "auth") {
// 						process.env.NODE_ENV = "production";
// 						let res = await client.request("/v1/metrics?action=clear", { method: "POST" });
// 						expect(res.status).toBe(403);
// 						let body = await res.json();
// 						expect(body).toHaveProperty("error", "Forbidden");
// 						expect(body).toHaveProperty("message", "Not allowed in production");
// 						expect(body).toHaveProperty("requestId");
//
// 						process.env.NODE_ENV = "test";
// 						res = await client.request("/v1/metrics?action=clear", { method: "POST" });
// 						expect(res.status).toBe(200);
// 						body = await res.json();
// 						expect(body).toHaveProperty("success", true);
// 						expect(body).toHaveProperty("message", "Metrics cleared");
// 						expect(body).toHaveProperty("requestId");
// 					} else {
// 						const res = await client.request("/v1/metrics?action=clear", { method: "POST" });
// 						expect([401, 403]).toContain(res.status);
// 					}
// 				});
//
// 				it(`should ${authType === "auth" ? "allow" : "require authentication for"} persisting metrics`, async () => {
// 					const res = await client.request("/v1/metrics?action=persist", { method: "POST" });
//
// 					if (authType === "auth") {
// 						expect(res.status).toBe(200);
// 						const body = await res.json();
// 						expect(body).toHaveProperty("success", true);
// 						expect(body).toHaveProperty("message", "Metrics persisted");
// 						expect(body).toHaveProperty("requestId");
// 					} else {
// 						expect([401, 403]).toContain(res.status);
// 					}
// 				});
// 			});
// 		});
// 	});
// });
