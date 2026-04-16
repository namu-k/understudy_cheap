import {
	lintTaughtTaskDraft,
	type TaughtTaskCard,
	type TaughtTaskDraft,
} from "@understudy/core";
import type { ImageContent } from "@mariozechner/pi-ai";
import {
	extractJsonObject,
	formatTeachCapabilitySnapshotForPrompt,
	type TeachCapabilitySnapshot,
} from "@understudy/tools";
import { asBoolean, asRecord, asString } from "./value-coerce.js";
import {
	asStringList,
	buildTeachGuiReferencePathLines,
	draftExpectsMutatingReplay,
	formatTeachExecutionRouteOrder,
	formatTeachRouteOptionTarget,
	isTeachValidationMutatingTool,
	normalizeTeachArtifactKind,
	normalizeTeachExecutionPolicy,
	normalizeTeachReplayHints,
	normalizeTeachStepRouteOptions,
	normalizeTeachTaskCard,
	normalizeTeachTaskKind,
	normalizeTeachValidationCheck,
	normalizeTeachValidationState,
	preferTeachText,
	summarizeTeachDraftPublishBlocker,
	trimToUndefined,
	uniqueStrings,
	type TeachClarificationPayload,
	type TeachClarificationState,
	type TeachDraftValidationResult,
} from "./teach-normalization.js";
import type { SessionEntry } from "./session-runtime.js";

