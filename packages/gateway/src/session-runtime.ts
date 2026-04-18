import {
	AuthManager,
	appendPersistedWorkflowCrystallizationTurnFromRun,
	buildTaughtTaskDraftPromptContent,
	buildSkillsSection,
	buildWorkspaceSkillSnapshot,
	buildSessionResetPrompt,
	listPlaybookRuns,
	loadPlaybookRun,
	loadPersistedTaughtTaskDraftLedger,
	normalizeAssistantDisplayText,
	resolveUnderstudyHomeDir,
	type PlaybookRunInputValue,
	type PlaybookRunRecord,
} from "@understudy/core";
import { createMacosDemonstrationRecorder } from "@understudy/gui";
import { getModel, type ImageContent, type Model } from "@mariozechner/pi-ai";
import { buildTeachCapabilitySnapshot } from "@understudy/tools";
import type { TeachCapabilitySnapshot } from "@understudy/tools";
import type { Attachment, UnderstudyConfig } from "@understudy/types";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { buildPromptInputFromMedia } from "./media-input.js";
import { injectTimestamp, timestampOptsFromConfig } from "./message-timestamp.js";
import {
	extractRenderableAssistantImages,
	normalizeAssistantRenderableText,
} from "./assistant-media.js";
import type { ChatHandler, SessionHandlers } from "./server.js";
import {
	buildSubagentSessionId,
	createSubagentSessionMeta,
	listSubagentEntries,
	markSubagentRunCompleted,
	markSubagentRunFailed,
	markSubagentRunStarted,
	resolveSubagentEntry,
} from "./subagent-registry.js";
import {
	resolveSubagentSpawnPlan,
	type SpawnSubagentParams,
} from "./subagent-spawn-plan.js";
import { createGatewayTaskDraftHandlers } from "./task-drafts.js";
import { asBoolean, asNumber, asRecord, asString } from "./value-coerce.js";
import { mergeUnderstudyConfigOverride } from "./channel-policy.js";
import {
	completePlaybookStage,
	resumePlaybookRun,
	runPlaybookNextStage,
	startPlaybookRun,
} from "./playbook-runtime.js";
import {
	type TeachSlashCommand,
	asStringList,
	trimToUndefined,
} from "./teach-normalization.js";
import {
	buildHistoryTimeline,
	cloneValue,
	copyRuntimeMessagesForBranch,
	normalizeActiveRunSnapshot,
	resolveWaitForCompletion,
	sanitizeAssistantHistoryEntry,
	seedRuntimeMessagesFromHistory,
	touchSession,
	type RunTurnResult,
} from "./session-history.js";
export { seedRuntimeMessagesFromHistory } from "./session-history.js";
export type { RunTurnResult } from "./session-history.js";
import type {
	SessionEntry,
	SessionRunTrace,
	SessionSummary,
	SessionSandboxInfo,
	SessionSummaryInput,
	WorkflowCrystallizationRuntimeOptions,
	CreateGatewaySessionRuntimeParams,
} from "./session-types.js";
export type {
	SessionEntry,
	SessionRunTrace,
	SessionSummary,
	SessionSandboxInfo,
	WorkflowCrystallizationRuntimeOptions,
	CreateGatewaySessionRuntimeParams,
} from "./session-types.js";
import { createWorkflowCrystallizationPipeline } from "./workflow-crystallization.js";
import { createTeachInternalSessions } from "./teach-internal-sessions.js";
import { createTeachOrchestration } from "./teach-orchestration.js";
import { defaultTeachDraftValidator } from "./teach-prompts.js";

export const buildSessionSummary = (entry: SessionSummaryInput): SessionSummary => {
	const latestRun = Array.isArray(entry.recentRuns) ? entry.recentRuns[0] : undefined;
	const latestTool = latestRun
		? [...latestRun.toolTrace]
			.reverse()
			.map((item) => asRecord(item))
			.find((item) => item && typeof item.name === "string")
		: undefined;
	const sessionDisplayName = resolveSessionDisplayName(entry.sessionMeta);
	const teachClarification = resolveTeachClarificationSummary(entry.sessionMeta);
	return {
		id: entry.id,
		...(sessionDisplayName ? { sessionName: sessionDisplayName } : {}),
		parentId: entry.parentId,
		forkPoint: entry.forkPoint,
		channelId: entry.channelId,
		senderId: entry.senderId,
		senderName: entry.senderName,
		conversationName: entry.conversationName,
		conversationType: entry.conversationType,
		threadId: entry.threadId,
		createdAt: entry.createdAt,
		lastActiveAt: entry.lastActiveAt,
		messageCount: entry.messageCount,
		workspaceDir: entry.workspaceDir,
		model: asString(entry.sessionMeta?.model),
		thinkingLevel: asString(entry.sessionMeta?.thinkingLevel) as UnderstudyConfig["defaultThinkingLevel"] | undefined,
		runtimeProfile: asString(entry.sessionMeta?.runtimeProfile),
		traceId: entry.traceId,
		...(latestRun ? { lastRunId: latestRun.runId, lastRunAt: latestRun.recordedAt } : {}),
		...(latestTool && typeof latestTool.name === "string" ? { lastToolName: latestTool.name } : {}),
		...(latestTool && typeof latestTool.route === "string" ? { lastToolRoute: latestTool.route } : {}),
		...(latestTool ? { lastToolStatus: latestTool.isError === true ? "error" as const : "ok" as const } : {}),
		...(entry.subagentMeta
			? {
				subagentParentId: entry.subagentMeta.parentSessionId,
				subagentLabel: entry.subagentMeta.label,
				subagentMode: entry.subagentMeta.mode,
				subagentStatus: entry.subagentMeta.latestRunStatus,
			}
			: {}),
		...(teachClarification ? { teachClarification } : {}),
	};
};

function resolveSessionDisplayName(sessionMeta?: Record<string, unknown>): string | undefined {
	return trimToUndefined(asString(sessionMeta?.sessionName));
}

function resolveTeachClarificationSummary(sessionMeta?: Record<string, unknown>) {
	const record = asRecord(sessionMeta?.teachClarification);
	const draftId = trimToUndefined(asString(record?.draftId));
	if (!draftId) {
		return undefined;
	}
	return {
		draftId,
		status: asString(record?.status) === "ready" ? "ready" as const : "clarifying" as const,
		summary: trimToUndefined(asString(record?.summary)),
		nextQuestion: trimToUndefined(asString(record?.nextQuestion)),
		pendingQuestions: asStringList(record?.pendingQuestions),
		updatedAt: asNumber(record?.updatedAt),
	};
}

function extractSessionSystemPrompt(session: unknown): string | undefined {
	const messages = (session as {
		agent?: { state?: { messages?: Array<{ role?: unknown; content?: unknown }> } };
	})?.agent?.state?.messages;
	if (!Array.isArray(messages)) {
		return undefined;
	}
	const systemMessage = messages.find((message) => message?.role === "system");
	if (!systemMessage) {
		return undefined;
	}
	if (typeof systemMessage.content === "string") {
		return trimToUndefined(systemMessage.content);
	}
	if (!Array.isArray(systemMessage.content)) {
		return undefined;
	}
	const text = systemMessage.content
		.map((chunk) => {
			if (!chunk || typeof chunk !== "object") {
				return "";
			}
			const typed = chunk as { type?: unknown; text?: unknown };
			return typed.type === "text" && typeof typed.text === "string"
				? typed.text
				: "";
		})
		.join("\n")
		.trim();
	return trimToUndefined(text);
}

function updateSessionSystemPromptState(session: unknown, prompt: string): void {
	const messages = (session as {
		agent?: { state?: { messages?: Array<{ role?: unknown; content?: unknown }> } };
	})?.agent?.state?.messages;
	if (!Array.isArray(messages)) {
		return;
	}
	const nextMessage = {
		role: "system",
		content: [{ type: "text", text: prompt }],
	};
	const existingIndex = messages.findIndex((message) => message?.role === "system");
	if (existingIndex >= 0) {
		messages[existingIndex] = nextMessage;
		return;
	}
	messages.unshift(nextMessage);
}

