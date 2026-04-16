import { asNumber, asRecord, asString } from "./value-helpers.js";
import {
	normalizeWorkspacePlaybookApprovalGate,
	type WorkspaceArtifactKind,
} from "./workspace-artifact-types.js";
import type {
	TaughtTaskToolArgumentPrimitive,
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
	TaughtTaskDraftValidationCheck,
	TaughtTaskDraftValidation,
	TaughtTaskDraft,
	TaughtTaskDraftLintIssue,
} from "./task-draft-types.js";

const TRACE_VARIABLE_ARGUMENT_KEYS = new Set([
	"value",
	"text",
	"query",
	"url",
	"path",
	"command",
	"message",
	"subject",
	"body",
	"name",
	"title",
	"input",
	"prompt",
	"to",
]);
const TRACE_HINT_ARGUMENT_KEYS = new Set([
	"target",
	"app",
	"scope",
]);
const STEP_TOOL_ARG_RESERVED_KEYS = new Set([
	...TRACE_VARIABLE_ARGUMENT_KEYS,
	...TRACE_HINT_ARGUMENT_KEYS,
	"id",
	"index",
	"route",
	"toolName",
	"instruction",
	"summary",
	"locationHint",
	"windowTitle",
	"captureMode",
	"groundingMode",
	"inputs",
	"verificationStatus",
	"verificationSummary",
	"uncertain",
]);

const DEFAULT_EXECUTION_ROUTE_ORDER: TaughtTaskExecutionRoute[] = [
	"browser",
	"shell",
	"gui",
];

function normalizeToolArgumentPrimitive(value: unknown): TaughtTaskToolArgumentPrimitive | undefined {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return value;
	}
	return undefined;
}

function normalizeToolArgumentValue(value: unknown): TaughtTaskToolArgumentValue | undefined {
	const primitive = normalizeToolArgumentPrimitive(value);
	if (primitive !== undefined) {
		return primitive;
	}
	if (Array.isArray(value)) {
		const normalized = value
			.map((entry) => normalizeToolArgumentPrimitive(entry))
			.filter((entry): entry is TaughtTaskToolArgumentPrimitive => entry !== undefined);
		return normalized.length > 0 ? normalized : undefined;
	}
	const record = asRecord(value);
	if (!record) {
		return undefined;
	}
	const entries = Object.entries(record)
		.map(([key, entry]) => [key, normalizeToolArgumentPrimitive(entry)] as const)
		.filter((entry): entry is [string, TaughtTaskToolArgumentPrimitive] => entry[1] !== undefined);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function normalizeTaughtTaskToolArguments(value: unknown): TaughtTaskToolArguments | undefined {
	const record = asRecord(value);
	if (!record) {
		return undefined;
	}
	const entries = Object.entries(record)
		.map(([key, entry]) => [key, normalizeToolArgumentValue(entry)] as const)
		.filter((entry): entry is [string, TaughtTaskToolArgumentValue] => entry[1] !== undefined);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function extractTaughtTaskToolArgumentsFromRecord(
	record: Record<string, unknown>,
	reservedKeys: Iterable<string>,
): TaughtTaskToolArguments | undefined {
	const reserved = new Set(reservedKeys);
	const filtered = Object.fromEntries(
		Object.entries(record).filter(([key]) => !reserved.has(key)),
	);
	return normalizeTaughtTaskToolArguments(filtered);
}

export function stripTimestampEnvelope(promptPreview: string): string {
	return promptPreview.replace(/^\[[^\]]+\]\s*/, "").trim();
}

function truncateText(value: string, maxChars: number = 180): string {
	const trimmed = value.trim();
	return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}...` : trimmed;
}

function humanizeLabel(key: string): string {
	return key
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\w/, (char) => char.toUpperCase());
}

function inferProcedureKind(_instruction: string, skillName?: string): TaughtTaskProcedureStep["kind"] {
	if (skillName) {
		return "skill";
	}
	return undefined;
}

function normalizeExecutionRoute(value: string | undefined): TaughtTaskExecutionRoute | undefined {
	switch (value?.trim().toLowerCase()) {
		case "skill":
			return "skill";
		case "browser":
			return "browser";
		case "shell":
		case "bash":
			return "shell";
		case "gui":
			return "gui";
		default:
			return undefined;
	}
}

function normalizeExecutionRouteList(
	values: Array<TaughtTaskExecutionRoute | string> | undefined,
	fallback: TaughtTaskExecutionRoute[],
): TaughtTaskExecutionRoute[] {
	const next = Array.isArray(values)
		? values
			.map((entry) => normalizeExecutionRoute(typeof entry === "string" ? entry : entry))
			.filter((entry): entry is TaughtTaskExecutionRoute => Boolean(entry))
		: [];
	return Array.from(new Set(next.length > 0 ? next : fallback));
}

export function inferExecutionPolicy(params: {
	steps: TaughtTaskDraftStep[];
	skillDependencies: TaughtTaskSkillDependency[];
}): TaughtTaskExecutionPolicy {
	const preferredRoutes: TaughtTaskExecutionRoute[] = [
		...(params.skillDependencies.length > 0 ? ["skill" as const] : []),
		...DEFAULT_EXECUTION_ROUTE_ORDER,
	];
	const notes = normalizeLineList([
		"Learn the workflow, not the exact tool sequence.",
		"Prefer semantically equivalent `browser`, `bash`, or linked skill routes before raw GUI replay when they preserve the same externally visible result.",
		"Use step route options as non-binding implementation choices for each major procedure step.",
		"Treat detailed steps as fallback replay hints from the demonstration, not as the only contract.",
		...(params.steps.some((step) =>
			step.route === "gui" && (step.toolName === "gui_drag" || step.captureMode === "display"))
			? ["Some observed interactions may still require GUI replay when no equivalent structured route exists."]
			: []),
	]);
	return {
		toolBinding: "adaptive",
		preferredRoutes: Array.from(new Set(preferredRoutes)),
		stepInterpretation: "fallback_replay",
		notes,
	};
}

export function normalizeExecutionPolicy(
	value: TaughtTaskExecutionPolicy | undefined,
	params: {
		steps: TaughtTaskDraftStep[];
		skillDependencies: TaughtTaskSkillDependency[];
		existing?: TaughtTaskExecutionPolicy;
	},
): TaughtTaskExecutionPolicy {
	const inferred = inferExecutionPolicy({
		steps: params.steps,
		skillDependencies: params.skillDependencies,
	});
	const existing = params.existing ?? inferred;
	if (!value) {
		return existing;
	}
	const notes = normalizeLineList(value.notes).slice(0, 8);
	return {
		toolBinding: value.toolBinding === "fixed" ? "fixed" : "adaptive",
		preferredRoutes: normalizeExecutionRouteList(value.preferredRoutes, existing.preferredRoutes),
		stepInterpretation:
			value.stepInterpretation === "evidence" ||
			value.stepInterpretation === "fallback_replay" ||
			value.stepInterpretation === "strict_contract"
				? value.stepInterpretation
				: existing.stepInterpretation,
		notes: notes.length > 0 ? notes : existing.notes,
	};
}

function areExecutionPolicyEqual(left: TaughtTaskExecutionPolicy, right: TaughtTaskExecutionPolicy): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function formatExecutionRouteOrder(routes: TaughtTaskExecutionRoute[]): string {
	return routes.join(" -> ");
}

export function describeDetailedStepUsage(policy: TaughtTaskExecutionPolicy): string {
	switch (policy.stepInterpretation) {
		case "evidence":
			return "Use these structured step details as evidence from the demonstration, not as the only contract.";
		case "strict_contract":
			return "Treat these structured step details as the strict execution contract for this task.";
		default:
			return "Use these structured step details as fallback replay hints when a higher-level route is unavailable or would change the task semantics.";
	}
}

function normalizeRouteOptionPreference(
	value: string | undefined,
): TaughtTaskStepRouteOption["preference"] | undefined {
	switch (value?.trim().toLowerCase()) {
		case "preferred":
			return "preferred";
		case "fallback":
			return "fallback";
		case "observed":
			return "observed";
		default:
			return undefined;
	}
}

function inferStepRouteOptions(params: {
	procedure: TaughtTaskProcedureStep[];
	steps: TaughtTaskDraftStep[];
}): TaughtTaskStepRouteOption[] {
	const options: TaughtTaskStepRouteOption[] = [];
	for (const procedureStep of params.procedure) {
		if (procedureStep.kind === "skill" && procedureStep.skillName) {
			options.push({
				id: `${procedureStep.id}-route-1`,
				procedureStepId: procedureStep.id,
				route: "skill",
				preference: "preferred",
				instruction: `Delegate this subtask to workspace skill \`${procedureStep.skillName}\`.`,
				skillName: procedureStep.skillName,
				notes: procedureStep.notes,
			});
		}
		const observedStep = params.steps[procedureStep.index - 1];
		if (!observedStep) {
			continue;
		}
		const observedRoute = normalizeExecutionRoute(observedStep.route) ?? normalizeExecutionRoute(observedStep.toolName);
		if (!observedRoute) {
			continue;
		}
		options.push({
			id: `${procedureStep.id}-route-${options.filter((option) => option.procedureStepId === procedureStep.id).length + 1}`,
			procedureStepId: procedureStep.id,
			route: observedRoute,
			preference: "observed",
			instruction: observedStep.instruction,
			toolName: observedStep.toolName,
			notes: observedStep.summary ?? observedStep.verificationSummary,
		});
	}
	return options;
}

