export { createOcrEngine, createTesseractOcrEngine, type OcrEngine, type OcrResult, type OcrEngineOptions } from "./ocr-engine.js";
export { fuzzyMatchOcr, type OcrMatchResult } from "./ocr-fuzzy-match.js";
export { GroundingCacheStore, buildCachePageKey, type CacheEntry } from "./grounding-cache-store.js";
export {
	createHybridGroundingProvider,
	type HybridGroundingProviderOptions,
	type HybridGroundingProviderConfig,
} from "./hybrid-grounding-provider.js";
