import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { resolveUnderstudyHomeDir } from "./runtime-paths.js";
import { asString } from "./value-helpers.js";
import { containsPath, normalizePath } from "./workspace-context.js";

const DEFAULT_MAX_PROMPT_DRAFTS = 3;
const DEFAULT_MAX_PROMPT_STEPS = 4;
const DEFAULT_MAX_DRAFTS_PER_WORKSPACE = 16;

import type {
	TaughtTaskDraft,
	TaughtTaskDraftLedger,
	TaughtTaskDraftStep,
	TaughtTaskDraftValidationCheck,
	TaughtTaskDraftValidation,
	BuildTaughtTaskDraftFromRunOptions,
	CreateTaughtTaskDraftOptions,
	CreateTaughtTaskDraftFromVideoOptions,
	LoadPersistedTaughtTaskDraftLedgerOptions,
	PersistTaughtTaskDraftOptions,
	UpdatePersistedTaughtTaskDraftOptions,
	ListTaughtTaskDraftsOptions,
	LoadTaughtTaskDraftOptions,
	PublishTaughtTaskDraftOptions,
	PublishTaughtTaskDraftResult,
	TaughtTaskToolArgumentPrimitive,
	TaughtTaskToolArgumentObject,
	TaughtTaskToolArgumentValue,
	TaughtTaskToolArguments,
	TaughtTaskDraftParameter,
	TaughtTaskKind,
	TaughtTaskExecutionRoute,
	TaughtTaskExecutionPolicy,
	TaughtTaskStepRouteOption,
	TaughtTaskCard,
	TaughtTaskProcedureStep,
	TaughtTaskSkillDependency,
	TaughtTaskDraftChildArtifact,
	TaughtTaskPlaybookStageKind,
	TaughtTaskPlaybookStage,
	TaughtTaskWorkerBudget,
	TaughtTaskWorkerContract,
	TaughtTaskDraftRevision,
	TaughtTaskDraftPublishedSkill,
	TaughtTaskDraftLintIssue,
} from "./task-draft-types.js";

export type {
	TaughtTaskToolArgumentPrimitive,
	TaughtTaskToolArgumentObject,
	TaughtTaskToolArgumentValue,
	TaughtTaskToolArguments,
	TaughtTaskDraftParameter,
	TaughtTaskKind,
	TaughtTaskExecutionRoute,
	TaughtTaskExecutionPolicy,
	TaughtTaskStepRouteOption,
	TaughtTaskDraftStep,
	TaughtTaskCard,
	TaughtTaskProcedureStep,
	TaughtTaskSkillDependency,
	TaughtTaskDraftChildArtifact,
	TaughtTaskPlaybookStageKind,
	TaughtTaskPlaybookStage,
	TaughtTaskWorkerBudget,
	TaughtTaskWorkerContract,
	TaughtTaskDraftRevision,
	TaughtTaskDraftPublishedSkill,
	TaughtTaskDraftValidationCheck,
	TaughtTaskDraftValidation,
	TaughtTaskDraft,
	TaughtTaskDraftLedger,
	TaughtTaskDraftLintIssue,
	BuildTaughtTaskDraftFromRunOptions,
	CreateTaughtTaskDraftRunLike,
	CreateTaughtTaskDraftOptions,
	CreateTaughtTaskDraftFromVideoOptions,
	LoadPersistedTaughtTaskDraftLedgerOptions,
	PersistTaughtTaskDraftOptions,
	UpdatePersistedTaughtTaskDraftOptions,
	ListTaughtTaskDraftsOptions,
	LoadTaughtTaskDraftOptions,
	PublishTaughtTaskDraftOptions,
	PublishTaughtTaskDraftResult,
} from "./task-draft-types.js";

export { normalizeTaughtTaskToolArguments, extractTaughtTaskToolArgumentsFromRecord, lintTaughtTaskDraft } from "./task-draft-normalization.js";
export { buildPublishedSkillName, buildPublishedSkillMarkdown, buildPublishedSkillTriggers, buildPublishedSkillDescription, resolveDefaultTaughtTaskSkillsDir } from "./task-draft-publishing.js";

import {
	normalizeLineList,
	normalizeParameterSlots,
	normalizeProcedure,
	normalizeSkillDependencies,
	normalizeArtifactKind,
	normalizeChildArtifacts,
	normalizePlaybookStages,
	normalizeWorkerContract,
	buildWorkerContractFromDraftSeed,
	normalizeExecutionPolicy,
	normalizeStepRouteOptions,
	normalizeTaskCard,
	buildTaskCardFromDraftSeed,
	normalizeTaskKind,
	inferTaskKind,
	alignTaskCardToTaskKind,
	normalizeReplayHintList,
	normalizeSteps,
	normalizeValidation,
	buildProcedureFromSteps,
	inferExecutionPolicy,
	resolvePairedSteps,
	stripTimestampEnvelope,
	draftTitleFromPrompt,
	buildParameterSlots,
	extractPromptQuotedParameterSlots,
	collectSuccessCriteria,
	collectUncertainties,
	summarizeRevisionChanges,
	buildRevisionSummary,
	formatStepRouteOptionTarget,
	describeToolArgumentValue,
	formatExecutionRouteOrder,
} from "./task-draft-normalization.js";

import {
	buildPublishedSkillName,
	buildPublishedSkillMarkdown,
	resolveDefaultTaughtTaskSkillsDir,
} from "./task-draft-publishing.js";

