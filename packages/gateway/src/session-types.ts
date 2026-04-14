import type { Attachment, UnderstudyConfig } from "@understudy/types";
import type { GuiDemonstrationRecorder } from "@understudy/gui";
import type { ImageContent, Model } from "@mariozechner/pi-ai";
import type { TeachCapabilitySnapshot } from "@understudy/tools";
import type { SubagentMode, SubagentSessionMeta } from "./subagent-registry.js";
import type { ResolvedSubagentAgentTarget } from "./subagent-spawn-plan.js";
import type { UsageTracker, TaughtTaskDraft } from "@understudy/core";

export interface SessionEntry {
	id: string;
	parentId?: string;
	forkPoint?: number;
	channelId?: string;
	senderId?: string;
	senderName?: string;
	conversationName?: string;
	conversationType?: "direct" | "group" | "thread";
	threadId?: string;
	createdAt: number;
	lastActiveAt: number;
	dayStamp: string;
	messageCount: number;
	session: unknown;
	workspaceDir?: string;
	repoRoot?: string;
	validationRoot?: string;
	configOverride?: Partial<UnderstudyConfig>;
	sandboxInfo?: SessionSandboxInfo;
	executionScopeKey?: string;
	sessionMeta?: Record<string, unknown>;
	traceId?: string;
	subagentMeta?: SubagentSessionMeta;
	recentRuns?: SessionRunTrace[];
	history: Array<{
		role: "user" | "assistant";
		text: string;
		timestamp: number;
		images?: ImageContent[];
		attachments?: Attachment[];
	}>;
}

export interface SessionRunTrace {
	runId: string;
	recordedAt: number;
	userPromptPreview: string;
	responsePreview: string;
	durationMs?: number;
	thoughtText?: string;
	progressSteps?: Array<Record<string, unknown>>;
	toolTrace: Array<Record<string, unknown>>;
	attempts: Array<Record<string, unknown>>;
	teachValidation?: Record<string, unknown>;
	agentMeta?: Record<string, unknown>;
}

export interface SessionSummary {
	id: string;
	sessionName?: string;
	parentId?: string;
	forkPoint?: number;
	channelId?: string;
	senderId?: string;
	senderName?: string;
	conversationName?: string;
	conversationType?: "direct" | "group" | "thread";
	threadId?: string;
	createdAt: number;
	lastActiveAt: number;
	messageCount: number;
	workspaceDir?: string;
	model?: string;
	thinkingLevel?: UnderstudyConfig["defaultThinkingLevel"];
	runtimeProfile?: string;
	traceId?: string;
	lastRunId?: string;
	lastRunAt?: number;
	lastToolName?: string;
	lastToolRoute?: string;
	lastToolStatus?: "ok" | "error";
	subagentParentId?: string;
	subagentLabel?: string;
	subagentMode?: SubagentMode;
	subagentStatus?: SubagentSessionMeta["latestRunStatus"];
	teachClarification?: {
		draftId: string;
		status: "clarifying" | "ready";
		summary?: string;
		nextQuestion?: string;
		pendingQuestions?: string[];
		updatedAt?: number;
	};
}

export interface SessionSandboxInfo {
	enabled: boolean;
	containerWorkspaceDir?: string;
	workspaceDir?: string;
	workspaceAccess?: string;
	browserNoVncUrl?: string;
	hostBrowserAllowed?: boolean;
	elevated?: {
		allowed: boolean;
		defaultLevel?: string;
	};
}

export type SessionSummaryInput = Pick<
	SessionEntry,
	| "id"
	| "parentId"
	| "forkPoint"
	| "channelId"
	| "senderId"
	| "senderName"
	| "conversationName"
	| "conversationType"
	| "threadId"
	| "createdAt"
	| "lastActiveAt"
	| "messageCount"
	| "workspaceDir"
	| "traceId"
	| "sessionMeta"
	| "subagentMeta"
	| "recentRuns"
>;

export type SessionLookupContext = {
	channelId?: string;
	senderId?: string;
	senderName?: string;
	conversationName?: string;
	conversationType?: "direct" | "group" | "thread";
	threadId?: string;
	forceNew?: boolean;
	workspaceDir?: string;
	explicitWorkspace?: boolean;
	configOverride?: Partial<UnderstudyConfig>;
	sandboxInfo?: SessionSandboxInfo;
	executionScopeKey?: string;
};

