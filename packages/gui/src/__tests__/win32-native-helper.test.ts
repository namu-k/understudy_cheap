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

	// ─── Real-world edge cases ───────────────────────────────��───

	describe("execWin32Helper — error paths", () => {
		it("throws on empty stdout from helper", async () => {
			mocks.execFile.mockImplementation(
				(_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
					cb(null, "", "");
				},
			);

			const { execWin32Helper } = await import("../win32-native-helper.js");
			await expect(
				execWin32Helper({ helperPath: "C:\\test\\helper.exe", subcommand: "click", args: [] }),
			).rejects.toThrow(/empty output/);
		});

		it("throws on whitespace-only stdout", async () => {
			mocks.execFile.mockImplementation(
				(_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
					cb(null, "   \n\t  ", "");
				},
			);

			const { execWin32Helper } = await import("../win32-native-helper.js");
			await expect(
				execWin32Helper({ helperPath: "C:\\test\\helper.exe", subcommand: "click", args: [] }),
			).rejects.toThrow(/empty output/);
		});

		it("throws on malformed JSON", async () => {
			mocks.execFile.mockImplementation(
				(_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
					cb(null, '{"status":"ok","data":{"action":', "");
				},
			);

			const { execWin32Helper } = await import("../win32-native-helper.js");
			await expect(
				execWin32Helper({ helperPath: "C:\\test\\helper.exe", subcommand: "click", args: [] }),
			).rejects.toThrow(/invalid JSON/);
		});

		it("throws on non-JSON text output", async () => {
			mocks.execFile.mockImplementation(
				(_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
					cb(null, "Access denied. Run as Administrator.", "");
				},
			);

			const { execWin32Helper } = await import("../win32-native-helper.js");
			await expect(
				execWin32Helper({ helperPath: "C:\\test\\helper.exe", subcommand: "click", args: [] }),
			).rejects.toThrow(/invalid JSON/);
		});

		it("propagates process execution errors (ENOENT — binary not found)", async () => {
			mocks.execFile.mockImplementation(
				(_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
					const err = new Error("spawn C:\\test\\helper.exe ENOENT") as NodeJS.ErrnoException;
					err.code = "ENOENT";
					cb(err, "", "");
				},
			);

			const { execWin32Helper } = await import("../win32-native-helper.js");
			await expect(
				execWin32Helper({ helperPath: "C:\\test\\helper.exe", subcommand: "click", args: [] }),
			).rejects.toThrow(/ENOENT/);
		});

		it("handles error response without code gracefully", async () => {
			mocks.execFile.mockImplementation(
				(_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
					cb(null, '{"status":"error","message":"something went wrong"}', "");
				},
			);

			const { execWin32Helper } = await import("../win32-native-helper.js");
			await expect(
				execWin32Helper({ helperPath: "C:\\test\\helper.exe", subcommand: "click", args: [] }),
			).rejects.toThrow(/UNKNOWN.*something went wrong/);
		});

		it("handles error response without message gracefully", async () => {
			mocks.execFile.mockImplementation(
				(_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
					cb(null, '{"status":"error","code":"INTERNAL_ERROR"}', "");
				},
			);

			const { execWin32Helper } = await import("../win32-native-helper.js");
			await expect(
				execWin32Helper({ helperPath: "C:\\test\\helper.exe", subcommand: "click", args: [] }),
			).rejects.toThrow(/INTERNAL_ERROR.*Unknown error/);
		});

		it("parses response with stderr content (stderr is ignored)", async () => {
			mocks.execFile.mockImplementation(
				(_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
					cb(null, '{"status":"ok","data":{"action":"click"}}', "WARNING: something on stderr");
				},
			);

			const { execWin32Helper } = await import("../win32-native-helper.js");
			const result = await execWin32Helper({
				helperPath: "C:\\test\\helper.exe",
				subcommand: "click",
				args: [],
			});
			expect(result).toEqual({ action: "click" });
		});
	});

	describe("mapCaptureContext — edge cases", () => {
		it("handles Unicode and emoji in window titles", async () => {
			const { mapCaptureContext } = await import("../win32-native-helper.js");
			const raw = {
				displays: [
					{ index: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.0 },
				],
				cursor: { x: 100, y: 200 },
				windows: [
					{
						title: "메모장 - 새 파일 🚀",
						appName: "notepad",
						pid: 5678,
						bounds: { x: 100, y: 100, width: 800, height: 600 },
					},
				],
				frontmostApp: "notepad",
				frontmostWindowTitle: "메모장 - 새 파일 🚀",
			};
			const ctx = mapCaptureContext(raw);
			expect(ctx.windowTitle).toBe("메모장 - 새 파일 🚀");
			expect(ctx.appName).toBe("notepad");
			expect(ctx.windowBounds).toEqual({ x: 100, y: 100, width: 800, height: 600 });
		});

		it("uses fallback display when displays array is empty", async () => {
			const { mapCaptureContext } = await import("../win32-native-helper.js");
			const raw = {
				displays: [] as Array<{ index: number; bounds: { x: number; y: number; width: number; height: number }; scaleFactor: number }>,
				cursor: { x: 0, y: 0 },
				windows: [],
				frontmostApp: "",
				frontmostWindowTitle: "",
			};
			const ctx = mapCaptureContext(raw);
			expect(ctx.display.index).toBe(1);
			expect(ctx.display.bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
		});

		it("returns undefined windowBounds when frontmost title doesn't match any window", async () => {
			const { mapCaptureContext } = await import("../win32-native-helper.js");
			const raw = {
				displays: [
					{ index: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.0 },
				],
				cursor: { x: 500, y: 300 },
				windows: [
					{
						title: "Some Window",
						appName: "app",
						pid: 111,
						bounds: { x: 0, y: 0, width: 800, height: 600 },
					},
				],
				frontmostApp: "different_app",
				frontmostWindowTitle: "Title That Doesn't Match",
			};
			const ctx = mapCaptureContext(raw);
			expect(ctx.windowBounds).toBeUndefined();
			expect(ctx.windowTitle).toBe("Title That Doesn't Match");
			expect(ctx.windowCount).toBe(1);
		});

		it("handles many windows (simulating busy desktop)", async () => {
			const { mapCaptureContext } = await import("../win32-native-helper.js");
			const windows = Array.from({ length: 50 }, (_, i) => ({
				title: `Window ${i}`,
				appName: `app${i}`,
				pid: 1000 + i,
				bounds: { x: i * 10, y: i * 10, width: 800, height: 600 },
			}));
			const raw = {
				displays: [
					{ index: 1, bounds: { x: 0, y: 0, width: 3840, height: 2160 }, scaleFactor: 2.0 },
				],
				cursor: { x: 1920, y: 1080 },
				windows,
				frontmostApp: "app25",
				frontmostWindowTitle: "Window 25",
			};
			const ctx = mapCaptureContext(raw);
			expect(ctx.windowCount).toBe(50);
			expect(ctx.windowBounds).toEqual({ x: 250, y: 250, width: 800, height: 600 });
			expect(ctx.display.scaleFactor).toBe(2.0);
		});

		it("handles multi-monitor setup with correct primary display", async () => {
			const { mapCaptureContext } = await import("../win32-native-helper.js");
			const raw = {
				displays: [
					{ index: 1, bounds: { x: 0, y: 0, width: 2560, height: 1440 }, scaleFactor: 1.25 },
					{ index: 2, bounds: { x: 2560, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.0 },
				],
				cursor: { x: 3000, y: 500 },
				windows: [
					{
						title: "VS Code",
						appName: "code",
						pid: 2000,
						bounds: { x: 2560, y: 0, width: 1920, height: 1080 },
					},
				],
				frontmostApp: "code",
				frontmostWindowTitle: "VS Code",
			};
			const ctx = mapCaptureContext(raw);
			// Should use primary display (index 1), not where cursor is
			expect(ctx.display.index).toBe(1);
			expect(ctx.display.scaleFactor).toBe(1.25);
			expect(ctx.cursor).toEqual({ x: 3000, y: 500 });
		});
	});

	describe("resolveWin32Helper — fallback chain", () => {
		it("throws descriptive error when no helper binary found anywhere", async () => {
			const original = process.env.UNDERSTUDY_WIN32_HELPER_PATH;
			delete process.env.UNDERSTUDY_WIN32_HELPER_PATH;
			mocks.access.mockRejectedValue(new Error("ENOENT"));

			const { resolveWin32Helper } = await import("../win32-native-helper.js");
			await expect(resolveWin32Helper()).rejects.toThrow(/Win32 helper binary not found/);

			if (original !== undefined) process.env.UNDERSTUDY_WIN32_HELPER_PATH = original;
		});
	});

	describe("Win32HelperError", () => {
		it("has correct name and code properties", async () => {
			const { Win32HelperError } = await import("../win32-native-helper.js");
			const err = new Win32HelperError("test error", "TEST_CODE");
			expect(err.name).toBe("Win32HelperError");
			expect(err.code).toBe("TEST_CODE");
			expect(err.message).toBe("test error");
			expect(err).toBeInstanceOf(Error);
		});
	});

	describe("getUiaTree", () => {
		it("calls uia-tree subcommand and returns parsed tree", async () => {
			const tree = {
				name: "Desktop",
				controlType: "Pane",
				automationId: "",
				className: "#32769",
				bounds: { x: 0, y: 0, width: 1920, height: 1080 },
				isEnabled: true,
				isOffscreen: false,
				children: [
					{
						name: "Notepad",
						controlType: "Window",
						automationId: "Notepad",
						className: "Notepad",
						bounds: { x: 100, y: 100, width: 800, height: 600 },
						isEnabled: true,
						isOffscreen: false,
						children: [],
					},
				],
			};
			mocks.execFile.mockImplementation(
				(_cmd: string, args: string[], _opts: unknown, cb: Function) => {
					expect(args[0]).toBe("uia-tree");
					expect(args).toContain("--app");
					expect(args).toContain("notepad");
					expect(args).toContain("--max-depth");
					expect(args).toContain("5");
					cb(null, JSON.stringify({ status: "ok", data: tree }), "");
				},
			);

			const { getUiaTree } = await import("../win32-native-helper.js");
			const result = await getUiaTree({
				helperPath: "C:\\helper.exe",
				app: "notepad",
				maxDepth: 5,
			});
			expect(result).toEqual(tree);
		});

		it("passes --hwnd when provided", async () => {
			const tree = {
				name: "Window",
				controlType: "Window",
				automationId: "",
				className: "",
				bounds: { x: 0, y: 0, width: 100, height: 100 },
				isEnabled: true,
				isOffscreen: false,
			};
			mocks.execFile.mockImplementation(
				(_cmd: string, args: string[], _opts: unknown, cb: Function) => {
					expect(args).toContain("--hwnd");
					expect(args).toContain("12345");
					cb(null, JSON.stringify({ status: "ok", data: tree }), "");
				},
			);

			const { getUiaTree } = await import("../win32-native-helper.js");
			const result = await getUiaTree({
				helperPath: "C:\\helper.exe",
				hwnd: "12345",
			});
			expect(result.controlType).toBe("Window");
		});

		it("passes --title when provided", async () => {
			const tree = {
				name: "Untitled - Notepad",
				controlType: "Window",
				automationId: "",
				className: "Notepad",
				bounds: { x: 0, y: 0, width: 800, height: 600 },
				isEnabled: true,
				isOffscreen: false,
			};
			mocks.execFile.mockImplementation(
				(_cmd: string, args: string[], _opts: unknown, cb: Function) => {
					expect(args).toContain("--title");
					expect(args).toContain("Untitled");
					cb(null, JSON.stringify({ status: "ok", data: tree }), "");
				},
			);

			const { getUiaTree } = await import("../win32-native-helper.js");
			const result = await getUiaTree({
				helperPath: "C:\\helper.exe",
				title: "Untitled",
			});
			expect(result.name).toBe("Untitled - Notepad");
		});

		it("uses 30s default timeout for large trees", async () => {
			mocks.execFile.mockImplementation(
				(_cmd: string, _args: string[], opts: { timeout: number }, cb: Function) => {
					expect(opts.timeout).toBe(30_000);
					cb(null, JSON.stringify({ status: "ok", data: { name: "root", controlType: "Pane", automationId: "", className: "", bounds: { x: 0, y: 0, width: 0, height: 0 }, isEnabled: true, isOffscreen: false } }), "");
				},
			);

			const { getUiaTree } = await import("../win32-native-helper.js");
			await getUiaTree({ helperPath: "C:\\helper.exe" });
		});

		it("propagates WINDOW_NOT_FOUND error", async () => {
			mocks.execFile.mockImplementation(
				(_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
					cb(
						null,
						JSON.stringify({
							status: "error",
							code: "WINDOW_NOT_FOUND",
							message: "No visible window matches: app=nonexistent",
						}),
						"",
					);
				},
			);

			const { getUiaTree } = await import("../win32-native-helper.js");
			await expect(
				getUiaTree({ helperPath: "C:\\helper.exe", app: "nonexistent" }),
			).rejects.toThrow(/WINDOW_NOT_FOUND/);
		});
	});
});
