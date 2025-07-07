import { and, desc, eq, lt, sql } from "drizzle-orm";
import { METRICS_RETENTION_DAYS } from "../config";
import { logger } from "../services/logger";
import { db } from "./db";
import { metrics } from "./db.schemas";
import type { Metric } from "./metrics.schemas";

/**
 * MetricsCollector is responsible for tracking and persisting access metrics for blobs/objects (Azure Blob Storage or AWS S3).
 */
class MetricsCollector {
	private accessMetrics = new Map<string, Metric>();
	private persistTimeout: ReturnType<typeof setTimeout> | null = null;
	private cleanupInterval: ReturnType<typeof setInterval> | null = null;
	private isShuttingDown = false;

	constructor(
		private readonly retentionDays: number,
		private readonly persistIntervalMs = 5 * 60 * 1000, // 5 min
		private readonly cleanupIntervalMs = 24 * 60 * 60 * 1000, // 24 hrs
		private readonly maxRecentUsers = 100,
	) {}

	/**
	 * Initializes the metrics collector and loads existing metrics.
	 */
	async initialize() {
		await this.loadMetrics();
		this.cleanupInterval = setInterval(
			() => this.cleanupOldMetrics(),
			this.cleanupIntervalMs,
		);
	}

	/**
	 * Loads existing metrics from the database into memory.
	 */
	private async loadMetrics(): Promise<void> {
		const rows = await db
			.select()
			.from(metrics)
			.orderBy(desc(metrics.totalAccesses));
		for (const row of rows) {
			const key = `${row.container}/${row.blob}`;
			this.accessMetrics.set(key, {
				container: row.container,
				blob: row.blob,
				totalAccesses: row.totalAccesses,
				firstAccessed: new Date(row.firstAccessed),
				lastAccessed: row.lastAccessed ? new Date(row.lastAccessed) : undefined,
				recentUsers: new Set(JSON.parse(row.recentUsers ?? "[]")),
			});
		}
	}

	/**
	 * Records an access event for a blob/object.
	 */
	recordAccess(container: string, blob: string, userId: string) {
		if (this.isShuttingDown) return;

		const key = `${container}/${blob}`;
		const now = new Date();

		const metric = this.accessMetrics.get(key) ?? {
			container,
			blob,
			totalAccesses: 0,
			firstAccessed: now,
			lastAccessed: undefined,
			recentUsers: new Set<string>(),
		};

		metric.totalAccesses++;
		metric.lastAccessed = now;

		if (!metric.recentUsers) {
			metric.recentUsers = new Set();
		}

		metric.recentUsers.add(userId);

		if (metric.recentUsers.size > this.maxRecentUsers) {
			const trimmed = Array.from(metric.recentUsers).slice(
				-Math.floor(this.maxRecentUsers * 0.7),
			);
			metric.recentUsers = new Set(trimmed);
		}

		this.accessMetrics.set(key, metric);
		this.schedulePersistence();
	}

	/**
	 * Schedules metrics persistence with debouncing.
	 */
	private schedulePersistence(): void {
		if (this.persistTimeout) clearTimeout(this.persistTimeout);
		this.persistTimeout = setTimeout(
			() => this.persistMetrics(),
			this.persistIntervalMs,
		);
	}

	/**
	 * Persists current metrics to database
	 */
	private async persistMetrics(): Promise<void> {
		if (!this.accessMetrics.size) return;

		await db.transaction(async (tx) => {
			for (const metric of this.accessMetrics.values()) {
				const existing = await tx
					.select()
					.from(metrics)
					.where(
						and(
							eq(metrics.container, metric.container),
							eq(metrics.blob, metric.blob),
						),
					)
					.limit(1);

				const values = {
					container: metric.container,
					blob: metric.blob,
					totalAccesses: metric.totalAccesses,
					firstAccessed:
						metric.firstAccessed?.toISOString() ?? new Date().toISOString(),
					lastAccessed: metric.lastAccessed?.toISOString() ?? null,
					recentUsers: JSON.stringify(Array.from(metric.recentUsers ?? [])),
					updatedAt: sql`CURRENT_TIMESTAMP`,
				};

				if (existing.length > 0) {
					await tx
						.update(metrics)
						.set(values)
						.where(
							and(
								eq(metrics.container, metric.container),
								eq(metrics.blob, metric.blob),
							),
						);
				} else {
					await tx.insert(metrics).values(values);
				}
			}
		});

		if (this.persistTimeout) {
			clearTimeout(this.persistTimeout);
			this.persistTimeout = null;
		}
	}

	/**
	 * Cleans up old metrics based on retention policy.
	 */
	private async cleanupOldMetrics() {
		const cutoff = new Date(
			Date.now() - this.retentionDays * 86400 * 1000,
		).toISOString();
		await db.delete(metrics).where(lt(metrics.createdAt, cutoff));

		for (const [key, metric] of this.accessMetrics.entries()) {
			if (metric.firstAccessed && metric.firstAccessed.toISOString() < cutoff) {
				this.accessMetrics.delete(key);
			}
		}
	}