type PromptSessionFn = (
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

function isTeachControlNoiseText(value: string | undefined): boolean {
	const text = value?.trim();
	if (!text) {
		return false;
	}
	return /^\/teach(?:\s+(?:start|stop|confirm|validate|publish))\b/i.test(text)
		|| /\bctrl\+c\b/i.test(text);
}

function analyzeTeachValidationTrace(meta?: Record<string, unknown>): {
	toolCalls: number;
	failures: string[];
	blockingFailures: string[];
	recoverableFailures: string[];
	toolNames: string[];
	mutatingToolNames: string[];
} {
	const toolTrace = Array.isArray(meta?.toolTrace) ? meta.toolTrace : [];
	let toolCalls = 0;
	const failures: string[] = [];
	const failureEvents: Array<{ index: number; detail: string }> = [];
	const recoveryPoints: number[] = [];
	const toolNames: string[] = [];
	const mutatingToolNames: string[] = [];
	for (let index = 0; index < toolTrace.length; index += 1) {
		const item = toolTrace[index];
		const record = asRecord(item);
		if (!record) {
			continue;
		}
		if (record.type === "toolCall") {
			toolCalls += 1;
			const toolName = trimToUndefined(asString(record.name));
			if (toolName) {
				toolNames.push(toolName);
				if (isTeachValidationMutatingTool(toolName)) {
					mutatingToolNames.push(toolName);
				}
			}
		}
		const statusInfo = asRecord(record.status);
		const statusCode = asString(statusInfo?.code)?.toLowerCase();
		if (record.type === "toolResult" && record.isError !== true) {
			const marksProgress = statusCode
				? ["action_sent", "condition_met", "completed", "observed", "resolved"].includes(statusCode)
				: false;
			if (marksProgress) {
				recoveryPoints.push(index);
			}
		}
		const hasFailureStatus = statusCode
			? ["failed", "blocked", "requires_user", "timeout", "unsupported"].includes(statusCode)
			: false;
		if (record.isError === true || hasFailureStatus) {
			const toolName = asString(record.name) ?? "unknown tool";
			const detail =
				trimToUndefined(asString(record.error))
				?? trimToUndefined(asString(statusInfo?.summary))
				?? statusCode;
			const failure = detail ? `${toolName}: ${detail}` : toolName;
			failures.push(failure);
			failureEvents.push({
				index,
				detail: failure,
			});
		}
	}
	const blockingFailures: string[] = [];
	const recoverableFailures: string[] = [];
	for (const failure of failureEvents) {
		const recovered = recoveryPoints.some((point) => point > failure.index);
		if (recovered) {
			recoverableFailures.push(failure.detail);
			continue;
		}
		blockingFailures.push(failure.detail);
	}
	return {
		toolCalls,
		failures,
		blockingFailures,
		recoverableFailures,
		toolNames: uniqueStrings(toolNames),
		mutatingToolNames: uniqueStrings(mutatingToolNames),
	};
}

function buildTeachDraftValidationPreflight(draft: TaughtTaskDraft): TeachDraftValidationResult | undefined {
	const blocker = summarizeTeachDraftPublishBlocker(draft);
	if (blocker) {
		return {
			state: "unvalidated",
			summary: blocker,
			checks: [
				{
					id: "draft-readiness:review_required",
					ok: false,
					summary: blocker,
					source: "draft",
				},
			],
		};
	}
	const lintIssues = lintTaughtTaskDraft(draft);
	if (lintIssues.length > 0) {
		const summary = `Teach draft is internally inconsistent: ${lintIssues.map((issue) => issue.summary).join(" ")}`;
		return {
			state: "failed",
			summary,
			checks: lintIssues.map((issue) => ({
				id: issue.id,
				ok: false,
				summary: issue.summary,
				source: "draft" as const,
			})),
		};
	}
	if (draft.steps.length === 0) {
		return {
			state: "failed",
			summary: "Teach draft does not contain any taught steps yet.",
			checks: [
				{
					id: "draft-readiness:steps",
					ok: false,
					summary: "Teach draft does not contain any taught steps yet.",
					source: "draft",
				},
			],
		};
	}
	if (draft.successCriteria.length === 0) {
		return {
			state: "failed",
			summary: "Teach draft does not define success criteria yet.",
			checks: [
				{
					id: "draft-readiness:success_criteria",
					ok: false,
					summary: "Teach draft does not define success criteria yet.",
					source: "draft",
				},
			],
		};
	}
	if (draft.procedure.length === 0) {
		return {
			state: "failed",
			summary: "Teach draft does not define a high-level procedure yet.",
			checks: [
				{
					id: "draft-readiness:procedure",
					ok: false,
					summary: "Teach draft does not define a high-level procedure yet.",
					source: "draft",
				},
			],
		};
	}
	if (!draft.objective.trim()) {
		return {
			state: "failed",
			summary: "Teach draft objective is missing.",
			checks: [
				{
					id: "draft-readiness:objective",
					ok: false,
					summary: "Teach draft objective is missing.",
					source: "draft",
				},
			],
		};
	}
	const missingSamples = draft.parameterSlots
		.filter((slot) => slot.required === true && !slot.sampleValue?.trim())
		.map((slot) => slot.name);
	if (missingSamples.length > 0) {
		return {
			state: "failed",
			summary: `Teach draft is missing sample values for required parameters: ${missingSamples.join(", ")}.`,
			checks: [
				{
					id: "draft-readiness:required_parameter_samples",
					ok: false,
					summary: `Teach draft is missing sample values for required parameters: ${missingSamples.join(", ")}.`,
					source: "draft",
				},
			],
		};
	}
	return undefined;
}

function summarizeTeachStepForPrompt(step: TaughtTaskDraft["steps"][number]): Record<string, unknown> {
	return {
		index: step.index,
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
		verificationStatus: step.verificationStatus,
		verificationSummary: step.verificationSummary,
		uncertain: step.uncertain === true,
	};
}

const TEACH_STEP_TOOL_ARG_RESERVED_KEYS = new Set([
	"index",
	"route",
	"toolName",
	"instruction",
	"summary",
	"target",
	"app",
	"scope",
	"inputs",
	"toolArgs",
	"locationHint",
	"windowTitle",
	"captureMode",
	"groundingMode",
	"verificationStatus",
	"verificationSummary",
	"uncertain",
]);

function buildTeachClarificationPrompt(params: {
	draft: TaughtTaskDraft;
	userReply?: string;
	state?: TeachClarificationState;
	capabilitySnapshot?: TeachCapabilitySnapshot;
}): string {
	const draftSummary = {
		id: params.draft.id,
		title: params.draft.title,
		intent: params.draft.intent,
		objective: params.draft.objective,
		artifactKind: params.draft.artifactKind,
		taskKind: params.draft.taskKind,
		parameterSlots: params.draft.parameterSlots,
		successCriteria: params.draft.successCriteria,
		openQuestions: params.draft.openQuestions,
		uncertainties: params.draft.uncertainties,
		taskCard: params.draft.taskCard,
		procedure: params.draft.procedure,
		executionPolicy: params.draft.executionPolicy,
		stepRouteOptions: params.draft.stepRouteOptions,
		replayPreconditions: params.draft.replayPreconditions,
		resetSignals: params.draft.resetSignals,
		skillDependencies: params.draft.skillDependencies,
		childArtifacts: params.draft.childArtifacts,
		playbookStages: params.draft.playbookStages,
		workerContract: params.draft.workerContract,
		steps: params.draft.steps.map((step) => summarizeTeachStepForPrompt(step)),
	};
	return [
		"You are shaping an Understudy teach draft into a reusable task spec through dialogue with the user.",
		"Your primary output is a reusable task card plus a high-level procedure. The raw observed steps are only evidence.",
		"The demo may show only one concrete instance; infer reusable intent only when the user explicitly asks for generalization.",
			"Choose taskKind explicitly: fixed_demo, parameterized_workflow, or batch_workflow.",
			"If taskKind is fixed_demo, parameterSlots must be empty and taskCard.inputs must be empty.",
			"If taskKind is parameterized_workflow, keep semantic parameters and do not leave the procedure hard-coded to only the demo literal value.",
			"If taskKind is batch_workflow, taskCard.loopOver must be populated and the procedure should describe the repeated unit of work.",
			"Default executionPolicy.toolBinding to adaptive. Use fixed only when the route or tool family is part of the task semantics.",
			"Use executionPolicy.preferredRoutes to express route preference, not to mirror the demo mechanically. Usually prefer skill -> browser -> shell -> gui when they preserve the same externally visible result.",
			"Use executionPolicy.stepInterpretation=fallback_replay by default. Only use strict_contract when the exact route or tool sequence is semantically required.",
			"Use stepRouteOptions to capture non-binding implementation choices for specific procedure steps.",
			"stepRouteOptions should list meaningful alternatives such as skill vs shell vs gui. They are examples and preferences, not a strict requirement to use that exact tool.",
			"Use preference=preferred for the best route, fallback for a backup route, and observed for what the demo literally showed.",
			"Choose toolName and skillName values only from the current teach-time capability snapshot.",
			"Do not invent tools or skills that are not present in that snapshot.",
			"Treat recording-control actions such as returning to Understudy, typing `/teach stop`, or sending Ctrl+C as demo-only noise unless the user explicitly wants them kept.",
			"Prefer semantic procedure steps over app-switching trivia and low-level click metadata.",
			"The GUI demonstration is evidence, not an execution ceiling. If a semantically equivalent browser, bash, or existing-skill route would achieve the same externally visible result more efficiently and reliably for an agent, prefer that route in the draft.",
			"Keep raw GUI steps only when direct UI interaction is actually required or when switching to a higher-level route would change the task semantics.",
			"Use any exact runtime function or workspace skill name from the current teach-time capability snapshot when it is the best fit. Do not assume only browser/bash/gui are available.",
		'Review step target descriptions for GUI grounding quality. Each target should quote visible text labels (e.g. \'button labeled "Save"\' not "the save button"), include control role, and have nearby context so the runtime can ground them visually during replay.',
			"Preserve previously confirmed task details unless the user explicitly changes them.",
			"Do not reintroduce an open question when the user's latest reply already answers it.",
			"Do not ask the same clarification again with different wording after the user has already answered it.",
			"When an existing workspace skill cleanly matches a subtask, list it in skillDependencies and reference it in procedure instead of restating low-level UI steps.",
			"Capture replayPreconditions for the minimum required starting state, and resetSignals for when the environment must be restored before replay.",
			"Keep exact replay-only GUI parameters such as button, clicks, holdMs, windowSelector, fromTarget/toTarget, wait state, repeat, and modifiers inside steps[].toolArgs so observed GUI steps stay faithful to the current runtime contract.",
			"When uncertainty remains, keep readyForConfirmation as false and list every material clarification question that still blocks a solid task card.",
			"Prefer 1-3 concise questions when possible, but do not force everything into a single nextQuestion.",
			"Teach confirmation is controlled only by the `/teach confirm` slash command.",
			"When the task card is ready, set readyForConfirmation to true, clear openQuestions and uncertainties, and leave nextQuestion empty.",
			"Use openQuestions and uncertainties as the canonical outstanding issues. nextQuestion is optional shorthand only when a single question is enough.",
			"Choose artifactKind explicitly when the taught result is more than a basic workflow skill. Use playbook for staged orchestration and worker for goal-driven open-ended work.",
			"If artifactKind is worker, provide workerContract with goal, inputs, outputs, allowed routes and surfaces, budget, escalation policy, stop conditions, and decision heuristics.",
			"If artifactKind is playbook, provide childArtifacts and playbookStages. childArtifacts may reference skill or worker artifacts only.",
			"If a playbook stage needs approval, use approvalGate as a short reusable gate name such as delivery_preview, publish_preview, payment_review, or legal_review. Use none only when the stage does not need a named gate.",
			"Return strict JSON only.",
			'Schema: {"title":"...","intent":"...","objective":"...","artifactKind":"skill|worker|playbook","taskKind":"fixed_demo|parameterized_workflow|batch_workflow","parameterSlots":[{"name":"...","label":"...","sampleValue":"...","required":true,"notes":"..."}],"successCriteria":["..."],"openQuestions":["..."],"uncertainties":["..."],"procedure":[{"instruction":"...","kind":"navigate|extract|transform|filter|output|skill|check","skillName":"optional-skill-name","notes":"...","uncertain":false}],"executionPolicy":{"toolBinding":"adaptive|fixed","preferredRoutes":["skill","browser","shell","gui"],"stepInterpretation":"evidence|fallback_replay|strict_contract","notes":["..."]},"stepRouteOptions":[{"procedureStepId":"procedure-1","route":"skill|browser|shell|gui","preference":"preferred|fallback|observed","instruction":"...","toolName":"exact-available-tool-name","skillName":"optional-skill-name","when":"...","notes":"..."}],"replayPreconditions":["..."],"resetSignals":["..."],"skillDependencies":[{"name":"...","reason":"...","required":true}],"childArtifacts":[{"id":"child-1","name":"...","artifactKind":"skill|worker","objective":"...","required":true,"reason":"..."}],"playbookStages":[{"id":"stage-1","name":"...","kind":"skill|worker|inline|approval","refName":"optional-child-name","objective":"...","inputs":["..."],"outputs":["..."],"budgetNotes":["..."],"retryPolicy":"retry_once|skip_with_note|pause_for_human","approvalGate":"none|delivery_preview|publish_preview|payment_review"}],"workerContract":{"goal":"...","scope":"...","inputs":["..."],"outputs":["..."],"allowedRoutes":["skill","browser","shell","gui"],"allowedSurfaces":["..."],"budget":{"maxMinutes":12,"maxActions":60,"maxScreenshots":12},"escalationPolicy":["..."],"stopConditions":["..."],"decisionHeuristics":["..."]},"steps":[{"route":"gui|browser|shell|web|workspace|memory|messaging|automation|system|custom","toolName":"exact-available-tool-name","instruction":"...","summary":"...","target":"...","app":"...","scope":"...","inputs":{"key":"value"},"toolArgs":{"button":0,"clicks":1},"locationHint":"...","windowTitle":"...","captureMode":"...","groundingMode":"...","verificationStatus":"...","verificationSummary":"...","uncertain":false}],"readyForConfirmation":false,"nextQuestion":"...","excludedDemoSteps":["step instruction to exclude"]}',
			"Keep the task card concise and reusable.",
		"Current draft JSON:",
		JSON.stringify(draftSummary, null, 2),
		...(params.capabilitySnapshot
			? formatTeachCapabilitySnapshotForPrompt(params.capabilitySnapshot)
			: []),
		...(params.state?.taskCard
			? [
				"Current task card JSON:",
				JSON.stringify(params.state.taskCard, null, 2),
			]
			: []),
		...(params.state?.pendingQuestions?.length
			? [
				params.userReply
					? "Outstanding clarification topics the user's reply may be addressing:"
					: "Outstanding clarification topics:",
				...params.state.pendingQuestions.map((question, index) => `${index + 1}. ${question}`),
			]
			: []),
		...(params.userReply
			? [`User reply: ${params.userReply}`]
			: ["Bootstrap the clarification: clean the initial task card, remove demo-only noise when obvious, and ask the best next question."]),
	].join("\n");
}

function normalizeTeachClarificationPayload(payload: Record<string, unknown>): TeachClarificationPayload {
	const parameterSlots = Array.isArray(payload.parameterSlots) ? payload.parameterSlots : undefined;
	const successCriteria = Array.isArray(payload.successCriteria) ? payload.successCriteria : undefined;
	const openQuestions = Array.isArray(payload.openQuestions) ? payload.openQuestions : undefined;
	const procedure = Array.isArray(payload.procedure)
		? payload.procedure
		: undefined;
	const skillDependencies = Array.isArray(payload.skillDependencies) ? payload.skillDependencies : undefined;
	const nextQuestion = trimToUndefined(asString(payload.nextQuestion));
	const excludedDemoSteps = Array.isArray(payload.excludedDemoSteps) ? payload.excludedDemoSteps : undefined;
	const taskCard = normalizeTeachTaskCard(
		asRecord(payload.taskCard),
	);
	return {
		title: trimToUndefined(asString(payload.title)),
		intent: trimToUndefined(asString(payload.intent)),
		objective: trimToUndefined(asString(payload.objective)),
		artifactKind: normalizeTeachArtifactKind(payload.artifactKind),
		taskKind: normalizeTeachTaskKind(payload.taskKind),
		parameterSlots: Array.isArray(parameterSlots)
			? parameterSlots.filter((entry): entry is Record<string, unknown> | string =>
					typeof entry === "string" || Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))
			: undefined,
		successCriteria: Array.isArray(successCriteria) ? asStringList(successCriteria) : undefined,
		openQuestions: Array.isArray(openQuestions) ? asStringList(openQuestions) : undefined,
		uncertainties: Array.isArray(payload.uncertainties) ? asStringList(payload.uncertainties) : undefined,
		procedure: Array.isArray(procedure)
			? procedure.filter((entry): entry is Record<string, unknown> | string =>
					typeof entry === "string" || Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))
			: undefined,
		executionPolicy: normalizeTeachExecutionPolicy(payload.executionPolicy),
		stepRouteOptions: normalizeTeachStepRouteOptions(payload.stepRouteOptions),
		replayPreconditions: normalizeTeachReplayHints(payload.replayPreconditions),
		resetSignals: normalizeTeachReplayHints(payload.resetSignals),
		skillDependencies: Array.isArray(skillDependencies)
			? skillDependencies.filter((entry): entry is Record<string, unknown> | string =>
					typeof entry === "string" || Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))
			: undefined,
		childArtifacts: Array.isArray(payload.childArtifacts)
			? payload.childArtifacts.filter((entry): entry is Record<string, unknown> =>
				Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))
			: undefined,
		playbookStages: Array.isArray(payload.playbookStages)
			? payload.playbookStages.filter((entry): entry is Record<string, unknown> =>
				Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))
			: undefined,
		workerContract: asRecord(payload.workerContract),
		steps: Array.isArray(payload.steps)
			? payload.steps.filter((entry): entry is Record<string, unknown> | string =>
				typeof entry === "string" || Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))
			: undefined,
		taskCard,
		summary: trimToUndefined(asString(payload.summary)),
		nextQuestion,
		readyForConfirmation: asBoolean(payload.readyForConfirmation),
		excludedDemoSteps: Array.isArray(excludedDemoSteps) ? asStringList(excludedDemoSteps) : undefined,
	};
}

