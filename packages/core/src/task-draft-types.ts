import type {
	WorkspaceArtifactKind,
	WorkspacePlaybookApprovalGate,
} from "./workspace-artifact-types.js";

export type TaughtTaskToolArgumentPrimitive = string | number | boolean;
export type TaughtTaskToolArgumentObject = Record<string, TaughtTaskToolArgumentPrimitive>;
export type TaughtTaskToolArgumentValue =
	| TaughtTaskToolArgumentPrimitive
	| TaughtTaskToolArgumentPrimitive[]
	| TaughtTaskToolArgumentObject;
export type TaughtTaskToolArguments = Record<string, TaughtTaskToolArgumentValue>;

export interface TaughtTaskDraftParameter {
	name: string;
	label: string;
	sampleValue?: string;
	required: boolean;
	sourceKey?: string;
	source?: "prompt" | "tool_argument";
	notes?: string;
}

export type TaughtTaskKind = "fixed_demo" | "parameterized_workflow" | "batch_workflow";
export type TaughtTaskExecutionRoute = "skill" | "browser" | "shell" | "gui";

export interface TaughtTaskExecutionPolicy {
	toolBinding: "adaptive" | "fixed";
	preferredRoutes: TaughtTaskExecutionRoute[];
	stepInterpretation: "evidence" | "fallback_replay" | "strict_contract";
	notes: string[];
}

export interface TaughtTaskStepRouteOption {
	id: string;
	procedureStepId: string;
	route: TaughtTaskExecutionRoute;
	preference: "preferred" | "fallback" | "observed";
	instruction: string;
	toolName?: string;
	skillName?: string;
	when?: string;
	notes?: string;
}

export interface TaughtTaskDraftStep {
	id: string;
	index: number;
	toolName: string;
	route: string;
	instruction: string;
	summary?: string;
	target?: string;
	app?: string;
	scope?: string;
	inputs?: Record<string, string>;
	captureMode?: "window" | "display";
	groundingMode?: "single" | "complex";
	locationHint?: string;
	windowTitle?: string;
	toolArgs?: TaughtTaskToolArguments;
	verificationStatus?: string;
	verificationSummary?: string;
	uncertain?: boolean;
}

export interface TaughtTaskCard {
	goal?: string;
	scope?: string;
	loopOver?: string;
	inputs: string[];
	extract: string[];
	formula?: string;
	filter?: string;
	output?: string;
}

export interface TaughtTaskProcedureStep {
	id: string;
	index: number;
	instruction: string;
	kind?: "navigate" | "extract" | "transform" | "filter" | "output" | "skill" | "check";
	skillName?: string;
	notes?: string;
	uncertain?: boolean;
}

export interface TaughtTaskSkillDependency {
	name: string;
	reason?: string;
	required: boolean;
}

export interface TaughtTaskDraftChildArtifact {
	id: string;
	name: string;
	artifactKind: Exclude<WorkspaceArtifactKind, "playbook">;
	objective: string;
	required: boolean;
	reason?: string;
}

export type TaughtTaskPlaybookStageKind = "skill" | "worker" | "inline" | "approval";

export interface TaughtTaskPlaybookStage {
	id: string;
	name: string;
	kind: TaughtTaskPlaybookStageKind;
	refName?: string;
	objective: string;
	inputs: string[];
	outputs: string[];
	budgetNotes: string[];
	retryPolicy?: "retry_once" | "skip_with_note" | "pause_for_human";
	approvalGate?: WorkspacePlaybookApprovalGate;
}

export interface TaughtTaskWorkerBudget {
	maxMinutes?: number;
	maxActions?: number;
	maxScreenshots?: number;
}

export interface TaughtTaskWorkerContract {
	goal: string;
	scope?: string;
	inputs: string[];
	outputs: string[];
	allowedRoutes: TaughtTaskExecutionRoute[];
	allowedSurfaces: string[];
	budget?: TaughtTaskWorkerBudget;
	escalationPolicy: string[];
	stopConditions: string[];
	decisionHeuristics: string[];
}

export interface TaughtTaskDraftRevision {
	revision: number;
	timestamp: number;
	action: "created" | "corrected" | "validated" | "published";
	actor?: "system" | "operator";
	summary?: string;
	changes?: string[];
	note?: string;
}

export interface TaughtTaskDraftPublishedSkill {
	name: string;
	skillDir: string;
	skillPath: string;
	publishedAt: number;
	artifactKind?: WorkspaceArtifactKind;
}

export interface TaughtTaskDraftValidationCheck {
	id: string;
	ok: boolean;
	summary: string;
	details?: string;
	source?: "replay" | "draft";
}

export interface TaughtTaskDraftValidation {
	state: "unvalidated" | "validated" | "requires_reset" | "failed";
	updatedAt: number;
	summary: string;
	runId?: string;
	responsePreview?: string;
	checks: TaughtTaskDraftValidationCheck[];
	mode?: "inspection" | "replay";
	usedMutatingTools?: boolean;
	toolNames?: string[];
	mutatingToolNames?: string[];
}

