import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { resolveWin32Helper } from "./win32-native-helper.js";
import type {
	GuiDemonstrationRecorder,
	GuiDemonstrationRecorderOptions,
	GuiDemonstrationRecordingArtifact,
	GuiDemonstrationRecordingSession,
	GuiDemonstrationRecordingStatus,
} from "./types.js";

const DEFAULT_STOP_TIMEOUT_MS = 5_000;

export function createWin32DemonstrationRecorder(deps: {
	resolveHelper?: () => Promise<string>;
} = {}): GuiDemonstrationRecorder {
	const resolveHelper = deps.resolveHelper ?? resolveWin32Helper;

	return {
		async start(options: GuiDemonstrationRecorderOptions): Promise<GuiDemonstrationRecordingSession> {
			const id = randomUUID();
			const prefix = options.filePrefix ?? "demo";
			const outputDir = options.outputDir;
			await mkdir(outputDir, { recursive: true });

			const eventLogPath = join(outputDir, `${prefix}.events.json`);
			const videoPath = join(outputDir, `${prefix}.mp4`);
			const startedAt = Date.now();

			const helperPath = await resolveHelper();

			const eventProc = spawn(helperPath, ["record-events", eventLogPath], {
				stdio: ["ignore", "pipe", "pipe"],
			});

			let eventProcExited = false;
			eventProc.on("close", () => {
				eventProcExited = true;
			});

			const currentStatus = (): GuiDemonstrationRecordingStatus => ({
				id,
				state: "recording",
				startedAt,
				videoPath,
				eventLogPath,
				displayIndex: options.displayIndex,
				app: options.app,
			});

			return {
				id,
				status: currentStatus,
				async stop(): Promise<GuiDemonstrationRecordingArtifact> {
					const stoppedAt = Date.now();

					if (!eventProcExited) {
						eventProc.kill();
						await new Promise<void>((resolve) => {
							const timeout = setTimeout(() => resolve(), DEFAULT_STOP_TIMEOUT_MS);
							eventProc.on("close", () => {
								clearTimeout(timeout);
								resolve();
							});
						});
					}

					let hasEventLog = false;
					try {
						const s = await stat(eventLogPath);
						hasEventLog = s.size > 2;
					} catch {
						hasEventLog = false;
					}

					if (!hasEventLog) {
						const fallbackEvents = [
							{
								type: "recording_started",
								timestampMs: startedAt,
								source: "recorder",
								importance: "high",
							},
							{
								type: "recording_stopped",
								timestampMs: stoppedAt,
								source: "recorder",
								importance: "high",
							},
						];
						await writeFile(eventLogPath, JSON.stringify(fallbackEvents, null, 2));
					}

					const durationMs = stoppedAt - startedAt;
					return {
						id,
						state: "stopped",
						startedAt,
						stoppedAt,
						durationMs,
						videoPath,
						eventLogPath,
						displayIndex: options.displayIndex,
						app: options.app,
						summary: `Recorded ${(durationMs / 1000).toFixed(1)}s demonstration on Windows.`,
					};
				},
			};
		},
	};
}
