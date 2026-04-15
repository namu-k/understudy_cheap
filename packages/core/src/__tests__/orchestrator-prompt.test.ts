import { describe, expect, it, vi, afterEach } from "vitest";
import { buildSessionPrompt, type BuildSessionPromptResult } from "../runtime/orchestrator-prompt.js";
import type { RuntimeToolDefinition } from "../runtime/types.js";
import { mkdirSync, rmSync } from "node:fs";

let tempDir: string | undefined;

afterEach(() => {
	if (tempDir) {
		rmSync(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	}
});

function getTempDir(): string {
	if (!tempDir) {
		tempDir = `/tmp/orch-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		mkdirSync(tempDir, { recursive: true });
	}
	return tempDir;
}

function createPromptParams() {
	const cwd = getTempDir();
	return {
		config: {
			defaultModel: "gpt-4o",
			defaultProvider: "openai",
			ownerIds: ["user-1"],
			agent: {
				userTimezone: "UTC",
				ownerIds: ["user-1"],
			},
		} as any,
		opts: {},
		cwd,
		workspaceContext: {},
		modelLabel: "openai/gpt-4o",
		exposedTools: [],
		preflight: { enabledToolNames: ["bash", "web_search"] } as { enabledToolNames: string[] },
		runtimeProfile: "assistant",
		policyPipeline: {
			beforeTool: [],
			afterTool: [],
			runBeforePromptBuild: vi.fn(async ({ options }: { options: any }) => ({ options })),
		} as any,
		model: undefined,
		customToolDefs: [
			{
				name: "bash",
				parameters: { type: "object", properties: {} },
				execute: async () => ({ route: "shell" }),
			},
		] as any as RuntimeToolDefinition[],
	};
}

describe("buildSessionPrompt", () => {
	it("assembles a prompt with tools and returns expected fields", async () => {
		const params = createPromptParams();
		const result = await buildSessionPrompt(params);

		expect(result.systemPrompt).toBeTruthy();
		expect(typeof result.systemPrompt).toBe("string");
		expect(result.advertisedToolNames).toContain("bash");
		expect(result.advertisedToolNames).toContain("web_search");
		expect(result.promptReport).toBeDefined();
		expect(result.runtimeParams).toBeDefined();
		expect(result.contextFiles).toBeDefined();
		expect(result.skillsSnapshot).toBeDefined();
	});

	it("handles empty tool list gracefully", async () => {
		const params = createPromptParams();
		params.exposedTools = [];
		params.preflight = { enabledToolNames: [] };
		params.customToolDefs = [];

		const result = await buildSessionPrompt(params);

		expect(result.systemPrompt).toBeTruthy();
		expect(result.advertisedToolNames).toEqual([]);
	});

	it("produces a valid prompt with no workspace (empty cwd)", async () => {
		const params = createPromptParams();
		params.cwd = getTempDir();
		params.workspaceContext = {};

		const result = await buildSessionPrompt(params);

		expect(result.systemPrompt).toBeTruthy();
		expect(result.contextFiles).toEqual([]);
	});

	it("calls policyPipeline.runBeforePromptBuild", async () => {
		const params = createPromptParams();
		await buildSessionPrompt(params);

		expect(params.policyPipeline.runBeforePromptBuild).toHaveBeenCalledTimes(1);
		expect(params.policyPipeline.runBeforePromptBuild).toHaveBeenCalledWith({
			options: expect.objectContaining({
				toolNames: expect.arrayContaining(["bash", "web_search"]),
			}),
		});
	});

	it("includes runtime profile in system prompt", async () => {
		const params = createPromptParams();
		params.runtimeProfile = "worker";
		const result = await buildSessionPrompt(params);

		expect(result.systemPrompt).toContain("profile=worker");
	});
});
