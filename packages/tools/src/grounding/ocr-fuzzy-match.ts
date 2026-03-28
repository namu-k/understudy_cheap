import type { OcrResult } from "./ocr-engine.js";

interface Bbox {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface OcrMatchResult {
	point: { x: number; y: number };
	confidence: number;
	method: string;
	matchedText: string;
	bbox: Bbox;
}

const HANGUL_BASE = 0xac00;
const HANGUL_END = 0xd7a3;
const HANGUL_VOWEL_COUNT = 21;
const HANGUL_TRAILING_COUNT = 28;
const HANGUL_BLOCK_SIZE = HANGUL_VOWEL_COUNT * HANGUL_TRAILING_COUNT;

const HANGUL_INITIALS = [
	"ㄱ",
	"ㄲ",
	"ㄴ",
	"ㄷ",
	"ㄸ",
	"ㄹ",
	"ㅁ",
	"ㅂ",
	"ㅃ",
	"ㅅ",
	"ㅆ",
	"ㅇ",
	"ㅈ",
	"ㅉ",
	"ㅊ",
	"ㅋ",
	"ㅌ",
	"ㅍ",
	"ㅎ",
];

const HANGUL_VOWELS = [
	"ㅏ",
	"ㅐ",
	"ㅑ",
	"ㅒ",
	"ㅓ",
	"ㅔ",
	"ㅕ",
	"ㅖ",
	"ㅗ",
	"ㅘ",
	"ㅙ",
	"ㅚ",
	"ㅛ",
	"ㅜ",
	"ㅝ",
	"ㅞ",
	"ㅟ",
	"ㅠ",
	"ㅡ",
	"ㅢ",
	"ㅣ",
];

const HANGUL_TRAILINGS = [
	"",
	"ㄱ",
	"ㄲ",
	"ㄳ",
	"ㄴ",
	"ㄵ",
	"ㄶ",
	"ㄷ",
	"ㄹ",
	"ㄺ",
	"ㄻ",
	"ㄼ",
	"ㄽ",
	"ㄾ",
	"ㄿ",
	"ㅀ",
	"ㅁ",
	"ㅂ",
	"ㅄ",
	"ㅅ",
	"ㅆ",
	"ㅇ",
	"ㅈ",
	"ㅊ",
	"ㅋ",
	"ㅌ",
	"ㅍ",
	"ㅎ",
];

export function fuzzyMatchOcr(results: OcrResult[], targetText: string): OcrMatchResult | null {
	for (const result of results) {
		if (result.text === targetText) {
			return toMatchResult(result, 1, "ocr_exact");
		}
	}

	const targetWithoutSpaces = stripSpaces(targetText);
	for (const result of results) {
		if (stripSpaces(result.text) === targetWithoutSpaces) {
			return toMatchResult(result, 0.95, "ocr_nospace");
		}
	}

	// Skip contains matching for single-character targets/results — too many false positives
	const MIN_CONTAINS_LENGTH = 2;
	for (const result of results) {
		if (targetText.length < MIN_CONTAINS_LENGTH && result.text.length < MIN_CONTAINS_LENGTH) {
			continue;
		}
		if (result.text.includes(targetText) || targetText.includes(result.text)) {
			return toMatchResult(result, 0.85, "ocr_contains");
		}
	}

	const targetJamo = decomposeHangul(targetWithoutSpaces);
	const hasKorean = targetJamo !== targetWithoutSpaces;
	if (hasKorean) {
		for (const result of results) {
			const ocrJamo = decomposeHangul(stripSpaces(result.text));
			const ocrHasKorean = ocrJamo !== stripSpaces(result.text);
			if (!ocrHasKorean) {
				continue;
			}
			const jamoDistance = levenshteinDistance(ocrJamo, targetJamo);
			if (jamoDistance <= 1) {
				return toMatchResult(result, 0.8, "ocr_jamo");
			}
		}
	}

	const fuzzyThreshold = Math.max(1, Math.floor(targetText.length * 0.3));
	for (const result of results) {
		const distance = levenshteinDistance(result.text, targetText);
		if (distance <= fuzzyThreshold) {
			return toMatchResult(result, 0.7, "ocr_fuzzy");
		}
	}

	return null;
}

function toMatchResult(result: OcrResult, confidence: number, method: string): OcrMatchResult {
	return {
		point: center(result.bbox),
		confidence,
		method,
		matchedText: result.text,
		bbox: result.bbox,
	};
}

function center(bbox: Bbox): { x: number; y: number } {
	return {
		x: Math.round(bbox.x + bbox.width / 2),
		y: Math.round(bbox.y + bbox.height / 2),
	};
}

function stripSpaces(text: string): string {
	return text.replace(/\s+/g, "");
}

function levenshteinDistance(a: string, b: string): number {
	if (a === b) {
		return 0;
	}

	if (a.length === 0) {
		return b.length;
	}

	if (b.length === 0) {
		return a.length;
	}

	const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
	const current = Array.from({ length: b.length + 1 }, () => 0);

	for (let i = 1; i <= a.length; i += 1) {
		current[0] = i;
		for (let j = 1; j <= b.length; j += 1) {
			const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
			current[j] = Math.min(
				previous[j] + 1,
				current[j - 1] + 1,
				previous[j - 1] + substitutionCost,
			);
		}

		for (let j = 0; j <= b.length; j += 1) {
			previous[j] = current[j];
		}
	}

	return previous[b.length];
}

function decomposeHangul(text: string): string {
	let decomposed = "";

	for (const character of text) {
		const codePoint = character.codePointAt(0);
		if (codePoint === undefined || codePoint < HANGUL_BASE || codePoint > HANGUL_END) {
			decomposed += character;
			continue;
		}

		const syllableIndex = codePoint - HANGUL_BASE;
		const initialIndex = Math.floor(syllableIndex / HANGUL_BLOCK_SIZE);
		const vowelIndex = Math.floor((syllableIndex % HANGUL_BLOCK_SIZE) / HANGUL_TRAILING_COUNT);
		const trailingIndex = syllableIndex % HANGUL_TRAILING_COUNT;

		decomposed += HANGUL_INITIALS[initialIndex] ?? character;
		decomposed += HANGUL_VOWELS[vowelIndex] ?? "";
		decomposed += HANGUL_TRAILINGS[trailingIndex] ?? "";
	}

	return decomposed;
}
