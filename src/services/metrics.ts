import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { config } from "@/config";
import { containerNameSchema } from "@/schemas";
import { logger } from "@/services/logger";

interface AccessEvent {
	container: string;
	blob: string;
	userId: string;
}

interface MetricEntry {
	container: string;
	blob: string;
	totalAccesses: number;
	firstAccessed: Date;
	lastAccessed: Date | null;
	recentUsers: Set<string>;
}

interface SerializedMetricEntry {
	container: string;
	blob: string;
	totalAccesses: number;
	firstAccessed: string;
	lastAccessed: string | null;
	recentUsers: string[];
}

interface MetricsData {
	[key: string]: SerializedMetricEntry;
}

interface AccessedFile {
	path: string;
	container: string;
	blob: string;
	storageType: string;
	totalAccesses: number;
	firstAccessed: Date;
	lastAccessed: Date | null;
	recentUsersCount: number;
	recentUsers: string[];
}

interface ContainerStats {
	container: string;
	totalAccesses: number;
	uniqueFiles: number;
	uniqueUsers: number;
}

interface MetricsByTimeRange {
	path: string;
	container: string;
	blob: string;
	totalAccesses: number;
	firstAccessed: Date;
	lastAccessed: Date | null;
	recentUsersCount: number;
}

interface ContainerMetrics {
	path: string;
	container: string;
	blob: string;
	totalAccesses: number;
	firstAccessed: Date;
	lastAccessed: Date | null;
	recentUsersCount: number;
}

interface SummaryStats {
	totalFiles: number;
	totalAccesses: number;
	uniqueUsers: number;
	uniqueContainers: number;
	averageAccessesPerFile: number;
}

const AccessEventSchema = z.object({
	container: z.string().min(1, "Container/Bucket name cannot be empty"),
	blob: z.string().min(1, "Blob/Key name cannot be empty"),
	userId: z.string().min(1, "User ID cannot be empty"),
});

const BatchAccessEventsSchema = z
	.array(AccessEventSchema)
	.min(1, "At least one access event required");

const MetricEntrySchema = z.object({
	container: z.string(),
	blob: z.string(),
	totalAccesses: z.number().int().min(0),
	firstAccessed: z.union([z.string().datetime(), z.date()]),
	lastAccessed: z.union([z.string().datetime(), z.date(), z.null()]).optional(),
	recentUsers: z.array(z.string()).default([]),
});

const MetricsDataSchema = z.record(z.string(), MetricEntrySchema);

const TimeRangeSchema = z
	.object({
		startDate: z.date(),
		endDate: z.date(),
	})
	.refine((data) => data.startDate <= data.endDate, {
		message: "Start date must be before or equal to end date",
	});

const ConstructorParamsSchema = z.object({
	storagePath: z.string().min(1, "Storage path cannot be empty"),
	retentionDays: z.number().int().min(1, "Retention days must be at least 1"),
});

/**
 * MetricsCollector is responsible for tracking and persisting access metrics for blobs/objects (Azure Blob Storage or AWS S3).
 *
 * This collector is agnostic to the storage backend. All naming, validation, and schemas are generic for both Azure and S3.
 * If backend-specific validation is needed, update containerNameSchema and related logic accordingly.
 */
class MetricsCollector {
	private storagePath: string;
	private retentionDays: number;
	private accessMetrics: Map<string, MetricEntry>;
	private cleanupInterval: NodeJS.Timeout | null;
	private persistTimeout: NodeJS.Timeout | null;
	private isShuttingDown: boolean;
	private readonly maxRecentUsers: number;
	private readonly persistIntervalMs: number;
	private readonly cleanupIntervalMs: number;

	constructor(storagePath: string, retentionDays: number) {
		// Validate constructor parameters
		const validatedParams = ConstructorParamsSchema.parse({
			storagePath,
			retentionDays,
		});

		this.storagePath = validatedParams.storagePath;
		this.retentionDays = validatedParams.retentionDays;
		this.accessMetrics = new Map<string, MetricEntry>();
		this.cleanupInterval = null;
		this.persistTimeout = null;
		this.isShuttingDown = false;
		this.maxRecentUsers = 100;
		this.persistIntervalMs = 5 * 60 * 1000; // 5 minutes
		this.cleanupIntervalMs = 24 * 60 * 60 * 1000; // 24 hours
	}

