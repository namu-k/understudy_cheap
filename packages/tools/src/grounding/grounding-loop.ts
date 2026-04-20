import type {
	GuiGroundingActionIntent,
	GuiGroundingFailure,
	GuiGroundingFailureKind,
	GuiGroundingProvider,
	GuiGroundingRequest,
	GuiGroundingResult,
} from "@understudy/types";
import { normalizeGuiGroundingMode } from "@understudy/types";
import {
	createGroundingGuideImage,
	type GroundingGuideImageArtifact,
	type GroundingGuideImageParams,
} from "../grounding-guide-image.js";
import {
	createGroundingSimulationImage,
	type GroundingSimulationImageArtifact,
	type GroundingSimulationImageParams,
} from "../grounding-simulation-image.js";
import {
	prepareGroundingModelImage,
	type GroundingPreparedModelImage,
} from "../grounding-model-image.js";
import { loadImageSource } from "../image-shared.js";
import { loadPhoton } from "../photon.js";
import { asRecord } from "@understudy/core";
import {
	type GroundingPoint,
	type GroundingBox,
	type ParsedGroundingDecision,
	type ParsedGroundingValidationResponse,
	buildGroundingPrompt,
	buildGroundingValidationPrompt,
	centerPointFromBox,
	describeGroundingFailure,
	extractJsonObjectGrounding,
	inferGroundingFailureKind,
	parseGroundingDecision,
	parseGroundingValidationResponseText,
	shouldValidateResolvedCandidate,
} from "./validation.js";

const DEFAULT_MAX_GROUNDING_IMAGE_BYTES = 40 * 1024 * 1024;

export type GuideImageImpl = (params: GroundingGuideImageParams) => Promise<GroundingGuideImageArtifact | undefined>;
export type SimulationImageImpl = (params: GroundingSimulationImageParams) => Promise<GroundingSimulationImageArtifact | undefined>;
export type GroundingModelStage = "predict" | "validate";
export type GroundingModelImageInput = {
	bytes: Buffer;
	mimeType: string;
};
export type GroundingModelRunner = (params: {
	stage: GroundingModelStage;
	prompt: string;
	images: GroundingModelImageInput[];
}) => Promise<string>;
export type PrepareModelFrameImpl = (frame: GroundingFrame, request: GuiGroundingRequest) => Promise<PreparedGroundingModelFrame>;

export interface SharedModelLoopGroundingProviderOptions {
	providerName: string;
	systemPrompt?: string;
	guideImageImpl?: GuideImageImpl;
	simulationImageImpl?: SimulationImageImpl;
	invokeModel: GroundingModelRunner;
	maxRounds?: number;
	prepareModelFrameImpl?: PrepareModelFrameImpl;
}

export type GroundingFrame = {
	bytes: Buffer;
	mimeType: string;
	width?: number;
	height?: number;
	localPath?: string;
};

export type PreparedGroundingModelFrame = {
	frame: GroundingFrame;
	modelToOriginalScaleX: number;
	modelToOriginalScaleY: number;
	wasResized: boolean;
	logicalNormalizationApplied: boolean;
	workingWidth?: number;
	workingHeight?: number;
	workingToOriginalScaleX: number;
	workingToOriginalScaleY: number;
	originalWidth?: number;
	originalHeight?: number;
	offsetX: number;
	offsetY: number;
};

export type GroundingResolvedAttempt = GuiGroundingResult & {
	modelPoint: GroundingPoint;
	modelBox?: GroundingBox;
	round: number;
};

export type GroundingRoundTiming = {
	round: number;
	guideImageMs?: number;
	predictModelMs?: number;
	refinementImageMs?: number;
	refinementModelMs?: number;
	simulationImageMs?: number;
	validateModelMs?: number;
	validationTriggered: boolean;
	validationSkippedReason?: string;
};

function normalizeScaleFactor(value: number | undefined): number {
	return Number.isFinite(value) && value && value > 0 ? value : 1;
}

