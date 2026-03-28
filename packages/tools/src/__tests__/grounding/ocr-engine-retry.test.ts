import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFile, unlink, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mockCreateWorker = vi.fn();

vi.mock("tesseract.js", () => ({
	createWorker: mockCreateWorker,
	OEM: { LSTM_ONLY: 1 },
}));

describe("createTesseractOcrEngine - worker retry after failure", () => {
	let tmpDir: string;
	let tmpFile: string;

	beforeEach(async () => {
		vi.clearAllMocks();
		tmpDir = await mkdtemp(join(tmpdir(), "ocr-retry-test-"));
		tmpFile = join(tmpDir, "dummy.png");
		await writeFile(tmpFile, Buffer.alloc(10));
	});

	afterEach(async () => {
		await unlink(tmpFile).catch(() => {});
	});

	it("retries worker creation after failure instead of caching the rejected promise", async () => {
		const { createTesseractOcrEngine } = await import("../../grounding/ocr-engine.js");

		const mockWorker = {
			recognize: vi.fn().mockResolvedValue({ data: { words: [] } }),
			terminate: vi.fn().mockResolvedValue(undefined),
		};

		// First createWorker call fails, second succeeds
		mockCreateWorker
			.mockRejectedValueOnce(new Error("worker init failed"))
			.mockResolvedValueOnce(mockWorker);

		const engine = createTesseractOcrEngine({ languages: ["eng"] });

		// First recognize: worker creation fails, returns []
		const first = await engine.recognize(tmpFile);
		expect(first).toEqual([]);
		expect(mockCreateWorker).toHaveBeenCalledTimes(1);

		// Second recognize: must retry worker creation (not use cached rejection)
		const second = await engine.recognize(tmpFile);
		expect(second).toEqual([]);
		// Fails before fix: stays at 1 (uses cached rejected workerPromise)
		// Passes after fix: workerPromise reset to null → createWorker called again
		expect(mockCreateWorker).toHaveBeenCalledTimes(2);

		await engine.terminate?.();
	});
});
