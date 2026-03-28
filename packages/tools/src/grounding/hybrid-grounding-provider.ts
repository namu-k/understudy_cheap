import type { GuiGroundingProvider, GuiGroundingRequest, GuiGroundingResult } from "@understudy/gui";
import type { OcrEngine, OcrResult } from "./ocr-engine.js";
import { fuzzyMatchOcr } from "./ocr-fuzzy-match.js";
import { buildCachePageKey } from "./grounding-cache-store.js";
import type { GroundingCacheStore } from "./grounding-cache-store.js";
import { createLogger } from "@understudy/core";

const log = createLogger("grounding:hybrid");

export interface HybridGroundingProviderConfig {
	ocrThreshold?: number;
	fallbackOnFailure?: boolean;
	autoUpdateCache?: boolean;
}

export interface HybridGroundingProviderOptions {
	ocrEngine: OcrEngine;
	cacheStore: Pick<GroundingCacheStore, "get" | "put">;
	fallbackProvider?: GuiGroundingProvider;
	config?: HybridGroundingProviderConfig;
}

export function createHybridGroundingProvider(options: HybridGroundingProviderOptions): GuiGroundingProvider {
	const ocrThreshold = options.config?.ocrThreshold ?? 0.7;
	const fallbackOnFailure = options.config?.fallbackOnFailure ?? true;
	const autoUpdateCache = options.config?.autoUpdateCache ?? true;

	return {
		async ground(params: GuiGroundingRequest): Promise<GuiGroundingResult | undefined> {
			const target = params.target.trim();
			if (!target) return undefined;

			const pageKey = buildCachePageKey({ app: params.app, windowTitle: params.windowTitle });

			// ── Layer 0: Cache lookup ────────────────────────────────────
			// No patch verification in v1 (deferred). Trust cached coords with 0.8 confidence.
			const cached = await options.cacheStore.get(pageKey, target).catch(() => undefined);
			if (cached?.cachedPoint) {
				log.debug("Layer 0 hit: cache", { target, pageKey });
				return {
					method: "grounding",
					provider: "hybrid:cached",
					confidence: 0.8,
					reason: "Layer 0 cache hit (no patch verification in v1)",
					coordinateSpace: "image_pixels",
					point: cached.cachedPoint,
					raw: { layer: 0, method: "cached", ocrText: cached.ocrText },
				};
			}

			// ── Layer 1: OCR fuzzy matching ──────────────────────────────
			const ocrResults: OcrResult[] = await options.ocrEngine.recognize(params.imagePath).catch((err) => {
				log.warn("OCR recognize failed", { error: String(err) });
				return [] as OcrResult[];
			});
			if (ocrResults.length > 0) {
				const ocrHit = fuzzyMatchOcr(ocrResults, target);
				if (ocrHit && ocrHit.confidence >= ocrThreshold) {
					log.debug("Layer 1 hit: OCR match", { target, method: ocrHit.method, matchedText: ocrHit.matchedText });
					if (autoUpdateCache) {
						await options.cacheStore.put(pageKey, target, {
							cachedPoint: ocrHit.point,
							ocrText: ocrHit.matchedText,
							lastSeenAt: Date.now(),
						}).catch(() => {});
					}
					return {
						method: "grounding",
						provider: "hybrid:ocr",
						confidence: ocrHit.confidence,
						reason: `Layer 1 OCR match (${ocrHit.method})`,
						coordinateSpace: "image_pixels",
						point: ocrHit.point,
						box: ocrHit.bbox,
						raw: { layer: 1, method: ocrHit.method, matchedText: ocrHit.matchedText },
					};
				}
				log.debug("Layer 1 miss: no OCR match above threshold", { target, resultCount: ocrResults.length });
			} else {
				log.debug("Layer 1 skip: no OCR results", { target });
			}

			// ── Layer 2: Vision model fallback ───────────────────────────
			// Pass through ALL GuiGroundingRequest fields so the vision model
			// can use scope, locationHint, groundingMode, previousFailures, etc.
			if (fallbackOnFailure && options.fallbackProvider) {
				log.debug("Layer 2: delegating to vision model fallback", { target });
				const visionResult = await options.fallbackProvider.ground(params);
				if (visionResult && autoUpdateCache) {
					await options.cacheStore.put(pageKey, target, {
						cachedPoint: visionResult.point,
						lastSeenAt: Date.now(),
					}).catch(() => {});
				}
				return visionResult;
			}

			log.debug("All layers exhausted, no result", { target });
			return undefined;
		},
	};
}