async function defaultPrepareModelFrame(
	frame: GroundingFrame,
	request: GuiGroundingRequest,
): Promise<PreparedGroundingModelFrame> {
	const prepared: GroundingPreparedModelImage = await prepareGroundingModelImage({
		bytes: frame.bytes,
		mimeType: frame.mimeType,
		width: frame.width,
		height: frame.height,
		logicalWidth: request.logicalImageWidth,
		logicalHeight: request.logicalImageHeight,
		scaleX: request.imageScaleX,
		scaleY: request.imageScaleY,
	});
	return {
		frame: {
			...frame,
			bytes: prepared.bytes,
			mimeType: prepared.mimeType,
			width: prepared.width,
			height: prepared.height,
		},
		modelToOriginalScaleX: normalizeScaleFactor(prepared.modelToOriginalScaleX),
		modelToOriginalScaleY: normalizeScaleFactor(prepared.modelToOriginalScaleY),
		wasResized: prepared.wasResized,
		logicalNormalizationApplied: prepared.logicalNormalizationApplied,
		workingWidth: prepared.workingWidth ?? prepared.width,
		workingHeight: prepared.workingHeight ?? prepared.height,
		workingToOriginalScaleX: normalizeScaleFactor(prepared.workingToOriginalScaleX),
		workingToOriginalScaleY: normalizeScaleFactor(prepared.workingToOriginalScaleY),
		originalWidth: prepared.originalWidth ?? frame.width,
		originalHeight: prepared.originalHeight ?? frame.height,
		offsetX: 0,
		offsetY: 0,
	};
}

function scalePointToModelFrame(
	point: GroundingPoint | undefined,
	frame: PreparedGroundingModelFrame,
): GroundingPoint | undefined {
	if (!point) {
		return undefined;
	}
	return {
		x: Math.round((point.x - frame.offsetX) / frame.modelToOriginalScaleX),
		y: Math.round((point.y - frame.offsetY) / frame.modelToOriginalScaleY),
	};
}

function scalePointToOriginalFrame(
	point: GroundingPoint | undefined,
	frame: PreparedGroundingModelFrame,
): GroundingPoint | undefined {
	if (!point) {
		return undefined;
	}
	return {
		x: frame.offsetX + (point.x * frame.modelToOriginalScaleX),
		y: frame.offsetY + (point.y * frame.modelToOriginalScaleY),
	};
}

function scaleBoxEdges(
	box: GroundingBox | undefined,
	scaleX: number,
	scaleY: number,
	operator: "multiply" | "divide",
): GroundingBox | undefined {
	if (!box) {
		return undefined;
	}
	const applyScale = (value: number, scale: number): number =>
		operator === "multiply"
			? Math.round(value * scale)
			: Math.round(value / scale);
	const x1 = applyScale(box.x, scaleX);
	const y1 = applyScale(box.y, scaleY);
	const x2 = applyScale(box.x + box.width, scaleX);
	const y2 = applyScale(box.y + box.height, scaleY);
	return {
		x: Math.min(x1, x2),
		y: Math.min(y1, y2),
		width: Math.max(1, Math.abs(x2 - x1)),
		height: Math.max(1, Math.abs(y2 - y1)),
	};
}

function scaleBoxToModelFrame(
	box: GroundingBox | undefined,
	frame: PreparedGroundingModelFrame,
): GroundingBox | undefined {
	if (!box) {
		return undefined;
	}
	return scaleBoxEdges({
		x: box.x - frame.offsetX,
		y: box.y - frame.offsetY,
		width: box.width,
		height: box.height,
	}, frame.modelToOriginalScaleX, frame.modelToOriginalScaleY, "divide");
}

function scaleBoxToOriginalFrame(
	box: GroundingBox | undefined,
	frame: PreparedGroundingModelFrame,
): GroundingBox | undefined {
	if (!box) {
		return undefined;
	}
	const x1 = frame.offsetX + (box.x * frame.modelToOriginalScaleX);
	const y1 = frame.offsetY + (box.y * frame.modelToOriginalScaleY);
	const x2 = frame.offsetX + ((box.x + box.width) * frame.modelToOriginalScaleX);
	const y2 = frame.offsetY + ((box.y + box.height) * frame.modelToOriginalScaleY);
	return {
		x: Math.min(x1, x2),
		y: Math.min(y1, y2),
		width: Math.max(1, Math.abs(x2 - x1)),
		height: Math.max(1, Math.abs(y2 - y1)),
	};
}

function scaleFailureToModelFrame(
	failure: GuiGroundingFailure,
	frame: PreparedGroundingModelFrame,
): GuiGroundingFailure {
	return {
		...failure,
		attemptedPoint: scalePointToModelFrame(failure.attemptedPoint, frame),
		attemptedBox: scaleBoxToModelFrame(failure.attemptedBox, frame),
	};
}

function normalizeFrameDimension(value: number | undefined): number | undefined {
	return Number.isFinite(value) && value && value > 0 ? value : undefined;
}

