import { describe, expect, it } from "vitest";
import { createOcrEngine, createTesseractOcrEngine } from "../../grounding/ocr-engine.js";
import { createVisionOcrEngine } from "../../grounding/vision-ocr-helper.js";

describe("createOcrEngine", () => {
	it("returns an OcrEngine with a recognize method", () => {
		const engine = createOcrEngine();
		expect(engine).toHaveProperty("recognize");
		expect(typeof engine.recognize).toBe("function");
	});

	it("returns empty array for a blank image", async () => {
		const engine = createOcrEngine();
		const { createTestImage, cleanupTempDirs } = await import("../grounding-test-helpers.js");
		try {
			const imagePath = await createTestImage(100, 50, "blank.png");
			const results = await engine.recognize(imagePath);
			expect(Array.isArray(results)).toBe(true);
		} finally {
			await engine.terminate?.();
			await cleanupTempDirs();
		}
	});
});

describe("createTesseractOcrEngine", () => {
	it("produces OcrResult shape for any image", async () => {
		const engine = createTesseractOcrEngine({ languages: ["eng", "kor"] });
		const { createTestImage, cleanupTempDirs } = await import("../grounding-test-helpers.js");
		try {
			const imagePath = await createTestImage(200, 100, "ocr-test.png");
			const results = await engine.recognize(imagePath);
			expect(Array.isArray(results)).toBe(true);
			for (const result of results) {
				expect(result).toHaveProperty("text");
				expect(result).toHaveProperty("bbox");
				expect(result).toHaveProperty("confidence");
				expect(result.bbox).toHaveProperty("x");
				expect(result.bbox).toHaveProperty("y");
				expect(result.bbox).toHaveProperty("width");
				expect(result.bbox).toHaveProperty("height");
			}
		} finally {
			await engine.terminate?.();
			await cleanupTempDirs();
		}
	});

	it("terminates worker cleanly", async () => {
		const engine = createTesseractOcrEngine();
		await engine.terminate?.();
		// Should not throw on double-terminate
		await engine.terminate?.();
	});

	it("recovers after a recognize() rejection without leaking stale workers", async () => {
		const engine = createTesseractOcrEngine();
		const { createTestImage, cleanupTempDirs } = await import("../grounding-test-helpers.js");
		try {
			const imagePath = await createTestImage(10, 10, "ocr-force-fail.png");
			// Write garbage data to force tesseract to reject the image
			const fs = await import("node:fs/promises");
			await fs.writeFile(imagePath, Buffer.from("NOT_AN_IMAGE"));
			// Call twice — if worker cleanup works, second call creates a fresh
			// worker and does not hang or fire unhandled rejections.
			const results = await engine.recognize(imagePath);
			expect(Array.isArray(results)).toBe(true);
			const results2 = await engine.recognize(imagePath);
			expect(Array.isArray(results2)).toBe(true);
		} finally {
			await engine.terminate?.();
			await cleanupTempDirs();
		}
	});
});

describe.skipIf(process.platform !== "darwin")("createVisionOcrEngine", () => {
	it("produces OcrResult shape for any image", async () => {
		const engine = createVisionOcrEngine({ mode: "fast" });
		const { createTestImage, cleanupTempDirs } = await import("../grounding-test-helpers.js");
		try {
			const imagePath = await createTestImage(200, 100, "ocr-vision-test.png");
			const results = await engine.recognize(imagePath);
			expect(Array.isArray(results)).toBe(true);
			for (const result of results) {
				expect(result).toHaveProperty("text");
				expect(result).toHaveProperty("bbox");
				expect(result).toHaveProperty("confidence");
				expect(result.bbox).toHaveProperty("x");
				expect(result.bbox).toHaveProperty("y");
				expect(result.bbox).toHaveProperty("width");
				expect(result.bbox).toHaveProperty("height");
			}
		} finally {
			await cleanupTempDirs();
		}
	});
});
