/**
 * Tests for the win32 platform dispatch branches in runtime.ts.
 * Covers lines 1175, 1819, 2470, 2607, 2712, 2806, 2817, 2882, 2917.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	execWin32Helper: vi.fn(),
	resolveWin32Helper: vi.fn().mockResolvedValue("/mock/win32-helper.exe"),
	mapCaptureContext: vi.fn(),
	mkdtemp: vi.fn(),
	readFile: vi.fn(),
	rm: vi.fn(),
	win32HelperCalls: [] as Array<{ subcommand: string; args: string[] }>,
}));

vi.mock("../win32-native-helper.js", () => ({
	execWin32Helper: mocks.execWin32Helper,
	resolveWin32Helper: mocks.resolveWin32Helper,
	mapCaptureContext: mocks.mapCaptureContext,
	Win32HelperError: class Win32HelperError extends Error {
		constructor(message: string, public code?: string) {
			super(message);
			this.name = "Win32HelperError";
		}
	},
}));

vi.mock("node:fs/promises", async () => {
	const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
	return {
		...actual,
		mkdtemp: mocks.mkdtemp,
		readFile: mocks.readFile,
		rm: mocks.rm,
	};
});

import { ComputerUseGuiRuntime } from "../runtime.js";

const ONE_BY_ONE_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6W2y0AAAAASUVORK5CYII=",
	"base64",
);

function createPngBuffer(width: number, height: number): Buffer {
	const bytes = Buffer.from(ONE_BY_ONE_PNG);
	bytes.writeUInt32BE(width, 16);
	bytes.writeUInt32BE(height, 20);
	return bytes;
}

const MOCK_WIN32_CAPTURE_CONTEXT = {
	appName: "Notepad",
	display: {
		index: 1,
		bounds: { x: 0, y: 0, width: 1920, height: 1080 },
	},
	cursor: { x: 960, y: 540 },
	windowTitle: "Untitled - Notepad",
	windowBounds: { x: 100, y: 100, width: 800, height: 600 },
	windowCount: 1,
	windowCaptureStrategy: "wgc",
};

function groundedTarget(target: string, point: { x: number; y: number }, confidence = 0.9) {
	return {
		method: "grounding" as const,
		provider: "test-provider",
		confidence,
		reason: `Matched ${target}`,
		// Use display_pixels to avoid coordinate-space remapping in these dispatch tests
		coordinateSpace: "display_pixels" as const,
		point,
		box: {
			x: point.x - 10,
			y: point.y - 8,
			width: 20,
			height: 16,
		},
	};
}

function createRuntime(ground = vi.fn()) {
	return new ComputerUseGuiRuntime({
		groundingProvider: { ground },
	});
}

describe("ComputerUseGuiRuntime – win32 dispatch branches", () => {
	const originalPlatform = process.platform;

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.win32HelperCalls.length = 0;
		Object.defineProperty(process, "platform", { value: "win32", configurable: true });
		process.env.UNDERSTUDY_GUI_POST_ACTION_CAPTURE_SETTLE_MS = "0";

		mocks.resolveWin32Helper.mockResolvedValue("/mock/win32-helper.exe");
		mocks.mkdtemp.mockResolvedValue("/tmp/understudy-gui-test");
		mocks.readFile.mockResolvedValue(createPngBuffer(1920, 1080));
		mocks.rm.mockResolvedValue(undefined);
		mocks.mapCaptureContext.mockReturnValue(MOCK_WIN32_CAPTURE_CONTEXT);

		// Default execWin32Helper: tracks calls and resolves with context payload
		mocks.execWin32Helper.mockImplementation(
			({ subcommand, args }: { subcommand: string; args: string[] }) => {
				mocks.win32HelperCalls.push({ subcommand, args });
				if (subcommand === "capture-context") {
					return Promise.resolve({
						displays: [{ index: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }],
						cursor: { x: 960, y: 540 },
						windows: [{ title: "Untitled - Notepad", appName: "Notepad", pid: 1234, bounds: { x: 100, y: 100, width: 800, height: 600 } }],
						frontmostApp: "Notepad",
						frontmostWindowTitle: "Untitled - Notepad",
					});
				}
				return Promise.resolve(undefined);
			},
		);
	});

	afterEach(() => {
		Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
		delete process.env.UNDERSTUDY_GUI_POST_ACTION_CAPTURE_SETTLE_MS;
	});

	// ─── Branch: line 1819 (captureScreenshotArtifact → captureWin32Screenshot) ───

	it("observe() dispatches to Win32 screenshot helper on win32 (line 1819)", async () => {
		const runtime = new ComputerUseGuiRuntime();

		const result = await runtime.observe();

		expect(result.status.code).toBe("observed");
		const screenshotCall = mocks.win32HelperCalls.find((c) => c.subcommand === "screenshot");
		expect(screenshotCall).toBeDefined();
		expect(screenshotCall?.args[0]).toContain("gui-screenshot.png");
		// capture-context is also called to build metadata
		const contextCall = mocks.win32HelperCalls.find((c) => c.subcommand === "capture-context");
		expect(contextCall).toBeDefined();
	});

	it("observe() on win32 uses mapCaptureContext to build metadata (line 1175/1819)", async () => {
		const runtime = new ComputerUseGuiRuntime();

		const result = await runtime.observe();

		// mapCaptureContext is called to build metadata from the raw Win32 capture-context output
		expect(mocks.mapCaptureContext).toHaveBeenCalled();
		expect(result.status.code).toBe("observed");
	});

	// ─── Branch: line 2470 (executeForIntent → performWin32Click) ───

	it("click() dispatches to performWin32Click on win32 (line 2470)", async () => {
		const ground = vi.fn().mockResolvedValue(groundedTarget("OK button", { x: 200, y: 300 }));
		const runtime = createRuntime(ground);

		const result = await runtime.click({ target: "OK button" });

		expect(result.status.code).toBe("action_sent");
		const clickCall = mocks.win32HelperCalls.find((c) => c.subcommand === "click");
		expect(clickCall).toBeDefined();
		expect(clickCall?.args).toContain("200");
		expect(clickCall?.args).toContain("300");
	});

	it("click({button:'right'}) dispatches to performWin32Click with --button right (line 2470)", async () => {
		const ground = vi.fn().mockResolvedValue(groundedTarget("Context menu target", { x: 400, y: 250 }));
		const runtime = createRuntime(ground);

		const result = await runtime.click({ target: "Context menu target", button: "right" });

		expect(result.status.code).toBe("action_sent");
		const clickCall = mocks.win32HelperCalls.find(
			(c) => c.subcommand === "click" && c.args.includes("--button"),
		);
		expect(clickCall).toBeDefined();
		expect(clickCall?.args).toContain("right");
	});

	it("click({clicks:2}) dispatches to performWin32Click with --count 2 (line 2470)", async () => {
		const ground = vi.fn().mockResolvedValue(groundedTarget("Icon", { x: 150, y: 200 }));
		const runtime = createRuntime(ground);

		const result = await runtime.click({ target: "Icon", clicks: 2 });

		expect(result.status.code).toBe("action_sent");
		const clickCall = mocks.win32HelperCalls.find(
			(c) => c.subcommand === "click" && c.args.includes("--count"),
		);
		expect(clickCall).toBeDefined();
		expect(clickCall?.args).toContain("2");
	});

	// ─── Branch: line 2607 (drag → performWin32Drag) ───

	it("drag() dispatches to performWin32Drag on win32 (line 2607)", async () => {
		const ground = vi.fn()
			.mockResolvedValueOnce(groundedTarget("drag source", { x: 100, y: 100 }))
			.mockResolvedValueOnce(groundedTarget("drag destination", { x: 500, y: 400 }));
		const runtime = createRuntime(ground);

		const result = await runtime.drag({
			fromTarget: "drag source",
			toTarget: "drag destination",
		});

		expect(result.status.code).toBe("action_sent");
		const dragCall = mocks.win32HelperCalls.find((c) => c.subcommand === "drag");
		expect(dragCall).toBeDefined();
		expect(dragCall?.args).toContain("100");
		expect(dragCall?.args).toContain("500");
	});

	// ─── Branch: line 2712 (scroll → performWin32Scroll) ───

	it("scroll() dispatches to performWin32Scroll on win32 (line 2712)", async () => {
		const runtime = new ComputerUseGuiRuntime();

		const result = await runtime.scroll({ direction: "down" });

		expect(result.status.code).toBe("action_sent");
		const scrollCall = mocks.win32HelperCalls.find((c) => c.subcommand === "scroll");
		expect(scrollCall).toBeDefined();
		expect(scrollCall?.args).toContain("--unit");
	});

	it("scroll({direction:'up'}) dispatches positive deltaY to performWin32Scroll (line 2712)", async () => {
		const runtime = new ComputerUseGuiRuntime();

		await runtime.scroll({ direction: "up" });

		const scrollCall = mocks.win32HelperCalls.find((c) => c.subcommand === "scroll");
		expect(scrollCall).toBeDefined();
		// deltaY is positive for "up"
		const deltaY = Number(scrollCall?.args[3]);
		expect(deltaY).toBeGreaterThan(0);
	});

	// ─── Branch: line 2806 (type with target → pre-click → performWin32Click) ───
	// ─── Branch: line 2817 (type → performWin32Type) ───

	it("type() with target dispatches pre-click to performWin32Click then text to performWin32Type (lines 2806, 2817)", async () => {
		const ground = vi.fn().mockResolvedValue(groundedTarget("text field", { x: 300, y: 200 }));
		const runtime = createRuntime(ground);

		const result = await runtime.type({ target: "text field", value: "hello world" });

		expect(result.status.code).toBe("action_sent");
		// Pre-click (focus) uses win32 click
		const clickCalls = mocks.win32HelperCalls.filter((c) => c.subcommand === "click");
		expect(clickCalls.length).toBeGreaterThanOrEqual(1);
		// Type uses win32 type
		const typeCall = mocks.win32HelperCalls.find((c) => c.subcommand === "type");
		expect(typeCall).toBeDefined();
		// text is passed after the "--" separator (protects text starting with "--")
		const separatorIndex = typeCall!.args.indexOf("--");
		expect(separatorIndex).toBeGreaterThanOrEqual(0);
		expect(typeCall!.args[separatorIndex + 1]).toBe("hello world");
		expect(result.details).toMatchObject({ action_kind: "type" });
	});

	it("type() without target dispatches directly to performWin32Type (line 2817)", async () => {
		const runtime = new ComputerUseGuiRuntime();

		const result = await runtime.type({ value: "no target text" });

		expect(result.status.code).toBe("action_sent");
		const typeCall = mocks.win32HelperCalls.find((c) => c.subcommand === "type");
		expect(typeCall).toBeDefined();
		const separatorIndex = typeCall!.args.indexOf("--");
		expect(separatorIndex).toBeGreaterThanOrEqual(0);
		expect(typeCall!.args[separatorIndex + 1]).toBe("no target text");
		expect(result.details).toMatchObject({ action_kind: "type" });
		// No pre-click since no target
		const clickCalls = mocks.win32HelperCalls.filter((c) => c.subcommand === "click");
		expect(clickCalls).toHaveLength(0);
	});

	// ─── Branch: line 2882 (key → performWin32Hotkey) ───

	it("key() dispatches to performWin32Hotkey on win32 (line 2882)", async () => {
		const runtime = new ComputerUseGuiRuntime();

		const result = await runtime.key({ key: "a" });

		expect(result.status.code).toBe("action_sent");
		const hotkeyCall = mocks.win32HelperCalls.find((c) => c.subcommand === "hotkey");
		expect(hotkeyCall).toBeDefined();
		expect(hotkeyCall?.args[0]).toBe("a");
	});

	it("key() with modifiers maps macOS-style modifiers to win32 equivalents (line 2882)", async () => {
		const runtime = new ComputerUseGuiRuntime();

		await runtime.key({ key: "c", modifiers: ["command"] });

		const hotkeyCall = mocks.win32HelperCalls.find((c) => c.subcommand === "hotkey");
		expect(hotkeyCall).toBeDefined();
		expect(hotkeyCall?.args).toContain("--modifiers");
		// "command" should be mapped to "ctrl" on win32
		const modIndex = hotkeyCall!.args.indexOf("--modifiers");
		expect(hotkeyCall!.args[modIndex + 1]).toContain("ctrl");
	});

	// ─── Branch: line 2917 (move → performWin32Move) ───

	it("move() dispatches to performWin32Move on win32 (line 2917)", async () => {
		const runtime = new ComputerUseGuiRuntime();

		const result = await runtime.move({ x: 750, y: 450 });

		expect(result.status.code).toBe("action_sent");
		expect(result.text).toContain("win32_move");
		// performWin32Move uses execWin32Helper with subcommand "click" and --count 0
		const moveCall = mocks.win32HelperCalls.find(
			(c) => c.subcommand === "click" && c.args.includes("--count") && c.args.includes("0"),
		);
		expect(moveCall).toBeDefined();
		expect(moveCall?.args).toContain("750");
		expect(moveCall?.args).toContain("450");
	});

	// ─── Bug fix: captureWin32Screenshot cleans up tempDir on error ───

	it("observe() cleans up tempDir when the win32 helper throws (Task 1 fix)", async () => {
		mocks.execWin32Helper.mockRejectedValueOnce(new Error("helper crashed"));
		const runtime = new ComputerUseGuiRuntime();

		await expect(runtime.observe()).rejects.toThrow("helper crashed");
		// rm must have been called for cleanup (tempDir leak fix)
		expect(mocks.rm).toHaveBeenCalledWith(
			"/tmp/understudy-gui-test",
			{ recursive: true, force: true },
		);
	});

	// ─── Bug fix: performWin32Type uses boolean flags, not "1" values (Task 3 fix) ───

	it("type() with replace:true sends --replace flag without value (Task 3 fix)", async () => {
		const runtime = new ComputerUseGuiRuntime();

		await runtime.type({ value: "replacement text", replace: true });

		const typeCall = mocks.win32HelperCalls.find((c) => c.subcommand === "type");
		expect(typeCall).toBeDefined();
		expect(typeCall?.args).toContain("--replace");
		// Must NOT contain "1" as the value after --replace (boolean flag, not key-value)
		const replaceIdx = typeCall!.args.indexOf("--replace");
		expect(typeCall!.args[replaceIdx + 1]).not.toBe("1");
	});

	it("type() with text starting with '--' sends it safely after -- separator (Task 3 fix)", async () => {
		const runtime = new ComputerUseGuiRuntime();

		await runtime.type({ value: "--flag-like-text" });

		const typeCall = mocks.win32HelperCalls.find((c) => c.subcommand === "type");
		expect(typeCall).toBeDefined();
		const separatorIdx = typeCall!.args.indexOf("--");
		expect(separatorIdx).toBeGreaterThanOrEqual(0);
		expect(typeCall!.args[separatorIdx + 1]).toBe("--flag-like-text");
	});
});
