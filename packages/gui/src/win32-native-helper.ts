import { access, constants } from "node:fs/promises";
import { join } from "node:path";
import { execFileAsync } from "./exec-utils.js";

const DEFAULT_TIMEOUT_MS = 10_000;

/** Raw capture-context JSON from the Win32 helper */
export interface Win32CaptureContext {
	displays: Array<{
		index: number;
		bounds: { x: number; y: number; width: number; height: number };
		scaleFactor: number;
	}>;
	cursor: { x: number; y: number };
	windows: Array<{
		title: string;
		appName: string;
		pid: number;
		bounds: { x: number; y: number; width: number; height: number };
	}>;
	frontmostApp: string;
	frontmostWindowTitle: string;
}

/** Readiness check result from the Win32 helper */
export interface Win32ReadinessReport {
	platform: string;
	checks: {
		wgc_available: { status: boolean; detail: string };
		sendinput_available: { status: boolean; detail: string };
		ui_automation_accessible: { status: boolean; detail: string };
		dpi_awareness: { status: string; detail: string };
		is_elevated: { status: boolean; detail: string };
		os_version: { status: string };
	};
}

/** GuiCaptureContext shape expected by runtime.ts */
interface GuiCaptureContext {
	appName?: string;
	display: {
		index: number;
		bounds: { x: number; y: number; width: number; height: number };
		scaleFactor?: number;
	};
	cursor: { x: number; y: number };
	windowId?: string;
	windowTitle?: string;
	windowBounds?: { x: number; y: number; width: number; height: number };
	windowCount?: number;
	windowCaptureStrategy?: string;
}

interface Win32HelperResponse {
	status: "ok" | "error";
	data?: unknown;
	code?: string;
	message?: string;
}

export class Win32HelperError extends Error {
	override name = "Win32HelperError";
	constructor(
		message: string,
		public readonly code?: string,
	) {
		super(message);
	}
}

/**
 * Resolve the path to understudy-win32-helper.exe.
 *
 * Resolution order:
 * 1. UNDERSTUDY_WIN32_HELPER_PATH env var
 * 2. Bundled binary at packages/gui/native/win32/bin/
 * 3. Cached download at %LOCALAPPDATA%/understudy/bin/
 */
export async function resolveWin32Helper(): Promise<string> {
	// 1. Explicit env var
	const envPath = process.env.UNDERSTUDY_WIN32_HELPER_PATH;
	if (envPath) {
		try {
			await access(envPath, constants.X_OK);
			return envPath;
		} catch {
			throw new Win32HelperError(
				`UNDERSTUDY_WIN32_HELPER_PATH is set to "${envPath}" but the file is not accessible.`,
			);
		}
	}

	// 2. Bundled binary (relative to this module)
	const bundledPath = join(
		import.meta.dirname ?? "",
		"..",
		"native",
		"win32",
		"bin",
		"understudy-win32-helper.exe",
	);
	try {
		await access(bundledPath, constants.X_OK);
		return bundledPath;
	} catch {
		// Not bundled, continue
	}

	// 3. Cached download
	const localAppData =
		process.env.LOCALAPPDATA ??
		join(process.env.USERPROFILE ?? "", "AppData", "Local");
	const cachedPath = join(
		localAppData,
		"understudy",
		"bin",
		"understudy-win32-helper.exe",
	);
	try {
		await access(cachedPath, constants.X_OK);
		return cachedPath;
	} catch {
		// Not cached
	}

	// 4. TODO: Auto-download from GitHub Releases (Phase 2)
	throw new Win32HelperError(
		"Win32 helper binary not found. Set UNDERSTUDY_WIN32_HELPER_PATH or place the binary at " +
			`${cachedPath}`,
	);
}

/**
 * Execute a Win32 helper subcommand and parse the JSON response.
 */
export async function execWin32Helper(params: {
	helperPath: string;
	subcommand: string;
	args?: string[];
	timeoutMs?: number;
}): Promise<unknown> {
	const result = await execFileAsync(
		params.helperPath,
		[params.subcommand, ...(params.args ?? [])],
		{
			timeout: params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			maxBuffer: 8 * 1024 * 1024,
			encoding: "utf-8",
		},
	);

	// execFileAsync may return a string directly (in test environments where execFile
	// is mocked without the custom promisify symbol) or an object with stdout/stderr.
	const rawStdout =
		typeof result === "string" ? result : (result as { stdout: string }).stdout;
	const stdout = rawStdout.trim();
	if (!stdout) {
		throw new Win32HelperError("Win32 helper returned empty output");
	}

	let response: Win32HelperResponse;
	try {
		response = JSON.parse(stdout) as Win32HelperResponse;
	} catch {
		throw new Win32HelperError(
			`Win32 helper returned invalid JSON: ${stdout.slice(0, 200)}`,
		);
	}

	if (response.status === "error") {
		throw new Win32HelperError(
			`${response.code ?? "UNKNOWN"}: ${response.message ?? "Unknown error"}`,
			response.code,
		);
	}

	return response.data;
}

/**
 * Map the Win32 helper's capture-context JSON to the GuiCaptureContext
 * shape consumed by runtime.ts.
 */
export function mapCaptureContext(raw: Win32CaptureContext): GuiCaptureContext {
	// Select the display whose bounds contain (0,0) — that is the primary monitor.
	// EnumDisplayMonitors does not guarantee the primary is returned first.
	const primary = raw.displays.find(
		(d) => d.bounds.x <= 0 && d.bounds.y <= 0 &&
			d.bounds.x + d.bounds.width > 0 && d.bounds.y + d.bounds.height > 0,
	) ?? raw.displays[0];
	const frontWin = raw.windows.find((w) => w.title === raw.frontmostWindowTitle);
	return {
		display: {
			index: primary?.index ?? 1,
			bounds: primary?.bounds ?? { x: 0, y: 0, width: 1920, height: 1080 },
			scaleFactor: primary?.scaleFactor,
		},
		cursor: raw.cursor,
		windowTitle: raw.frontmostWindowTitle || undefined,
		windowBounds: frontWin?.bounds,
		windowCount: raw.windows.length,
		windowCaptureStrategy: "wgc" as const,
		appName: raw.frontmostApp || undefined,
	};
}
