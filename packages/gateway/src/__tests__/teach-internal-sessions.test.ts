import { describe, expect, it, vi, beforeEach } from "vitest";
import {
	createTeachInternalSessions,
	type TeachInternalSessionsDeps,
} from "../teach-internal-sessions.js";
import type { SessionEntry } from "../session-types.js";

function createEntry(overrides?: Partial<SessionEntry>): SessionEntry {
	return {
		id: "parent-session-1",
		createdAt: 1000000,
		lastActiveAt: 1000000,
		dayStamp: "2026-04-15",
		messageCount: 0,
		session: {},
		history: [],
		channelId: "telegram",
		senderId: "user-1",
		senderName: "Test User",
		conversationName: "test-chat",
		conversationType: "direct",
		workspaceDir: "/tmp/workspace",
		configOverride: {},
		...overrides,
	} as SessionEntry;
}

function createMockDeps(): TeachInternalSessionsDeps {
	const scopedEntry = createEntry({ id: "scoped-session-1", parentId: "parent-session-1" });
	return {
		createScopedSession: vi.fn(async () => scopedEntry),
		promptSession: vi.fn(async () => ({
			response: "mock response",
			runId: "run-1",
		})),
		abortSessionEntry: vi.fn(async () => true),
		runSerializedSessionTurn: vi.fn(async (_entry, task) => task()),
	};
}

describe("createTeachInternalSessions", () => {
	let deps: TeachInternalSessionsDeps;

	beforeEach(() => {
		deps = createMockDeps();
	});

	describe("createTeachInternalSession", () => {
		it("creates scoped session with correct parentId", async () => {
			const { createTeachInternalSession } = createTeachInternalSessions(deps);
			const entry = createEntry();
			const result = await createTeachInternalSession(entry, "clarify");

			expect(deps.createScopedSession).toHaveBeenCalledWith(
				expect.objectContaining({
					parentId: entry.id,
					sessionKey: expect.stringContaining("::teach-clarify::"),
				}),
			);
			expect(result.id).toBe("scoped-session-1");
		});

		it("passes allowedToolNames when provided in options", async () => {
			const { createTeachInternalSession } = createTeachInternalSessions(deps);
			const entry = createEntry();
			await createTeachInternalSession(entry, "validate", {
				allowedToolNames: ["bash", "web_search"],
			});

			expect(deps.createScopedSession).toHaveBeenCalledWith(
				expect.objectContaining({
					allowedToolNames: ["bash", "web_search"],
				}),
			);
		});

		it("returns original entry on createScopedSession failure", async () => {
			(deps.createScopedSession as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
			const { createTeachInternalSession } = createTeachInternalSessions(deps);
			const entry = createEntry();
			const result = await createTeachInternalSession(entry, "clarify");
			expect(result).toBe(entry);
		});

		it("passes extraSystemPrompt and thinkingLevel options", async () => {
			const { createTeachInternalSession } = createTeachInternalSessions(deps);
			const entry = createEntry();
			await createTeachInternalSession(entry, "validate", {
				extraSystemPrompt: "extra context",
				thinkingLevel: "high",
			});

			expect(deps.createScopedSession).toHaveBeenCalledWith(
				expect.objectContaining({
					extraSystemPrompt: "extra context",
					thinkingLevel: "high",
				}),
			);
		});
	});

	describe("runTeachInternalPrompt", () => {
		it("creates internal session and runs prompt", async () => {
			const { runTeachInternalPrompt } = createTeachInternalSessions(deps);
			const entry = createEntry();
			const result = await runTeachInternalPrompt({
				entry,
				kind: "clarify",
				prompt: "what should I do?",
			});

			expect(deps.createScopedSession).toHaveBeenCalled();
			expect(deps.promptSession).toHaveBeenCalledWith(
				expect.objectContaining({ id: "scoped-session-1" }),
				"what should I do?",
			);
			expect(result.response).toBe("mock response");
		});

		it("throws teach timeout error on timeout", async () => {
			(deps.runSerializedSessionTurn as ReturnType<typeof vi.fn>).mockImplementation(
				async (_entry: unknown, _task: () => Promise<unknown>) => {
					throw new Error("timeout");
				},
			);

			const { runTeachInternalPrompt } = createTeachInternalSessions(deps);
			const entry = createEntry();

			await expect(
				runTeachInternalPrompt({
					entry,
					kind: "validate",
					prompt: "validate this",
					timeoutMs: 100,
				}),
			).rejects.toThrow("Teach validate prompt timed out");
		});

		it("re-throws non-timeout errors", async () => {
			(deps.promptSession as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("API error"));

			const { runTeachInternalPrompt } = createTeachInternalSessions(deps);
			const entry = createEntry();

			await expect(
				runTeachInternalPrompt({
					entry,
					kind: "clarify",
					prompt: "test",
					timeoutMs: 5000,
				}),
			).rejects.toThrow("API error");
		});
	});

	describe("runTeachValidationReplayPrompt", () => {
		it("creates internal session for validate kind", async () => {
			const { runTeachValidationReplayPrompt } = createTeachInternalSessions(deps);
			const entry = createEntry();
			const result = await runTeachValidationReplayPrompt({
				entry,
				prompt: "replay validation",
			});

			expect(deps.createScopedSession).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionKey: expect.stringContaining("::teach-validate::"),
				}),
			);
			expect(result.response).toBe("mock response");
		});

		it("throws teach validate timeout error on timeout", async () => {
			(deps.runSerializedSessionTurn as ReturnType<typeof vi.fn>).mockImplementation(
				async () => {
					throw new Error("timeout");
				},
			);

			const { runTeachValidationReplayPrompt } = createTeachInternalSessions(deps);
			const entry = createEntry();

			await expect(
				runTeachValidationReplayPrompt({
					entry,
					prompt: "validate",
					timeoutMs: 100,
				}),
			).rejects.toThrow("Teach validate prompt timed out");
		});
	});
});
