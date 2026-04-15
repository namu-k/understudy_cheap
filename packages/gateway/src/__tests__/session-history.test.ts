import { describe, expect, it } from "vitest";
import {
	type RunTurnResult,
	touchSession,
	cloneValue,
	forkRuntimeMessages,
	copyRuntimeMessagesForBranch,
	buildRuntimeMessagesFromHistory,
	seedRuntimeMessagesFromHistory,
	resolveWaitForCompletion,
	normalizeActiveRunSnapshot,
	runSupportsHistoryChannels,
	assistantMessageMatchesRun,
	buildHistoryTimeline,
} from "../session-history.js";
import type { SessionEntry, SessionRunTrace } from "../session-types.js";

function createEntry(overrides?: Partial<SessionEntry>): SessionEntry {
	return {
		id: "test-session-1",
		createdAt: 1000000,
		lastActiveAt: 1000000,
		dayStamp: "2026-04-15",
		messageCount: 0,
		session: {},
		history: [],
		...overrides,
	} as SessionEntry;
}

function createRunTrace(overrides?: Partial<SessionRunTrace>): SessionRunTrace {
	return {
		runId: "run-1",
		recordedAt: 2000000,
		userPromptPreview: "hello",
		responsePreview: "hi there",
		toolTrace: [],
		attempts: [],
		...overrides,
	};
}

describe("cloneValue", () => {
	it("deep clones objects so mutations don't affect original", () => {
		const original = { a: 1, nested: { b: 2 } };
		const cloned = cloneValue(original);
		expect(cloned).toEqual(original);
		(cloned as Record<string, unknown>).nested = { b: 99 };
		expect(original.nested).toEqual({ b: 2 });
	});

	it("deep clones arrays", () => {
		const original = [1, 2, { x: 3 }];
		const cloned = cloneValue(original);
		expect(cloned).toEqual(original);
		(cloned[2] as { x: number }).x = 99;
		expect((original[2] as { x: number }).x).toBe(3);
	});
});

describe("touchSession", () => {
	it("updates lastActiveAt to the given timestamp", () => {
		const entry = createEntry({ lastActiveAt: 1000 });
		touchSession(entry, 5000);
		expect(entry.lastActiveAt).toBe(5000);
	});

	it("defaults to Date.now when no timestamp given", () => {
		const entry = createEntry({ lastActiveAt: 0 });
		const before = Date.now();
		touchSession(entry);
		const after = Date.now();
		expect(entry.lastActiveAt).toBeGreaterThanOrEqual(before);
		expect(entry.lastActiveAt).toBeLessThanOrEqual(after);
	});
});

describe("resolveWaitForCompletion", () => {
	it("returns true for true", () => {
		expect(resolveWaitForCompletion(true)).toBe(true);
	});

	it("returns false for false", () => {
		expect(resolveWaitForCompletion(false)).toBe(false);
	});

	it("returns true for undefined (default)", () => {
		expect(resolveWaitForCompletion(undefined)).toBe(true);
	});

	it("returns true for non-boolean values (defaults to true)", () => {
		expect(resolveWaitForCompletion(0)).toBe(true);
		expect(resolveWaitForCompletion(1)).toBe(true);
		expect(resolveWaitForCompletion("yes")).toBe(true);
	});

	it("handles string 'false' as false", () => {
		expect(resolveWaitForCompletion("false")).toBe(false);
	});
});

