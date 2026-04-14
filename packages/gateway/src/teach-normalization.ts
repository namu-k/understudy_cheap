import type {
	TaughtTaskCard,
	TaughtTaskDraft,
	TaughtTaskDraftStep,
	TaughtTaskExecutionPolicy,
	TaughtTaskExecutionRoute,
	TaughtTaskKind,
	TaughtTaskProcedureStep,
	TaughtTaskSkillDependency,
	TaughtTaskStepRouteOption,
} from "@understudy/core";
import { asBoolean, asNumber, asRecord, asString } from "./value-coerce.js";

export type TeachSlashCommand = {
	action: "help" | "start" | "stop" | "confirm" | "validate" | "publish";
	trailing?: string;
};

export type TeachDraftValidationResult = {
	state: "validated" | "requires_reset" | "failed" | "unvalidated";
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
	mode?: "inspection" | "replay";
	usedMutatingTools?: boolean;
	toolNames?: string[];
	mutatingToolNames?: string[];
};

export type TeachClarificationState = {
	draftId: string;
	status: "clarifying" | "ready";
	summary?: string;
	nextQuestion?: string;
	pendingQuestions: string[];
	taskCard?: TaughtTaskCard;
	excludedDemoSteps: string[];
	updatedAt: number;
};

export type TeachClarificationExecutionPolicy = {
	toolBinding?: TaughtTaskExecutionPolicy["toolBinding"];
	preferredRoutes?: TaughtTaskExecutionRoute[];
	stepInterpretation?: TaughtTaskExecutionPolicy["stepInterpretation"];
	notes?: string[];
};

export type TeachClarificationPayload = {
	title?: string;
	intent?: string;
	objective?: string;
	artifactKind?: "skill" | "worker" | "playbook";
	taskKind?: TaughtTaskKind;
	parameterSlots?: Array<Record<string, unknown> | string>;
	successCriteria?: string[];
	openQuestions?: string[];
	uncertainties?: string[];
	procedure?: Array<Record<string, unknown> | string>;
	executionPolicy?: TeachClarificationExecutionPolicy;
	stepRouteOptions?: Array<Record<string, unknown>>;
	replayPreconditions?: string[];
	resetSignals?: string[];
	skillDependencies?: Array<Record<string, unknown> | string>;
	childArtifacts?: Array<Record<string, unknown>>;
	playbookStages?: Array<Record<string, unknown>>;
	workerContract?: Record<string, unknown>;
	steps?: Array<Record<string, unknown> | string>;
	summary?: string;
	nextQuestion?: string;
	readyForConfirmation?: boolean;
	taskCard?: Partial<TaughtTaskCard>;
	excludedDemoSteps?: string[];
};