function inferTeachTaskCardFromDraft(draft: TaughtTaskDraft, previous?: TaughtTaskCard): TaughtTaskCard {
	const baseTaskCard = draft.taskCard;
	const goal = previous?.goal ?? baseTaskCard?.goal ?? trimToUndefined(draft.objective || draft.intent || draft.title);
	const scope = previous?.scope ?? baseTaskCard?.scope ?? "Reusable workflow derived from the demonstration.";
	const loopOver = previous?.loopOver ?? baseTaskCard?.loopOver;
	const extract = previous?.extract && previous.extract.length > 0
		? previous.extract
		: baseTaskCard?.extract && baseTaskCard.extract.length > 0
			? baseTaskCard.extract
			: [];
	const formula = previous?.formula ?? baseTaskCard?.formula;
	const filter = previous?.filter ?? baseTaskCard?.filter;
	const output = previous?.output ?? baseTaskCard?.output;
	return {
		...(goal ? { goal } : {}),
		...(scope ? { scope } : {}),
		...(loopOver ? { loopOver } : {}),
		inputs: previous?.inputs && previous.inputs.length > 0
			? previous.inputs
			: baseTaskCard?.inputs && baseTaskCard.inputs.length > 0
				? baseTaskCard.inputs
				: uniqueStrings(draft.parameterSlots.map((slot) => slot.label || slot.name)),
		extract,
		...(formula ? { formula } : {}),
		...(filter ? { filter } : {}),
		...(output ? { output } : {}),
	};
}

