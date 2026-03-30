import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	execFile: vi.fn(),
	access: vi.fn(),
	mkdir: vi.fn(),
	existsSync: vi.fn(),
	createWriteStream: vi.fn(),
	pipeline: vi.fn(),
	fetch: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));
vi.mock("node:fs/promises", async () => {
	const actual = await vi.importActual("node:fs/promises");
	return { ...actual, access: mocks.access, mkdir: mocks.mkdir };
});
vi.mock("node:fs", () => ({ existsSync: mocks.existsSync }));

describe("win32-native-helper", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	describe("resolveWin32Helper", () => {
		it("uses UNDERSTUDY_WIN32_HELPER_PATH env var when set", async () => {
			const original = process.env.UNDERSTUDY_WIN32_HELPER_PATH;
			process.env.UNDERSTUDY_WIN32_HELPER_PATH = "C:\\custom\\helper.exe";
			mocks.access.mockResolvedValue(undefined);

			const { resolveWin32Helper } = await import("../win32-native-helper.js");
			const path = await resolveWin32Helper();
			expect(path).toBe("C:\\custom\\helper.exe");

			if (original === undefined) delete process.env.UNDERSTUDY_WIN32_HELPER_PATH;
			else process.env.UNDERSTUDY_WIN32_HELPER_PATH = original;
		});

		it("throws when env var path is not accessible", async () => {
			const original = process.env.UNDERSTUDY_WIN32_HELPER_PATH;
			process.env.UNDERSTUDY_WIN32_HELPER_PATH = "C:\\nonexistent\\helper.exe";
			mocks.access.mockRejectedValue(new Error("ENOENT"));

			const { resolveWin32Helper } = await import("../win32-native-helper.js");
			await expect(resolveWin32Helper()).rejects.toThrow(/not accessible/);

			if (original === undefined) delete process.env.UNDERSTUDY_WIN32_HELPER_PATH;
			else process.env.UNDERSTUDY_WIN32_HELPER_PATH = original;
		});
	});

	describe("execWin32Helper", () => {
		it("parses successful JSON response", async () => {
			mocks.execFile.mockImplementation(
				(_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
					cb(null, '{"status":"ok","data":{"action":"click"}}', "");
				},
			);
			mocks.access.mockResolvedValue(undefined);

			const { execWin32Helper } = await import("../win32-native-helper.js");
			const result = await execWin32Helper({
				helperPath: "C:\\test\\helper.exe",
				subcommand: "click",
				args: ["100", "200"],
			});
			expect(result).toEqual({ action: "click" });
		});

		it("throws on error response", async () => {
			mocks.execFile.mockImplementation(
				(_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
					cb(null, '{"status":"error","code":"WINDOW_NOT_FOUND","message":"No match"}', "");
				},
			);

			const { execWin32Helper } = await import("../win32-native-helper.js");
			await expect(
				execWin32Helper({
					helperPath: "C:\\test\\helper.exe",
					subcommand: "enumerate-windows",
					args: ["--app", "nonexistent"],
				}),
			).rejects.toThrow(/WINDOW_NOT_FOUND/);
		});
	});

	describe("mapCaptureContext", () => {
		it("maps Win32 capture-context JSON to GuiCaptureContext", async () => {
			const { mapCaptureContext } = await import("../win32-native-helper.js");
			const raw = {
				displays: [
					{ index: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.5 },
				],
				cursor: { x: 487, y: 312 },
				windows: [
					{
						title: "Google - Chrome",
						appName: "chrome",
						pid: 1234,
						bounds: { x: 0, y: 0, width: 1920, height: 1080 },
					},
				],
				frontmostApp: "chrome",
				frontmostWindowTitle: "Google - Chrome",
			};
			const ctx = mapCaptureContext(raw);
			expect(ctx.display).toEqual({
				index: 1,
				bounds: { x: 0, y: 0, width: 1920, height: 1080 },
				scaleFactor: 1.5,
			});
			expect(ctx.cursor).toEqual({ x: 487, y: 312 });
			expect(ctx.appName).toBe("chrome");
			expect(ctx.windowTitle).toBe("Google - Chrome");
			expect(ctx.windowBounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
			expect(ctx.windowCount).toBe(1);
		});

		it("handles empty windows list", async () => {
			const { mapCaptureContext } = await import("../win32-native-helper.js");
			const raw = {
				displays: [
					{ index: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.0 },
				],
				cursor: { x: 0, y: 0 },
				windows: [],
				frontmostApp: "",
				frontmostWindowTitle: "",
			};
			const ctx = mapCaptureContext(raw);
			expect(ctx.windowBounds).toBeUndefined();
			expect(ctx.windowCount).toBe(0);
			expect(ctx.appName).toBeUndefined();
		});
	});
});