	/**
	 * Initializes the metrics storage directory and loads existing metrics.
	 */
	async initialize(): Promise<void> {
		try {
			await fs.mkdir(this.storagePath, { recursive: true });
			await this.loadLatestMetrics();

			// Start periodic cleanup
			this.cleanupInterval = setInterval(
				() => this.cleanupOldMetrics(),
				this.cleanupIntervalMs,
			);

			// Setup graceful shutdown handlers
			process.on("SIGINT", () => this.shutdown());
			process.on("SIGTERM", () => this.shutdown());

			logger.info("MetricsCollector initialized successfully.", {
				path: this.storagePath,
				retentionDays: this.retentionDays,
				metricsLoaded: this.accessMetrics.size,
			});
		} catch (error) {
			logger.error("Failed to initialize metrics storage", {
				error: (error as Error).message,
				stack: (error as Error).stack,
			});
			throw error;
		}
	}

	/**
	 * Loads the most recent metrics file from disk into memory.
	 */
	private async loadLatestMetrics(): Promise<void> {
		try {
			const files = (await fs.readdir(this.storagePath))
				.filter((file) => file.startsWith("metrics-") && file.endsWith(".json"))
				.sort()
				.reverse();

			if (files.length === 0) {
				logger.info("No existing metrics files found to load.");
				return;
			}

			const latestFile = files[0];
			const filePath = path.join(this.storagePath, latestFile);

			try {
				const data = await fs.readFile(filePath, "utf8");
				const rawMetrics = JSON.parse(data);

				// Validate the entire metrics data structure
				const validatedMetrics = MetricsDataSchema.parse(rawMetrics);

				let loadedCount = 0;
				for (const [key, value] of Object.entries(validatedMetrics)) {
					this.accessMetrics.set(key, {
						...value,
						lastAccessed: value.lastAccessed
							? new Date(value.lastAccessed)
							: null,
						firstAccessed: new Date(value.firstAccessed),
						recentUsers: new Set(value.recentUsers || []),
					});
					loadedCount++;
				}

				logger.info("Loaded latest metrics from disk", {
					file: latestFile,
					totalEntries: Object.keys(validatedMetrics).length,
					validEntries: loadedCount,
				});
			} catch (parseError) {
				if (parseError instanceof z.ZodError) {
					logger.error("Metrics file validation failed", {
						file: latestFile,
						validationErrors: parseError.errors,
					});
				} else {
					logger.error("Failed to parse metrics file", {
						file: latestFile,
						error: (parseError as Error).message,
					});
				}
				// Try to load from backup files
				await this.loadFromBackupFiles(files.slice(1));
			}
		} catch (error) {
			logger.warn("Failed to load existing metrics", {
				error: (error as Error).message,
				stack: (error as Error).stack,
			});
		}
	}

	/**
	 * Attempts to load metrics from backup files if the latest file is corrupted.
	 */
	private async loadFromBackupFiles(backupFiles: string[]): Promise<void> {
		for (const file of backupFiles.slice(0, 3)) {
			// Try up to 3 backup files
			try {
				const filePath = path.join(this.storagePath, file);
				const data = await fs.readFile(filePath, "utf8");
				const rawMetrics = JSON.parse(data);

				// Validate backup file data
				const validatedMetrics = MetricsDataSchema.parse(rawMetrics);

				// Load successful, break out of loop
				for (const [key, value] of Object.entries(validatedMetrics)) {
					this.accessMetrics.set(key, {
						...value,
						lastAccessed: value.lastAccessed
							? new Date(value.lastAccessed)
							: null,
						firstAccessed: new Date(value.firstAccessed),
						recentUsers: new Set(value.recentUsers || []),
					});
				}

				logger.info("Successfully loaded metrics from backup file", {
					file,
					count: this.accessMetrics.size,
				});
				break;
			} catch (error) {
				if (error instanceof z.ZodError) {
					logger.warn("Backup metrics file validation failed", {
						file,
						validationErrors: error.errors,
					});
				} else {
					logger.warn("Failed to load backup metrics file", {
						file,
						error: (error as Error).message,
					});
				}
			}
		}
	}