function resolveRequestImageScale(params: {
	originalWidth?: number;
	originalHeight?: number;
	logicalWidth?: number;
	logicalHeight?: number;
	scaleX?: number;
	scaleY?: number;
}): { x: number; y: number } {
	const originalWidth = normalizeFrameDimension(params.originalWidth);
	const originalHeight = normalizeFrameDimension(params.originalHeight);
	const logicalWidth = normalizeFrameDimension(params.logicalWidth);
	const logicalHeight = normalizeFrameDimension(params.logicalHeight);
	return {
		x: normalizeScaleFactor(
			params.scaleX ??
				(
					originalWidth && logicalWidth
						? originalWidth / logicalWidth
						: 1
				),
		),
		y: normalizeScaleFactor(
			params.scaleY ??
				(
					originalHeight && logicalHeight
						? originalHeight / logicalHeight
						: 1
				),
		),
	};
}

function shouldUseHighResolutionRefinement(params: {
	request: GuiGroundingRequest;
	resolved: GroundingResolvedAttempt;
	frame: PreparedGroundingModelFrame;
}): boolean {
	const originalWidth = normalizeFrameDimension(params.frame.originalWidth);
	const originalHeight = normalizeFrameDimension(params.frame.originalHeight);
	const box = params.resolved.box;
	const boxArea = box ? box.width * box.height : 0;
	const originalArea = originalWidth && originalHeight ? originalWidth * originalHeight : 0;
	const tinyOrDenseTarget =
		box !== undefined &&
		(
			Math.max(box.width, box.height) <= 160 ||
			(originalArea > 0 && (boxArea / originalArea) <= 0.02)
	);
	return params.frame.wasResized || params.frame.logicalNormalizationApplied || tinyOrDenseTarget;
}

function shouldGenerateGuideForFailure(failure: GuiGroundingFailure | undefined): boolean {
	if (!failure || (!failure.attemptedPoint && !failure.attemptedBox)) {
		return false;
	}
	return failure.failureKind !== "wrong_region" && failure.failureKind !== "scope_mismatch";
}

function formatGroundingFailureKind(kind: GuiGroundingFailureKind | undefined): string | undefined {
	return kind?.replace(/_/g, " ");
}

function buildGroundingRefinementPrompt(params: {
	target: string;
	scope?: string;
	app?: string;
	width?: number;
	height?: number;
	action?: GuiGroundingActionIntent;
	locationHint?: string;
	windowTitle?: string;
	captureMode?: "display" | "window";
	priorPoint?: GroundingPoint;
	priorBox?: GroundingBox;
}): string {
	return [
		"You are refining a GUI grounding candidate inside a zoomed crop from the original screenshot.",
		"This crop was selected around a previous candidate. Refine the point and box to the exact actionable/editable surface inside this crop.",
			...buildGroundingPrompt({
				target: params.target,
				scope: params.scope,
				app: params.app,
				width: params.width,
				height: params.height,
				action: params.action,
				locationHint: params.locationHint,
				windowTitle: params.windowTitle,
				captureMode: params.captureMode,
				groundingMode: "single",
				retryNotes: [
					"The provided screenshot is a zoomed crop around a previous candidate from the original image.",
					...(params.priorPoint
						? [`Previous crop-relative point: (${Math.round(params.priorPoint.x)}, ${Math.round(params.priorPoint.y)}).`]
					: []),
				...(params.priorBox
					? [`Previous crop-relative box: x=${Math.round(params.priorBox.x)}, y=${Math.round(params.priorBox.y)}, width=${Math.round(params.priorBox.width)}, height=${Math.round(params.priorBox.height)}.`]
					: []),
				"Refine the target inside this crop; if the crop does not actually contain the target, return not_found.",
			],
		}).split("\n"),
	].join("\n");
}

