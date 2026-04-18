import type {
	GuiGroundingActionIntent,
	GuiGroundingCoordinateSpace,
	GuiGroundingFailure,
	GuiGroundingFailureKind,
	GuiGroundingMode,
	GuiGroundingRequest,
} from "@understudy/types";
import { normalizeGuiGroundingMode } from "@understudy/gui";
import { extractJsonObject } from "../response-extract-helpers.js";
import { asBoolean, asNumber, asRecord, asString } from "@understudy/core";

export interface GroundingPoint {
	x: number;
	y: number;
}

export interface GroundingBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

type GroundingDecisionStatus = "resolved" | "not_found";

interface ParsedNotFoundGroundingDecision {
	status: "not_found";
	confidence: number;
	reason: string;
	raw: Record<string, unknown>;
}

interface ParsedResolvedGroundingDecision {
	status: "resolved";
	confidence: number;
	reason: string;
	coordinateSpace: GuiGroundingCoordinateSpace;
	point: GroundingPoint;
	box?: GroundingBox;
	raw: Record<string, unknown>;
}

export type ParsedGroundingDecision = ParsedResolvedGroundingDecision | ParsedNotFoundGroundingDecision;

export interface ParsedGroundingResponse extends ParsedResolvedGroundingDecision {}

export interface ParsedGroundingValidationResponse {
	approved: boolean;
	confidence: number;
	reason: string;
	failureKind?: GuiGroundingFailureKind;
	retryHint?: string;
	raw: Record<string, unknown>;
}

const GROUNDING_FAILURE_KINDS = new Set<GuiGroundingFailureKind>([
	"wrong_region",
	"scope_mismatch",
	"wrong_control",
	"wrong_point",
	"state_mismatch",
	"partial_visibility",
	"other",
]);

export function formatGroundingActionIntent(action: GuiGroundingActionIntent | undefined): string {
	return action ? action.replace(/_/g, " ") : "locate";
}

function describeRelatedGroundingContext(params: {
	relatedTarget?: string;
	relatedScope?: string;
	relatedAction?: GuiGroundingActionIntent;
	relatedLocationHint?: string;
	relatedPoint?: GroundingPoint;
	relatedBox?: GroundingBox;
}): string[] {
	const lines: string[] = [];
	const action = params.relatedAction ? formatGroundingActionIntent(params.relatedAction) : "related target";
	const targetParts = [
		params.relatedTarget ? `target "${params.relatedTarget}"` : undefined,
		params.relatedLocationHint ? `location "${params.relatedLocationHint}"` : undefined,
		params.relatedScope ? `scope "${params.relatedScope}"` : undefined,
	].filter(Boolean);
	if (targetParts.length > 0) {
		lines.push(`- The ${action} is ${targetParts.join(", ")}.`);
	}
	if (params.relatedPoint) {
		lines.push(
			`- Related point: (${Math.round(params.relatedPoint.x)}, ${Math.round(params.relatedPoint.y)}).`,
		);
	}
	if (params.relatedBox) {
		lines.push(
			`- Related box: x=${Math.round(params.relatedBox.x)}, y=${Math.round(params.relatedBox.y)}, width=${Math.round(params.relatedBox.width)}, height=${Math.round(params.relatedBox.height)}.`,
		);
	}
	return lines;
}

