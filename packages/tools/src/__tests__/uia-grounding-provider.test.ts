import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GuiGroundingProvider, GuiGroundingRequest, GuiGroundingResult } from "@understudy/gui";
import { Win32UiaGroundingProvider } from "../uia-grounding-provider.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetUiaTree = vi.hoisted(() => vi.fn());
const mockResolveWin32Helper = vi.hoisted(() => vi.fn());

const { mockLog } = vi.hoisted(() => ({
	mockLog: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("@understudy/core", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@understudy/core")>();
	return {
		...actual,
		createLogger: vi.fn(() => mockLog),
	};
});

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

	// --- Logging tests (Task 2) ---

	it("logs debug when UIA match is found", async () => {
		mockGetUiaTree.mockResolvedValue(
			makeUiaTreeRoot([makeUiaButton("Save")]),
        );

		const provider = createProvider();
        await provider.ground(makeRequest({ target: "Save" }));

        expect(mockLog.debug).toHaveBeenCalledWith(
            "UIA match found",
            expect.objectContaining({ strategy: "exact_name" }),
        );
    });

    it("logs warn when UIA tree fetch fails", async () => {
        mockGetUiaTree.mockRejectedValue(new Error("COM error"));

        const fallback: GuiGroundingProvider = {
            ground: vi.fn().mockResolvedValue(undefined),
        };
        const provider = new Win32UiaGroundingProvider({
            fallbackProvider: fallback,
        });
        await provider.ground(makeRequest());

        expect(mockLog.warn).toHaveBeenCalledWith(
            "UIA tree fetch failed, falling back to screenshot",
            expect.objectContaining({ error: expect.stringContaining("COM error") }),
        );
    });

    // --- Retry tests (Task 3) ---

    it("retries helper resolution after initial failure", async () => {
        mockResolveWin32Helper.mockRejectedValueOnce(new Error("Helper not found"));
        mockResolveWin32Helper.mockResolvedValue("/tmp/helper.exe");
        mockGetUiaTree.mockResolvedValue(
            makeUiaTreeRoot([makeUiaButton("Save")]),
        );

        const fallback: GuiGroundingProvider = {
            ground: vi.fn().mockResolvedValue(undefined),
        };
        const provider = new Win32UiaGroundingProvider({
            fallbackProvider: fallback,
        });

        // First ground() — helper not found, falls back
        const result1 = await provider.ground(makeRequest());
        expect(result1).toBeUndefined();

        // Second ground() — helper resolves, UIA match succeeds
        const result2 = await provider.ground(makeRequest({ target: "Save" }));
        expect(result2).not.toBeUndefined();
        expect(result2!.provider).toContain("win32-uia");
    });

    // --- Optional fallback + env-var config (Task 4) ---

    it("works without fallback provider (UIA-only mode)", async () => {
        mockGetUiaTree.mockResolvedValue(
            makeUiaTreeRoot([makeUiaButton("Save")]),
        );

        const provider = new Win32UiaGroundingProvider({});
        const result = await provider.ground(makeRequest({ target: "Save" }));

        expect(result).not.toBeUndefined();
        expect(result!.provider).toContain("win32-uia");
    });

    it("returns undefined when UIA-only mode has no match", async () => {
        mockGetUiaTree.mockResolvedValue(
            makeUiaTreeRoot([makeUiaButton("Open")]),
        );

        const provider = new Win32UiaGroundingProvider({});
        const result = await provider.ground(makeRequest({ target: "Save" }));

        expect(result).toBeUndefined();
    });

    it("reads config from env vars", async () => {
        const originalDepth = process.env.UNDERSTUDY_UIA_MAX_DEPTH;
        const originalTimeout = process.env.UNDERSTUDY_UIA_TIMEOUT_MS;
        process.env.UNDERSTUDY_UIA_MAX_DEPTH = "5";
        process.env.UNDERSTUDY_UIA_TIMEOUT_MS = "500";

        mockGetUiaTree.mockResolvedValue(
            makeUiaTreeRoot([makeUiaButton("Save")]),
        );

        try {
            const provider = createProvider();
            await provider.ground(makeRequest({ target: "Save" }));

            expect(mockGetUiaTree).toHaveBeenCalledWith(
                expect.objectContaining({
                    maxDepth: 5,
                    timeoutMs: 500,
                }),
            );
        } finally {
            if (originalDepth !== undefined) {
                process.env.UNDERSTUDY_UIA_MAX_DEPTH = originalDepth;
            } else {
                delete process.env.UNDERSTUDY_UIA_MAX_DEPTH;
            }
            if (originalTimeout !== undefined) {
                process.env.UNDERSTUDY_UIA_TIMEOUT_MS = originalTimeout;
            } else {
                delete process.env.UNDERSTUDY_UIA_TIMEOUT_MS;
            }
        }
    });
});
