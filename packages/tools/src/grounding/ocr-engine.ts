import { readFile } from "node:fs/promises";
import { createLogger } from "@understudy/core";

const log = createLogger("grounding:ocr");

/**
 * Unified OCR result type used across all OCR backends and fuzzy matching.
 * Do NOT define duplicate interfaces (e.g. OcrHit) — use this everywhere.
 */
export interface OcrResult {
	text: string;
	bbox: { x: number; y: number; width: number; height: number };
	confidence: number;
}

export interface OcrEngineOptions {
	languages?: string[];
	minConfidence?: number;
	mode?: "accurate" | "fast";
}

export interface OcrEngine {
	recognize(imagePath: string): Promise<OcrResult[]>;
	terminate?(): Promise<void>;
}

// ── Tesseract.js backend ─────────────────────────────────────────────────────

const WORKER_IDLE_TIMEOUT_MS = 60_000;
const WORKER_MAX_JOBS = 500;

// Explicit interface for Tesseract word response — no `any` casts
interface TesseractWord {
	text: string;
	confidence: number;
	bbox?: { x0: number; y0: number; x1: number; y1: number };
}

interface TesseractRecognizeData {
	words?: TesseractWord[];
}

interface TesseractWorkerHandle {
	recognize(image: Buffer): Promise<{ data: TesseractRecognizeData }>;
	terminate(): Promise<void>;
}

export function createTesseractOcrEngine(options: OcrEngineOptions = {}): OcrEngine {
	const languages = options.languages ?? ["eng", "kor"];
	const minConfidence = options.minConfidence ?? 0.3;
	const langString = languages.join("+");

	let worker: TesseractWorkerHandle | null = null;
	let workerPromise: Promise<TesseractWorkerHandle> | null = null;
	let jobCount = 0;
	let idleTimer: ReturnType<typeof setTimeout> | null = null;

	function clearIdle() {
		if (idleTimer) {
			clearTimeout(idleTimer);
			idleTimer = null;
		}
	}

	function scheduleIdle() {
		clearIdle();
		idleTimer = setTimeout(async () => {
			if (worker) {
				log.debug("Terminating idle Tesseract worker");
				await worker.terminate().catch(() => {});
				worker = null;
				workerPromise = null;
				jobCount = 0;
			}
		}, WORKER_IDLE_TIMEOUT_MS);
	}

	async function getWorker(): Promise<TesseractWorkerHandle> {
		// Re-create after max jobs (Tesseract.js official guidance for memory leak prevention)
		if (worker && jobCount >= WORKER_MAX_JOBS) {
			log.debug("Re-creating Tesseract worker after max jobs", { jobCount });
			await worker.terminate().catch(() => {});
			worker = null;
			workerPromise = null;
			jobCount = 0;
		}

		if (worker) return worker;
		if (workerPromise) return workerPromise;

		workerPromise = (async () => {
			const { createWorker, OEM } = await import("tesseract.js");
			const w = await createWorker(langString, OEM.LSTM_ONLY);
			worker = w as unknown as TesseractWorkerHandle;
			log.debug("Tesseract worker created", { languages: langString });
			return worker;
		})();

		return workerPromise;
	}

	return {
		async recognize(imagePath: string): Promise<OcrResult[]> {
			clearIdle();
			try {
				const w = await getWorker();
				const imageBuffer = await readFile(imagePath);
				const { data } = await w.recognize(imageBuffer);
				jobCount++;
				scheduleIdle();
				return (data?.words ?? [])
					.filter((word: TesseractWord) => (word?.confidence ?? 0) >= minConfidence * 100)
					.map((word: TesseractWord) => ({
						text: word.text,
						bbox: {
							x: word.bbox?.x0 ?? 0,
							y: word.bbox?.y0 ?? 0,
							width: (word.bbox?.x1 ?? 0) - (word.bbox?.x0 ?? 0),
							height: (word.bbox?.y1 ?? 0) - (word.bbox?.y0 ?? 0),
						},
						confidence: (word.confidence ?? 0) / 100,
					}));
			} catch (err) {
				log.warn("Tesseract OCR failed", { error: String(err) });
				return [];
			}
		},

		async terminate() {
			clearIdle();
			if (worker) {
				await worker.terminate().catch(() => {});
				worker = null;
			}
			workerPromise = null;
			jobCount = 0;
		},
	};
}

// ── Platform-aware factory ───────────────────────────────────────────────────

export function createOcrEngine(options: OcrEngineOptions = {}): OcrEngine {
	if (process.platform === "darwin") {
		// Cache the Vision engine instance (both prior plans created a new one per call)
		let visionEngine: OcrEngine | null = null;
		return {
			async recognize(imagePath: string): Promise<OcrResult[]> {
				if (!visionEngine) {
					const { createVisionOcrEngine } = await import("./vision-ocr-helper.js");
					visionEngine = createVisionOcrEngine(options);
				}
				return visionEngine.recognize(imagePath);
			},
		};
	}
	return createTesseractOcrEngine(options);
}