function actionSpecificGroundingInstructions(action: GuiGroundingActionIntent | undefined): string[] {
	switch (action) {
		case "observe":
			return [
				"Resolve the visible element or content region that should be inspected.",
				"The bbox should cover the observable target itself, not surrounding whitespace, wallpaper, or generic container chrome.",
				"If the requested target is only implied by nearby labels but the visual element itself is not visible, return status=\"not_found\".",
			];
		case "click":
		case "right_click":
		case "double_click":
		case "hover":
		case "click_and_hold":
			return [
				"Resolve the actionable surface that visibly supports the requested action.",
				"Choose the control itself, such as a button, tab, menu item, list row, checkbox, icon button, or editable field, not surrounding whitespace, wallpaper, or generic container background.",
				"If you can identify only a broad region or container but not the actionable control itself, return status=\"not_found\" instead of guessing a background point.",
				"For clicks, target the clickable surface near the control center unless the visible affordance suggests another safer point.",
				"Return an explicit click_point for the exact actionable surface; do not rely on bbox-only answers.",
			];
		case "drag_source":
			return [
				"Resolve the actual draggable surface itself, such as the slider thumb, drag handle, card body, file icon, or selected chip that should be pressed and held.",
				"A labeled card body, list item, or text element that clearly represents a draggable object IS a valid drag source surface, even without an explicit drag handle icon. If the target description matches a visible labeled element, treat that element as the drag source.",
				"Choose a click_point on the visible press-and-hold surface that should initiate the drag, not on surrounding whitespace, the track, or generic container background.",
				"Return status=\"not_found\" only if no element matching the target description is visible at all, not merely because the element lacks a drag-handle icon.",
			];
		case "drag_destination":
			return [
				"Resolve the actual droppable target surface where release should occur, such as the slot, drop zone, list gap, container interior, or destination icon itself.",
				"Choose a click_point on the release surface itself, not on surrounding whitespace, the margin around a drop zone, or a nearby label.",
				"If you can identify only a broad region or container but not the actual drag destination surface, return status=\"not_found\".",
			];
		case "type":
			return [
				"The resolved box must overlap the visible editable field or composer surface itself.",
				"For text entry, target the editable interior where the caret should appear, not the area above or below the field and not surrounding toolbar, wallpaper, or container background.",
				"For empty or single-line fields, prefer a safe point inside the left side of the editable interior where a caret would normally appear, not the visual center of the whole field.",
				"For large text areas or code editors, target the text content area where typing should occur.",
				"If you can identify only the broad composer region but not the editable field itself, return status=\"not_found\" instead of guessing.",
				"Return an explicit click_point inside the editable interior.",
			];
		case "scroll":
			return [
				"Resolve the scrollable container or viewport region itself, not a heading or static label within it.",
				"The bbox should cover the area that will receive the scroll gesture — typically the content pane, not a title bar or sidebar header.",
				"If you can only see a heading but not a scrollable region, return status=\"not_found\".",
			];
		case "wait":
			return [
				"Resolve the visual element whose presence or absence is being monitored.",
				"Choose the distinct visible indicator, badge, banner, row, panel, or content block whose state is changing, not a vague surrounding container.",
				"The bbox should cover the observable indicator or content area itself, not surrounding whitespace or generic layout chrome.",
				"If the requested target is not distinctly visible yet, return status=\"not_found\" instead of guessing a likely region.",
			];
		case "key":
		case "move":
		default:
			return [];
	}
}

function actionRequiresExplicitPoint(action: GuiGroundingActionIntent | undefined): boolean {
	switch (action) {
		case "click":
		case "right_click":
		case "double_click":
		case "hover":
		case "click_and_hold":
		case "drag_source":
		case "drag_destination":
		case "type":
			return true;
		case "observe":
		case "scroll":
		case "wait":
		case "key":
		case "move":
		default:
			return false;
	}
}

function extractBooleanField(text: string, field: string): boolean | undefined {
	const match = text.match(new RegExp(`"${field}"\\s*:\\s*(true|false)`, "i"));
	if (!match) {
		return undefined;
	}
	return match[1]?.toLowerCase() === "true";
}

function extractNumberField(text: string, field: string): number | undefined {
	const match = text.match(new RegExp(`"${field}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "i"));
	if (!match?.[1]) {
		return undefined;
	}
	const value = Number(match[1]);
	return Number.isFinite(value) ? value : undefined;
}

function extractStringField(text: string, field: string): string | undefined {
	const match = text.match(new RegExp(`"${field}"\\s*:\\s*"([^"]*)"`, "i"));
	return match?.[1];
}

function extractDecisionStatusField(text: string): GroundingDecisionStatus | undefined {
	const value = extractStringField(text, "status")?.toLowerCase();
	if (value === "resolved" || value === "not_found") {
		return value;
	}
	return undefined;
}