	/**
	 * Returns the accessed files/objects, optionally filtered by container/bucket and limit.
	 */
	getAccessedFiles(limit?: number, container?: string) {
		let entries = Array.from(this.accessMetrics.values())
			.filter((m) => !container || m.container === container)
			.sort((a, b) => b.totalAccesses - a.totalAccesses);

		if (limit !== undefined) {
			entries = entries.slice(0, limit);
		}

		return entries.map((m) => ({
			container: m.container,
			blob: m.blob,
			totalAccesses: m.totalAccesses,
			firstAccessed: m.firstAccessed,
			lastAccessed: m.lastAccessed,
			recentUsersCount: m.recentUsers?.size ?? 0,
		}));
	}

	/**
	 * Gets summary statistics about the metrics.
	 */
	getSummaryStats(container?: string) {
		const entries = Array.from(this.accessMetrics.values()).filter(
			(m) => !container || m.container === container,
		);

		const totalFiles = entries.length;
		const totalAccesses = entries.reduce((sum, m) => sum + m.totalAccesses, 0);

		const uniqueUsers = new Set<string>();
		const uniqueContainers = new Set<string>();

		for (const m of entries) {
			uniqueContainers.add(m.container);
			for (const user of m.recentUsers ?? []) {
				uniqueUsers.add(user);
			}
		}

		return {
			totalFiles,
			totalAccesses,
			uniqueUsers: uniqueUsers.size,
			uniqueContainers: uniqueContainers.size,
			averageAccessesPerFile:
				totalFiles > 0 ? +(totalAccesses / totalFiles).toFixed(2) : 0,
		};
	}

	/**
	 * Returns statistics for each container/bucket.
	 */
	getContainerStats() {
		const containerMap = new Map<
			string,
			{ totalAccesses: number; files: Set<string>; users: Set<string> }
		>();

		for (const m of this.accessMetrics.values()) {
			const stats = containerMap.get(m.container) ?? {
				totalAccesses: 0,
				files: new Set<string>(),
				users: new Set<string>(),
			};

			stats.totalAccesses += m.totalAccesses;
			stats.files.add(m.blob);
			for (const user of m.recentUsers ?? []) {
				stats.users.add(user);
			}

			containerMap.set(m.container, stats);
		}

		return Array.from(containerMap.entries()).map(([container, stats]) => ({
			container,
			totalAccesses: stats.totalAccesses,
			uniqueFiles: stats.files.size,
			uniqueUsers: stats.users.size,
		}));
	}

	/**
	 * Gets metrics filtered by time range and optional container/bucket.
	 */
	getMetricsByTimeRange(
		startDate: Date,
		endDate: Date = new Date(),
		container?: string,
	) {
		const start = new Date(startDate);
		const end = new Date(endDate);
		end.setUTCHours(23, 59, 59, 999); // make end inclusive

		return Array.from(this.accessMetrics.values())
			.filter((m) => {
				const inRange =
					m.lastAccessed && m.lastAccessed >= start && m.lastAccessed <= end;

				const matchesContainer = !container || m.container === container;

				return inRange && matchesContainer;
			})
			.map((m) => ({
				container: m.container,
				blob: m.blob,
				totalAccesses: m.totalAccesses,
				firstAccessed: m.firstAccessed,
				lastAccessed: m.lastAccessed,
				recentUsersCount: m.recentUsers?.size ?? 0,
			}));
	}

	/**
	 * Gets metrics for a specific container/bucket.
	 */
	getContainerMetrics(containerName: string) {
		if (!containerName) {
			throw new Error("Container name cannot be empty.");
		}

		return Array.from(this.accessMetrics.values())
			.filter((m) => m.container === containerName)
			.map((m) => ({
				container: m.container,
				blob: m.blob,
				totalAccesses: m.totalAccesses,
				firstAccessed: m.firstAccessed,
				lastAccessed: m.lastAccessed,
				recentUsersCount: m.recentUsers?.size ?? 0,
			}));
	}

	/**
	 * Forces immediate persistence of metrics.
	 */
	async forcePersist(): Promise<void> {
		await this.persistMetrics();
	}

	/**
	 * Clears all metrics from memory and database (useful for testing).
	 */
	async clearMetrics(): Promise<void> {
		if (process.env.NODE_ENV === "production") {
			throw new Error("clearMetrics() is not allowed in production");
		}

		this.accessMetrics.clear();
		await db.delete(metrics);
		logger.warn("All metrics cleared from memory and database");
	}

	/**
	 * Gracefully shuts down the metrics collector.
	 */
	async shutdown() {
		if (this.isShuttingDown) return;
		this.isShuttingDown = true;

		if (this.cleanupInterval) clearInterval(this.cleanupInterval);
		if (this.persistTimeout) clearTimeout(this.persistTimeout);

		await this.persistMetrics();
	}
}

// Create and export the singleton instance
export const metricsCollector = new MetricsCollector(METRICS_RETENTION_DAYS);

// Initialize the collector
metricsCollector.initialize().catch((error) => {
	logger.error(
		{
			error: (error as Error).message,
			stack: (error as Error).stack,
		},
		"Failed to initialize MetricsCollector",
	);
	process.exit(1);
});
