import { describe, expect, it, vi } from "vitest";
import { inspectGuiEnvironmentReadiness } from "../readiness.js";

describe("inspectGuiEnvironmentReadiness", () => {
	it("reports unsupported on non-macOS platforms", async () => {
		const snapshot = await inspectGuiEnvironmentReadiness("linux");

		expect(snapshot).toEqual({
			status: "unsupported",
			checkedAt: expect.any(Number),
			checks: [
				{
					id: "platform",
					label: "Platform",
					status: "unsupported",
					summary: "GUI runtime checks are currently implemented for macOS and Windows only.",
					detail: "Current platform: linux",
				},
			],
		});
	});

	it("reports native helper readiness on macOS when permissions and helper are available", async () => {
		const runSwiftBooleanCheck = vi.fn(async () => true);
		const snapshot = await inspectGuiEnvironmentReadiness("darwin", {
			now: () => 123,
			runSwiftBooleanCheck,
			resolveNativeHelperBinary: async () => "/tmp/understudy-native-helper",
			accessPath: async () => {},
		});

		expect(snapshot).toMatchObject({
			status: "ready",
			checkedAt: 123,
		});
		expect(snapshot.checks.find((check) => check.id === "native_helper")).toMatchObject({
			status: "ok",
			summary: "Native GUI helper is ready for capture and input execution.",
			detail: "/tmp/understudy-native-helper",
		});
		expect(runSwiftBooleanCheck).toHaveBeenCalledTimes(2);
	});

	it("reports degraded when permission probes cannot be confirmed but the helper is available", async () => {
		const snapshot = await inspectGuiEnvironmentReadiness("darwin", {
			runSwiftBooleanCheck: vi.fn(async () => {
				throw new Error("swift unavailable");
			}),
			resolveNativeHelperBinary: async () => "/tmp/understudy-native-helper",
			accessPath: async () => {},
		});

		expect(snapshot.status).toBe("degraded");
		expect(snapshot.checks.find((check) => check.id === "accessibility")).toMatchObject({
			status: "warn",
			summary: "Could not confirm Accessibility permission state.",
			detail: expect.stringContaining("swift unavailable"),
		});
		expect(snapshot.checks.find((check) => check.id === "screen_recording")).toMatchObject({
			status: "warn",
			summary: "Could not confirm Screen Recording permission state.",
			detail: expect.stringContaining("swift unavailable"),
		});
		expect(snapshot.checks.find((check) => check.id === "native_helper")).toMatchObject({
			status: "ok",
			detail: "/tmp/understudy-native-helper",
		});
	});

	it("blocks macOS readiness when the native helper cannot be resolved", async () => {
		const snapshot = await inspectGuiEnvironmentReadiness("darwin", {
			runSwiftBooleanCheck: async () => true,
			resolveNativeHelperBinary: async () => {
				throw new Error("swiftc missing");
			},
		});

		expect(snapshot.status).toBe("blocked");
		expect(snapshot.checks.find((check) => check.id === "native_helper")).toMatchObject({
			status: "error",
			summary: "Native GUI helper is unavailable.",
			detail: expect.stringContaining("swiftc missing"),
		});
	});

	it("reports win32 readiness checks when helper is available", async () => {
		const snapshot = await inspectGuiEnvironmentReadiness("win32", {
			now: () => 456,
			resolveWin32Helper: async () => "C:\\test\\helper.exe",
			execWin32Helper: async () => ({
				platform: "win32",
				checks: {
					wgc_available: { status: true, detail: "WGC available" },
					sendinput_available: { status: true, detail: "SendInput OK" },
					ui_automation_accessible: { status: true, detail: "UIA OK" },
					dpi_awareness: { status: "per_monitor_v2", detail: "PMv2" },
					is_elevated: { status: false, detail: "Not elevated" },
					os_version: { status: "10.0.26200" },
				},
			}),
		});

		expect(snapshot.status).toBe("ready");
		expect(snapshot.checkedAt).toBe(456);
		expect(snapshot.checks.find((c) => c.id === "platform")).toMatchObject({
			status: "ok",
			summary: expect.stringContaining("Windows"),
		});
		expect(snapshot.checks.find((c) => c.id === "wgc")).toMatchObject({
			status: "ok",
		});
		expect(snapshot.checks.find((c) => c.id === "sendinput")).toMatchObject({
			status: "ok",
		});
	});

	it("reports win32 blocked when helper is unavailable", async () => {
		const snapshot = await inspectGuiEnvironmentReadiness("win32", {
			now: () => 789,
			resolveWin32Helper: async () => { throw new Error("not found"); },
		});

		expect(snapshot.status).toBe("blocked");
		expect(snapshot.checks.find((c) => c.id === "native_helper")).toMatchObject({
			status: "error",
			summary: expect.stringContaining("unavailable"),
		});
	});

	it("reports win32 degraded when WGC is unavailable but SendInput works", async () => {
		const snapshot = await inspectGuiEnvironmentReadiness("win32", {
			now: () => 100,
			resolveWin32Helper: async () => "C:\\test\\helper.exe",
			execWin32Helper: async () => ({
				platform: "win32",
				checks: {
					wgc_available: { status: false, detail: "WGC unavailable" },
					sendinput_available: { status: true, detail: "OK" },
					ui_automation_accessible: { status: true, detail: "OK" },
					dpi_awareness: { status: "per_monitor_v2", detail: "PMv2" },
					is_elevated: { status: false, detail: "Not elevated" },
					os_version: { status: "10.0.19041" },
				},
			}),
		});

		expect(snapshot.status).toBe("degraded");
		expect(snapshot.checks.find((c) => c.id === "wgc")).toMatchObject({
			status: "warn",
		});
	});
});