export function normalizeStepRouteOptions(
	values: Array<Partial<TaughtTaskStepRouteOption>> | undefined,
	params: {
		procedure: TaughtTaskProcedureStep[];
		steps: TaughtTaskDraftStep[];
		existing?: TaughtTaskStepRouteOption[];
	},
): TaughtTaskStepRouteOption[] {
	const inferred = inferStepRouteOptions({
		procedure: params.procedure,
		steps: params.steps,
	});
	if (!Array.isArray(values)) {
		return params.existing ?? inferred;
	}
	const validProcedureIds = new Set(params.procedure.map((step) => step.id));
	const next: TaughtTaskStepRouteOption[] = [];
	for (const [index, value] of values.entries()) {
		const procedureStepId = value.procedureStepId?.trim();
		if (!procedureStepId || !validProcedureIds.has(procedureStepId)) {
			continue;
		}
		const route =
			normalizeExecutionRoute(value.route) ||
			(value.skillName?.trim() ? "skill" : normalizeExecutionRoute(value.toolName));
		if (!route) {
			continue;
		}
		const instruction =
			value.instruction?.trim() ||
			(route === "skill" && value.skillName?.trim()
				? `Delegate this subtask to workspace skill \`${value.skillName.trim()}\`.`
				: `Use the ${route} route for this procedure step.`);
		const preference = normalizeRouteOptionPreference(value.preference) ?? "preferred";
		const skillName = value.skillName?.trim() || undefined;
		if (route === "skill" && !skillName) {
			continue;
		}
		next.push({
			id: value.id?.trim() || `${procedureStepId}-route-${index + 1}`,
			procedureStepId,
			route,
			preference,
			instruction,
			...(value.toolName?.trim() ? { toolName: value.toolName.trim() } : {}),
			...(skillName ? { skillName } : {}),
			...(value.when?.trim() ? { when: value.when.trim() } : {}),
			...(value.notes?.trim() ? { notes: value.notes.trim() } : {}),
		});
	}
	return next;
}

function areStepRouteOptionsEqual(left: TaughtTaskStepRouteOption[], right: TaughtTaskStepRouteOption[]): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function formatStepRouteOptionTarget(option: TaughtTaskStepRouteOption): string {
	if (option.route === "skill" && option.skillName) {
		return `${option.route}/${option.skillName}`;
	}
	return option.toolName ? `${option.route}/${option.toolName}` : option.route;
}

export function rankRouteOptionPreference(
	preference: TaughtTaskStepRouteOption["preference"],
): number {
	switch (preference) {
		case "observed":
			return 0;
		case "preferred":
			return 1;
		case "fallback":
			return 2;
		default:
			return 3;
	}
}

