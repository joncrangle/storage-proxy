import { reset, seed } from "drizzle-seed";
import { db } from "../src/services/db";
import * as schema from "../src/services/db.schemas";

export const seedDb = async () => {
	try {
		await reset(db, schema);
		await seed(db, schema).refine((funcs) => ({
			metrics: {
				columns: {
					container: funcs.string({ isUnique: true }),
					blob: funcs.string({ isUnique: true }),
					totalAccesses: funcs.number({ minValue: 0, precision: 1 }),
					recentUsers: funcs.email({ arraySize: 5 }),
				},
			},
		}));

		await db.insert(schema.metrics).values([
			{
				container: "test-container",
				blob: "sastestblob.txt",
				firstAccessed: new Date(),
				lastAccessed: new Date("2025-03-15"),
				totalAccesses: 15,
				recentUsers: ["user1@example.com", "user2@example.com"],
			},
			{
				container: "test-container",
				blob: "sastestblob.pdf",
				firstAccessed: new Date(),
				lastAccessed: new Date(),
				totalAccesses: 8,
				recentUsers: ["user3@example.com"],
			},
			{
				container: "test-container2",
				blob: "sastestblob2.txt",
				firstAccessed: new Date(),
				lastAccessed: new Date(),
				totalAccesses: 3,
				recentUsers: ["user4@example.com", "user5@example.com"],
			},
		]);
		console.log("Database seeded successfully");
	} catch (error) {
		console.error("Seeding failed:", error);
	}
};

export const resetDb = async () => {
	await reset(db, schema);
};
