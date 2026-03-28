import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createLogger } from "@understudy/core";
import type { OcrEngine, OcrEngineOptions, OcrResult } from "./ocr-engine.js";

const execFileAsync = promisify(execFile);
const log = createLogger("grounding:vision-ocr");

// Swift source for Vision OCR — inlined like native-helper.ts
const VISION_OCR_SWIFT_SOURCE = String.raw`
import Foundation
import Vision
import AppKit

struct OcrWord: Codable {
    let text: String
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    let confidence: Double
}

let args = CommandLine.arguments
guard args.count >= 2 else {
    fputs("Usage: vision-ocr <image-path> [accurate|fast]\n", stderr)
    exit(1)
}

let imagePath = args[1]
let mode: VNRequestTextRecognitionLevel = (args.count >= 3 && args[2] == "fast") ? .fast : .accurate

guard let image = NSImage(contentsOfFile: imagePath),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fputs("Failed to load image: \(imagePath)\n", stderr)
    exit(1)
}

let imageWidth = Double(cgImage.width)
let imageHeight = Double(cgImage.height)
var words: [OcrWord] = []
let semaphore = DispatchSemaphore(value: 0)

let request = VNRecognizeTextRequest { req, err in
    defer { semaphore.signal() }
    guard let observations = req.results as? [VNRecognizedTextObservation] else { return }
    for obs in observations {
        guard let candidate = obs.topCandidates(1).first else { continue }
        let box = obs.boundingBox
        // Convert from Vision coords (bottom-left origin, normalized) to pixel coords (top-left origin)
        let pixelX = box.minX * imageWidth
        let pixelY = (1.0 - box.minY - box.height) * imageHeight
        let pixelW = box.width * imageWidth
        let pixelH = box.height * imageHeight
        words.append(OcrWord(
            text: candidate.string,
            x: pixelX, y: pixelY, width: pixelW, height: pixelH,
            confidence: Double(candidate.confidence)
        ))
    }
}

request.recognitionLevel = mode
request.recognitionLanguages = ["ko-KR", "en-US"]

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try? handler.perform([request])
semaphore.wait()

let encoder = JSONEncoder()
if let data = try? encoder.encode(words), let json = String(data: data, encoding: .utf8) {
    print(json)
} else {
    print("[]")
}
`;

const BINARY_NAME = "understudy-vision-ocr-helper";

async function getOrCompileHelper(): Promise<string> {
	const sourceHash = createHash("sha256").update(VISION_OCR_SWIFT_SOURCE).digest("hex").slice(0, 12);
	const dir = join(tmpdir(), "understudy-vision-ocr");
	const binaryPath = join(dir, `${BINARY_NAME}-${sourceHash}`);

	try {
		await access(binaryPath);
		return binaryPath; // already compiled
	} catch {
		// compile
		await mkdir(dir, { recursive: true });
		const sourcePath = join(dir, `${BINARY_NAME}-${sourceHash}.swift`);
		await writeFile(sourcePath, VISION_OCR_SWIFT_SOURCE, "utf-8");
		log.info("Compiling Vision OCR helper", { sourcePath });
		await execFileAsync("swiftc", ["-O", "-o", binaryPath, sourcePath], { timeout: 60_000 });
		return binaryPath;
	}
}

// Explicit interface for Swift helper JSON output — no `any` casts
interface VisionOcrRawWord {
	text: string;
	x: number;
	y: number;
	width: number;
	height: number;
	confidence: number;
}

export function createVisionOcrEngine(options: OcrEngineOptions = {}): OcrEngine {
	const mode = options.mode ?? "accurate";
	const minConfidence = options.minConfidence ?? 0.3;

	return {
		async recognize(imagePath: string): Promise<OcrResult[]> {
			try {
				const binary = await getOrCompileHelper();
				const { stdout } = await execFileAsync(binary, [imagePath, mode], { timeout: 30_000 });
				const raw = JSON.parse(stdout.trim()) as VisionOcrRawWord[];
				return raw
					.filter((w) => w.confidence >= minConfidence)
					.map((w) => ({
						text: w.text,
						bbox: { x: Math.round(w.x), y: Math.round(w.y), width: Math.round(w.width), height: Math.round(w.height) },
						confidence: w.confidence,
					}));
			} catch (err) {
				log.warn("Vision OCR failed", { error: String(err) });
				return [];
			}
		},
	};
}