import type { WorkspaceArtifactKind } from "./workspace-artifact-types.js";

function matchesLearningWorkspaceScope(params: {
	requestedWorkspaceDir: string;
	payloadWorkspaceDir?: string;
	payloadRepoRoot?: string;
}): boolean {
	const requestedWorkspaceDir = normalizePath(params.requestedWorkspaceDir);
	const payloadWorkspaceDir = normalizePath(params.payloadWorkspaceDir);
	if (!requestedWorkspaceDir || !payloadWorkspaceDir) {
		return false;
	}
	if (requestedWorkspaceDir === payloadWorkspaceDir) {
		return true;
	}
	if (containsPath(requestedWorkspaceDir, payloadWorkspaceDir) || containsPath(payloadWorkspaceDir, requestedWorkspaceDir)) {
		return true;
	}
	const payloadRepoRoot = normalizePath(params.payloadRepoRoot);
	if (!payloadRepoRoot) {
		return false;
	}
	return (
		containsPath(payloadRepoRoot, requestedWorkspaceDir) ||
		containsPath(requestedWorkspaceDir, payloadRepoRoot)
	);
}

function scoreWorkspaceMatch(params: {
	requestedWorkspaceDir: string;
	payloadWorkspaceDir?: string;
	payloadRepoRoot?: string;
}): number {
	const requestedWorkspaceDir = normalizePath(params.requestedWorkspaceDir);
	const payloadWorkspaceDir = normalizePath(params.payloadWorkspaceDir);
	if (!requestedWorkspaceDir || !payloadWorkspaceDir) {
		return -1;
	}
	if (requestedWorkspaceDir === payloadWorkspaceDir) {
		return 10_000 + payloadWorkspaceDir.length;
	}
	if (containsPath(payloadWorkspaceDir, requestedWorkspaceDir)) {
		return 8_000 + payloadWorkspaceDir.length;
	}
	if (containsPath(requestedWorkspaceDir, payloadWorkspaceDir)) {
		return 6_000 + payloadWorkspaceDir.length;
	}
	const payloadRepoRoot = normalizePath(params.payloadRepoRoot);
	if (payloadRepoRoot && containsPath(payloadRepoRoot, requestedWorkspaceDir)) {
		return 4_000 + payloadRepoRoot.length;
	}
	return -1;
}

async function readJsonIfExists<T>(filePath: string): Promise<T | undefined> {
	try {
		await stat(filePath);
		const raw = await readFile(filePath, "utf8");
		return JSON.parse(raw) as T;
	} catch {
		return undefined;
	}
}

async function loadBestMatchingPayload<T extends {
	workspaceDir?: string;
	repoRoot?: string;
}>(params: {
	dirPath: string;
	requestedWorkspaceDir: string;
}): Promise<T | undefined> {
	const names = await readdir(params.dirPath).catch(() => []);
	let best: { payload: T; score: number } | undefined;
	for (const name of names) {
		if (!name.endsWith(".json")) {
			continue;
		}
		const payload = await readJsonIfExists<T>(join(params.dirPath, name));
		if (!payload || !matchesLearningWorkspaceScope({
			requestedWorkspaceDir: params.requestedWorkspaceDir,
			payloadWorkspaceDir: payload.workspaceDir,
			payloadRepoRoot: payload.repoRoot,
		})) {
			continue;
		}
		const score = scoreWorkspaceMatch({
			requestedWorkspaceDir: params.requestedWorkspaceDir,
			payloadWorkspaceDir: payload.workspaceDir,
			payloadRepoRoot: payload.repoRoot,
		});
		if (!best || score > best.score) {
			best = { payload, score };
		}
	}
	return best?.payload;
}

function resolveLearningDir(override?: string): string {
	return override ?? join(resolveUnderstudyHomeDir(), "learning");
}

function buildWorkspaceKey(workspaceDir: string): string {
	return createHash("sha1").update(resolve(workspaceDir)).digest("hex").slice(0, 16);
}

function buildTaskDraftLedgerPath(workspaceDir: string, learningDir?: string): string {
	const effectiveLearningDir = resolveLearningDir(learningDir);
	return join(effectiveLearningDir, "task-drafts", `${buildWorkspaceKey(workspaceDir)}.json`);
}

