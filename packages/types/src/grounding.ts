/**
 * Shared GUI grounding interfaces for @understudy/tools and @understudy/gateway.
 *
 * Grounding resolves semantic GUI targets (e.g., "click the save button")
 * to screen coordinates via LLM-based prediction or platform-specific APIs.
 *
 * This file contains only the grounding-level types. Action execution interfaces,
 * demonstration recorder types, and runtime types remain in @understudy/gui.
 */

export type GuiGroundingActionIntent =
	| "observe"
	| "click"
	| "right_click"
	| "double_click"
	| "hover"
	| "click_and_hold"
	| "drag"
	| "drag_source"
	| "drag_destination"
	| "scroll"
	| "type"
	| "key"
	| "wait"
	| "move";

export type GuiCaptureMode = "window" | "display";

export interface GuiGroundingBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

export type GuiGroundingCoordinateSpace = "image_pixels" | "display_pixels";
export type GuiGroundingMode = "single" | "complex";
export type GuiGroundingFailureKind =
	| "wrong_region"
	| "scope_mismatch"
	| "wrong_control"
	| "wrong_point"
	| "state_mismatch"
	| "partial_visibility"
	| "other";

export interface GuiGroundingFailure {
	summary: string;
	failureKind?: GuiGroundingFailureKind;
	attemptedPoint?: {
		x: number;
		y: number;
	};
	attemptedBox?: GuiGroundingBox;
}

export interface GuiGroundingRequest {
	imagePath: string;
	logicalImageWidth?: number;
	logicalImageHeight?: number;
	imageScaleX?: number;
	imageScaleY?: number;
	target: string;
	scope?: string;
	app?: string;
	action?: GuiGroundingActionIntent;
	groundingMode?: GuiGroundingMode;
	locationHint?: string;
	captureMode?: GuiCaptureMode;
	windowTitle?: string;
	relatedTarget?: string;
	relatedScope?: string;
	relatedAction?: GuiGroundingActionIntent;
	relatedLocationHint?: string;
	relatedPoint?: {
		x: number;
		y: number;
	};
	relatedBox?: GuiGroundingBox;
	previousFailures?: GuiGroundingFailure[];
}

export interface GuiGroundingResult {
	method: "grounding";
	provider: string;
	confidence: number;
	reason: string;
	coordinateSpace: GuiGroundingCoordinateSpace;
	point: {
		x: number;
		y: number;
	};
	box?: GuiGroundingBox;
	raw?: unknown;
}

export interface GuiGroundingProvider {
	ground(params: GuiGroundingRequest): Promise<GuiGroundingResult | undefined>;
}
