import { basename, join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
	normalizeAssistantDisplayText,
	normalizeTaughtTaskToolArguments,
	resolveUnderstudyHomeDir,
	extractTaughtTaskToolArgumentsFromRecord,
	withTimeout,
	type TaughtTaskDraft,
	type TaughtTaskDraftParameter,
	type TaughtTaskCard,
} from "@understudy/core";
import type {
	GuiDemonstrationRecorder,
	GuiDemonstrationRecordingSession,
} from "@understudy/gui";
import type { ImageContent } from "@mariozechner/pi-ai";
import type { Attachment } from "@understudy/types";
import { asBoolean, asNumber, asRecord, asString, normalizeComparableText, sanitizePathSegment } from "./value-coerce.js";
import {
	type TeachClarificationPayload,
	type TeachClarificationState,
	type TeachDraftValidationResult,
	type TeachSlashCommand,
	asStringList,
	normalizeTeachArtifactKind,
	normalizeTeachTaskCard,
	parseTeachDraftTarget,
	preferTeachText,
	resolveTeachConfirmValidationMode,
	resolveTeachInternalPromptTimeoutMs,
	summarizeTeachDraftPublishBlocker,
	trimToUndefined,
	uniqueStrings,
} from "./teach-normalization.js";
import {
	buildTeachClarificationPrompt,
	buildTeachControlNoisePatch,
	buildTeachDraftValidationPreflight,
	buildTeachDraftValidationPrompt,
	defaultTeachClarificationQuestion,
	inferTeachTaskCardFromDraft,
	normalizeTeachClarificationPayload,
	resolveTeachClarificationQuestion,
	resolveTeachTaskCard,
	TEACH_STEP_TOOL_ARG_RESERVED_KEYS,
} from "./teach-prompts.js";
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
import { extractJsonObject } from "@understudy/tools";
import type { TeachInternalSessionsDeps } from "./teach-internal-sessions.js";
import type { SessionEntry, SessionRunTrace } from "./session-types.js";
import { seedRuntimeMessagesFromHistory, type RunTurnResult } from "./session-history.js";

const TRACE_VALUE_PREVIEW_CHARS = 240;

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

type PromptSessionResult = Awaited<ReturnType<TeachInternalSessionsDeps["promptSession"]>>;

export interface TeachOrchestrationDeps {
	sessionEntries: Map<string, SessionEntry>;
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
	onStateChanged?: () => void;
	demonstrationRecorder: GuiDemonstrationRecorder;
	notifyUser?: (params: {
		entry: SessionEntry;
		text: string;
		title?: string;
		source: "workflow_crystallization";
		details?: Record<string, unknown>;
	}) => Promise<void>;
	taskDraftHandlers: ReturnType<typeof import("./task-drafts.js").createGatewayTaskDraftHandlers>;
	refreshTeachDraftPrompts: (entry: SessionEntry) => Promise<void>;
	refreshPublishedSkillPrompts: (
		entry: SessionEntry,
		published: {
			draft: { objective?: string };
			skill: { name?: string; skillPath?: string };
		},
	) => Promise<string | undefined>;
	storeSessionRunTrace: (entry: SessionEntry, params: {
		runId: string;
		userPrompt: string;
		response: string;
		meta?: Record<string, unknown>;
	}) => SessionRunTrace;
	persistSessionRunTrace?: (params: {
		sessionId: string;
		trace: SessionRunTrace;
	}) => Promise<void>;
	validateTeachDraft: (params: {
		entry: SessionEntry;
		draft: TaughtTaskDraft;
		promptSession: (
			entry: SessionEntry,
			text: string,
			runId?: string,
			promptOptions?: Record<string, unknown>,
		) => Promise<{
			response: string;
			runId: string;
			images?: ImageContent[];
			meta?: Record<string, unknown>;
		}>;
	}) => Promise<TeachDraftValidationResult>;
	buildDirectSessionResponse: (params: {
		entry: SessionEntry;
		userText: string;
		assistantText: string;
		assistantImages?: ImageContent[];
		meta?: Record<string, unknown>;
		historyMedia?: {
			images?: ImageContent[];
			attachments?: Attachment[];
		};
	}) => RunTurnResult;
	buildEphemeralSessionResponse: (params: {
		entry: SessionEntry;
		assistantText: string;
		meta?: Record<string, unknown>;
	}) => RunTurnResult;
	resolveTeachCapabilitySnapshot: (workspaceDir?: string) => import("@understudy/tools").TeachCapabilitySnapshot | undefined;
	runTeachInternalPrompt: (params: {
		entry: SessionEntry;
		kind: "clarify" | "validate";
		prompt: string;
		timeoutMs?: number;
		allowedToolNames?: string[];
		extraSystemPrompt?: string;
		thinkingLevel?: import("@understudy/types").UnderstudyConfig["defaultThinkingLevel"];
	}) => Promise<PromptSessionResult>;
	runTeachValidationReplayPrompt: (params: {
		entry: SessionEntry;
		prompt: string;
		timeoutMs?: number;
	}) => Promise<PromptSessionResult>;
}

export function createTeachOrchestration(deps: TeachOrchestrationDeps) {
	const {
		sessionEntries,
		appendHistory,
		onStateChanged,
		demonstrationRecorder,
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
	} = deps;

	// Shared state — owned by this factory
	const activeTeachRecordings = new Map<string, GuiDemonstrationRecordingSession>();
	const activeTeachClarificationSessions = new Set<string>();

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
		result: PromptSessionResult;
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

	return {
		startTeachRecording,
		validateTeachDraftForEntry,
		updateTeachDraftValidation,
		persistInternalTeachPromptRun,
		clearTeachClarificationForDraft,
		startTeachRecordingFromCommand,
		updateTeachDraftFromClarification,
		applyTeachControlNoisePatch,
		runTeachClarificationPass,
		bootstrapTeachClarification,
		confirmTeachClarification,
		validateExistingTeachDraft,
		publishExistingTeachDraft,
		stopTeachRecording,
		stopTeachRecordingFromCommand,
		handleTeachClarificationTurn,
		buildTeachHelpReport,
		runTeachSlashCommand,
		activeTeachRecordings,
		activeTeachClarificationSessions,
	};
}