export function buildTaughtTaskDraftFromRun(
	options: BuildTaughtTaskDraftFromRunOptions,
): TaughtTaskDraft {
	const now = options.now ?? Date.now();
	const teachValidation = options.teachValidation;
	const steps = resolvePairedSteps(options.toolTrace ?? []);
	const promptPreview = stripTimestampEnvelope(options.promptPreview);
	const title = options.title?.trim() || draftTitleFromPrompt(promptPreview);
	const objective = options.objective?.trim() || promptPreview || title;
	const routeSignature = steps.length > 0 ? steps.map((step) => step.route).join(" -> ") : "system";
	const parameterSlots = [
		...buildParameterSlots(steps),
		...extractPromptQuotedParameterSlots(promptPreview),
	].slice(0, 8);
	const successCriteria = collectSuccessCriteria({
		validation: teachValidation,
		steps,
	});
	const uncertainties = collectUncertainties({
		validation: teachValidation,
		steps,
	});
	const procedure = buildProcedureFromSteps(steps);
	const executionPolicy = inferExecutionPolicy({
		steps,
		skillDependencies: [],
	});
	const stepRouteOptions = normalizeStepRouteOptions(undefined, {
		procedure,
		steps,
	});
	const taskKind = inferTaskKind({
		objective,
		parameterSlots,
		procedure,
		steps,
	});
	const effectiveParameterSlots = taskKind === "fixed_demo" ? [] : parameterSlots;
	const taskCard = alignTaskCardToTaskKind({
		taskCard: buildTaskCardFromDraftSeed({
			title,
			objective,
			parameterSlots: effectiveParameterSlots,
			successCriteria,
			procedure,
		}),
		taskKind,
		parameterSlots: effectiveParameterSlots,
	});
	const workerContract = normalizeWorkerContract(
		undefined,
		buildWorkerContractFromDraftSeed({
			title,
			objective,
			taskCard,
			parameterSlots: effectiveParameterSlots,
			successCriteria,
			uncertainties,
			executionPolicy,
		}),
	);
	return {
		id: createHash("sha1")
			.update(resolve(options.workspaceDir))
			.update(options.sessionId ?? "")
			.update(options.runId)
			.digest("hex")
			.slice(0, 12),
		workspaceDir: resolve(options.workspaceDir),
		repoRoot: options.repoRoot ? resolve(options.repoRoot) : undefined,
		sessionId: options.sessionId,
		traceId: options.traceId,
		sourceKind: "run",
		sourceLabel: options.runId,
		runId: options.runId,
		sourceRunId: options.runId,
		createdAt: now,
		updatedAt: now,
		status: "draft",
		artifactKind: "skill",
		title,
		objective,
		intent: objective,
		userPromptPreview: promptPreview,
		promptPreview,
		responsePreview: options.responsePreview?.trim() || undefined,
		routeSignature,
		taskKind,
		parameterSlots: effectiveParameterSlots,
		successCriteria,
		openQuestions: uncertainties,
		uncertainties,
		...(taskCard ? { taskCard } : {}),
		procedure,
		executionPolicy,
		stepRouteOptions,
		replayPreconditions: [],
		resetSignals: [],
		skillDependencies: [],
		childArtifacts: [],
		playbookStages: [],
		...(workerContract ? { workerContract } : {}),
		steps,
		validation: teachValidation
			? normalizeValidation({
				state: (() => {
					const validationState = asString(teachValidation.state);
					switch (validationState) {
						case "validated":
						case "requires_reset":
						case "failed":
						case "unvalidated":
							return validationState;
						default:
							return "unvalidated";
					}
				})(),
				updatedAt: now,
				summary:
					asString(teachValidation.summary)?.trim() ||
					"Source run was captured without a replay-validation result.",
				runId: options.runId,
				checks: Array.isArray(teachValidation.checks)
					? (teachValidation.checks as TaughtTaskDraftValidationCheck[])
					: [],
				mode:
					asString(teachValidation.mode) === "replay"
						? "replay"
						: "inspection",
				usedMutatingTools: typeof teachValidation.usedMutatingTools === "boolean"
					? teachValidation.usedMutatingTools
					: undefined,
				toolNames: Array.isArray(teachValidation.toolNames)
					? normalizeLineList(teachValidation.toolNames)
					: undefined,
				mutatingToolNames: Array.isArray(teachValidation.mutatingToolNames)
					? normalizeLineList(teachValidation.mutatingToolNames)
					: undefined,
			})
			: undefined,
		revisions: [
			{
				revision: 1,
				timestamp: now,
				action: "created",
				actor: "system",
				summary: `Created teach draft from traced run ${options.runId}.`,
				changes: ["source"],
			},
		],
	};
}

function hydrateTaughtTaskDraft(draft: TaughtTaskDraft): TaughtTaskDraft {
	if (!draft.executionPolicy) {
		throw new Error(`Teach draft ${draft.id} is missing executionPolicy.`);
	}
	if (!Array.isArray(draft.stepRouteOptions)) {
		throw new Error(`Teach draft ${draft.id} is missing stepRouteOptions.`);
	}
	const steps = Array.isArray(draft.steps) ? draft.steps : [];
	const procedureSeed = Array.isArray(draft.procedure) ? draft.procedure : [];
	const procedure = normalizeProcedure(
		procedureSeed,
		buildProcedureFromSteps(steps),
	);
	const parameterSlots = normalizeParameterSlots(Array.isArray(draft.parameterSlots) ? draft.parameterSlots : []);
	const taskKind = inferTaskKind({
		taskKind: normalizeTaskKind(draft.taskKind),
		objective: draft.objective || draft.intent || draft.title,
		taskCard: draft.taskCard,
		parameterSlots,
		procedure,
		steps,
	});
	const effectiveParameterSlots = taskKind === "fixed_demo" ? [] : parameterSlots;
	const artifactKind = normalizeArtifactKind(draft.artifactKind);
	const childArtifacts = artifactKind === "playbook"
		? normalizeChildArtifacts(Array.isArray(draft.childArtifacts) ? draft.childArtifacts : [])
		: [];
	const playbookStages = artifactKind === "playbook"
		? normalizePlaybookStages(Array.isArray(draft.playbookStages) ? draft.playbookStages : [])
		: [];
	const workerContract = artifactKind === "worker"
		? normalizeWorkerContract(
			draft.workerContract,
			buildWorkerContractFromDraftSeed({
				title: draft.title,
				objective: draft.objective || draft.intent || draft.title,
				taskCard: draft.taskCard,
				parameterSlots: effectiveParameterSlots,
				successCriteria: Array.isArray(draft.successCriteria) ? draft.successCriteria : [],
				uncertainties: Array.isArray(draft.uncertainties) ? draft.uncertainties : [],
				executionPolicy: normalizeExecutionPolicy(draft.executionPolicy, {
					steps,
					skillDependencies: normalizeSkillDependencies(draft.skillDependencies),
				}),
			}),
		)
		: undefined;
	return {
		...draft,
		artifactKind,
		taskKind,
		parameterSlots: effectiveParameterSlots,
		taskCard: alignTaskCardToTaskKind({
			taskCard: normalizeTaskCard(
				draft.taskCard,
				buildTaskCardFromDraftSeed({
					title: draft.title,
					objective: draft.objective || draft.intent || draft.title,
					parameterSlots: effectiveParameterSlots,
					successCriteria: Array.isArray(draft.successCriteria) ? draft.successCriteria : [],
					procedure,
				}),
			),
			taskKind,
			parameterSlots: effectiveParameterSlots,
		}),
		procedure,
		replayPreconditions: normalizeReplayHintList(draft.replayPreconditions),
		resetSignals: normalizeReplayHintList(draft.resetSignals),
		skillDependencies: normalizeSkillDependencies(draft.skillDependencies),
		childArtifacts,
		playbookStages,
		workerContract,
		executionPolicy: normalizeExecutionPolicy(draft.executionPolicy, {
			steps,
			skillDependencies: normalizeSkillDependencies(draft.skillDependencies),
		}),
		stepRouteOptions: normalizeStepRouteOptions(draft.stepRouteOptions, {
			procedure,
			steps,
			existing: draft.stepRouteOptions,
		}),
		steps,
		validation: normalizeValidation(draft.validation),
	};
}