	/**
	 * Validates constructor parameters and creates the singleton instance.
	 * @param storagePath - Path to store metrics files
	 * @param retentionDays - Number of days to retain metrics files
	 * @returns The validated metrics collector instance
	 */
	static createInstance(
		storagePath: string,
		retentionDays: number,
	): MetricsCollector {
		try {
			const validatedParams = ConstructorParamsSchema.parse({
				storagePath,
				retentionDays,
			});
			return new MetricsCollector(
				validatedParams.storagePath,
				validatedParams.retentionDays,
			);
		} catch (error) {
			if (error instanceof z.ZodError) {
				logger.error("Invalid MetricsCollector configuration", {
					validationErrors: error.errors,
					providedConfig: { storagePath, retentionDays },
				});
				throw new Error(
					`Invalid configuration: ${error.errors.map((e) => e.message).join(", ")}`,
				);
			}
			throw error;
		}
	}

	/**
	 * Validates input parameters for the getTopAccessedFiles method.
	 */
	private static validateLimit(limit: number = 10): number {
		const LimitSchema = z.number().int().min(1).max(1000).default(10);
		try {
			return LimitSchema.parse(limit);
		} catch (error) {
			if (error instanceof z.ZodError) {
				logger.warn("Invalid limit parameter, using default", {
					providedLimit: limit,
					validationErrors: error.errors,
				});
				return 10; // Return default
			}
			throw error;
		}
	}

	/**
	 * Records an access event for a blob/object.
	 */
	recordAccess(container: string, blob: string, userId: string): void {
		try {
			// Validate input parameters using Zod
			const validatedAccess = AccessEventSchema.parse({
				container,
				blob,
				userId,
			});

			if (this.isShuttingDown) {
				logger.debug("Ignoring access record during shutdown");
				return;
			}

			const key = `${validatedAccess.container}/${validatedAccess.blob}`;
			const now = new Date();

			const metric = this.accessMetrics.get(key) || {
				container: validatedAccess.container,
				blob: validatedAccess.blob,
				totalAccesses: 0,
				firstAccessed: now,
				lastAccessed: null,
				recentUsers: new Set<string>(),
			};

			metric.totalAccesses++;
			metric.lastAccessed = now;
			metric.recentUsers.add(validatedAccess.userId);

			// Prevent memory leaks by limiting recent users
			if (metric.recentUsers.size > this.maxRecentUsers) {
				const usersArray = Array.from(metric.recentUsers);
				metric.recentUsers = new Set(
					usersArray.slice(-Math.floor(this.maxRecentUsers * 0.7)),
				);
			}

			this.accessMetrics.set(key, metric);

			// Debounce persistence to avoid excessive writes
			this.schedulePersistence();
		} catch (error) {
			if (error instanceof z.ZodError) {
				logger.warn("Invalid access record parameters", {
					validationErrors: error.errors,
					providedData: { container, blob, userId },
				});
			} else {
				logger.error("Unexpected error recording access", {
					error: (error as Error).message,
					stack: (error as Error).stack,
				});
			}
		}
	}

	/**
	 * Records multiple access events in batch.
	 */
	recordBatchAccess(accessEvents: AccessEvent[]): void {
		try {
			// Validate the entire batch using Zod
			const validatedEvents = BatchAccessEventsSchema.parse(accessEvents);

			let successCount = 0;
			for (const event of validatedEvents) {
				try {
					this.recordAccess(event.container, event.blob, event.userId);
					successCount++;
				} catch (error) {
					logger.warn("Failed to record individual access in batch", {
						event,
						error: (error as Error).message,
					});
				}
			}

			if (successCount > 0) {
				logger.debug("Batch access recorded", {
					requested: validatedEvents.length,
					successful: successCount,
				});
			}
		} catch (error) {
			if (error instanceof z.ZodError) {
				logger.warn("Invalid batch access events", {
					validationErrors: error.errors,
					providedData: accessEvents,
				});
			} else {
				logger.error("Unexpected error in batch access recording", {
					error: (error as Error).message,
					stack: (error as Error).stack,
				});
			}
		}
	}

