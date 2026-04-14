import { randomUUID } from "node:crypto";
import { withTimeout } from "@understudy/core";
import type { ImageContent } from "@mariozechner/pi-ai";
import type { UnderstudyConfig } from "@understudy/types";
import type { SessionEntry } from "./session-types.js";
import { resolveTeachInternalPromptTimeoutMs } from "./teach-normalization.js";

// Local type alias — same pattern as teach-prompts.ts
type PromptSessionFn = (
	entry: SessionEntry,
	prompt: string,
) => Promise<{ response: string; runId: string; images?: ImageContent[]; meta?: Record<string, unknown> }>;

export interface TeachInternalSessionsDeps {
	createScopedSession: (context: import("./session-types.js").SessionCreateContext) => Promise<SessionEntry>;
	promptSession: PromptSessionFn;
	abortSessionEntry: (entry: SessionEntry) => Promise<boolean>;
	runSerializedSessionTurn: <T>(entry: SessionEntry, task: () => Promise<T>) => Promise<T>;
}

export function createTeachInternalSessions(deps: TeachInternalSessionsDeps) {
	const { createScopedSession, promptSession, abortSessionEntry, runSerializedSessionTurn } = deps;

	const createTeachInternalSession = async (
		entry: SessionEntry,
		kind: "clarify" | "validate",
		options?: {
			allowedToolNames?: string[];
			extraSystemPrompt?: string;
			thinkingLevel?: UnderstudyConfig["defaultThinkingLevel"];
		},
	): Promise<SessionEntry> => {
		try {
			const isolated = await createScopedSession({
				sessionKey: `${entry.id}::teach-${kind}::${randomUUID()}`,
				parentId: entry.id,
				channelId: entry.channelId,
				senderId: entry.senderId,
				senderName: entry.senderName,
				conversationName: entry.conversationName,
				conversationType: entry.conversationType,
				threadId: entry.threadId,
				workspaceDir: entry.workspaceDir,
				explicitWorkspace: true,
				configOverride: entry.configOverride,
				sandboxInfo: entry.sandboxInfo,
				executionScopeKey: entry.executionScopeKey,
				allowedToolNames: options?.allowedToolNames,
				extraSystemPrompt: options?.extraSystemPrompt,
				thinkingLevel: options?.thinkingLevel,
			});
			return isolated?.session ? isolated : entry;
		} catch {
			return entry;
		}
	};

	const runTeachInternalPrompt = async (params: {
		entry: SessionEntry;
		kind: "clarify" | "validate";
		prompt: string;
		timeoutMs?: number;
		allowedToolNames?: string[];
		extraSystemPrompt?: string;
		thinkingLevel?: UnderstudyConfig["defaultThinkingLevel"];
	}): Promise<Awaited<ReturnType<PromptSessionFn>>> => {
		const internalEntry = await createTeachInternalSession(params.entry, params.kind, {
			allowedToolNames: params.allowedToolNames,
			extraSystemPrompt: params.extraSystemPrompt,
			thinkingLevel: params.thinkingLevel,
		});
		const timeoutMs = params.timeoutMs ?? resolveTeachInternalPromptTimeoutMs(params.kind);
		const runPrompt = async (
			promptText: string,
			remainingBudgetMs: number,
		): Promise<Awaited<ReturnType<PromptSessionFn>>> =>
			await withTimeout(
				runSerializedSessionTurn(
					internalEntry,
					async () => await promptSession(internalEntry, promptText),
				),
				remainingBudgetMs,
			);
		try {
			return await runPrompt(params.prompt, timeoutMs);
		} catch (error) {
			if (error instanceof Error && error.message === "timeout") {
				if (internalEntry !== params.entry) {
					await abortSessionEntry(internalEntry).catch(() => false);
				}
				throw new Error(`Teach ${params.kind} prompt timed out after ${timeoutMs}ms`);
			}
			throw error;
		}
	};

	const runTeachValidationReplayPrompt = async (params: {
		entry: SessionEntry;
		prompt: string;
		timeoutMs?: number;
	}): Promise<Awaited<ReturnType<PromptSessionFn>>> => {
		const internalEntry = await createTeachInternalSession(params.entry, "validate");
		const timeoutMs = params.timeoutMs ?? resolveTeachInternalPromptTimeoutMs("validate");
		try {
			return await withTimeout(
				runSerializedSessionTurn(
					internalEntry,
					async () => await promptSession(internalEntry, params.prompt),
				),
				timeoutMs,
			);
		} catch (error) {
			if (error instanceof Error && error.message === "timeout") {
				if (internalEntry !== params.entry) {
					await abortSessionEntry(internalEntry).catch(() => false);
				}
				throw new Error(`Teach validate prompt timed out after ${timeoutMs}ms`);
			}
			throw error;
		}
	};

	return {
		createTeachInternalSession,
		runTeachInternalPrompt,
		runTeachValidationReplayPrompt,
	};
}
