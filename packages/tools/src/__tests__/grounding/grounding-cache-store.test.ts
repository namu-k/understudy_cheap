import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GroundingCacheStore, buildCachePageKey, type CacheEntry } from "../../grounding/grounding-cache-store.js";

const testDirs: string[] = [];

afterEach(async () => {
	await Promise.all(testDirs.splice(0).map(async (testDir) => {
		await rm(testDir, { recursive: true, force: true });
	}));
});

async function createStoreDir(): Promise<string> {
	const testDir = await mkdtemp(join(tmpdir(), "understudy-grounding-cache-"));
	testDirs.push(testDir);
	return testDir;
}

function makeEntry(lastSeenAt = Date.now()): CacheEntry {
	return {
		cachedPoint: { x: 12, y: 34 },
		ocrText: "Open",
		lastSeenAt,
	};
}

describe("buildCachePageKey", () => {
	it("prefers app name", () => {
		expect(buildCachePageKey({ app: "  Codex  ", windowTitle: "Window" })).toBe("Codex");
	});

	it("falls back to windowTitle when no app", () => {
		expect(buildCachePageKey({ app: "   ", windowTitle: "  Settings  " })).toBe("Settings");
	});

	it("returns unknown when neither available", () => {
		expect(buildCachePageKey({ app: " ", windowTitle: "  " })).toBe("unknown");
		expect(buildCachePageKey({})).toBe("unknown");
	});
});

describe("GroundingCacheStore", () => {
	it("stores and retrieves an entry by page key and target description", async () => {
		const storageDir = await createStoreDir();
		const store = new GroundingCacheStore({ storageDir });

		const entry = makeEntry();
		await store.put("Codex", "Open button", entry);

		await expect(store.get("Codex", "Open button")).resolves.toEqual(entry);
	});

	it("returns undefined for an unknown target", async () => {
		const storageDir = await createStoreDir();
		const store = new GroundingCacheStore({ storageDir });

		await store.put("Codex", "Open button", makeEntry());

		await expect(store.get("Codex", "Save button")).resolves.toBeUndefined();
	});

	it("persists data across instances", async () => {
		const storageDir = await createStoreDir();
		const entry = makeEntry();
		const firstStore = new GroundingCacheStore({ storageDir });

		await firstStore.put("Codex", "Open button", entry);

		const secondStore = new GroundingCacheStore({ storageDir });
		await expect(secondStore.get("Codex", "Open button")).resolves.toEqual(entry);
	});

	it("evicts entries older than the TTL", async () => {
		const storageDir = await createStoreDir();
		const store = new GroundingCacheStore({ storageDir, ttlMs: 1000 });

		await store.put("Codex", "Open button", makeEntry(Date.now() - 2000));

		await expect(store.get("Codex", "Open button")).resolves.toBeUndefined();
	});

	it("respects the max entries cap", async () => {
		const storageDir = await createStoreDir();
		const store = new GroundingCacheStore({ storageDir, maxEntries: 3 });
		const baseTime = Date.now();

		await store.put("Codex", "Target 1", makeEntry(baseTime + 1));
		await store.put("Codex", "Target 2", makeEntry(baseTime + 2));
		await store.put("Codex", "Target 3", makeEntry(baseTime + 3));
		await store.put("Codex", "Target 4", makeEntry(baseTime + 4));
		await store.put("Codex", "Target 5", makeEntry(baseTime + 5));

		await expect(store.get("Codex", "Target 1")).resolves.toBeUndefined();
		await expect(store.get("Codex", "Target 2")).resolves.toBeUndefined();
		await expect(store.get("Codex", "Target 3")).resolves.toEqual(makeEntry(baseTime + 3));
		await expect(store.get("Codex", "Target 4")).resolves.toEqual(makeEntry(baseTime + 4));
		await expect(store.get("Codex", "Target 5")).resolves.toEqual(makeEntry(baseTime + 5));
	});
});
