import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import type { Server } from "bun";
import type { Context, Next } from "hono";

async function setupAppForProvider(
	provider: "azure" | "s3",
	authType: "auth" | "unauth",
) {
	// Clear module cache - Bun equivalent of vi.resetModules()
	delete require.cache[require.resolve("../src/app.js")];
	delete require.cache[require.resolve("../src/middleware/auth.js")];

	// Set environment first
	process.env = {
		NODE_ENV: "test",
		STORAGE_PROVIDER: provider,
		BASE_URL: "http://localhost:3000",
		PORT: "3000",
		LOG_LEVEL: "debug",
		AZURE_CLIENT_SECRET: "client-secret-here",
		AZURE_TENANT_ID: "your-tenant-id-here",
		AZURE_CLIENT_ID: "your-client-id-here",
		AZURITE_CONNECTION_STRING:
			"DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;",
		AZURITE_CONTAINER_NAME: "devstoreaccount1",
		AWS_ACCESS_KEY_ID: "your-aws-access-key-id-here",
		AWS_SECRET_ACCESS_KEY: "your-aws-secret-access-key-here",
		AWS_REGION: "your-aws-region-here",
		AWS_S3_BUCKET: "your-s3-bucket-name-here",
		SESSION_SECRET: "session-secret",
	};

	// Setup auth mocking using Bun's mock system
	const mockCca = {
		getAuthCodeUrl: mock().mockResolvedValue("https://mock-url"),
		acquireTokenByCode: mock().mockResolvedValue({
			account: {
				homeAccountId: "mock-id",
				username: "mock@example.com",
				name: "Mock User",
				tenantId: "mock-tenant",
			},
		}),
	};

	// Mock the auth module
	mock.module("../src/middleware/auth.js", () => ({
		getCCA: () => mockCca,
		requireAuth: (c: Context, next: Next) => {
			if (authType === "auth") {
				c.set("user", {
					id: "mock-id",
					email: "mock@example.com",
					name: "Mock User",
				});
			}
			return next();
		},
	}));

	const { default: app } = await import("../src/app.js");

	const server = Bun.serve({
		port: 3000,
		fetch: app.fetch,
	});

	return server;
}

