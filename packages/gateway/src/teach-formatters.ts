import { readFile } from "node:fs/promises";
import { asBoolean, asNumber, asRecord, asString } from "./value-coerce.js";
import {
	type TeachClarificationState,
	asStringList,
	buildTeachGuiReferencePathLines,
	formatTeachExecutionRouteOrder,
	formatTeachRouteOptionTarget,
	normalizeTeachExecutionPolicy,
	normalizeTeachExecutionRoute,
	normalizeTeachProcedure,
	normalizeTeachSkillDependencies,
	normalizeTeachTaskCard,
	trimToUndefined,
} from "./teach-normalization.js";

export const formatTeachClockTime = (value: unknown): string | undefined => {
	const timestampMs = asNumber(value);
	if (timestampMs === undefined) {
		return undefined;
	}
	const totalSeconds = Math.max(0, Math.floor(timestampMs / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

export const formatTeachDuration = (value: unknown): string | undefined => {
	const durationMs = asNumber(value);
	if (durationMs === undefined) {
		return undefined;
	}
	if (durationMs < 1_000) {
		return `${Math.round(durationMs)} ms`;
	}
	if (durationMs < 60_000) {
		return `${(durationMs / 1_000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`;
	}
	const totalSeconds = Math.floor(durationMs / 1_000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
};

export const summarizeTeachList = (items: string[], prefix: string, limit: number): string[] => {
	if (items.length === 0) {
		return [];
	}
	const visible = items.slice(0, limit).map((item) => `${prefix}${item}`);
	if (items.length > limit) {
		visible.push(`${prefix}...and ${items.length - limit} more`);
	}
	return visible;
};

export const summarizeTeachChecks = (value: unknown, limit: number = 5): string[] => {
	if (!Array.isArray(value) || value.length === 0) {
		return [];
	}
	const visible = value
		.map((entry) => asRecord(entry))
		.filter((entry): entry is Record<string, unknown> => Boolean(entry))
		.slice(0, limit)
		.map((check) => {
			const summary = asString(check.summary) ?? asString(check.id) ?? "Validation check";
			return `- ${check.ok === true ? "pass" : "fail"}: ${summary}`;
		});
	if (value.length > limit) {
		visible.push(`- ...and ${value.length - limit} more checks`);
	}
	return visible;
};

export const summarizeTeachKeyframes = (draft: Record<string, unknown>, limit: number = 6): string[] => {
	const sourceDetails = asRecord(draft.sourceDetails);
	const keyframes = Array.isArray(sourceDetails?.keyframes)
		? sourceDetails.keyframes
			.map((entry) => asRecord(entry))
			.filter((entry): entry is Record<string, unknown> => Boolean(entry))
		: [];
	if (keyframes.length === 0) {
		return [];
	}
	const lines = keyframes.slice(0, limit).map((frame, index) => {
		const time = formatTeachClockTime(frame.timestampMs);
		const label = asString(frame.label);
		const kind = asString(frame.kind);
		const path = asString(frame.path);
		const parts = [
			`${index + 1}.`,
			time ? `@ ${time}` : undefined,
			kind,
			label,
			path ? `-> ${path}` : undefined,
		].filter(Boolean);
		return parts.join(" ");
	});
	if (keyframes.length > limit) {
		lines.push(`...and ${keyframes.length - limit} more keyframes`);
	}
	return lines;
};

export const summarizeTeachDraft = (draft: Record<string, unknown>): string[] => {
	const lines: string[] = [];
	const draftId = asString(draft.id);
	const title = asString(draft.title);
	const objective = asString(draft.objective) ?? asString(draft.intent);
	const status = asString(draft.status);
	const routeSignature = asString(draft.routeSignature);
	const sourceDetails = asRecord(draft.sourceDetails);
	const evidenceSummary = asString(sourceDetails?.evidenceSummary);
	const analyzerProvider = asString(sourceDetails?.analyzerProvider);
	const analyzerModel = asString(sourceDetails?.analyzerModel);
	const taskKind = asString(draft.taskKind);
	const executionPolicy = normalizeTeachExecutionPolicy(draft.executionPolicy);
	const stepRouteOptions = Array.isArray(draft.stepRouteOptions)
		? draft.stepRouteOptions
			.map((entry) => asRecord(entry))
			.filter((entry): entry is Record<string, unknown> => Boolean(entry))
		: [];
	const taskCard = normalizeTeachTaskCard(asRecord(draft.taskCard));
	const procedure = normalizeTeachProcedure(
		Array.isArray(draft.procedure) ? draft.procedure : undefined,
	) ?? [];
	const replayPreconditions = asStringList(draft.replayPreconditions);
	const resetSignals = asStringList(draft.resetSignals);
	const skillDependencies = normalizeTeachSkillDependencies(
		Array.isArray(draft.skillDependencies) ? draft.skillDependencies : undefined,
	) ?? [];
	const steps = Array.isArray(draft.steps)
		? draft.steps
			.map((entry) => asRecord(entry))
			.filter((entry): entry is Record<string, unknown> => Boolean(entry))
		: [];
	const guiReferencePathLines = buildTeachGuiReferencePathLines({
		procedure,
		stepRouteOptions,
		steps,
	});
	if (draftId) {
		lines.push(`- Draft: \`${draftId}\`${status ? ` (${status})` : ""}`);
	}
	if (title) {
		lines.push(`- Title: ${title}`);
	}
	if (objective) {
		lines.push(`- Objective: ${objective}`);
	}
	if (routeSignature) {
		lines.push(`- Route: ${routeSignature}`);
	}
	if (evidenceSummary) {
		lines.push(`- Evidence: ${evidenceSummary}`);
	}
	if (analyzerProvider || analyzerModel) {
		lines.push(`- Analyzer: ${[analyzerProvider, analyzerModel].filter(Boolean).join(" / ")}`);
	}
	if (taskKind) {
		lines.push(`- Task kind: ${taskKind}`);
	}
	if (executionPolicy) {
		lines.push("- Execution strategy:");
		if (executionPolicy.toolBinding) {
			lines.push(`- Tool binding: ${executionPolicy.toolBinding}`);
		}
		const preferredRoutes = formatTeachExecutionRouteOrder(executionPolicy.preferredRoutes);
		if (preferredRoutes) {
			lines.push(`- Preferred routes: ${preferredRoutes}`);
		}
		if (executionPolicy.stepInterpretation) {
			lines.push(`- Detailed steps meaning: ${executionPolicy.stepInterpretation}`);
		}
		if (executionPolicy.notes && executionPolicy.notes.length > 0) {
			lines.push(...executionPolicy.notes.map((note) => `- ${note}`));
		}
	}
	if (procedure.length > 0) {
		lines.push("- Staged workflow:");
		lines.push(
			...procedure.slice(0, 8).map((step, index) => {
				const kind = trimToUndefined(asString(step.kind));
				const skillName = trimToUndefined(asString(step.skillName));
				const notes = trimToUndefined(asString(step.notes));
				return `${index + 1}. ${[
					asString(step.instruction) ?? "Step",
					kind ? `[${kind}]` : undefined,
					skillName ? `skill=${skillName}` : undefined,
					notes ? `(${notes})` : undefined,
				].filter(Boolean).join(" ")}`;
			}),
		);
		if (procedure.length > 8) {
			lines.push(`...and ${procedure.length - 8} more workflow phases`);
		}
	}
	if (guiReferencePathLines.length > 0) {
		lines.push("- GUI reference path (reference only):");
		lines.push(...guiReferencePathLines.slice(0, 16));
		if (guiReferencePathLines.length > 16) {
			lines.push(`...and ${guiReferencePathLines.length - 16} more GUI reference lines`);
		}
	}
	if (stepRouteOptions.length > 0) {
		lines.push("- Tool route options (reference only):");
		for (const procedureStep of procedure.slice(0, 8)) {
			const options = stepRouteOptions.filter((option) => asString(option.procedureStepId) === procedureStep.id);
			if (options.length === 0) {
				continue;
			}
			lines.push(`${procedureStep.index}. ${asString(procedureStep.instruction) ?? "Step"}`);
			lines.push(
				...options.slice(0, 4).map((option) => {
					const route = normalizeTeachExecutionRoute(option.route) ?? "gui";
					const target = formatTeachRouteOptionTarget({
						route,
						toolName: trimToUndefined(asString(option.toolName)),
						skillName: trimToUndefined(asString(option.skillName)),
					});
					return `- [${asString(option.preference) ?? "preferred"}] [${target}] ${asString(option.instruction) ?? "Route option"}`;
				}),
			);
		}
	}
	if (taskCard) {
		lines.push("- Task card:");
		lines.push(`- Goal: ${taskCard.goal ?? objective ?? title ?? "Not specified yet."}`);
		lines.push(`- Scope: ${taskCard.scope ?? "Reusable workflow."}`);
		lines.push(`- Loop over: ${taskCard.loopOver ?? "The current demonstrated item."}`);
		lines.push(`- Inputs: ${taskCard.inputs.length > 0 ? taskCard.inputs.join("; ") : "No structured inputs captured."}`);
		lines.push(`- Extract: ${taskCard.extract.length > 0 ? taskCard.extract.join("; ") : "No structured extracts captured."}`);
		lines.push(`- Formula: ${taskCard.formula ?? "None captured."}`);
		lines.push(`- Filter: ${taskCard.filter ?? "None captured."}`);
		lines.push(`- Output: ${taskCard.output ?? "Verify the externally visible task outcome."}`);
	}
	if (procedure.length === 0 && steps.length > 0) {
		lines.push("- Steps:");
		lines.push(
			...steps.slice(0, 8).map((step, index) =>
				`${index + 1}. ${asString(step.instruction) ?? asString(step.summary) ?? "Step"}`),
		);
		if (steps.length > 8) {
			lines.push(`...and ${steps.length - 8} more steps`);
		}
	}
	if (replayPreconditions.length > 0) {
		lines.push("- Replay preconditions:");
		lines.push(...replayPreconditions.map((entry) => `- ${entry}`));
	}
	if (resetSignals.length > 0) {
		lines.push("- Reset signals:");
		lines.push(...resetSignals.map((entry) => `- ${entry}`));
	}
	if (skillDependencies.length > 0) {
		lines.push("- Compose with skills:");
		lines.push(
			...skillDependencies.slice(0, 6).map((dependency) => {
				const name = asString(dependency.name) ?? "unknown-skill";
				const reason = trimToUndefined(asString(dependency.reason));
				return `- ${name}${reason ? `: ${reason}` : ""}`;
			}),
		);
		if (skillDependencies.length > 6) {
			lines.push(`- ...and ${skillDependencies.length - 6} more skill dependencies`);
		}
	}
	const successCriteria = asStringList(draft.successCriteria);
	if (successCriteria.length > 0) {
		lines.push("- Success criteria:");
		lines.push(...summarizeTeachList(successCriteria, "- ", 5));
	}
	const openQuestions = asStringList(draft.openQuestions);
	if (openQuestions.length > 0) {
		lines.push("- Open questions:");
		lines.push(...summarizeTeachList(openQuestions, "- ", 5));
	}
	const keyframeLines = summarizeTeachKeyframes(draft);
	if (keyframeLines.length > 0) {
		lines.push("- Keyframes:");
		lines.push(...keyframeLines);
	}
	return lines;
};

export const summarizeTeachValidation = (validation: Record<string, unknown>): string[] => {
	const lines: string[] = [];
	const state = asString(validation.state);
	const summary = asString(validation.summary);
	const mode = asString(validation.mode);
	const notes = asStringList(validation.notes);
	const usedMutatingTools = asBoolean(validation.usedMutatingTools);
	const toolNames = asStringList(validation.toolNames);
	const mutatingToolNames = asStringList(validation.mutatingToolNames);
	const runId = asString(validation.runId);
	if (state || summary) {
		lines.push(`- Validation: ${[state, summary].filter(Boolean).join(" - ")}`);
	}
	if (mode) {
		lines.push(`- Mode: ${mode}`);
	}
	if (runId) {
		lines.push(`- Run ID: ${runId}`);
	}
	if (toolNames.length > 0) {
		lines.push(`- Tools: ${toolNames.join(", ")}`);
	}
	if (mutatingToolNames.length > 0 || usedMutatingTools !== undefined) {
		lines.push(`- Mutating replay tools: ${mutatingToolNames.length > 0 ? mutatingToolNames.join(", ") : "none"}`);
		lines.push(`- Real replay: ${usedMutatingTools === true ? "yes" : "no"}`);
	}
	if (notes.length > 0) {
		lines.push("- Notes:");
		lines.push(...summarizeTeachList(notes, "- ", 4));
	}
	const checks = summarizeTeachChecks(validation.checks);
	if (checks.length > 0) {
		lines.push("- Checks:");
		lines.push(...checks);
	}
	return lines;
};

export const loadTeachSkillPreview = async (skillPath?: string): Promise<string | undefined> => {
	if (!skillPath) {
		return undefined;
	}
	try {
		const raw = await readFile(skillPath, "utf8");
		const lines = raw.trimEnd().split(/\r?\n/);
		const preview = lines.slice(0, 18).join("\n");
		return lines.length > 18 ? `${preview}\n...` : preview;
	} catch {
		return undefined;
	}
};

export const summarizeTeachSkill = async (skill: Record<string, unknown>): Promise<string[]> => {
	const lines: string[] = [];
	const name = asString(skill.name);
	const skillPath = asString(skill.skillPath);
	if (name) {
		lines.push(`- Skill: \`${name}\``);
	}
	if (skillPath) {
		lines.push(`- Path: ${skillPath}`);
	}
	const preview = await loadTeachSkillPreview(skillPath);
	if (preview) {
		lines.push("- Preview:");
		lines.push("```md");
		lines.push(preview);
		lines.push("```");
	}
	return lines;
};

export const buildTeachReport = async (params: {
	headline: string;
	recording?: Record<string, unknown>;
	draft?: Record<string, unknown>;
	validation?: Record<string, unknown>;
	skill?: Record<string, unknown>;
	analysisError?: string;
	nextSteps?: string[];
}): Promise<string> => {
	const lines = [params.headline];
	const recording = params.recording ?? {};
	const draft = params.draft ?? {};
	const validation = Object.keys(params.validation ?? {}).length > 0
		? params.validation!
		: asRecord(draft.validation) ?? {};
	const skill = params.skill ?? asRecord(draft.publishedSkill) ?? {};
	const videoPath = asString(recording.videoPath);
	const eventLogPath = asString(recording.eventLogPath);
	const recordingDuration = formatTeachDuration(recording.durationMs);
	if (videoPath || eventLogPath || recordingDuration) {
		lines.push("", "Recording:");
		if (videoPath) {
			lines.push(`- Video: ${videoPath}`);
		}
		if (eventLogPath) {
			lines.push(`- Event log: ${eventLogPath}`);
		}
		if (recordingDuration) {
			lines.push(`- Duration: ${recordingDuration}`);
		}
	}
	if (params.analysisError) {
		lines.push("", "Analysis:");
		lines.push(`- Error: ${params.analysisError}`);
	}
	if (Object.keys(draft).length > 0) {
		lines.push("", "Draft:");
		lines.push(...summarizeTeachDraft(draft));
	}
	if (Object.keys(validation).length > 0) {
		lines.push("", "Validation:");
		lines.push(...summarizeTeachValidation(validation));
	}
	if (Object.keys(skill).length > 0) {
		lines.push("", "Skill:");
		lines.push(...await summarizeTeachSkill(skill));
	}
	if (Array.isArray(params.nextSteps) && params.nextSteps.length > 0) {
		lines.push("", "Next:");
		lines.push(...params.nextSteps.map((step) => `- ${step}`));
	}
	return lines.join("\n");
};

export const buildTeachClarificationReport = async (params: {
	headline: string;
	recording?: Record<string, unknown>;
	draft: Record<string, unknown>;
	state: TeachClarificationState;
	nextSteps?: string[];
	includeDraftSnapshot?: boolean;
}): Promise<string> => {
	const lines = [params.headline];
	const recording = params.recording ?? {};
	const videoPath = asString(recording.videoPath);
	const eventLogPath = asString(recording.eventLogPath);
	const recordingDuration = formatTeachDuration(recording.durationMs);
	if (videoPath || eventLogPath || recordingDuration) {
		lines.push("", "Recording:");
		if (videoPath) {
			lines.push(`- Video: ${videoPath}`);
		}
		if (eventLogPath) {
			lines.push(`- Event log: ${eventLogPath}`);
		}
		if (recordingDuration) {
			lines.push(`- Duration: ${recordingDuration}`);
		}
	}
	lines.push("", "Task Card:");
	const taskCard = params.state.taskCard;
	if (taskCard) {
		lines.push(`- Goal: ${taskCard.goal ?? "Not specified yet."}`);
		lines.push(`- Scope: ${taskCard.scope ?? "Not specified yet."}`);
		lines.push(`- Loop over: ${taskCard.loopOver ?? "Not specified yet."}`);
		lines.push(`- Inputs: ${taskCard.inputs.length > 0 ? taskCard.inputs.join("; ") : "Not specified yet."}`);
		lines.push(`- Extract: ${taskCard.extract.length > 0 ? taskCard.extract.join("; ") : "Not specified yet."}`);
		lines.push(`- Formula: ${taskCard.formula ?? "Not specified yet."}`);
		lines.push(`- Filter: ${taskCard.filter ?? "Not specified yet."}`);
		lines.push(`- Output: ${taskCard.output ?? "Not specified yet."}`);
	} else {
		lines.push("- Goal: Not specified yet.");
	}
	if (params.includeDraftSnapshot !== false) {
		lines.push("", "Draft Snapshot:");
		lines.push(...summarizeTeachDraft(params.draft));
	}
	lines.push("", "Clarification:");
	lines.push(`- Status: ${params.state.status}`);
	if (params.state.summary) {
		lines.push(`- Summary: ${params.state.summary}`);
	}
	if (params.state.excludedDemoSteps.length > 0) {
		lines.push("- Excluded demo-only steps:");
		lines.push(...summarizeTeachList(params.state.excludedDemoSteps, "- ", 4));
	}
	if (params.state.pendingQuestions.length > 0) {
		lines.push("- Pending questions:");
		lines.push(...summarizeTeachList(params.state.pendingQuestions, "- ", 6));
	} else if (params.state.nextQuestion) {
		lines.push(`- Next question: ${params.state.nextQuestion}`);
	}
	if (Array.isArray(params.nextSteps) && params.nextSteps.length > 0) {
		lines.push("", "Next:");
		lines.push(...params.nextSteps.map((step) => `- ${step}`));
	}
	return lines.join("\n");
};