describe("normalizeActiveRunSnapshot", () => {
	it("returns undefined for undefined input", () => {
		expect(normalizeActiveRunSnapshot(undefined)).toBeUndefined();
	});

	it("returns undefined for ok status", () => {
		expect(normalizeActiveRunSnapshot({ status: "ok" })).toBeUndefined();
	});

	it("returns undefined for error status", () => {
		expect(normalizeActiveRunSnapshot({ status: "error" })).toBeUndefined();
	});

	it("returns object with status in_flight for running status with runId", () => {
		const result = normalizeActiveRunSnapshot({
			status: "running",
			runId: "run-1",
			startedAt: 100,
			progress: {},
		});
		expect(result).toEqual({
			runId: "run-1",
			status: "in_flight",
			startedAt: 100,
			updatedAt: 100,
		});
	});

	it("returns undefined when no meaningful data is present", () => {
		expect(normalizeActiveRunSnapshot({ status: "running" })).toBeUndefined();
	});

	it("includes error when present at top level", () => {
		const result = normalizeActiveRunSnapshot({
			status: "running",
			runId: "run-1",
			startedAt: 100,
			error: "something failed",
		});
		expect(result).toMatchObject({ error: "something failed" });
	});

	it("includes thoughtText when present", () => {
		const result = normalizeActiveRunSnapshot({
			status: "running",
			runId: "run-1",
			startedAt: 100,
			progress: { thoughtText: "thinking..." },
		});
		expect(result).toMatchObject({ thoughtText: "thinking..." });
	});

	it("includes steps from progress", () => {
		const result = normalizeActiveRunSnapshot({
			status: "running",
			runId: "run-1",
			startedAt: 100,
			progress: {
				steps: [{ name: "step1" }],
			},
		});
		expect(result).toMatchObject({ steps: [{ name: "step1" }] });
	});
});

describe("runSupportsHistoryChannels", () => {
	it("returns false for undefined", () => {
		expect(runSupportsHistoryChannels(undefined)).toBe(false);
	});

	it("returns false for null-like input", () => {
		expect(runSupportsHistoryChannels(null as any)).toBe(false);
	});

	it("returns true when thoughtText exists", () => {
		expect(runSupportsHistoryChannels({ thoughtText: "thinking" } as any)).toBe(true);
	});

	it("returns true when progressSteps has entries", () => {
		expect(runSupportsHistoryChannels({ progressSteps: [{ step: 1 }] } as any)).toBe(true);
	});

	it("returns true when toolTrace has entries", () => {
		expect(runSupportsHistoryChannels({ toolTrace: [{ tool: "bash" }] } as any)).toBe(true);
	});

	it("returns true when attempts has entries", () => {
		expect(runSupportsHistoryChannels({ attempts: [{ a: 1 }] } as any)).toBe(true);
	});

	it("returns true for object with only empty arrays (teachValidation may match)", () => {
		expect(runSupportsHistoryChannels({ toolTrace: [], attempts: [] } as any)).toBe(true);
	});

	it("returns true for plain empty object (teachValidation resolves to {})", () => {
		expect(runSupportsHistoryChannels({} as any)).toBe(true);
	});
});

