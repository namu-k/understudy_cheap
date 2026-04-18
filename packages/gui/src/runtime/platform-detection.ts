import { execFileAsync } from "../exec-utils.js";
import type { GuiGroundingResult, GuiResolution, GuiScrollDistance, GuiTypeParams, GuiWindowSelector } from "../types.js";

/**
 * Generic point in 2D space (screen coordinates, image pixels, etc.).
 */
export interface GuiPoint {
	x: number;
	y: number;
}

/**
 * Axis-aligned rectangle.
 */
export interface GuiRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Window selection parameters used by native helper scripts.
 * Broader than GuiWindowSelector — includes optional bounds.
 */
export interface GuiScriptWindowSelection {
	title?: string;
	titleContains?: string;
	index?: number;
	bounds?: GuiRect;
}

// ---------------------------------------------------------------------------
// Platform support
// ---------------------------------------------------------------------------

export const GUI_UNSUPPORTED_MESSAGE = "GUI tools are currently supported on macOS and Windows only.";

export class GuiRuntimeError extends Error {
	override name = "GuiRuntimeError";
}

export function isGuiPlatformSupported(platform: NodeJS.Platform = process.platform): boolean {
	return platform === "darwin" || platform === "win32";
}

// ---------------------------------------------------------------------------
// Utility functions (pure logic, no side effects)
// ---------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export function normalizeOptionalString(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

export function stripSingleTrailingNewline(value: string): string {
	return value.replace(/\r?\n$/, "");
}