async function createPreparedCropFrame(params: {
	fullFrame: GroundingFrame;
	request: GuiGroundingRequest;
	candidate: GroundingResolvedAttempt;
	prepareModelFrameImpl: PrepareModelFrameImpl;
}): Promise<PreparedGroundingModelFrame | undefined> {
	const originalWidth = normalizeFrameDimension(params.fullFrame.width);
	const originalHeight = normalizeFrameDimension(params.fullFrame.height);
	if (!originalWidth || !originalHeight) {
		return undefined;
	}
	const requestScale = resolveRequestImageScale({
		originalWidth,
		originalHeight,
		logicalWidth: params.request.logicalImageWidth,
		logicalHeight: params.request.logicalImageHeight,
		scaleX: params.request.imageScaleX,
		scaleY: params.request.imageScaleY,
	});
	const photon = await loadPhoton();
	if (!photon) {
		return undefined;
	}

	const candidateBox = params.candidate.box ?? {
		x: params.candidate.point.x - 12,
		y: params.candidate.point.y - 12,
		width: 24,
		height: 24,
	};
	const candidateLogicalWidth = Math.max(1, Math.round(candidateBox.width / requestScale.x));
	const candidateLogicalHeight = Math.max(1, Math.round(candidateBox.height / requestScale.y));
	const minLogicalCropWidth = 360;
	const minLogicalCropHeight = 320;
	const targetLogicalCropWidth = Math.max(
		minLogicalCropWidth,
		Math.round(candidateLogicalWidth * 5),
		Math.round(candidateLogicalHeight * 6),
	);
	const targetLogicalCropHeight = Math.max(
		minLogicalCropHeight,
		Math.round(candidateLogicalHeight * 5),
		Math.round(candidateLogicalWidth * 4),
	);
	const cropWidth = Math.min(
		originalWidth,
		Math.max(1, Math.round(targetLogicalCropWidth * requestScale.x)),
	);
	const cropHeight = Math.min(
		originalHeight,
		Math.max(1, Math.round(targetLogicalCropHeight * requestScale.y)),
	);
	const centerX = params.candidate.point.x;
	const centerY = params.candidate.point.y;
	const left = Math.max(0, Math.min(originalWidth - cropWidth, Math.round(centerX - (cropWidth / 2))));
	const top = Math.max(0, Math.min(originalHeight - cropHeight, Math.round(centerY - (cropHeight / 2))));
	const right = Math.min(originalWidth, left + cropWidth);
	const bottom = Math.min(originalHeight, top + cropHeight);
	if (right <= left || bottom <= top) {
		return undefined;
	}

	let sourceImage: ReturnType<typeof photon.PhotonImage.new_from_byteslice> | undefined;
	let cropped: ReturnType<typeof photon.crop> | undefined;
	try {
		sourceImage = photon.PhotonImage.new_from_byteslice(new Uint8Array(params.fullFrame.bytes));
		cropped = photon.crop(sourceImage, left, top, right, bottom);
		const cropBytes = Buffer.from(cropped.get_bytes());
		const cropFrame: GroundingFrame = {
			bytes: cropBytes,
			mimeType: "image/png",
			width: right - left,
			height: bottom - top,
			localPath: params.fullFrame.localPath,
		};
		const prepared = await params.prepareModelFrameImpl(cropFrame, {
			...params.request,
			logicalImageWidth: undefined,
			logicalImageHeight: undefined,
			imageScaleX: undefined,
			imageScaleY: undefined,
		});
		return {
			...prepared,
			offsetX: left + prepared.offsetX,
			offsetY: top + prepared.offsetY,
		};
	} catch {
		return undefined;
	} finally {
		cropped?.free();
		sourceImage?.free();
	}
}

function stabilizeGroundingPoint(params: {
	point: GroundingPoint;
	box?: GroundingBox;
	action?: GuiGroundingActionIntent;
}): { point: GroundingPoint; stabilized: boolean } {
	if (!params.box) {
		return { point: params.point, stabilized: false };
	}
	const center = centerPointFromBox(params.box);
	if (!center) {
		return { point: params.point, stabilized: false };
	}
	switch (params.action) {
		case "click":
		case "right_click":
		case "double_click":
		case "hover":
		case "click_and_hold":
		case "drag_source":
		case "drag_destination":
			break;
		case "type": {
			const safeInsetX = Math.max(8, Math.min(32, params.box.width * 0.18));
			const safeInsetY = Math.max(6, Math.min(18, params.box.height * 0.2));
			const minX = params.box.x + safeInsetX;
			const maxX = params.box.x + params.box.width - safeInsetX;
			const minY = params.box.y + safeInsetY;
			const maxY = params.box.y + params.box.height - safeInsetY;
			const insideSafeInterior =
				params.point.x >= minX &&
				params.point.x <= maxX &&
				params.point.y >= minY &&
				params.point.y <= maxY;
			const preferredX = Math.max(minX, Math.min(maxX, params.box.x + Math.max(safeInsetX, Math.min(40, params.box.width * 0.2))));
			const preferredY = Math.max(minY, Math.min(maxY, center.y));
			const alreadyLeftBiased =
				insideSafeInterior &&
				params.point.x <= params.box.x + (params.box.width * 0.45);
			if (alreadyLeftBiased) {
				return { point: params.point, stabilized: false };
			}
			return {
				point: {
					x: preferredX,
					y: preferredY,
				},
				stabilized: true,
			};
		}
		case "observe":
		case "scroll":
		case "wait":
		case "key":
		case "move":
		default:
			return { point: params.point, stabilized: false };
	}
	const smallControl =
		(params.box.width <= 80 && params.box.height <= 80) ||
		(params.box.height <= 48 && params.box.width <= 220);
	if (!smallControl) {
		return { point: params.point, stabilized: false };
	}
	const dx = Math.abs(params.point.x - center.x);
	const dy = Math.abs(params.point.y - center.y);
	const edgeBiased =
		dx > Math.max(6, params.box.width * 0.22) ||
		dy > Math.max(6, params.box.height * 0.22);
	if (!edgeBiased) {
		return { point: params.point, stabilized: false };
	}
	return { point: center, stabilized: true };
}