describe("forkRuntimeMessages", () => {
	it("returns system-only messages when fork history is empty", () => {
		const parentMessages = [
			{ role: "system", content: "you are helpful" },
			{ role: "user", content: [{ type: "text", text: "hello" }] },
			{ role: "assistant", content: [{ type: "text", text: "hi" }] },
		];
		const result = forkRuntimeMessages(parentMessages, []);
		expect(result).toEqual([{ role: "system", content: "you are helpful" }]);
	});

	it("returns full clone when no messages match fork history", () => {
		const parentMessages = [
			{ role: "system", content: "sys" },
			{ role: "user", content: [{ type: "text", text: "hello" }] },
			{ role: "assistant", content: [{ type: "text", text: "hi" }] },
		];
		const forkHistory: SessionEntry["history"] = [
			{ role: "user", text: "completely different", timestamp: 100 },
		];
		const result = forkRuntimeMessages(parentMessages, forkHistory);
		expect(result.length).toBe(3);
	});

	it("slices to match point on full match", () => {
		const parentMessages = [
			{ role: "system", content: "sys" },
			{ role: "user", content: [{ type: "text", text: "hello" }] },
			{ role: "assistant", content: [{ type: "text", text: "hi there" }] },
			{ role: "user", content: [{ type: "text", text: "follow up" }] },
		];
		const forkHistory: SessionEntry["history"] = [
			{ role: "user", text: "hello", timestamp: 100 },
			{ role: "assistant", text: "hi there", timestamp: 200 },
		];
		const result = forkRuntimeMessages(parentMessages, forkHistory);
		expect(result.length).toBe(3);
		expect((result[1] as { role: string }).role).toBe("user");
		expect((result[2] as { role: string }).role).toBe("assistant");
	});

	it("handles partial match by slicing to last match", () => {
		const parentMessages = [
			{ role: "system", content: "sys" },
			{ role: "user", content: [{ type: "text", text: "hello" }] },
			{ role: "assistant", content: [{ type: "text", text: "hi" }] },
			{ role: "user", content: [{ type: "text", text: "next question" }] },
		];
		const forkHistory: SessionEntry["history"] = [
			{ role: "user", text: "hello", timestamp: 100 },
			{ role: "assistant", text: "different response", timestamp: 200 },
		];
		const result = forkRuntimeMessages(parentMessages, forkHistory);
		expect(result.length).toBe(2);
	});

	it("matches entries with empty text", () => {
		const parentMessages = [
			{ role: "system", content: "sys" },
			{ role: "user", content: [{ type: "text", text: "" }] },
			{ role: "assistant", content: [{ type: "text", text: "response" }] },
		];
		const forkHistory: SessionEntry["history"] = [
			{ role: "user", text: "", timestamp: 100 },
			{ role: "assistant", text: "response", timestamp: 200 },
		];
		const result = forkRuntimeMessages(parentMessages, forkHistory);
		expect(result.length).toBe(3);
	});
});

describe("copyRuntimeMessagesForBranch", () => {
	it("delegates to forkRuntimeMessages and mutates child state", () => {
		const parentMessages = [
			{ role: "system", content: "sys" },
			{ role: "user", content: [{ type: "text", text: "hello" }] },
		];
		const childMessages: unknown[] = [];
		const parent = createEntry({
			session: { agent: { state: { messages: parentMessages } } },
		});
		const child = createEntry({
			session: { agent: { state: { messages: childMessages } } },
		});
		const forkHistory: SessionEntry["history"] = [];
		copyRuntimeMessagesForBranch(parent, child, forkHistory);
		const childState = (child.session as { agent: { state: { messages: unknown[] } } }).agent.state;
		expect(childState.messages).toEqual([{ role: "system", content: "sys" }]);
	});

	it("does nothing when parent has no messages array", () => {
		const parent = createEntry({ session: {} });
		const child = createEntry({
			session: { agent: { state: { messages: [] } } },
		});
		copyRuntimeMessagesForBranch(parent, child, []);
		const childState = (child.session as { agent: { state: { messages: unknown[] } } }).agent.state;
		expect(childState.messages).toEqual([]);
	});

	it("does nothing when child has no messages array", () => {
		const parent = createEntry({
			session: { agent: { state: { messages: [{ role: "system" }] } } },
		});
		const child = createEntry({ session: {} });
		copyRuntimeMessagesForBranch(parent, child, []);
		expect((child.session as Record<string, unknown>).agent).toBeUndefined();
	});
});

