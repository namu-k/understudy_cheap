import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GuiGroundingProvider, GuiGroundingRequest, GuiGroundingResult } from "@understudy/gui";
import { Win32UiaGroundingProvider } from "../uia-grounding-provider.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetUiaTree = vi.hoisted(() => vi.fn());
const mockResolveWin32Helper = vi.hoisted(() => vi.fn());

vi.mock("@understudy/gui", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@understudy/gui")>();
	return {
		...actual,
		getUiaTree: mockGetUiaTree,
		resolveWin32Helper: mockResolveWin32Helper,
	};
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(overrides: Partial<GuiGroundingRequest> = {}): GuiGroundingRequest {
	return {
		imagePath: "/tmp/test.png",
		target: "Save",
		...overrides,
	};
}

function makeUiaTreeRoot(children: unknown[] = []) {
	return {
		name: "Desktop",
		controlType: "Window",
		automationId: "",
		className: "",
		bounds: { x: 0, y: 0, width: 1920, height: 1080 },
		isEnabled: true,
		isOffscreen: false,
		children,
	};
}

function makeUiaButton(name: string, overrides: Record<string, unknown> = {}) {
	return {
		name,
		controlType: "Button",
		automationId: "",
		className: "",
		bounds: { x: 100, y: 100, width: 80, height: 30 },
		isEnabled: true,
		isOffscreen: false,
		...overrides,
	};
}

function createProvider(fallbackResult?: GuiGroundingResult): Win32UiaGroundingProvider {
	const fallback: GuiGroundingProvider = {
		ground: vi.fn().mockResolvedValue(fallbackResult),
	};
	return new Win32UiaGroundingProvider({
		fallbackProvider: fallback,
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Win32UiaGroundingProvider", () => {
	beforeEach(() => {
		mockGetUiaTree.mockReset();
		mockResolveWin32Helper.mockReset();
		mockResolveWin32Helper.mockResolvedValue("/tmp/helper.exe");
	});

	it("returns UIA match when found", async () => {
		mockGetUiaTree.mockResolvedValue(
			makeUiaTreeRoot([makeUiaButton("Save")]),
		);

		const provider = createProvider();
		const result = await provider.ground(makeRequest({ target: "Save" }));

		expect(result).not.toBeUndefined();
		expect(result!.provider).toContain("win32-uia");
		expect(result!.coordinateSpace).toBe("display_pixels");
		expect(result!.confidence).toBe(1.0);
		expect(result!.point).toEqual({ x: 140, y: 115 }); // center of (100,100,80,30)
	});

	it("falls back to screenshot provider when UIA finds no match", async () => {
		mockGetUiaTree.mockResolvedValue(
			makeUiaTreeRoot([makeUiaButton("Open")]),
		);

		const fallbackResult: GuiGroundingResult = {
			method: "grounding",
			provider: "openai",
			confidence: 0.8,
			reason: "Screenshot match",
			coordinateSpace: "image_pixels",
			point: { x: 200, y: 150 },
		};

		const provider = createProvider(fallbackResult);
		const result = await provider.ground(makeRequest({ target: "Save" }));

		expect(result).not.toBeUndefined();
		expect(result!.provider).toBe("openai");
	});

	it("falls back when getUiaTree throws", async () => {
		mockGetUiaTree.mockRejectedValue(new Error("COM error"));

		const fallbackResult: GuiGroundingResult = {
			method: "grounding",
			provider: "openai",
			confidence: 0.8,
			reason: "Fallback",
			coordinateSpace: "image_pixels",
			point: { x: 200, y: 150 },
		};

		const provider = createProvider(fallbackResult);
		const result = await provider.ground(makeRequest());

		expect(result!.provider).toBe("openai");
	});

	it("falls back when getUiaTree times out", async () => {
		mockGetUiaTree.mockRejectedValue(new Error("Timed out after 2000ms"));

		const fallbackResult: GuiGroundingResult = {
			method: "grounding",
			provider: "openai",
			confidence: 0.8,
			reason: "Timeout fallback",
			coordinateSpace: "image_pixels",
			point: { x: 200, y: 150 },
		};

		const provider = createProvider(fallbackResult);
		const result = await provider.ground(makeRequest());

		expect(result!.provider).toBe("openai");
	});

	it("returns undefined when both UIA and fallback fail", async () => {
		mockGetUiaTree.mockResolvedValue(
			makeUiaTreeRoot([makeUiaButton("Open")]),
		);

		const fallback: GuiGroundingProvider = {
			ground: vi.fn().mockResolvedValue(undefined),
		};
		const provider = new Win32UiaGroundingProvider({
			fallbackProvider: fallback,
		});

		const result = await provider.ground(makeRequest({ target: "Save" }));
		expect(result).toBeUndefined();
	});

	it("passes correct params to getUiaTree", async () => {
		mockGetUiaTree.mockResolvedValue(
			makeUiaTreeRoot([makeUiaButton("Save")]),
		);

		const provider = createProvider();
		await provider.ground(makeRequest({
			target: "Save",
			app: "notepad",
			windowTitle: "Untitled",
		}));

		expect(mockGetUiaTree).toHaveBeenCalledWith(
			expect.objectContaining({
				helperPath: "/tmp/helper.exe",
				app: "notepad",
				title: "Untitled",
			}),
		);
	});

	it("includes box in result from UIA match", async () => {
		mockGetUiaTree.mockResolvedValue(
			makeUiaTreeRoot([makeUiaButton("Save")]),
		);

		const provider = createProvider();
		const result = await provider.ground(makeRequest({ target: "Save" }));

		expect(result!.box).toEqual({
			x: 100,
			y: 100,
			width: 80,
			height: 30,
		});
	});

	it("sets correct provider name for each strategy", async () => {
		mockGetUiaTree.mockResolvedValue(
			makeUiaTreeRoot([makeUiaButton("Save", { automationId: "btnSave" })]),
		);

		const provider = createProvider();
		const result = await provider.ground(makeRequest({ target: "Save" }));

		// Exact name match → strategy = "exact_name"
		expect(result!.provider).toBe("win32-uia-exact_name");
	});

	it("falls back when resolveWin32Helper throws", async () => {
		mockResolveWin32Helper.mockRejectedValue(new Error("Helper not found"));

		const fallbackResult: GuiGroundingResult = {
			method: "grounding",
			provider: "openai",
			confidence: 0.8,
			reason: "Helper missing",
			coordinateSpace: "image_pixels",
			point: { x: 200, y: 150 },
		};

		const provider = createProvider(fallbackResult);
		const result = await provider.ground(makeRequest());

		expect(result!.provider).toBe("openai");
	});
});