function normalizeReferenceMatchTokens(value: string | undefined): string[] {
	const normalized = value
		?.toLowerCase()
		.replace(/[`"'""'()\[\]{}?!.,;:/\\|+-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (!normalized) {
		return [];
	}
	return Array.from(new Set(
		normalized
			.split(" ")
			.map((entry) => entry.trim())
			.filter((entry) => entry.length >= 2),
	));
}

function scoreReferenceStepMatch(queryTokens: string[], step: TaughtTaskDraftStep): number {
	if (queryTokens.length === 0) {
		return 0;
	}
	const stepTokens = new Set(normalizeReferenceMatchTokens([
		step.instruction,
		step.summary,
		step.target,
		step.app,
		step.scope,
		step.locationHint,
		step.windowTitle,
		step.toolArgs ? JSON.stringify(step.toolArgs) : undefined,
	].filter(Boolean).join(" ")));
	let score = 0;
	for (const token of queryTokens) {
		if (stepTokens.has(token)) {
			score += 1;
		}
	}
	return score;
}

export function findDetailedStepForProcedureStep(params: {
	draft: TaughtTaskDraft;
	procedureStep: TaughtTaskProcedureStep;
	preferredToolName?: string;
	preferredInstruction?: string;
}): TaughtTaskDraftStep | undefined {
	const queryTokens = normalizeReferenceMatchTokens([
		params.preferredInstruction,
		params.procedureStep.instruction,
		params.procedureStep.notes,
	].filter(Boolean).join(" "));
	const candidates = params.preferredToolName
		? params.draft.steps.filter((step) => step.toolName === params.preferredToolName)
		: params.draft.steps;
	const scored = (candidates.length > 0 ? candidates : params.draft.steps)
		.map((step) => ({
			step,
			score: scoreReferenceStepMatch(queryTokens, step),
		}))
		.sort((left, right) => right.score - left.score || left.step.index - right.step.index);
	return scored[0]?.step;
}

export function normalizeTaskCard(value: TaughtTaskCard | undefined, existing?: TaughtTaskCard): TaughtTaskCard | undefined {
	if (!value && !existing) {
		return undefined;
	}
	const goal = value?.goal?.trim() || existing?.goal?.trim() || undefined;
	const scope = value?.scope?.trim() || existing?.scope?.trim() || undefined;
	const loopOver = value?.loopOver?.trim() || existing?.loopOver?.trim() || undefined;
	const inputs = normalizeLineList(value?.inputs ?? existing?.inputs ?? []);
	const extract = normalizeLineList(value?.extract ?? existing?.extract ?? []);
	const formula = value?.formula?.trim() || existing?.formula?.trim() || undefined;
	const filter = value?.filter?.trim() || existing?.filter?.trim() || undefined;
	const output = value?.output?.trim() || existing?.output?.trim() || undefined;
	if (!goal && !scope && !loopOver && inputs.length === 0 && extract.length === 0 && !formula && !filter && !output) {
		return undefined;
	}
	return {
		...(goal ? { goal } : {}),
		...(scope ? { scope } : {}),
		...(loopOver ? { loopOver } : {}),
		inputs,
		extract,
		...(formula ? { formula } : {}),
		...(filter ? { filter } : {}),
		...(output ? { output } : {}),
	};
}

export function buildTaskCardFromDraftSeed(params: {
	title: string;
	objective: string;
	parameterSlots: TaughtTaskDraftParameter[];
	successCriteria: string[];
	procedure: TaughtTaskProcedureStep[];
}): TaughtTaskCard | undefined {
	const inputs = normalizeLineList(params.parameterSlots.map((slot) => slot.label || humanizeLabel(slot.name)));
	const output = normalizeLineList(params.successCriteria)[0];
	return normalizeTaskCard({
		goal: params.objective || params.title,
		scope: "Reusable workflow derived from the demonstration.",
		inputs,
		extract: [],
		...(output ? { output } : {}),
	});
}

export function buildWorkerContractFromDraftSeed(params: {
	title: string;
	objective: string;
	taskCard?: TaughtTaskCard;
	parameterSlots: TaughtTaskDraftParameter[];
	successCriteria: string[];
	uncertainties?: string[];
	executionPolicy: TaughtTaskExecutionPolicy;
}): TaughtTaskWorkerContract | undefined {
	const goal = params.taskCard?.goal ?? params.objective ?? params.title;
	const outputs = normalizeLineList([
		...(params.taskCard?.extract ?? []),
		...(params.taskCard?.output ? [params.taskCard.output] : []),
		...params.successCriteria,
	]);
	return normalizeWorkerContract({
		goal,
		scope: params.taskCard?.scope ?? "Goal-driven reusable worker.",
		inputs: params.parameterSlots.map((slot) => slot.label || humanizeLabel(slot.name)),
		outputs,
		allowedRoutes: params.executionPolicy.preferredRoutes,
		allowedSurfaces: ["Current task surface", "Supporting workspace windows when required"],
		escalationPolicy: normalizeLineList(params.uncertainties ?? []),
		stopConditions: normalizeLineList(params.successCriteria),
		decisionHeuristics: [
			"Prefer evidence-producing actions over exhaustive blind traversal.",
			"Stop once the required outputs are sufficiently supported.",
		],
	});
}

export function normalizeTaskKind(value: string | undefined): TaughtTaskKind | undefined {
	switch (value?.trim().toLowerCase()) {
		case "fixed_demo":
			return "fixed_demo";
		case "parameterized_workflow":
			return "parameterized_workflow";
		case "batch_workflow":
			return "batch_workflow";
		default:
			return undefined;
	}
}

function detectBatchWorkflowLanguage(values: Array<string | undefined>): boolean {
	return values.some((value) =>
		/\b(each|every|all|for each|iterate|loop over|batch|top \d+|first \d+|across)\b/i.test(value ?? ""),
	);
}

function detectFixedDemoLanguage(values: Array<string | undefined>): boolean {
	return values.some((value) =>
		/\b(fixed|exact|exactly|specific|single|one-off|compute the fixed expression|the fixed expression)\b/i.test(value ?? ""),
	);
}

export function inferTaskKind(params: {
	taskKind?: TaughtTaskKind;
	objective?: string;
	taskCard?: TaughtTaskCard;
	parameterSlots: TaughtTaskDraftParameter[];
	procedure: TaughtTaskProcedureStep[];
	steps: TaughtTaskDraftStep[];
}): TaughtTaskKind {
	if (params.taskKind) {
		return params.taskKind;
	}
	const textValues = [
		params.objective,
		params.taskCard?.goal,
		params.taskCard?.scope,
		params.taskCard?.loopOver,
		...params.procedure.map((step) => step.instruction),
		...params.steps.map((step) => step.instruction),
	];
	if (params.taskCard?.loopOver || detectBatchWorkflowLanguage(textValues)) {
		return "batch_workflow";
	}
	if (detectFixedDemoLanguage(textValues)) {
		return "fixed_demo";
	}
	if (params.parameterSlots.length > 0) {
		return "parameterized_workflow";
	}
	return "fixed_demo";
}

export function normalizeReplayHintList(values: string[] | undefined): string[] {
	return normalizeLineList(values).slice(0, 12);
}

export function alignTaskCardToTaskKind(params: {
	taskCard: TaughtTaskCard | undefined;
	taskKind: TaughtTaskKind;
	parameterSlots: TaughtTaskDraftParameter[];
}): TaughtTaskCard | undefined {
	const taskCard = params.taskCard;
	if (!taskCard) {
		return undefined;
	}
	const derivedInputs = normalizeLineList(
		params.parameterSlots.map((slot) => slot.label || humanizeLabel(slot.name)),
	);
	return normalizeTaskCard({
		...taskCard,
		inputs:
			params.taskKind === "fixed_demo"
				? []
				: taskCard.inputs.length > 0
					? taskCard.inputs
					: derivedInputs,
		...(params.taskKind === "batch_workflow"
			? {}
			: { loopOver: undefined }),
	});
}

export function buildProcedureFromSteps(steps: TaughtTaskDraftStep[]): TaughtTaskProcedureStep[] {
	return steps.map((step, index) => {
		const kind = inferProcedureKind(step.instruction);
		return {
			id: `procedure-${index + 1}`,
			index: index + 1,
			instruction: step.instruction,
			...(kind ? { kind } : {}),
			...(step.verificationSummary ? { notes: step.verificationSummary } : {}),
			uncertain: step.uncertain === true,
		};
	});
}

export function draftTitleFromPrompt(promptPreview: string): string {
	const raw = stripTimestampEnvelope(promptPreview);
	if (!raw) {
		return "Teach draft";
	}
	const compact = raw.replace(/\s+/g, " ").trim();
	return compact.length <= 72 ? compact : `${compact.slice(0, 72)}...`;
}

function inferRoute(name?: string, explicitRoute?: string): string {
	if (explicitRoute) {
		return explicitRoute;
	}
	if (!name) {
		return "system";
	}
	if (name.startsWith("gui_")) return "gui";
	if (name === "browser") return "browser";
	if (name === "web_search" || name === "web_fetch") return "web";
	if (name === "bash") return "shell";
	if (name === "process") return "process";
	if (name.startsWith("memory_")) return "memory";
	if (name === "schedule") return "schedule";
	if (name === "message_send") return "messaging";
	if (name.startsWith("session") || name.startsWith("sessions_") || name === "subagents") return "session";
	return "system";
}

function summarizeArgumentValue(value: unknown): string | undefined {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length > 0 ? truncateText(trimmed, 120) : undefined;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return undefined;
}

function extractStepInputs(args: Record<string, unknown>): Record<string, string> | undefined {
	const entries = Object.entries(args)
		.filter(([key]) => TRACE_VARIABLE_ARGUMENT_KEYS.has(key) || TRACE_HINT_ARGUMENT_KEYS.has(key))
		.map(([key, value]) => [key, summarizeArgumentValue(value)] as const)
		.filter((entry): entry is [string, string] => typeof entry[1] === "string");
	if (entries.length === 0) {
		return undefined;
	}
	return Object.fromEntries(entries);
}

function extractStepToolArgs(args: Record<string, unknown>): TaughtTaskToolArguments | undefined {
	return extractTaughtTaskToolArgumentsFromRecord(args, STEP_TOOL_ARG_RESERVED_KEYS);
}

export function describeToolArgumentValue(value: TaughtTaskToolArgumentValue | undefined): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (Array.isArray(value)) {
		return value.join("+");
	}
	if (typeof value === "object") {
		return JSON.stringify(value);
	}
	return String(value);
}

function buildInstruction(toolName: string, args: Record<string, unknown>, fallbackSummary?: string): string {
	const target = asString(args.target);
	const app = asString(args.app);
	const scope = asString(args.scope);
	const value = asString(args.value) ?? asString(args.text) ?? asString(args.query) ?? asString(args.command);
	const suffix = [app, scope].filter(Boolean).join(" / ");
	switch (toolName) {
		case "gui_click":
			if (asString(args.button) === "right") {
				return `Right-click ${target ?? "the target"}${suffix ? ` in ${suffix}` : ""}.`;
			}
			if ((asNumber(args.clicks) ?? 0) >= 2) {
				return `Double-click ${target ?? "the target"}${suffix ? ` in ${suffix}` : ""}.`;
			}
			if (asString(args.button) === "none") {
				return `Hover ${target ?? "the target"}${suffix ? ` in ${suffix}` : ""}.`;
			}
			if ((asNumber(args.holdMs) ?? 0) > 0) {
				return `Click and hold ${target ?? "the target"}${suffix ? ` in ${suffix}` : ""}.`;
			}
			return `Click ${target ?? "the target"}${suffix ? ` in ${suffix}` : ""}.`;
		case "gui_move":
			if (typeof args.x === "number" && typeof args.y === "number") {
				return `Move the cursor to (${Math.round(args.x)}, ${Math.round(args.y)})${app ? ` in ${app}` : ""}.`;
			}
			return `Move the cursor${app ? ` in ${app}` : ""}.`;
		case "gui_drag": {
			const fromTarget = asString(args.fromTarget);
			const toTarget = asString(args.toTarget);
			const fromScope = asString(args.fromScope);
			const toScope = asString(args.toScope);
			const dragScope = fromScope && toScope && fromScope !== toScope
				? ` from ${fromScope} to ${toScope}`
				: (fromScope ?? toScope)
					? ` in ${fromScope ?? toScope}`
					: (suffix ? ` in ${suffix}` : "");
			return `Drag ${fromTarget ?? "the source"} to ${toTarget ?? "the destination"}${dragScope}.`;
		}
		case "gui_scroll":
			return `Scroll ${target ?? scope ?? "the interface"}${app ? ` in ${app}` : ""}.`;
		case "gui_type":
			return `Type ${value ? `"${truncateText(value, 72)}"` : "the required text"}${target ? ` into ${target}` : ""}${args.submit === true ? ", then submit" : ""}.`;
		case "gui_key": {
			const key = asString(args.key);
			const modifiers = Array.isArray(args.modifiers)
				? args.modifiers
					.map((entry) => asString(entry))
					.filter((entry): entry is string => Boolean(entry))
				: [];
			const repeat = Math.max(1, Math.round(asNumber(args.repeat) ?? 1));
			const keySequence = [...modifiers, key].filter(Boolean).join("+");
			return `Press ${keySequence ? truncateText(keySequence, 72) : "the key"}${repeat > 1 ? ` ${repeat} times` : ""}${app ? ` in ${app}` : ""}.`;
		}
		case "gui_wait":
			return asString(args.state) === "disappear"
				? `Wait for ${target ?? "the expected UI state"}${scope ? ` in ${scope}` : ""} to disappear.`
				: `Wait for ${target ?? "the expected UI state"}${scope ? ` in ${scope}` : ""}.`;
		case "gui_observe":
			return `Observe the GUI${app ? ` in ${app}` : ""}${target ? ` for "${target}"` : ""}.`;
		case "browser":
			return fallbackSummary ?? `Use browser automation${target ? ` for ${target}` : ""}.`;
		case "web_fetch":
		case "web_search":
			return fallbackSummary ?? `Use ${toolName} to gather the required web information.`;
		case "bash":
			return value ? `Run \`${truncateText(value, 96)}\`.` : (fallbackSummary ?? "Run the required shell command.");
		default:
			return fallbackSummary ?? `Use ${toolName} on the ${inferRoute(toolName)} route.`;
	}
}

function classifyUncertainStep(params: {
	entry: Record<string, unknown>;
	statusInfo?: Record<string, unknown>;
}): boolean {
	if (params.entry.isError === true || typeof params.entry.error === "string") {
		return true;
	}
	const status = asString(params.statusInfo?.code)?.toLowerCase();
	return status === "timeout" || status === "unsupported" || status === "blocked" || status === "not_found" || status === "action_sent";
}

export function resolvePairedSteps(toolTrace: Array<Record<string, unknown>>): TaughtTaskDraftStep[] {
	const pendingById = new Map<string, Record<string, unknown>>();
	const pendingByName = new Map<string, Array<Record<string, unknown>>>();
	const steps: TaughtTaskDraftStep[] = [];
	let index = 0;

	const rememberCall = (call: Record<string, unknown>): void => {
		const id = asString(call.id);
		const name = asString(call.name) ?? "unknown";
		if (id) {
			pendingById.set(id, call);
			return;
		}
		const bucket = pendingByName.get(name) ?? [];
		bucket.push(call);
		pendingByName.set(name, bucket);
	};

	const resolveCall = (result: Record<string, unknown>): Record<string, unknown> | undefined => {
		const id = asString(result.id);
		if (id && pendingById.has(id)) {
			const call = pendingById.get(id);
			pendingById.delete(id);
			return call;
		}
		const name = asString(result.name) ?? "unknown";
		const bucket = pendingByName.get(name) ?? [];
		const call = bucket.shift();
		if (bucket.length === 0) {
			pendingByName.delete(name);
		}
		return call;
	};

	for (const entry of toolTrace) {
		const type = asString(entry.type);
		if (type === "toolCall") {
			rememberCall(entry);
			continue;
		}
		if (type !== "toolResult") {
			continue;
		}
		const pairedCall = resolveCall(entry);
		const callArgs = asRecord(pairedCall?.arguments) ?? {};
		const name = asString(entry.name) ?? asString(pairedCall?.name) ?? "unknown";
		const route = inferRoute(name, asString(entry.route));
			const statusInfo = asRecord(entry.status);
			const summary = asString(entry.textPreview) ?? asString(entry.error);
			const instruction = buildInstruction(name, callArgs, summary);
			const stepInputs = extractStepInputs(callArgs);
			const stepToolArgs = extractStepToolArgs(callArgs);
			index += 1;
			steps.push({
				id: `${name}-${index}`,
				index,
			toolName: name,
			route,
			instruction,
			...(summary ? { summary } : {}),
				...(asString(callArgs.target) ? { target: asString(callArgs.target) } : {}),
				...(asString(callArgs.app) ? { app: asString(callArgs.app) } : {}),
				...(asString(callArgs.scope) ? { scope: asString(callArgs.scope) } : {}),
				...(stepInputs ? { inputs: stepInputs } : {}),
				...(stepToolArgs ? { toolArgs: stepToolArgs } : {}),
				...(asString(statusInfo?.code) ? { verificationStatus: asString(statusInfo?.code) } : {}),
				...(asString(statusInfo?.summary) ? { verificationSummary: asString(statusInfo?.summary) } : {}),
				uncertain: classifyUncertainStep({ entry, statusInfo }),
		});
	}

	return steps;
}

export function buildParameterSlots(steps: TaughtTaskDraftStep[]): TaughtTaskDraftParameter[] {
	const slots: TaughtTaskDraftParameter[] = [];
	const seen = new Set<string>();
	for (const step of steps) {
		const inputs = step.inputs ?? {};
		for (const [key, value] of Object.entries(inputs)) {
			if (!TRACE_VARIABLE_ARGUMENT_KEYS.has(key)) {
				continue;
			}
			const slotName = key.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || key;
			const fingerprint = `${slotName}:${value}`;
			if (seen.has(fingerprint)) {
				continue;
			}
			seen.add(fingerprint);
			slots.push({
				name: slotName,
				label: humanizeLabel(key),
				sampleValue: value,
				required: true,
				sourceKey: key,
				source: "tool_argument",
			});
		}
	}
	return slots.slice(0, 8);
}

export function extractPromptQuotedParameterSlots(promptPreview: string): TaughtTaskDraftParameter[] {
	const slots: TaughtTaskDraftParameter[] = [];
	const seen = new Set<string>();
	const patterns = [/"([^"\n]{2,120})"/g, /'([^'\n]{2,120})'/g];
	let index = 0;
	for (const pattern of patterns) {
		for (const match of promptPreview.matchAll(pattern)) {
			const sampleValue = match[1]?.trim();
			if (!sampleValue || seen.has(sampleValue)) {
				continue;
			}
			seen.add(sampleValue);
			index += 1;
			slots.push({
				name: `input_${index}`,
				label: `Prompt Input ${index}`,
				sampleValue,
				required: true,
				source: "prompt",
				notes: "Captured from the taught prompt text.",
			});
		}
	}
	return slots;
}

