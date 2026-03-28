import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createHybridGroundingProvider,
} from "../../grounding/hybrid-grounding-provider.js";
import type { GuiGroundingProvider, GuiGroundingResult } from "@understudy/gui";
import type { OcrEngine, OcrResult } from "../../grounding/ocr-engine.js";
import type { GroundingCacheStore, CacheEntry } from "../../grounding/grounding-cache-store.js";
import { cleanupTempDirs, createTestImage } from "../grounding-test-helpers.js";

afterEach(async () => {
	await cleanupTempDirs();
});

function createMockOcrEngine(results: OcrResult[]): OcrEngine {
	return { recognize: vi.fn().mockResolvedValue(results) };
}

function createMockCacheStore(
	entries: Record<string, Record<string, CacheEntry>> = {},
): Pick<GroundingCacheStore, "get" | "put"> {
	return {
		get: vi.fn(async (pageKey: string, desc: string) => entries[pageKey]?.[desc]),
		put: vi.fn(async () => {}),
	};
}

function createMockFallback(result: GuiGroundingResult | undefined): GuiGroundingProvider {
	return { ground: vi.fn().mockResolvedValue(result) };
}

describe("HybridGroundingProvider", () => {
	it("Layer 0: returns cached coordinates when available", async () => {
		const imagePath = await createTestImage(1920, 1080, "screen.png");
		const cacheStore = createMockCacheStore({
			"test-app": {
				"검색 버튼": { cachedPoint: { x: 487, y: 312 }, lastSeenAt: Date.now() },
			},
		});
		const ocrEngine = createMockOcrEngine([]);
		const fallback = createMockFallback(undefined);

		const provider = createHybridGroundingProvider({
			ocrEngine,
			cacheStore,
			fallbackProvider: fallback,
		});

		const result = await provider.ground({
			imagePath,
			target: "검색 버튼",
			app: "test-app",
			action: "click",
		});

		expect(ocrEngine.recognize).not.toHaveBeenCalled();
		expect(fallback.ground).not.toHaveBeenCalled();
		expect(result).toBeDefined();
		expect(result!.point).toEqual({ x: 487, y: 312 });
		expect(result!.provider).toContain("cached");
	});

	it("Layer 1: falls through to OCR when cache miss, populates box", async () => {
		const imagePath = await createTestImage(1920, 1080, "screen.png");
		const cacheStore = createMockCacheStore({});
		const ocrEngine = createMockOcrEngine([
			{ text: "검색", bbox: { x: 460, y: 300, width: 60, height: 25 }, confidence: 0.95 },
		]);
		const fallback = createMockFallback(undefined);

		const provider = createHybridGroundingProvider({
			ocrEngine,
			cacheStore,
			fallbackProvider: fallback,
		});

		const result = await provider.ground({
			imagePath,
			target: "검색 버튼",
			action: "click",
		});

		expect(ocrEngine.recognize).toHaveBeenCalled();
		expect(result).toBeDefined();
		expect(result!.point).toBeDefined();
		expect(result!.box).toEqual({ x: 460, y: 300, width: 60, height: 25 });
		expect(result!.confidence).toBeGreaterThan(0);
	});

	it("Layer 2: falls through to vision model when all local layers fail", async () => {
		const imagePath = await createTestImage(1920, 1080, "screen.png");
		const cacheStore = createMockCacheStore({});
		const ocrEngine = createMockOcrEngine([]);
		const visionResult: GuiGroundingResult = {
			method: "grounding",
			provider: "openai:gpt-5.4",
			confidence: 0.92,
			reason: "found search button",
			coordinateSpace: "image_pixels",
			point: { x: 487, y: 312 },
		};
		const fallback = createMockFallback(visionResult);

		const provider = createHybridGroundingProvider({
			ocrEngine,
			cacheStore,
			fallbackProvider: fallback,
			config: { autoUpdateCache: true },
		});

		const result = await provider.ground({
			imagePath,
			target: "검색 버튼",
			action: "click",
		});

		expect(fallback.ground).toHaveBeenCalled();
		expect(result).toBeDefined();
		expect(result!.confidence).toBe(0.92);
		// Should auto-update cache
		expect(cacheStore.put).toHaveBeenCalled();
	});

	it("passes previousFailures and groundingMode to fallback provider", async () => {
		const imagePath = await createTestImage(100, 100, "tiny.png");
		const cacheStore = createMockCacheStore({});
		const ocrEngine = createMockOcrEngine([]);
		const fallback = createMockFallback({
			method: "grounding",
			provider: "openai:test",
			confidence: 0.9,
			reason: "test",
			coordinateSpace: "image_pixels",
			point: { x: 50, y: 50 },
		});

		const provider = createHybridGroundingProvider({
			ocrEngine,
			cacheStore,
			fallbackProvider: fallback,
		});

		const previousFailures = [{ summary: "wrong region", failureKind: "wrong_region" as const }];
		await provider.ground({
			imagePath,
			target: "button",
			action: "click",
			groundingMode: "complex",
			previousFailures,
			scope: "main panel",
			locationHint: "top-right",
		});

		// Verify the full request object was passed through to fallback
		const callArgs = (fallback.ground as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(callArgs.groundingMode).toBe("complex");
		expect(callArgs.previousFailures).toEqual(previousFailures);
		expect(callArgs.scope).toBe("main panel");
		expect(callArgs.locationHint).toBe("top-right");
	});

	it("returns undefined when all layers fail and no fallback", async () => {
		const imagePath = await createTestImage(100, 100, "tiny.png");
		const cacheStore = createMockCacheStore({});
		const ocrEngine = createMockOcrEngine([]);

		const provider = createHybridGroundingProvider({
			ocrEngine,
			cacheStore,
			fallbackProvider: undefined,
			config: { fallbackOnFailure: false },
		});

		const result = await provider.ground({
			imagePath,
			target: "nonexistent",
			action: "click",
		});

		expect(result).toBeUndefined();
	});
});
