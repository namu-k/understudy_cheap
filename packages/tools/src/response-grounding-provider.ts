import type {
	GuiGroundingProvider,
} from "@understudy/types";
import { buildDataUrl, extractResponseText } from "./response-extract-helpers.js";
import { asRecord, asString } from "@understudy/core";
import {
	type ParsedGroundingResponse,
	type ParsedGroundingValidationResponse,
	buildGroundingPrompt,
	buildGroundingValidationPrompt,
	parseGroundingResponseText,
	parseGroundingValidationResponseText,
} from "./grounding/validation.js";
import {
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
} from "./grounding/grounding-loop.js";

export type {
	ParsedGroundingResponse,
	ParsedGroundingValidationResponse,
} from "./grounding/validation.js";
export {
	buildGroundingPrompt,
	buildGroundingValidationPrompt,
	parseGroundingResponseText,
	parseGroundingValidationResponseText,
} from "./grounding/validation.js";

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
} from "./grounding/grounding-loop.js";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 300;
const MODEL_REQUEST_MAX_ATTEMPTS = 3;

function isNonRetryableModelRequestError(error: Error): boolean {
	return /\bHTTP (400|401|403|404|413|422)\b/.test(error.message);
}

type ResponsesApiReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export interface ResponsesApiGroundingProviderOptions {
	apiKey?: string;
	baseUrl: string;
	model: string;
	timeoutMs?: number;
	maxOutputTokens?: number;
	fetchImpl?: typeof fetch;
	providerName: string;
	systemPrompt?: string;
	guideImageImpl?: GuideImageImpl;
	simulationImageImpl?: SimulationImageImpl;
	inputImageDetail?: "low" | "high" | "original" | "auto";
	reasoningEffort?: ResponsesApiReasoningEffort;
	prepareModelFrameImpl?: PrepareModelFrameImpl;
}

export function createResponsesApiGroundingProvider(
	options: ResponsesApiGroundingProviderOptions,
): GuiGroundingProvider {
	const apiKey = options.apiKey?.trim();
	if (!apiKey) {
		throw new Error(`${options.providerName} grounding provider requires an API key.`);
	}
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = Math.max(1_000, Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
	const maxOutputTokens = Math.max(64, Math.floor(options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS));

	const invokeModel: GroundingModelRunner = async (params) => {
		let lastError: Error | undefined;
		for (let attempt = 1; attempt <= MODEL_REQUEST_MAX_ATTEMPTS; attempt += 1) {
			const controller = new AbortController();
			const requestTimeout = setTimeout(() => controller.abort(), timeoutMs);
			try {
				const response = await fetchImpl(options.baseUrl, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${apiKey}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						model: options.model,
						max_output_tokens: maxOutputTokens,
						...(options.reasoningEffort
							? {
								reasoning: {
									effort: options.reasoningEffort,
									summary: "auto",
								},
							}
							: {}),
						input: [
							{
								role: "user",
								content: [
									...params.images.map((image) => ({
										type: "input_image",
										image_url: buildDataUrl(image.mimeType, image.bytes),
										...(options.inputImageDetail
											? { detail: options.inputImageDetail }
											: {}),
									})),
									{
										type: "input_text",
										text: params.prompt,
									},
								],
							},
						],
					}),
					signal: controller.signal,
				});
				const payload = await response.json().catch(() => ({}));
				if (!response.ok) {
					const message =
						asString(asRecord(asRecord(payload)?.error)?.message) ||
						extractResponseText(payload) ||
						`HTTP ${response.status}`;
					throw new Error(`${options.providerName} grounding request failed: ${message}`);
				}
				const responseText = extractResponseText(payload);
				if (!responseText.trim()) {
					throw new Error(`${options.providerName} grounding response was empty`);
				}
				return responseText;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
				if (attempt >= MODEL_REQUEST_MAX_ATTEMPTS || isNonRetryableModelRequestError(lastError)) {
					throw lastError;
				}
				await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
			} finally {
				clearTimeout(requestTimeout);
			}
		}
		throw lastError ?? new Error(`${options.providerName} grounding request failed: empty response`);
	};

	return createModelLoopGroundingProvider({
		providerName: options.providerName,
		systemPrompt: options.systemPrompt,
		guideImageImpl: options.guideImageImpl,
		simulationImageImpl: options.simulationImageImpl,
		prepareModelFrameImpl: options.prepareModelFrameImpl,
		invokeModel,
	});
}