function trimToUndefined(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function asStringList(value: unknown): string[] {
	return Array.isArray(value)
		? value
			.map((entry) => asString(entry))
			.filter((entry): entry is string => Boolean(entry))
		: [];
}

function uniqueStrings(values: Array<string | undefined>): string[] {
	const seen = new Set<string>();
	const next: string[] = [];
	for (const value of values) {
		const trimmed = trimToUndefined(value);
		if (!trimmed) {
			continue;
		}
		const key = trimmed.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		next.push(trimmed);
	}
	return next;
}

export function normalizeTeachTaskKind(value: unknown): TaughtTaskKind | undefined {
	switch (trimToUndefined(asString(value))?.toLowerCase()) {
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

export function normalizeTeachArtifactKind(value: unknown): "skill" | "worker" | "playbook" | undefined {
	switch (trimToUndefined(asString(value))?.toLowerCase()) {
		case "skill":
			return "skill";
		case "worker":
			return "worker";
		case "playbook":
			return "playbook";
		default:
			return undefined;
	}
}

export function normalizeTeachReplayHints(value: unknown): string[] | undefined {
	const next = uniqueStrings(asStringList(value));
	return next.length > 0 ? next : undefined;
}

export function normalizeTeachExecutionRoute(value: unknown): TaughtTaskExecutionRoute | undefined {
	switch (trimToUndefined(asString(value))?.toLowerCase()) {
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

export function formatTeachExecutionRouteOrder(routes: TaughtTaskExecutionRoute[] | undefined): string | undefined {
	if (!Array.isArray(routes) || routes.length === 0) {
		return undefined;
	}
	return routes.join(" -> ");
}

export function normalizeTeachExecutionPolicy(value: unknown): TeachClarificationExecutionPolicy | undefined {
	const record = asRecord(value);
	if (!record || Object.keys(record).length === 0) {
		return undefined;
	}
	const preferredRoutes = Array.isArray(record.preferredRoutes)
		? Array.from(new Set(
			record.preferredRoutes
				.map((entry) => normalizeTeachExecutionRoute(entry))
				.filter((entry): entry is TaughtTaskExecutionRoute => Boolean(entry)),
		))
		: undefined;
	const notes = uniqueStrings(asStringList(record.notes));
	const toolBinding = asString(record.toolBinding) === "fixed"
		? "fixed"
		: asString(record.toolBinding) === "adaptive"
			? "adaptive"
			: undefined;
	const rawStepInterpretation = asString(record.stepInterpretation);
	const stepInterpretation =
		rawStepInterpretation === "evidence" ||
		rawStepInterpretation === "fallback_replay" ||
		rawStepInterpretation === "strict_contract"
			? rawStepInterpretation
			: undefined;
	if (!toolBinding && !preferredRoutes?.length && !stepInterpretation && notes.length === 0) {
		return undefined;
	}
	return {
		...(toolBinding ? { toolBinding } : {}),
		...(preferredRoutes && preferredRoutes.length > 0 ? { preferredRoutes } : {}),
		...(stepInterpretation ? { stepInterpretation } : {}),
		...(notes.length > 0 ? { notes } : {}),
	};
}

export function normalizeTeachRouteOptionPreference(
	value: unknown,
): TaughtTaskStepRouteOption["preference"] | undefined {
	switch (trimToUndefined(asString(value))?.toLowerCase()) {
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

export function formatTeachRouteOptionTarget(option: Pick<TaughtTaskStepRouteOption, "route" | "toolName" | "skillName">): string {
	if (option.route === "skill" && option.skillName) {
		return `${option.route}/${option.skillName}`;
	}
	return option.toolName ? `${option.route}/${option.toolName}` : option.route;
}

export function rankTeachRouteOptionPreference(
	value: TaughtTaskStepRouteOption["preference"] | undefined,
): number {
	switch (value) {
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

export function scoreTeachReferenceStepMatch(
	queryTokens: string[],
	step: Record<string, unknown> | TaughtTaskDraftStep,
): number {
	if (queryTokens.length === 0) {
		return 0;
	}
	const stepTokens = new Set(normalizeTeachTextTokens([
		asString(step.instruction),
		asString(step.summary),
		asString(step.target),
		asString(step.app),
		asString(step.scope),
		asString(step.locationHint),
		asString(step.windowTitle),
		"toolArgs" in step && step.toolArgs ? JSON.stringify(step.toolArgs) : undefined,
	].filter(Boolean).join(" ")));
	let score = 0;
	for (const token of queryTokens) {
		if (stepTokens.has(token)) {
			score += 1;
		}
	}
	return score;
}

export function buildTeachGuiReferencePathLines(params: {
	procedure: TaughtTaskProcedureStep[];
	stepRouteOptions: Array<TaughtTaskStepRouteOption | Record<string, unknown>>;
	steps: Array<TaughtTaskDraftStep | Record<string, unknown>>;
}): string[] {
	return params.procedure.flatMap((procedureStep) => {
		const guiOption = params.stepRouteOptions
			.map((option) => asRecord(option) ?? option)
			.filter((option) => Boolean(option))
			.filter((option) =>
				asString(option.procedureStepId) === procedureStep.id
				&& normalizeTeachExecutionRoute(option.route) === "gui")
			.sort((left, right) =>
				rankTeachRouteOptionPreference(normalizeTeachRouteOptionPreference(left.preference))
				- rankTeachRouteOptionPreference(normalizeTeachRouteOptionPreference(right.preference)))[0];
		const queryTokens = normalizeTeachTextTokens([
			asString(guiOption?.instruction),
			procedureStep.instruction,
			procedureStep.notes,
		].filter(Boolean).join(" "));
		const stepCandidates = params.steps
			.map((step) => asRecord(step) ?? step)
			.filter((step) =>
				!trimToUndefined(asString(guiOption?.toolName))
				|| trimToUndefined(asString(step.toolName)) === trimToUndefined(asString(guiOption?.toolName)));
		const observedStep =
			guiOption?.preference === "observed"
				? undefined
				: !guiOption && (procedureStep.kind === "transform" || procedureStep.kind === "filter")
				? undefined
				: (stepCandidates.length > 0 ? stepCandidates : params.steps.map((step) => asRecord(step) ?? step))
					.map((step) => ({
						step,
						score: scoreTeachReferenceStepMatch(queryTokens, step),
					}))
					.sort((left, right) =>
						right.score - left.score
						|| (asNumber(left.step.index) ?? 0) - (asNumber(right.step.index) ?? 0))[0]?.step;
		const instruction =
			asString(guiOption?.instruction)
			?? asString(observedStep?.instruction)
			?? procedureStep.instruction;
		const meta: string[] = [];
		if (guiOption) {
			const route = normalizeTeachExecutionRoute(guiOption.route) ?? "gui";
			meta.push(`reference: [${asString(guiOption.preference) ?? "observed"}] [${formatTeachRouteOptionTarget({
				route,
				toolName: trimToUndefined(asString(guiOption.toolName)),
				skillName: trimToUndefined(asString(guiOption.skillName)),
			})}]`);
			if (trimToUndefined(asString(guiOption.when))) meta.push(`when: ${trimToUndefined(asString(guiOption.when))}`);
			if (trimToUndefined(asString(guiOption.notes))) meta.push(`notes: ${trimToUndefined(asString(guiOption.notes))}`);
		}
		if (trimToUndefined(asString(observedStep?.target))) meta.push(`target: ${trimToUndefined(asString(observedStep?.target))}`);
		if (trimToUndefined(asString(observedStep?.app))) meta.push(`app: ${trimToUndefined(asString(observedStep?.app))}`);
		if (trimToUndefined(asString(observedStep?.scope))) meta.push(`scope: ${trimToUndefined(asString(observedStep?.scope))}`);
		return [
			`${procedureStep.index}. ${instruction}`,
			...(meta.length > 0 ? [`   ${meta.join(" | ")}`] : []),
		];
	});
}

export function normalizeTeachStepRouteOptions(value: unknown): Array<Record<string, unknown>> | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const next = value
		.map((entry) => asRecord(entry))
		.filter((entry): entry is Record<string, unknown> => Boolean(entry))
		.flatMap<Record<string, unknown>>((entry) => {
			const procedureStepId = trimToUndefined(asString(entry.procedureStepId));
			const route =
				normalizeTeachExecutionRoute(entry.route) ||
				(trimToUndefined(asString(entry.skillName)) ? "skill" : normalizeTeachExecutionRoute(entry.toolName));
			const preference = normalizeTeachRouteOptionPreference(entry.preference);
			const instruction = trimToUndefined(asString(entry.instruction));
			if (!procedureStepId || !route || !instruction) {
				return [];
			}
			const skillName = trimToUndefined(asString(entry.skillName));
			if (route === "skill" && !skillName) {
				return [];
			}
			return [{
				...(trimToUndefined(asString(entry.id)) ? { id: trimToUndefined(asString(entry.id)) } : {}),
				procedureStepId,
				route,
				...(preference ? { preference } : {}),
				instruction,
				...(trimToUndefined(asString(entry.toolName)) ? { toolName: trimToUndefined(asString(entry.toolName)) } : {}),
				...(skillName ? { skillName } : {}),
				...(trimToUndefined(asString(entry.when)) ? { when: trimToUndefined(asString(entry.when)) } : {}),
				...(trimToUndefined(asString(entry.notes)) ? { notes: trimToUndefined(asString(entry.notes)) } : {}),
			}];
		});
	return next.length > 0 ? next : undefined;
}

export function normalizeTeachTextTokens(value: string | undefined): string[] {
	const normalized = value
		?.toLowerCase()
		.replace(/[`"'""''()[\]{}?!.,;:/\\|+-]+/g, " ")
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

export function isTeachTextRegression(previous: string | undefined, next: string | undefined): boolean {
	const previousValue = trimToUndefined(previous);
	const nextValue = trimToUndefined(next);
	if (!previousValue || !nextValue) {
		return false;
	}
	if (nextValue.length >= previousValue.length) {
		return false;
	}
	const previousTokens = new Set(normalizeTeachTextTokens(previousValue));
	const nextTokens = normalizeTeachTextTokens(nextValue);
	if (previousTokens.size === 0 || nextTokens.length === 0) {
		return false;
	}
	const overlap = nextTokens.filter((token) => previousTokens.has(token)).length;
	return overlap / nextTokens.length >= 0.7;
}

export function preferTeachText(
	previous: string | undefined,
	explicit: string | undefined,
	inferred?: string,
): string | undefined {
	if (explicit && previous && isTeachTextRegression(previous, explicit)) {
		return previous;
	}
	return explicit ?? previous ?? inferred;
}

export function normalizeTeachTaskCard(value?: Record<string, unknown>): TaughtTaskCard | undefined {
	if (!value || Object.keys(value).length === 0) {
		return undefined;
	}
	const goal = trimToUndefined(asString(value.goal));
	const scope = trimToUndefined(asString(value.scope));
	const loopOver = trimToUndefined(asString(value.loopOver));
	const inputs = uniqueStrings(asStringList(value.inputs));
	const extract = uniqueStrings(asStringList(value.extract));
	const formula = trimToUndefined(asString(value.formula));
	const filter = trimToUndefined(asString(value.filter));
	const output = trimToUndefined(asString(value.output));
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

export function normalizeTeachProcedureStep(
	value: Record<string, unknown> | string,
	index: number,
): TaughtTaskProcedureStep | undefined {
	if (typeof value === "string") {
		const instruction = trimToUndefined(value);
		return instruction
			? {
				id: `procedure-${index + 1}`,
				index: index + 1,
				instruction,
			}
			: undefined;
	}
	const instruction = trimToUndefined(asString(value.instruction) ?? asString(value.summary));
	if (!instruction) {
		return undefined;
	}
	const rawKind = asString(value.kind);
	const kind = rawKind && ["navigate", "extract", "transform", "filter", "output", "skill", "check"].includes(rawKind)
		? rawKind as TaughtTaskProcedureStep["kind"]
		: undefined;
	return {
		id: trimToUndefined(asString(value.id)) ?? `procedure-${index + 1}`,
		index: index + 1,
		instruction,
		...(kind ? { kind } : {}),
		...(trimToUndefined(asString(value.skillName)) ? {
			skillName: trimToUndefined(asString(value.skillName)),
		} : {}),
		...(trimToUndefined(asString(value.notes)) ? { notes: trimToUndefined(asString(value.notes)) } : {}),
		uncertain: asBoolean(value.uncertain) === true,
	};
}

export function normalizeTeachProcedure(value: unknown): TaughtTaskProcedureStep[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const next = value
		.map((entry, index) => typeof entry === "string"
			? normalizeTeachProcedureStep(entry, index)
			: normalizeTeachProcedureStep(asRecord(entry) ?? {}, index))
		.filter((entry): entry is TaughtTaskProcedureStep => Boolean(entry));
	return next.length > 0 ? next : undefined;
}

export function normalizeTeachSkillDependencies(value: unknown): TaughtTaskSkillDependency[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const next = value
		.map((entry) => {
			if (typeof entry === "string") {
				const name = trimToUndefined(entry);
				return name ? { name, required: true } : undefined;
			}
			const record = asRecord(entry);
			const name = trimToUndefined(asString(record?.name));
			return name
				? {
					name,
					...(trimToUndefined(asString(record?.reason)) ? { reason: trimToUndefined(asString(record?.reason)) } : {}),
					required: asBoolean(record?.required) !== false,
				}
				: undefined;
		})
		.filter((entry): entry is TaughtTaskSkillDependency => Boolean(entry));
	return next.length > 0 ? next : undefined;
}


export function summarizeTeachDraftPublishBlocker(draft: TaughtTaskDraft): string | undefined {
	if (draft.openQuestions.length > 0) {
		return `Draft still has open questions: ${draft.openQuestions.join("; ")}`;
	}
	if (draft.uncertainties.length > 0) {
		return `Draft still has unresolved uncertainties: ${draft.uncertainties.join("; ")}`;
	}
	const uncertainSteps = draft.steps
		.filter((step) => step.uncertain === true)
		.map((step) => `${step.index}. ${step.instruction}`);
	if (uncertainSteps.length > 0) {
		return `Draft still has uncertain steps: ${uncertainSteps.join(" | ")}`;
	}
	return undefined;
}

export function parseTeachDraftTarget(trailing?: string): { draftId?: string; name?: string } {
	const trimmed = trimToUndefined(trailing);
	if (!trimmed) {
		return {};
	}
	const [draftId, ...rest] = trimmed.split(/\s+/);
	const name = trimToUndefined(rest.join(" "));
	return draftId?.trim()
		? {
			draftId: draftId.trim(),
			...(name ? { name } : {}),
		}
		: {};
}

export function resolveTeachConfirmValidationMode(trailing?: string): "skip" | "validate" {
	const trimmed = trimToUndefined(trailing)?.toLowerCase();
	if (!trimmed) {
		return "skip";
	}
	const tokens = trimmed.split(/\s+/).filter(Boolean);
	let mode: "skip" | "validate" = "skip";
	for (const token of tokens) {
		const normalized = token.replace(/^--/, "");
		if (normalized === "validate") {
			mode = "validate";
		} else if (normalized === "no-validate" || normalized === "skip-validation" || normalized === "skip") {
			mode = "skip";
		}
	}
	return mode;
}

export function normalizeTeachValidationState(value: unknown): TeachDraftValidationResult["state"] | undefined {
	switch (asString(value)?.trim().toLowerCase()) {
		case "validated":
			return "validated";
		case "requires_reset":
			return "requires_reset";
		case "failed":
			return "failed";
		case "unvalidated":
			return "unvalidated";
		default:
			return undefined;
	}
}

export function normalizeTeachValidationCheck(
	value: unknown,
	index: number,
	defaultSource: "replay" | "draft" = "replay",
): TeachDraftValidationResult["checks"][number] | undefined {
	if (typeof value === "string") {
		const summary = trimToUndefined(value);
		return summary
			? {
				id: `teach-validation-${index + 1}`,
				ok: false,
				summary,
				source: defaultSource,
			}
			: undefined;
	}
	const record = asRecord(value);
	const summary = trimToUndefined(asString(record?.summary));
	if (!summary) {
		return undefined;
	}
	const source = asString(record?.source) === "draft" ? "draft" : defaultSource;
	return {
		id: trimToUndefined(asString(record?.id)) ?? `teach-validation-${index + 1}`,
		ok: record?.ok === true,
		summary,
		details: trimToUndefined(asString(record?.details)),
		source,
	};
}

export const READ_ONLY_TEACH_VALIDATION_TOOLS = new Set([
	"gui_observe",
	"gui_wait",
	"vision_read",
	"runtime_status",
	"session_status",
	"sessions_list",
	"sessions_history",
	"web_fetch",
	"web_search",
]);

export const DEFAULT_TEACH_CLARIFY_TIMEOUT_MS = 60_000;
// GUI replays can legitimately take several minutes, so validation does not
// apply a default prompt timeout unless the operator configures one explicitly.
export const DEFAULT_TEACH_VALIDATE_TIMEOUT_MS = 0;

export function resolveTeachInternalPromptTimeoutMs(kind: "clarify" | "validate"): number {
	const envName = kind === "validate"
		? "UNDERSTUDY_TEACH_VALIDATE_TIMEOUT_MS"
		: "UNDERSTUDY_TEACH_CLARIFY_TIMEOUT_MS";
	const configured = asNumber(process.env[envName]);
	if (configured !== undefined && Number.isFinite(configured) && configured >= 0) {
		return Math.max(0, Math.floor(configured));
	}
	return kind === "validate" ? DEFAULT_TEACH_VALIDATE_TIMEOUT_MS : DEFAULT_TEACH_CLARIFY_TIMEOUT_MS;
}

export function isTeachValidationMutatingTool(name: string): boolean {
	const normalized = name.trim().toLowerCase();
	if (!normalized) {
		return false;
	}
	if (READ_ONLY_TEACH_VALIDATION_TOOLS.has(normalized)) {
		return false;
	}
	if (normalized === "browser" || normalized === "bash" || normalized === "process") {
		return true;
	}
	return normalized.startsWith("gui_");
}

export function draftExpectsMutatingReplay(draft: TaughtTaskDraft): boolean {
	return draft.steps.some((step) => isTeachValidationMutatingTool(step.toolName));
}

export { trimToUndefined, asStringList, uniqueStrings };
