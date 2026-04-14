import {
	AuthManager,
	appendPersistedWorkflowCrystallizationTurnFromRun,
	buildTaughtTaskDraftPromptContent,
	buildSkillsSection,
	buildWorkspaceSkillSnapshot,
	buildSessionResetPrompt,
	lintTaughtTaskDraft,
	listPlaybookRuns,
	loadPlaybookRun,
	loadPersistedWorkflowCrystallizationLedger,
	loadPersistedTaughtTaskDraftLedger,
	normalizeAssistantDisplayText,
	normalizeTaughtTaskToolArguments,
	publishWorkflowCrystallizedSkill,
	replaceWorkflowCrystallizationClusters,
	replaceWorkflowCrystallizationDayEpisodes,
	replaceWorkflowCrystallizationDaySegments,
	replaceWorkflowCrystallizationSkills,
	resolveUnderstudyHomeDir,
	stripInlineDirectiveTagsForDisplay,
	updatePersistedWorkflowCrystallizationLedger,
	withTimeout,
	extractTaughtTaskToolArgumentsFromRecord,
	type PlaybookRunInputValue,
	type PlaybookRunRecord,
	type TaughtTaskDraftParameter,
	type TaughtTaskCard,
	type TaughtTaskDraft,
	type TaughtTaskDraftStep,
	type TaughtTaskExecutionPolicy,
	type TaughtTaskExecutionRoute,
	type TaughtTaskKind,
	type TaughtTaskProcedureStep,
	type TaughtTaskSkillDependency,
	type TaughtTaskStepRouteOption,
	type UsageTracker,
	type WorkflowCrystallizationCluster,
	type WorkflowCrystallizationCompletion,
	type WorkflowCrystallizationEpisode,
	type WorkflowCrystallizationLedger,
	type WorkflowCrystallizationRouteOption,
	type WorkflowCrystallizationSegment,
	type WorkflowCrystallizationSkill,
	type WorkflowCrystallizationSkillStage,
	type WorkflowCrystallizationStatusCounts,
	type WorkflowCrystallizationToolStep,
	type WorkflowCrystallizationTurn,
} from "@understudy/core";
import {
	createMacosDemonstrationRecorder,
	type GuiDemonstrationRecorder,
	type GuiDemonstrationRecordingSession,
} from "@understudy/gui";
import { getModel, type ImageContent, type Model } from "@mariozechner/pi-ai";
import type { TeachCapabilitySnapshot } from "@understudy/tools";
import { buildTeachCapabilitySnapshot, extractJsonObject, formatTeachCapabilitySnapshotForPrompt } from "@understudy/tools";
import type { Attachment, UnderstudyConfig } from "@understudy/types";
import { createHash, randomUUID } from "node:crypto";
import { basename, join, resolve } from "node:path";
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
	type SubagentMode,
	type SubagentSessionMeta,
} from "./subagent-registry.js";
import {
	resolveSubagentSpawnPlan,
	type ResolvedSubagentAgentTarget,
	type SpawnSubagentParams,
} from "./subagent-spawn-plan.js";
import { createGatewayTaskDraftHandlers } from "./task-drafts.js";
import {
	buildTeachClarificationReport,
	buildTeachReport,
	formatTeachClockTime,
	formatTeachDuration,
	loadTeachSkillPreview,
	summarizeTeachChecks,
	summarizeTeachDraft,
	summarizeTeachKeyframes,
	summarizeTeachList,
	summarizeTeachSkill,
	summarizeTeachValidation,
} from "./teach-formatters.js";
import { asBoolean, asNumber, asRecord, asString, normalizeComparableText, sanitizePathSegment } from "./value-coerce.js";
import { mergeUnderstudyConfigOverride } from "./channel-policy.js";
import {
	completePlaybookStage,
	resumePlaybookRun,
	runPlaybookNextStage,
	startPlaybookRun,
} from "./playbook-runtime.js";
import {
	type TeachClarificationExecutionPolicy,
	type TeachClarificationPayload,
	type TeachClarificationState,
	type TeachDraftValidationResult,
	type TeachSlashCommand,
	asStringList,
	buildTeachGuiReferencePathLines,
	DEFAULT_TEACH_CLARIFY_TIMEOUT_MS,
	DEFAULT_TEACH_VALIDATE_TIMEOUT_MS,
	draftExpectsMutatingReplay,
	formatTeachExecutionRouteOrder,
	formatTeachRouteOptionTarget,
	isTeachTextRegression,
	isTeachValidationMutatingTool,
	normalizeTeachArtifactKind,
	normalizeTeachExecutionPolicy,
	normalizeTeachExecutionRoute,
	normalizeTeachProcedure,
	normalizeTeachProcedureStep,
	normalizeTeachReplayHints,
	normalizeTeachRouteOptionPreference,
	normalizeTeachSkillDependencies,
	normalizeTeachStepRouteOptions,
	normalizeTeachTaskCard,
	normalizeTeachTaskKind,
	normalizeTeachTextTokens,
	normalizeTeachValidationCheck,
	normalizeTeachValidationState,
	parseTeachDraftTarget,
	preferTeachText,
	rankTeachRouteOptionPreference,
	READ_ONLY_TEACH_VALIDATION_TOOLS,
	resolveTeachConfirmValidationMode,
	resolveTeachInternalPromptTimeoutMs,
	scoreTeachReferenceStepMatch,
	summarizeTeachDraftPublishBlocker,
	trimToUndefined,
	uniqueStrings,
} from "./teach-normalization.js";
import {
	buildHistoryTimeline,
	buildRuntimeMessagesFromHistory,
	cloneValue,
	copyRuntimeMessagesForBranch,
	forkRuntimeMessages,
	normalizeActiveRunSnapshot,
	resolveWaitForCompletion,
	runSupportsHistoryChannels,
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
import {
	analyzeTeachValidationTrace,
	buildTeachClarificationPrompt,
	buildTeachControlNoisePatch,
	buildTeachDraftValidationPreflight,
	buildTeachDraftValidationPrompt,
	defaultTeachClarificationQuestion,
	defaultTeachDraftValidator,
	inferTeachTaskCardFromDraft,
	normalizeTeachClarificationPayload,
	resolveTeachClarificationQuestion,
	resolveTeachTaskCard,
	summarizeTeachStepForPrompt,
	TEACH_STEP_TOOL_ARG_RESERVED_KEYS,
} from "./teach-prompts.js";

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


function resolveDemonstrationOutputDir(entry: SessionEntry): string {
	const workspaceKey = entry.workspaceDir
		? createHash("sha1").update(resolve(entry.workspaceDir)).digest("hex").slice(0, 12)
		: "global";
	return join(
		resolveUnderstudyHomeDir(),
		"learning",
		"demonstrations",
		workspaceKey,
		sanitizePathSegment(entry.id, "session"),
	);
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

function readTeachClarificationState(entry: SessionEntry): TeachClarificationState | undefined {
	const record = asRecord(entry.sessionMeta?.teachClarification);
	const draftId = trimToUndefined(asString(record?.draftId));
	if (!draftId) {
		return undefined;
	}
	const status = asString(record?.status) === "ready" ? "ready" : "clarifying";
	return {
		draftId,
		status,
		summary: trimToUndefined(asString(record?.summary)),
		nextQuestion: trimToUndefined(asString(record?.nextQuestion)),
		pendingQuestions: asStringList(record?.pendingQuestions),
		taskCard: normalizeTeachTaskCard(asRecord(record?.taskCard)),
		excludedDemoSteps: asStringList(record?.excludedDemoSteps),
		updatedAt: asNumber(record?.updatedAt) ?? Date.now(),
	};
}

function writeTeachClarificationState(entry: SessionEntry, state?: TeachClarificationState): void {
	if (!state) {
		if (entry.sessionMeta && typeof entry.sessionMeta === "object") {
			const nextMeta = { ...entry.sessionMeta };
			delete nextMeta.teachClarification;
			entry.sessionMeta = Object.keys(nextMeta).length > 0 ? nextMeta : undefined;
		}
		return;
	}
	entry.sessionMeta = Object.assign({}, entry.sessionMeta, {
		teachClarification: {
			draftId: state.draftId,
			status: state.status,
			summary: state.summary,
			nextQuestion: state.nextQuestion,
			pendingQuestions: state.pendingQuestions,
			taskCard: state.taskCard,
			excludedDemoSteps: state.excludedDemoSteps,
			updatedAt: state.updatedAt,
		},
	});
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
	const activeTeachRecordings = new Map<string, GuiDemonstrationRecordingSession>();
	const activeTeachClarificationSessions = new Set<string>();
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
	}): Promise<Awaited<ReturnType<CreateGatewaySessionRuntimeParams["promptSession"]>>> => {
		const internalEntry = await createTeachInternalSession(params.entry, params.kind, {
			allowedToolNames: params.allowedToolNames,
			extraSystemPrompt: params.extraSystemPrompt,
			thinkingLevel: params.thinkingLevel,
		});
		const timeoutMs = params.timeoutMs ?? resolveTeachInternalPromptTimeoutMs(params.kind);
		const runPrompt = async (
			promptText: string,
			remainingBudgetMs: number,
		): Promise<Awaited<ReturnType<CreateGatewaySessionRuntimeParams["promptSession"]>>> =>
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
	}): Promise<Awaited<ReturnType<CreateGatewaySessionRuntimeParams["promptSession"]>>> => {
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

	const startTeachRecording = async (entry: SessionEntry, params?: Record<string, unknown>) => {
		if (!entry.workspaceDir) {
			throw new Error(`Session ${entry.id} is not bound to a workspace`);
		}
		const existing = activeTeachRecordings.get(entry.id);
		if (existing) {
			return {
				sessionId: entry.id,
				recording: existing.status(),
				alreadyActive: true,
			};
		}
		const recording = await demonstrationRecorder.start({
			outputDir: resolveDemonstrationOutputDir(entry),
			filePrefix: `session-${sanitizePathSegment(entry.id, "session")}-${Date.now()}`,
			displayIndex: Math.max(1, asNumber(params?.displayIndex) ?? 1),
			showClicks: asBoolean(params?.showClicks) !== false,
			captureAudio: asBoolean(params?.captureAudio) === true,
			maxDurationSec: asNumber(params?.maxDurationSec),
			app: asString(params?.app),
		});
		activeTeachRecordings.set(entry.id, recording);
		onStateChanged?.();
		return {
			sessionId: entry.id,
			recording: recording.status(),
			alreadyActive: false,
		};
	};

	const validateTeachDraftForEntry = async (entry: SessionEntry, draft: TaughtTaskDraft) => {
		const preflight = buildTeachDraftValidationPreflight(draft);
		if (preflight) {
			return preflight;
		}
		try {
			const timeoutMs = resolveTeachInternalPromptTimeoutMs("validate");
			const result = await validateTeachDraft({
				entry,
				draft,
				promptSession: async (_entry, text, _runId, _promptOptions) =>
					await runTeachValidationReplayPrompt({
						entry,
						prompt: text,
						timeoutMs,
					}),
				});
			const visibleResponse = normalizeAssistantDisplayText(result.response ?? "").text;
			if (result.runId) {
				const runTrace = storeSessionRunTrace(entry, {
					runId: result.runId,
					userPrompt: buildTeachDraftValidationPrompt(draft),
					response: visibleResponse,
					meta: result.meta,
				});
				if (persistSessionRunTrace) {
					await persistSessionRunTrace({
						sessionId: entry.id,
						trace: runTrace,
					});
				}
			}
			seedRuntimeMessagesFromHistory(entry, entry.history);
			onStateChanged?.();
			return {
				...result,
				response: visibleResponse,
			};
		} catch (error) {
			seedRuntimeMessagesFromHistory(entry, entry.history);
			const summary = error instanceof Error ? error.message : String(error);
			return {
				state: "failed" as const,
				summary: `Teach validation failed: ${summary}`,
				checks: [
					{
						id: "teach-validation:exception",
						ok: false,
						summary: `Teach validation failed: ${summary}`,
						source: "replay" as const,
					},
				],
				mode: "replay" as const,
				usedMutatingTools: false,
				toolNames: [],
				mutatingToolNames: [],
			};
		}
	};

	const updateTeachDraftValidation = async (entry: SessionEntry, draft: TaughtTaskDraft, validation: TeachDraftValidationResult) => {
		const updated = await taskDraftHandlers.update({
			sessionId: entry.id,
			draftId: draft.id,
			patch: {
				validation: {
					state: validation.state,
					summary: validation.summary,
					runId: validation.runId,
					responsePreview: trimToUndefined(validation.response?.slice(0, TRACE_VALUE_PREVIEW_CHARS)),
					checks: validation.checks,
					mode: validation.mode,
					usedMutatingTools: validation.usedMutatingTools,
					toolNames: validation.toolNames,
					mutatingToolNames: validation.mutatingToolNames,
				},
			},
			action: "validated",
			note: validation.summary,
		});
		await refreshTeachDraftPrompts(entry);
		return updated;
	};

	const persistInternalTeachPromptRun = async (params: {
		entry: SessionEntry;
		userPrompt: string;
		result: Awaited<ReturnType<CreateGatewaySessionRuntimeParams["promptSession"]>>;
	}): Promise<string> => {
		const visibleResponse = normalizeAssistantDisplayText(params.result.response ?? "").text;
		if (params.result.runId) {
			const runTrace = storeSessionRunTrace(params.entry, {
				runId: params.result.runId,
				userPrompt: params.userPrompt,
				response: visibleResponse,
				meta: params.result.meta,
			});
			if (persistSessionRunTrace) {
				await persistSessionRunTrace({
					sessionId: params.entry.id,
					trace: runTrace,
				});
			}
		}
		seedRuntimeMessagesFromHistory(params.entry, params.entry.history);
		onStateChanged?.();
		return visibleResponse;
	};

	const clearTeachClarificationForDraft = (entry: SessionEntry, draftId?: string): boolean => {
		if (!draftId) {
			return false;
		}
		const activeClarification = readTeachClarificationState(entry);
		if (activeClarification?.draftId !== draftId) {
			return false;
		}
		writeTeachClarificationState(entry, undefined);
		onStateChanged?.();
		return true;
	};

	const startTeachRecordingFromCommand = async (entry: SessionEntry, params?: Record<string, unknown>) => {
		const hadClarification = Boolean(readTeachClarificationState(entry));
		writeTeachClarificationState(entry, undefined);
		if (hadClarification) {
			onStateChanged?.();
		}
		return await startTeachRecording(entry, params);
	};

	const updateTeachDraftFromClarification = async (entry: SessionEntry, draft: TaughtTaskDraft, payload: TeachClarificationPayload, note?: string) => {
		const patch: Record<string, unknown> = {};
		const mergedTitle = preferTeachText(draft.title, payload.title);
		if (mergedTitle && mergedTitle !== draft.title) {
			patch.title = mergedTitle;
		}
		const mergedIntent = preferTeachText(draft.intent, payload.intent);
		if (mergedIntent && mergedIntent !== draft.intent) {
			patch.intent = mergedIntent;
		}
		const mergedObjective = preferTeachText(draft.objective, payload.objective);
		if (mergedObjective && mergedObjective !== draft.objective) {
			patch.objective = mergedObjective;
		}
		if (payload.artifactKind !== undefined && payload.artifactKind !== draft.artifactKind) {
			patch.artifactKind = payload.artifactKind;
		}
		if (payload.taskKind !== undefined && payload.taskKind !== draft.taskKind) {
			patch.taskKind = payload.taskKind;
		}
		if (payload.parameterSlots !== undefined && (payload.parameterSlots.length > 0 || draft.parameterSlots.length === 0)) {
			patch.parameterSlots = payload.parameterSlots.map((entry) => {
				if (typeof entry === "string") {
					return entry;
				}
				return {
					name: asString(entry.name),
					label: asString(entry.label),
					sampleValue: asString(entry.sampleValue),
					required: asBoolean(entry.required) !== false,
					notes: asString(entry.notes),
				};
			});
		}
		if (payload.successCriteria !== undefined && (payload.successCriteria.length > 0 || draft.successCriteria.length === 0)) {
			patch.successCriteria = payload.successCriteria;
		}
		if (payload.openQuestions !== undefined) {
			patch.openQuestions = payload.openQuestions;
		}
		if (payload.uncertainties !== undefined) {
			patch.uncertainties = payload.uncertainties;
		}
		if (payload.taskCard !== undefined) {
			patch.taskCard = payload.taskCard;
		}
		if (payload.skillDependencies !== undefined) {
			patch.skillDependencies = payload.skillDependencies.map((entry) => {
				if (typeof entry === "string") {
					return entry;
				}
				return {
					name: asString(entry.name),
					reason: asString(entry.reason),
					required: asBoolean(entry.required) !== false,
				};
			});
		}
		if (payload.childArtifacts !== undefined) {
			patch.childArtifacts = payload.childArtifacts.map((entry, index) => ({
				id: asString(entry.id) ?? `child-artifact-${index + 1}`,
				name: asString(entry.name),
				artifactKind: normalizeTeachArtifactKind(entry.artifactKind),
				objective: asString(entry.objective),
				required: asBoolean(entry.required) !== false,
				reason: asString(entry.reason),
			}));
		}
		if (payload.playbookStages !== undefined) {
			patch.playbookStages = payload.playbookStages.map((entry, index) => ({
				id: asString(entry.id) ?? `playbook-stage-${index + 1}`,
				name: asString(entry.name),
				kind: asString(entry.kind),
				refName: asString(entry.refName),
				objective: asString(entry.objective),
				inputs: Array.isArray(entry.inputs) ? asStringList(entry.inputs) : [],
				outputs: Array.isArray(entry.outputs) ? asStringList(entry.outputs) : [],
				budgetNotes: Array.isArray(entry.budgetNotes) ? asStringList(entry.budgetNotes) : [],
				retryPolicy: asString(entry.retryPolicy),
				approvalGate: asString(entry.approvalGate),
			}));
		}
		if (payload.workerContract !== undefined) {
			patch.workerContract = {
				goal: asString(payload.workerContract.goal),
				scope: asString(payload.workerContract.scope),
				inputs: Array.isArray(payload.workerContract.inputs) ? asStringList(payload.workerContract.inputs) : [],
				outputs: Array.isArray(payload.workerContract.outputs) ? asStringList(payload.workerContract.outputs) : [],
				allowedRoutes: Array.isArray(payload.workerContract.allowedRoutes) ? asStringList(payload.workerContract.allowedRoutes) : [],
				allowedSurfaces: Array.isArray(payload.workerContract.allowedSurfaces) ? asStringList(payload.workerContract.allowedSurfaces) : [],
				budget: asRecord(payload.workerContract.budget)
					? {
						maxMinutes: asNumber(asRecord(payload.workerContract.budget)?.maxMinutes),
						maxActions: asNumber(asRecord(payload.workerContract.budget)?.maxActions),
						maxScreenshots: asNumber(asRecord(payload.workerContract.budget)?.maxScreenshots),
					}
					: undefined,
				escalationPolicy: Array.isArray(payload.workerContract.escalationPolicy) ? asStringList(payload.workerContract.escalationPolicy) : [],
				stopConditions: Array.isArray(payload.workerContract.stopConditions) ? asStringList(payload.workerContract.stopConditions) : [],
				decisionHeuristics: Array.isArray(payload.workerContract.decisionHeuristics) ? asStringList(payload.workerContract.decisionHeuristics) : [],
			};
		}
		if (payload.procedure !== undefined) {
			patch.procedure = payload.procedure.map((entry) => {
				if (typeof entry === "string") {
					return entry;
				}
				return {
					instruction: asString(entry.instruction) ?? asString(entry.summary),
					kind: asString(entry.kind),
					skillName: asString(entry.skillName),
					notes: asString(entry.notes),
					uncertain: asBoolean(entry.uncertain) === true,
				};
			});
		}
		if (payload.executionPolicy !== undefined) {
			patch.executionPolicy = payload.executionPolicy;
		}
		if (payload.stepRouteOptions !== undefined) {
			patch.stepRouteOptions = payload.stepRouteOptions.map((entry) => ({
				id: asString(entry.id),
				procedureStepId: asString(entry.procedureStepId),
				route: asString(entry.route),
				preference: asString(entry.preference),
				instruction: asString(entry.instruction),
				toolName: asString(entry.toolName),
				skillName: asString(entry.skillName),
				when: asString(entry.when),
				notes: asString(entry.notes),
			}));
		}
		if (payload.replayPreconditions !== undefined) {
			patch.replayPreconditions = payload.replayPreconditions;
		}
		if (payload.resetSignals !== undefined) {
			patch.resetSignals = payload.resetSignals;
		}
		if (payload.steps !== undefined) {
				patch.steps = payload.steps.map((entry, index) => {
					if (typeof entry === "string") {
						return entry;
					}
					const baseStep = draft.steps[index];
				const inputs = entry.inputs && typeof entry.inputs === "object" && !Array.isArray(entry.inputs)
					? entry.inputs as Record<string, unknown>
					: undefined;
					const captureMode = asString(entry.captureMode);
					const groundingMode = asString(entry.groundingMode);
					const uncertain = asBoolean(entry.uncertain);
					const explicitToolArgs = normalizeTaughtTaskToolArguments(entry.toolArgs);
					const implicitToolArgs = extractTaughtTaskToolArgumentsFromRecord(entry, TEACH_STEP_TOOL_ARG_RESERVED_KEYS);
					return {
						route: asString(entry.route) ?? baseStep?.route,
						toolName: asString(entry.toolName) ?? baseStep?.toolName,
					instruction: asString(entry.instruction) ?? asString(entry.summary) ?? baseStep?.instruction,
					summary: asString(entry.summary) ?? baseStep?.summary,
					target: asString(entry.target) ?? baseStep?.target,
					app: asString(entry.app) ?? baseStep?.app,
					scope: asString(entry.scope) ?? baseStep?.scope,
					inputs: inputs
						? Object.fromEntries(
							Object.entries(inputs)
								.map(([key, value]) => [key, asString(value)])
								.filter((pair): pair is [string, string] => Boolean(pair[1])),
						)
						: baseStep?.inputs,
						locationHint: asString(entry.locationHint) ?? baseStep?.locationHint,
						windowTitle: asString(entry.windowTitle) ?? baseStep?.windowTitle,
						toolArgs: explicitToolArgs || implicitToolArgs
							? {
								...implicitToolArgs,
								...explicitToolArgs,
							}
							: baseStep?.toolArgs,
						captureMode: captureMode === "window" || captureMode === "display"
							? captureMode
							: baseStep?.captureMode,
					groundingMode: groundingMode === "single" || groundingMode === "complex"
						? groundingMode
						: baseStep?.groundingMode,
					verificationStatus: asString(entry.verificationStatus) ?? baseStep?.verificationStatus,
					verificationSummary: asString(entry.verificationSummary) ?? baseStep?.verificationSummary,
					uncertain: uncertain === undefined ? baseStep?.uncertain === true : uncertain === true,
				};
			});
		}
		if (Object.keys(patch).length === 0) {
			return draft;
		}
		const updated = await taskDraftHandlers.update({
			sessionId: entry.id,
			draftId: draft.id,
			patch,
			action: "corrected",
			note: note ?? payload.summary,
		});
		await refreshTeachDraftPrompts(entry);
		return updated;
	};

	const applyTeachControlNoisePatch = async (entry: SessionEntry, draft: TaughtTaskDraft) => {
		const noisePatch = buildTeachControlNoisePatch(draft);
		const hasPatch = noisePatch.steps || noisePatch.successCriteria || noisePatch.openQuestions || noisePatch.uncertainties;
		if (!hasPatch) {
			return {
				draft,
				excludedDemoSteps: noisePatch.excludedDemoSteps,
			};
		}
		const updated = await taskDraftHandlers.update({
			sessionId: entry.id,
			draftId: draft.id,
			patch: {
				...(noisePatch.steps ? { steps: noisePatch.steps } : {}),
				...(noisePatch.successCriteria ? { successCriteria: noisePatch.successCriteria } : {}),
				...(noisePatch.openQuestions ? { openQuestions: noisePatch.openQuestions } : {}),
				...(noisePatch.uncertainties ? { uncertainties: noisePatch.uncertainties } : {}),
			},
			action: "corrected",
			note: "Removed demo-only recording control steps from the initial teach draft.",
		});
		return {
			draft: updated,
			excludedDemoSteps: noisePatch.excludedDemoSteps,
		};
	};

	const runTeachClarificationPass = async (params: {
		entry: SessionEntry;
		draft: TaughtTaskDraft;
		userReply?: string;
		state?: TeachClarificationState;
		excludedDemoSteps?: string[];
	}): Promise<{ draft: TaughtTaskDraft; state: TeachClarificationState }> => {
		const prompt = buildTeachClarificationPrompt({
			draft: params.draft,
			userReply: params.userReply,
			state: params.state,
			capabilitySnapshot: resolveTeachCapabilitySnapshot(params.entry.workspaceDir),
		});
		try {
			const result = await runTeachInternalPrompt({
				entry: params.entry,
				kind: "clarify",
				prompt,
			});
			const visibleResponse = await persistInternalTeachPromptRun({
				entry: params.entry,
				userPrompt: prompt,
				result,
			});
			const initialPayload = normalizeTeachClarificationPayload(extractJsonObject(visibleResponse));
			const payload = initialPayload;
			const readyForConfirmation = payload.readyForConfirmation === true;
			const updatedDraft = await updateTeachDraftFromClarification(
				params.entry,
				params.draft,
				readyForConfirmation
					? {
						...payload,
						openQuestions: payload.openQuestions ?? [],
						uncertainties: payload.uncertainties ?? [],
						steps: payload.steps ?? params.draft.steps.map((step) => ({
							route: step.route,
							toolName: step.toolName,
							instruction: step.instruction,
							summary: step.summary,
							target: step.target,
							app: step.app,
							scope: step.scope,
							inputs: step.inputs,
							toolArgs: step.toolArgs,
							locationHint: step.locationHint,
							windowTitle: step.windowTitle,
							captureMode: step.captureMode,
							groundingMode: step.groundingMode,
							verificationSummary: step.verificationSummary,
							uncertain: false,
						})),
					}
					: payload,
				payload.summary ?? (params.userReply ? "Updated teach task card from user clarification." : "Prepared the initial teach task card for clarification."),
			);
			const taskCard = resolveTeachTaskCard({
				draft: updatedDraft,
				payload,
				previous: params.state?.taskCard,
			});
			const blocker = summarizeTeachDraftPublishBlocker(updatedDraft);
			const pendingQuestions = uniqueStrings([
				...updatedDraft.openQuestions,
				...updatedDraft.uncertainties,
			]);
			const status = blocker ? "clarifying" : "ready";
			const nextQuestion = status === "clarifying"
				? resolveTeachClarificationQuestion({
					draft: updatedDraft,
					preferred: payload.nextQuestion,
				}) ?? defaultTeachClarificationQuestion(updatedDraft)
				: undefined;
			return {
				draft: updatedDraft,
				state: {
					draftId: updatedDraft.id,
					status,
					summary: payload.summary
						?? (status === "ready"
							? "Task card looks coherent and is ready for confirmation."
							: pendingQuestions.length > 1
								? `Task card updated. ${pendingQuestions.length} clarification questions remain.`
								: "Task card updated. One clarification question remains."),
					nextQuestion,
					pendingQuestions,
					taskCard,
					excludedDemoSteps: [...(params.excludedDemoSteps ?? params.state?.excludedDemoSteps ?? []), ...(payload.excludedDemoSteps ?? [])],
					updatedAt: Date.now(),
				},
			};
		} catch (error) {
			seedRuntimeMessagesFromHistory(params.entry, params.entry.history);
			const fallbackQuestion = resolveTeachClarificationQuestion({
				draft: params.draft,
				preferred: params.state?.nextQuestion,
			}) ?? defaultTeachClarificationQuestion(params.draft);
			const fallbackPendingQuestions = uniqueStrings([
				...params.draft.openQuestions,
				...params.draft.uncertainties,
			]);
			return {
				draft: params.draft,
				state: {
					draftId: params.draft.id,
					status: "clarifying",
					summary: `Teach clarification model could not refine the task card automatically: ${error instanceof Error ? error.message : String(error)}`,
					nextQuestion: fallbackQuestion ?? params.state?.nextQuestion,
					pendingQuestions: fallbackPendingQuestions,
					taskCard: params.state?.taskCard ?? inferTeachTaskCardFromDraft(params.draft),
					excludedDemoSteps: params.state?.excludedDemoSteps ?? params.excludedDemoSteps ?? [],
					updatedAt: Date.now(),
				},
			};
		}
	};

	const bootstrapTeachClarification = async (entry: SessionEntry, draft: TaughtTaskDraft) => {
		const primed = await applyTeachControlNoisePatch(entry, draft);
		return await runTeachClarificationPass({
			entry,
			draft: primed.draft,
			excludedDemoSteps: primed.excludedDemoSteps,
		});
	};

	const confirmTeachClarification = async (params: {
		entry: SessionEntry;
		userText: string;
		state: TeachClarificationState;
		draft: TaughtTaskDraft;
		validateAfterConfirm: boolean;
	}): Promise<RunTurnResult> => {
		const blocker = summarizeTeachDraftPublishBlocker(params.draft);
		if (blocker) {
			const pendingQuestions = uniqueStrings([
				...params.draft.openQuestions,
				...params.draft.uncertainties,
			]);
			const nextQuestion = resolveTeachClarificationQuestion({
				draft: params.draft,
				preferred: params.state.nextQuestion,
			}) ?? defaultTeachClarificationQuestion(params.draft);
			const nextState: TeachClarificationState = {
				...params.state,
				status: "clarifying",
				summary: blocker,
				nextQuestion,
				pendingQuestions,
				updatedAt: Date.now(),
			};
			writeTeachClarificationState(params.entry, nextState);
			onStateChanged?.();
			const assistantText = await buildTeachClarificationReport({
				headline: `Draft \`${params.draft.id}\` still needs clarification before replay validation can run.`,
				draft: {},
				state: nextState,
				includeDraftSnapshot: false,
				nextSteps: [
					"Reply in plain language to answer the next question or refine the task card.",
					"Run `/teach confirm` once the task card is complete.",
				],
			});
			return buildDirectSessionResponse({
				entry: params.entry,
				userText: params.userText,
				assistantText,
				meta: {
					directCommand: "teach_confirm",
					draft: params.draft,
					teachClarification: nextState,
				},
			});
		}
		if (!params.validateAfterConfirm) {
			writeTeachClarificationState(params.entry, undefined);
			onStateChanged?.();
			const assistantText = await buildTeachReport({
				headline: `Task card confirmed for draft \`${params.draft.id}\`. Replay validation was skipped.`,
				draft: params.draft as unknown as Record<string, unknown>,
				nextSteps: [
					`Publish it with \`/teach publish ${params.draft.id} [skill-name]\` whenever you're ready.`,
					`Run \`/teach validate ${params.draft.id}\` anytime if you want replay validation first.`,
				],
			});
			return buildDirectSessionResponse({
				entry: params.entry,
				userText: params.userText,
				assistantText,
				meta: {
					directCommand: "teach_confirm",
					draft: params.draft,
					validationSkipped: true,
				},
			});
		}
		const validation = await validateTeachDraftForEntry(params.entry, params.draft);
		const updated = await updateTeachDraftValidation(params.entry, params.draft, validation);
		writeTeachClarificationState(params.entry, undefined);
		onStateChanged?.();
		const assistantText = await buildTeachReport({
			headline: validation.state === "validated"
				? `Task card confirmed for draft \`${updated.id}\`, and replay validation passed.`
				: validation.state === "requires_reset"
					? `Task card confirmed for draft \`${updated.id}\`, but replay validation still needs a reset-aware check.`
					: validation.state === "unvalidated"
						? `Task card confirmed for draft \`${updated.id}\`, but it still needs review before replay validation can run.`
						: `Task card confirmed for draft \`${updated.id}\`, but replay validation failed.`,
			draft: updated as unknown as Record<string, unknown>,
			validation,
			nextSteps: validation.state === "validated"
				? [`Publish it with \`/teach publish ${updated.id} [skill-name]\`.`]
				: validation.state === "requires_reset"
					? [`Reset the workspace state, then rerun \`/teach validate ${updated.id}\`.`]
					: validation.state === "unvalidated"
						? ["Keep refining the draft and answer any remaining open questions, then validate again."]
						: [`Inspect the validation output, correct the task card, then rerun \`/teach validate ${updated.id}\`.`],
		});
		return buildDirectSessionResponse({
			entry: params.entry,
			userText: params.userText,
			assistantText,
			meta: {
				directCommand: "teach_confirm",
				draft: updated,
				validation,
			},
		});
	};

	const validateExistingTeachDraft = async (entry: SessionEntry, params?: Record<string, unknown>) => {
		const draftId = asString(params?.draftId);
		if (!draftId) {
			throw new Error("draftId is required");
		}
		const draft = await taskDraftHandlers.get({
			sessionId: entry.id,
			draftId,
		});
		if (!draft) {
			throw new Error(`Teach draft not found: ${draftId}`);
		}
		const validation = await validateTeachDraftForEntry(entry, draft);
		const updated = await updateTeachDraftValidation(entry, draft, validation);
		return {
			sessionId: entry.id,
			draft: updated,
			validation,
		};
	};

	const publishExistingTeachDraft = async (entry: SessionEntry, params?: Record<string, unknown>) => {
		const draftId = asString(params?.draftId);
		if (!draftId) {
			throw new Error("draftId is required");
		}
		const published = await taskDraftHandlers.publish({
			sessionId: entry.id,
			draftId,
			name: asString(params?.name),
			runId: asString(params?.runId),
		});
		await refreshTeachDraftPrompts(entry);
		const promptRefreshError = await refreshPublishedSkillPrompts(entry, published);
		return {
			...published,
			...(promptRefreshError ? { promptRefreshError } : {}),
		};
	};

	const stopTeachRecording = async (entry: SessionEntry, params?: Record<string, unknown>) => {
		if (!entry.workspaceDir) {
			throw new Error(`Session ${entry.id} is not bound to a workspace`);
		}
		const active = activeTeachRecordings.get(entry.id);
		if (!active) {
			throw new Error(`No active teach recording for session ${entry.id}`);
		}
		activeTeachRecordings.delete(entry.id);
		let recording: Awaited<ReturnType<GuiDemonstrationRecordingSession["stop"]>>;
		try {
			recording = await active.stop();
		} finally {
			onStateChanged?.();
		}
		if (asBoolean(params?.analyze) === false) {
			return {
				sessionId: entry.id,
				recording,
			};
		}
		try {
			const result = await taskDraftHandlers.createFromVideo({
				...params,
				sessionId: entry.id,
				videoPath: recording.videoPath,
				eventLogPath: recording.eventLogPath,
				videoName: recording.videoPath ? basename(recording.videoPath) : undefined,
				publish: false,
			});
			const shouldValidate = asBoolean(params?.validate) !== false;
			const shouldPublish = asBoolean(params?.publish) !== false;
			let draft = result.draft;
			await refreshTeachDraftPrompts(entry);
			let validation: TeachDraftValidationResult | undefined;
			if (shouldValidate) {
				validation = await validateTeachDraftForEntry(entry, draft);
				draft = await updateTeachDraftValidation(entry, draft, validation);
			}
			if (shouldPublish && validation?.state === "validated") {
				const published = await publishExistingTeachDraft(entry, {
					draftId: draft.id,
					name: asString(params?.name),
				});
				draft = published.draft;
			}
			return {
				sessionId: entry.id,
				recording,
				draft,
				...(validation ? { validation } : {}),
			};
		} catch (error) {
			return {
				sessionId: entry.id,
				recording,
				analysisError: error instanceof Error ? error.message : String(error),
			};
		}
	};

	const stopTeachRecordingFromCommand = async (entry: SessionEntry, params?: Record<string, unknown>) => {
		const result = await stopTeachRecording(entry, {
			...params,
			publish: false,
			validate: false,
		});
		const stopResult = result as Record<string, unknown>;
		const analysisError = asString(stopResult.analysisError);
		let draftRecord = asRecord(stopResult.draft);
		let clarificationState: TeachClarificationState | undefined;
		if (!analysisError && draftRecord?.id) {
			const draft = await taskDraftHandlers.get({
				sessionId: entry.id,
				draftId: asString(draftRecord.id),
			});
			if (draft) {
				const clarified = await bootstrapTeachClarification(entry, draft);
				writeTeachClarificationState(entry, clarified.state);
				onStateChanged?.();
				draftRecord = clarified.draft as unknown as Record<string, unknown>;
				clarificationState = clarified.state;
			}
		}
		return {
			sessionId: entry.id,
			recording: stopResult.recording,
			...(draftRecord ? { draft: draftRecord } : {}),
			...(clarificationState ? { teachClarification: clarificationState } : {}),
			...(stopResult.analysisError ? { analysisError: stopResult.analysisError } : {}),
		};
	};

	const handleTeachClarificationTurn = async (entry: SessionEntry, userText: string): Promise<RunTurnResult | undefined> => {
		const state = readTeachClarificationState(entry);
		if (!state) {
			return undefined;
		}
		if (activeTeachClarificationSessions.has(entry.id)) {
			return buildEphemeralSessionResponse({
				entry,
				assistantText: "Teach clarification is still processing. Wait for the current reply before sending another refinement.",
				meta: {
					directCommand: "teach_clarify",
					status: "busy",
					teachClarification: state,
				},
			});
		}
		activeTeachClarificationSessions.add(entry.id);
		try {
			const draft = await taskDraftHandlers.get({
				sessionId: entry.id,
				draftId: state.draftId,
			});
			if (!draft) {
				writeTeachClarificationState(entry, undefined);
				onStateChanged?.();
				return buildDirectSessionResponse({
					entry,
					userText,
					assistantText: "The active teach clarification draft could not be found, so clarification mode was cleared.",
					meta: {
						directCommand: "teach_clarify",
						status: "error",
					},
				});
			}

			const clarified = await runTeachClarificationPass({
				entry,
				draft,
				userReply: userText,
				state,
			});
			writeTeachClarificationState(entry, clarified.state);
			onStateChanged?.();
			const assistantText = await buildTeachClarificationReport({
				headline: `Updated teach task card for draft \`${clarified.draft.id}\`.`,
				draft: clarified.draft as unknown as Record<string, unknown>,
				state: clarified.state,
				nextSteps: clarified.state.status === "ready"
					? [
						"Run `/teach confirm` to lock the task card without replay validation.",
						`Run \`/teach confirm --validate\` or \`/teach validate ${clarified.draft.id}\` when you want replay validation.`,
					]
					: [
						"Reply in plain language to refine the task card.",
						"Run `/teach confirm` once the task card looks right.",
					],
			});
			return buildDirectSessionResponse({
				entry,
				userText,
				assistantText,
				meta: {
					directCommand: "teach_clarify",
					draft: clarified.draft,
					teachClarification: clarified.state,
				},
			});
		} finally {
			activeTeachClarificationSessions.delete(entry.id);
		}
	};

	const buildTeachHelpReport = async (entry: SessionEntry, trailing?: string): Promise<string> => {
		const lines: string[] = ["Teach status:"];
		const recording = activeTeachRecordings.get(entry.id);
		const clarification = readTeachClarificationState(entry);
		const clarificationDraft = clarification
			? await taskDraftHandlers.get({
				sessionId: entry.id,
				draftId: clarification.draftId,
			}).catch(() => null)
			: null;
		const draftValidation = asRecord(clarificationDraft?.validation);
		lines.push(`- Workspace: ${entry.workspaceDir ?? "not bound"}`);
		lines.push(`- Recording: ${recording ? "active" : "idle"}`);
		if (clarification) {
			lines.push(`- Clarification: ${clarification.status} for draft \`${clarification.draftId}\``);
			if (clarification.summary) {
				lines.push(`- Task summary: ${clarification.summary}`);
			}
			if (clarification.pendingQuestions && clarification.pendingQuestions.length > 0) {
				lines.push("- Pending questions:");
				lines.push(...summarizeTeachList(clarification.pendingQuestions, "- ", 5));
			} else if (clarification.nextQuestion) {
				lines.push(`- Next question: ${clarification.nextQuestion}`);
			}
			if (draftValidation?.state) {
				lines.push(`- Validation: ${String(draftValidation.state)}`);
			}
		} else {
			lines.push("- Clarification: inactive");
		}
		if (trimToUndefined(trailing)) {
			lines.push(`- Note: \`${trailing}\` is not a teach subcommand. Use one of the commands below.`);
		}
		lines.push("");
		lines.push("Available commands:");
		lines.push("- `/teach start` to begin recording a demonstration.");
		lines.push("- `/teach stop [objective]` to stop recording and open clarification.");
		lines.push("- Reply in plain language while clarification is active to refine the task card.");
		lines.push("- `/teach confirm [--validate]` to lock the task card. Add `--validate` to trigger replay validation immediately.");
		lines.push("- `/teach validate <draftId>` to rerun validation.");
		lines.push("- `/teach publish <draftId> [skill-name]` to publish a reusable skill.");
		lines.push("");
		if (recording) {
			lines.push("Next step: finish the demo, then run `/teach stop [objective]`.");
		} else if (clarification?.status === "ready") {
			lines.push(`Next step: run \`/teach confirm\` to lock the task card, then publish with \`/teach publish ${clarification.draftId} [skill-name]\`. Optional: use \`/teach confirm --validate\` or \`/teach validate ${clarification.draftId}\` first.`);
		} else if (clarification) {
			lines.push("Next step: answer the pending clarification in plain language.");
		} else {
			lines.push("Next step: run `/teach start` when you are ready to demonstrate the task.");
		}
		return lines.join("\n");
	};

	const runTeachSlashCommand = async (params: {
		entry: SessionEntry;
		command: TeachSlashCommand;
		rawText: string;
	}): Promise<RunTurnResult> => {
		sessionEntries.set(params.entry.id, params.entry);
		if (!params.entry.workspaceDir) {
			return buildDirectSessionResponse({
				entry: params.entry,
				userText: params.rawText,
				assistantText: "Teach recording requires a workspace-bound session because learned drafts and skills are stored per workspace.",
				meta: {
					directCommand: "teach",
					status: "error",
				},
			});
		}
		if (params.command.action === "help") {
			return buildDirectSessionResponse({
				entry: params.entry,
				userText: params.rawText,
				assistantText: await buildTeachHelpReport(params.entry, params.command.trailing),
				meta: {
					directCommand: "teach_help",
					...(readTeachClarificationState(params.entry)
						? { teachClarification: readTeachClarificationState(params.entry) }
						: {}),
					...(activeTeachRecordings.has(params.entry.id) ? { recordingActive: true } : {}),
				},
			});
		}
		if (params.command.action === "start") {
			const result = await startTeachRecordingFromCommand(params.entry, {});
			const state = asRecord(result.recording);
			const assistantText = await buildTeachReport({
				headline: result.alreadyActive
					? "Teach recording is already running for this session."
					: "Started teach recording for this workspace session.",
				recording: state,
				nextSteps: [
					"Demonstrate the full task, then run `/teach stop [objective]` when you are done.",
					"`/teach stop` now saves the draft and enters a clarification dialogue so you can shape the real task before validation and publish.",
				],
			});
			return buildDirectSessionResponse({
				entry: params.entry,
				userText: params.rawText,
				assistantText,
				meta: {
					directCommand: "teach_start",
					recording: result.recording,
				},
			});
		}
		if (params.command.action === "confirm") {
			const state = readTeachClarificationState(params.entry);
			if (!state) {
				return buildDirectSessionResponse({
					entry: params.entry,
					userText: params.rawText,
					assistantText: "No active teach clarification is open. Use `/teach stop` after a recording, or `/teach validate <draftId>` for an existing draft.",
					meta: {
						directCommand: "teach_confirm",
						status: "error",
					},
				});
			}
			if (activeTeachClarificationSessions.has(params.entry.id)) {
				return buildEphemeralSessionResponse({
					entry: params.entry,
					assistantText: "Teach clarification is still processing. Wait for the current reply before confirming the task card.",
					meta: {
						directCommand: "teach_confirm",
						status: "busy",
						teachClarification: state,
					},
				});
			}
			const draft = await taskDraftHandlers.get({
				sessionId: params.entry.id,
				draftId: state.draftId,
			});
			if (!draft) {
				writeTeachClarificationState(params.entry, undefined);
				onStateChanged?.();
				return buildDirectSessionResponse({
					entry: params.entry,
					userText: params.rawText,
					assistantText: "The active teach clarification draft could not be found, so clarification mode was cleared.",
					meta: {
						directCommand: "teach_confirm",
						status: "error",
					},
				});
			}
			return await confirmTeachClarification({
				entry: params.entry,
				userText: params.rawText,
				state,
				draft,
				validateAfterConfirm: resolveTeachConfirmValidationMode(params.command.trailing) === "validate",
			});
		}
		if (params.command.action === "validate") {
			const target = parseTeachDraftTarget(params.command.trailing);
			if (!target.draftId) {
				return buildDirectSessionResponse({
					entry: params.entry,
					userText: params.rawText,
					assistantText: "Teach validation requires a draft id. Use `/teach validate <draftId>`.",
					meta: {
						directCommand: "teach_validate",
						status: "error",
					},
				});
			}
			try {
				const result = await validateExistingTeachDraft(params.entry, { draftId: target.draftId });
				clearTeachClarificationForDraft(params.entry, target.draftId);
				const validation = result.validation;
				const assistantText = await buildTeachReport({
					headline: validation.state === "validated"
						? `Replay validation passed for draft \`${target.draftId}\`.`
						: validation.state === "requires_reset"
							? `Draft \`${target.draftId}\` still needs environment reset before replay validation can confirm it.`
							: validation.state === "unvalidated"
								? `Draft \`${target.draftId}\` still needs review before replay validation can run.`
							: `Replay validation failed for draft \`${target.draftId}\`.`,
					draft: asRecord(result.draft),
					validation: validation,
					nextSteps: validation.state === "validated"
						? [`Publish it with \`/teach publish ${target.draftId} [skill-name]\`.`]
						: validation.state === "requires_reset"
							? [`Reset or restore the workspace state, then rerun \`/teach validate ${target.draftId}\`.`]
							: validation.state === "unvalidated"
								? [`Resolve the draft's open questions or uncertain steps, then rerun \`/teach validate ${target.draftId}\`.`]
								: [`Inspect the validation output, correct the draft or workspace state, then rerun \`/teach validate ${target.draftId}\`.`],
				});
				return buildDirectSessionResponse({
					entry: params.entry,
					userText: params.rawText,
					assistantText,
					meta: {
						directCommand: "teach_validate",
						draft: result.draft,
						validation,
					},
				});
			} catch (error) {
				return buildDirectSessionResponse({
					entry: params.entry,
					userText: params.rawText,
					assistantText: `Could not validate teach draft \`${target.draftId}\`: ${error instanceof Error ? error.message : String(error)}`,
					meta: {
						directCommand: "teach_validate",
						status: "error",
					},
				});
			}
		}
		if (params.command.action === "publish") {
			const target = parseTeachDraftTarget(params.command.trailing);
			if (!target.draftId) {
				return buildDirectSessionResponse({
					entry: params.entry,
					userText: params.rawText,
					assistantText: "Teach publish requires a draft id. Use `/teach publish <draftId> [skill-name]`.",
					meta: {
						directCommand: "teach_publish",
						status: "error",
					},
				});
			}
			try {
				const published = await publishExistingTeachDraft(params.entry, {
					draftId: target.draftId,
					name: target.name,
				});
				clearTeachClarificationForDraft(params.entry, target.draftId);
				const assistantText = await buildTeachReport({
					headline: `Published workspace skill \`${published.skill.name}\` from teach draft \`${target.draftId}\`.`,
					draft: asRecord(published.draft),
					skill: asRecord(published.skill),
					nextSteps: [
						typeof (published as { promptRefreshError?: unknown }).promptRefreshError === "string"
							? "The skill was published, but live workspace sessions may still need a manual refresh."
							: "The skill was hot-refreshed into live workspace sessions for this workspace.",
						"Review the generated `SKILL.md` preview and refine the draft if the procedure still needs edits.",
						...(typeof (published as { promptRefreshError?: unknown }).promptRefreshError === "string"
							? [`Prompt hot-refresh warning: ${(published as { promptRefreshError: string }).promptRefreshError}`]
							: []),
					],
				});
				return buildDirectSessionResponse({
					entry: params.entry,
					userText: params.rawText,
					assistantText,
					meta: {
						directCommand: "teach_publish",
						draft: published.draft,
						skill: published.skill,
						...(typeof (published as { promptRefreshError?: unknown }).promptRefreshError === "string"
							? { promptRefreshError: (published as { promptRefreshError: string }).promptRefreshError }
							: {}),
					},
				});
			} catch (error) {
				return buildDirectSessionResponse({
					entry: params.entry,
					userText: params.rawText,
					assistantText: `Could not publish teach draft \`${target.draftId}\`: ${error instanceof Error ? error.message : String(error)}`,
					meta: {
						directCommand: "teach_publish",
						status: "error",
					},
				});
			}
		}

		const stopResult = await stopTeachRecordingFromCommand(params.entry, {
			objective: params.command.trailing,
		});
		const analysisError = asString(stopResult.analysisError);
		const recording = asRecord(stopResult.recording);
		const draft = asRecord(stopResult.draft);
		const clarificationState = readTeachClarificationState(params.entry);
		const sourceLabel = asString(draft?.sourceLabel) ?? asString(recording?.videoPath) ?? "the recording";
		const draftId = asString(draft?.id);
		const assistantText = analysisError || !draft || !clarificationState
			? await buildTeachReport({
				headline: analysisError
					? `Stopped teach recording for ${sourceLabel}, but analysis failed.`
					: `Stopped teach recording for ${sourceLabel}. Saved draft \`${draftId ?? "unknown"}\`.`,
				recording,
				draft,
				analysisError,
				nextSteps: analysisError
					? ["Inspect the saved video and event log, then retry the teach flow once the analysis issue is fixed."]
					: [
						"Reply in plain language to shape the real task from this draft.",
						`Run \`/teach validate ${draftId ?? "draft-id"}\` once the task card is complete.`,
					],
			})
			: await buildTeachClarificationReport({
				headline: `Stopped teach recording for ${sourceLabel}. Saved draft \`${draftId ?? "unknown"}\` and entered teach clarification mode so we can shape the reusable task before validation.`,
				recording,
				draft,
				state: clarificationState,
				nextSteps: clarificationState.status === "ready"
					? [
						"Run `/teach confirm` to lock the task card without replay validation.",
						`Run \`/teach confirm --validate\` or \`/teach validate ${draftId ?? "draft-id"}\` when you want replay validation.`,
					]
					: [
						"Reply in plain language to refine the task card.",
						"Run `/teach confirm` once the task card looks right.",
					],
			});
		return buildDirectSessionResponse({
			entry: params.entry,
			userText: params.rawText,
			assistantText,
			meta: {
				directCommand: "teach_stop",
				recording: stopResult.recording,
				...(draft ? { draft } : {}),
				...(clarificationState ? { teachClarification: clarificationState } : {}),
				...(stopResult.analysisError ? { analysisError: stopResult.analysisError } : {}),
			},
		});
	};

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