function resolveTeachTaskCard(params: {
	draft: TaughtTaskDraft;
	payload?: TeachClarificationPayload;
	previous?: TaughtTaskCard;
}): TaughtTaskCard {
	const inferred = inferTeachTaskCardFromDraft(params.draft, params.previous);
	const explicit = params.payload?.taskCard;
	return {
		goal: preferTeachText(params.previous?.goal, explicit?.goal, inferred.goal),
		scope: preferTeachText(params.previous?.scope, explicit?.scope, inferred.scope),
		loopOver: preferTeachText(params.previous?.loopOver, explicit?.loopOver, inferred.loopOver),
		inputs: explicit?.inputs && explicit.inputs.length > 0
			? explicit.inputs
			: params.previous?.inputs && params.previous.inputs.length > 0
				? params.previous.inputs
				: inferred.inputs,
		extract: explicit?.extract && explicit.extract.length > 0
			? explicit.extract
			: params.previous?.extract && params.previous.extract.length > 0
				? params.previous.extract
				: inferred.extract,
		...(preferTeachText(params.previous?.formula, explicit?.formula, inferred.formula)
			? { formula: preferTeachText(params.previous?.formula, explicit?.formula, inferred.formula) }
			: {}),
		...(preferTeachText(params.previous?.filter, explicit?.filter, inferred.filter)
			? { filter: preferTeachText(params.previous?.filter, explicit?.filter, inferred.filter) }
			: {}),
		...(preferTeachText(params.previous?.output, explicit?.output, inferred.output)
			? { output: preferTeachText(params.previous?.output, explicit?.output, inferred.output) }
			: {}),
	};
}