function extractPointField(text: string, field: string): GroundingPoint | undefined {
	const match = text.match(
		new RegExp(`"${field}"\\s*:\\s*\\{[^{}]*?"x"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)[^{}]*?"y"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "i"),
	);
	if (!match?.[1] || !match[2]) {
		return undefined;
	}
	const x = Number(match[1]);
	const y = Number(match[2]);
	return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

function extractBoxField(text: string, field: string): Record<string, number> | undefined {
	const x1y1x2y2 = text.match(
		new RegExp(`"${field}"\\s*:\\s*\\{[^{}]*?"x1"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)[^{}]*?"y1"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)[^{}]*?"x2"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)[^{}]*?"y2"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "i"),
	);
	if (x1y1x2y2?.[1] && x1y1x2y2[2] && x1y1x2y2[3] && x1y1x2y2[4]) {
		return {
			x1: Number(x1y1x2y2[1]),
			y1: Number(x1y1x2y2[2]),
			x2: Number(x1y1x2y2[3]),
			y2: Number(x1y1x2y2[4]),
		};
	}
	const xywh = text.match(
		new RegExp(`"${field}"\\s*:\\s*\\{[^{}]*?"x"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)[^{}]*?"y"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)[^{}]*?"width"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)[^{}]*?"height"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "i"),
	);
	if (xywh?.[1] && xywh[2] && xywh[3] && xywh[4]) {
		return {
			x: Number(xywh[1]),
			y: Number(xywh[2]),
			width: Number(xywh[3]),
			height: Number(xywh[4]),
		};
	}
	return undefined;
}

function salvageGroundingObject(text: string): Record<string, unknown> | undefined {
	const found = extractBooleanField(text, "found");
	const status = extractDecisionStatusField(text);
	if (found === undefined && !status) {
		return undefined;
	}
	const payload: Record<string, unknown> = found !== undefined ? { found } : {};
	if (status) {
		payload.status = status;
	}
	const confidence = extractNumberField(text, "confidence");
	if (confidence !== undefined) {
		payload.confidence = confidence;
	}
	const reason = extractStringField(text, "reason");
	if (reason) {
		payload.reason = reason;
	}
	const coordinateSpace = extractStringField(text, "coordinate_space");
	if (coordinateSpace) {
		payload.coordinate_space = coordinateSpace;
	}
	const point =
		extractPointField(text, "click_point") ??
		extractPointField(text, "target_point") ??
		extractPointField(text, "point");
	if (point) {
		payload.click_point = point;
	}
	const box = extractBoxField(text, "bbox") ?? extractBoxField(text, "box");
	if (box) {
		payload.bbox = box;
	}
	return payload;
}

export function extractJsonObjectGrounding(text: string): Record<string, unknown> {
	try {
		return extractJsonObject(text, "Grounding response");
	} catch (error) {
		const salvaged = salvageGroundingObject(text.trim());
		if (salvaged) {
			return salvaged;
		}
		throw error;
	}
}

function parseCoordinateSpace(value: string | undefined): GuiGroundingCoordinateSpace | undefined {
	if (value === undefined) {
		return "image_pixels";
	}
	if (value === "image_pixels") {
		return "image_pixels";
	}
	if (value === "display_pixels") {
		return value as GuiGroundingCoordinateSpace;
	}
	return undefined;
}

function parseGroundingBox(
	payload: Record<string, unknown>,
): GroundingBox | undefined {
	const rawBox = asRecord(payload.bbox) ?? asRecord(payload.box);
	if (!rawBox) return undefined;

	let x1 = asNumber(rawBox.x1) ?? asNumber(rawBox.left) ?? asNumber(rawBox.x);
	let y1 = asNumber(rawBox.y1) ?? asNumber(rawBox.top) ?? asNumber(rawBox.y);
	let x2 = asNumber(rawBox.x2) ?? asNumber(rawBox.right);
	let y2 = asNumber(rawBox.y2) ?? asNumber(rawBox.bottom);
	const width = asNumber(rawBox.width);
	const height = asNumber(rawBox.height);
	if (x2 === undefined && x1 !== undefined && width !== undefined) {
		x2 = x1 + width;
	}
	if (y2 === undefined && y1 !== undefined && height !== undefined) {
		y2 = y1 + height;
	}
	if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
		return undefined;
	}

	const normalizedX1 = Math.min(x1, x2);
	const normalizedY1 = Math.min(y1, y2);
	const normalizedX2 = Math.max(x1, x2);
	const normalizedY2 = Math.max(y1, y2);
	if (normalizedX2 <= normalizedX1 || normalizedY2 <= normalizedY1) {
		return undefined;
	}
	return {
		x: normalizedX1,
		y: normalizedY1,
		width: normalizedX2 - normalizedX1,
		height: normalizedY2 - normalizedY1,
	};
}

function parseGroundingPoint(
	payload: Record<string, unknown>,
): GroundingPoint | undefined {
	const rawPoint =
		asRecord(payload.click_point) ??
		asRecord(payload.target_point) ??
		asRecord(payload.point);
	if (!rawPoint) {
		return undefined;
	}

	let x = asNumber(rawPoint.x) ?? asNumber(rawPoint.cx);
	let y = asNumber(rawPoint.y) ?? asNumber(rawPoint.cy);
	if (x === undefined || y === undefined) {
		return undefined;
	}

	return { x, y };
}

function inferDecisionStatus(payload: Record<string, unknown>): GroundingDecisionStatus {
	const explicitStatus = asString(payload.status)?.toLowerCase();
	if (explicitStatus === "resolved" || explicitStatus === "not_found") {
		return explicitStatus;
	}
	if (asBoolean(payload.found) === false) {
		return "not_found";
	}
	return "resolved";
}

export function centerPointFromBox(box: GroundingBox | undefined): GroundingPoint | undefined {
	return box
		? {
			x: box.x + (box.width / 2),
			y: box.y + (box.height / 2),
		}
		: undefined;
}

export function parseGroundingDecision(params: {
	payload: Record<string, unknown>;
	providerName: string;
	action?: GuiGroundingActionIntent;
}): ParsedGroundingDecision | undefined {
	const status = inferDecisionStatus(params.payload);
	if (status === "not_found") {
		return {
			status,
			confidence: asNumber(params.payload.confidence) ?? 0,
			reason: asString(params.payload.reason) ?? `${params.providerName} grounding did not find the requested target.`,
			raw: params.payload,
		};
	}
	const coordinateSpace = parseCoordinateSpace(asString(params.payload.coordinate_space));
	if (!coordinateSpace) {
		return undefined;
	}
	const box = parseGroundingBox(params.payload);
	const parsedPoint = parseGroundingPoint(params.payload);
	const point = parsedPoint ??
		(actionRequiresExplicitPoint(params.action) ? undefined : centerPointFromBox(box));
	if (!point) {
		return undefined;
	}
	return {
		status,
		confidence: asNumber(params.payload.confidence) ?? 0.75,
		reason: asString(params.payload.reason) ?? `${params.providerName} grounding matched the requested target.`,
		coordinateSpace,
		point,
		box,
		raw: params.payload,
	};
}

function parseGroundingPayload(params: {
	payload: Record<string, unknown>;
	providerName: string;
	action?: GuiGroundingActionIntent;
}): ParsedGroundingResponse | undefined {
	const decision = parseGroundingDecision(params);
	if (!decision || decision.status !== "resolved") {
		return undefined;
	}
	return decision;
}

function normalizeGroundingFailureKind(value: string | undefined): GuiGroundingFailureKind | undefined {
	const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, "_");
	if (!normalized || !GROUNDING_FAILURE_KINDS.has(normalized as GuiGroundingFailureKind)) {
		return undefined;
	}
	return normalized as GuiGroundingFailureKind;
}

export function inferGroundingFailureKind(params: {
	reason?: string;
	retryHint?: string;
}): GuiGroundingFailureKind | undefined {
	const text = `${params.reason ?? ""} ${params.retryHint ?? ""}`.trim().toLowerCase();
	if (!text) {
		return undefined;
	}
	if (/\b(clipped|clip|partial|partially visible|cut off|edge of screenshot|edge of image|offscreen)\b/.test(text)) {
		return "partial_visibility";
	}
	if (/\b(disabled|greyed out|grayed out|selected state|wrong state|unchecked|checked|active state|inactive state)\b/.test(text)) {
		return "state_mismatch";
	}
	if (/\b(wrong panel|wrong sidebar|wrong dialog|wrong tab|wrong section|wrong column|wrong row|different panel|different dialog|different tab|scope mismatch|outside scope)\b/.test(text)) {
		return "scope_mismatch";
	}
	if (/\b(move lower|move higher|move left|move right|inside editor|inside field|inside the field|inside the editor|inside the button|inside the control|hit target|click point|point lands|point misses|point outside)\b/.test(text)) {
		return "wrong_point";
	}
	if (/\b(wrong field|wrong button|wrong control|neighboring control|adjacent control|other icon|other button|other field|other dropdown|other row|other menu item)\b/.test(text)) {
		return "wrong_control";
	}
	if (/\b(background|whitespace|padding|decoration|generic container|container background|sidebar chrome|chrome|wallpaper|broad region|wrong region|wrong area|empty area|blank area|lower toolbar|upper toolbar)\b/.test(text)) {
		return "wrong_region";
	}
	return "other";
}

function salvageValidationObject(text: string): Record<string, unknown> | undefined {
	const approved = extractBooleanField(text, "approved");
	const status = extractStringField(text, "status")?.toLowerCase();
	if (approved === undefined && status !== "pass" && status !== "fail") {
		return undefined;
	}
	const payload: Record<string, unknown> = {};
	if (approved !== undefined) {
		payload.approved = approved;
	}
	if (status === "pass" || status === "fail") {
		payload.status = status;
	}
	const confidence = extractNumberField(text, "confidence");
	if (confidence !== undefined) {
		payload.confidence = confidence;
	}
	const reason = extractStringField(text, "reason");
	if (reason) {
		payload.reason = reason;
	}
	const retryHint = extractStringField(text, "retry_hint");
	if (retryHint) {
		payload.retry_hint = retryHint;
	}
	const failureKind = extractStringField(text, "failure_kind");
	if (failureKind) {
		payload.failure_kind = failureKind;
	}
	return payload;
}

function extractJsonObjectWithValidationFallback(text: string): Record<string, unknown> {
	try {
		return extractJsonObject(text);
	} catch (error) {
		const salvaged = salvageValidationObject(text.trim());
		if (salvaged) {
			return salvaged;
		}
		throw error;
	}
}

export function buildGroundingPrompt(params: {
	target: string;
	scope?: string;
	app?: string;
	width?: number;
	height?: number;
	systemPrompt?: string;
	groundingMode?: GuiGroundingMode;
	action?: GuiGroundingActionIntent;
	locationHint?: string;
	captureMode?: "display" | "window";
	windowTitle?: string;
	relatedTarget?: string;
	relatedScope?: string;
	relatedAction?: GuiGroundingActionIntent;
	relatedLocationHint?: string;
	relatedPoint?: GroundingPoint;
	relatedBox?: GroundingBox;
	retryNotes?: string[];
	previousFailures?: GuiGroundingFailure[];
	hasGuideImage?: boolean;
}): string {
	const previousFailureLines = (params.previousFailures ?? [])
		.slice(0, 2)
		.map((failure, index) => describeGroundingFailure(failure, index + 1));
	const relatedContextLines = describeRelatedGroundingContext(params);
	const groundingMode = normalizeGuiGroundingMode(params.groundingMode);
	const requiresExplicitPoint = actionRequiresExplicitPoint(params.action);
	return [
		params.systemPrompt ?? "You are a GUI grounding model.",
		"Ground the single best UI target in this screenshot.",
		`Action intent: ${formatGroundingActionIntent(params.action)}.`,
		`Target description: ${params.target}`,
		...(params.locationHint ? [`Coarse location hint: ${params.locationHint}`] : []),
		...(params.scope ? [`Scope hint: ${params.scope}`] : []),
		...(params.app ? [`App hint: ${params.app}`] : []),
		...(params.windowTitle ? [`Window title hint: ${params.windowTitle}`] : []),
		...(params.captureMode ? [`Capture mode: ${params.captureMode}.`] : []),
		...(params.width && params.height ? [`Image size: ${params.width}x${params.height} pixels.`] : []),
		`Grounding mode requested by the caller: ${groundingMode}.`,
		...(relatedContextLines.length > 0
			? ["Related target context:", ...relatedContextLines]
			: []),
		...(previousFailureLines.length > 0
			? ["Recent failed attempts:", ...previousFailureLines]
			: []),
		...(params.retryNotes?.length
			? ["Retry context:", ...params.retryNotes.map((line) => `- ${line}`)]
			: []),
		...(previousFailureLines.length > 0
			? [
				"If a previous failure is classified as wrong_region or scope_mismatch, search a different visible area or panel instead of staying near that candidate.",
				"If a previous failure is classified as wrong_control, wrong_point, state_mismatch, or partial_visibility, use it only as local negative evidence and move to a different visible hit target or safer point.",
			]
			: []),
		...(params.hasGuideImage
			? [
				"An additional guide image is provided with the same screenshot plus a red overlay showing the previously rejected candidate.",
				"Do not repeat the red marked candidate unless the rejection reason is clearly contradicted by stronger visible evidence.",
			]
			: []),
		"You are grounding one target on the provided screenshot, not using a built-in computer-use grid.",
		"Use only visible screenshot evidence. Do not rely on hidden accessibility labels, DOM ids, or implementation names.",
		'Return screenshot-relative coordinates with coordinate_space set to "image_pixels".',
		"Choose the exact point a careful operator should use for this action intent.",
		"The bbox must tightly cover the actionable/editable surface itself, not a larger container.",
		"Disambiguate similar controls using scope, coarse location, nearby visible text, local grouping, and relative order.",
		"Match subtle or weakly labeled controls by the visible label, symbol, indicator, shape, and surrounding context together.",
		"Choose the smallest obvious actionable or editable surface, and keep the click_point on the visible hit target instead of whitespace, padding, decoration, or generic container background.",
		"When the request refers to text adjacent to a control, target the actual control or indicator rather than the descriptive text.",
		"If a control appears disabled or greyed-out and the target description does not explicitly say disabled, prefer an enabled matching control if one exists. If the only match is disabled, still resolve it but mention the disabled state in the reason.",
		"If the target has a visual state qualifier (selected, checked, active, highlighted, disabled), use that state to disambiguate among similar controls.",
		"If the target is only partially visible (clipped at a screenshot edge), resolve to a point inside the visible portion if confidently identifiable; otherwise return not_found.",
		...actionSpecificGroundingInstructions(params.action),
		"The click_point must be inside the bbox, and both must use the same coordinate system.",
		"Keep the reason terse, at most 8 words.",
		"Return strict JSON only with this schema:",
		'{"status":"resolved|not_found","found":true|false,"confidence":0.0,"reason":"short reason","coordinate_space":"image_pixels","click_point":{"x":0,"y":0},"bbox":{"x1":0,"y1":0,"x2":0,"y2":0}}',
		...(requiresExplicitPoint
			? [
				"If you cannot provide a safe explicit click_point inside the actionable surface, return status=\"not_found\" instead of returning a bbox-only guess.",
				"Do not omit click_point for interactive actions.",
			]
			: ["If the best click point is unclear, still return the best bbox and omit click_point."]),
		'Use status "resolved" when you have a best candidate and "not_found" when the target is missing or too ambiguous.',
		"If the target is missing, ambiguous, or not clearly visible/clickable, return status=\"not_found\" (and found=false if included) and omit bbox.",
	].join("\n");
}

export function buildGroundingValidationPrompt(params: {
	target: string;
	action?: GuiGroundingActionIntent;
	scope?: string;
	app?: string;
	width?: number;
	height?: number;
	locationHint?: string;
	windowTitle?: string;
	captureMode?: "display" | "window";
	round?: number;
}): string {
	const action = formatGroundingActionIntent(params.action);
	return [
		"You are a GUI grounding validator.",
		"You receive the original screenshot and a second image showing the simulated action overlay for the candidate returned by a separate grounding model.",
		`Action intent: ${action}.`,
		`Target description: ${params.target}`,
		...(params.locationHint ? [`Coarse location hint: ${params.locationHint}`] : []),
		...(params.scope ? [`Scope hint: ${params.scope}`] : []),
		...(params.app ? [`App hint: ${params.app}`] : []),
		...(params.windowTitle ? [`Window title hint: ${params.windowTitle}`] : []),
		...(params.captureMode ? [`Capture mode: ${params.captureMode}.`] : []),
		...(params.width && params.height ? [`Image size: ${params.width}x${params.height} pixels.`] : []),
		...(params.round ? [`Validation round: ${params.round}.`] : []),
		"The simulated image marks the candidate bbox and click point very explicitly. Judge that exact marked candidate.",
		"Rely on visible pixels in the screenshot and simulation overlay, not on any prior rationale.",
		"Approve only if the simulated action lands on the exact requested target or on a safe actionable/editable surface that unambiguously corresponds to it.",
		"Reject if the simulated action lands on whitespace, padding, decoration, generic container background, or on a neighboring control whose visible evidence does not match the request.",
		"For drag source actions, a labeled card body or list item that matches the target description is a valid drag surface even without an explicit drag-handle icon. Do not reject solely because the element looks like a plain card or container if its label matches the requested target.",
		"If a scope or location hint was provided, the candidate must be inside that scope/region. Two controls with identical labels in different panels should be distinguished by scope.",
		"For subtle, tightly packed, or low-contrast controls, approve only when the marked point sits on the visible hit target itself. Minor positional offset within the control's visible hit area is acceptable as long as the click clearly lands on the correct control.",
		"If you reject, explain the mistake in concrete visual terms so the next grounding round can avoid it.",
		"If you reject, also classify the primary failure_kind as one of: wrong_region, scope_mismatch, wrong_control, wrong_point, state_mismatch, partial_visibility, or other.",
		"Use wrong_region when the candidate is in the wrong broad area; scope_mismatch for the wrong panel/list/row/dialog; wrong_control for the wrong nearby control; wrong_point when the control is right but the click lands badly; state_mismatch for the wrong selected/checked/enabled state; partial_visibility when the target is too clipped for a safe action.",
		"Keep the reason terse, at most 10 words. Keep retry_hint terse, at most 18 words.",
		"Return strict JSON only with this schema:",
		'{"status":"pass|fail","approved":true|false,"confidence":0.0,"reason":"short reason","failure_kind":"wrong_region|scope_mismatch|wrong_control|wrong_point|state_mismatch|partial_visibility|other","retry_hint":"short correction for next round"}',
	].join("\n");
}

export function describeGroundingFailure(failure: GuiGroundingFailure, index: number): string {
	const parts = [`- Attempt ${index}: ${failure.summary.trim()}`];
	if (failure.failureKind) {
		parts.push(`failure kind=${failure.failureKind}`);
	}
	if (failure.attemptedPoint) {
		parts.push(
			`previous point=(${Math.round(failure.attemptedPoint.x)}, ${Math.round(failure.attemptedPoint.y)})`,
		);
	}
	if (failure.attemptedBox) {
		parts.push(
			`previous box x=${Math.round(failure.attemptedBox.x)}, y=${Math.round(failure.attemptedBox.y)}, width=${Math.round(failure.attemptedBox.width)}, height=${Math.round(failure.attemptedBox.height)}`,
		);
	}
	return parts.join("; ");
}

export function parseGroundingResponseText(params: {
	text: string;
	providerName: string;
	action?: GuiGroundingActionIntent;
}): ParsedGroundingResponse | undefined {
	return parseGroundingPayload({
		payload: extractJsonObjectGrounding(params.text),
		providerName: params.providerName,
		action: params.action,
	});
}

export function parseGroundingValidationResponseText(text: string): ParsedGroundingValidationResponse | undefined {
	const payload = extractJsonObjectWithValidationFallback(text);
	const explicitStatus = asString(payload.status)?.toLowerCase();
	const approved = explicitStatus === "pass"
		? true
		: explicitStatus === "fail"
			? false
			: asBoolean(payload.approved);
	if (approved === undefined) {
		return undefined;
	}
	const reason = asString(payload.reason) ?? (approved ? "validator approved" : "validator rejected");
	const retryHint = asString(payload.retry_hint);
	const failureKind = normalizeGroundingFailureKind(asString(payload.failure_kind))
		?? (!approved ? inferGroundingFailureKind({ reason, retryHint }) : undefined);
	return {
		approved,
		confidence: asNumber(payload.confidence) ?? 0.75,
		reason,
		failureKind,
		retryHint,
		raw: payload,
	};
}

export function shouldValidateResolvedCandidate(params: {
	request: GuiGroundingRequest;
}): { required: boolean; reason: string } {
	switch (params.request.action) {
		case "observe":
		case "wait":
			return {
				required: false,
				reason: "observation grounding does not require simulated action validation",
			};
		default:
			break;
	}
	if (params.request.groundingMode === "complex") {
		return { required: true, reason: "complex grounding was explicitly requested" };
	}
	return {
		required: false,
		reason: "single-round grounding requested by caller",
	};
}
