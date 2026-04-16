import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Model, type ThinkingLevel } from "@mariozechner/pi-ai";
import type { AgentMessage, AgentTool } from "@mariozechner/pi-agent-core";
import type { UnderstudyConfig } from "@understudy/types";
import { shouldHideOpenClawCompatibilityToolName } from "../openclaw-compat.js";
import { createLogger } from "../logger.js";
import type { ContextFile } from "../system-prompt.js";
import type {
	RuntimeAdapter,
	RuntimeCreateSessionResult,
	RuntimeSessionManager,
	RuntimeToolDefinition,
} from "./types.js";
import type { RuntimeResolvedModelCandidate } from "./bridge/model-resolution-bridge.js";
import { prepareRuntimeAuthContext } from "../auth.js";
import type { UnderstudySessionLifecycleHooks } from "./orchestrator.js";

const logger = createLogger("UnderstudySession");

export function mergeAgentMessage(target: AgentMessage, source: AgentMessage): AgentMessage {
	return Object.assign(target, source);
}

/**
 * Convert an AgentTool to a runtime tool-definition compatible with adapter customTools.
 * Runtime tool execute supports an optional extra `context` parameter; AgentTool ignores it.
 */
export function agentToolToDefinition(tool: AgentTool<any>): RuntimeToolDefinition {
	return {
		name: tool.name,
		label: tool.label,
		description: tool.description,
		parameters: tool.parameters,
		execute: async (toolCallId, params, signal, onUpdate, _ctx) => {
			return tool.execute(toolCallId, params, signal, onUpdate);
		},
	};
}

export function isHiddenCompatibilityToolDefinition(name: string, presentToolNames: string[]): boolean {
	return shouldHideOpenClawCompatibilityToolName(name, presentToolNames);
}

export function describeUnknownError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function resolveErrorStatusCode(error: unknown): number | undefined {
	if (!error || typeof error !== "object") {
		return undefined;
	}
	const direct = (error as { status?: unknown; statusCode?: unknown; code?: unknown });
	for (const candidate of [direct.status, direct.statusCode, direct.code]) {
		if (typeof candidate === "number" && Number.isFinite(candidate)) {
			return candidate;
		}
		if (typeof candidate === "string" && /^\d{3}$/.test(candidate.trim())) {
			return Number(candidate);
		}
	}
	const nested = (error as { response?: { status?: unknown } }).response?.status;
	if (typeof nested === "number" && Number.isFinite(nested)) {
		return nested;
	}
	if (typeof nested === "string" && /^\d{3}$/.test(nested.trim())) {
		return Number(nested);
	}
	return undefined;
}

export function isRetryableRuntimeSessionCreationError(error: unknown): boolean {
	const status = resolveErrorStatusCode(error);
	if (
		typeof status === "number" &&
		(status === 401 ||
			status === 403 ||
			status === 404 ||
			status === 408 ||
			status === 409 ||
			status === 422 ||
			status === 429 ||
			status >= 500)
	) {
		return true;
	}

	const message = describeUnknownError(error).toLowerCase();
	return [
		"unauthorized",
		"forbidden",
		"authentication",
		"auth",
		"api key",
		"credential",
		"oauth",
		"token",
		"rate limit",
		"quota",
		"model not found",
		"unknown model",
		"unsupported model",
		"provider not found",
		"no model",
		"not available",
		"temporarily unavailable",
		"overloaded",
		"timeout",
	].some((fragment) => message.includes(fragment));
}

export function isContextWindowOverflowError(error: unknown): boolean {
	const status = resolveErrorStatusCode(error);
	if (status === 400 || status === 413 || status === 422 || status === 429) {
		return true;
	}

	const message = describeUnknownError(error).toLowerCase();
	return [
		"context length",
		"context window",
		"maximum context length",
		"maximum context size",
		"prompt is too long",
		"input is too long",
		"too many tokens",
		"token limit",
		"context limit",
		"request too large",
	].some((fragment) => message.includes(fragment));
}

export function isRetryablePromptDispatchError(error: unknown): boolean {
	const status = resolveErrorStatusCode(error);
	if (
		typeof status === "number" &&
		(status === 408 || status === 409 || status === 425 || status === 429 || status >= 500)
	) {
		return true;
	}

	const message = describeUnknownError(error).toLowerCase();
	return [
		"server_error",
		"internal server error",
		"temporarily unavailable",
		"temporary outage",
		"overloaded",
		"try again",
		"connection reset",
		"connection aborted",
		"socket hang up",
		"fetch failed",
		"econnreset",
		"etimedout",
	].some((fragment) => message.includes(fragment));
}