	/**
	 * Schedules metrics persistence with debouncing.
	 */
	private schedulePersistence(): void {
		if (this.persistTimeout) {
			clearTimeout(this.persistTimeout);
		}

		this.persistTimeout = setTimeout(
			() => this.persistMetrics(),
			this.persistIntervalMs,
		);
	}

	/**
	 * Returns all tracked files/objects, optionally filtered by container/bucket.
	 * Unlike getTopAccessedFiles, this doesn't sort by access count.
	 */
	getAllFiles(container?: string): AccessedFile[] {
		let entries = Array.from(this.accessMetrics.entries());

		if (container) {
			const validatedContainer = z
				.string()
				.min(1, "Container name cannot be empty")
				.parse(container);

			entries = entries.filter(
				([, value]) => value.container === validatedContainer,
			);
		}

		return entries.map(([key, value]) => ({
			path: key,
			container: value.container,
			blob: value.blob,
			storageType: config.STORAGE_PROVIDER,
			totalAccesses: value.totalAccesses,
			firstAccessed: value.firstAccessed,
			lastAccessed: value.lastAccessed,
			recentUsersCount: value.recentUsers.size,
			recentUsers: Array.from(value.recentUsers),
		}));
	}

	/**
	 * Returns the top accessed files/objects, optionally filtered by container/bucket.
	 */
	getTopAccessedFiles(limit: number = 10, container?: string): AccessedFile[] {
		const validatedLimit = MetricsCollector.validateLimit(limit);

		let entries = Array.from(this.accessMetrics.entries());

		if (container) {
			const validatedContainer = z
				.string()
				.min(1, "Container name cannot be empty")
				.parse(container);

			entries = entries.filter(
				([, value]) => value.container === validatedContainer,
			);
		}

		return entries
			.sort(([, a], [, b]) => b.totalAccesses - a.totalAccesses)
			.slice(0, validatedLimit)
			.map(([key, value]) => ({
				path: key,
				container: value.container,
				blob: value.blob,
				storageType: config.STORAGE_PROVIDER,
				totalAccesses: value.totalAccesses,
				firstAccessed: value.firstAccessed,
				lastAccessed: value.lastAccessed,
				recentUsersCount: value.recentUsers.size,
				recentUsers: Array.from(value.recentUsers),
			}));
	}

	/**
	 * Returns statistics for each container/bucket (total accesses, unique files/objects).
	 */
	getContainerStats(): ContainerStats[] {
		const containerStats = new Map<
			string,
			{
				container: string;
				totalAccesses: number;
				uniqueFiles: Set<string>;
				allUsers: Set<string>;
			}
		>();

		for (const [, value] of this.accessMetrics.entries()) {
			const container = value.container;
			const existingStats = containerStats.get(container);
			if (existingStats) {
				existingStats.totalAccesses += value.totalAccesses;
				existingStats.uniqueFiles.add(value.blob);
				existingStats.allUsers = new Set([
					...existingStats.allUsers,
					...value.recentUsers,
				]);
			} else {
				containerStats.set(container, {
					container,
					totalAccesses: value.totalAccesses,
					uniqueFiles: new Set([value.blob]),
					allUsers: new Set(value.recentUsers),
				});
			}
		}

		return Array.from(containerStats.entries()).map(([container, stats]) => ({
			container,
			totalAccesses: stats.totalAccesses,
			uniqueFiles: stats.uniqueFiles.size,
			uniqueUsers: stats.allUsers.size,
		}));
	}

	/**
	 * Gets metrics filtered by time range and optional container/bucket.
	 */
	getMetricsByTimeRange(
		startDate: Date,
		endDate: Date = new Date(),
		container?: string,
	): MetricsByTimeRange[] {
		try {
			// Normalize inputs
			const parsedStart = new Date(startDate);
			const parsedEnd = new Date(endDate);

			// Validate date range
			const validatedRange = TimeRangeSchema.parse({
				startDate: parsedStart,
				endDate: parsedEnd,
			});

			const inclusiveEnd = new Date(validatedRange.endDate);
			inclusiveEnd.setUTCHours(23, 59, 59, 999);

			// Optional container validation
			const validatedContainer = container
				? containerNameSchema.parse(container)
				: null;

			return Array.from(this.accessMetrics.entries())
				.filter(([, value]) => {
					const inRange =
						value.lastAccessed &&
						value.lastAccessed >= validatedRange.startDate &&
						value.lastAccessed <= inclusiveEnd;

					const matchesContainer = validatedContainer
						? value.container === validatedContainer
						: true;

					return inRange && matchesContainer;
				})
				.map(([key, value]) => ({
					path: key,
					container: value.container,
					blob: value.blob,
					totalAccesses: value.totalAccesses,
					firstAccessed: value.firstAccessed,
					lastAccessed: value.lastAccessed,
					recentUsersCount: value.recentUsers.size,
				}));
		} catch (error) {
			if (error instanceof z.ZodError) {
				logger.warn("Invalid range or container filter parameters", {
					validationErrors: error.errors,
					providedData: { startDate, endDate, container },
				});
				throw new Error(
					`Invalid parameters: ${error.errors.map((e) => e.message).join(", ")}`,
				);
			}
			throw error;
		}
	}