function normalizeResolvedAttempt(params: {
	decision: ParsedGroundingDecision;
	frame: PreparedGroundingModelFrame;
	providerName: string;
	round: number;
	action?: GuiGroundingActionIntent;
}): GroundingResolvedAttempt | undefined {
	if (
		params.decision.status !== "resolved" ||
		params.decision.coordinateSpace !== "image_pixels" ||
		!params.decision.point
	) {
		return undefined;
	}
	const point = scalePointToOriginalFrame(params.decision.point, params.frame);
	if (!point) {
		return undefined;
	}
	const box = scaleBoxToOriginalFrame(params.decision.box, params.frame);
	const stabilized = stabilizeGroundingPoint({
		point,
		box,
		action: params.action,
	});
	const raw = asRecord(params.decision.raw) ?? {};
	return {
		method: "grounding",
		provider: params.providerName,
		confidence: params.decision.confidence,
		reason: params.decision.reason,
		coordinateSpace: params.decision.coordinateSpace,
		point: stabilized.point,
		box,
		raw: stabilized.stabilized
			? {
				...raw,
				grounding_point_stabilized: true,
				grounding_original_point: point,
				grounding_stabilized_point: stabilized.point,
			}
			: params.decision.raw,
		modelPoint: params.decision.point,
		modelBox: params.decision.box,
		round: params.round,
	};
}

function withResolvedAttemptMetadata(
	result: GroundingResolvedAttempt,
	metadata: Record<string, unknown>,
): GroundingResolvedAttempt {
	const raw = asRecord(result.raw) ?? {};
	return {
		...result,
		raw: {
			...raw,
			...metadata,
		},
	};
}

function toPublicGroundingResult(result: GroundingResolvedAttempt, validation: ParsedGroundingValidationResponse): GuiGroundingResult {
	const raw = asRecord(result.raw) ?? {};
	return {
		method: "grounding",
		provider: result.provider,
		confidence: result.confidence,
		reason: result.reason,
		coordinateSpace: result.coordinateSpace,
		point: result.point,
		box: result.box,
		raw: {
			...raw,
			selected_attempt: "validated",
			grounding_selected_round: result.round,
			validation: validation.raw,
		},
	};
}

function toPublicPredictedGroundingResult(result: GroundingResolvedAttempt, skipReason: string): GuiGroundingResult {
	const raw = asRecord(result.raw) ?? {};
	return {
		method: "grounding",
		provider: result.provider,
		confidence: result.confidence,
		reason: result.reason,
		coordinateSpace: result.coordinateSpace,
		point: result.point,
		box: result.box,
		raw: {
			...raw,
			selected_attempt: "predicted",
			grounding_selected_round: result.round,
			validation: {
				status: "skipped",
				reason: skipReason,
			},
		},
	};
}

function buildRetryNotesFromDecision(params: {
	round: number;
	reason: string;
}): string[] {
	return [`Round ${params.round} predictor rationale: ${params.reason}`];
}

function buildRetryNotesFromValidation(params: {
	round: number;
	reason: string;
	failureKind?: GuiGroundingFailureKind;
	retryHint?: string;
	action?: GuiGroundingActionIntent;
}): string[] {
	return [
		`Round ${params.round} validator rejected the simulated action: ${params.reason}.`,
		...(params.failureKind ? [`Failure kind: ${formatGroundingFailureKind(params.failureKind)}.`] : []),
		...(params.retryHint ? [`Correction hint: ${params.retryHint}.`] : []),
		...(params.action === "type"
			? ["For typing, the simulated text must clearly land inside the editable field itself."]
			: []),
	];
}