export function promptRetryBackoffMs(attempt: number): number {
	return attempt <= 1 ? 500 : 1_500;
}

export async function runLifecycleHook<TEvent>(
	name: keyof UnderstudySessionLifecycleHooks,
	hook: ((event: TEvent) => Promise<void> | void) | undefined,
	event: TEvent,
): Promise<void> {
	if (!hook) {
		return;
	}
	try {
		await hook(event);
	} catch (error) {
		logger.warn(`Runtime lifecycle hook "${String(name)}" failed: ${String(error)}`);
	}
}

export async function createRuntimeSessionWithModelFallback(params: {
	adapter: RuntimeAdapter;
	cwd: string;
	agentDir: string;
	authContext: ReturnType<typeof prepareRuntimeAuthContext>;
	initialModel: Model<any> | undefined;
	initialModelLabel: string;
	candidates: RuntimeResolvedModelCandidate[];
	thinkingLevel: ThinkingLevel | undefined;
	customTools: RuntimeToolDefinition[];
	sessionManager?: RuntimeSessionManager;
	acpConfig?: UnderstudyConfig["agent"]["acp"];
	onModelLabelResolved?: (modelLabel: string) => void;
	explicitModelRequested: boolean;
}): Promise<{
	sessionResult: RuntimeCreateSessionResult;
	model: Model<any> | undefined;
	modelLabel: string;
	fallbackUsed: boolean;
}> {
	const fallbackCandidates =
		params.candidates.length > 0
			? params.candidates
			: [
				{
					model: params.initialModel as Model<any>,
					modelLabel: params.initialModelLabel,
					provider: params.initialModel?.provider ?? "",
					modelId: params.initialModel?.id ?? "",
					source: "default" as const,
				},
			];

	let lastError: unknown;
	for (let index = 0; index < fallbackCandidates.length; index += 1) {
		const candidate = fallbackCandidates[index];
		params.onModelLabelResolved?.(candidate.modelLabel);
		try {
			const sessionResult = await params.adapter.createSession({
				cwd: params.cwd,
				agentDir: params.agentDir,
				authStorage: params.authContext.authStorage,
				modelRegistry: params.authContext.modelRegistry,
				model: candidate.model,
				thinkingLevel: params.thinkingLevel,
				customTools: params.customTools,
				sessionManager: params.sessionManager,
				acpConfig: params.acpConfig,
			});
			return {
				sessionResult,
				model: candidate.model,
				modelLabel: candidate.modelLabel,
				fallbackUsed: index > 0,
			};
		} catch (error) {
			lastError = error;
			const canRetry =
				!params.explicitModelRequested &&
				index < fallbackCandidates.length - 1 &&
				isRetryableRuntimeSessionCreationError(error);
			if (!canRetry) {
				throw error;
			}
			const next = fallbackCandidates[index + 1];
			logger.warn(
				`Runtime session creation failed for ${candidate.modelLabel}: ${describeUnknownError(error)}. Retrying with ${next.modelLabel}.`,
			);
		}
	}

	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Load project context files from disk.
 * Searches for configured paths and auto-detected files (SOUL.md, AGENTS.md).
 */
export function loadContextFiles(cwd: string, configuredPaths?: string[]): ContextFile[] {
	const files: ContextFile[] = [];
	const seen = new Set<string>();

	// Auto-detect standard context files in cwd
	const autoFiles = ["SOUL.md", "AGENTS.md", "CLAUDE.md"];
	const allPaths = [...autoFiles, ...(configuredPaths ?? [])];

	for (const filePath of allPaths) {
		const resolved = resolve(cwd, filePath);
		if (seen.has(resolved)) continue;
		seen.add(resolved);

		try {
			const content = readFileSync(resolved, "utf-8");
			if (content.trim()) {
				files.push({ path: filePath, content: content.trim() });
			}
		} catch {
			// File doesn't exist, skip
		}
	}

	return files;
}

export function buildModelFallbackPromptContent(modelFallbacks?: string[]): string | undefined {
	const chain = (modelFallbacks ?? []).map((item) => item.trim()).filter(Boolean);
	if (chain.length === 0) {
		return undefined;
	}
	return [
		"Fallback candidates (ordered):",
		...chain.map((item) => `- ${item}`),
	].join("\n");
}
