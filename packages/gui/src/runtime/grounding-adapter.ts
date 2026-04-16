import { asBoolean, asNumber, asRecord, asString } from "@understudy/core";
import type {
	GuiGroundingActionIntent,
	GuiGroundingMode,
	GuiGroundingResult,
	GuiObservation,
	GuiResolution,
} from "../types.js";
import { clamp, type GuiPoint } from "./platform-detection.js";

// ---------------------------------------------------------------------------
// Grounding description / resolution helpers
// ---------------------------------------------------------------------------

export function describeGuiTarget(params: {
	target?: string;
	fallback?: string;
}): string {
	const normalizedTarget = params.target?.trim();
	if (normalizedTarget) {
		return `"${normalizedTarget}"`;
	}
	return params.fallback ?? "the GUI target";
}

export function defaultGroundingModeForAction(
	action: GuiGroundingActionIntent | undefined,
): GuiGroundingMode | undefined {
	switch (action) {
		case "type":
		case "drag_source":
		case "drag_destination":
			return "complex";
		// "wait" intentionally omitted — its validation round is always suppressed
		// in the provider, so requesting "complex" mode would be misleading.
		default:
			return undefined;
	}
}

export function createGroundingResolution(result: GuiGroundingResult): GuiResolution {
	return {
		method: "grounding",
		confidence: clamp(result.confidence, 0, 1),
		reason: result.reason,
	};
}

// ---------------------------------------------------------------------------
// Grounding telemetry extraction
// ---------------------------------------------------------------------------

export function extractTelemetryPoint(value: unknown): GuiPoint | undefined {
	const record = asRecord(value);
	const x = asNumber(record?.x);
	const y = asNumber(record?.y);
	if (x === undefined || y === undefined) {
		return undefined;
	}
	return { x, y };
}

export function summarizeGroundingTelemetry(raw: unknown): {
	modeRequested?: string;
	modeEffective?: string;
	selectedAttempt?: string;
	validationTriggered?: boolean;
	validationStatus?: string;
	validationReason?: string;
	roundsAttempted?: number;
	totalMs?: number;
	modelMs?: number;
	overheadMs?: number;
	sessionCreateMs?: number;
	modelPoint?: GuiPoint;
	modelImage?: { width?: number; height?: number; mimeType?: string };
	workingImage?: { width?: number; height?: number; logicalNormalizationApplied?: boolean };
	originalImage?: { width?: number; height?: number; mimeType?: string };
	requestImage?: { logicalWidth?: number; logicalHeight?: number; scaleX?: number; scaleY?: number };
	modelToOriginalScale?: { x?: number; y?: number };
	workingToOriginalScale?: { x?: number; y?: number };
} {
	const record = asRecord(raw);
	if (!record) {
		return {};
	}
	const runtimeTrace = asRecord(record.runtime_grounding_trace);
	const timingTrace = asRecord(record.grounding_timing_trace);
	const validation = asRecord(record.validation);
	const stages = Array.isArray(runtimeTrace?.stages) ? runtimeTrace.stages : [];
	const modelMs = stages.reduce((sum, stage) => {
		const stageRecord = asRecord(stage);
		const attempts = Array.isArray(stageRecord?.attempts) ? stageRecord.attempts : [];
		return sum + attempts.reduce((innerSum, attempt) => {
			const attemptRecord = asRecord(attempt);
			return innerSum + (asNumber(attemptRecord?.promptMs) ?? 0);
		}, 0);
	}, 0);
	const totalMs =
		asNumber(runtimeTrace?.totalMs) ??
		asNumber(timingTrace?.totalMs);
	const selectedAttempt = asString(record.selected_attempt);
	const validationTriggered =
		asBoolean(record.grounding_validation_triggered) ??
		(selectedAttempt === "validated" ? true : validation ? asString(validation.status) !== "skipped" : undefined);
	return {
		modeRequested: asString(record.grounding_mode_requested),
		modeEffective: asString(record.grounding_mode_effective),
		selectedAttempt,
		validationTriggered,
		validationStatus: asString(validation?.status),
		validationReason: asString(validation?.reason),
		roundsAttempted: asNumber(record.grounding_rounds_attempted),
		totalMs,
		modelMs: modelMs > 0 ? modelMs : undefined,
		overheadMs: totalMs !== undefined && modelMs > 0
			? Math.max(0, totalMs - modelMs)
			: undefined,
		sessionCreateMs: asNumber(runtimeTrace?.sessionCreateMs),
		modelPoint: extractTelemetryPoint(record.click_point),
		modelImage: asRecord(record.grounding_model_image)
			? {
				width: asNumber(asRecord(record.grounding_model_image)?.width),
				height: asNumber(asRecord(record.grounding_model_image)?.height),
				mimeType: asString(asRecord(record.grounding_model_image)?.mimeType),
			}
			: undefined,
		workingImage: asRecord(record.grounding_working_image)
			? {
				width: asNumber(asRecord(record.grounding_working_image)?.width),
				height: asNumber(asRecord(record.grounding_working_image)?.height),
				logicalNormalizationApplied: asBoolean(asRecord(record.grounding_working_image)?.logicalNormalizationApplied),
			}
			: undefined,
		originalImage: asRecord(record.grounding_original_image)
			? {
				width: asNumber(asRecord(record.grounding_original_image)?.width),
				height: asNumber(asRecord(record.grounding_original_image)?.height),
				mimeType: asString(asRecord(record.grounding_original_image)?.mimeType),
			}
			: undefined,
		requestImage: asRecord(record.grounding_request_image)
			? {
				logicalWidth: asNumber(asRecord(record.grounding_request_image)?.logicalWidth),
				logicalHeight: asNumber(asRecord(record.grounding_request_image)?.logicalHeight),
				scaleX: asNumber(asRecord(record.grounding_request_image)?.scaleX),
				scaleY: asNumber(asRecord(record.grounding_request_image)?.scaleY),
			}
			: undefined,
		modelToOriginalScale: asRecord(record.grounding_model_to_original_scale)
			? {
				x: asNumber(asRecord(record.grounding_model_to_original_scale)?.x),
				y: asNumber(asRecord(record.grounding_model_to_original_scale)?.y),
			}
			: undefined,
		workingToOriginalScale: asRecord(record.grounding_working_to_original_scale)
			? {
				x: asNumber(asRecord(record.grounding_working_to_original_scale)?.x),
				y: asNumber(asRecord(record.grounding_working_to_original_scale)?.y),
			}
			: undefined,
	};
}

// ---------------------------------------------------------------------------
// Screenshot observation helper
// ---------------------------------------------------------------------------

export function createScreenshotObservation(appName?: string, windowTitle?: string): GuiObservation {
	return {
		platform: process.platform,
		method: "screenshot",
		appName,
		windowTitle,
		capturedAt: Date.now(),
	};
}
