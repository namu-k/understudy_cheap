import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import type {
	TaughtTaskDraft,
	TaughtTaskProcedureStep,
	TaughtTaskPlaybookStage,
	TaughtTaskWorkerContract,
	TaughtTaskStepRouteOption,
} from "./task-draft-types.js";
import {
	normalizeWorkerContract,
	buildWorkerContractFromDraftSeed,
	rankRouteOptionPreference,
	findDetailedStepForProcedureStep,
	formatStepRouteOptionTarget,
	buildProcedureFromSteps,
	formatExecutionRouteOrder,
	describeDetailedStepUsage,
	describeToolArgumentValue,
	normalizeLineList,
} from "./task-draft-normalization.js";

function sanitizeSkillNameSegment(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function quoteYamlString(value: string): string {
	return JSON.stringify(value);
}

export function buildPublishedSkillName(draft: TaughtTaskDraft, explicitName?: string): string {
	const provided = sanitizeSkillNameSegment(explicitName ?? "");
	if (provided) {
		return sanitizeSkillNameSegment(`taught-${provided}-${createHash("sha1").update(draft.id).digest("hex").slice(0, 6)}`);
	}
	const base = sanitizeSkillNameSegment(draft.title || draft.objective || "routine") || "routine";
	return sanitizeSkillNameSegment(`taught-${base}-${createHash("sha1").update(draft.id).digest("hex").slice(0, 6)}`);
}

function normalizePublishedSkillText(value: string | undefined, maxLength = 160): string | undefined {
	const trimmed = value?.replace(/\s+/g, " ").trim();
	if (!trimmed) return undefined;
	if (trimmed.length <= maxLength) return trimmed;
	return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function stripTrailingSentencePunctuation(value: string): string {
	return value.replace(/[.!?。]+$/u, "").trim();
}

function extractQuotedLabels(value: string | undefined): string[] {
	if (!value?.trim()) return [];
	const labels: string[] = [];
	const patterns = [/"([^"]{1,12})"/g, /\u201C([^\u201D]{1,12})\u201D/g];
	for (const pattern of patterns) {
		for (const match of value.matchAll(pattern)) {
			const label = normalizePublishedSkillText(match[1], 48);
			if (label) labels.push(label);
		}
	}
	return Array.from(new Set(labels));
}

export function buildPublishedSkillTriggers(draft: TaughtTaskDraft): string[] {
	const goal = normalizePublishedSkillText(draft.taskCard?.goal ?? draft.objective ?? draft.intent ?? draft.title, 180);
	const objective = normalizePublishedSkillText(draft.objective, 180);
	const output = normalizePublishedSkillText(draft.taskCard?.output, 180);
	const appNames = Array.from(new Set(
		draft.steps
			.map((step) => normalizePublishedSkillText(step.app, 80))
			.filter((value): value is string => Boolean(value)),
	));
	const parameterHints = draft.parameterSlots
		.map((slot) => normalizePublishedSkillText(slot.label || slot.name, 40))
		.filter((value): value is string => Boolean(value));
	const visibleLabels = Array.from(new Set(
		draft.steps.flatMap((step) => [
			...extractQuotedLabels(step.target),
			...extractQuotedLabels(step.instruction),
		]),
	)).slice(0, 3);
	const candidates = [
		appNames.length > 0 && visibleLabels.length > 0
			? normalizePublishedSkillText(`${appNames[0]} ${visibleLabels.join(" ")}`, 96)
			: undefined,
		appNames.length > 0 && parameterHints.length > 0
			? normalizePublishedSkillText(`${appNames[0]} ${parameterHints.join(", ")}`, 96)
			: undefined,
		goal ? normalizePublishedSkillText(stripTrailingSentencePunctuation(goal), 120) : undefined,
		objective ? normalizePublishedSkillText(stripTrailingSentencePunctuation(objective), 120) : undefined,
		output ? normalizePublishedSkillText(stripTrailingSentencePunctuation(output), 120) : undefined,
		goal && parameterHints.length > 0
			? normalizePublishedSkillText(`${stripTrailingSentencePunctuation(goal)} with ${parameterHints.join(", ")}`, 120)
			: undefined,
	]
		.filter((value): value is string => Boolean(value));
	return Array.from(new Set(candidates)).slice(0, 5);
}

export function buildPublishedSkillDescription(draft: TaughtTaskDraft): string {
	const goal = normalizePublishedSkillText(draft.taskCard?.goal ?? draft.objective ?? draft.intent ?? draft.title, 220)
		?? "Reusable taught workflow.";
	const appNames = Array.from(new Set(
		draft.steps
			.map((step) => normalizePublishedSkillText(step.app, 60))
			.filter((value): value is string => Boolean(value)),
	));
	const parameterHints = draft.parameterSlots
		.map((slot) => normalizePublishedSkillText(slot.label || slot.name, 32))
		.filter((value): value is string => Boolean(value));
	const triggers = buildPublishedSkillTriggers(draft).slice(0, 3);
	const parts = [
		stripTrailingSentencePunctuation(goal),
		appNames.length > 0 ? `Primary surface: ${appNames.join(", ")}` : undefined,
		parameterHints.length > 0 ? `Inputs: ${parameterHints.join(", ")}` : undefined,
		triggers.length > 0 ? `Trigger cues: ${triggers.join(" | ")}` : undefined,
	].filter((value): value is string => Boolean(value));
	const description = parts.join(". ");
	return description.length <= 900
		? `${description}${/[.!?]$/.test(description) ? "" : "."}`
		: `${description.slice(0, 897).trimEnd()}...`;
}

export function resolveDefaultTaughtTaskSkillsDir(workspaceDir: string): string {
	return join(resolve(workspaceDir), "skills");
}

function resolveDraftProcedure(draft: TaughtTaskDraft): TaughtTaskProcedureStep[] {
	return draft.procedure.length > 0 ? draft.procedure : buildProcedureFromSteps(draft.steps);
}

export function buildStagedWorkflowLines(procedure: TaughtTaskProcedureStep[]): string[] {
	return procedure.flatMap((step) => [
		`${step.index}. ${step.instruction}${step.kind === "skill" && step.skillName ? ` (delegate to skill \`${step.skillName}\`)` : ""}`,
		...(step.notes ? [`   Notes: ${step.notes}`] : []),
	]);
}

export function buildPlaybookStageLines(stages: TaughtTaskPlaybookStage[]): string[] {
	return stages.map((stage, index) => {
		const stageToken = stage.refName || sanitizeSkillNameSegment(stage.name) || `stage-${index + 1}`;
		const refToken = ` ${stageToken}`;
		const modifiers = [
			stage.inputs.length > 0 ? `inputs: ${stage.inputs.join(", ")}` : undefined,
			stage.outputs.length > 0 ? `outputs: ${stage.outputs.join(", ")}` : undefined,
			stage.budgetNotes.length > 0 ? `budget: ${stage.budgetNotes.join(", ")}` : undefined,
			stage.retryPolicy ? `retry: ${stage.retryPolicy}` : undefined,
			stage.approvalGate ? `approval: ${stage.approvalGate}` : undefined,
		].filter((entry): entry is string => Boolean(entry));
		return `${index + 1}. [${stage.kind}]${refToken} -> ${stage.objective}${modifiers.length > 0 ? ` | ${modifiers.join(" | ")}` : ""}`;
	});
}

function buildPublishedArtifactFrontmatterLines(params: {
	draft: TaughtTaskDraft;
	triggers: string[];
}): string[] {
	return [
		"---",
		...(params.triggers.length > 0
			? [
				"triggers:",
				...params.triggers.map((trigger) => `  - ${quoteYamlString(trigger)}`),
			]
			: []),
		"metadata:",
		"  understudy:",
		`    artifactKind: ${quoteYamlString(params.draft.artifactKind)}`,
		"    taught: true",
		`    workspaceDir: ${quoteYamlString(resolve(params.draft.workspaceDir))}`,
		`    draftId: ${quoteYamlString(params.draft.id)}`,
		`    runId: ${quoteYamlString(params.draft.runId)}`,
		`    routeSignature: ${quoteYamlString(params.draft.routeSignature)}`,
		...(params.draft.artifactKind === "playbook" && params.draft.childArtifacts.length > 0
			? [
				"    childArtifacts:",
				...params.draft.childArtifacts.flatMap((artifact) => [
					`      - name: ${quoteYamlString(artifact.name)}`,
					`        artifactKind: ${quoteYamlString(artifact.artifactKind)}`,
					`        required: ${artifact.required ? "true" : "false"}`,
					...(artifact.reason ? [`        reason: ${quoteYamlString(artifact.reason)}`] : []),
				]),
			]
			: []),
	];
}

function buildPublishedPlaybookOutputContractLines(draft: TaughtTaskDraft): string[] {
	const outputCandidates = Array.from(new Set([
		...draft.playbookStages.flatMap((stage) => stage.outputs),
		...draft.successCriteria,
		...(draft.taskCard?.output ? [draft.taskCard.output] : []),
	].map((entry) => entry.trim()).filter(Boolean)));
	return outputCandidates.length > 0
		? outputCandidates.map((entry) => `- ${entry}`)
		: ["- Produce the expected deliverable artifacts before approval."];
}

function collectPlaybookApprovalGates(draft: TaughtTaskDraft): string[] {
	return Array.from(new Set(
		draft.playbookStages
			.map((stage) => stage.approvalGate?.trim())
			.filter((entry): entry is string => Boolean(entry) && entry !== "none"),
	));
}

function buildPublishedPlaybookMarkdown(params: {
	name: string;
	draft: TaughtTaskDraft;
}): string {
	const { draft, name } = params;
	const triggers = buildPublishedSkillTriggers(draft);
	const frontmatterLines = buildPublishedArtifactFrontmatterLines({ draft, triggers });
	const approvalGates = collectPlaybookApprovalGates(draft);
	return [
		...frontmatterLines.slice(0, 1),
		`name: ${name}`,
		`description: ${quoteYamlString(buildPublishedSkillDescription(draft))}`,
		...frontmatterLines.slice(1),
		"---",
		"",
		`# ${name}`,
		"",
		`This workspace playbook was taught from an explicit teach draft captured in \`${resolve(draft.workspaceDir)}\`.`,
		"",
		"## Goal",
		"",
		draft.taskCard?.goal ?? draft.objective ?? draft.intent ?? draft.title,
		"",
		"## Inputs",
		"",
		...(draft.parameterSlots.length > 0
			? draft.parameterSlots.map((slot) => `- ${slot.label || slot.name}${slot.sampleValue ? ` (${slot.sampleValue})` : ""}`)
			: ["- No parameter slots were captured. Confirm required inputs before running the playbook."]),
		"",
		"## Child Artifacts",
		"",
		...(draft.childArtifacts.length > 0
			? draft.childArtifacts.map((artifact) =>
				`- ${artifact.name} [${artifact.artifactKind}]${artifact.reason ? `: ${artifact.reason}` : ""}${artifact.required ? " (required)" : ""}`)
			: ["- No child artifacts were captured yet."]),
		"",
		"## Stage Plan",
		"",
		...(draft.playbookStages.length > 0
			? buildPlaybookStageLines(draft.playbookStages)
			: ["1. No playbook stages were captured yet."]),
		"",
		"## Output Contract",
		"",
		...buildPublishedPlaybookOutputContractLines(draft),
		"",
		"## Approval Gates",
		"",
		...(draft.playbookStages.some((stage) => stage.kind === "approval" || Boolean(stage.approvalGate))
			? [approvalGates.length > 0
				? `- Human approval is required at these gates: ${approvalGates.join(", ")}.`
				: "- Human approval is required before continuing past approval stages or other high-risk work."]
			: ["- No explicit approval gates were captured."]),
		"",
		"## Failure Policy",
		"",
		...(draft.uncertainties.length > 0
			? draft.uncertainties.map((entry) => `- ${entry}`)
			: ["- Pause and escalate when a stage cannot preserve the intended outcome."]),
		"",
	].join("\n");
}

function buildPublishedWorkerBudgetLines(contract: TaughtTaskWorkerContract | undefined): string[] {
	if (!contract?.budget) {
		return ["- No explicit budget was captured yet. Confirm the worker budget before long exploratory runs."];
	}
	const lines = [
		contract.budget.maxMinutes !== undefined ? `- maxMinutes=${contract.budget.maxMinutes}` : undefined,
		contract.budget.maxActions !== undefined ? `- maxActions=${contract.budget.maxActions}` : undefined,
		contract.budget.maxScreenshots !== undefined ? `- maxScreenshots=${contract.budget.maxScreenshots}` : undefined,
	].filter((entry): entry is string => Boolean(entry));
	return lines.length > 0
		? lines
		: ["- No explicit budget was captured yet. Confirm the worker budget before long exploratory runs."];
}

function buildPublishedWorkerMarkdown(params: {
	name: string;
	draft: TaughtTaskDraft;
}): string {
	const { draft, name } = params;
	const triggers = buildPublishedSkillTriggers(draft);
	const frontmatterLines = buildPublishedArtifactFrontmatterLines({ draft, triggers });
	const contract = normalizeWorkerContract(
		draft.workerContract,
		buildWorkerContractFromDraftSeed({
			title: draft.title,
			objective: draft.objective || draft.intent || draft.title,
			taskCard: draft.taskCard,
			parameterSlots: draft.parameterSlots,
			successCriteria: draft.successCriteria,
			uncertainties: draft.uncertainties,
			executionPolicy: draft.executionPolicy,
		}),
	);
	return [
		...frontmatterLines.slice(0, 1),
		`name: ${name}`,
		`description: ${quoteYamlString(buildPublishedSkillDescription(draft))}`,
		...frontmatterLines.slice(1),
		"---",
		"",
		`# ${name}`,
		"",
		`This workspace worker was taught from an explicit teach draft captured in \`${resolve(draft.workspaceDir)}\`.`,
		"",
		"## Goal",
		"",
		contract?.goal ?? draft.taskCard?.goal ?? draft.objective ?? draft.intent ?? draft.title,
		"",
		"## Operating Contract",
		"",
		...(contract
			? [
				`- Scope: ${contract.scope ?? "Goal-driven reusable worker."}`,
				`- Allowed routes: ${contract.allowedRoutes.join(", ")}`,
				`- Allowed surfaces: ${contract.allowedSurfaces.length > 0 ? contract.allowedSurfaces.join("; ") : "Not specified yet."}`,
			]
			: ["- No worker contract was captured yet."]),
		"",
		"## Inputs",
		"",
		...(contract?.inputs.length ? contract.inputs.map((entry) => `- ${entry}`) : ["- No explicit inputs were captured."]),
		"",
		"## Outputs",
		"",
		...(contract?.outputs.length ? contract.outputs.map((entry) => `- ${entry}`) : ["- No explicit outputs were captured."]),
		"",
		"## Budget",
		"",
		...buildPublishedWorkerBudgetLines(contract),
		"",
		"## Allowed Surfaces",
		"",
			...(contract?.allowedSurfaces.length ? contract.allowedSurfaces.map((entry) => `- ${entry}`) : [
				"- Only the surfaces required to accomplish the assigned goal.",
				"- Escalate before expanding to unrelated surfaces.",
			]),
		"",
		"## Stop Conditions",
		"",
		...(contract?.stopConditions.length ? contract.stopConditions.map((entry) => `- ${entry}`) : ["- Stop once the required outputs are sufficiently supported."]),
		"",
		"## Decision Heuristics",
		"",
		...(contract?.decisionHeuristics.length ? contract.decisionHeuristics.map((entry) => `- ${entry}`) : ["- Prefer evidence-producing actions over exhaustive blind traversal."]),
		"",
		"## Failure Policy",
		"",
		...(contract?.escalationPolicy.length ? contract.escalationPolicy.map((entry) => `- ${entry}`) : ["- Escalate or pause when the worker cannot preserve the intended outcome."]),
		"",
	].join("\n");
}

function buildGuiReferencePathLines(params: {
	draft: TaughtTaskDraft;
	procedure: TaughtTaskProcedureStep[];
}): string[] {
	return params.procedure.flatMap((procedureStep) => {
		const guiOption = params.draft.stepRouteOptions
			.filter((option) => option.procedureStepId === procedureStep.id && option.route === "gui")
			.sort((left, right) => rankRouteOptionPreference(left.preference) - rankRouteOptionPreference(right.preference))[0];
		const observedStep = guiOption?.preference === "observed"
			? undefined
			: !guiOption && (procedureStep.kind === "transform" || procedureStep.kind === "filter")
			? undefined
			: findDetailedStepForProcedureStep({
				draft: params.draft,
				procedureStep,
				preferredToolName: guiOption?.toolName,
				preferredInstruction: guiOption?.instruction,
			});
		const instruction =
			guiOption?.instruction ||
			observedStep?.instruction ||
			procedureStep.instruction;
		const lines = [
			`${procedureStep.index}. ${instruction}`,
		];
		const meta: string[] = [];
		if (guiOption) {
			meta.push(`reference: [${guiOption.preference}] [${formatStepRouteOptionTarget(guiOption)}]`);
			if (guiOption.when) meta.push(`when: ${guiOption.when}`);
			if (guiOption.notes) meta.push(`notes: ${guiOption.notes}`);
		}
		if (observedStep?.target) meta.push(`target: ${observedStep.target}`);
		if (observedStep?.app) meta.push(`app: ${observedStep.app}`);
		if (observedStep?.scope) meta.push(`scope: ${observedStep.scope}`);
		if (meta.length > 0) {
			lines.push(`   ${meta.join(" | ")}`);
		}
		return lines;
	});
}

function buildToolRouteReferenceLines(params: {
	draft: TaughtTaskDraft;
	procedure: TaughtTaskProcedureStep[];
}): string[] {
	const lines: string[] = [];
	for (const step of params.procedure) {
		const options = params.draft.stepRouteOptions.filter((option) => option.procedureStepId === step.id);
		if (options.length === 0) {
			continue;
		}
		lines.push(`${step.index}. ${step.instruction}`);
		lines.push(
			...options.flatMap((option) => [
				`   - [${option.preference}] [${formatStepRouteOptionTarget(option)}] ${option.instruction}`,
				...(option.when ? [`     When: ${option.when}`] : []),
				...(option.notes ? [`     Notes: ${option.notes}`] : []),
			]),
		);
	}
	return lines;
}

export function buildPublishedSkillMarkdown(params: {
	name: string;
	draft: TaughtTaskDraft;
}): string {
	const { draft, name } = params;
	if (draft.artifactKind === "worker") {
		return buildPublishedWorkerMarkdown(params);
	}
	if (draft.artifactKind === "playbook") {
		return buildPublishedPlaybookMarkdown(params);
	}
	const procedure = resolveDraftProcedure(draft);
	const stagedWorkflowLines = buildStagedWorkflowLines(procedure);
	const guiReferenceLines = buildGuiReferencePathLines({ draft, procedure });
	const toolRouteReferenceLines = buildToolRouteReferenceLines({ draft, procedure });
	const triggers = buildPublishedSkillTriggers(draft);
	const frontmatterLines = buildPublishedArtifactFrontmatterLines({ draft, triggers });
	return [
		...frontmatterLines.slice(0, 1),
		`name: ${name}`,
		`description: ${quoteYamlString(buildPublishedSkillDescription(draft))}`,
		...frontmatterLines.slice(1),
		"---",
		"",
		`# ${name}`,
		"",
		`This workspace skill was taught from an explicit teach draft captured in \`${resolve(draft.workspaceDir)}\`.`,
		"",
			"## Overall Goal",
		"",
			draft.objective || draft.intent || draft.title,
			"",
			"## Staged Workflow",
			"",
			...(stagedWorkflowLines.length > 0
				? stagedWorkflowLines
				: ["1. No staged workflow was captured. Use the task card and validation criteria below."]),
			"",
			"## GUI Reference Path",
			"",
			"The GUI reference path below is for replay and grounding reference only.",
			...(guiReferenceLines.length > 0
				? ["", ...guiReferenceLines]
				: ["", "1. No dedicated GUI reference path was captured. Re-observe the current UI if a GUI-only route is required."]),
			"",
			"## Tool Route Options",
			"",
			"These route options are references only. Choose the best route at runtime based on the current surface, available capabilities, and the need to preserve the same externally visible result.",
			...(toolRouteReferenceLines.length > 0
				? ["", ...toolRouteReferenceLines]
				: ["", "- No alternative tool routes were captured."]),
			"",
			"## Task Kind",
			"",
			draft.taskKind,
			"",
			"## Parameter Slots",
		"",
		...(draft.parameterSlots.length > 0
			? draft.parameterSlots.map((slot) => `- ${slot.name}${slot.sampleValue ? `: ${slot.sampleValue}` : ""}`)
			: ["- No parameter slots were captured. Confirm runtime inputs from the user when needed."]),
		"",
		"## Task Card",
		"",
		...(draft.taskCard
			? [
				`- Goal: ${draft.taskCard.goal ?? draft.objective ?? draft.intent ?? draft.title}`,
				`- Scope: ${draft.taskCard.scope ?? "Reusable workflow."}`,
				...(draft.taskKind === "batch_workflow"
					? [`- Loop over: ${draft.taskCard.loopOver ?? "The demonstrated collection or repeated unit."}`]
					: []),
				`- Inputs: ${draft.taskCard.inputs.length > 0 ? draft.taskCard.inputs.join("; ") : "No structured inputs captured."}`,
				`- Extract: ${draft.taskCard.extract.length > 0 ? draft.taskCard.extract.join("; ") : "No structured extracts captured."}`,
				`- Formula: ${draft.taskCard.formula ?? "None captured."}`,
				`- Filter: ${draft.taskCard.filter ?? "None captured."}`,
				`- Output: ${draft.taskCard.output ?? "Verify the externally visible task outcome."}`,
			]
			: ["- No task card was captured. Use the objective and procedure below."]),
		"",
			"## Compose With Skills",
		"",
			...(draft.skillDependencies.length > 0
				? draft.skillDependencies.map((dependency) =>
					`- ${dependency.name}${dependency.reason ? `: ${dependency.reason}` : ""}${dependency.required ? " (required)" : ""}`)
				: ["- No existing workspace skills were linked to this taught task."]),
			"",
			"## Replay Preconditions",
			"",
			...(draft.replayPreconditions.length > 0
				? draft.replayPreconditions.map((entry) => `- ${entry}`)
				: ["- No explicit replay preconditions were captured. Confirm the starting UI state before acting."]),
			"",
			"## Reset Signals",
			"",
			...(draft.resetSignals.length > 0
				? draft.resetSignals.map((entry) => `- ${entry}`)
				: ["- If the current UI state does not match the taught starting state, reset before replaying the procedure."]),
			"",
			"## Success Criteria",
		"",
		...(draft.successCriteria.length > 0
			? draft.successCriteria.map((criterion) => `- ${criterion}`)
			: ["- Verify the externally visible outcome before considering the task complete."]),
		"",
		"## Validation Status",
		"",
		draft.validation?.summary || "Replay validation has not been run for this teach draft yet.",
		...(draft.validation?.mode ? [`Validation mode: ${draft.validation.mode}`] : []),
		...(draft.validation?.mutatingToolNames && draft.validation.mutatingToolNames.length > 0
			? [`Mutating tools used during validation: ${draft.validation.mutatingToolNames.join(", ")}`]
			: []),
		"",
		"## Execution Strategy",
		"",
		`- Tool binding: ${draft.executionPolicy.toolBinding}`,
		`- Preferred routes: ${formatExecutionRouteOrder(draft.executionPolicy.preferredRoutes)}`,
		`- Detailed steps: ${draft.executionPolicy.stepInterpretation}`,
		...draft.executionPolicy.notes.map((note) => `- ${note}`),
		...(draft.steps.length > 0
			? [
				"## Detailed GUI Replay Hints",
				"",
				describeDetailedStepUsage(draft.executionPolicy),
				"",
				...draft.steps.flatMap((step) => {
					const parts = [`${step.index}. [${step.route}/${step.toolName}] ${step.instruction}`];
					const meta: string[] = [];
					if (step.target) meta.push(`target: ${step.target}`);
					if (step.app) meta.push(`app: ${step.app}`);
					if (step.scope) meta.push(`scope: ${step.scope}`);
					if (step.captureMode) meta.push(`captureMode: ${step.captureMode}`);
					if (step.groundingMode) meta.push(`groundingMode: ${step.groundingMode}`);
					if (step.locationHint) meta.push(`locationHint: ${step.locationHint}`);
					if (step.windowTitle) meta.push(`windowTitle: ${step.windowTitle}`);
					if (meta.length > 0) parts.push(`   ${meta.join(" | ")}`);
					if (step.inputs && Object.keys(step.inputs).length > 0) {
						parts.push(`   inputs: ${Object.entries(step.inputs).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")}`);
					}
					if (step.toolArgs && Object.keys(step.toolArgs).length > 0) {
						parts.push(
							`   toolArgs: ${Object.entries(step.toolArgs)
								.map(([key, value]) => `${key}=${describeToolArgumentValue(value)}`)
								.filter((entry) => entry.length > 0)
								.join(", ")}`,
						);
					}
					if (step.verificationSummary) parts.push(`   verify: ${step.verificationSummary}`);
					return parts;
				}),
				"",
			]
			: []),
		"## Failure Policy",
		"",
		"- Use `gui_observe` before each `gui_click`/`gui_type` to confirm the target is visible on the current surface.",
		"- Use `groundingMode: \"single\"` for clearly labeled one-match controls such as a top-menu item, dialog action, tab, or row. Escalate to `groundingMode: \"complex\"` after any grounding failure or when the UI is dense/ambiguous.",
		"- Use `captureMode: \"display\"` for menu bar, Dock, or cross-window operations; `captureMode: \"window\"` for in-app work.",
		"- Describe targets using visible text labels from the current screenshot, not memorized positions from the teach recording.",
		"- Re-observe the UI after each significant state change.",
		"- Prefer reusing linked workspace skills for matching substeps before falling back to raw UI replay.",
		"- If the route diverges or verification weakens, replan instead of blindly replaying the taught steps.",
		"- Ask the user for missing parameters when the current request does not fully match the taught draft.",
		"",
	].join("\n");
}
