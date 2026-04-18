import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GuiCaptureMode, GuiKeyParams, GuiScrollDistance, GuiScrollParams } from "../types.js";
import {
	execWin32Helper,
	mapCaptureContext,
	resolveWin32Helper,
	type Win32CaptureContext,
} from "../win32-native-helper.js";
import {
	GuiRuntimeError,
	normalizeHotkeyKeyName,
	normalizeRect,
	type GuiPoint,
	type GuiRect,
} from "./platform-detection.js";

export interface GuiNativeActionResult {
	actionKind: string;
}

export interface GuiDisplayDescriptor {
	index: number;
	bounds: GuiRect;
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

export interface GuiScreenshotArtifact {
	bytes: Buffer;
	filePath: string;
	mimeType: string;
	filename: string;
	metadata: GuiCaptureMetadata;
	cleanup: () => Promise<void>;
}

export interface ResolvedGuiScrollPlan {
	amount: number;
	distancePreset: GuiScrollDistance | "custom";
	unit: GuiScrollUnit;
	viewportDimension?: number;
	viewportSource?: GuiScrollViewportSource;
	travelFraction?: number;
}

type GuiScrollUnit = "line" | "pixel";
type GuiScrollViewportSource = "target_box" | "capture_rect" | "window" | "display";

function parsePngDimensions(bytes: Buffer): { width: number; height: number } | undefined {
	if (bytes.length < 24) {
		return undefined;
	}
	if (!bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
		return undefined;
	}
	return {
		width: bytes.readUInt32BE(16),
		height: bytes.readUInt32BE(20),
	};
}

export async function performWin32Click(
	point: GuiPoint,
	options: {
		button?: "left" | "right" | "middle";
		count?: number;
		holdMs?: number;
		settleMs?: number;
	} = {},
): Promise<GuiNativeActionResult> {
	const helperPath = await resolveWin32Helper();
	const args = [String(point.x), String(point.y)];
	if (options.button) args.push("--button", options.button);
	if (options.count !== undefined) args.push("--count", String(options.count));
	if (options.holdMs !== undefined && options.holdMs > 0) args.push("--hold-ms", String(options.holdMs));
	if (options.settleMs !== undefined) args.push("--settle-ms", String(options.settleMs));
	await execWin32Helper({ helperPath, subcommand: "click", args });
	return { actionKind: "click" };
}

export async function performWin32Drag(
	from: GuiPoint,
	to: GuiPoint,
	durationMs: number,
): Promise<GuiNativeActionResult> {
	const helperPath = await resolveWin32Helper();
	const args = [
		String(from.x), String(from.y),
		String(to.x), String(to.y),
		"--duration", String(durationMs),
	];
	await execWin32Helper({ helperPath, subcommand: "drag", args });
	return { actionKind: "drag" };
}

export async function performWin32Scroll(
	point: GuiPoint | undefined,
	params: {
		direction?: GuiScrollParams["direction"];
		plan: ResolvedGuiScrollPlan;
	},
): Promise<GuiNativeActionResult> {
	const helperPath = await resolveWin32Helper();
	const direction = params.direction ?? "down";
	const amount = params.plan.amount;
	const deltaX = direction === "left" ? -amount : direction === "right" ? amount : 0;
	const deltaY = direction === "up" ? amount : direction === "down" ? -amount : 0;
	const args = [
		String(point?.x ?? 0), String(point?.y ?? 0),
		String(deltaX), String(deltaY),
		"--unit", params.plan.unit,
	];
	await execWin32Helper({ helperPath, subcommand: "scroll", args });
	return { actionKind: "scroll" };
}

export async function performWin32Type(
	text: string,
	params: {
		typeStrategy?: string;
		replace?: boolean;
		submit?: boolean;
	},
): Promise<GuiNativeActionResult> {
	const helperPath = await resolveWin32Helper();
	const methodMap: Record<string, string> = {
		physical_keys: "physical_keys",
		clipboard_paste: "paste",
		system_events_paste: "paste",
		system_events_keystroke: "unicode",
		system_events_keystroke_chars: "unicode",
	};
	const method = methodMap[params.typeStrategy ?? ""] ?? "unicode";
	const args: string[] = ["--method", method];
	if (params.replace) args.push("--replace");
	if (params.submit) args.push("--submit");
	// Use -- separator so text starting with "--" isn't parsed as a flag
	args.push("--", text);
	await execWin32Helper({ helperPath, subcommand: "type", args });
	return { actionKind: "type" };
}

export async function performWin32Hotkey(
	params: GuiKeyParams,
	repeat: number = 1,
): Promise<GuiNativeActionResult> {
	const helperPath = await resolveWin32Helper();
	const normalizedKey = normalizeHotkeyKeyName(params.key);
	const args = [normalizedKey];
	if (params.modifiers?.length) {
		const modMap: Record<string, string> = {
			command: "ctrl",
			option: "alt",
			control: "ctrl",
			shift: "shift",
		};
		const winMods = (params.modifiers ?? [])
			.map((m) => modMap[m.trim().toLowerCase()] ?? m.trim().toLowerCase())
			.filter(Boolean);
		if (winMods.length) args.push("--modifiers", winMods.join(","));
	}
	if (repeat > 1) args.push("--repeat", String(repeat));
	await execWin32Helper({ helperPath, subcommand: "hotkey", args });
	return { actionKind: "hotkey" };
}

export async function performWin32Move(
	point: GuiPoint,
): Promise<GuiNativeActionResult> {
	const helperPath = await resolveWin32Helper();
	await execWin32Helper({
		helperPath,
		subcommand: "click",
		args: [String(point.x), String(point.y), "--count", "0", "--settle-ms", "0"],
	});
	return { actionKind: "move" };
}

export async function captureWin32Screenshot(params: {
	appName?: string;
	captureMode?: GuiCaptureMode;
	windowTitle?: string;
	includeCursor?: boolean;
}): Promise<GuiScreenshotArtifact> {
	const helperPath = await resolveWin32Helper();
	const tempDir = await mkdtemp(join(tmpdir(), "understudy-gui-screenshot-"));
	const filePath = join(tempDir, "gui-screenshot.png");

	try {
		const screenshotArgs: string[] = [filePath];
		if (params.windowTitle) screenshotArgs.push("--window-title", params.windowTitle);
		if (params.includeCursor) screenshotArgs.push("--include-cursor");

		await execWin32Helper({ helperPath, subcommand: "screenshot", args: screenshotArgs });

		const contextArgs: string[] = [];
		if (params.appName) contextArgs.push("--app", params.appName);
		const rawContext = await execWin32Helper({
			helperPath,
			subcommand: "capture-context",
			args: contextArgs,
		}) as Win32CaptureContext;
		const context = mapCaptureContext(rawContext);

		const bytes = Buffer.from(await readFile(filePath));
		const imageSize = parsePngDimensions(bytes);
		const captureRect = context.windowBounds && params.captureMode !== "display"
			? normalizeRect(context.windowBounds)
			: normalizeRect(context.display.bounds);
		const scaleX = imageSize?.width && captureRect.width > 0
			? imageSize.width / captureRect.width
			: 1;
		const scaleY = imageSize?.height && captureRect.height > 0
			? imageSize.height / captureRect.height
			: 1;

		return {
			bytes,
			filePath,
			mimeType: "image/png",
			filename: "gui-screenshot.png",
			metadata: {
				mode: params.captureMode === "display" || !context.windowBounds ? "display" : "window",
				captureRect,
				display: context.display as GuiDisplayDescriptor,
				imageWidth: imageSize?.width,
				imageHeight: imageSize?.height,
				scaleX: Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1,
				scaleY: Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1,
				appName: params.appName,
				windowTitle: context.windowTitle,
				windowCount: context.windowCount,
				cursor: context.cursor,
				cursorVisible: Boolean(params.includeCursor),
			},
			cleanup: async () => {
				await rm(tempDir, { recursive: true, force: true }).catch(() => {});
			},
		};
	} catch (err) {
		await rm(tempDir, { recursive: true, force: true }).catch(() => {});
		const message = err instanceof Error ? err.message : String(err);
		throw new GuiRuntimeError(
			`Win32 screenshot capture failed. ${message}`.trim(),
		);
	}
}

export async function resolveCaptureContextWin32(
	appName: string | undefined,
): Promise<GuiCaptureContext> {
	const helperPath = await resolveWin32Helper();
	const args: string[] = [];
	if (appName?.trim()) args.push("--app", appName.trim());
	const raw = await execWin32Helper({
		helperPath,
		subcommand: "capture-context",
		args,
	}) as Win32CaptureContext;
	return mapCaptureContext(raw) as unknown as GuiCaptureContext;
}