export interface TaughtTaskDraft {
	id: string;
	workspaceDir: string;
	repoRoot?: string;
	sessionId?: string;
	traceId?: string;
	sourceKind?: "run" | "video";
	sourceLabel?: string;
	sourceDetails?: Record<string, unknown>;
	runId: string;
	sourceRunId: string;
	createdAt: number;
	updatedAt: number;
	status: "draft" | "published";
	artifactKind: WorkspaceArtifactKind;
	title: string;
	objective: string;
	intent: string;
	userPromptPreview: string;
	promptPreview: string;
	responsePreview?: string;
	routeSignature: string;
	taskKind: TaughtTaskKind;
	parameterSlots: TaughtTaskDraftParameter[];
	successCriteria: string[];
	openQuestions: string[];
	uncertainties: string[];
	taskCard?: TaughtTaskCard;
	procedure: TaughtTaskProcedureStep[];
	executionPolicy: TaughtTaskExecutionPolicy;
	stepRouteOptions: TaughtTaskStepRouteOption[];
	replayPreconditions: string[];
	resetSignals: string[];
	skillDependencies: TaughtTaskSkillDependency[];
	childArtifacts: TaughtTaskDraftChildArtifact[];
	playbookStages: TaughtTaskPlaybookStage[];
	workerContract?: TaughtTaskWorkerContract;
	steps: TaughtTaskDraftStep[];
	validation?: TaughtTaskDraftValidation;
	revisions: TaughtTaskDraftRevision[];
	publishedSkill?: TaughtTaskDraftPublishedSkill;
}

export interface TaughtTaskDraftLedger {
	updatedAt: number;
	workspaceDir: string;
	repoRoot?: string;
	drafts: TaughtTaskDraft[];
}

export interface TaughtTaskDraftLintIssue {
	id: string;
	summary: string;
}

export interface BuildTaughtTaskDraftFromRunOptions {
	workspaceDir: string;
	repoRoot?: string;
	sessionId?: string;
	traceId?: string;
	runId: string;
	promptPreview: string;
	responsePreview?: string;
	toolTrace?: Array<Record<string, unknown>>;
	teachValidation?: Record<string, unknown>;
	title?: string;
	objective?: string;
	now?: number;
}

export interface CreateTaughtTaskDraftRunLike {
	runId: string;
	recordedAt?: number;
	userPromptPreview: string;
	responsePreview?: string;
	toolTrace?: Array<Record<string, unknown>>;
	teachValidation?: Record<string, unknown>;
}

export interface CreateTaughtTaskDraftOptions {
	workspaceDir: string;
	repoRoot?: string;
	sessionId?: string;
	traceId?: string;
	title?: string;
	objective?: string;
	run: CreateTaughtTaskDraftRunLike;
}

export interface CreateTaughtTaskDraftFromVideoOptions {
	workspaceDir: string;
	repoRoot?: string;
	sessionId?: string;
	traceId?: string;
	title?: string;
	objective?: string;
	sourceLabel?: string;
	sourceDetails?: Record<string, unknown>;
	promptPreview?: string;
	responsePreview?: string;
	taskKind?: TaughtTaskKind;
	parameterSlots?: Array<TaughtTaskDraftParameter | string>;
	successCriteria?: string[];
	openQuestions?: string[];
	uncertainties?: string[];
	taskCard?: TaughtTaskCard;
	procedure?: Array<Partial<TaughtTaskProcedureStep> | string>;
	executionPolicy?: TaughtTaskExecutionPolicy;
	stepRouteOptions?: Array<Partial<TaughtTaskStepRouteOption>>;
	replayPreconditions?: string[];
	resetSignals?: string[];
	skillDependencies?: Array<TaughtTaskSkillDependency | string>;
	steps?: Array<Partial<TaughtTaskDraftStep> | string>;
}

export interface LoadPersistedTaughtTaskDraftLedgerOptions {
	workspaceDir: string;
	learningDir?: string;
}

export interface PersistTaughtTaskDraftOptions {
	learningDir?: string;
	maxDraftsPerWorkspace?: number;
}

export interface UpdatePersistedTaughtTaskDraftOptions {
	workspaceDir: string;
	draftId: string;
		patch: {
			title?: string;
			intent?: string;
			objective?: string;
			artifactKind?: WorkspaceArtifactKind;
			taskKind?: TaughtTaskKind;
			parameterSlots?: Array<TaughtTaskDraftParameter | string>;
			successCriteria?: string[];
			openQuestions?: string[];
			uncertainties?: string[];
			taskCard?: TaughtTaskCard;
			procedure?: Array<Partial<TaughtTaskProcedureStep> | string>;
			executionPolicy?: TaughtTaskExecutionPolicy;
			stepRouteOptions?: Array<Partial<TaughtTaskStepRouteOption>>;
			replayPreconditions?: string[];
			resetSignals?: string[];
			skillDependencies?: Array<TaughtTaskSkillDependency | string>;
			childArtifacts?: Array<Partial<TaughtTaskDraftChildArtifact>>;
			playbookStages?: Array<Partial<TaughtTaskPlaybookStage>>;
			workerContract?: Partial<TaughtTaskWorkerContract>;
			steps?: Array<Partial<TaughtTaskDraftStep> | string>;
			validation?: TaughtTaskDraftValidation;
			note?: string;
		};
	learningDir?: string;
	note?: string;
	action?: TaughtTaskDraftRevision["action"];
}

export interface ListTaughtTaskDraftsOptions {
	workspaceDir: string;
	learningDir?: string;
}

export interface LoadTaughtTaskDraftOptions {
	workspaceDir: string;
	draftId: string;
	learningDir?: string;
}

export interface PublishTaughtTaskDraftOptions {
	workspaceDir: string;
	draftId: string;
	name?: string;
	learningDir?: string;
	skillsDir?: string;
	overwrite?: boolean;
}

export interface PublishTaughtTaskDraftResult {
	draft: TaughtTaskDraft;
	skill: TaughtTaskDraftPublishedSkill;
}