export function normalizeHotkeyKeyName(key: string): string {
	return key.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

export function normalizeRect(rect: GuiRect): GuiRect {
	return {
		x: Math.round(rect.x),
		y: Math.round(rect.y),
		width: Math.max(1, Math.round(rect.width)),
		height: Math.max(1, Math.round(rect.height)),
	};
}

export function rectContainsPoint(rect: GuiRect, point: GuiPoint, tolerance = 0): boolean {
	return point.x >= rect.x - tolerance &&
		point.x <= rect.x + rect.width + tolerance &&
		point.y >= rect.y - tolerance &&
		point.y <= rect.y + rect.height + tolerance;
}

export function clampPointToRect(point: GuiPoint, rect: GuiPoint & GuiRect): GuiPoint {
	return {
		x: clamp(point.x, rect.x, rect.x + rect.width),
		y: clamp(point.y, rect.y, rect.y + rect.height),
	};
}

// ---------------------------------------------------------------------------
// Type input resolution
// ---------------------------------------------------------------------------

export type GuiTypeInputSource = "value" | "secret_env" | "secret_command_env";

const DEFAULT_TYPE_INPUT_TIMEOUT_MS = 10_000;

export async function resolveGuiTypeInput(params: GuiTypeParams): Promise<{
	text: string;
	source: GuiTypeInputSource;
}> {
	const hasLiteralValue = typeof params.value === "string";
	const secretEnvVar = normalizeOptionalString(params.secretEnvVar);
	const secretCommandEnvVar = normalizeOptionalString(params.secretCommandEnvVar);
	const configuredSourceCount = [
		hasLiteralValue,
		Boolean(secretEnvVar),
		Boolean(secretCommandEnvVar),
	].filter(Boolean).length;
	if (configuredSourceCount !== 1) {
		throw new GuiRuntimeError(
			"GUI type requires exactly one input source: `value`, `secretEnvVar`, or `secretCommandEnvVar`.",
		);
	}
	if (hasLiteralValue) {
		return {
			text: params.value ?? "",
			source: "value",
		};
	}
	if (secretEnvVar) {
		const text = process.env[secretEnvVar];
		if (typeof text !== "string" || text.length === 0) {
			throw new GuiRuntimeError(
				`GUI secret env var "${secretEnvVar}" is missing or empty.`,
			);
		}
		return {
			text,
			source: "secret_env",
		};
	}
	if (!secretCommandEnvVar) {
		throw new GuiRuntimeError("GUI type input source could not be resolved.");
	}
	const command = process.env[secretCommandEnvVar];
	if (!command?.trim()) {
		throw new GuiRuntimeError(
			`GUI secret command env var "${secretCommandEnvVar}" is missing or empty.`,
		);
	}
	try {
		const { stdout } = await execFileAsync("zsh", ["-lc", command], {
			env: process.env,
			timeout: DEFAULT_TYPE_INPUT_TIMEOUT_MS,
			maxBuffer: 8 * 1024 * 1024,
			encoding: "utf-8",
		});
		const text = stripSingleTrailingNewline(stdout);
		if (!text.length) {
			throw new GuiRuntimeError(
				`GUI secret command env var "${secretCommandEnvVar}" produced empty output.`,
			);
		}
		return {
			text,
			source: "secret_command_env",
		};
	} catch (error) {
		if (error instanceof GuiRuntimeError) {
			throw error;
		}
		throw new GuiRuntimeError(
			`Failed to resolve GUI text from secret command env var "${secretCommandEnvVar}": ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

// ---------------------------------------------------------------------------
// Post-action capture settle
// ---------------------------------------------------------------------------

export function resolvePostActionCaptureSettleMsEnv(): number | undefined {
	const raw = process.env.UNDERSTUDY_GUI_POST_ACTION_CAPTURE_SETTLE_MS?.trim();
	if (!raw) {
		return undefined;
	}
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0) {
		return undefined;
	}
	return Math.round(parsed);
}

// ---------------------------------------------------------------------------
// Window selection
// ---------------------------------------------------------------------------

export function normalizeWindowSelector(
	value: GuiWindowSelector | undefined,
): GuiWindowSelector | undefined {
	if (!value) {
		return undefined;
	}
	const title = normalizeOptionalString(value.title);
	const titleContains = normalizeOptionalString(value.titleContains);
	const floored =
		typeof value.index === "number" && Number.isFinite(value.index)
			? Math.floor(value.index)
			: -1;
	const index = floored > 0 ? floored : undefined;
	if (!title && !titleContains && !index) {
		return undefined;
	}
	return {
		title,
		titleContains,
		index,
	};
}

export function resolveWindowSelection(params: {
	windowTitle?: string;
	windowSelector?: GuiWindowSelector;
}): GuiWindowSelector | undefined {
	const selector = normalizeWindowSelector(params.windowSelector);
	const explicitTitle = normalizeOptionalString(params.windowTitle);
	if (!selector && !explicitTitle) {
		return undefined;
	}
	return {
		title: explicitTitle ?? selector?.title,
		titleContains: selector?.titleContains,
		index: selector?.index,
	};
}

export function describeWindowSelection(windowSelector: GuiWindowSelector | undefined): string | undefined {
	if (!windowSelector) {
		return undefined;
	}
	const parts = [
		windowSelector.title ? `title "${windowSelector.title}"` : undefined,
		windowSelector.titleContains ? `title containing "${windowSelector.titleContains}"` : undefined,
		windowSelector.index ? `window #${windowSelector.index}` : undefined,
	].filter(Boolean);
	return parts.length > 0 ? parts.join(", ") : undefined;
}

export function buildWindowSelectionEnv(
	windowSelection: Pick<GuiScriptWindowSelection, "title" | "titleContains" | "index"> | undefined,
): Record<string, string | undefined> {
	return {
		UNDERSTUDY_GUI_WINDOW_TITLE: windowSelection?.title,
		UNDERSTUDY_GUI_WINDOW_TITLE_CONTAINS: windowSelection?.titleContains,
		UNDERSTUDY_GUI_WINDOW_INDEX: windowSelection?.index ? String(windowSelection.index) : undefined,
	};
}

export function buildWindowBoundsEnv(bounds: GuiRect | undefined): Record<string, string | undefined> {
	return {
		UNDERSTUDY_GUI_WINDOW_BOUNDS_X: bounds ? String(bounds.x) : undefined,
		UNDERSTUDY_GUI_WINDOW_BOUNDS_Y: bounds ? String(bounds.y) : undefined,
		UNDERSTUDY_GUI_WINDOW_BOUNDS_WIDTH: bounds ? String(bounds.width) : undefined,
		UNDERSTUDY_GUI_WINDOW_BOUNDS_HEIGHT: bounds ? String(bounds.height) : undefined,
	};
}

export function buildScriptWindowSelectionEnv(windowSelection: GuiScriptWindowSelection | undefined): Record<string, string | undefined> {
	return {
		...buildWindowSelectionEnv(windowSelection),
		...buildWindowBoundsEnv(windowSelection?.bounds),
	};
}

// ---------------------------------------------------------------------------
// Shared runtime types (used by both macOS and Win32 code paths)
// ---------------------------------------------------------------------------

export const DEFAULT_TIMEOUT_MS = 10_000;

export interface GuiNativeActionResult {
	actionKind: string;
}

export interface GuiDisplayDescriptor {
	index: number;
	bounds: GuiRect;
}

export interface GuiCaptureContext {
	appName?: string;
	display: GuiDisplayDescriptor;
	cursor: GuiPoint;
	windowId?: number;
	windowTitle?: string;
	windowBounds?: GuiRect;
	windowCount?: number;
	windowCaptureStrategy?: "selected_window" | "main_window" | "app_union";
}

export interface GuiCaptureMetadata {
	mode: "display" | "window";
	captureRect: GuiRect;
	display: GuiDisplayDescriptor;
	imageWidth?: number;
	imageHeight?: number;
	scaleX: number;
	scaleY: number;
	appName?: string;
	windowTitle?: string;
	windowCount?: number;
	windowCaptureStrategy?: "selected_window" | "main_window" | "app_union";
	cursor: GuiPoint;
	cursorVisible: boolean;
}

export interface GroundedGuiTarget {
	resolution: GuiResolution;
	point: GuiPoint;
	imagePoint?: GuiPoint;
	displayBox?: GuiRect;
	artifact: GuiCaptureMetadata;
	grounded: GuiGroundingResult;
}

export type PointActionIntent =
	| "click"
	| "right_click"
	| "double_click"
	| "hover"
	| "click_and_hold";

export type GuiScrollUnit = "line" | "pixel";
export type GuiScrollViewportSource = "target_box" | "capture_rect" | "window" | "display";

export interface ResolvedGuiScrollPlan {
	amount: number;
	distancePreset: GuiScrollDistance | "custom";
	unit: GuiScrollUnit;
	viewportDimension?: number;
	viewportSource?: GuiScrollViewportSource;
	travelFraction?: number;
}