describe.each(["azure", "s3"])("%s storage provider", (provider) => {
	describe.each(["unauth", "auth"])("as %s user", (authType) => {
		let server: Server;

		beforeAll(async () => {
			server = await setupAppForProvider(
				provider as "azure" | "s3",
				authType as "auth" | "unauth",
			);
		});

		afterAll(() => {
			server?.stop();
		});

		it("should return app status at /", async () => {
			const res = await fetch(`http://localhost:${server.port}/`);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toHaveProperty("name");
			expect(body).toHaveProperty("status", "running");
		});

		it("should serve Swagger UI", async () => {
			const res = await fetch(`http://localhost:${server.port}/api/`);
			expect(res.status).toBe(200);
			const text = await res.text();
			expect(text).toContain("Swagger UI");
		});

		describe("Proxy Server", () => {
			it("should return 404 for unknown routes", async () => {
				const res = await fetch(`http://localhost:${server.port}/nonexistent`);
				expect(res.status).toBe(404);
				const body = await res.json();
				expect(body.error).toBe("Not Found");
			});

			it("should serve Swagger UI at /api/", async () => {
				const res = await fetch(`http://localhost:${server.port}/api/`);
				expect(res.status).toBe(200);
				const text = await res.text();
				expect(text).toContain("Swagger UI");
			});

			it("should return app status at /", async () => {
				const res = await fetch(`http://localhost:${server.port}/`);
				expect(res.status).toBe(200);
				const body = await res.json();
				expect(body).toHaveProperty("name", "Azure Blob Storage Proxy");
				expect(body).toHaveProperty("status", "running");
				expect(body).toHaveProperty("endpoints");
				expect(body).toHaveProperty("requestId");
			});

			it("should return health status at /health", async () => {
				const res = await fetch(`http://localhost:${server.port}/health`);
				expect([200, 503]).toContain(res.status); // healthy or degraded
				const body = await res.json();
				expect(body).toHaveProperty("status");
				expect(["azure", "s3"]).toContain(body.storage.provider);
				expect(body).toHaveProperty("requestId");
			});
		});

		describe("Microsoft Entra ID Auth Routes", () => {
			it("should redirect to Microsoft login on /auth/login", async () => {
				const res = await fetch(`http://localhost:${server.port}/auth/login`, {
					redirect: "manual",
				});
				expect([302, 500]).toContain(res.status);
			});

			it("should return 400 if callback is missing code", async () => {
				const res = await fetch(
					`http://localhost:${server.port}/auth/callback`,
				);
				expect(res.status).toBe(400);
			});

			it("should redirect to Microsoft logout on /auth/logout", async () => {
				const res = await fetch(`http://localhost:${server.port}/auth/logout`, {
					redirect: "manual",
				});
				expect([302, 500]).toContain(res.status);
			});
		});

		describe("Unauthenticated user", () => {
			let unauthenticatedServer: Server;

			beforeAll(async () => {
				// Clear module cache
				delete require.cache[require.resolve("../src/app.js")];
				delete require.cache[require.resolve("../src/middleware/auth.js")];

				// Mock auth for unauthenticated state
				mock.module("../src/middleware/auth.js", () => ({
					cca: {
						getAuthCodeUrl: mock().mockResolvedValue(
							"https://login.microsoftonline.com/mock-auth-url",
						),
						acquireTokenByCode: mock().mockResolvedValue({
							account: {
								homeAccountId: "mock-home-id",
								username: "mockuser@example.com",
								name: "Mock User",
								tenantId: "mock-tenant-id",
							},
						}),
					},
				}));

				const { default: app } = await import("../src/app.js");
				unauthenticatedServer = Bun.serve({
					port: 0,
					fetch: app.fetch,
				});
			});

			afterAll(() => {
				unauthenticatedServer?.stop();
			});

			describe("File endpoints", () => {
				it("should require authentication for file download", async () => {
					const res = await fetch(
						`http://localhost:${unauthenticatedServer.port}/v1/files/download/test-container/sastestblob.txt`,
					);
					expect([401, 403]).toContain(res.status);
				});

				it("should require authentication for file view", async () => {
					const res = await fetch(
						`http://localhost:${unauthenticatedServer.port}/v1/files/test-container/sastestblob.txt`,
					);
					expect([401, 403]).toContain(res.status);
				});

				it("should require authentication to list containers and blobs", async () => {
					const res = await fetch(
						`http://localhost:${unauthenticatedServer.port}/v1/files/list`,
					);
					expect([401, 403]).toContain(res.status);
				});
			});

			describe("Metrics endpoints", () => {
				it("should require authentication for top-files endpoint", async () => {
					const res = await fetch(
						`http://localhost:${unauthenticatedServer.port}/v1/metrics/top-files`,
					);
					expect([401, 403]).toContain(res.status);
				});

				it("should require authentication for containers endpoint", async () => {
					const res = await fetch(
						`http://localhost:${unauthenticatedServer.port}/v1/metrics/containers`,
					);
					expect([401, 403]).toContain(res.status);
				});

				it("should require authentication for summary endpoint", async () => {
					const res = await fetch(
						`http://localhost:${unauthenticatedServer.port}/v1/metrics/summary`,
					);
					expect([401, 403]).toContain(res.status);
				});

				it("should require authentication for range endpoint", async () => {
					const res = await fetch(
						`http://localhost:${unauthenticatedServer.port}/v1/metrics/range?startDate=2025-06-18`,
					);
					expect([401, 403]).toContain(res.status);
				});

				it("should require authentication for container top-files endpoint", async () => {
					const res = await fetch(
						`http://localhost:${unauthenticatedServer.port}/v1/metrics/test-container/top-files`,
					);
					expect([401, 403]).toContain(res.status);
				});

				it("should require authentication for container files endpoints", async () => {
					const res = await fetch(
						`http://localhost:${unauthenticatedServer.port}/v1/metrics/test-container/files`,
					);
					expect([401, 403]).toContain(res.status);
				});

				it("should require authentication for container range endpoint", async () => {
					const res = await fetch(
						`http://localhost:${unauthenticatedServer.port}/v1/metrics/test-container/range?startDate=2025-06-18`,
					);
					expect([401, 403]).toContain(res.status);
				});

				it("should require authentication for container endpoint", async () => {
					const res = await fetch(
						`http://localhost:${unauthenticatedServer.port}/v1/metrics/test-container`,
					);
					expect([401, 403]).toContain(res.status);
				});

				it("should require authentication for export endpoint", async () => {
					const res = await fetch(
						`http://localhost:${unauthenticatedServer.port}/v1/metrics/test-container/export`,
					);
					expect([401, 403]).toContain(res.status);
				});

				it("should require authentication for clear endpoint", async () => {
					const res = await fetch(
						`http://localhost:${unauthenticatedServer.port}/v1/metrics/clear`,
						{ method: "POST" },
					);
					expect([401, 403]).toContain(res.status);
				});

				it("should require authentication for persist endpoint", async () => {
					const res = await fetch(
						`http://localhost:${unauthenticatedServer.port}/v1/metrics/persist`,
						{ method: "POST" },
					);
					expect([401, 403]).toContain(res.status);
				});
			});
		});

		describe("Authenticated user", () => {
			let authenticatedServer: Server;

			beforeAll(async () => {
				// Clear module cache
				delete require.cache[require.resolve("../src/app.js")];
				delete require.cache[require.resolve("../src/middleware/auth.js")];

				// Mock auth for authenticated state
				mock.module("../src/middleware/auth.js", () => ({
					cca: {
						getAuthCodeUrl: mock().mockResolvedValue(
							"https://login.microsoftonline.com/mock-auth-url",
						),
						acquireTokenByCode: mock().mockResolvedValue({
							account: {
								homeAccountId: "mock-home-id",
								username: "mockuser@example.com",
								name: "Mock User",
								tenantId: "mock-tenant-id",
							},
						}),
					},
					// Simulate authenticated user
					requireAuth: (c: Context, next: Next) => {
						c.set("user", {
							id: "mock-home-id",
							email: "mockuser@example.com",
							name: "Mock User",
						});
						return next();
					},
				}));

				const { default: app } = await import("../src/app.js");
				authenticatedServer = Bun.serve({
					port: 0,
					fetch: app.fetch,
				});
			});

			afterAll(() => {
				authenticatedServer?.stop();
			});

			describe("File endpoints", () => {
				it("should allow access to file view when authenticated", async () => {
					const res = await fetch(
						`http://localhost:${authenticatedServer.port}/v1/files/test-container/sastestblob.txt`,
					);
					expect(res.status).toBe(200);
					const text = await res.text();
					expect(text).toContain("Hello from");
				});

				it("should allow access to file download when authenticated", async () => {
					const res = await fetch(
						`http://localhost:${authenticatedServer.port}/v1/files/download/test-container/sastestblob.txt`,
					);
					expect(res.status).toBe(200);
					const body = await res.arrayBuffer();
					expect(new TextDecoder().decode(body)).toContain("Hello from");
				});

				it("should allow access to list containers and blobs", async () => {
					const res = await fetch(
						`http://localhost:${authenticatedServer.port}/v1/files/list`,
					);
					expect(res.status).toBe(200);
					const body = await res.json();
					expect(body).toHaveProperty("success", true);
					expect(body).toHaveProperty("containers");
					expect(Array.isArray(body.containers)).toBe(true);
					expect(body.containers).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								name: expect.any(String),
								blobs: expect.any(Array),
							}),
						]),
					);
					expect(body).toHaveProperty("requestId");
				});
			});

			describe("Metrics endpoints", () => {
				it("should allow access to top-files endpoint", async () => {
					const res = await fetch(
						`http://localhost:${authenticatedServer.port}/v1/metrics/top-files`,
					);
					expect(res.status).toBe(200);
					const body = await res.json();
					expect(body).toHaveProperty("success");
					expect(body).toHaveProperty("data");
					expect(body.data).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								blob: expect.any(String),
								container: expect.any(String),
								firstAccessed: expect.any(String),
								lastAccessed: expect.any(String),
								path: expect.any(String),
								recentUsers: expect.any(Array),
								recentUsersCount: expect.any(Number),
								totalAccesses: expect.any(Number),
							}),
						]),
					);
					expect(body).toHaveProperty("limit");
					expect(body).toHaveProperty("requestId");
				});

				it("should allow access to containers endpoint", async () => {
					const res = await fetch(
						`http://localhost:${authenticatedServer.port}/v1/metrics/containers`,
					);
					expect(res.status).toBe(200);
					const body = await res.json();
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
				});

				it("should allow access to summary endpoint", async () => {
					const res = await fetch(
						`http://localhost:${authenticatedServer.port}/v1/metrics/summary`,
					);
					expect(res.status).toBe(200);
					const body = await res.json();
					expect(body).toHaveProperty("success");
					expect(body).toHaveProperty("data");
					expect(body.data).toEqual(
						expect.objectContaining({
							totalFiles: expect.any(Number),
							totalAccesses: expect.any(Number),
							uniqueUsers: expect.any(Number),
							uniqueContainers: expect.any(Number),
							averageAccessesPerFile: expect.any(Number),
						}),
					);
					expect(body).toHaveProperty("requestId");
				});

				it("should allow access to range endpoint", async () => {
					const res = await fetch(
						`http://localhost:${authenticatedServer.port}/v1/metrics/range?startDate=2025-06-18`,
					);
					expect(res.status).toBe(200);
					const body = await res.json();
					expect(body).toHaveProperty("success");
					expect(body).toHaveProperty("data");
					expect(body.data).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								path: expect.any(String),
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
				});

				it("should allow access to container top-files endpoint", async () => {
					const res = await fetch(
						`http://localhost:${authenticatedServer.port}/v1/metrics/test-container/top-files`,
					);
					expect(res.status).toBe(200);
					const body = await res.json();
					expect(body).toHaveProperty("success");
					expect(body).toHaveProperty("data");
					expect(body.data).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								blob: expect.any(String),
								container: expect.any(String),
								firstAccessed: expect.any(String),
								lastAccessed: expect.any(String),
								path: expect.any(String),
								recentUsers: expect.any(Array),
								recentUsersCount: expect.any(Number),
								totalAccesses: expect.any(Number),
							}),
						]),
					);
					expect(body).toHaveProperty("requestId");
				});

				it("should allow access to container files endpoint", async () => {
					const res = await fetch(
						`http://localhost:${authenticatedServer.port}/v1/metrics/test-container/files`,
					);
					expect(res.status).toBe(200);
					const body = await res.json();
					expect(body).toHaveProperty("success");
					expect(body).toHaveProperty("data");
					expect(body.data).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								path: expect.any(String),
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
				});

				it("should allow access to container range endpoint", async () => {
					const res = await fetch(
						`http://localhost:${authenticatedServer.port}/v1/metrics/test-container/range?startDate=2025-06-18`,
					);
					expect(res.status).toBe(200);
					const body = await res.json();
					expect(body).toHaveProperty("success");
					expect(body).toHaveProperty("data");
					expect(body.data).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								path: expect.any(String),
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
				});

				it("should allow access to container endpoint", async () => {
					const res = await fetch(
						`http://localhost:${authenticatedServer.port}/v1/metrics/test-container`,
					);
					expect(res.status).toBe(200);
					const body = await res.json();
					expect(body).toHaveProperty("success");
					expect(body).toHaveProperty("data");
					expect(body.data).toEqual(
						expect.objectContaining({
							totalFiles: expect.any(Number),
							totalAccesses: expect.any(Number),
							uniqueUsers: expect.any(Number),
							uniqueContainers: expect.any(Number),
							averageAccessesPerFile: expect.any(Number),
						}),
					);
					expect(body).toHaveProperty("requestId");
				});

				it("should allow access to metrics export endpoint", async () => {
					const res = await fetch(
						`http://localhost:${authenticatedServer.port}/v1/metrics/test-container/export`,
					);
					expect(res.status).toBe(200);
					const body = await res.json();
					expect(body).toHaveProperty("exportedAt");
					expect(body).toHaveProperty("exportedBy");
					expect(body).toHaveProperty("metrics");
					expect(body.metrics).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								path: expect.any(String),
								container: expect.any(String),
								blob: expect.any(String),
								totalAccesses: expect.any(Number),
								firstAccessed: expect.any(String),
								lastAccessed: expect.any(String),
								recentUsersCount: expect.any(Number),
							}),
						]),
					);
				});

				describe("Metrics actions", () => {
					afterEach(() => {
						process.env.NODE_ENV = "test";
					});

					it("should prevent clearing metrics in production", async () => {
						process.env.NODE_ENV = "production";
						const res = await fetch(
							`http://localhost:${authenticatedServer.port}/v1/metrics?action=clear`,
							{ method: "POST" },
						);
						expect(res.status).toBe(403);
						const body = await res.json();
						expect(body).toHaveProperty("error", "Forbidden");
						expect(body).toHaveProperty("message", "Not allowed in production");
						expect(body).toHaveProperty("requestId");
					});

					it("should allow clearing metrics in test environment", async () => {
						process.env.NODE_ENV = "test";
						const res = await fetch(
							`http://localhost:${authenticatedServer.port}/v1/metrics?action=clear`,
							{ method: "POST" },
						);
						expect(res.status).toBe(200);
						const body = await res.json();
						expect(body).toHaveProperty("success", true);
						expect(body).toHaveProperty("message", "Metrics cleared");
						expect(body).toHaveProperty("requestId");
					});

					it("should persist metrics in test environment", async () => {
						process.env.NODE_ENV = "test";
						const res = await fetch(
							`http://localhost:${authenticatedServer.port}/v1/metrics?action=persist`,
							{ method: "POST" },
						);
						expect(res.status).toBe(200);
						const body = await res.json();
						expect(body).toHaveProperty("success", true);
						expect(body).toHaveProperty("message", "Metrics persisted");
						expect(body).toHaveProperty("requestId");
					});

					it("should persist metrics in production environment", async () => {
						process.env.NODE_ENV = "production";
						const res = await fetch(
							`http://localhost:${authenticatedServer.port}/v1/metrics?action=persist`,
							{ method: "POST" },
						);
						expect(res.status).toBe(200);
						const body = await res.json();
						expect(body).toHaveProperty("success", true);
						expect(body).toHaveProperty("message", "Metrics persisted");
						expect(body).toHaveProperty("requestId");
					});
				});
			});
		});
	});
});