export function collectSuccessCriteria(params: {
	validation?: Record<string, unknown>;
	steps: TaughtTaskDraftStep[];
}): string[] {
	const checks = Array.isArray(asRecord(params.validation)?.checks)
		? (asRecord(params.validation)?.checks as Array<unknown>)
		: [];
	const fromChecks = checks
		.map((entry) => asRecord(entry))
		.filter((entry): entry is Record<string, unknown> => Boolean(entry))
		.filter((entry) => entry.ok !== false)
		.map((entry) => asString(entry.summary))
		.filter((entry): entry is string => Boolean(entry));
	if (fromChecks.length > 0) {
		return Array.from(new Set(fromChecks)).slice(0, 6);
	}
	const fromSteps = params.steps
		.map((step) => step.verificationSummary)
		.filter((entry): entry is string => Boolean(entry));
	return Array.from(new Set(fromSteps)).slice(0, 6);
}

export function collectUncertainties(params: {
	validation?: Record<string, unknown>;
	steps: TaughtTaskDraftStep[];
}): string[] {
	const items: string[] = [];
	for (const step of params.steps) {
		if (!step.uncertain) {
			continue;
		}
		if (step.verificationStatus === "action_sent") {
			items.push(`Step ${step.index} only confirmed that the action was sent; visible completion still needs verification.`);
			continue;
		}
		if (step.verificationSummary) {
			items.push(`Step ${step.index} needs attention: ${step.verificationSummary}`);
			continue;
		}
		if (step.summary) {
			items.push(`Step ${step.index} needs attention: ${step.summary}`);
		}
	}
	const checks = Array.isArray(asRecord(params.validation)?.checks)
		? (asRecord(params.validation)?.checks as Array<unknown>)
		: [];
	for (const entry of checks) {
		const record = asRecord(entry);
		if (!record || record.ok !== false) {
			continue;
		}
		const summary = asString(record.summary);
		if (summary) {
			items.push(summary);
		}
	}
	return Array.from(new Set(items)).slice(0, 6);
}

