import { describe, expect, it } from "vitest";
import {
	fuzzyMatchOcr,
	type OcrMatchResult,
} from "../../grounding/ocr-fuzzy-match.js";
import type { OcrResult } from "../../grounding/ocr-engine.js";

const makeOcr = (text: string, x = 100, y = 200, w = 50, h = 20): OcrResult => ({
	text,
	bbox: { x, y, width: w, height: h },
	confidence: 0.9,
});

function expectMatch(result: OcrMatchResult | null): OcrMatchResult {
	expect(result).not.toBeNull();
	return result as OcrMatchResult;
}

describe("fuzzyMatchOcr", () => {
	it("returns an exact OCR match with full confidence and center point", () => {
		const match = expectMatch(fuzzyMatchOcr([makeOcr("검색")], "검색"));

		expect(match).toMatchObject({
			confidence: 1,
			method: "ocr_exact",
			matchedText: "검색",
			point: { x: 125, y: 210 },
			bbox: { x: 100, y: 200, width: 50, height: 20 },
		});
	});

	it("matches after stripping whitespace from OCR text and target text", () => {
		const match = expectMatch(fuzzyMatchOcr([makeOcr("검 색")], "검색"));

		expect(match.confidence).toBe(0.95);
		expect(match.method).toBe("ocr_nospace");
		expect(match.matchedText).toBe("검 색");
	});

	it("matches when the target text is contained inside the OCR result", () => {
		const match = expectMatch(fuzzyMatchOcr([makeOcr("Google 검색")], "검색"));

		expect(match.confidence).toBe(0.85);
		expect(match.method).toBe("ocr_contains");
	});

	it("matches when the OCR result is contained inside the target text", () => {
		const match = expectMatch(fuzzyMatchOcr([makeOcr("검색")], "Google 검색"));

		expect(match.confidence).toBe(0.85);
		expect(match.method).toBe("ocr_contains");
	});

	it("returns null when no OCR result matches the target", () => {
		expect(fuzzyMatchOcr([makeOcr("닫기"), makeOcr("취소")], "검색")).toBeNull();
	});

	it("matches near-identical Korean text via jamo decomposition", () => {
		const match = expectMatch(fuzzyMatchOcr([makeOcr("검 삭")], "검색"));

		expect(match.confidence).toBeGreaterThanOrEqual(0.7);
		expect(match.confidence).toBe(0.8);
		expect(match.method).toBe("ocr_jamo");
	});

	it("matches Latin OCR typos with Levenshtein distance", () => {
		const match = expectMatch(fuzzyMatchOcr([makeOcr("Searcb")], "Search"));

		expect(match.confidence).toBe(0.7);
		expect(match.method).toBe("ocr_fuzzy");
		expect(match.matchedText).toBe("Searcb");
	});
});