function defaultTeachClarificationQuestion(draft: TaughtTaskDraft): string | undefined {
	const pending = uniqueStrings([
		...draft.openQuestions,
		...draft.uncertainties,
	]);
	return pending.length === 1 ? pending[0] : undefined;
}

function resolveTeachClarificationQuestion(params: {
	draft: TaughtTaskDraft;
	preferred?: string;
}): string | undefined {
	const pending = uniqueStrings([
		...params.draft.openQuestions,
		...params.draft.uncertainties,
	]);
	if (pending.length === 0) {
		return undefined;
	}
	const preferred = trimToUndefined(params.preferred);
	if (preferred && pending.includes(preferred)) {
		return preferred;
	}
	return pending.length === 1 ? pending[0] : undefined;
}

function buildTeachControlNoisePatch(draft: TaughtTaskDraft): {
	steps?: TaughtTaskDraft["steps"];
	successCriteria?: string[];
	openQuestions?: string[];
	uncertainties?: string[];
	excludedDemoSteps: string[];
} {
	const keptSteps = draft.steps.filter((step) => {
		const inputsText = step.inputs ? Object.values(step.inputs).join(" ") : "";
		const toolArgsText = step.toolArgs ? JSON.stringify(step.toolArgs) : "";
		const haystack = [
			step.instruction,
			step.summary,
			step.target,
			step.app,
			step.scope,
			step.verificationSummary,
			inputsText,
			toolArgsText,
		].filter(Boolean).join(" ");
		return !isTeachControlNoiseText(haystack);
	});
	const excludedDemoSteps = draft.steps
		.filter((step) => !keptSteps.some((kept) => kept.index === step.index && kept.instruction === step.instruction))
		.map((step) => step.instruction);
	const keptSuccessCriteria = draft.successCriteria.filter((entry) => !isTeachControlNoiseText(entry));
	const keptOpenQuestions = draft.openQuestions.filter((entry) => !isTeachControlNoiseText(entry));
	const keptUncertainties = draft.uncertainties.filter((entry) => !isTeachControlNoiseText(entry));
	return {
		...(keptSteps.length !== draft.steps.length ? { steps: keptSteps } : {}),
		...(keptSuccessCriteria.length !== draft.successCriteria.length ? { successCriteria: keptSuccessCriteria } : {}),
		...(keptOpenQuestions.length !== draft.openQuestions.length ? { openQuestions: keptOpenQuestions } : {}),
		...(keptUncertainties.length !== draft.uncertainties.length ? { uncertainties: keptUncertainties } : {}),
		excludedDemoSteps,
	};
}