async function persistTaughtTaskDraftLedger(
	ledger: TaughtTaskDraftLedger,
	learningDir?: string,
): Promise<void> {
	const ledgerPath = buildTaskDraftLedgerPath(ledger.workspaceDir, learningDir);
	await mkdir(join(resolveLearningDir(learningDir), "task-drafts"), { recursive: true });
	const tempLedgerPath = `${ledgerPath}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(
		tempLedgerPath,
		JSON.stringify(ledger, null, 2),
		"utf8",
	);
	await rename(tempLedgerPath, ledgerPath);
}

export async function loadPersistedTaughtTaskDraftLedger(
	options: LoadPersistedTaughtTaskDraftLedgerOptions,
): Promise<TaughtTaskDraftLedger | undefined> {
	const workspaceDir = resolve(options.workspaceDir);
	const learningDir = resolveLearningDir(options.learningDir);
	const ledgerPath = buildTaskDraftLedgerPath(workspaceDir, learningDir);
	let payload = await readJsonIfExists<TaughtTaskDraftLedger>(ledgerPath);
	if (!payload) {
		payload = await loadBestMatchingPayload<TaughtTaskDraftLedger>({
			dirPath: join(learningDir, "task-drafts"),
			requestedWorkspaceDir: workspaceDir,
		});
	}
	if (!payload) {
		return undefined;
	}
	return {
		updatedAt: payload.updatedAt ?? 0,
		workspaceDir: payload.workspaceDir ?? workspaceDir,
		repoRoot: payload.repoRoot,
		drafts: Array.isArray(payload.drafts)
			? payload.drafts
				.filter((draft): draft is TaughtTaskDraft => Boolean(draft && typeof draft.id === "string"))
				.flatMap((draft) => {
					try {
						return [hydrateTaughtTaskDraft(draft)];
					} catch {
						return [];
					}
				})
				.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
			: [],
	};
}

export async function persistTaughtTaskDraft(
	draft: TaughtTaskDraft,
	options: PersistTaughtTaskDraftOptions = {},
): Promise<TaughtTaskDraftLedger> {
	const hydratedDraft = hydrateTaughtTaskDraft(draft);
	const current = await loadPersistedTaughtTaskDraftLedger({
		workspaceDir: hydratedDraft.workspaceDir,
		learningDir: options.learningDir,
	});
	const otherDrafts = (current?.drafts ?? []).filter((entry) => entry.id !== hydratedDraft.id);
	const nextDrafts = [hydratedDraft, ...otherDrafts]
		.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
		.slice(0, options.maxDraftsPerWorkspace ?? DEFAULT_MAX_DRAFTS_PER_WORKSPACE);
	const nextLedger: TaughtTaskDraftLedger = {
		updatedAt: Date.now(),
		workspaceDir: resolve(hydratedDraft.workspaceDir),
		repoRoot: hydratedDraft.repoRoot,
		drafts: nextDrafts,
	};
	await persistTaughtTaskDraftLedger(nextLedger, options.learningDir);
	return nextLedger;
}

export function createTaughtTaskDraft(options: CreateTaughtTaskDraftOptions): TaughtTaskDraft {
	return buildTaughtTaskDraftFromRun({
		workspaceDir: options.workspaceDir,
		repoRoot: options.repoRoot,
		sessionId: options.sessionId,
		traceId: options.traceId,
		runId: options.run.runId,
		promptPreview: options.run.userPromptPreview,
		responsePreview: options.run.responsePreview,
		toolTrace: options.run.toolTrace,
		teachValidation: options.run.teachValidation,
		title: options.title,
		objective: options.objective,
	});
}

export function createTaughtTaskDraftFromVideo(
	options: CreateTaughtTaskDraftFromVideoOptions,
): TaughtTaskDraft {
	const now = Date.now();
	const resolvedWorkspaceDir = resolve(options.workspaceDir);
	const stepSeedValues = Array.isArray(options.steps) && options.steps.length > 0
		? options.steps
		: [
			{
				toolName: "gui_wait",
				route: "gui",
				instruction: "Wait for the demonstrated UI state to settle.",
			},
		];
	const normalizedSteps = normalizeSteps(
		stepSeedValues,
		stepSeedValues.map((entry, index) => ({
			id: `gui_wait-${index + 1}`,
			index: index + 1,
			toolName:
				typeof entry === "string"
					? "gui_wait"
					: entry.toolName?.trim() || "gui_wait",
			route:
				typeof entry === "string"
					? "gui"
					: entry.route?.trim() || "gui",
			instruction:
				typeof entry === "string"
					? entry
					: entry.instruction?.trim() || entry.summary?.trim() || "Wait for the demonstrated UI state to settle.",
		})),
	);
	const routeSignature = normalizedSteps.length > 0
		? normalizedSteps.map((step) => step.route).join(" -> ")
		: "gui";
	const parameterSlots = normalizeParameterSlots(options.parameterSlots);
	const procedure = normalizeProcedure(
		options.procedure,
		buildProcedureFromSteps(normalizedSteps),
	);
	const sourceLabel = options.sourceLabel?.trim() || "demo video";
	const promptPreview = options.promptPreview?.trim() || `Teach from video: ${sourceLabel}`;
	const title = options.title?.trim() || draftTitleFromPrompt(promptPreview);
	const objective = options.objective?.trim() || promptPreview || title;
	const successCriteria = normalizeLineList(options.successCriteria);
	const taskKind = inferTaskKind({
		taskKind: options.taskKind,
		objective,
		taskCard: options.taskCard,
		parameterSlots,
		procedure,
		steps: normalizedSteps,
	});
	const effectiveParameterSlots = taskKind === "fixed_demo" ? [] : parameterSlots;
	const taskCard = alignTaskCardToTaskKind({
		taskCard: normalizeTaskCard(
			options.taskCard,
			buildTaskCardFromDraftSeed({
				title,
				objective,
				parameterSlots: effectiveParameterSlots,
				successCriteria,
				procedure,
			}),
		),
		taskKind,
		parameterSlots: effectiveParameterSlots,
	});
	const replayPreconditions = normalizeReplayHintList(options.replayPreconditions);
	const resetSignals = normalizeReplayHintList(options.resetSignals);
	const skillDependencies = normalizeSkillDependencies(options.skillDependencies);
	const executionPolicy = normalizeExecutionPolicy(options.executionPolicy, {
		steps: normalizedSteps,
		skillDependencies,
	});
	const stepRouteOptions = normalizeStepRouteOptions(options.stepRouteOptions, {
		procedure,
		steps: normalizedSteps,
	});
	const runId = `video-${createHash("sha1")
		.update(resolvedWorkspaceDir)
		.update(sourceLabel)
		.update(objective)
		.update(String(now))
		.digest("hex")
		.slice(0, 12)}`;
	return {
		id: createHash("sha1")
			.update(resolvedWorkspaceDir)
			.update(options.sessionId ?? "")
			.update(runId)
			.digest("hex")
			.slice(0, 12),
		workspaceDir: resolvedWorkspaceDir,
		repoRoot: options.repoRoot ? resolve(options.repoRoot) : undefined,
		sessionId: options.sessionId,
		traceId: options.traceId,
		sourceKind: "video",
		sourceLabel,
		sourceDetails: options.sourceDetails,
		runId,
		sourceRunId: runId,
		createdAt: now,
		updatedAt: now,
		status: "draft",
		artifactKind: "skill",
		title,
		objective,
		intent: objective,
		userPromptPreview: promptPreview,
		promptPreview,
		responsePreview: options.responsePreview?.trim() || undefined,
		routeSignature,
		taskKind,
		parameterSlots: effectiveParameterSlots,
		successCriteria,
		openQuestions: normalizeLineList(options.openQuestions),
		uncertainties: normalizeLineList(options.uncertainties ?? options.openQuestions),
		...(taskCard ? { taskCard } : {}),
		procedure,
		executionPolicy,
		stepRouteOptions,
		replayPreconditions,
		resetSignals,
		skillDependencies,
		childArtifacts: [],
		playbookStages: [],
		steps: normalizedSteps,
		validation: normalizeValidation({
			state: "unvalidated",
			updatedAt: now,
			summary: `Teach draft derived from ${sourceLabel}; replay validation has not been run yet.`,
			checks: [],
			mode: "replay",
		}),
		revisions: [
			{
				revision: 1,
				timestamp: now,
				action: "created",
				actor: "system",
				summary: `Created teach draft from demo video ${sourceLabel}.`,
				changes: ["source"],
				note: `Derived from video demonstration: ${sourceLabel}`,
			},
		],
	};
}

export async function listTaughtTaskDrafts(
	options: ListTaughtTaskDraftsOptions,
): Promise<TaughtTaskDraft[]> {
	const ledger = await loadPersistedTaughtTaskDraftLedger(options);
	return ledger?.drafts ?? [];
}

export async function loadTaughtTaskDraft(
	options: LoadTaughtTaskDraftOptions,
): Promise<TaughtTaskDraft | undefined> {
	const drafts = await listTaughtTaskDrafts({
		workspaceDir: options.workspaceDir,
		learningDir: options.learningDir,
	});
	return drafts.find((draft) => draft.id === options.draftId);
}

export async function updatePersistedTaughtTaskDraft(
	options: UpdatePersistedTaughtTaskDraftOptions,
): Promise<TaughtTaskDraft> {
	const ledger = await loadPersistedTaughtTaskDraftLedger({
		workspaceDir: options.workspaceDir,
		learningDir: options.learningDir,
	});
	if (!ledger) {
		throw new Error(`No teach drafts found for workspace: ${resolve(options.workspaceDir)}`);
	}
	const draftIndex = ledger.drafts.findIndex((draft) => draft.id === options.draftId);
	if (draftIndex < 0) {
		throw new Error(`Task draft not found: ${options.draftId}`);
	}
	const current = ledger.drafts[draftIndex];
	const nextSteps = normalizeSteps(options.patch.steps, current.steps);
	const nextTitle = options.patch.title?.trim() || current.title;
	const nextObjective = options.patch.objective?.trim() || options.patch.intent?.trim() || current.objective || current.intent;
	const nextIntent = options.patch.intent?.trim() || options.patch.objective?.trim() || current.intent;
	const nextArtifactKind = Object.prototype.hasOwnProperty.call(options.patch, "artifactKind")
		? normalizeArtifactKind(options.patch.artifactKind)
		: current.artifactKind;
	const rawNextParameterSlots = Object.prototype.hasOwnProperty.call(options.patch, "parameterSlots")
		? normalizeParameterSlots(options.patch.parameterSlots)
		: current.parameterSlots;
	const nextSuccessCriteria = Object.prototype.hasOwnProperty.call(options.patch, "successCriteria")
		? normalizeLineList(options.patch.successCriteria)
		: current.successCriteria;
	const nextOpenQuestions = Object.prototype.hasOwnProperty.call(options.patch, "openQuestions")
		? normalizeLineList(options.patch.openQuestions)
		: current.openQuestions;
	const nextUncertainties = Object.prototype.hasOwnProperty.call(options.patch, "uncertainties")
		? normalizeLineList(options.patch.uncertainties)
		: (Object.prototype.hasOwnProperty.call(options.patch, "openQuestions")
			? normalizeLineList(options.patch.openQuestions)
			: current.uncertainties);
	const nextProcedure = Object.prototype.hasOwnProperty.call(options.patch, "procedure")
		? normalizeProcedure(options.patch.procedure, current.procedure)
		: (Object.prototype.hasOwnProperty.call(options.patch, "steps")
			? buildProcedureFromSteps(nextSteps)
			: current.procedure);
	const rawNextTaskCard = Object.prototype.hasOwnProperty.call(options.patch, "taskCard")
		? normalizeTaskCard(options.patch.taskCard, current.taskCard)
		: current.taskCard;
	const nextTaskKind = inferTaskKind({
		taskKind: Object.prototype.hasOwnProperty.call(options.patch, "taskKind")
			? normalizeTaskKind(options.patch.taskKind)
			: current.taskKind,
		objective: nextObjective,
		taskCard: rawNextTaskCard,
		parameterSlots: rawNextParameterSlots,
		procedure: nextProcedure,
		steps: nextSteps,
	});
	const nextParameterSlots = nextTaskKind === "fixed_demo" ? [] : rawNextParameterSlots;
	const nextTaskCard = alignTaskCardToTaskKind({
		taskCard: rawNextTaskCard,
		taskKind: nextTaskKind,
		parameterSlots: nextParameterSlots,
	});
	const nextReplayPreconditions = Object.prototype.hasOwnProperty.call(options.patch, "replayPreconditions")
		? normalizeReplayHintList(options.patch.replayPreconditions)
		: current.replayPreconditions;
	const nextResetSignals = Object.prototype.hasOwnProperty.call(options.patch, "resetSignals")
		? normalizeReplayHintList(options.patch.resetSignals)
		: current.resetSignals;
	const nextSkillDependencies = Object.prototype.hasOwnProperty.call(options.patch, "skillDependencies")
		? normalizeSkillDependencies(options.patch.skillDependencies)
		: current.skillDependencies;
	const nextChildArtifacts = nextArtifactKind === "playbook"
		? (Object.prototype.hasOwnProperty.call(options.patch, "childArtifacts")
			? normalizeChildArtifacts(options.patch.childArtifacts)
			: current.childArtifacts)
		: [];
	const nextPlaybookStages = nextArtifactKind === "playbook"
		? (Object.prototype.hasOwnProperty.call(options.patch, "playbookStages")
			? normalizePlaybookStages(options.patch.playbookStages)
			: current.playbookStages)
		: [];
	const nextWorkerContract = nextArtifactKind === "worker"
		? (Object.prototype.hasOwnProperty.call(options.patch, "workerContract")
			? normalizeWorkerContract(
				options.patch.workerContract,
				current.workerContract
					?? buildWorkerContractFromDraftSeed({
						title: nextTitle,
						objective: nextObjective,
						taskCard: nextTaskCard,
						parameterSlots: nextParameterSlots,
						successCriteria: nextSuccessCriteria,
						uncertainties: nextUncertainties,
						executionPolicy: normalizeExecutionPolicy(current.executionPolicy, {
							steps: nextSteps,
							skillDependencies: nextSkillDependencies,
							existing: current.executionPolicy,
						}),
					}),
			)
			: normalizeWorkerContract(
				current.workerContract,
				current.workerContract
					?? buildWorkerContractFromDraftSeed({
						title: nextTitle,
						objective: nextObjective,
						taskCard: nextTaskCard,
						parameterSlots: nextParameterSlots,
						successCriteria: nextSuccessCriteria,
						uncertainties: nextUncertainties,
						executionPolicy: normalizeExecutionPolicy(current.executionPolicy, {
							steps: nextSteps,
							skillDependencies: nextSkillDependencies,
							existing: current.executionPolicy,
						}),
					}),
			))
		: undefined;
	const nextExecutionPolicy = Object.prototype.hasOwnProperty.call(options.patch, "executionPolicy")
		? normalizeExecutionPolicy(options.patch.executionPolicy, {
			steps: nextSteps,
			skillDependencies: nextSkillDependencies,
			existing: current.executionPolicy,
		})
		: normalizeExecutionPolicy(current.executionPolicy, {
			steps: nextSteps,
			skillDependencies: nextSkillDependencies,
			existing: current.executionPolicy,
		});
	const nextStepRouteOptions = Object.prototype.hasOwnProperty.call(options.patch, "stepRouteOptions")
		? normalizeStepRouteOptions(options.patch.stepRouteOptions, {
			procedure: nextProcedure,
			steps: nextSteps,
			existing: current.stepRouteOptions,
		})
		: normalizeStepRouteOptions(current.stepRouteOptions, {
			procedure: nextProcedure,
			steps: nextSteps,
			existing: current.stepRouteOptions,
		});
	const nextValidation = Object.prototype.hasOwnProperty.call(options.patch, "validation")
		? normalizeValidation(options.patch.validation, current.validation)
		: current.validation;
	const revisionAction = options.action ?? "corrected";
	const revisionChanges = revisionAction === "corrected"
		? summarizeRevisionChanges({
			current,
			nextTitle,
			nextObjective,
			nextIntent,
			nextArtifactKind,
			nextTaskKind,
			nextParameterSlots,
			nextSuccessCriteria,
			nextOpenQuestions,
			nextUncertainties,
			nextTaskCard,
			nextProcedure,
			nextExecutionPolicy,
			nextStepRouteOptions,
			nextReplayPreconditions,
			nextResetSignals,
			nextSkillDependencies,
			nextChildArtifacts,
			nextPlaybookStages,
			nextWorkerContract,
			nextSteps,
			nextValidation,
		})
		: revisionAction === "published"
			? ["status"]
			: ["validation"];
	const updatedAt = Date.now();
	const updated: TaughtTaskDraft = {
		...current,
		title: nextTitle,
		objective: nextObjective,
		intent: nextIntent,
		artifactKind: nextArtifactKind,
		taskKind: nextTaskKind,
		parameterSlots: nextParameterSlots,
		successCriteria: nextSuccessCriteria,
		openQuestions: nextOpenQuestions,
		uncertainties: nextUncertainties,
		taskCard: nextTaskCard,
		procedure: nextProcedure,
		executionPolicy: nextExecutionPolicy,
		stepRouteOptions: nextStepRouteOptions,
		replayPreconditions: nextReplayPreconditions,
		resetSignals: nextResetSignals,
		skillDependencies: nextSkillDependencies,
		childArtifacts: nextChildArtifacts,
		playbookStages: nextPlaybookStages,
		workerContract: nextWorkerContract,
		steps: nextSteps,
		validation: nextValidation
			? {
				...nextValidation,
				updatedAt:
					options.patch.validation
						? updatedAt
						: nextValidation.updatedAt,
			}
			: undefined,
		routeSignature: nextSteps.length > 0 ? nextSteps.map((step) => step.route).join(" -> ") : current.routeSignature,
		updatedAt,
		revisions: [
			...current.revisions,
			{
				revision: current.revisions.length + 1,
				timestamp: updatedAt,
				action: revisionAction,
				actor: "operator",
				summary: buildRevisionSummary({
					action: revisionAction,
					draft: current,
					sourceLabel: current.sourceLabel,
					changes: revisionChanges,
					note: options.note?.trim() || options.patch.note?.trim() || undefined,
				}),
				changes: revisionChanges,
				note: options.note?.trim() || options.patch.note?.trim() || undefined,
			},
		],
	};
	ledger.drafts[draftIndex] = updated;
	ledger.updatedAt = updatedAt;
	ledger.drafts.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
	await persistTaughtTaskDraftLedger(ledger, options.learningDir);
	return updated;
}

/**
 * @deprecated Use updatePersistedTaughtTaskDraft instead.
 */
export async function updateTaughtTaskDraft(
	options: UpdatePersistedTaughtTaskDraftOptions,
): Promise<TaughtTaskDraft> {
	return await updatePersistedTaughtTaskDraft(options);
}

export async function publishTaughtTaskDraft(
	options: PublishTaughtTaskDraftOptions,
): Promise<PublishTaughtTaskDraftResult> {
	const draft = await loadTaughtTaskDraft({
		workspaceDir: options.workspaceDir,
		draftId: options.draftId,
		learningDir: options.learningDir,
	});
	if (!draft) {
		throw new Error(`Task draft not found: ${options.draftId}`);
	}
	const skillsDir = options.skillsDir ?? resolveDefaultTaughtTaskSkillsDir(draft.workspaceDir);
	const name = buildPublishedSkillName(draft, options.name);
	const skillDir = join(skillsDir, name);
	const skillPath = join(skillDir, "SKILL.md");
	if (!options.overwrite) {
		const existing = await stat(skillPath).then(() => true).catch(() => false);
		if (existing) {
			throw new Error(`workspace skill already exists: ${name}`);
		}
	}
	await mkdir(skillDir, { recursive: true });
	await writeFile(
		skillPath,
		buildPublishedSkillMarkdown({
			name,
			draft,
		}),
		"utf8",
	);
	const publishedAt = Date.now();
	const updatedDraft = await updatePersistedTaughtTaskDraft({
		workspaceDir: options.workspaceDir,
		draftId: options.draftId,
		learningDir: options.learningDir,
		patch: {},
		note: `Published to workspace skill ${name}.`,
		action: "published",
	});
	const finalizedDraft: TaughtTaskDraft = {
		...updatedDraft,
		status: "published",
		publishedSkill: {
			name,
			skillDir,
			skillPath,
			publishedAt,
			artifactKind: updatedDraft.artifactKind,
		},
	};
	const revisionIndex = finalizedDraft.revisions.length - 1;
	if (revisionIndex >= 0 && finalizedDraft.revisions[revisionIndex]?.action === "published") {
		finalizedDraft.revisions[revisionIndex] = {
			...finalizedDraft.revisions[revisionIndex],
			summary: buildRevisionSummary({
				action: "published",
				draft: finalizedDraft,
				publishedSkillName: name,
				note: finalizedDraft.revisions[revisionIndex]?.note,
			}),
			changes: ["status", "published skill"],
		};
	}
	await persistTaughtTaskDraft(finalizedDraft, { learningDir: options.learningDir });
	return {
		draft: finalizedDraft,
		skill: finalizedDraft.publishedSkill!,
	};
}

export function buildTaughtTaskDraftPromptContent(
	ledger: TaughtTaskDraftLedger | undefined,
	maxEntries: number = DEFAULT_MAX_PROMPT_DRAFTS,
): string | undefined {
	const entries = (ledger?.drafts ?? []).slice(0, maxEntries);
	if (entries.length === 0) {
		return undefined;
	}
	return [
		"Teach drafts captured from explicit teach/correct events in this workspace. Reuse them only when the current request clearly matches, ask for missing parameters, and keep verification strict.",
		"Prefer semantically equivalent browser, bash, or linked-skill routes over raw GUI replay when they preserve the same externally visible outcome and are more efficient for the agent.",
		"Use step route options as non-binding implementation choices. Prefer the best matching option, and treat detailed replay steps as fallback evidence unless the draft explicitly says the route is fixed.",
		...entries.map((draft) => {
			const params = draft.parameterSlots.map((slot) => slot.name);
			const success = draft.successCriteria.slice(0, 3);
			const uncertainties = draft.uncertainties.slice(0, 2);
			const routeOptions = draft.stepRouteOptions
				.slice(0, DEFAULT_MAX_PROMPT_STEPS)
				.map((option) =>
					`    ${option.procedureStepId}. [${option.preference}:${formatStepRouteOptionTarget(option)}] ${option.instruction}`);
			const steps = draft.steps
				.slice(0, DEFAULT_MAX_PROMPT_STEPS)
				.map((step) => {
					const toolArgsText = step.toolArgs && Object.keys(step.toolArgs).length > 0
						? ` | toolArgs: ${Object.entries(step.toolArgs)
							.map(([key, value]) => `${key}=${describeToolArgumentValue(value)}`)
							.filter((entry) => entry.length > 0)
							.join(", ")}`
						: "";
					return `    ${step.index}. [${step.route}/${step.toolName}] ${step.instruction}${toolArgsText}`;
				});
			return [
					`- ${draft.title}`,
					`  draft_id=${draft.id}`,
					`  artifact_kind=${draft.artifactKind}`,
					`  intent=${draft.objective || draft.intent}`,
					`  route_signature=${draft.routeSignature}`,
					`  execution_policy=${draft.executionPolicy.toolBinding}:${formatExecutionRouteOrder(draft.executionPolicy.preferredRoutes)}:${draft.executionPolicy.stepInterpretation}`,
					...(draft.validation ? [`  validation=${draft.validation.state}`] : []),
					...(params.length > 0 ? [`  parameters=${params.join(", ")}`] : []),
					...(success.length > 0 ? [`  success=${success.join(" | ")}`] : []),
					...(uncertainties.length > 0 ? [`  uncertainties=${uncertainties.join(" | ")}`] : []),
					...(draft.childArtifacts.length > 0
						? [`  child_artifacts=${draft.childArtifacts.map((artifact) => `${artifact.name}[${artifact.artifactKind}]`).join(", ")}`]
						: []),
					...(draft.playbookStages.length > 0
						? [`  playbook_stages=${draft.playbookStages.map((stage) => `${stage.kind}:${stage.name}`).join(" | ")}`]
						: []),
				...(routeOptions.length > 0 ? ["  step_route_options:", ...routeOptions] : []),
				"  steps:",
				...steps,
			].join("\n");
		}),
		"If the current UI or outcome diverges from the taught draft, re-observe and adapt instead of blindly replaying it.",
	].join("\n");
}
