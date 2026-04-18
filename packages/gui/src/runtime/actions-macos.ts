import { execFileAsync } from "../exec-utils.js";
import { resolveNativeGuiHelperBinary } from "../native-helper.js";
import type { GuiCaptureMode, GuiClickParams, GuiKeyParams, GuiScrollDistance, GuiScrollParams, GuiTypeParams, GuiWindowSelector } from "../types.js";
import {
	buildScriptWindowSelectionEnv,
	buildWindowSelectionEnv,
	clamp,
	DEFAULT_TIMEOUT_MS,
	describeWindowSelection,
	GuiRuntimeError,
	normalizeHotkeyKeyName,
	normalizeOptionalString,
	normalizeRect,
	resolveWindowSelection,
	type GuiCaptureContext,
	type GuiCaptureMetadata,
	type GuiDisplayDescriptor,
	type GuiNativeActionResult,
	type GuiPoint,
	type GuiRect,
	type GuiScriptWindowSelection,
	type GroundedGuiTarget,
	type PointActionIntent,
	type ResolvedGuiScrollPlan,
} from "./platform-detection.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DRAG_STEPS = 24;
const DEFAULT_NATIVE_TYPE_CLEAR_REPEAT = 48;
const DEFAULT_SYSTEM_EVENTS_PASTE_PRE_DELAY_MS = 220;
const DEFAULT_SYSTEM_EVENTS_PASTE_POST_DELAY_MS = 650;
const DEFAULT_SYSTEM_EVENTS_KEYSTROKE_CHAR_DELAY_MS = 55;
const DEFAULT_TARGETED_SCROLL_DISTANCE: GuiScrollDistance = "medium";
const DEFAULT_TARGETLESS_SCROLL_DISTANCE: GuiScrollDistance = "page";
const DEFAULT_SCROLL_AMOUNT = 5;
const SCROLL_DISTANCE_AMOUNTS: Record<GuiScrollDistance, number> = {
	small: 3,
	medium: DEFAULT_SCROLL_AMOUNT,
	page: 12,
};
const SCROLL_DISTANCE_FRACTIONS: Record<GuiScrollDistance, number> = {
	small: 0.25,
	medium: 0.5,
	page: 0.75,
};

const COMMON_KEY_CODES: Record<string, number> = {
	enter: 36,
	return: 36,
	tab: 48,
	escape: 53,
	esc: 53,
	delete: 51,
	backspace: 51,
	home: 115,
	pageup: 116,
	pagedown: 121,
	end: 119,
	up: 126,
	arrowup: 126,
	down: 125,
	arrowdown: 125,
	left: 123,
	arrowleft: 123,
	right: 124,
	arrowright: 124,
	space: 49,
	spacebar: 49,
};

// ---------------------------------------------------------------------------
// Click action intent resolution
// ---------------------------------------------------------------------------

export function resolveClickActionIntent(params: GuiClickParams): PointActionIntent {
	if (params.button === "right") return "right_click";
	if (params.clicks === 2) return "double_click";
	if (params.button === "none") return "hover";
	if (params.holdMs) return "click_and_hold";
	return "click";
}

// ---------------------------------------------------------------------------
// Capture context parsing (macOS native helper output)
// ---------------------------------------------------------------------------

function parseCaptureContext(raw: string): GuiCaptureContext {
	const parsed = JSON.parse(raw) as Record<string, unknown>;
	const display = parsed.display as Record<string, unknown> | undefined;
	const displayBounds = display?.bounds as Record<string, unknown> | undefined;
	const cursor = parsed.cursor as Record<string, unknown> | undefined;
	const windowBounds = parsed.windowBounds as Record<string, unknown> | undefined;
	if (!display || !displayBounds || !cursor) {
		throw new GuiRuntimeError("Capture metadata helper returned incomplete display metadata.");
	}
	const toNumber = (value: unknown, label: string): number => {
		if (typeof value !== "number" || !Number.isFinite(value)) {
			throw new GuiRuntimeError(`Capture metadata helper returned invalid ${label}.`);
		}
		return value;
	};
	return {
		appName: typeof parsed.appName === "string" ? parsed.appName : undefined,
		display: {
			index: Math.max(1, Math.round(toNumber(display.index, "display index"))),
			bounds: normalizeRect({
				x: toNumber(displayBounds.x, "display bounds x"),
				y: toNumber(displayBounds.y, "display bounds y"),
				width: toNumber(displayBounds.width, "display bounds width"),
				height: toNumber(displayBounds.height, "display bounds height"),
			}),
		},
		cursor: {
			x: toNumber(cursor.x, "cursor x"),
			y: toNumber(cursor.y, "cursor y"),
		},
		windowId: typeof parsed.windowId === "number" ? Math.round(parsed.windowId) : undefined,
		windowTitle: typeof parsed.windowTitle === "string" ? parsed.windowTitle : undefined,
		windowBounds: windowBounds
			? normalizeRect({
				x: toNumber(windowBounds.x, "window bounds x"),
				y: toNumber(windowBounds.y, "window bounds y"),
				width: toNumber(windowBounds.width, "window bounds width"),
				height: toNumber(windowBounds.height, "window bounds height"),
			})
			: undefined,
		windowCount:
			typeof parsed.windowCount === "number" && Number.isFinite(parsed.windowCount)
				? Math.max(1, Math.round(parsed.windowCount))
				: undefined,
		windowCaptureStrategy:
			parsed.windowCaptureStrategy === "selected_window" ||
			parsed.windowCaptureStrategy === "main_window" ||
			parsed.windowCaptureStrategy === "app_union"
				? parsed.windowCaptureStrategy
				: undefined,
	};
}