function buildTeachDraftValidationPrompt(draft: TaughtTaskDraft): string {
	const request =
		trimToUndefined(draft.objective)
		?? trimToUndefined(draft.intent)
		?? trimToUndefined(draft.title)
		?? "Please complete the taught task.";
	const procedure = draft.procedure.length > 0
		? draft.procedure.map((step) => step.instruction)
		: draft.steps.map((step) => step.instruction);
	const taskCardLines = [
		trimToUndefined(draft.taskCard?.goal) ? `Goal: ${trimToUndefined(draft.taskCard?.goal)}` : undefined,
		trimToUndefined(draft.taskCard?.scope) ? `Scope: ${trimToUndefined(draft.taskCard?.scope)}` : undefined,
		trimToUndefined(draft.taskCard?.loopOver) ? `Loop over: ${trimToUndefined(draft.taskCard?.loopOver)}` : undefined,
		Array.isArray(draft.taskCard?.inputs) && draft.taskCard.inputs.length > 0
			? `Inputs: ${draft.taskCard.inputs.join("; ")}`
			: undefined,
		Array.isArray(draft.taskCard?.extract) && draft.taskCard.extract.length > 0
			? `Extract: ${draft.taskCard.extract.join("; ")}`
			: undefined,
		trimToUndefined(draft.taskCard?.formula) ? `Formula: ${trimToUndefined(draft.taskCard?.formula)}` : undefined,
		trimToUndefined(draft.taskCard?.filter) ? `Filter: ${trimToUndefined(draft.taskCard?.filter)}` : undefined,
		trimToUndefined(draft.taskCard?.output) ? `Output: ${trimToUndefined(draft.taskCard?.output)}` : undefined,
	].filter((value): value is string => Boolean(value));
	const successCriteriaLines = draft.successCriteria
		.map((entry) => trimToUndefined(entry))
		.filter((value): value is string => Boolean(value))
		.map((value, index) => `${index + 1}. ${value}`);
	const sampleValues = draft.parameterSlots
		.map((slot) => {
			const sampleValue = trimToUndefined(slot.sampleValue);
			if (!sampleValue) {
				return undefined;
			}
			return `${trimToUndefined(slot.label) ?? slot.name}: ${sampleValue}`;
		})
		.filter((value): value is string => Boolean(value));
	const executionPolicyLines = [
		`- Tool binding: ${draft.executionPolicy.toolBinding}`,
		...(formatTeachExecutionRouteOrder(draft.executionPolicy.preferredRoutes)
			? [`- Preferred routes: ${formatTeachExecutionRouteOrder(draft.executionPolicy.preferredRoutes)}`]
			: []),
		`- Detailed steps meaning: ${draft.executionPolicy.stepInterpretation}`,
		...draft.executionPolicy.notes.map((note) => `- ${note}`),
	];
	const stepRouteOptionLines = draft.procedure.flatMap((step) => {
		const options = draft.stepRouteOptions.filter((option) => option.procedureStepId === step.id);
		if (options.length === 0) {
			return [];
		}
		return [
			`${step.index}. ${step.instruction}`,
			...options.flatMap((option) => [
				`- [${option.preference}] [${formatTeachRouteOptionTarget(option)}] ${option.instruction}`,
				...(option.when ? [`  when: ${option.when}`] : []),
				...(option.notes ? [`  notes: ${option.notes}`] : []),
			]),
		];
	});
	const procedureLines = draft.procedure.map((step) => `${step.index}. ${step.instruction}`);
	const guiReferencePathLines = buildTeachGuiReferencePathLines({
		procedure: draft.procedure,
		stepRouteOptions: draft.stepRouteOptions,
		steps: draft.steps,
	});
	return [
		request,
		...(sampleValues.length > 0
			? [`Use these sample values if the task needs concrete inputs: ${sampleValues.join("; ")}.`]
			: []),
		"Return only JSON.",
		"Required JSON shape:",
		JSON.stringify({
			state: "validated",
			summary: "Short outcome summary.",
			checks: [
				{
					ok: true,
					summary: "Concrete validation check.",
					details: "Optional supporting detail.",
				},
			],
		}),
		"Validation instructions:",
		"- Treat this as a fresh replay, not a passive inspection of the already-finished demo state.",
		"- Prefer a newly opened tab/window/app or another freshly entered surface when possible, instead of reusing an existing page or UI that may already reflect the completed result.",
		"- Do not count the task as validated just because the end state from the demonstration is still visible. Recreate the decisive state transition or report that reset is required.",
		"- If a semantically equivalent browser, bash, or linked-skill route reaches the same externally visible outcome more directly and reliably, prefer it over raw GUI replay.",
		"- Mark state as `validated` only if the task was actually replayed and the success criteria are satisfied.",
		"- If an exploratory attempt fails but a later attempt recovers and reaches the success criteria, report the final successful outcome in JSON and mention the recovery in `checks` instead of treating it as an automatic failure.",
		...(procedureLines.length > 0
			? [`Staged workflow:\n${procedureLines.join("\n")}`]
			: []),
		...(guiReferencePathLines.length > 0
			? [`GUI reference path (reference only):\n${guiReferencePathLines.join("\n")}`]
			: []),
		...(executionPolicyLines.length > 0
			? [`Execution policy:\n${executionPolicyLines.join("\n")}`]
			: []),
		...(stepRouteOptionLines.length > 0
			? [`Step route options (non-binding, prefer the best matching option first):\n${stepRouteOptionLines.join("\n")}`]
			: []),
		...(taskCardLines.length > 0
			? [`Task card:\n${taskCardLines.join("\n")}`]
			: []),
		...(successCriteriaLines.length > 0
			? [`Success criteria:\n${successCriteriaLines.join("\n")}`]
			: []),
		...(draft.replayPreconditions.length > 0
			? [
				"Replay preconditions:",
				...draft.replayPreconditions.map((entry) => `- ${entry}`),
			]
			: []),
		...(draft.resetSignals.length > 0
			? [
				"Reset signals:",
				...draft.resetSignals.map((entry) => `- ${entry}`),
			]
			: []),
		...(draft.skillDependencies.length > 0
			? [
				"Reusable skill dependencies:",
				...draft.skillDependencies.map((dependency) =>
					`- ${dependency.name}${dependency.reason ? `: ${dependency.reason}` : ""}`,
				),
			]
			: []),
		...(procedure.length > 0
			? [
				"Expected procedure:",
				...procedure.map((step, index) => `${index + 1}. ${step}`),
			]
			: []),
		...(trimToUndefined(draft.taskCard?.output)
			? [`Target outcome: ${trimToUndefined(draft.taskCard?.output)}.`]
			: []),
	].join("\n\n");
}