describe("buildRuntimeMessagesFromHistory", () => {
	it("converts history entries to runtime message format", () => {
		const existingMessages = [{ role: "system", content: "sys prompt" }];
		const history: SessionEntry["history"] = [
			{ role: "user", text: "hello", timestamp: 100 },
			{ role: "assistant", text: "hi there", timestamp: 200 },
		];
		const result = buildRuntimeMessagesFromHistory(existingMessages, history);
		expect(result[0]).toMatchObject({ role: "system" });
		expect(result[1]).toMatchObject({ role: "user" });
		expect(result[2]).toMatchObject({ role: "assistant" });
		const assistant = result[2] as Record<string, unknown>;
		expect(assistant.model).toBe("gateway-history");
		expect(assistant.stopReason).toBe("stop");
	});

	it("preserves system messages from existing messages", () => {
		const existingMessages = [
			{ role: "system", content: "sys1" },
			{ role: "user", content: "should be filtered" },
			{ role: "system", content: "sys2" },
		];
		const history: SessionEntry["history"] = [];
		const result = buildRuntimeMessagesFromHistory(existingMessages, history);
		expect(result.length).toBe(2);
		expect((result[0] as { role: string }).role).toBe("system");
		expect((result[1] as { role: string }).role).toBe("system");
	});

	it("uses seeded assistant metadata from existing messages", () => {
		const existingMessages = [
			{ role: "system", content: "sys" },
			{ role: "assistant", content: [], api: "anthropic", provider: "claude", model: "sonnet" },
		];
		const history: SessionEntry["history"] = [
			{ role: "assistant", text: "response", timestamp: 100 },
		];
		const result = buildRuntimeMessagesFromHistory(existingMessages, history);
		const assistant = result[1] as Record<string, unknown>;
		expect(assistant.api).toBe("anthropic");
		expect(assistant.provider).toBe("claude");
		expect(assistant.model).toBe("sonnet");
	});

	it("creates content with text type from history text", () => {
		const history: SessionEntry["history"] = [
			{ role: "user", text: "hello world", timestamp: 100 },
		];
		const result = buildRuntimeMessagesFromHistory([], history);
		const user = result[0] as { content: Array<{ type: string; text: string }> };
		expect(user.content[0].type).toBe("text");
		expect(user.content[0].text).toBe("hello world");
	});
});

describe("seedRuntimeMessagesFromHistory", () => {
	it("mutates entry session agent state messages", () => {
		const messages: unknown[] = [{ role: "system", content: "sys" }];
		const entry = createEntry({
			session: { agent: { state: { messages } } },
		});
		const history: SessionEntry["history"] = [
			{ role: "user", text: "hello", timestamp: 100 },
		];
		seedRuntimeMessagesFromHistory(entry, history);
		const state = (entry.session as { agent: { state: { messages: unknown[] } } }).agent.state;
		expect(state.messages.length).toBe(2);
		expect((state.messages[1] as { role: string }).role).toBe("user");
	});

	it("does nothing when entry has no messages array", () => {
		const entry = createEntry({ session: {} });
		const history: SessionEntry["history"] = [
			{ role: "user", text: "hello", timestamp: 100 },
		];
		seedRuntimeMessagesFromHistory(entry, history);
		expect((entry.session as Record<string, unknown>).agent).toBeUndefined();
	});
});