export function normalizeLineList(value: string[] | undefined): string[] {
	return Array.from(new Set((value ?? []).map((entry) => entry.trim()).filter(Boolean)));
}

function areStringListsEqual(left: string[], right: string[]): boolean {
	return JSON.stringify(normalizeLineList(left)) === JSON.stringify(normalizeLineList(right));
}

export function normalizeParameterSlots(values: Array<TaughtTaskDraftParameter | string> | undefined): TaughtTaskDraftParameter[] {
	const slots: TaughtTaskDraftParameter[] = [];
	for (const value of values ?? []) {
		if (typeof value === "string") {
			const [namePart, ...rest] = value.split(":");
			const name = namePart.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
			if (!name) {
				continue;
			}
			slots.push({
				name,
				label: humanizeLabel(name),
				sampleValue: rest.join(":").trim() || undefined,
				required: true,
				source: "tool_argument",
			});
			continue;
		}
		const name = value.name?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
		if (!name) {
			continue;
		}
		slots.push({
			name,
			label: value.label?.trim() || humanizeLabel(name),
			sampleValue: value.sampleValue?.trim() || undefined,
			required: value.required !== false,
			sourceKey: value.sourceKey?.trim() || undefined,
			source: value.source,
			notes: value.notes?.trim() || undefined,
		});
	}
	return slots.slice(0, 12);
}