export async function defaultTeachDraftValidator(params: {
	entry: SessionEntry;
	draft: TaughtTaskDraft;
	promptSession: PromptSessionFn;
}): Promise<TeachDraftValidationResult> {
	const prompt = buildTeachDraftValidationPrompt(params.draft);
	const result = await params.promptSession(params.entry, prompt);
	let parsed: Record<string, unknown>;
	let parseError: string | undefined;
	try {
		parsed = extractJsonObject(result.response);
	} catch (error) {
		parsed = {};
		parseError = error instanceof Error ? error.message : String(error);
	}
	const checks = Array.isArray(parsed.checks)
		? parsed.checks
			.map((entry, index) => normalizeTeachValidationCheck(entry, index, "replay"))
			.filter((entry): entry is TeachDraftValidationResult["checks"][number] => Boolean(entry))
		: [];
	let state = normalizeTeachValidationState(parsed.state) ?? "failed";
	const trace = analyzeTeachValidationTrace(result.meta);
	const expectsMutation = draftExpectsMutatingReplay(params.draft);
	const missingReplay = trace.toolCalls === 0 || (expectsMutation && trace.mutatingToolNames.length === 0);
	const toolVerifications = Array.isArray(result.meta?.toolTrace)
		? result.meta.toolTrace
			.map((entry) => asRecord(entry))
			.map((entry) => asRecord(entry?.status))
			.filter((entry): entry is Record<string, unknown> => Boolean(entry))
		: [];
		const positiveVerification = toolVerifications.find((entry) => {
			const statusCode = trimToUndefined(asString(entry.code))?.toLowerCase();
			return statusCode === "condition_met" || statusCode === "observed" || statusCode === "completed";
		});
	if (trace.blockingFailures.length > 0) {
		state = "failed";
	}
	if (trace.blockingFailures.length === 0 && missingReplay) {
		state = "requires_reset";
	}
	if (parseError && !missingReplay && trace.blockingFailures.length === 0 && positiveVerification) {
		state = "validated";
	}
	const defaultSummary = state === "validated"
		? "Replay validation re-ran the taught task and satisfied the success criteria."
		: state === "requires_reset"
			? "Current workspace state needs reset before a faithful replay validation can run."
			: "Teach replay validation could not complete the taught task successfully.";
	const traceDerivedSummary = trimToUndefined(asString(positiveVerification?.summary));
	const summary = trimToUndefined(asString(parsed.summary))
		?? (parseError && traceDerivedSummary ? traceDerivedSummary : undefined)
		?? defaultSummary;
	const nextChecks = checks.length > 0
		? checks
		: [{
			id: "teach-validation:result",
			ok: state === "validated",
			summary,
			source: "replay" as const,
		}];
	if (trace.blockingFailures.length > 0) {
		nextChecks.push({
			id: "teach-validation:tool_failures",
			ok: false,
			summary: "Validation tools reported blocking failures.",
			details: trace.blockingFailures.join(" | "),
			source: "replay",
		});
	}
	if (trace.recoverableFailures.length > 0) {
		nextChecks.push({
			id: "teach-validation:recovered_failures",
			ok: true,
			summary: "Validation recovered from earlier tool failures and still completed the replay.",
			details: trace.recoverableFailures.join(" | "),
			source: "replay",
		});
	}
	if (trace.toolCalls === 0) {
		nextChecks.push({
			id: "teach-validation:no_replay",
			ok: false,
			summary: "Validation did not perform any replay actions or inspections.",
			source: "replay",
		});
	}
	if (expectsMutation && trace.mutatingToolNames.length === 0) {
		nextChecks.push({
			id: "teach-validation:no_mutating_replay",
			ok: false,
			summary: "Validation did not use any mutating tools, so the taught workflow was not actually replayed.",
			source: "replay",
		});
	}
	if (parseError) {
		nextChecks.push({
			id: "teach-validation:json_fallback",
			ok: false,
			summary: "Validation did not return valid JSON, so the result was normalized from the replay trace.",
			details: parseError,
			source: "replay",
		});
	}
	nextChecks.push({
		id: "teach-validation:tool_summary",
		ok: trace.toolCalls > 0,
		summary: trace.toolNames.length > 0
			? `Validation used tools: ${trace.toolNames.join(", ")}`
			: "Validation used no tools.",
		source: "replay",
	});
	return {
		state,
		summary:
			missingReplay
				? expectsMutation
					? "Teach validation did not perform a real replay of the taught task, so the draft still needs reset-aware replay validation."
					: "Teach validation did not perform any concrete replay actions, so the draft still needs replay validation."
				: summary,
		checks: nextChecks,
		runId: result.runId,
		response: result.response,
		meta: result.meta,
		mode: "replay",
		usedMutatingTools: trace.mutatingToolNames.length > 0,
		toolNames: trace.toolNames,
		mutatingToolNames: trace.mutatingToolNames,
	};
}

export {
	analyzeTeachValidationTrace,
	buildTeachClarificationPrompt,
	buildTeachControlNoisePatch,
	buildTeachDraftValidationPreflight,
	buildTeachDraftValidationPrompt,
	defaultTeachClarificationQuestion,
	inferTeachTaskCardFromDraft,
	normalizeTeachClarificationPayload,
	resolveTeachClarificationQuestion,
	resolveTeachTaskCard,
	summarizeTeachStepForPrompt,
	TEACH_STEP_TOOL_ARG_RESERVED_KEYS,
};