describe("buildHistoryTimeline", () => {
	it("pairs assistant messages with matching runs", () => {
		const messages: SessionEntry["history"] = [
			{ role: "user", text: "hello", timestamp: 100 },
			{ role: "assistant", text: "hi there", timestamp: 200 },
		];
		const runs: SessionRunTrace[] = [
			createRunTrace({
				responsePreview: "hi there",
				thoughtText: "thinking...",
				runId: "run-1",
			}),
		];
		const timeline = buildHistoryTimeline(messages, runs);
		expect(timeline.length).toBe(2);
		expect(timeline[0]).toMatchObject({ kind: "message", role: "user", text: "hello" });
		expect(timeline[1]).toMatchObject({
			kind: "run",
			role: "assistant",
			runId: "run-1",
			thoughtText: "thinking...",
		});
	});

	it("produces message kind for non-matching assistant messages", () => {
		const messages: SessionEntry["history"] = [
			{ role: "user", text: "hello", timestamp: 100 },
			{ role: "assistant", text: "no matching run", timestamp: 200 },
		];
		const runs: SessionRunTrace[] = [
			createRunTrace({ responsePreview: "completely different" }),
		];
		const timeline = buildHistoryTimeline(messages, runs);
		expect(timeline[1]).toMatchObject({ kind: "message", role: "assistant", text: "no matching run" });
	});

	it("still produces run kind when run matches but has minimal data", () => {
		const messages: SessionEntry["history"] = [
			{ role: "assistant", text: "response text", timestamp: 100 },
		];
		const runs: SessionRunTrace[] = [
			createRunTrace({
				responsePreview: "response text",
				toolTrace: [],
				attempts: [],
			}),
		];
		const timeline = buildHistoryTimeline(messages, runs);
		expect(timeline[0]).toMatchObject({ kind: "run", role: "assistant" });
	});

	it("preserves images and attachments in message kind entries", () => {
		const messages: SessionEntry["history"] = [
			{
				role: "user",
				text: "look at this",
				timestamp: 100,
				images: [{ type: "image" as const, data: "base64", mimeType: "image/png" }],
			},
		];
		const timeline = buildHistoryTimeline(messages, []);
		expect(timeline[0]).toMatchObject({
			kind: "message",
			role: "user",
			text: "look at this",
		});
		expect((timeline[0] as Record<string, unknown>).images).toBeDefined();
	});

	it("matches from the end backwards (reverse pairing)", () => {
		const messages: SessionEntry["history"] = [
			{ role: "user", text: "first", timestamp: 100 },
			{ role: "assistant", text: "first response", timestamp: 200 },
			{ role: "user", text: "second", timestamp: 300 },
			{ role: "assistant", text: "second response", timestamp: 400 },
		];
		const runs: SessionRunTrace[] = [
			createRunTrace({
				responsePreview: "second response",
				thoughtText: "second thought",
				runId: "run-2",
			}),
			createRunTrace({
				responsePreview: "first response",
				thoughtText: "first thought",
				runId: "run-1",
			}),
		];
		const timeline = buildHistoryTimeline(messages, runs);
		expect(timeline[3]).toMatchObject({ kind: "run", runId: "run-2" });
		expect(timeline[1]).toMatchObject({ kind: "run", runId: "run-1" });
	});
});

describe("assistantMessageMatchesRun", () => {
	it("returns false for non-assistant messages", () => {
		const message: SessionEntry["history"][number] = {
			role: "user",
			text: "hello",
			timestamp: 100,
		};
		expect(assistantMessageMatchesRun(message, createRunTrace())).toBe(false);
	});

	it("returns false for undefined run", () => {
		const message: SessionEntry["history"][number] = {
			role: "assistant",
			text: "hello",
			timestamp: 100,
		};
		expect(assistantMessageMatchesRun(message, undefined)).toBe(false);
	});

	it("returns true when text exactly matches responsePreview", () => {
		const message: SessionEntry["history"][number] = {
			role: "assistant",
			text: "hello world",
			timestamp: 100,
		};
		const run = createRunTrace({ responsePreview: "hello world" });
		expect(assistantMessageMatchesRun(message, run)).toBe(true);
	});

	it("returns true when text starts with responsePreview", () => {
		const message: SessionEntry["history"][number] = {
			role: "assistant",
			text: "hello world and more text",
			timestamp: 100,
		};
		const run = createRunTrace({ responsePreview: "hello world" });
		expect(assistantMessageMatchesRun(message, run)).toBe(true);
	});

	it("returns false when texts are completely different", () => {
		const message: SessionEntry["history"][number] = {
			role: "assistant",
			text: "something completely different",
			timestamp: 100,
		};
		const run = createRunTrace({ responsePreview: "totally unrelated" });
		expect(assistantMessageMatchesRun(message, run)).toBe(false);
	});

	it("returns true when first 120 chars match (prefix match)", () => {
		const longText = "a".repeat(150);
		const message: SessionEntry["history"][number] = {
			role: "assistant",
			text: longText,
			timestamp: 100,
		};
		const run = createRunTrace({ responsePreview: longText.slice(0, 100) });
		expect(assistantMessageMatchesRun(message, run)).toBe(true);
	});

	it("returns false for short non-matching texts", () => {
		const message: SessionEntry["history"][number] = {
			role: "assistant",
			text: "short",
			timestamp: 100,
		};
		const run = createRunTrace({ responsePreview: "other" });
		expect(assistantMessageMatchesRun(message, run)).toBe(false);
	});
});