export type SessionCreateContext = {
	sessionKey: string;
	parentId?: string;
	forkPoint?: number;
	channelId?: string;
	senderId?: string;
	senderName?: string;
	conversationName?: string;
	conversationType?: "direct" | "group" | "thread";
	threadId?: string;
	workspaceDir?: string;
	explicitWorkspace?: boolean;
	configOverride?: Partial<UnderstudyConfig>;
	sandboxInfo?: SessionSandboxInfo;
	executionScopeKey?: string;
	allowedToolNames?: string[];
	extraSystemPrompt?: string;
	thinkingLevel?: UnderstudyConfig["defaultThinkingLevel"];
};

export interface WorkflowCrystallizationRuntimeOptions {
	minTurnsForSegmentation?: number;
	segmentationReanalyzeDelta?: number;
	minEpisodesForClustering?: number;
	minClusterOccurrencesForPromotion?: number;
	maxClusteringEpisodes?: number;
	maxPromotedWorkflowCandidates?: number;
	maxSynthesisEpisodeExamples?: number;
}

export interface CreateGatewaySessionRuntimeParams {
	sessionEntries: Map<string, SessionEntry>;
	inFlightSessionIds: Set<string>;
	config: UnderstudyConfig;
	usageTracker: UsageTracker;
	estimateTokens: (text: string) => number;
	appendHistory: (
		entry: SessionEntry,
		role: "user" | "assistant",
		text: string,
		timestamp?: number,
		options?: {
			images?: ImageContent[];
			attachments?: Attachment[];
		},
	) => void;
	getOrCreateSession: (context: SessionLookupContext) => Promise<SessionEntry>;
	createScopedSession: (context: SessionCreateContext) => Promise<SessionEntry>;
	promptSession: (
		entry: SessionEntry,
		text: string,
		runId?: string,
		promptOptions?: Record<string, unknown>,
	) => Promise<{ response: string; runId: string; images?: ImageContent[]; meta?: Record<string, unknown> }>;
	abortSessionEntry: (entry: SessionEntry) => Promise<boolean>;
	resolveAgentTarget?: (agentId: string) => ResolvedSubagentAgentTarget | null;
	waitForRun?: (params: {
		runId?: string;
		sessionId?: string;
		timeoutMs?: number;
	}) => Promise<Record<string, unknown>>;
	listPersistedSessions?: (params?: {
		channelId?: string;
		senderId?: string;
		limit?: number;
	}) => Promise<SessionSummary[]>;
	readPersistedSession?: (params: {
		sessionId: string;
	}) => Promise<SessionSummary | null>;
	readTranscriptHistory?: (params: {
		sessionId: string;
		limit?: number;
	}) => Promise<Array<SessionEntry["history"][number]>>;
	readPersistedTrace?: (params: {
		sessionId: string;
		limit?: number;
	}) => Promise<SessionRunTrace[]>;
	persistSessionRunTrace?: (params: {
		sessionId: string;
		trace: SessionRunTrace;
	}) => Promise<void>;
	deletePersistedSession?: (params: {
		sessionId: string;
	}) => Promise<void>;
	onStateChanged?: () => void;
	demonstrationRecorder?: GuiDemonstrationRecorder;
	validateTeachDraft?: (params: {
		entry: SessionEntry;
		draft: unknown;
		promptSession: CreateGatewaySessionRuntimeParams["promptSession"];
	}) => Promise<{
		state: "validated" | "requires_reset" | "failed";
		summary: string;
		checks: Array<{
			id: string;
			ok: boolean;
			summary: string;
			details?: string;
			source?: "replay" | "draft";
		}>;
		runId?: string;
		response?: string;
		meta?: Record<string, unknown>;
	}>;
	notifyUser?: (params: {
		entry: SessionEntry;
		text: string;
		title?: string;
		source: "workflow_crystallization";
		details?: Record<string, unknown>;
	}) => Promise<void>;
	workflowCrystallization?: WorkflowCrystallizationRuntimeOptions;
}