// ---------------------------------------------------------------------------
// AppleScript / native helper execution
// ---------------------------------------------------------------------------

async function runAppleScript(
	script: string,
	env: Record<string, string | undefined>,
	args: string[] = [],
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string> {
	try {
		const result = await execFileAsync("osascript", [
			"-l",
			"AppleScript",
			"-e",
			script,
			...(args.length > 0 ? ["--", ...args] : []),
		], {
			env: {
				...process.env,
				...env,
			},
			timeout: timeoutMs,
			maxBuffer: 8 * 1024 * 1024,
			encoding: "utf-8",
		});
		return result.stdout.trim();
	} catch (error) {
		const record = error as {
			message?: string;
			stderr?: string;
			stdout?: string;
			signal?: string;
			killed?: boolean;
		};
		const details = [record.stderr, record.stdout]
			.map((value) => (typeof value === "string" ? value.trim() : ""))
			.filter(Boolean)
			.join(" ");
		const timeoutHint = record.killed || record.signal === "SIGTERM"
			? " The GUI script timed out while inspecting the current desktop state."
			: "";
		const message = [record.message ?? String(error), details].filter(Boolean).join(" ").trim();
		throw new GuiRuntimeError(
			`macOS GUI scripting failed. Ensure the required macOS GUI control permissions are granted.${timeoutHint} ${message}`.trim(),
		);
	}
}

async function runNativeHelper(params: {
	command: "capture-context" | "event";
	env: Record<string, string | undefined>;
	timeoutMs?: number;
	failureMessage: string;
	timeoutHint: string;
}): Promise<string> {
	try {
		const binaryPath = await resolveNativeGuiHelperBinary();
		const result = await execFileAsync(binaryPath, [params.command], {
			env: {
				...process.env,
				...params.env,
			},
			timeout: params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			maxBuffer: 8 * 1024 * 1024,
			encoding: "utf-8",
		});
		return result.stdout.trim();
	} catch (error) {
		const record = error as {
			message?: string;
			stderr?: string;
			stdout?: string;
			signal?: string;
			killed?: boolean;
		};
		const details = [record.stderr, record.stdout]
			.map((value) => (typeof value === "string" ? value.trim() : ""))
			.filter(Boolean)
			.join(" ");
		const timeoutHint = record.killed || record.signal === "SIGTERM"
			? ` ${params.timeoutHint}`
			: "";
		const message = [record.message ?? String(error), details].filter(Boolean).join(" ").trim();
		throw new GuiRuntimeError(`${params.failureMessage}${timeoutHint} ${message}`.trim());
	}
}

// ---------------------------------------------------------------------------
// Embedded AppleScript templates
// ---------------------------------------------------------------------------

const WINDOW_SELECTION_SCRIPT_HELPERS = String.raw`
on absoluteDifference(lhsValue, rhsValue)
	if lhsValue >= rhsValue then return lhsValue - rhsValue
	return rhsValue - lhsValue
end absoluteDifference

on textContains(haystack, needle)
	if needle is "" then return true
	ignoring case
			return (offset of needle in haystack) is not 0
	end ignoring
end textContains

on windowMatchesBounds(candidateWindow, boundsXText, boundsYText, boundsWidthText, boundsHeightText)
	if boundsXText is "" or boundsYText is "" or boundsWidthText is "" or boundsHeightText is "" then return true
	try
		set {windowX, windowY} to position of candidateWindow
		set {windowWidth, windowHeight} to size of candidateWindow
	on error
		return false
	end try
	set tolerance to 3
	return (my absoluteDifference(windowX as integer, boundsXText as integer) is less than or equal to tolerance) and (my absoluteDifference(windowY as integer, boundsYText as integer) is less than or equal to tolerance) and (my absoluteDifference(windowWidth as integer, boundsWidthText as integer) is less than or equal to tolerance) and (my absoluteDifference(windowHeight as integer, boundsHeightText as integer) is less than or equal to tolerance)
end windowMatchesBounds

on matchingWindows(targetProc, exactTitle, titleContains, boundsXText, boundsYText, boundsWidthText, boundsHeightText)
	set matches to {}
	repeat with candidateWindow in windows of targetProc
		set windowTitle to ""
		try
			set windowTitle to name of candidateWindow as text
		end try
		set exactMatch to true
		if exactTitle is not "" then
			ignoring case
				set exactMatch to windowTitle is exactTitle
			end ignoring
		end if
		set containsMatch to my textContains(windowTitle, titleContains)
		set boundsMatch to my windowMatchesBounds(candidateWindow, boundsXText, boundsYText, boundsWidthText, boundsHeightText)
		if exactMatch and containsMatch and boundsMatch then set end of matches to candidateWindow
	end repeat
	return matches
end matchingWindows

on focusRequestedWindow(targetProc, exactTitle, titleContains, windowIndexText, boundsXText, boundsYText, boundsWidthText, boundsHeightText)
	if exactTitle is "" and titleContains is "" and windowIndexText is "" and boundsXText is "" and boundsYText is "" and boundsWidthText is "" and boundsHeightText is "" then return
	set matches to my matchingWindows(targetProc, exactTitle, titleContains, boundsXText, boundsYText, boundsWidthText, boundsHeightText)
	if (count of matches) is 0 then error "Window not found for the requested selection."
	set targetWindow to item 1 of matches
	if windowIndexText is not "" then
		set requestedIndex to windowIndexText as integer
		if requestedIndex < 1 or requestedIndex > (count of matches) then error "Requested window index is out of range."
		set targetWindow to item requestedIndex of matches
	end if
	tell application "System Events"
		try
			tell targetWindow to perform action "AXRaise"
		end try
		try
			tell targetWindow to set value of attribute "AXMain" to true
		end try
		try
			tell targetWindow to set value of attribute "AXFocused" to true
		end try
	end tell
	delay 0.1
end focusRequestedWindow
`;

const TYPE_SCRIPT = String.raw`
${WINDOW_SELECTION_SCRIPT_HELPERS}

on normalizedDelaySeconds(delayMsText, fallbackSeconds)
	if delayMsText is "" then return fallbackSeconds
	try
		set candidateMs to delayMsText as integer
		if candidateMs < 0 then return fallbackSeconds
		return candidateMs / 1000
	on error
		return fallbackSeconds
	end try
end normalizedDelaySeconds

on normalizedRepeatCount(repeatText, fallbackCount)
	if repeatText is "" then return fallbackCount
	try
		set candidateCount to repeatText as integer
		if candidateCount < 0 then return fallbackCount
		return candidateCount
	on error
		return fallbackCount
	end try
end normalizedRepeatCount

on pasteText(rawText, preDelaySeconds, postDelaySeconds)
	set previousClipboard to missing value
	set hadClipboard to false
	try
		set previousClipboard to the clipboard
		set hadClipboard to true
	end try

	set the clipboard to rawText
	delay preDelaySeconds
	tell application "System Events"
		keystroke "v" using command down
	end tell
	delay postDelaySeconds

	if hadClipboard then
		try
			set the clipboard to previousClipboard
		end try
	end if
end pasteText

on clearWithBackspace(repeatCount)
	if repeatCount <= 0 then return
	tell application "System Events"
		repeat repeatCount times
			key code 51
			delay 0.02
		end repeat
	end tell
end clearWithBackspace

on enterText(rawText, entryStrategy, preDelaySeconds, postDelaySeconds)
	if entryStrategy is "keystroke" then
		tell application "System Events"
			keystroke rawText
		end tell
		delay postDelaySeconds
		return
	end if
	if entryStrategy is "keystroke_chars" then
		set keyDelayMsText to system attribute "UNDERSTUDY_GUI_KEYSTROKE_CHAR_DELAY_MS"
		set keyDelaySeconds to my normalizedDelaySeconds(keyDelayMsText, 0.055)
		tell application "System Events"
			repeat with currentCharacter in characters of rawText
				set typedCharacter to contents of currentCharacter
				if typedCharacter is return or typedCharacter is linefeed then
					key code 36
				else
					keystroke typedCharacter
				end if
				delay keyDelaySeconds
			end repeat
		end tell
		delay postDelaySeconds
		return
	end if
	my pasteText(rawText, preDelaySeconds, postDelaySeconds)
end enterText

on run argv
	set requestedApp to system attribute "UNDERSTUDY_GUI_APP"
	set requestedWindowTitle to system attribute "UNDERSTUDY_GUI_WINDOW_TITLE"
	set requestedWindowTitleContains to system attribute "UNDERSTUDY_GUI_WINDOW_TITLE_CONTAINS"
	set requestedWindowIndex to system attribute "UNDERSTUDY_GUI_WINDOW_INDEX"
	set requestedWindowBoundsX to system attribute "UNDERSTUDY_GUI_WINDOW_BOUNDS_X"
	set requestedWindowBoundsY to system attribute "UNDERSTUDY_GUI_WINDOW_BOUNDS_Y"
	set requestedWindowBoundsWidth to system attribute "UNDERSTUDY_GUI_WINDOW_BOUNDS_WIDTH"
	set requestedWindowBoundsHeight to system attribute "UNDERSTUDY_GUI_WINDOW_BOUNDS_HEIGHT"
	set replaceText to system attribute "UNDERSTUDY_GUI_REPLACE"
	set submitText to system attribute "UNDERSTUDY_GUI_SUBMIT"
	set inlineInputText to system attribute "UNDERSTUDY_GUI_TEXT"
	set systemEventsTypeStrategy to system attribute "UNDERSTUDY_GUI_SYSTEM_EVENTS_TYPE_STRATEGY"
	set clearRepeatText to system attribute "UNDERSTUDY_GUI_CLEAR_REPEAT"
	set pastePreDelayMsText to system attribute "UNDERSTUDY_GUI_PASTE_PRE_DELAY_MS"
	set pastePostDelayMsText to system attribute "UNDERSTUDY_GUI_PASTE_POST_DELAY_MS"
	set inputText to inlineInputText
	if inputText is "" and (count of argv) > 0 then set inputText to item 1 of argv
	set preDelaySeconds to my normalizedDelaySeconds(pastePreDelayMsText, 0.15)
	set postDelaySeconds to my normalizedDelaySeconds(pastePostDelayMsText, 0.25)
	set replaceRepeatCount to my normalizedRepeatCount(clearRepeatText, 48)
	tell application "System Events"
		if requestedApp is not "" then
			if not (exists application process requestedApp) then error "Application process not found: " & requestedApp
		set targetProc to application process requestedApp
		set frontmost of targetProc to true
		delay 0.1
	else
		set targetProc to first application process whose frontmost is true
	end if
	my focusRequestedWindow(targetProc, requestedWindowTitle, requestedWindowTitleContains, requestedWindowIndex, requestedWindowBoundsX, requestedWindowBoundsY, requestedWindowBoundsWidth, requestedWindowBoundsHeight)

	if replaceText is "1" then
		if systemEventsTypeStrategy is "keystroke" or clearRepeatText is not "" then
			my clearWithBackspace(replaceRepeatCount)
		else
			keystroke "a" using command down
		end if
	end if
		my enterText(inputText, systemEventsTypeStrategy, preDelaySeconds, postDelaySeconds)
		if submitText is "1" then key code 36
		return "typed"
	end tell
end run
`;

const HOTKEY_SCRIPT = String.raw`
${WINDOW_SELECTION_SCRIPT_HELPERS}

on buildModifierList(rawText)
	set modifierList to {}
	if rawText contains "command" then copy command down to end of modifierList
	if rawText contains "shift" then copy shift down to end of modifierList
	if rawText contains "option" then copy option down to end of modifierList
	if rawText contains "control" then copy control down to end of modifierList
	return modifierList
end buildModifierList

set requestedApp to system attribute "UNDERSTUDY_GUI_APP"
set requestedWindowTitle to system attribute "UNDERSTUDY_GUI_WINDOW_TITLE"
set requestedWindowTitleContains to system attribute "UNDERSTUDY_GUI_WINDOW_TITLE_CONTAINS"
set requestedWindowIndex to system attribute "UNDERSTUDY_GUI_WINDOW_INDEX"
set requestedWindowBoundsX to system attribute "UNDERSTUDY_GUI_WINDOW_BOUNDS_X"
set requestedWindowBoundsY to system attribute "UNDERSTUDY_GUI_WINDOW_BOUNDS_Y"
set requestedWindowBoundsWidth to system attribute "UNDERSTUDY_GUI_WINDOW_BOUNDS_WIDTH"
set requestedWindowBoundsHeight to system attribute "UNDERSTUDY_GUI_WINDOW_BOUNDS_HEIGHT"
set keyText to system attribute "UNDERSTUDY_GUI_KEY"
set keyCodeText to system attribute "UNDERSTUDY_GUI_KEY_CODE"
set modifiersText to system attribute "UNDERSTUDY_GUI_MODIFIERS"
set repeatText to system attribute "UNDERSTUDY_GUI_REPEAT"
set modifierList to my buildModifierList(modifiersText)
set repeatCount to 1
if repeatText is not "" then
	set repeatCandidate to repeatText as integer
	if repeatCandidate > 0 then set repeatCount to repeatCandidate
end if

tell application "System Events"
	if requestedApp is not "" then
		if not (exists application process requestedApp) then error "Application process not found: " & requestedApp
		set targetProc to application process requestedApp
		set frontmost of targetProc to true
		delay 0.1
	else
		set targetProc to first application process whose frontmost is true
	end if
	my focusRequestedWindow(targetProc, requestedWindowTitle, requestedWindowTitleContains, requestedWindowIndex, requestedWindowBoundsX, requestedWindowBoundsY, requestedWindowBoundsWidth, requestedWindowBoundsHeight)

	if keyCodeText is not "" then
		repeat repeatCount times
			if (count of modifierList) is 0 then
				key code (keyCodeText as integer)
			else
				key code (keyCodeText as integer) using modifierList
			end if
			delay 0.03
		end repeat
		return "key_code"
	end if

	repeat repeatCount times
		if (count of modifierList) is 0 then
			keystroke keyText
		else
			keystroke keyText using modifierList
		end if
		delay 0.03
	end repeat
	return "keystroke"
end tell
`;

// ---------------------------------------------------------------------------
// macOS capture context resolution
// ---------------------------------------------------------------------------

export async function resolveMacOsCaptureContext(
	appName: string | undefined,
	options: {
		activateApp?: boolean;
		windowSelector?: GuiWindowSelector;
	} = {},
): Promise<GuiCaptureContext> {
	const windowSelection = resolveWindowSelection({
		windowSelector: options.windowSelector,
	});
	const raw = await runNativeHelper({
		command: "capture-context",
		env: {
			UNDERSTUDY_GUI_APP: appName?.trim(),
			UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
			...buildWindowSelectionEnv(windowSelection),
		},
		failureMessage:
			"macOS native GUI capture helper failed. Ensure the required macOS GUI control permissions are granted.",
		timeoutHint: "The GUI helper timed out while inspecting the current desktop state.",
	});
	return parseCaptureContext(raw);
}

export function createRequestedWindowNotFoundError(
	appName: string | undefined,
	windowSelection: GuiWindowSelector | undefined,
): GuiRuntimeError {
	const requestedWindow = describeWindowSelection(windowSelection) ?? "requested window";
	const appLabel = appName?.trim() ? ` for ${appName.trim()}` : "";
	return new GuiRuntimeError(
		`Could not find ${requestedWindow}${appLabel}. Check the visible window title or use captureMode "display" if the target spans multiple windows.`,
	);
}

export async function resolveScriptWindowSelection(params: {
	appName?: string;
	windowTitle?: string;
	windowSelector?: GuiWindowSelector;
}): Promise<GuiScriptWindowSelection | undefined> {
	const windowSelection = resolveWindowSelection({
		windowTitle: params.windowTitle,
		windowSelector: params.windowSelector,
	});
	if (!windowSelection) {
		return undefined;
	}
	const context = await resolveMacOsCaptureContext(params.appName, {
		activateApp: false,
		windowSelector: windowSelection,
	});
	if (!context.windowBounds) {
		throw createRequestedWindowNotFoundError(params.appName, windowSelection);
	}
	const resolvedTitle = normalizeOptionalString(context.windowTitle);
	return {
		title: resolvedTitle ?? windowSelection.title,
		titleContains: resolvedTitle ? undefined : windowSelection.titleContains,
		bounds: context.windowBounds,
	};
}

export function resolveCaptureMode(params: {
	context: GuiCaptureContext;
	captureMode?: GuiCaptureMode;
	includeCursor?: boolean;
}): {
	mode: "display" | "window";
	captureRect: GuiRect;
	screencaptureArgs: string[];
} {
	const cursorArgs = params.includeCursor ? ["-C"] : [];
	if (params.captureMode !== "display" && params.context.windowBounds) {
		const captureRect = normalizeRect(params.context.windowBounds);
		return {
			mode: "window",
			captureRect,
			screencaptureArgs: [
				"-x",
				...cursorArgs,
				"-R",
				`${captureRect.x},${captureRect.y},${captureRect.width},${captureRect.height}`,
				"-t",
				"png",
			],
		};
	}
	return {
		mode: "display",
		captureRect: params.context.display.bounds,
		screencaptureArgs: [
			"-x",
			...cursorArgs,
			`-D${params.context.display.index}`,
			"-t",
			"png",
		],
	};
}

// ---------------------------------------------------------------------------
// macOS native input actions
// ---------------------------------------------------------------------------

export async function performPointClick(
	appName: string | undefined,
	point: { x: number; y: number },
	options: { activateApp?: boolean } = {},
): Promise<GuiNativeActionResult> {
	const actionKind = await runNativeHelper({
		command: "event",
		env: {
			UNDERSTUDY_GUI_APP: appName?.trim(),
			UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
			UNDERSTUDY_GUI_EVENT_MODE: "click",
			UNDERSTUDY_GUI_X: String(point.x),
			UNDERSTUDY_GUI_Y: String(point.y),
		},
		failureMessage:
			"macOS native GUI event dispatch failed. Ensure the required macOS GUI control permissions are granted.",
		timeoutHint: "The GUI helper timed out while sending native input events.",
	});
	return { actionKind };
}

export async function performRightClick(
	appName: string | undefined,
	point: { x: number; y: number },
	options: { activateApp?: boolean } = {},
): Promise<GuiNativeActionResult> {
	const actionKind = await runNativeHelper({
		command: "event",
		env: {
			UNDERSTUDY_GUI_APP: appName?.trim(),
			UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
			UNDERSTUDY_GUI_EVENT_MODE: "right_click",
			UNDERSTUDY_GUI_X: String(point.x),
			UNDERSTUDY_GUI_Y: String(point.y),
		},
		failureMessage:
			"macOS native GUI event dispatch failed. Ensure the required macOS GUI control permissions are granted.",
		timeoutHint: "The GUI helper timed out while sending native input events.",
	});
	return { actionKind };
}

export async function performDoubleClick(
	appName: string | undefined,
	point: { x: number; y: number },
	options: { activateApp?: boolean } = {},
): Promise<GuiNativeActionResult> {
	const actionKind = await runNativeHelper({
		command: "event",
		env: {
			UNDERSTUDY_GUI_APP: appName?.trim(),
			UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
			UNDERSTUDY_GUI_EVENT_MODE: "double_click",
			UNDERSTUDY_GUI_X: String(point.x),
			UNDERSTUDY_GUI_Y: String(point.y),
		},
		failureMessage:
			"macOS native GUI event dispatch failed. Ensure the required macOS GUI control permissions are granted.",
		timeoutHint: "The GUI helper timed out while sending native input events.",
	});
	return { actionKind };
}

export async function performHover(
	appName: string | undefined,
	point: { x: number; y: number },
	settleMs: number,
	options: { activateApp?: boolean } = {},
): Promise<GuiNativeActionResult> {
	const actionKind = await runNativeHelper({
		command: "event",
		env: {
			UNDERSTUDY_GUI_APP: appName?.trim(),
			UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
			UNDERSTUDY_GUI_EVENT_MODE: "hover",
			UNDERSTUDY_GUI_X: String(point.x),
			UNDERSTUDY_GUI_Y: String(point.y),
			UNDERSTUDY_GUI_SETTLE_MS: String(settleMs),
		},
		failureMessage:
			"macOS native GUI event dispatch failed. Ensure the required macOS GUI control permissions are granted.",
		timeoutHint: "The GUI helper timed out while sending native input events.",
	});
	return { actionKind };
}

export async function performClickAndHold(
	appName: string | undefined,
	point: { x: number; y: number },
	holdDurationMs: number,
	options: { activateApp?: boolean } = {},
): Promise<GuiNativeActionResult> {
	const actionKind = await runNativeHelper({
		command: "event",
		env: {
			UNDERSTUDY_GUI_APP: appName?.trim(),
			UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
			UNDERSTUDY_GUI_EVENT_MODE: "click_and_hold",
			UNDERSTUDY_GUI_X: String(point.x),
			UNDERSTUDY_GUI_Y: String(point.y),
			UNDERSTUDY_GUI_HOLD_DURATION_MS: String(holdDurationMs),
		},
		failureMessage:
			"macOS native GUI event dispatch failed. Ensure the required macOS GUI control permissions are granted.",
		timeoutHint: "The GUI helper timed out while sending native input events.",
	});
	return { actionKind };
}

export async function performDrag(
	appName: string | undefined,
	from: { x: number; y: number },
	to: { x: number; y: number },
	durationMs: number,
	options: { activateApp?: boolean } = {},
): Promise<GuiNativeActionResult> {
	const actionKind = await runNativeHelper({
		command: "event",
		env: {
			UNDERSTUDY_GUI_APP: appName?.trim(),
			UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
			UNDERSTUDY_GUI_EVENT_MODE: "drag",
			UNDERSTUDY_GUI_FROM_X: String(from.x),
			UNDERSTUDY_GUI_FROM_Y: String(from.y),
			UNDERSTUDY_GUI_TO_X: String(to.x),
			UNDERSTUDY_GUI_TO_Y: String(to.y),
			UNDERSTUDY_GUI_DURATION_MS: String(durationMs),
			UNDERSTUDY_GUI_STEPS: String(DEFAULT_DRAG_STEPS),
		},
		failureMessage:
			"macOS native GUI event dispatch failed. Ensure the required macOS GUI control permissions are granted.",
		timeoutHint: "The GUI helper timed out while sending native input events.",
	});
	return { actionKind };
}

// ---------------------------------------------------------------------------
// Scroll helpers
// ---------------------------------------------------------------------------

function scrollDirectionUsesHorizontalAxis(direction: NonNullable<GuiScrollParams["direction"]>): boolean {
	return direction === "left" || direction === "right";
}

function scrollViewportDimensionForDirection(
	rect: GuiRect,
	direction: NonNullable<GuiScrollParams["direction"]>,
): number {
	return scrollDirectionUsesHorizontalAxis(direction) ? rect.width : rect.height;
}

export function resolveScrollPlan(params: GuiScrollParams, options: {
	grounded?: GroundedGuiTarget;
	context?: GuiCaptureContext;
}): ResolvedGuiScrollPlan {
	const direction = params.direction ?? "down";
	if (params.amount !== undefined) {
		return {
			amount: Math.max(1, Math.min(50, Math.round(params.amount))),
			distancePreset: "custom",
			unit: "line",
		};
	}
	const distancePreset = params.distance ??
		(params.target?.trim() ? DEFAULT_TARGETED_SCROLL_DISTANCE : DEFAULT_TARGETLESS_SCROLL_DISTANCE);
	const groundedRect = options.grounded?.displayBox;
	if (groundedRect) {
		const viewportDimension = Math.max(1, Math.round(scrollViewportDimensionForDirection(groundedRect, direction)));
		return {
			amount: Math.max(1, Math.min(4_000, Math.round(viewportDimension * SCROLL_DISTANCE_FRACTIONS[distancePreset]))),
			distancePreset,
			unit: "pixel",
			viewportDimension,
			viewportSource: "target_box",
			travelFraction: SCROLL_DISTANCE_FRACTIONS[distancePreset],
		};
	}
	const captureRect = options.grounded?.artifact.captureRect;
	if (captureRect) {
		const viewportDimension = Math.max(1, Math.round(scrollViewportDimensionForDirection(captureRect, direction)));
		return {
			amount: Math.max(1, Math.min(4_000, Math.round(viewportDimension * SCROLL_DISTANCE_FRACTIONS[distancePreset]))),
			distancePreset,
			unit: "pixel",
			viewportDimension,
			viewportSource: "capture_rect",
			travelFraction: SCROLL_DISTANCE_FRACTIONS[distancePreset],
		};
	}
	const contextRect = options.context
		? (params.captureMode === "display" || !options.context.windowBounds
			? options.context.display.bounds
			: options.context.windowBounds)
		: undefined;
	if (contextRect) {
		const viewportDimension = Math.max(1, Math.round(scrollViewportDimensionForDirection(contextRect, direction)));
		return {
			amount: Math.max(1, Math.min(4_000, Math.round(viewportDimension * SCROLL_DISTANCE_FRACTIONS[distancePreset]))),
			distancePreset,
			unit: "pixel",
			viewportDimension,
			viewportSource: params.captureMode === "display" || !options.context?.windowBounds ? "display" : "window",
			travelFraction: SCROLL_DISTANCE_FRACTIONS[distancePreset],
		};
	}
	return {
		amount: SCROLL_DISTANCE_AMOUNTS[distancePreset],
		distancePreset,
		unit: "line",
	};
}

export async function performScroll(
	appName: string | undefined,
	point: { x: number; y: number } | undefined,
	params: {
		direction?: GuiScrollParams["direction"];
		plan: ResolvedGuiScrollPlan;
	},
	options: { activateApp?: boolean } = {},
): Promise<GuiNativeActionResult> {
	const direction = params.direction ?? "down";
	const amount = params.plan.amount;
	const deltaX =
		direction === "left" ? -amount :
			direction === "right" ? amount :
				0;
	const deltaY =
		direction === "up" ? amount :
			direction === "down" ? -amount :
				0;
	const actionKind = await runNativeHelper({
		command: "event",
		env: {
			UNDERSTUDY_GUI_APP: appName?.trim(),
			UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
			UNDERSTUDY_GUI_EVENT_MODE: "scroll",
			UNDERSTUDY_GUI_X: point ? String(point.x) : undefined,
			UNDERSTUDY_GUI_Y: point ? String(point.y) : undefined,
			UNDERSTUDY_GUI_SCROLL_UNIT: params.plan.unit,
			UNDERSTUDY_GUI_SCROLL_X: String(deltaX),
			UNDERSTUDY_GUI_SCROLL_Y: String(deltaY),
		},
		failureMessage:
			"macOS native GUI event dispatch failed. Ensure the required macOS GUI control permissions are granted.",
		timeoutHint: "The GUI helper timed out while sending native input events.",
	});
	return { actionKind };
}

// ---------------------------------------------------------------------------
// macOS type actions
// ---------------------------------------------------------------------------

export async function performType(params: GuiTypeParams, text: string): Promise<GuiNativeActionResult> {
	const windowSelection = await resolveScriptWindowSelection({
		appName: params.app,
		windowTitle: params.windowTitle,
		windowSelector: params.windowSelector,
	});
	const actionKind = await runAppleScript(TYPE_SCRIPT, {
		UNDERSTUDY_GUI_APP: params.app?.trim(),
		...buildScriptWindowSelectionEnv(windowSelection),
		UNDERSTUDY_GUI_REPLACE: params.replace === false ? "0" : "1",
		UNDERSTUDY_GUI_SUBMIT: params.submit ? "1" : "0",
	}, [text]);
	return { actionKind };
}

export async function performNativeType(params: GuiTypeParams, text: string): Promise<GuiNativeActionResult> {
	const typeStrategy = params.typeStrategy;
	const needsClearRepeat = typeStrategy && params.replace !== false;
	const actionKind = await runNativeHelper({
		command: "event",
		env: {
			UNDERSTUDY_GUI_APP: params.app?.trim(),
			UNDERSTUDY_GUI_EVENT_MODE: "type_text",
			UNDERSTUDY_GUI_TEXT: text,
			UNDERSTUDY_GUI_REPLACE: params.replace === false ? "0" : "1",
			UNDERSTUDY_GUI_SUBMIT: params.submit ? "1" : "0",
			UNDERSTUDY_GUI_TYPE_STRATEGY: typeStrategy,
			UNDERSTUDY_GUI_CLEAR_REPEAT: needsClearRepeat
				? String(DEFAULT_NATIVE_TYPE_CLEAR_REPEAT)
				: undefined,
		},
		failureMessage:
			"macOS native GUI event dispatch failed. Ensure the required macOS GUI control permissions are granted.",
		timeoutHint: "The GUI helper timed out while sending native input events.",
	});
	return { actionKind };
}

export async function performSystemEventsType(
	params: GuiTypeParams,
	text: string,
	strategy: "system_events_paste" | "system_events_keystroke" | "system_events_keystroke_chars",
): Promise<GuiNativeActionResult> {
	const windowSelection = await resolveScriptWindowSelection({
		appName: params.app,
		windowTitle: params.windowTitle,
		windowSelector: params.windowSelector,
	});
	const actionKind = await runAppleScript(TYPE_SCRIPT, {
		UNDERSTUDY_GUI_APP: params.app?.trim(),
		...buildScriptWindowSelectionEnv(windowSelection),
		UNDERSTUDY_GUI_REPLACE: params.replace === false ? "0" : "1",
		UNDERSTUDY_GUI_SUBMIT: params.submit ? "1" : "0",
		UNDERSTUDY_GUI_TEXT: text,
		UNDERSTUDY_GUI_SYSTEM_EVENTS_TYPE_STRATEGY:
			strategy === "system_events_keystroke"
				? "keystroke"
				: strategy === "system_events_keystroke_chars"
					? "keystroke_chars"
					: "paste",
		UNDERSTUDY_GUI_CLEAR_REPEAT:
			params.replace === false ? undefined : String(DEFAULT_NATIVE_TYPE_CLEAR_REPEAT),
		UNDERSTUDY_GUI_PASTE_PRE_DELAY_MS: String(DEFAULT_SYSTEM_EVENTS_PASTE_PRE_DELAY_MS),
		UNDERSTUDY_GUI_PASTE_POST_DELAY_MS: String(DEFAULT_SYSTEM_EVENTS_PASTE_POST_DELAY_MS),
		UNDERSTUDY_GUI_KEYSTROKE_CHAR_DELAY_MS:
			strategy === "system_events_keystroke_chars"
				? String(DEFAULT_SYSTEM_EVENTS_KEYSTROKE_CHAR_DELAY_MS)
				: undefined,
	});
	return { actionKind };
}

// ---------------------------------------------------------------------------
// macOS hotkey action
// ---------------------------------------------------------------------------

export async function performHotkey(
	params: GuiKeyParams,
	repeat: number = 1,
): Promise<GuiNativeActionResult> {
	const windowSelection = await resolveScriptWindowSelection({
		appName: params.app,
		windowTitle: params.windowTitle,
		windowSelector: params.windowSelector,
	});
	const normalizedKey = normalizeHotkeyKeyName(params.key);
	const keyCode = COMMON_KEY_CODES[normalizedKey];
	const actionKind = await runAppleScript(HOTKEY_SCRIPT, {
		UNDERSTUDY_GUI_APP: params.app?.trim(),
		...buildScriptWindowSelectionEnv(windowSelection),
		UNDERSTUDY_GUI_KEY: keyCode ? "" : params.key,
		UNDERSTUDY_GUI_KEY_CODE: keyCode ? String(keyCode) : "",
		UNDERSTUDY_GUI_MODIFIERS: (params.modifiers ?? [])
			.map((modifier) => modifier.trim().toLowerCase())
			.filter(Boolean)
			.join(","),
		UNDERSTUDY_GUI_REPEAT: String(Math.max(1, repeat)),
	});
	return { actionKind };
}
