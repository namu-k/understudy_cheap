import { createLogger } from "@understudy/core";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const log = createLogger("grounding:cache");

const DEFAULT_TTL_MS = 604_800_000;
const DEFAULT_MAX_ENTRIES = 500;

export interface CacheEntry {
	cachedPoint?: { x: number; y: number };
	ocrText?: string;
	lastSeenAt: number;
}

interface CacheJsonFormat {
	[pageKey: string]: {
		[targetDesc: string]: CacheEntry;
	};
}

interface GroundingCacheStoreOptions {
	storageDir: string;
	ttlMs?: number;
	maxEntries?: number;
}

export class GroundingCacheStore {
	private readonly cachePath: string;
	private readonly ttlMs: number;
	private readonly maxEntries: number;
	private readonly entries = new Map<string, Map<string, CacheEntry>>();
	private loaded = false;
	private dirty = false;

	constructor(options: GroundingCacheStoreOptions) {
		this.cachePath = join(options.storageDir, "grounding-cache.json");
		this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
		this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
	}

	async get(pageKey: string, targetDescription: string): Promise<CacheEntry | undefined> {
		await this.ensureLoaded();
		const didEvict = this.evictExpired();
		if (didEvict) {
			await this.save();
		}

		return this.entries.get(pageKey)?.get(targetDescription);
	}

	async put(pageKey: string, targetDescription: string, entry: CacheEntry): Promise<void> {
		await this.ensureLoaded();

		let pageEntries = this.entries.get(pageKey);
		if (!pageEntries) {
			pageEntries = new Map<string, CacheEntry>();
			this.entries.set(pageKey, pageEntries);
		}

		pageEntries.set(targetDescription, entry);
		this.dirty = true;
		this.enforceMaxEntries();
		await this.save();
	}

	private async ensureLoaded(): Promise<void> {
		if (this.loaded) {
			return;
		}

		try {
			const raw = await readFile(this.cachePath, "utf-8");
			const parsed = parseCacheJson(JSON.parse(raw));
			for (const [pageKey, targetEntries] of Object.entries(parsed)) {
				const pageMap = new Map<string, CacheEntry>();
				for (const [targetDescription, entry] of Object.entries(targetEntries)) {
					pageMap.set(targetDescription, entry);
				}
				if (pageMap.size > 0) {
					this.entries.set(pageKey, pageMap);
				}
			}

			log.info("Loaded grounding cache", {
				path: this.cachePath,
				pages: this.entries.size,
				entries: this.countEntries(),
			});
		} catch {
		}

		this.loaded = true;
	}

	private async save(): Promise<void> {
		if (!this.dirty) {
			return;
		}

		await mkdir(dirname(this.cachePath), { recursive: true });
		await writeFile(this.cachePath, JSON.stringify(this.toJson(), null, 2), "utf-8");
		this.dirty = false;
	}

	private evictExpired(): boolean {
		const now = Date.now();
		let removed = 0;

		for (const [pageKey, targetEntries] of this.entries) {
			for (const [targetDescription, entry] of targetEntries) {
				if (now - entry.lastSeenAt > this.ttlMs) {
					targetEntries.delete(targetDescription);
					removed += 1;
				}
			}

			if (targetEntries.size === 0) {
				this.entries.delete(pageKey);
			}
		}

		if (removed > 0) {
			this.dirty = true;
			log.info("Evicted expired grounding cache entries", { removed, ttlMs: this.ttlMs });
			return true;
		}

		return false;
	}

	private enforceMaxEntries(): void {
		const totalEntries = this.countEntries();
		if (totalEntries <= this.maxEntries) {
			return;
		}

		const orderedEntries = Array.from(this.entries.entries())
			.flatMap(([pageKey, targetEntries]) => Array.from(targetEntries.entries()).map(([targetDescription, entry]) => ({
				pageKey,
				targetDescription,
				entry,
			})))
			.sort((left, right) => left.entry.lastSeenAt - right.entry.lastSeenAt);

		const overflow = totalEntries - this.maxEntries;
		for (const victim of orderedEntries.slice(0, overflow)) {
			const pageEntries = this.entries.get(victim.pageKey);
			pageEntries?.delete(victim.targetDescription);
			if (pageEntries && pageEntries.size === 0) {
				this.entries.delete(victim.pageKey);
			}
		}

		log.info("Evicted grounding cache entries to enforce size cap", {
			removed: overflow,
			maxEntries: this.maxEntries,
		});
	}

	private countEntries(): number {
		let count = 0;
		for (const targetEntries of this.entries.values()) {
			count += targetEntries.size;
		}
		return count;
	}

	private toJson(): CacheJsonFormat {
		const json: CacheJsonFormat = {};
		for (const [pageKey, targetEntries] of this.entries) {
			json[pageKey] = {};
			for (const [targetDescription, entry] of targetEntries) {
				json[pageKey][targetDescription] = entry;
			}
		}
		return json;
	}
}

export function buildCachePageKey(params: { app?: string; windowTitle?: string }): string {
	return params.app?.trim() || params.windowTitle?.trim() || "unknown";
}

function parseCacheJson(value: unknown): CacheJsonFormat {
	if (!isRecord(value)) {
		return {};
	}

	const parsed: CacheJsonFormat = {};
	for (const [pageKey, pageValue] of Object.entries(value)) {
		if (!isRecord(pageValue)) {
			continue;
		}

		const pageEntries: Record<string, CacheEntry> = {};
		for (const [targetDescription, entryValue] of Object.entries(pageValue)) {
			const entry = parseCacheEntry(entryValue);
			if (entry) {
				pageEntries[targetDescription] = entry;
			}
		}

		if (Object.keys(pageEntries).length > 0) {
			parsed[pageKey] = pageEntries;
		}
	}

	return parsed;
}

function parseCacheEntry(value: unknown): CacheEntry | undefined {
	if (!isRecord(value) || typeof value.lastSeenAt !== "number") {
		return undefined;
	}

	const entry: CacheEntry = {
		lastSeenAt: value.lastSeenAt,
	};

	if (typeof value.ocrText === "string") {
		entry.ocrText = value.ocrText;
	}

	if (isPoint(value.cachedPoint)) {
		entry.cachedPoint = value.cachedPoint;
	}

	return entry;
}

function isPoint(value: unknown): value is { x: number; y: number } {
	return isRecord(value) && typeof value.x === "number" && typeof value.y === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
