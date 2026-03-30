import { describe, expect, it } from "vitest";
import { resolveGuiRuntimeCapabilities } from "../capabilities.js";

describe("resolveGuiRuntimeCapabilities", () => {
	it("reports platformSupported=true for win32", () => {
		const caps = resolveGuiRuntimeCapabilities({ platform: "win32" });
		expect(caps.platformSupported).toBe(true);
	});

	it("reports platformSupported=false for linux", () => {
		const caps = resolveGuiRuntimeCapabilities({ platform: "linux" });
		expect(caps.platformSupported).toBe(false);
	});

	it("reports platformSupported=true for darwin", () => {
		const caps = resolveGuiRuntimeCapabilities({ platform: "darwin" });
		expect(caps.platformSupported).toBe(true);
	});

	it("enables gui_key and gui_move on win32 with helper available", () => {
		const caps = resolveGuiRuntimeCapabilities({
			platform: "win32",
			environmentReadiness: {
				status: "ready",
				checkedAt: 0,
				checks: [
					{ id: "native_helper", label: "", status: "ok", summary: "" },
					{ id: "accessibility", label: "", status: "ok", summary: "" },
					{ id: "screen_recording", label: "", status: "ok", summary: "" },
				],
			},
		});
		expect(caps.toolAvailability.gui_key.enabled).toBe(true);
		expect(caps.toolAvailability.gui_move.enabled).toBe(true);
	});
});
