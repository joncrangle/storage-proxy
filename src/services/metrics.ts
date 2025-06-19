import { and, count, desc, eq, gte, lte, or, sql, sum } from "drizzle-orm";
import * as z from "zod";
import { METRICS_RETENTION_DAYS } from "../config";
import { logger } from "../services/logger";
import { db } from "./db";
import { metrics } from "./db.schemas";
import {
	type AccessEvent,
	type AccessedFiles,
	accessEventSchema,
	accessedFilesSchema,
	type ContainerStats,
	type Metric,
	type MetricUpdate,
	type SummaryStats,
	summaryStatsSchema,
} from "./metrics.schemas";

/**
 * MetricsCollector is responsible for tracking and persisting access metrics for blobs/objects (Azure Blob Storage or AWS S3).
 */
class MetricsCollector {
	// Buffer for pending access events
	private accessBuffer: AccessEvent[] = [];

	// LRU cache for frequently accessed metrics
	private metricsCache = new Map<string, Metric>();
	private accessOrder: string[] = [];

	// Batch processing state
	private batchTimeout: ReturnType<typeof setTimeout> | null = null;
	private processingBatch = false;

	// Cleanup and maintenance
	private cleanupInterval: ReturnType<typeof setInterval> | null = null;
	private isShuttingDown = false;

	constructor(
		private readonly maxBufferSize = 1000,
		private readonly maxCacheSize = 500,
		private readonly batchIntervalMs = 30 * 1000, // 30 seconds
		private readonly cleanupIntervalMs = 6 * 60 * 60 * 1000, // 6 hours
		private readonly maxRecentUsers = 50,
	) {}

	/**
	 * Initializes the metrics collector.
	 */
	async initialize() {
		this.cleanupInterval = setInterval(
			() => this.performMaintenance(),
			this.cleanupIntervalMs,
		);

		logger.info("MetricsCollector initialized");
	}

	/**
	 * Records an access event.
	 */
	recordAccess(container: string, blob: string, userId: string) {
		if (this.isShuttingDown) return;

		// Validate input
		const event = accessEventSchema.parse({
			container,
			blob,
			userId,
			timestamp: new Date(),
		});

		// Add to buffer
		this.accessBuffer.push(event);

		// Prevent memory overflow
		if (this.accessBuffer.length > this.maxBufferSize) {
			this.accessBuffer = this.accessBuffer.slice(-this.maxBufferSize);
			logger.warn("Access buffer overflow, dropping oldest events");
		}

		this.scheduleBatchProcessing();
	}

	/**
	 * Schedules batch processing with debouncing.
	 */
	private scheduleBatchProcessing(): void {
		if (this.batchTimeout || this.processingBatch) return;

		this.batchTimeout = setTimeout(() => {
			this.processBatch().catch((error) => {
				logger.error({ error }, "Error processing metrics batch");
			});
		}, this.batchIntervalMs);
	}

	/**
	 * Processes buffered access events in batches.
	 */
	private async processBatch(): Promise<void> {
		if (this.processingBatch || this.accessBuffer.length === 0) return;

		this.processingBatch = true;
		this.batchTimeout = null;

		try {
			// Take snapshot of current buffer
			const eventsToProcess = [...this.accessBuffer];
			this.accessBuffer = [];

			// Group events by blob
			const updates = this.aggregateEvents(eventsToProcess);

			// Process in smaller chunks to avoid blocking
			const chunkSize = 50;
			for (let i = 0; i < updates.length; i += chunkSize) {
				const chunk = updates.slice(i, i + chunkSize);
				await this.persistBatch(chunk);
			}
		} finally {
			this.processingBatch = false;

			// Schedule next batch if buffer has more events
			if (this.accessBuffer.length > 0) {
				this.scheduleBatchProcessing();
			}
		}
	}

	/**
	 * Aggregates access events into metric updates.
	 */
	private aggregateEvents(events: AccessEvent[]): MetricUpdate[] {
		const updateMap = new Map<string, MetricUpdate>();

		for (const event of events) {
			const key = `${event.container}/${event.blob}`;
			const existing = updateMap.get(key);

			if (existing) {
				existing.accessCount++;
				existing.lastAccessed = event.timestamp;
				existing.recentUsers.add(event.userId);
			} else {
				updateMap.set(key, {
					container: event.container,
					blob: event.blob,
					accessCount: 1,
					firstAccessed: event.timestamp,
					lastAccessed: event.timestamp,
					recentUsers: new Set([event.userId]),
				});
			}
		}

		return Array.from(updateMap.values());
	}