	/**
	 * Gets metrics for a specific container/bucket.
	 */
	getContainerMetrics(containerName: string): ContainerMetrics[] {
		try {
			// Validate container name
			const validatedContainer = z
				.string()
				.min(1, "Container name cannot be empty")
				.parse(containerName);

			return Array.from(this.accessMetrics.entries())
				.filter(([, value]) => value.container === validatedContainer)
				.map(([key, value]) => ({
					path: key,
					container: value.container,
					blob: value.blob,
					totalAccesses: value.totalAccesses,
					firstAccessed: value.firstAccessed,
					lastAccessed: value.lastAccessed,
					recentUsersCount: value.recentUsers.size,
				}));
		} catch (error) {
			if (error instanceof z.ZodError) {
				logger.warn("Invalid container name", {
					validationErrors: error.errors,
					providedData: { containerName },
				});
				throw new Error(
					`Invalid container name: ${error.errors.map((e) => e.message).join(", ")}`,
				);
			}
			throw error;
		}
	}

	/**
	 * Persists current metrics to disk as a JSON file.
	 */
	private async persistMetrics(): Promise<void> {
		if (this.accessMetrics.size === 0) {
			logger.debug("No metrics to persist");
			return;
		}

		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const filename = `metrics-${timestamp}.json`;
		const filePath = path.join(this.storagePath, filename);
		const tempPath = `${filePath}.tmp`;

		try {
			const metricsData: MetricsData = {};
			for (const [key, value] of this.accessMetrics.entries()) {
				metricsData[key] = {
					container: value.container,
					blob: value.blob,
					totalAccesses: value.totalAccesses,
					firstAccessed: value.firstAccessed.toISOString(),
					lastAccessed: value.lastAccessed?.toISOString() || null,
					recentUsers: Array.from(value.recentUsers),
				};
			}

			// Validate the data structure before persisting
			const validatedData = MetricsDataSchema.parse(metricsData);

			// Write to temp file first, then rename (atomic operation)
			await fs.writeFile(tempPath, JSON.stringify(validatedData, null, 2));
			await fs.rename(tempPath, filePath);

			logger.debug("Metrics persisted to disk", {
				filename,
				entriesCount: Object.keys(validatedData).length,
			});

			// Clear the timeout since we just persisted
			if (this.persistTimeout) {
				clearTimeout(this.persistTimeout);
				this.persistTimeout = null;
			}
		} catch (error) {
			// Cleanup temp file if it exists
			try {
				await fs.unlink(tempPath);
			} catch (cleanupError) {
				logger.warn("Failed to cleanup temp file after persist error", {
					tempFile: tempPath,
					cleanupError: (cleanupError as Error).message,
				});
			}

			if (error instanceof z.ZodError) {
				logger.error("Metrics data validation failed during persistence", {
					validationErrors: error.errors,
					filename,
				});
			} else {
				logger.error("Failed to persist metrics", {
					error: (error as Error).message,
					stack: (error as Error).stack,
					filename,
				});
			}
			throw error;
		}
	}