function replaceSystemPromptSection(params: {
	prompt: string;
	header: string;
	sectionLines: string[];
	insertBeforeHeaders?: string[];
}): string {
	const lines = params.prompt.split("\n");
	const normalizedHeader = params.header.trim();
	const sectionStart = lines.findIndex((line) => line.trim() === normalizedHeader);
	const nextSectionStart = sectionStart >= 0
		? lines.findIndex((line, index) => index > sectionStart && /^##\s/.test(line.trim()))
		: -1;
	const replacement = params.sectionLines;
	if (sectionStart >= 0) {
		const before = lines.slice(0, sectionStart);
		const after = nextSectionStart >= 0 ? lines.slice(nextSectionStart) : [];
		return [...before, ...replacement, ...after]
			.join("\n")
			.replace(/\n{3,}/g, "\n\n")
			.trimEnd();
	}
	if (replacement.length === 0) {
		return params.prompt;
	}
	const insertBeforeHeaders = params.insertBeforeHeaders ?? [];
	let insertIndex = -1;
	for (const header of insertBeforeHeaders) {
		insertIndex = lines.findIndex((line) => line.trim() === header);
		if (insertIndex >= 0) {
			break;
		}
	}
	const before = insertIndex >= 0 ? lines.slice(0, insertIndex) : lines;
	const after = insertIndex >= 0 ? lines.slice(insertIndex) : [];
	const needsSeparator =
		before.length > 0 &&
		before[before.length - 1]?.trim().length > 0 &&
		replacement[0]?.trim().length > 0;
	return [
		...before,
		...(needsSeparator ? [""] : []),
		...replacement,
		...after,
	]
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trimEnd();
}


export function sanitizeTraceValue(
	value: unknown,
	depth: number = 0,
	keyHint?: string,
): unknown {
	if (value === null || value === undefined) {
		return value;
	}
	if (typeof value === "string") {
		if (keyHint && TRACE_SENSITIVE_KEY_PATTERN.test(keyHint)) {
			return `[REDACTED:${value.length}]`;
		}
		if (keyHint && TRACE_BINARY_PAYLOAD_KEY_PATTERN.test(keyHint)) {
			return value;
		}
		return value.length > TRACE_VALUE_PREVIEW_CHARS
			? `${value.slice(0, TRACE_VALUE_PREVIEW_CHARS)}...`
			: value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return value;
	}
	if (depth >= TRACE_VALUE_MAX_DEPTH) {
		return "[Truncated]";
	}
	if (Array.isArray(value)) {
		return value
			.slice(0, TRACE_VALUE_MAX_ENTRIES)
			.map((entry) => sanitizeTraceValue(entry, depth + 1, keyHint));
	}
	if (typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.slice(0, TRACE_VALUE_MAX_ENTRIES)
				.map(([key, entry]) => [key, sanitizeTraceValue(entry, depth + 1, key)]),
		);
	}
	return String(value);
}

function compactRunMeta(params: {
	runId: string;
	userPrompt: string;
	response: string;
	meta?: Record<string, unknown>;
}): SessionRunTrace {
	const meta = params.meta ?? {};
	const teachValidation = asRecord(meta.teachValidation);
	const agentMeta = asRecord(meta.agentMeta);
	return {
		runId: params.runId,
		recordedAt: Date.now(),
		userPromptPreview: params.userPrompt.trim().slice(0, TRACE_VALUE_PREVIEW_CHARS),
		responsePreview: params.response.trim().slice(0, TRACE_VALUE_PREVIEW_CHARS),
		...(typeof meta.durationMs === "number" ? { durationMs: meta.durationMs } : {}),
		...(typeof meta.thoughtText === "string" && meta.thoughtText.trim().length > 0
			? { thoughtText: meta.thoughtText }
			: {}),
		...(Array.isArray(meta.progressSteps)
			? {
				progressSteps: meta.progressSteps
					.slice(-MAX_RECENT_RUN_TRACE_ENTRIES)
					.map((entry) => sanitizeTraceValue(entry) as Record<string, unknown>),
			}
			: {}),
		toolTrace: Array.isArray(meta.toolTrace)
			? meta.toolTrace
				.slice(-MAX_RECENT_RUN_TRACE_ENTRIES)
				.map((entry) => sanitizeTraceValue(entry) as Record<string, unknown>)
			: [],
		attempts: Array.isArray(meta.attempts)
			? meta.attempts
				.slice(-MAX_RECENT_RUN_ATTEMPTS)
				.map((entry) => sanitizeTraceValue(entry) as Record<string, unknown>)
			: [],
		...(teachValidation ? { teachValidation: sanitizeTraceValue(teachValidation) as Record<string, unknown> } : {}),
		...(agentMeta ? { agentMeta: sanitizeTraceValue(agentMeta) as Record<string, unknown> } : {}),
	};
}

export function resolveTeachValidationTrace(
	run: SessionRunTrace | Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	if (!run || typeof run !== "object") {
		return undefined;
	}
	return asRecord((run as { teachValidation?: unknown }).teachValidation);
}

function normalizeSessionRunTrace(run: SessionRunTrace): SessionRunTrace {
	const teachValidation = resolveTeachValidationTrace(run);
	return {
		runId: run.runId,
		recordedAt: run.recordedAt,
		userPromptPreview: run.userPromptPreview,
		responsePreview: run.responsePreview,
		...(typeof run.durationMs === "number" ? { durationMs: run.durationMs } : {}),
		...(typeof run.thoughtText === "string" ? { thoughtText: run.thoughtText } : {}),
		...(Array.isArray(run.progressSteps) ? { progressSteps: run.progressSteps } : {}),
		toolTrace: Array.isArray(run.toolTrace) ? run.toolTrace : [],
		attempts: Array.isArray(run.attempts) ? run.attempts : [],
		...(teachValidation ? { teachValidation } : {}),
		...(run.agentMeta ? { agentMeta: run.agentMeta } : {}),
	};
}

function rememberSessionRun(entry: SessionEntry, run: SessionRunTrace): void {
	const existing = Array.isArray(entry.recentRuns) ? entry.recentRuns : [];
	entry.recentRuns = [run, ...existing].slice(0, MAX_RECENT_SESSION_RUNS);
}

export function storeSessionRunTrace(entry: SessionEntry, params: {
	runId: string;
	userPrompt: string;
	response: string;
	meta?: Record<string, unknown>;
}): SessionRunTrace {
	const run = compactRunMeta(params);
	rememberSessionRun(entry, run);
	return run;
}

const RESET_COMMAND_RE = /^\/(new|reset)(?:\s+([\s\S]*))?$/i;
const TEACH_COMMAND_RE = /^\/teach(?:\s+(start|stop|confirm|validate|publish))?(?:\s+([\s\S]*))?$/i;
const MAX_RECENT_SESSION_RUNS = 6;
const MAX_RECENT_RUN_ATTEMPTS = 6;
const MAX_RECENT_RUN_TRACE_ENTRIES = 60;
const TRACE_VALUE_MAX_DEPTH = 4;
const TRACE_VALUE_MAX_ENTRIES = 20;
const TRACE_VALUE_PREVIEW_CHARS = 240;
const TRACE_BINARY_PAYLOAD_KEY_PATTERN = /^(imageData)$/i;
const TRACE_SENSITIVE_KEY_PATTERN = /(pass(word)?|secret|token|api[_-]?key|auth(orization)?|cookie|session)/i;

type RuntimeSessionContextExtras = {
	configOverride?: Partial<UnderstudyConfig>;
	sandboxInfo?: SessionSandboxInfo;
	executionScopeKey?: string;
	images?: ImageContent[];
	attachments?: Attachment[];
};


function parseSessionModelRef(
	value: string | undefined,
): { provider: string; modelId: string } | undefined {
	const normalized = trimToUndefined(value);
	if (!normalized) {
		return undefined;
	}
	const slashIndex = normalized.indexOf("/");
	if (slashIndex <= 0 || slashIndex === normalized.length - 1) {
		return undefined;
	}
	return {
		provider: normalized.slice(0, slashIndex),
		modelId: normalized.slice(slashIndex + 1),
	};
}

function parseSessionThinkingLevel(
	value: string | undefined,
): UnderstudyConfig["defaultThinkingLevel"] | undefined {
	switch (value?.trim().toLowerCase()) {
		case undefined:
		case "":
			return undefined;
		case "off":
		case "minimal":
		case "low":
		case "medium":
		case "high":
		case "xhigh":
			return value.trim().toLowerCase() as UnderstudyConfig["defaultThinkingLevel"];
		default:
			throw new Error("thinkingLevel must be one of: off|minimal|low|medium|high|xhigh");
	}
}

export function normalizeHistoryImages(value: unknown): ImageContent[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const images = value
		.map((entry) => asRecord(entry))
		.filter((entry): entry is Record<string, unknown> => Boolean(entry))
		.map((entry) => {
			const data = asString(entry.data);
			const mimeType = asString(entry.mimeType);
			if (asString(entry.type) !== "image" || !data || !mimeType) {
				return null;
			}
			return {
				type: "image" as const,
				data,
				mimeType,
			};
		})
		.filter((entry): entry is ImageContent => Boolean(entry));
	return images.length > 0 ? images : undefined;
}

export function normalizeHistoryAttachments(value: unknown): Attachment[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const attachments = value
		.map((entry) => asRecord(entry))
		.filter((entry): entry is Record<string, unknown> => Boolean(entry))
		.map((entry) => {
			const type = asString(entry.type);
			const url = asString(entry.url);
			if (!type || !url || !["image", "file", "audio", "video"].includes(type)) {
				return null;
			}
			const attachment: Attachment = {
				type: type as Attachment["type"],
				url,
			};
			const name = asString(entry.name);
			const mimeType = asString(entry.mimeType);
			const size = asNumber(entry.size);
			if (name) attachment.name = name;
			if (mimeType) attachment.mimeType = mimeType;
			if (size !== undefined) attachment.size = size;
			return attachment;
		})
		.filter((entry): entry is Attachment => entry !== null);
	return attachments.length > 0 ? attachments : undefined;
}

function resolveRequestedWorkspaceDir(params?: Record<string, unknown>): string | undefined {
	return asString(params?.workspaceDir) ?? asString(params?.cwd);
}