	/**
	 * Persists a batch of metric updates using efficient upsert.
	 */
	private async persistBatch(updates: MetricUpdate[]): Promise<void> {
		if (updates.length === 0) return;

		await db.transaction(async (tx) => {
			// Batch fetch existing metrics
			const keys = updates.map((u) => ({
				container: u.container,
				blob: u.blob,
			}));
			const existing = await tx
				.select()
				.from(metrics)
				.where(
					keys
						.map((k) =>
							and(eq(metrics.container, k.container), eq(metrics.blob, k.blob)),
						)
						.reduce((acc, curr) => (acc ? or(acc, curr) : curr), undefined),
				);

			const existingMap = new Map(
				existing.map((row) => [`${row.container}/${row.blob}`, row]),
			);

			// Prepare batch operations
			const toInsert = [];
			const toUpdate = [];

			for (const update of updates) {
				const key = `${update.container}/${update.blob}`;
				const existingRow = existingMap.get(key);

				// Trim recent users to prevent unbounded growth
				const recentUsers = Array.from(update.recentUsers);
				if (recentUsers.length > this.maxRecentUsers) {
					recentUsers.splice(0, recentUsers.length - this.maxRecentUsers);
				}

				if (existingRow) {
					// Merge with existing data
					const existingUsers = existingRow.recentUsers ?? "[]";
					const mergedUsers = [
						...new Set([...existingUsers, ...recentUsers]),
					].slice(-this.maxRecentUsers);

					toUpdate.push({
						container: update.container,
						blob: update.blob,
						values: {
							totalAccesses: existingRow.totalAccesses + update.accessCount,
							lastAccessed: update.lastAccessed,
							recentUsers: mergedUsers,
							updatedAt: new Date(),
						},
					});
				} else {
					toInsert.push({
						container: update.container,
						blob: update.blob,
						totalAccesses: update.accessCount,
						firstAccessed: update.firstAccessed,
						lastAccessed: update.lastAccessed,
						recentUsers: recentUsers,
						updatedAt: new Date(),
					});
				}
			}

			// Execute batch operations
			if (toInsert.length > 0) {
				await tx.insert(metrics).values(toInsert);
			}

			for (const item of toUpdate) {
				await tx
					.update(metrics)
					.set(item.values)
					.where(
						and(
							eq(metrics.container, item.container),
							eq(metrics.blob, item.blob),
						),
					);
			}
		});

		// Update cache with fresh data
		this.updateCache(updates);
	}

	/**
	 * Updates the LRU cache with fresh data.
	 */
	private updateCache(updates: MetricUpdate[]): void {
		for (const update of updates) {
			const key = `${update.container}/${update.blob}`;

			// Update or create cache entry
			const cached = this.metricsCache.get(key);
			if (cached) {
				cached.totalAccesses += update.accessCount;
				cached.lastAccessed = update.lastAccessed;
				// Merge recent users
				for (const user of update.recentUsers) {
					cached.recentUsers?.add(user);
				}
			} else {
				this.metricsCache.set(key, {
					container: update.container,
					blob: update.blob,
					totalAccesses: update.accessCount,
					firstAccessed: update.firstAccessed,
					lastAccessed: update.lastAccessed,
					recentUsers: new Set(update.recentUsers),
				});
			}

			// Maintain LRU order
			this.updateLRU(key);
		}

		// Enforce cache size limit
		this.evictLRU();
	}

	/**
	 * Updates LRU ordering.
	 */
	private updateLRU(key: string): void {
		const index = this.accessOrder.indexOf(key);
		if (index > -1) {
			this.accessOrder.splice(index, 1);
		}
		this.accessOrder.push(key);
	}

	/**
	 * Evicts least recently used items from cache.
	 */
	private evictLRU(): void {
		while (this.metricsCache.size > this.maxCacheSize) {
			const lru = this.accessOrder.shift();
			if (lru) {
				this.metricsCache.delete(lru);
			}
		}
	}

	/**
	 * Performs maintenance tasks (cleanup and optimization).
	 */
	private async performMaintenance() {
		try {
			// Optimize database performance
			db.run(sql`ANALYZE`);
			db.run(sql`VACUUM`);

			// Log some basic stats for monitoring
			const [{ count: totalMetrics }] = await db
				.select({ count: count() })
				.from(metrics);

			logger.info(`Maintenance completed. Total metrics: ${totalMetrics}`);
		} catch (error) {
			logger.error(
				{
					error: error instanceof Error ? error.message : String(error),
				},
				"Failed to perform maintenance",
			);
		}
	}