function areParameterSlotsEqual(left: TaughtTaskDraftParameter[], right: TaughtTaskDraftParameter[]): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function normalizeProcedure(
	values: Array<Partial<TaughtTaskProcedureStep> | string> | undefined,
	baseProcedure: TaughtTaskProcedureStep[],
): TaughtTaskProcedureStep[] {
	if (!Array.isArray(values) || values.length === 0) {
		return baseProcedure;
	}
	const next: TaughtTaskProcedureStep[] = [];
	for (const [index, value] of values.entries()) {
		const base = baseProcedure[index] ?? {
			id: `procedure-${index + 1}`,
			index: index + 1,
			instruction:
				typeof value === "string"
					? value.trim()
					: value.instruction?.trim() || "Perform the demonstrated subtask.",
		};
		if (typeof value === "string") {
			const instruction = value.trim();
			if (!instruction) {
				continue;
			}
			const kind = inferProcedureKind(instruction);
			next.push({
				id: `procedure-${next.length + 1}`,
				index: next.length + 1,
				instruction,
				...(kind ? { kind } : {}),
			});
			continue;
		}
		const instruction = value.instruction?.trim() || base.instruction;
		if (!instruction) {
			continue;
		}
		const skillName = value.skillName?.trim() || undefined;
		const kind = value.kind ?? inferProcedureKind(instruction, skillName);
		next.push({
			...base,
			...value,
			id: `procedure-${next.length + 1}`,
			index: next.length + 1,
			instruction,
			...(kind ? { kind } : {}),
			...(skillName ? { skillName } : {}),
			notes: value.notes?.trim() || undefined,
			uncertain: value.uncertain === true,
		});
	}
	return next.length > 0 ? next : baseProcedure;
}

function areProcedureEqual(left: TaughtTaskProcedureStep[], right: TaughtTaskProcedureStep[]): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function normalizeSkillDependencies(values: Array<TaughtTaskSkillDependency | string> | undefined): TaughtTaskSkillDependency[] {
	const next: TaughtTaskSkillDependency[] = [];
	for (const value of values ?? []) {
		if (typeof value === "string") {
			const [namePart, ...rest] = value.split(":");
			const name = namePart.trim();
			if (!name) {
				continue;
			}
			next.push({
				name,
				reason: rest.join(":").trim() || undefined,
				required: true,
			});
			continue;
		}
		const name = value.name?.trim();
		if (!name) {
			continue;
		}
		next.push({
			name,
			reason: value.reason?.trim() || undefined,
			required: value.required !== false,
		});
	}
	return next.slice(0, 16);
}

function areSkillDependenciesEqual(left: TaughtTaskSkillDependency[], right: TaughtTaskSkillDependency[]): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function normalizeArtifactKind(value: WorkspaceArtifactKind | string | undefined): WorkspaceArtifactKind {
	switch (value?.trim().toLowerCase()) {
		case "worker":
			return "worker";
		case "playbook":
			return "playbook";
		default:
			return "skill";
	}
}

export function normalizeChildArtifacts(
	values: Array<Partial<TaughtTaskDraftChildArtifact>> | undefined,
): TaughtTaskDraftChildArtifact[] {
	const next: TaughtTaskDraftChildArtifact[] = [];
	for (const [index, value] of (values ?? []).entries()) {
		const name = value.name?.trim();
		const objective = value.objective?.trim();
		const artifactKind = normalizeArtifactKind(value.artifactKind);
		if (!name || !objective || artifactKind === "playbook") {
			continue;
		}
		next.push({
			id: value.id?.trim() || `child-artifact-${index + 1}`,
			name,
			artifactKind,
			objective,
			required: value.required !== false,
			...(value.reason?.trim() ? { reason: value.reason.trim() } : {}),
		});
	}
	return next.slice(0, 16);
}

function areChildArtifactsEqual(
	left: TaughtTaskDraftChildArtifact[],
	right: TaughtTaskDraftChildArtifact[],
): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function normalizePlaybookStageKind(
	value: TaughtTaskPlaybookStageKind | string | undefined,
): TaughtTaskPlaybookStageKind | undefined {
	switch (value?.trim().toLowerCase()) {
		case "skill":
			return "skill";
		case "worker":
			return "worker";
		case "inline":
			return "inline";
		case "approval":
			return "approval";
		default:
			return undefined;
	}
}

export function normalizePlaybookStages(
	values: Array<Partial<TaughtTaskPlaybookStage>> | undefined,
): TaughtTaskPlaybookStage[] {
	const next: TaughtTaskPlaybookStage[] = [];
	for (const [index, value] of (values ?? []).entries()) {
		const kind = normalizePlaybookStageKind(value.kind);
		const name = value.name?.trim();
		const objective = value.objective?.trim();
		if (!kind || !name || !objective) {
			continue;
		}
		const refName = value.refName?.trim() || undefined;
		if ((kind === "skill" || kind === "worker") && !refName) {
			continue;
		}
		const retryPolicy =
			value.retryPolicy === "retry_once" ||
			value.retryPolicy === "skip_with_note" ||
			value.retryPolicy === "pause_for_human"
				? value.retryPolicy
				: undefined;
		const approvalGate = normalizeWorkspacePlaybookApprovalGate(value.approvalGate);
		next.push({
			id: value.id?.trim() || `playbook-stage-${index + 1}`,
			name,
			kind,
			...(refName ? { refName } : {}),
			objective,
			inputs: normalizeLineList(value.inputs ?? []),
			outputs: normalizeLineList(value.outputs ?? []),
			budgetNotes: normalizeLineList(value.budgetNotes ?? []),
			...(retryPolicy ? { retryPolicy } : {}),
			...(approvalGate ? { approvalGate } : {}),
		});
	}
	return next.slice(0, 24);
}

function arePlaybookStagesEqual(left: TaughtTaskPlaybookStage[], right: TaughtTaskPlaybookStage[]): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeWorkerBudget(value: Partial<TaughtTaskWorkerBudget> | undefined): TaughtTaskWorkerBudget | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const asFiniteInt = (input: unknown): number | undefined =>
		typeof input === "number" && Number.isFinite(input) && input >= 0
			? Math.floor(input)
			: undefined;
	const budget = {
		...(asFiniteInt(value.maxMinutes) !== undefined ? { maxMinutes: asFiniteInt(value.maxMinutes) } : {}),
		...(asFiniteInt(value.maxActions) !== undefined ? { maxActions: asFiniteInt(value.maxActions) } : {}),
		...(asFiniteInt(value.maxScreenshots) !== undefined ? { maxScreenshots: asFiniteInt(value.maxScreenshots) } : {}),
	};
	return Object.keys(budget).length > 0 ? budget : undefined;
}

export function normalizeWorkerContract(
	value: Partial<TaughtTaskWorkerContract> | undefined,
	existing?: TaughtTaskWorkerContract,
): TaughtTaskWorkerContract | undefined {
	if (!value && !existing) {
		return undefined;
	}
	const goal = value?.goal?.trim() || existing?.goal?.trim();
	const scope = value?.scope?.trim() || existing?.scope?.trim() || undefined;
	const inputs = normalizeLineList(value?.inputs ?? existing?.inputs ?? []);
	const outputs = normalizeLineList(value?.outputs ?? existing?.outputs ?? []);
	const allowedRoutes = normalizeExecutionRouteList(value?.allowedRoutes, existing?.allowedRoutes ?? DEFAULT_EXECUTION_ROUTE_ORDER);
	const allowedSurfaces = normalizeLineList(value?.allowedSurfaces ?? existing?.allowedSurfaces ?? []);
	const budget = normalizeWorkerBudget(value?.budget ?? existing?.budget);
	const escalationPolicy = normalizeLineList(value?.escalationPolicy ?? existing?.escalationPolicy ?? []);
	const stopConditions = normalizeLineList(value?.stopConditions ?? existing?.stopConditions ?? []);
	const decisionHeuristics = normalizeLineList(value?.decisionHeuristics ?? existing?.decisionHeuristics ?? []);
	if (!goal) {
		return undefined;
	}
	return {
		goal,
		...(scope ? { scope } : {}),
		inputs,
		outputs,
		allowedRoutes,
		allowedSurfaces,
		...(budget ? { budget } : {}),
		escalationPolicy,
		stopConditions,
		decisionHeuristics,
	};
}