	/**
	 * Cleans up old metrics files based on retention policy.
	 */
	private async cleanupOldMetrics(): Promise<void> {
		try {
			const files = await fs.readdir(this.storagePath);
			const cutoffDate = new Date(
				Date.now() - this.retentionDays * 24 * 60 * 60 * 1000,
			);
			let deletedCount = 0;

			for (const file of files) {
				if (file.startsWith("metrics-") && file.endsWith(".json")) {
					const filePath = path.join(this.storagePath, file);
					try {
						const stats = await fs.stat(filePath);
						if (stats.mtime < cutoffDate) {
							await fs.unlink(filePath);
							deletedCount++;
							logger.debug("Deleted old metrics file", { file });
						}
					} catch (statError) {
						logger.warn("Failed to check file stats during cleanup", {
							file,
							error: (statError as Error).message,
						});
					}
				}
			}

			if (deletedCount > 0) {
				logger.info("Cleaned up old metrics files", {
					deletedCount,
					retentionDays: this.retentionDays,
				});
			}
		} catch (error) {
			logger.error("Failed to cleanup old metrics", {
				error: (error as Error).message,
				stack: (error as Error).stack,
			});
		}
	}

	/**
	 * Gets summary statistics about the metrics.
	 * If a container/bucket name is provided, filters stats to that container/bucket.
	 */
	getSummaryStats(containerName?: string): SummaryStats {
		let entries = Array.from(this.accessMetrics.values());

		if (containerName) {
			try {
				const validated = z.string().min(1).parse(containerName);
				entries = entries.filter((entry) => entry.container === validated);
			} catch (error) {
				if (error instanceof z.ZodError) {
					logger.warn("Invalid container name passed to getSummaryStats", {
						validationErrors: error.errors,
						providedContainer: containerName,
					});
					throw new Error(
						`Invalid container name: ${error.errors.map((e) => e.message).join(", ")}`,
					);
				}
				throw error;
			}
		}

		const totalFiles = entries.length;
		const totalAccesses = entries.reduce(
			(sum, metric) => sum + metric.totalAccesses,
			0,
		);

		const allUsers = new Set<string>();
		const containers = new Set<string>();

		for (const metric of entries) {
			containers.add(metric.container);
			for (const user of metric.recentUsers) {
				allUsers.add(user);
			}
		}

		return {
			totalFiles,
			totalAccesses,
			uniqueUsers: allUsers.size,
			uniqueContainers: containers.size,
			averageAccessesPerFile:
				totalFiles > 0
					? Math.round((totalAccesses / totalFiles) * 100) / 100
					: 0,
		};
	}

	/**
	 * Gracefully shuts down the metrics collector.
	 */
	async shutdown(): Promise<void> {
		if (this.isShuttingDown) {
			return;
		}

		this.isShuttingDown = true;
		logger.info("MetricsCollector shutting down...");

		try {
			// Clear intervals
			if (this.cleanupInterval) {
				clearInterval(this.cleanupInterval);
				this.cleanupInterval = null;
			}

			// Clear pending timeout and do final persist
			if (this.persistTimeout) {
				clearTimeout(this.persistTimeout);
				this.persistTimeout = null;
			}

			// Final metrics persistence
			await this.persistMetrics();

			logger.info("MetricsCollector shutdown complete", {
				finalMetricsCount: this.accessMetrics.size,
			});
		} catch (error) {
			logger.error("Error during MetricsCollector shutdown", {
				error: (error as Error).message,
				stack: (error as Error).stack,
			});
		}
	}

	/**
	 * Forces immediate persistence of metrics (useful for testing or manual triggers).
	 */
	async forcePersist(): Promise<void> {
		await this.persistMetrics();
	}

	/**
	 * Clears all metrics from memory (useful for testing).
	 * WARNING: This will lose all unpersisted data!
	 */
	clearMetrics(): void {
		if (process.env.NODE_ENV === "production") {
			throw new Error("clearMetrics() is not allowed in production");
		}
		this.accessMetrics.clear();
		logger.warn("All metrics cleared from memory");
	}
}

// Create and export the singleton instance with validation
// This collector is agnostic to storage backend (Azure or S3)
export const metricsCollector = MetricsCollector.createInstance(
	config.METRICS_STORAGE_PATH,
	config.METRICS_RETENTION_DAYS,
);

// Initialize the collector
metricsCollector.initialize().catch((error) => {
	logger.error("Failed to initialize MetricsCollector", {
		error: (error as Error).message,
		stack: (error as Error).stack,
	});
	process.exit(1);
});