	/**
	 * Gets accessed files.
	 */
	async getAccessedFiles(
		limit = 100,
		container?: string,
		startDate?: Date,
		endDate?: Date,
	): Promise<AccessedFiles[]> {
		const conditions = [];

		if (container) {
			conditions.push(eq(metrics.container, container));
		}
		if (startDate) {
			conditions.push(gte(metrics.lastAccessed, startDate));
		}
		if (endDate) {
			conditions.push(lte(metrics.lastAccessed, endDate));
		}

		const rows = await db
			.select({
				container: metrics.container,
				blob: metrics.blob,
				totalAccesses: metrics.totalAccesses,
				firstAccessed: metrics.firstAccessed,
				lastAccessed: metrics.lastAccessed,
				recentUsers: metrics.recentUsers,
			})
			.from(metrics)
			.where(conditions.length ? and(...conditions) : undefined)
			.orderBy(desc(metrics.totalAccesses))
			.limit(limit);

		const results = rows.map((row) => ({
			container: row.container,
			blob: row.blob,
			totalAccesses: Number(row.totalAccesses ?? 0),
			firstAccessed: new Date(row.firstAccessed),
			lastAccessed: new Date(row.lastAccessed),
			recentUsersCount: (row.recentUsers ?? "[]").length,
		}));

		// Validate with schema
		return z.array(accessedFilesSchema).parse(results);
	}

	/**
	 * Gets summary statistics with efficient aggregation.
	 */
	async getSummaryStats(container?: string): Promise<SummaryStats> {
		const conditions = container ? [eq(metrics.container, container)] : [];

		const result = await db
			.select({
				totalFiles: count(),
				totalAccesses: sum(metrics.totalAccesses),
				uniqueContainers: sql<number>`COUNT(DISTINCT ${metrics.container})`,
			})
			.from(metrics)
			.where(conditions.length > 0 ? and(...conditions) : undefined);

		const stats = result[0];

		// For uniqueUsers, we need to aggregate recentUsers arrays
		const usersQuery = await db
			.select({
				recentUsers: metrics.recentUsers,
			})
			.from(metrics)
			.where(conditions.length > 0 ? and(...conditions) : undefined);

		const allUsers = new Set<string>();
		for (const row of usersQuery) {
			const users = row.recentUsers ?? "[]";
			users.forEach((user: string) => allUsers.add(user));
		}

		const summaryStats = {
			totalFiles: Number(stats.totalFiles ?? 0),
			totalAccesses: Number(stats.totalAccesses ?? 0),
			uniqueUsers: allUsers.size,
			uniqueContainers: container ? 1 : Number(stats.uniqueContainers ?? 0),
		};

		// Validate with schema
		return summaryStatsSchema.parse(summaryStats);
	}

	/**
	 * Gets container statistics with efficient grouping.
	 */
	async getContainerStats(): Promise<ContainerStats[]> {
		const results = await db
			.select({
				container: metrics.container,
				totalAccesses: sum(metrics.totalAccesses),
				uniqueFiles: count(),
				uniqueUsers: sql<number>`count(distinct users_json.value)`.mapWith(
					Number,
				),
			})
			.from(metrics)
			.leftJoin(sql`json_each(${metrics.recentUsers}) AS users_json`, sql`true`)
			.groupBy(metrics.container)
			.orderBy(desc(sum(metrics.totalAccesses)));

		return results.map((row) => ({
			container: row.container,
			totalAccesses: Number(row.totalAccesses ?? 0),
			uniqueFiles: Number(row.uniqueFiles ?? 0),
			uniqueUsers: Number(row.uniqueUsers ?? 0),
		}));
	}

	/**
	 * Forces immediate processing of buffered events.
	 */
	async forcePersist(): Promise<void> {
		if (this.batchTimeout) {
			clearTimeout(this.batchTimeout);
			this.batchTimeout = null;
		}
		await this.processBatch();
	}

	/**
	 * Clears all metrics (testing only).
	 */
	async clearMetrics(): Promise<void> {
		if (process.env.NODE_ENV === "production") {
			throw new Error("clearMetrics() is not allowed in production");
		}

		this.accessBuffer = [];
		this.metricsCache.clear();
		this.accessOrder = [];
		await db.delete(metrics);
		logger.warn("All metrics cleared");
	}

	/**
	 * Gracefully shuts down the metrics collector.
	 */
	async shutdown() {
		if (this.isShuttingDown) return;
		this.isShuttingDown = true;

		if (this.cleanupInterval) clearInterval(this.cleanupInterval);
		if (this.batchTimeout) clearTimeout(this.batchTimeout);

		// Process remaining buffered events
		await this.processBatch();

		logger.info("MetricsCollector shut down gracefully");
	}
}

// Create and export the singleton instance
export const metricsCollector = new MetricsCollector(METRICS_RETENTION_DAYS);

// Initialize the collector
metricsCollector.initialize().catch((error) => {
	logger.error({ error }, "Failed to initialize MetricsCollector");
	process.exit(1);
});