function areWorkerContractsEqual(
	left: TaughtTaskWorkerContract | undefined,
	right: TaughtTaskWorkerContract | undefined,
): boolean {
	return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function areTaskCardsEqual(left: TaughtTaskCard | undefined, right: TaughtTaskCard | undefined): boolean {
	return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function normalizeSteps(values: Array<Partial<TaughtTaskDraftStep> | string> | undefined, baseSteps: TaughtTaskDraftStep[]): TaughtTaskDraftStep[] {
	if (!Array.isArray(values) || values.length === 0) {
		return baseSteps;
	}
	const next: TaughtTaskDraftStep[] = [];
	for (const [index, value] of values.entries()) {
		const base = baseSteps[index] ?? {
			id: `gui_wait-${index + 1}`,
			index: index + 1,
			toolName:
				typeof value === "string"
					? "gui_wait"
					: value.toolName?.trim() || "gui_wait",
			route:
				typeof value === "string"
					? "gui"
					: value.route?.trim() || "gui",
			instruction:
				typeof value === "string"
					? value.trim()
					: value.instruction?.trim() || value.summary?.trim() || "Wait for the demonstrated UI state to settle.",
		};
		if (typeof value === "string") {
			const instruction = value.trim();
			if (!instruction) {
				continue;
			}
			next.push({
				...base,
				index: next.length + 1,
				id: `${base.toolName}-${next.length + 1}`,
				instruction,
			});
			continue;
		}
		const instruction = value.instruction?.trim() || value.summary?.trim() || base.instruction;
		if (!instruction) {
			continue;
		}
		next.push({
			...base,
			...value,
			index: next.length + 1,
			id: `${base.toolName}-${next.length + 1}`,
			instruction,
			toolArgs: normalizeTaughtTaskToolArguments(value.toolArgs) ?? base.toolArgs,
		});
	}
	return next.length > 0 ? next : baseSteps;
}

function areStepsEqual(left: TaughtTaskDraftStep[], right: TaughtTaskDraftStep[]): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeValidationCheck(value: TaughtTaskDraftValidationCheck): TaughtTaskDraftValidationCheck | undefined {
	const id = value.id?.trim();
	const summary = value.summary?.trim();
	if (!id || !summary) {
		return undefined;
	}
	return {
		id,
		ok: value.ok !== false,
		summary,
		details: value.details?.trim() || undefined,
		source: value.source === "replay" ? "replay" : value.source === "draft" ? "draft" : undefined,
	};
}

function normalizeValidationState(
	value: TaughtTaskDraftValidation["state"] | undefined,
): TaughtTaskDraftValidation["state"] {
	switch (value) {
		case "validated":
		case "requires_reset":
		case "failed":
			return value;
		default:
			return "unvalidated";
	}
}

function hasOwnValidationField<Value extends object>(value: Value, key: keyof Value): boolean {
	return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeValidationOptionalTrimmedField<
	Key extends "runId" | "responsePreview",
>(
	value: TaughtTaskDraftValidation,
	key: Key,
	existing?: TaughtTaskDraftValidation,
): TaughtTaskDraftValidation[Key] {
	if (!hasOwnValidationField(value, key)) {
		return existing?.[key];
	}
	const nextValue = value[key];
	return typeof nextValue === "string" && nextValue.trim().length > 0
		? nextValue.trim()
		: undefined;
}

function normalizeValidationOptionalMode(
	value: TaughtTaskDraftValidation,
	existing?: TaughtTaskDraftValidation,
): TaughtTaskDraftValidation["mode"] {
	if (!hasOwnValidationField(value, "mode")) {
		return existing?.mode;
	}
	return value.mode === "inspection" || value.mode === "replay"
		? value.mode
		: undefined;
}

function normalizeValidationOptionalBoolean(
	value: TaughtTaskDraftValidation,
	key: "usedMutatingTools",
	existing?: TaughtTaskDraftValidation,
): boolean | undefined {
	if (!hasOwnValidationField(value, key)) {
		return existing?.[key];
	}
	return typeof value[key] === "boolean" ? value[key] : undefined;
}

function normalizeValidationOptionalLineList(
	value: TaughtTaskDraftValidation,
	key: "toolNames" | "mutatingToolNames",
	existing?: TaughtTaskDraftValidation,
): string[] | undefined {
	if (!hasOwnValidationField(value, key)) {
		return existing?.[key];
	}
	if (!Array.isArray(value[key])) {
		return undefined;
	}
	return normalizeLineList(value[key]);
}

export function normalizeValidation(
	value: TaughtTaskDraftValidation | undefined,
	existing?: TaughtTaskDraftValidation,
): TaughtTaskDraftValidation | undefined {
	if (!value) {
		return existing;
	}
	const summary = value.summary?.trim() || existing?.summary?.trim() || "Teach draft validation updated.";
	const checks = Array.isArray(value.checks)
		? value.checks
			.map((entry) => normalizeValidationCheck(entry))
			.filter((entry): entry is TaughtTaskDraftValidationCheck => Boolean(entry))
		: (existing?.checks ?? []);
	return {
		state: normalizeValidationState(value.state ?? existing?.state),
		updatedAt:
			typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
				? value.updatedAt
				: (existing?.updatedAt ?? Date.now()),
		summary,
		runId: normalizeValidationOptionalTrimmedField(value, "runId", existing),
		responsePreview: normalizeValidationOptionalTrimmedField(value, "responsePreview", existing),
		checks,
		mode: normalizeValidationOptionalMode(value, existing),
		usedMutatingTools: normalizeValidationOptionalBoolean(value, "usedMutatingTools", existing),
		toolNames: normalizeValidationOptionalLineList(value, "toolNames", existing),
		mutatingToolNames: normalizeValidationOptionalLineList(value, "mutatingToolNames", existing),
	};
}

function areValidationEqual(left: TaughtTaskDraftValidation | undefined, right: TaughtTaskDraftValidation | undefined): boolean {
	return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function lintTaughtTaskDraft(draft: TaughtTaskDraft): TaughtTaskDraftLintIssue[] {
	const issues: TaughtTaskDraftLintIssue[] = [];
	if (draft.artifactKind === "playbook" && draft.playbookStages.length === 0) {
		issues.push({
			id: "artifact-kind:playbook-missing-stages",
			summary: "Playbook drafts must declare at least one playbook stage.",
		});
	}
	if (draft.artifactKind !== "playbook" && draft.childArtifacts.length > 0) {
		issues.push({
			id: "artifact-kind:child-artifacts-only-for-playbook",
			summary: "Only playbook drafts may declare child artifacts.",
		});
	}
	if (draft.artifactKind === "worker" && !draft.workerContract?.goal?.trim()) {
		issues.push({
			id: "artifact-kind:worker-missing-contract",
			summary: "Worker drafts must define a worker contract with at least a goal.",
		});
	}
	if (draft.taskKind === "fixed_demo" && draft.parameterSlots.length > 0) {
		issues.push({
			id: "task-kind:fixed-demo-parameters",
			summary: "Fixed-demo drafts cannot keep parameter slots.",
		});
	}
	if (draft.taskKind === "fixed_demo" && (draft.taskCard?.inputs.length ?? 0) > 0) {
		issues.push({
			id: "task-kind:fixed-demo-inputs",
			summary: "Fixed-demo drafts cannot advertise runtime task-card inputs.",
		});
	}
	if (draft.taskKind === "parameterized_workflow" && draft.parameterSlots.length === 0) {
		issues.push({
			id: "task-kind:parameterized-missing-parameters",
			summary: "Parameterized workflows must define at least one parameter slot.",
		});
	}
	if (draft.taskKind === "batch_workflow" && !draft.taskCard?.loopOver?.trim()) {
		issues.push({
			id: "task-kind:batch-missing-loop",
			summary: "Batch workflows must state what collection or loop target is being iterated.",
		});
	}
	if (draft.procedure.length === 0 && draft.steps.length > 0) {
		issues.push({
			id: "procedure:missing",
			summary: "Teach draft is missing a high-level procedure.",
		});
	}
	if (!Array.isArray(draft.executionPolicy.preferredRoutes) || draft.executionPolicy.preferredRoutes.length === 0) {
		issues.push({
			id: "execution-policy:missing-routes",
			summary: "Teach draft execution policy must declare at least one preferred route.",
		});
	}
	const validProcedureIds = new Set(draft.procedure.map((step) => step.id));
	for (const option of draft.stepRouteOptions) {
		if (!validProcedureIds.has(option.procedureStepId)) {
			issues.push({
				id: `step-route-option:${option.id}:invalid-procedure-step`,
				summary: `Step route option ${option.id} must reference a known procedure step.`,
			});
		}
		if (option.route === "skill" && !option.skillName?.trim()) {
			issues.push({
				id: `step-route-option:${option.id}:missing-skill`,
				summary: `Step route option ${option.id} uses the skill route but does not name a skill.`,
			});
		}
	}
	return issues;
}

export function summarizeRevisionChanges(params: {
	current: TaughtTaskDraft;
	nextTitle: string;
	nextObjective: string;
	nextIntent: string;
	nextArtifactKind: WorkspaceArtifactKind;
	nextTaskKind: TaughtTaskKind;
	nextParameterSlots: TaughtTaskDraftParameter[];
	nextSuccessCriteria: string[];
	nextOpenQuestions: string[];
	nextUncertainties: string[];
	nextTaskCard: TaughtTaskCard | undefined;
	nextProcedure: TaughtTaskProcedureStep[];
	nextExecutionPolicy: TaughtTaskExecutionPolicy;
	nextStepRouteOptions: TaughtTaskStepRouteOption[];
	nextReplayPreconditions: string[];
	nextResetSignals: string[];
	nextSkillDependencies: TaughtTaskSkillDependency[];
	nextChildArtifacts: TaughtTaskDraftChildArtifact[];
	nextPlaybookStages: TaughtTaskPlaybookStage[];
	nextWorkerContract: TaughtTaskWorkerContract | undefined;
	nextSteps: TaughtTaskDraftStep[];
	nextValidation: TaughtTaskDraftValidation | undefined;
}): string[] {
	const changes: string[] = [];
	if (params.current.title !== params.nextTitle) {
		changes.push("title");
	}
	if (params.current.objective !== params.nextObjective || params.current.intent !== params.nextIntent) {
		changes.push("objective");
	}
	if (params.current.artifactKind !== params.nextArtifactKind) {
		changes.push("artifact kind");
	}
	if (params.current.taskKind !== params.nextTaskKind) {
		changes.push("task kind");
	}
	if (!areParameterSlotsEqual(params.current.parameterSlots, params.nextParameterSlots)) {
		changes.push("parameter slots");
	}
	if (!areStringListsEqual(params.current.successCriteria, params.nextSuccessCriteria)) {
		changes.push("success criteria");
	}
	if (!areStringListsEqual(params.current.openQuestions, params.nextOpenQuestions)) {
		changes.push("open questions");
	}
	if (!areStringListsEqual(params.current.uncertainties, params.nextUncertainties)) {
		changes.push("uncertainties");
	}
	if (!areTaskCardsEqual(params.current.taskCard, params.nextTaskCard)) {
		changes.push("task card");
	}
	if (!areProcedureEqual(params.current.procedure, params.nextProcedure)) {
		changes.push("procedure");
	}
	if (!areExecutionPolicyEqual(params.current.executionPolicy, params.nextExecutionPolicy)) {
		changes.push("execution policy");
	}
	if (!areStepRouteOptionsEqual(params.current.stepRouteOptions, params.nextStepRouteOptions)) {
		changes.push("step route options");
	}
	if (!areStringListsEqual(params.current.replayPreconditions, params.nextReplayPreconditions)) {
		changes.push("replay preconditions");
	}
	if (!areStringListsEqual(params.current.resetSignals, params.nextResetSignals)) {
		changes.push("reset signals");
	}
	if (!areSkillDependenciesEqual(params.current.skillDependencies, params.nextSkillDependencies)) {
		changes.push("skill dependencies");
	}
	if (!areChildArtifactsEqual(params.current.childArtifacts, params.nextChildArtifacts)) {
		changes.push("child artifacts");
	}
	if (!arePlaybookStagesEqual(params.current.playbookStages, params.nextPlaybookStages)) {
		changes.push("playbook stages");
	}
	if (!areWorkerContractsEqual(params.current.workerContract, params.nextWorkerContract)) {
		changes.push("worker contract");
	}
	if (!areStepsEqual(params.current.steps, params.nextSteps)) {
		changes.push("steps");
	}
	if (!areValidationEqual(params.current.validation, params.nextValidation)) {
		changes.push("validation");
	}
	return changes;
}

export function buildRevisionSummary(params: {
	action: TaughtTaskDraftRevision["action"];
	draft: TaughtTaskDraft;
	sourceLabel?: string;
	changes?: string[];
	note?: string;
	publishedSkillName?: string;
}): string {
	if (params.action === "created") {
		return `Created teach draft from traced run ${params.sourceLabel ?? params.draft.sourceRunId ?? params.draft.runId}.`;
	}
	if (params.action === "published") {
		return params.publishedSkillName
			? `Published teach draft to workspace ${params.draft.artifactKind} ${params.publishedSkillName}.`
			: `Published teach draft to workspace ${params.draft.artifactKind}s.`;
	}
	if (params.action === "validated") {
		return params.note?.trim() || "Validated teach draft replay readiness.";
	}
	if (params.changes && params.changes.length > 0) {
		return `Corrected ${params.changes.join(", ")}.`;
	}
	return params.note?.trim() || "Corrected teach draft.";
}
