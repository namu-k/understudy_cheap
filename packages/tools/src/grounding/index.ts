export { createOcrEngine, createTesseractOcrEngine, type OcrEngine, type OcrResult, type OcrEngineOptions } from "./ocr-engine.js";
export { fuzzyMatchOcr, type OcrMatchResult } from "./ocr-fuzzy-match.js";
export { GroundingCacheStore, buildCachePageKey, type CacheEntry } from "./grounding-cache-store.js";
export {
	createHybridGroundingProvider,
	type HybridGroundingProviderOptions,
	type HybridGroundingProviderConfig,
} from "./hybrid-grounding-provider.js";
export {
	buildGroundingPrompt,
	buildGroundingValidationPrompt,
	parseGroundingResponseText,
	parseGroundingValidationResponseText,
	shouldValidateResolvedCandidate,
	type GroundingPoint,
	type GroundingBox,
	type ParsedGroundingDecision,
	type ParsedGroundingResponse,
	type ParsedGroundingValidationResponse,
} from "./validation.js";
export {
	createModelLoopGroundingProvider,
	type SharedModelLoopGroundingProviderOptions,
	type GuideImageImpl,
	type SimulationImageImpl,
	type GroundingModelStage,
	type GroundingModelImageInput,
	type GroundingModelRunner,
	type PrepareModelFrameImpl,
	type GroundingFrame,
	type PreparedGroundingModelFrame,
	type GroundingResolvedAttempt,
	type GroundingRoundTiming,
} from "./grounding-loop.js";
