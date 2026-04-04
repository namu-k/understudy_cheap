import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
	spawn: vi.fn(),
	execWin32Helper: vi.fn(),
	resolveWin32Helper: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("../win32-native-helper.js", () => ({
	execWin32Helper: mocks.execWin32Helper,
	resolveWin32Helper: mocks.resolveWin32Helper,
}));

describe("createWin32DemonstrationRecorder", () => {
	let testDir: string;

	afterEach(async () => {
		if (testDir) await rm(testDir, { recursive: true, force: true }).catch(() => {});
	});

	it("starts recording and returns a session with correct paths", async () => {
		testDir = await mkdtemp(join(tmpdir(), "understudy-recorder-test-"));
		mocks.resolveWin32Helper.mockResolvedValue("C:\\test\\helper.exe");

		const mockChild = {
			pid: 1234,
			stdout: { on: vi.fn() },
			stderr: { on: vi.fn(), pipe: vi.fn() },
			on: vi.fn(),
			kill: vi.fn(),
		};
		mocks.spawn.mockReturnValue(mockChild);

		const { createWin32DemonstrationRecorder } = await import(
			"../win32-demonstration-recorder.js"
		);
		const recorder = createWin32DemonstrationRecorder();
		const session = await recorder.start({ outputDir: testDir });

		expect(session.id).toBeTruthy();
		const status = session.status();
		expect(status.state).toBe("recording");
		expect(status.eventLogPath).toContain(".events.json");
	});

	it("stop persists fallback events when recorder process has no output", async () => {
		testDir = await mkdtemp(join(tmpdir(), "understudy-recorder-test-"));
		mocks.resolveWin32Helper.mockResolvedValue("C:\\test\\helper.exe");

		const onHandlers: Record<string, Function> = {};
		const mockChild = {
			pid: 1234,
			stdout: { on: vi.fn() },
			stderr: { on: vi.fn((event: string, handler: Function) => { onHandlers[`stderr_${event}`] = handler; }), pipe: vi.fn() },
			on: vi.fn((event: string, handler: Function) => { onHandlers[event] = handler; }),
			kill: vi.fn(() => {
				if (onHandlers.close) onHandlers.close(0);
			}),
		};
		mocks.spawn.mockReturnValue(mockChild);

		const { createWin32DemonstrationRecorder } = await import(
			"../win32-demonstration-recorder.js"
		);
		const recorder = createWin32DemonstrationRecorder();
		const session = await recorder.start({ outputDir: testDir });
		const artifact = await session.stop();

		expect(artifact.state).toBe("stopped");
		expect(artifact.durationMs).toBeGreaterThanOrEqual(0);
		expect(artifact.summary).toBeTruthy();
	});
});