export function createGatewaySessionRuntime(
	params: CreateGatewaySessionRuntimeParams,
): { chatHandler: ChatHandler; sessionHandlers: SessionHandlers } {
	const {
		sessionEntries,
		inFlightSessionIds,
		config,
		usageTracker,
		estimateTokens,
		appendHistory,
		getOrCreateSession,
		createScopedSession,
		promptSession,
		abortSessionEntry,
		resolveAgentTarget,
		waitForRun,
		listPersistedSessions,
		readPersistedSession,
		readTranscriptHistory,
		readPersistedTrace,
		persistSessionRunTrace,
		deletePersistedSession,
		onStateChanged,
		demonstrationRecorder = createMacosDemonstrationRecorder(),
		validateTeachDraft = defaultTeachDraftValidator,
		notifyUser,
		workflowCrystallization: workflowCrystallizationOptions = {},
	} = params;
	const runtimeLearningDir = join(resolveUnderstudyHomeDir(), "learning");

	const parseResetCommand = (message: string): { command: "new" | "reset"; trailing?: string } | null => {
		const match = message.match(RESET_COMMAND_RE);
		if (!match) return null;
		const command = match[1]?.toLowerCase() === "new" ? "new" : "reset";
		const trailing = match[2]?.trim();
		return trailing ? { command, trailing } : { command };
	};

	const parseTeachCommand = (message: string): TeachSlashCommand | null => {
		const match = message.match(TEACH_COMMAND_RE);
		if (!match) {
			return null;
		}
		const action = match[1]?.trim().toLowerCase();
		if (!action) {
			const trailing = match[2]?.trim();
			return trailing ? { action: "help", trailing } : { action: "help" };
		}
		if (action !== "start" && action !== "stop" && action !== "confirm" && action !== "validate" && action !== "publish") {
			return null;
		}
		const trailing = match[2]?.trim();
		return trailing ? { action, trailing } : { action };
	};

	const resolveResetPrompt = (reset: { command: "new" | "reset"; trailing?: string }, timezone?: string): string =>
		reset.trailing ?? buildSessionResetPrompt(timezone);

	const resolveTeachCapabilitySnapshot = (workspaceDir?: string): TeachCapabilitySnapshot | undefined => {
		if (!workspaceDir) {
			return undefined;
		}
		try {
			return buildTeachCapabilitySnapshot({
				workspaceDir,
				config,
			});
		} catch {
			return undefined;
		}
	};

	const recreateSessionEntry = async (entry: SessionEntry): Promise<SessionEntry> => {
		await deletePersistedSession?.({ sessionId: entry.id });
		const recreated = await createScopedSession({
			sessionKey: entry.id,
			parentId: entry.parentId,
			forkPoint: entry.forkPoint,
			channelId: entry.channelId,
			senderId: entry.senderId,
			senderName: entry.senderName,
			conversationName: entry.conversationName,
			conversationType: entry.conversationType,
			threadId: entry.threadId,
			workspaceDir: entry.workspaceDir,
			configOverride: entry.configOverride,
			sandboxInfo: entry.sandboxInfo,
			executionScopeKey: entry.executionScopeKey,
		});
		sessionEntries.set(entry.id, recreated);
		onStateChanged?.();
		return recreated;
	};

	const taskDraftHandlers = createGatewayTaskDraftHandlers({
		sessionEntries,
		config,
	});
	const applyPromptSectionToWorkspaceSessions = (params: {
		workspaceDir: string;
		header: string;
		sectionLines: string[];
		insertBeforeHeaders?: string[];
	}): number => {
		const normalizedWorkspaceDir = resolve(params.workspaceDir);
		let refreshed = 0;
		for (const candidate of sessionEntries.values()) {
			if (!candidate.workspaceDir || resolve(candidate.workspaceDir) !== normalizedWorkspaceDir) {
				continue;
			}
			const agent = (candidate.session as { agent?: { setSystemPrompt?: (prompt: string) => void } })?.agent;
			if (!agent || typeof agent.setSystemPrompt !== "function") {
				continue;
			}
			const currentPrompt = extractSessionSystemPrompt(candidate.session);
			if (!currentPrompt) {
				continue;
			}
			const nextPrompt = replaceSystemPromptSection({
				prompt: currentPrompt,
				header: params.header,
				sectionLines: params.sectionLines,
				insertBeforeHeaders: params.insertBeforeHeaders,
			});
			if (!nextPrompt || nextPrompt === currentPrompt) {
				continue;
			}
			agent.setSystemPrompt(nextPrompt);
			updateSessionSystemPromptState(candidate.session, nextPrompt);
			refreshed += 1;
		}
		return refreshed;
	};
	const applySkillsSectionToWorkspaceSessions = (
		workspaceDir: string,
		skillsSection: string[],
	): number =>
		applyPromptSectionToWorkspaceSessions({
			workspaceDir,
			header: "## Skills (mandatory)",
			sectionLines: skillsSection,
			insertBeforeHeaders: [
				"## Memory Recall",
				"## Authorized Senders",
				"## Current Date & Time",
				"## Workspace",
			],
		});
	const buildTeachDraftRefreshSection = async (workspaceDir: string): Promise<string[]> => {
		const ledger = await loadPersistedTaughtTaskDraftLedger({
			workspaceDir,
		}).catch(() => undefined);
		const content = buildTaughtTaskDraftPromptContent(ledger);
		return content ? ["## Teach Drafts", content, ""] : [];
	};
	const buildPublishedSkillRefreshSection = (published: {
		skill: { name?: string; skillPath?: string };
		draft?: { objective?: string };
	}): string[] => {
		const skillName = trimToUndefined(published.skill.name) ?? "new-workspace-skill";
		const skillPath = trimToUndefined(published.skill.skillPath) ?? "SKILL.md";
		const description =
			trimToUndefined(published.draft?.objective) ??
			"Newly published workspace skill. Read SKILL.md before using it.";
		return [
			"## Skills (mandatory)",
			"Before replying: scan <available_skills> <description> entries.",
			"- If exactly one skill clearly applies: read its SKILL.md at <location> with `read`, then follow it.",
			"- If multiple could apply: choose the most specific one, then read/follow it.",
			"- If none clearly apply: do not read any SKILL.md.",
			"Constraints: never read more than one skill up front; only read after selecting.",
			"- When a skill drives external API writes, assume rate limits: prefer fewer larger writes, avoid tight one-item loops, serialize bursts when possible, and respect 429/Retry-After.",
			[
				"<available_skills>",
				`  <skill name="${skillName}">`,
				`    <description>${description}</description>`,
				`    <location>${skillPath}</location>`,
				"  </skill>",
				"</available_skills>",
			].join("\n"),
			"",
		];
	};
	const refreshWorkspaceSkillPrompts = async (workspaceDir: string): Promise<number> => {
		const normalizedWorkspaceDir = resolve(workspaceDir);
		const skillSnapshot = buildWorkspaceSkillSnapshot({
			workspaceDir: normalizedWorkspaceDir,
			config,
		});
		const skillsSection = buildSkillsSection(skillSnapshot.resolvedSkills);
		return applySkillsSectionToWorkspaceSessions(normalizedWorkspaceDir, skillsSection);
	};
	const refreshWorkspaceTeachDraftPrompts = async (workspaceDir: string): Promise<number> =>
		applyPromptSectionToWorkspaceSessions({
			workspaceDir,
			header: "## Teach Drafts",
			sectionLines: await buildTeachDraftRefreshSection(workspaceDir),
			insertBeforeHeaders: [
				"## Memory Recall",
				"## Authorized Senders",
				"## Current Date & Time",
				"## Workspace",
			],
		});
	const refreshTeachDraftPrompts = async (entry: SessionEntry): Promise<void> => {
		if (!entry.workspaceDir) {
			return;
		}
		await refreshWorkspaceTeachDraftPrompts(entry.workspaceDir).catch(() => {});
	};
	const refreshPublishedSkillPrompts = async (
		entry: SessionEntry,
		published: {
			draft: { objective?: string };
			skill: { name?: string; skillPath?: string };
		},
	): Promise<string | undefined> => {
		if (!entry.workspaceDir) {
			return "Workspace-bound teach skill refresh is unavailable for this session.";
		}
		try {
			const refreshed = await refreshWorkspaceSkillPrompts(entry.workspaceDir);
			if (refreshed > 0) {
				return undefined;
			}
		} catch (error) {
			const fallbackRefreshed = applySkillsSectionToWorkspaceSessions(
				entry.workspaceDir,
				buildPublishedSkillRefreshSection(published),
			);
			if (fallbackRefreshed > 0) {
				return `Used a minimal prompt refresh for the new skill because the full workspace skill snapshot could not be rebuilt automatically: ${
					error instanceof Error ? error.message : String(error)
				}`;
			}
			return error instanceof Error ? error.message : String(error);
		}
		const fallbackRefreshed = applySkillsSectionToWorkspaceSessions(
			entry.workspaceDir,
			buildPublishedSkillRefreshSection(published),
		);
		if (fallbackRefreshed > 0) {
			return undefined;
		}
		return "No active workspace session prompt was available to hot-refresh.";
	};
	const sessionTurnChains = new Map<string, Promise<unknown>>();

	const runSerializedSessionTurn = <T>(entry: SessionEntry, task: () => Promise<T>): Promise<T> => {
		const previous = sessionTurnChains.get(entry.id) ?? Promise.resolve();
		const queued = previous.catch(() => {}).then(task);
		let trackedPromise: Promise<unknown>;
		const cleanupPromise = queued.finally(() => {
			if (sessionTurnChains.get(entry.id) === trackedPromise) {
				sessionTurnChains.delete(entry.id);
			}
		});
		// The cleanup chain is internal bookkeeping only. Consume its rejection so
		// background run failures do not escape as unhandled rejections while still
		// leaving the original queued promise rejection visible to real callers.
		trackedPromise = cleanupPromise.catch(() => {});
		sessionTurnChains.set(entry.id, trackedPromise);
		return queued;
	};

	const workflowCrystallizationPipeline = createWorkflowCrystallizationPipeline({
		createScopedSession,
		promptSession,
		abortSessionEntry,
		runSerializedSessionTurn,
		notifyUser,
		runtimeLearningDir,
		workflowCrystallizationOptions,
		refreshPublishedSkillPrompts,
	});
	const { runWorkflowCrystallizationAnalysis, runSerializedWorkflowLedgerMutation } = workflowCrystallizationPipeline;

	const teachInternalSessions = createTeachInternalSessions({
		createScopedSession,
		promptSession,
		abortSessionEntry,
		runSerializedSessionTurn,
	});
	const { runTeachInternalPrompt, runTeachValidationReplayPrompt } = teachInternalSessions;

	const buildDirectSessionResponse = (params: {
		entry: SessionEntry;
		userText: string;
		assistantText: string;
		assistantImages?: ImageContent[];
		meta?: Record<string, unknown>;
		historyMedia?: {
			images?: ImageContent[];
			attachments?: Attachment[];
		};
	}): RunTurnResult => {
		appendHistory(params.entry, "user", params.userText, undefined, params.historyMedia);
		appendHistory(
			params.entry,
			"assistant",
			params.assistantText,
			undefined,
			params.assistantImages?.length ? { images: params.assistantImages } : undefined,
		);
		params.entry.lastActiveAt = Date.now();
		params.entry.messageCount += 1;
		seedRuntimeMessagesFromHistory(params.entry, params.entry.history);
		onStateChanged?.();
		return {
			response: params.assistantText,
			runId: `direct-${randomUUID()}`,
			sessionId: params.entry.id,
			status: "ok",
			...(params.assistantImages?.length ? { images: params.assistantImages } : {}),
			...(params.meta ? { meta: params.meta } : {}),
		};
	};

	const buildEphemeralSessionResponse = (params: {
		entry: SessionEntry;
		assistantText: string;
		meta?: Record<string, unknown>;
	}): RunTurnResult => ({
		response: params.assistantText,
		runId: `ephemeral-${randomUUID()}`,
		sessionId: params.entry.id,
		status: "ok",
		...(params.meta ? { meta: params.meta } : {}),
	});

	const resolveHistoryMedia = (params: {
		promptOptions?: Record<string, unknown>;
		images?: ImageContent[];
		attachments?: Attachment[];
	}): { images?: ImageContent[]; attachments?: Attachment[] } | undefined => {
		const promptOptionRecord = asRecord(params.promptOptions);
		const images = normalizeHistoryImages(promptOptionRecord?.images ?? params.images);
		const attachments = normalizeHistoryAttachments(params.attachments);
		return images || attachments
			? {
				...(images ? { images } : {}),
				...(attachments ? { attachments } : {}),
			}
			: undefined;
	};

	const teachOrchestration = createTeachOrchestration({
		sessionEntries,
		appendHistory,
		onStateChanged,
		demonstrationRecorder,
		notifyUser,
		taskDraftHandlers,
		refreshTeachDraftPrompts,
		refreshPublishedSkillPrompts,
		storeSessionRunTrace,
		persistSessionRunTrace,
		validateTeachDraft,
		buildDirectSessionResponse,
		buildEphemeralSessionResponse,
		resolveTeachCapabilitySnapshot,
		runTeachInternalPrompt,
		runTeachValidationReplayPrompt,
	});
	const {
		clearTeachClarificationForDraft,
		startTeachRecordingFromCommand,
		validateExistingTeachDraft,
		publishExistingTeachDraft,
		stopTeachRecordingFromCommand,
		handleTeachClarificationTurn,
		runTeachSlashCommand,
		activeTeachRecordings,
	} = teachOrchestration;

	const finalizePromptRun = async (params: {
		entry: SessionEntry;
		effectiveText: string;
		channelId?: string;
		promptOptions?: Record<string, unknown>;
		runPromise: Promise<{ response: string; runId: string; images?: ImageContent[]; meta?: Record<string, unknown> }>;
		tracePrompt?: string;
		allowEmptyReplyRecovery?: boolean;
		}): Promise<RunTurnResult> => {
			const promptResult = await params.runPromise;
			const assistantImages =
				promptResult.images ??
				extractRenderableAssistantImages(promptResult) ??
				extractRenderableAssistantImages(promptResult.meta);
			const assistantResult = normalizeAssistantDisplayText(normalizeAssistantRenderableText(
				promptResult.response,
				{ images: assistantImages },
			));
			const visibleResponse = assistantResult.text;
			if (
				(params.allowEmptyReplyRecovery ?? true) &&
				!assistantResult.silent &&
				visibleResponse.trim().length === 0
			) {
				const recoveryPrompt = [
					"System note: your previous turn ended with an empty <final> after tool use.",
					"Continue the same task from the current state.",
					"Do not repeat completed setup.",
					"Either keep working, or if the task is complete or blocked, say that explicitly in <final>.",
					"Do not return an empty <final>.",
				].join(" ");
				const recoveryRunPromise = promptSession(
					params.entry,
					recoveryPrompt,
					promptResult.runId,
					params.promptOptions,
				);
				void recoveryRunPromise.catch(() => {});
				return await finalizePromptRun({
					...params,
					effectiveText: recoveryPrompt,
					runPromise: recoveryRunPromise,
					tracePrompt: params.tracePrompt ?? params.effectiveText,
					allowEmptyReplyRecovery: false,
				});
			}
			if (!assistantResult.silent) {
				appendHistory(
					params.entry,
					"assistant",
					visibleResponse,
					undefined,
					assistantImages?.length ? { images: assistantImages } : undefined,
				);
			}
			const runTrace = storeSessionRunTrace(params.entry, {
				runId: promptResult.runId,
				userPrompt: params.tracePrompt ?? params.effectiveText,
			response: visibleResponse,
			meta: promptResult.meta,
		});
		if (persistSessionRunTrace) {
			await persistSessionRunTrace({
				sessionId: params.entry.id,
				trace: runTrace,
			});
		}
		const completedAt = Date.now();
		if (params.entry.subagentMeta) {
			params.entry.subagentMeta = markSubagentRunCompleted(params.entry.subagentMeta, {
				runId: promptResult.runId,
				response: visibleResponse,
				recordedAt: completedAt,
				});
			}
			params.entry.lastActiveAt = completedAt;
			if (!assistantResult.silent) {
				params.entry.messageCount += 1;
			}
			usageTracker.record({
			inputTokens: estimateTokens(params.effectiveText),
			outputTokens: estimateTokens(visibleResponse),
			model: config.defaultModel,
			provider: config.defaultProvider,
			timestamp: completedAt,
			sessionId: params.entry.id,
			channelId: params.channelId,
		});
		onStateChanged?.();
		if (params.entry.workspaceDir) {
			await runSerializedWorkflowLedgerMutation(params.entry.workspaceDir, async () =>
				await appendPersistedWorkflowCrystallizationTurnFromRun({
					workspaceDir: params.entry.workspaceDir!,
					repoRoot: params.entry.repoRoot,
					learningDir: runtimeLearningDir,
					sessionId: params.entry.id,
					traceId: params.entry.traceId,
					runId: promptResult.runId,
					promptPreview: params.effectiveText,
					responsePreview: visibleResponse,
					toolTrace: Array.isArray(runTrace.toolTrace) ? runTrace.toolTrace : [],
					teachValidation: runTrace.teachValidation,
					timestamp: completedAt,
				})).catch(() => undefined);
			runWorkflowCrystallizationAnalysis(params.entry);
		}
		return {
			response: visibleResponse,
			runId: promptResult.runId,
			sessionId: params.entry.id,
			status: "ok",
			...(assistantImages?.length ? { images: assistantImages } : {}),
			...(promptResult.meta ? { meta: promptResult.meta } : {}),
		};
	};

	const dispatchPromptTurn = async (params: {
		entry: SessionEntry;
		userText: string;
		effectiveText: string;
		channelId?: string;
		waitForCompletion: boolean;
		promptOptions?: Record<string, unknown>;
		historyMedia?: {
			images?: ImageContent[];
			attachments?: Attachment[];
		};
	}): Promise<RunTurnResult> => {
		const runId = randomUUID();
		const completion = runSerializedSessionTurn(params.entry, async () => {
			appendHistory(params.entry, "user", params.userText, undefined, params.historyMedia);
			onStateChanged?.();
			if (params.entry.subagentMeta) {
				params.entry.subagentMeta = markSubagentRunStarted(params.entry.subagentMeta, runId);
				touchSession(params.entry, params.entry.subagentMeta.updatedAt);
				onStateChanged?.();
			}
			const runPromise = promptSession(
				params.entry,
				params.effectiveText,
				runId,
				params.promptOptions,
			);
			// Background runs can fail before the outer completion chain awaits the
			// prompt promise. Observe the rejection immediately so quick auth/config
			// failures are reported through runRegistry instead of crashing the process
			// as an unhandled rejection.
			void runPromise.catch(() => {});
			try {
				return await finalizePromptRun({
					entry: params.entry,
					effectiveText: params.effectiveText,
					channelId: params.channelId,
					promptOptions: params.promptOptions,
					runPromise,
				});
			} catch (error) {
				if (params.entry.subagentMeta) {
					params.entry.subagentMeta = markSubagentRunFailed(params.entry.subagentMeta, {
						runId,
						error: error instanceof Error ? error.message : String(error),
					});
					touchSession(params.entry, params.entry.subagentMeta.updatedAt);
					onStateChanged?.();
				}
				throw error;
			}
		});
		if (params.waitForCompletion) {
			return await completion;
		}
		void completion.catch(() => {});
		return {
			response: "",
			runId,
			sessionId: params.entry.id,
			status: "in_flight",
		};
	};

	const requireSessionEntry = (source?: Record<string, unknown>): SessionEntry => {
		const sessionId = asString(source?.sessionId);
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		const entry = sessionEntries.get(sessionId);
		if (!entry) {
			throw new Error(`Session not found: ${sessionId}`);
		}
		return entry;
	};

	const requireSubagentEntry = (parentSessionId: string, target?: string): SessionEntry => {
		const entry = resolveSubagentEntry(sessionEntries.values(), parentSessionId, target);
		if (!entry) {
			throw new Error(target
				? `Subagent not found: ${target}`
				: `Subagent target is required for parent session ${parentSessionId}`);
		}
		return entry;
	};

	const maybeCleanupSubagentEntry = (entry: SessionEntry): boolean => {
		if (!entry.subagentMeta) {
			return false;
		}
		if (entry.subagentMeta.mode !== "run" || entry.subagentMeta.cleanup !== "delete") {
			return false;
		}
		const deleted = sessionEntries.delete(entry.id);
		inFlightSessionIds.delete(entry.id);
		if (deleted) {
			onStateChanged?.();
		}
		return deleted;
	};

	const prepareSubagentSession = async (params: SpawnSubagentParams): Promise<{
				parent: SessionEntry;
				child: SessionEntry;
				created: boolean;
				notes: string[];
				attachments?: Attachment[];
			}> => {
			const parent = requireSessionEntry({ sessionId: params.parentSessionId });
			const notes: string[] = [];
			const resolvedAgent = params.agentId
				? resolveAgentTarget?.(params.agentId) ?? null
				: null;
			const plan = resolveSubagentSpawnPlan({
				request: {
					runtime: asString(params.runtime),
					mode: asString(params.mode),
					cleanup: asString(params.cleanup),
					thread: params.thread === true,
					model: asString(params.model),
					thinking: asString(params.thinking),
					cwd: asString(params.cwd),
					sandbox: asString(params.sandbox),
					agentId: asString(params.agentId),
				},
				agentTarget: resolvedAgent,
			});

			const existingChildId = asString(params.sessionId);
			if (existingChildId) {
				const hasReuseOverrides = Boolean(
					asString(params.agentId) ||
					asString(params.model) ||
					asString(params.thinking) ||
					asString(params.cwd) ||
					asString(params.runtime) ||
					asString(params.mode) ||
					asString(params.cleanup) ||
					asString(params.sandbox) ||
					params.thread === true,
				);
				if (hasReuseOverrides) {
					throw new Error(
						"Reusing an existing child session does not support runtime, workspace, profile, or sandbox overrides. Omit `sessionId` to create a fresh child.",
					);
				}
				const existing = requireSubagentEntry(parent.id, existingChildId);
				if (existing.subagentMeta) {
					existing.subagentMeta = {
						...existing.subagentMeta,
						label: asString(params.label) ?? existing.subagentMeta.label,
						runtime: plan.runtime,
						updatedAt: Date.now(),
					};
					touchSession(existing, existing.subagentMeta.updatedAt);
				}
				onStateChanged?.();
					return {
						parent,
						child: existing,
						created: false,
						notes,
						attachments: Array.isArray(params.attachments) ? params.attachments : undefined,
					};
				}
			if (resolvedAgent) {
				notes.push(`Using agent profile "${resolvedAgent.agentId}" for child workspace/model defaults.`);
			}

			const inheritContext = plan.threadRequested || plan.mode === "session";
			const forkPoint = inheritContext ? parent.history.length : 0;
			const forkHistory = inheritContext
				? cloneValue(parent.history.slice(0, forkPoint))
				: [];
			const child = await createScopedSession({
				sessionKey: buildSubagentSessionId(parent.id),
				parentId: parent.id,
				forkPoint,
				channelId: parent.channelId,
				senderId: parent.senderId,
				senderName: parent.senderName,
				conversationType: parent.conversationType,
				threadId: parent.threadId,
				workspaceDir: plan.workspaceDir ?? parent.workspaceDir,
				explicitWorkspace: Boolean(plan.workspaceDir),
				configOverride: mergeUnderstudyConfigOverride(parent.configOverride, plan.configOverride),
				sandboxInfo: parent.sandboxInfo,
				executionScopeKey: parent.executionScopeKey,
			});
			child.subagentMeta = createSubagentSessionMeta({
				parentSessionId: parent.id,
				label: asString(params.label),
				runtime: plan.runtime,
				mode: plan.mode,
				cleanup: plan.cleanup,
				thread: plan.threadRequested,
			});
			if (forkHistory.length > 0) {
				child.history = forkHistory;
				child.messageCount = forkHistory.filter((entry) => entry.role === "assistant").length;
				copyRuntimeMessagesForBranch(parent, child, forkHistory);
			}
			touchSession(child, child.subagentMeta.updatedAt);
			sessionEntries.set(child.id, child);
			onStateChanged?.();
				return {
					parent,
					child,
					created: true,
					notes,
					attachments: Array.isArray(params.attachments) ? params.attachments : undefined,
				};
			};

		const chatHandler: ChatHandler = async (text, context) => {
		const runtimeContext = (context ?? {}) as typeof context & RuntimeSessionContextExtras;
		const requestedWorkspaceDir = asString(context?.cwd);
		let scopedSession = await getOrCreateSession({
			channelId: context?.channelId,
			senderId: context?.senderId,
			senderName: context?.senderName,
			conversationName: context?.conversationName,
			conversationType: context?.conversationType as "direct" | "group" | "thread" | undefined,
			threadId: context?.threadId,
			workspaceDir: requestedWorkspaceDir,
			explicitWorkspace: Boolean(requestedWorkspaceDir),
			configOverride: runtimeContext.configOverride,
			sandboxInfo: runtimeContext.sandboxInfo,
			executionScopeKey: runtimeContext.executionScopeKey,
		});
		const reset = parseResetCommand(text);
		let effectiveText = text;
		if (reset) {
			scopedSession = reset.command === "new"
				? await getOrCreateSession({
					channelId: context?.channelId,
					senderId: context?.senderId,
					senderName: context?.senderName,
					conversationName: context?.conversationName,
					conversationType: context?.conversationType as "direct" | "group" | "thread" | undefined,
					threadId: context?.threadId,
					forceNew: true,
					workspaceDir: requestedWorkspaceDir,
					explicitWorkspace: Boolean(requestedWorkspaceDir),
					configOverride: runtimeContext.configOverride,
					sandboxInfo: runtimeContext.sandboxInfo,
					executionScopeKey: runtimeContext.executionScopeKey,
				})
				: await recreateSessionEntry(scopedSession);
			effectiveText = resolveResetPrompt(reset, config.agent.userTimezone);
		}
		const teach = parseTeachCommand(effectiveText);
		if (teach) {
			return await runTeachSlashCommand({
				entry: scopedSession,
				command: teach,
				rawText: effectiveText,
			});
		}
		const teachClarification = await handleTeachClarificationTurn(scopedSession, effectiveText);
		if (teachClarification) {
			return teachClarification;
		}
		const historyUserText = effectiveText;
		const skipTimestampInjection = Boolean(reset && !reset.trailing);
		if (!skipTimestampInjection) {
			effectiveText = injectTimestamp(effectiveText, timestampOptsFromConfig(config));
		}
		const promptInput = await buildPromptInputFromMedia({
			text: effectiveText,
			images: runtimeContext.images,
			attachments: runtimeContext.attachments,
		});
		const historyMedia = resolveHistoryMedia({
			promptOptions: promptInput.promptOptions,
			images: runtimeContext.images,
			attachments: runtimeContext.attachments,
		});
		return await dispatchPromptTurn({
			entry: scopedSession,
			userText: historyUserText,
			effectiveText: promptInput.text,
			channelId: context?.channelId,
			waitForCompletion: resolveWaitForCompletion(context?.waitForCompletion),
			promptOptions: promptInput.promptOptions,
			historyMedia,
		});
	};

		const resolvePlaybookWorkspaceDir = (params?: Record<string, unknown>): string =>
			resolve(resolveRequestedWorkspaceDir(params) ?? config.agent.cwd ?? process.cwd());

	const normalizePlaybookRunInputValue = (value: unknown): PlaybookRunInputValue | undefined => {
		if (typeof value === "string") {
			const trimmed = value.trim();
			return trimmed.length > 0 ? trimmed : undefined;
		}
		if (typeof value === "number" || typeof value === "boolean") {
			return value;
		}
		return undefined;
	};

		const readPlaybookRunInputs = (params?: Record<string, unknown>): Record<string, PlaybookRunInputValue> | undefined => {
			const inputs = asRecord(params?.inputs);
			if (!inputs) {
				return undefined;
			}
		const normalized = Object.fromEntries(
			Object.entries(inputs)
				.map(([key, value]) => [key, normalizePlaybookRunInputValue(value)] as const)
				.filter((entry): entry is [string, PlaybookRunInputValue] => entry[1] !== undefined),
			);
			return Object.keys(normalized).length > 0 ? normalized : undefined;
		};

		const summarizePlaybookRun = (run: PlaybookRunRecord) => {
		const runningStage = run.stages?.find((stage) => stage.status === "running");
		const nextStage = runningStage ?? run.stages?.find((stage) => stage.status === "pending");
		const latestChild = [...run.childSessions].reverse()[0];
		return {
			id: run.id,
			playbookName: run.playbookName,
			status: run.status,
			inputs: run.inputs,
			createdAt: run.createdAt,
			updatedAt: run.updatedAt,
			approval: run.approval,
			artifactsRootDir: run.artifacts.rootDir,
			currentStage: nextStage
				? {
					id: nextStage.id,
					name: nextStage.name,
					kind: nextStage.kind,
					status: nextStage.status,
				}
				: null,
			childSession: latestChild
				? {
					label: latestChild.label,
					sessionId: latestChild.sessionId,
					status: latestChild.status,
					runtime: latestChild.runtime,
					updatedAt: latestChild.updatedAt,
				}
				: null,
			workerBudget: run.budgets?.worker ?? null,
		};
	};

	const dispatchSubagentRun = async (params?: Record<string, unknown>) => {
		const parentSessionId = asString(params?.parentSessionId);
		const task = asString(params?.task);
		if (!parentSessionId) {
			throw new Error("parentSessionId is required");
		}
		if (!task) {
			throw new Error("task is required");
		}
		const prepared = await prepareSubagentSession({
			parentSessionId,
			task,
			label: asString(params?.label),
			runtime: asString(params?.runtime),
			agentId: asString(params?.agentId),
			model: asString(params?.model),
			thinking: asString(params?.thinking),
			cwd: asString(params?.cwd),
			thread: asBoolean(params?.thread) === true,
			mode: asString(params?.mode),
			cleanup: asString(params?.cleanup),
			sandbox: asString(params?.sandbox),
			sessionId: asString(params?.childSessionId),
			timeoutMs: asNumber(params?.timeoutMs),
			runTimeoutSeconds: asNumber(params?.runTimeoutSeconds),
			attachments: Array.isArray(params?.attachments) ? params.attachments as Attachment[] : undefined,
		});
		const promptInput = await buildPromptInputFromMedia({
			text: task,
			attachments: prepared.attachments,
		});
		const historyMedia = resolveHistoryMedia({
			promptOptions: promptInput.promptOptions,
			attachments: prepared.attachments,
		});
		const turn = await dispatchPromptTurn({
			entry: prepared.child,
			userText: task,
			effectiveText: promptInput.text,
			channelId: prepared.child.channelId,
			waitForCompletion: false,
			promptOptions: promptInput.promptOptions,
			historyMedia,
		});
		return {
			status: turn.status,
			parentSessionId: prepared.parent.id,
			childSessionId: prepared.child.id,
			sessionId: prepared.child.id,
			runId: turn.runId,
			runtime: prepared.child.subagentMeta?.runtime ?? "subagent",
			mode: prepared.child.subagentMeta?.mode ?? "run",
			created: prepared.created,
			reused: !prepared.created,
			notes: prepared.notes,
		};
	};

	const sessionHandlers: SessionHandlers = {
		list: async (params) => {
			const channelFilter = asString(params?.channelId);
			const senderFilter = asString(params?.senderId);
			const limit = Math.max(1, asNumber(params?.limit) ?? Number.MAX_SAFE_INTEGER);
			const live = Array.from(sessionEntries.values())
				.filter((entry) => (channelFilter ? entry.channelId === channelFilter : true))
				.filter((entry) => (senderFilter ? entry.senderId === senderFilter : true))
				.map((entry) => buildSessionSummary(entry));
			if (!listPersistedSessions) {
				return live.slice(0, limit);
			}
			const includePersisted = params?.includePersisted === true || live.length === 0;
			if (!includePersisted) {
				return live.slice(0, limit);
			}
			const merged = new Map<string, SessionSummary>();
			for (const entry of live) {
				merged.set(entry.id, entry);
			}
			for (const entry of await listPersistedSessions({
				channelId: channelFilter,
				senderId: senderFilter,
				limit,
			})) {
				if (!merged.has(entry.id)) {
					merged.set(entry.id, entry);
				}
			}
			return Array.from(merged.values()).slice(0, limit);
		},
		get: async (params) => {
			const sessionId = asString(params?.sessionId);
			if (!sessionId) {
				throw new Error("sessionId is required");
			}
			const entry = sessionEntries.get(sessionId);
			if (!entry) {
				const persisted = await readPersistedSession?.({ sessionId });
				return persisted ? { ...persisted, source: "persisted" } : null;
			}
			return buildSessionSummary(entry);
		},
		history: async (params) => {
			const sessionId = asString(params?.sessionId);
			if (!sessionId) {
				throw new Error("sessionId is required");
			}
			const limit = Math.max(1, asNumber(params?.limit) ?? 50);
			const entry = sessionEntries.get(sessionId);
			const liveRuns = Array.isArray(entry?.recentRuns) ? entry.recentRuns.slice(0, limit) : [];
			let effectiveRuns = liveRuns;
			if (readPersistedTrace && (!entry || liveRuns.length < limit)) {
				try {
					const persistedRuns = await readPersistedTrace({ sessionId, limit });
					if (persistedRuns.length > liveRuns.length || (!entry && persistedRuns.length > 0)) {
						effectiveRuns = persistedRuns;
					}
				} catch {
					effectiveRuns = liveRuns;
				}
			}
			if (!entry && readTranscriptHistory) {
				const messages = await readTranscriptHistory({ sessionId, limit });
				const sanitizedMessages = messages.map((message) => sanitizeAssistantHistoryEntry(message));
				return {
					sessionId,
					messages: sanitizedMessages,
					timeline: buildHistoryTimeline(sanitizedMessages, effectiveRuns),
					source: "transcript",
				};
			}
			if (!entry) {
				return { sessionId, messages: [], timeline: [] };
			}
			if (readTranscriptHistory && entry.history.length < limit) {
				const messages = await readTranscriptHistory({ sessionId, limit });
				if (messages.length > entry.history.length) {
					const sanitizedMessages = messages.map((message) => sanitizeAssistantHistoryEntry(message));
					return {
						sessionId,
						messages: sanitizedMessages,
						timeline: buildHistoryTimeline(sanitizedMessages, effectiveRuns),
						source: "transcript",
					};
				}
			}
			const sanitizedMessages = entry.history.slice(-limit).map((message) => sanitizeAssistantHistoryEntry(message));
			return {
				sessionId,
				messages: sanitizedMessages,
				timeline: buildHistoryTimeline(sanitizedMessages, effectiveRuns),
			};
		},
		trace: async (params) => {
			const sessionId = asString(params?.sessionId);
			if (!sessionId) {
				throw new Error("sessionId is required");
			}
			const limit = Math.max(1, asNumber(params?.limit) ?? MAX_RECENT_SESSION_RUNS);
			const entry = sessionEntries.get(sessionId);
			const liveRuns = Array.isArray(entry?.recentRuns) ? entry.recentRuns.slice(0, limit) : [];
			let activeRun: Record<string, unknown> | undefined;
			if (entry && waitForRun) {
				try {
					const snapshot = asRecord(await waitForRun({
						sessionId,
						timeoutMs: 0,
					}));
					if (asRecord(snapshot?.progress)) {
						activeRun = normalizeActiveRunSnapshot(snapshot);
					}
				} catch {
					activeRun = undefined;
				}
			}
			if (readPersistedTrace && (!entry || liveRuns.length < limit)) {
				const persistedRuns = await readPersistedTrace({ sessionId, limit });
				if (persistedRuns.length > liveRuns.length || (!entry && persistedRuns.length > 0)) {
					return {
						sessionId,
						runs: persistedRuns.map((run) => normalizeSessionRunTrace(run)),
						...(activeRun ? { activeRun } : {}),
						source: "persisted",
					};
				}
			}
			return {
				sessionId,
				runs: liveRuns.map((run) => normalizeSessionRunTrace(run)),
				...(activeRun ? { activeRun } : {}),
			};
		},
		playbookRunList: async (params) => {
			const workspaceDir = resolvePlaybookWorkspaceDir(params);
			const limit = Math.max(1, asNumber(params?.limit) ?? 20);
			const runs = await listPlaybookRuns(workspaceDir);
			return {
				workspaceDir,
				runs: runs.slice(0, limit).map((run) => summarizePlaybookRun(run)),
			};
		},
		playbookRunGet: async (params) => {
			const runId = asString(params?.runId);
			if (!runId) {
				throw new Error("runId is required");
			}
			const workspaceDir = resolvePlaybookWorkspaceDir(params);
			const run = await loadPlaybookRun(workspaceDir, runId);
			if (!run) {
				return null;
			}
			return {
				workspaceDir,
				run,
				summary: summarizePlaybookRun(run),
			};
		},
		playbookRunStart: async (params) => {
			const playbookName = asString(params?.playbookName);
			if (!playbookName) {
				throw new Error("playbookName is required");
			}
			const workspaceDir = resolvePlaybookWorkspaceDir(params);
			return await startPlaybookRun({
				workspaceDir,
				playbookName,
				inputs: readPlaybookRunInputs(params),
				runId: asString(params?.runId),
				now: asNumber(params?.now),
			});
		},
		playbookRunResume: async (params) => {
			const runId = asString(params?.runId);
			if (!runId) {
				throw new Error("runId is required");
			}
			return await resumePlaybookRun({
				workspaceDir: resolvePlaybookWorkspaceDir(params),
				runId,
				playbookName: asString(params?.playbookName),
			});
		},
		playbookRunNext: async (params) => {
			const runId = asString(params?.runId);
			if (!runId) {
				throw new Error("runId is required");
			}
			const parentSessionId = asString(params?.parentSessionId);
			if (!parentSessionId) {
				throw new Error("parentSessionId is required");
			}
			return await runPlaybookNextStage({
				workspaceDir: resolvePlaybookWorkspaceDir(params),
				runId,
				parentSessionId,
				now: asNumber(params?.now),
				contextNotes: asStringList(params?.contextNotes),
				spawnSubagent: dispatchSubagentRun,
			});
		},
			playbookRunStageComplete: async (params) => {
				const runId = asString(params?.runId);
				const stageId = asString(params?.stageId);
				const summary = asString(params?.summary);
			if (!runId) {
				throw new Error("runId is required");
			}
			if (!stageId) {
				throw new Error("stageId is required");
			}
			if (!summary) {
				throw new Error("summary is required");
			}
			const status = asString(params?.status);
			if (status !== "completed" && status !== "failed" && status !== "skipped") {
				throw new Error("status must be completed, failed, or skipped");
			}
				return await completePlaybookStage({
					workspaceDir: resolvePlaybookWorkspaceDir(params),
					runId,
					stageId,
					status,
					summary,
					artifactPaths: asStringList(params?.artifactPaths),
					approvalState: (() => {
						const approvalState = asString(params?.approvalState);
						return approvalState === "approved" || approvalState === "rejected" ? approvalState : undefined;
					})(),
					approvalNote: asString(params?.approvalNote),
					now: asNumber(params?.now),
				});
			},
			teachList: async (params?: Record<string, unknown>) => await taskDraftHandlers.list(params),
		teachCreate: async (params?: Record<string, unknown>) => (await taskDraftHandlers.create(params)).draft,
		teachRecordStart: async (params?: Record<string, unknown>) => {
			const entry = requireSessionEntry(params);
			return await startTeachRecordingFromCommand(entry, params);
		},
		teachRecordStatus: async (params?: Record<string, unknown>) => {
			const entry = requireSessionEntry(params);
			return {
				sessionId: entry.id,
				recording: activeTeachRecordings.get(entry.id)?.status() ?? null,
			};
		},
		teachRecordStop: async (params?: Record<string, unknown>) => {
			const entry = requireSessionEntry(params);
			return await stopTeachRecordingFromCommand(entry, params);
		},
			teachVideo: async (params?: Record<string, unknown>) => (await taskDraftHandlers.createFromVideo(params)).draft,
		teachUpdate: async (params?: Record<string, unknown>) => await taskDraftHandlers.update(params),
		teachValidate: async (params?: Record<string, unknown>) => {
			const entry = requireSessionEntry(params);
			const result = await validateExistingTeachDraft(entry, params);
			clearTeachClarificationForDraft(entry, asString(result.draft?.id) ?? asString(params?.draftId));
			return result;
		},
		teachPublish: async (params?: Record<string, unknown>) => {
			const entry = requireSessionEntry(params);
			const result = await publishExistingTeachDraft(entry, params);
			clearTeachClarificationForDraft(entry, asString(result.draft?.id) ?? asString(params?.draftId));
			return result;
		},
		create: async (params) => {
				const channelId = asString(params?.channelId);
				const senderId = asString(params?.senderId);
				const senderName = asString(params?.senderName);
				const conversationName = asString(params?.conversationName);
				const threadId = asString(params?.threadId);
				const conversationType = asString(params?.conversationType) as "direct" | "group" | "thread" | undefined;
				const forceNew = params?.forceNew === true;
				const requestedWorkspaceDir = resolveRequestedWorkspaceDir(params);
				const entry = await getOrCreateSession({
					channelId,
					senderId,
					senderName,
					conversationName,
					conversationType,
					threadId,
					forceNew,
					workspaceDir: requestedWorkspaceDir,
					explicitWorkspace: Boolean(requestedWorkspaceDir),
					configOverride: (params as RuntimeSessionContextExtras | undefined)?.configOverride,
					sandboxInfo: (params as RuntimeSessionContextExtras | undefined)?.sandboxInfo,
					executionScopeKey: (params as RuntimeSessionContextExtras | undefined)?.executionScopeKey,
				});
			onStateChanged?.();
			return buildSessionSummary(entry);
		},
		send: async (params) => {
			const requestedText = asString(params?.message) ?? "";
			const runtimeContext = (params ?? {}) as RuntimeSessionContextExtras;
			if (!requestedText && !Array.isArray(runtimeContext.images) && !Array.isArray(runtimeContext.attachments)) {
				throw new Error("message is required");
			}
			const requestedWorkspaceDir = resolveRequestedWorkspaceDir(params);
			const reset = parseResetCommand(requestedText);
			let effectiveText = requestedText;
			const sessionId = asString(params?.sessionId);
			let entry: SessionEntry | undefined;

			if (sessionId) {
				entry = sessionEntries.get(sessionId);
				if (!entry) {
					throw new Error(`Session not found: ${sessionId}`);
				}
				if (reset) {
					entry = await recreateSessionEntry(entry);
					effectiveText = resolveResetPrompt(reset, config.agent.userTimezone);
				}
			} else {
				const lookupContext = {
					channelId: asString(params?.channelId),
					senderId: asString(params?.senderId),
					senderName: asString(params?.senderName),
					conversationName: asString(params?.conversationName),
					conversationType: asString(params?.conversationType) as "direct" | "group" | "thread" | undefined,
					threadId: asString(params?.threadId),
					workspaceDir: requestedWorkspaceDir,
					explicitWorkspace: Boolean(requestedWorkspaceDir),
					configOverride: (params as RuntimeSessionContextExtras | undefined)?.configOverride,
					sandboxInfo: (params as RuntimeSessionContextExtras | undefined)?.sandboxInfo,
					executionScopeKey: (params as RuntimeSessionContextExtras | undefined)?.executionScopeKey,
				};
				if (reset?.command === "new") {
					entry = await getOrCreateSession({
						...lookupContext,
						forceNew: true,
					});
				} else {
					entry = await getOrCreateSession({
						...lookupContext,
						forceNew: params?.forceNew === true,
					});
					if (reset?.command === "reset") {
						entry = await recreateSessionEntry(entry);
					}
				}
				onStateChanged?.();
				if (reset) {
					effectiveText = resolveResetPrompt(reset, config.agent.userTimezone);
				}
			}
			const skipTimestampInjection = Boolean(reset && !reset.trailing);
			const teach = parseTeachCommand(effectiveText);
			if (teach) {
				return await runTeachSlashCommand({
					entry,
					command: teach,
					rawText: effectiveText,
				});
			}
			const teachClarification = await handleTeachClarificationTurn(entry, effectiveText);
			if (teachClarification) {
				return teachClarification;
			}
			const historyUserText = effectiveText;
			if (!skipTimestampInjection) {
				effectiveText = injectTimestamp(effectiveText, timestampOptsFromConfig(config));
			}
			const promptInput = await buildPromptInputFromMedia({
				text: effectiveText,
				images: runtimeContext.images,
				attachments: runtimeContext.attachments,
			});
			const historyMedia = resolveHistoryMedia({
				promptOptions: promptInput.promptOptions,
				images: runtimeContext.images,
				attachments: runtimeContext.attachments,
			});
			return await dispatchPromptTurn({
				entry,
				userText: historyUserText,
				effectiveText: promptInput.text,
				channelId: entry.channelId,
				waitForCompletion:
					resolveWaitForCompletion(params?.waitForCompletion) &&
					!(
						asBoolean(params?.async) === true
					),
				promptOptions: promptInput.promptOptions,
				historyMedia,
			});
		},
		patch: async (params) => {
			const sessionId = asString(params?.sessionId);
			if (!sessionId) {
				throw new Error("sessionId is required");
			}
			const entry = sessionEntries.get(sessionId);
			if (!entry) {
				throw new Error(`Session not found: ${sessionId}`);
			}
			const messageCount = asNumber(params?.messageCount);
			if (messageCount !== undefined) {
				entry.messageCount = messageCount;
			}
			const patchRecord = asRecord(params);
			const nextMeta = Object.assign({}, entry.sessionMeta);
			if (patchRecord && "sessionName" in patchRecord) {
				const rawSessionName =
					typeof patchRecord.sessionName === "string"
						? patchRecord.sessionName
						: "";
				const sessionName = trimToUndefined(rawSessionName);
				if (sessionName) {
					nextMeta.sessionName = sessionName;
				} else {
					delete nextMeta.sessionName;
				}
			}
			const liveSession = entry.session as {
				setModel?: (model: Model<any>) => Promise<void>;
				setThinkingLevel?: (level: UnderstudyConfig["defaultThinkingLevel"]) => void;
			};
			if (patchRecord && "model" in patchRecord) {
				const parsedModel = parseSessionModelRef(asString(patchRecord.model));
				if (!parsedModel) {
					throw new Error("model must use provider/model-id format");
				}
				const resolvedModel =
					AuthManager.create().findModel(parsedModel.provider, parsedModel.modelId) ??
					getModel(parsedModel.provider as any, parsedModel.modelId as any);
				await liveSession.setModel?.(resolvedModel);
				entry.configOverride = {
					...entry.configOverride,
					defaultProvider: parsedModel.provider,
					defaultModel: parsedModel.modelId,
				};
				nextMeta.model = `${parsedModel.provider}/${parsedModel.modelId}`;
			}
			if (patchRecord && "thinkingLevel" in patchRecord) {
				const thinkingLevel = parseSessionThinkingLevel(asString(patchRecord.thinkingLevel));
				if (!thinkingLevel) {
					throw new Error("thinkingLevel is required when provided");
				}
				liveSession.setThinkingLevel?.(thinkingLevel);
				entry.configOverride = {
					...entry.configOverride,
					defaultThinkingLevel: thinkingLevel,
				};
				nextMeta.thinkingLevel = thinkingLevel;
			}
			entry.sessionMeta = Object.keys(nextMeta).length > 0 ? nextMeta : undefined;
			entry.lastActiveAt = Date.now();
			onStateChanged?.();
			return buildSessionSummary(entry);
		},
		reset: async (params) => {
			const sessionId = asString(params?.sessionId);
			if (!sessionId) {
				throw new Error("sessionId is required");
			}
			const existing = sessionEntries.get(sessionId);
			if (!existing) {
				throw new Error(`Session not found: ${sessionId}`);
			}
			const recreated = await recreateSessionEntry(existing);
			return buildSessionSummary(recreated);
		},
		delete: async (params) => {
			const sessionId = asString(params?.sessionId);
			if (!sessionId) {
				throw new Error("sessionId is required");
			}
			const deleted = sessionEntries.delete(sessionId);
			inFlightSessionIds.delete(sessionId);
			if (deleted) {
				await deletePersistedSession?.({ sessionId });
			}
			onStateChanged?.();
			return { sessionId, deleted };
		},
		compact: async (params) => {
			const sessionId = asString(params?.sessionId);
			if (!sessionId) {
				throw new Error("sessionId is required");
			}
			const entry = sessionEntries.get(sessionId);
			if (!entry) {
				throw new Error(`Session not found: ${sessionId}`);
			}
			const keep = Math.max(1, asNumber(params?.keep) ?? 20);
			const before = entry.history.length;
			if (before > keep) {
				entry.history = entry.history.slice(-keep);
			}
			entry.lastActiveAt = Date.now();
			onStateChanged?.();
			return {
				sessionId,
				kept: entry.history.length,
				removed: Math.max(0, before - entry.history.length),
				summary: buildSessionSummary(entry),
			};
		},
		branch: async (params) => {
			const parentId = asString(params?.sessionId);
			if (!parentId) {
				throw new Error("sessionId is required");
			}
			const parent = sessionEntries.get(parentId);
			if (!parent) {
				throw new Error(`Session not found: ${parentId}`);
			}
			const explicitBranchId = asString(params?.branchId);
			const branchId =
				explicitBranchId ??
				`${parentId}:branch:${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
			if (sessionEntries.has(branchId)) {
				throw new Error(`Session already exists: ${branchId}`);
			}
			const requestedForkPoint = asNumber(params?.forkPoint);
			const forkPoint = requestedForkPoint === undefined
				? parent.history.length
				: Math.max(0, Math.min(parent.history.length, requestedForkPoint));
			const forkHistory = cloneValue(parent.history.slice(0, forkPoint));
			const created = await createScopedSession({
				sessionKey: branchId,
				parentId: parent.id,
				forkPoint,
				channelId: parent.channelId,
				senderId: parent.senderId,
				senderName: parent.senderName,
				conversationName: parent.conversationName,
				conversationType: parent.conversationType,
				threadId: parent.threadId,
				workspaceDir: parent.workspaceDir,
				configOverride: parent.configOverride,
				sandboxInfo: parent.sandboxInfo,
				executionScopeKey: parent.executionScopeKey,
			});
			created.history = forkHistory;
			created.messageCount = forkHistory.filter((entry) => entry.role === "assistant").length;
			created.lastActiveAt = Date.now();
			copyRuntimeMessagesForBranch(parent, created, forkHistory);
			sessionEntries.set(branchId, created);
			onStateChanged?.();
			return {
				...buildSessionSummary(created),
				inheritedMessages: forkHistory.length,
			};
		},
		spawnSubagent: async (params) => {
			return await dispatchSubagentRun(params);
		},
		subagents: async (params) => {
			const action = (asString(params?.action) ?? "list").toLowerCase();
			const parentSessionId = asString(params?.parentSessionId);
			if (!parentSessionId) {
				throw new Error("parentSessionId is required");
			}
			switch (action) {
				case "list": {
					const children = listSubagentEntries(sessionEntries.values(), parentSessionId);
					return {
						parentSessionId,
						subagents: children.map((entry) => ({
							...buildSessionSummary(entry),
							sessionId: entry.id,
							latestRunId: entry.subagentMeta?.latestRunId,
							latestRunStatus: entry.subagentMeta?.latestRunStatus ?? "idle",
							label: entry.subagentMeta?.label,
							runtime: entry.subagentMeta?.runtime ?? "subagent",
							mode: entry.subagentMeta?.mode ?? "run",
							cleanup: entry.subagentMeta?.cleanup ?? "keep",
							thread: entry.subagentMeta?.thread ?? false,
							latestResponsePreview: entry.subagentMeta?.latestResponsePreview,
							latestError: entry.subagentMeta?.latestError,
						})),
					};
				}
				case "wait": {
					if (!waitForRun) {
						throw new Error("waitForRun is not configured");
					}
					const target = requireSubagentEntry(parentSessionId, asString(params?.target));
					const latestRunId = target.subagentMeta?.latestRunId;
					if (!latestRunId) {
						return {
							status: target.subagentMeta?.latestRunStatus ?? "idle",
							parentSessionId,
							childSessionId: target.id,
							sessionId: target.id,
						};
					}
					const result = await waitForRun({
						runId: latestRunId,
						sessionId: target.id,
						timeoutMs: Math.max(0, asNumber(params?.timeoutMs) ?? 30_000),
					});
					const status = asString(result.status);
					if (target.subagentMeta && status === "ok") {
						target.subagentMeta = markSubagentRunCompleted(target.subagentMeta, {
							runId: latestRunId,
							response: asString(result.response) ?? "",
						});
						touchSession(target, target.subagentMeta.updatedAt);
						onStateChanged?.();
					} else if (target.subagentMeta && status === "error") {
						target.subagentMeta = markSubagentRunFailed(target.subagentMeta, {
							runId: latestRunId,
							error: asString(result.error) ?? "Subagent run failed",
						});
						touchSession(target, target.subagentMeta.updatedAt);
						onStateChanged?.();
					}
					const cleanedUp =
						(status === "ok" || status === "error") &&
						maybeCleanupSubagentEntry(target);
					return {
						...result,
						parentSessionId,
						childSessionId: target.id,
						sessionId: target.id,
						cleanedUp,
					};
				}
				case "kill": {
					const target = requireSubagentEntry(parentSessionId, asString(params?.target));
					const aborted = await abortSessionEntry(target);
					if (target.subagentMeta) {
						target.subagentMeta = markSubagentRunFailed(target.subagentMeta, {
							runId: target.subagentMeta.latestRunId,
							error: aborted ? "Subagent aborted" : "Subagent abort is not supported by this runtime",
							aborted,
						});
						touchSession(target, target.subagentMeta.updatedAt);
					}
					const cleanedUp = aborted && maybeCleanupSubagentEntry(target);
					onStateChanged?.();
					return {
						aborted,
						parentSessionId,
						childSessionId: target.id,
						sessionId: target.id,
						cleanedUp,
					};
				}
				case "steer": {
					const target = requireSubagentEntry(parentSessionId, asString(params?.target));
					const message = asString(params?.message);
					if (!message) {
						throw new Error("message is required for steer");
					}
					const turn = await dispatchPromptTurn({
						entry: target,
						userText: message,
						effectiveText: message,
						channelId: target.channelId,
						waitForCompletion: false,
					});
					return {
						status: turn.status,
						parentSessionId,
						childSessionId: target.id,
						sessionId: target.id,
						runId: turn.runId,
					};
				}
				default:
					throw new Error(`Unknown subagents action: ${action}`);
			}
		},
		abort: async (params) => {
			const sessionId = asString(params?.sessionId);
			if (sessionId) {
				const entry = sessionEntries.get(sessionId);
				if (!entry) {
					throw new Error(`Session not found: ${sessionId}`);
				}
				const aborted = await abortSessionEntry(entry);
				return {
					aborted,
					sessionId,
					active: inFlightSessionIds.has(sessionId),
				};
			}

			const targets = Array.from(inFlightSessionIds)
				.map((id) => sessionEntries.get(id))
				.filter((entry): entry is SessionEntry => Boolean(entry));

			let abortedCount = 0;
			const abortedSessionIds: string[] = [];
			for (const entry of targets) {
				const aborted = await abortSessionEntry(entry);
				if (aborted) {
					abortedCount += 1;
					abortedSessionIds.push(entry.id);
				}
			}
			return {
				aborted: abortedCount > 0,
				abortedCount,
				sessionIds: abortedSessionIds,
				inFlight: inFlightSessionIds.size,
			};
		},
	};

	return {
		chatHandler,
		sessionHandlers,
	};
}