export function createModelLoopGroundingProvider(
	options: SharedModelLoopGroundingProviderOptions,
): GuiGroundingProvider {
	const guideImageImpl = options.guideImageImpl ?? createGroundingGuideImage;
	const simulationImageImpl = options.simulationImageImpl ?? createGroundingSimulationImage;
	const prepareModelFrameImpl = options.prepareModelFrameImpl ?? defaultPrepareModelFrame;
	const maxRounds = Math.max(1, Math.min(3, Math.floor(options.maxRounds ?? 2)));

	return {
		async ground(params: GuiGroundingRequest): Promise<GuiGroundingResult | undefined> {
			const totalStart = performance.now();
			const loadStart = performance.now();
			const loaded = await loadImageSource(params.imagePath, DEFAULT_MAX_GROUNDING_IMAGE_BYTES);
			const timingTrace: {
				loadImageMs: number;
				totalMs?: number;
				rounds: GroundingRoundTiming[];
			} = {
				loadImageMs: Math.round(performance.now() - loadStart),
				rounds: [],
			};
			const fullFrame: GroundingFrame = {
				bytes: loaded.bytes,
				mimeType: loaded.probe.mimeType,
				width: loaded.probe.width,
				height: loaded.probe.height,
				localPath: loaded.localPath,
			};
			const modelFrame = await prepareModelFrameImpl(fullFrame, params);
			const cleanupFns: Array<() => Promise<void>> = [];
			let retryNotes = (params.previousFailures ?? [])
				.slice(0, 2)
				.map((failure, index) => describeGroundingFailure(scaleFailureToModelFrame(failure, modelFrame), index + 1));
			const retryFailures = [...(params.previousFailures ?? [])];
			const finalize = (result: GuiGroundingResult | undefined): GuiGroundingResult | undefined => {
				timingTrace.totalMs = Math.round(performance.now() - totalStart);
				if (!result) {
					return result;
				}
				const raw = asRecord(result.raw) ?? {};
				return {
					...result,
					raw: {
						...raw,
						grounding_mode_effective: normalizeGuiGroundingMode(params.groundingMode),
						grounding_validation_triggered: timingTrace.rounds.some((round) => round.validationTriggered),
						grounding_rounds_attempted: timingTrace.rounds.length,
						grounding_model_image: {
							width: modelFrame.frame.width,
							height: modelFrame.frame.height,
							mimeType: modelFrame.frame.mimeType,
							wasResized: modelFrame.wasResized,
						},
						grounding_working_image: {
							width: modelFrame.workingWidth ?? modelFrame.frame.width,
							height: modelFrame.workingHeight ?? modelFrame.frame.height,
							logicalNormalizationApplied: modelFrame.logicalNormalizationApplied,
						},
						grounding_original_image: {
							width: modelFrame.originalWidth ?? fullFrame.width,
							height: modelFrame.originalHeight ?? fullFrame.height,
							mimeType: fullFrame.mimeType,
						},
						grounding_request_image: {
							logicalWidth: params.logicalImageWidth,
							logicalHeight: params.logicalImageHeight,
							scaleX: params.imageScaleX,
							scaleY: params.imageScaleY,
						},
						grounding_model_to_original_scale: {
							x: modelFrame.modelToOriginalScaleX,
							y: modelFrame.modelToOriginalScaleY,
						},
						grounding_working_to_original_scale: {
							x: modelFrame.workingToOriginalScaleX,
							y: modelFrame.workingToOriginalScaleY,
						},
						grounding_timing_trace: timingTrace,
					},
				};
			};
			try {
				for (let round = 1; round <= maxRounds; round += 1) {
					const roundTiming: GroundingRoundTiming = {
						round,
						validationTriggered: false,
					};
					timingTrace.rounds.push(roundTiming);
					const latestFailure = retryFailures[retryFailures.length - 1];
					const latestFailureForModel = latestFailure
						? scaleFailureToModelFrame(latestFailure, modelFrame)
						: undefined;
					const retryFailuresForModel = retryFailures
						.slice(0, 2)
						.map((failure) => scaleFailureToModelFrame(failure, modelFrame));
					const shouldGenerateGuide = shouldGenerateGuideForFailure(latestFailure);
					const guideStart = performance.now();
					const guideImage =
						shouldGenerateGuide
							? await guideImageImpl({
								sourceBytes: modelFrame.frame.bytes,
								sourceMimeType: modelFrame.frame.mimeType,
								width: modelFrame.frame.width!,
								height: modelFrame.frame.height!,
								title: round === 1 ? "Grounding retry context" : `Grounding retry ${round}`,
								priorPoint: latestFailureForModel?.attemptedPoint,
								priorBox: latestFailureForModel?.attemptedBox,
								rejectionReason: latestFailureForModel?.summary,
							})
							: undefined;
					if (shouldGenerateGuide) {
						roundTiming.guideImageMs = Math.round(performance.now() - guideStart);
					}
					if (guideImage) {
						cleanupFns.push(guideImage.cleanup);
					}
					const guideLoaded = guideImage
						? await loadImageSource(guideImage.imagePath, DEFAULT_MAX_GROUNDING_IMAGE_BYTES)
						: undefined;
					const predictStart = performance.now();
					const predictionText = await options.invokeModel({
						stage: "predict",
						prompt: buildGroundingPrompt({
							target: params.target,
							scope: params.scope,
							app: params.app,
								width: modelFrame.frame.width,
								height: modelFrame.frame.height,
								systemPrompt: options.systemPrompt,
								groundingMode: params.groundingMode,
								action: params.action,
								locationHint: params.locationHint,
								captureMode: params.captureMode,
							windowTitle: params.windowTitle,
							relatedTarget: params.relatedTarget,
							relatedScope: params.relatedScope,
							relatedAction: params.relatedAction,
							relatedLocationHint: params.relatedLocationHint,
							relatedPoint: scalePointToModelFrame(params.relatedPoint, modelFrame),
							relatedBox: scaleBoxToModelFrame(params.relatedBox, modelFrame),
							retryNotes,
							previousFailures: retryFailuresForModel,
							hasGuideImage: Boolean(guideLoaded),
						}),
						images: [
							{ bytes: modelFrame.frame.bytes, mimeType: modelFrame.frame.mimeType },
							...(guideLoaded
								? [{ bytes: guideLoaded.bytes, mimeType: guideLoaded.probe.mimeType }]
								: []),
						],
					});
					roundTiming.predictModelMs = Math.round(performance.now() - predictStart);
						const decision = parseGroundingDecision({
							payload: extractJsonObjectGrounding(predictionText),
							providerName: options.providerName,
							action: params.action,
						});
					if (!decision || decision.status === "not_found") {
						const isDragAction = params.action === "drag_source" || params.action === "drag_destination";
						if (!isDragAction || round >= maxRounds) {
							return finalize(undefined);
						}
						retryFailures.push({
							summary: "not_found — retrying with additional context for drag target",
						});
						retryNotes = [
							...retryNotes,
							"The previous round returned not_found. Look more carefully: labeled card bodies, list items, and text elements that match the target description are valid drag surfaces even without drag-handle icons. Identify the element by its visible text label and return a click_point centered on it.",
						];
						continue;
					}
					const resolved = normalizeResolvedAttempt({
						decision,
						frame: modelFrame,
						providerName: options.providerName,
						round,
						action: params.action,
					});
					if (!resolved) {
						return finalize(undefined);
					}
					let candidateForValidation = resolved;
					if (shouldUseHighResolutionRefinement({
						request: params,
						resolved,
						frame: modelFrame,
					})) {
						const refinementImageStart = performance.now();
						const refinementFrame = await createPreparedCropFrame({
							fullFrame,
							request: params,
							candidate: resolved,
							prepareModelFrameImpl,
						});
						roundTiming.refinementImageMs = Math.round(performance.now() - refinementImageStart);
						if (refinementFrame) {
							const priorRefinementPoint = scalePointToModelFrame(resolved.point, refinementFrame);
							const priorRefinementBox = scaleBoxToModelFrame(resolved.box, refinementFrame);
							const refinementModelStart = performance.now();
							const refinementText = await options.invokeModel({
								stage: "predict",
								prompt: buildGroundingRefinementPrompt({
									target: params.target,
									scope: params.scope,
										app: params.app,
										width: refinementFrame.frame.width,
										height: refinementFrame.frame.height,
										action: params.action,
										locationHint: params.locationHint,
									windowTitle: params.windowTitle,
									captureMode: params.captureMode,
									priorPoint: priorRefinementPoint,
									priorBox: priorRefinementBox,
								}),
								images: [{ bytes: refinementFrame.frame.bytes, mimeType: refinementFrame.frame.mimeType }],
							});
							roundTiming.refinementModelMs = Math.round(performance.now() - refinementModelStart);
							const refinementDecision = parseGroundingDecision({
								payload: extractJsonObjectGrounding(refinementText),
								providerName: options.providerName,
								action: params.action,
							});
							if (refinementDecision?.status === "resolved") {
								const refined = normalizeResolvedAttempt({
									decision: refinementDecision,
									frame: refinementFrame,
									providerName: options.providerName,
									round,
									action: params.action,
								});
								if (refined) {
									candidateForValidation = withResolvedAttemptMetadata(refined, {
										grounding_refinement_applied: true,
										grounding_refinement_crop: {
											x: refinementFrame.offsetX,
											y: refinementFrame.offsetY,
											width: refinementFrame.originalWidth ?? refinementFrame.frame.width,
											height: refinementFrame.originalHeight ?? refinementFrame.frame.height,
										},
										grounding_refinement_model_image: {
											width: refinementFrame.frame.width,
											height: refinementFrame.frame.height,
											mimeType: refinementFrame.frame.mimeType,
											wasResized: refinementFrame.wasResized,
										},
									});
								}
							}
						}
					}
					const validationPlan = shouldValidateResolvedCandidate({ request: params });
					if (!validationPlan.required) {
						roundTiming.validationSkippedReason = validationPlan.reason;
						return finalize(toPublicPredictedGroundingResult(candidateForValidation, validationPlan.reason));
					}
					roundTiming.validationTriggered = true;
					const simulationStart = performance.now();
					const simulationImage =
						modelFrame.frame.width && modelFrame.frame.height
							? await simulationImageImpl({
								sourceBytes: modelFrame.frame.bytes,
								sourceMimeType: modelFrame.frame.mimeType,
								width: modelFrame.frame.width,
								height: modelFrame.frame.height,
								action: params.action,
								point: scalePointToModelFrame(candidateForValidation.point, modelFrame),
								box: scaleBoxToModelFrame(candidateForValidation.box, modelFrame),
								target: params.target,
							})
							: undefined;
					roundTiming.simulationImageMs = Math.round(performance.now() - simulationStart);
					if (!simulationImage) {
						return finalize(undefined);
					}
					cleanupFns.push(simulationImage.cleanup);
					const simulationLoaded = await loadImageSource(
						simulationImage.imagePath,
						DEFAULT_MAX_GROUNDING_IMAGE_BYTES,
					);
					const validateStart = performance.now();
					const validationText = await options.invokeModel({
						stage: "validate",
						prompt: buildGroundingValidationPrompt({
							target: params.target,
							action: params.action,
							scope: params.scope,
							app: params.app,
							width: modelFrame.frame.width,
								height: modelFrame.frame.height,
								locationHint: params.locationHint,
								windowTitle: params.windowTitle,
								captureMode: params.captureMode,
								round,
							}),
						images: [
							{ bytes: modelFrame.frame.bytes, mimeType: modelFrame.frame.mimeType },
							{ bytes: simulationLoaded.bytes, mimeType: simulationLoaded.probe.mimeType },
						],
					});
					roundTiming.validateModelMs = Math.round(performance.now() - validateStart);
					const validation = parseGroundingValidationResponseText(validationText);
					if (validation?.approved) {
						return finalize(toPublicGroundingResult(candidateForValidation, validation));
					}
					const failureKind = validation?.failureKind
						?? inferGroundingFailureKind({
							reason: validation?.reason,
							retryHint: validation?.retryHint,
						});

					retryNotes = [
						...retryNotes,
						...buildRetryNotesFromDecision({
							round,
							reason: candidateForValidation.reason,
						}),
							...buildRetryNotesFromValidation({
								round,
								reason: validation?.reason ?? "validator rejected the simulated action",
								failureKind,
								retryHint: validation?.retryHint,
								action: params.action,
							}),
						];
						retryFailures.push({
							summary: validation?.retryHint?.trim() || validation?.reason || "validator rejected the simulated action",
							failureKind,
							attemptedPoint: candidateForValidation.point,
							attemptedBox: candidateForValidation.box,
						});
				}
				return finalize(undefined);
			} finally {
				await Promise.allSettled(cleanupFns.splice(0).map((cleanup) => cleanup()));
			}
		},
	};
}
