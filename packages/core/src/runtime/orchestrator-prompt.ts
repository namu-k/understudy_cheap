import type { Model } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { UnderstudyConfig } from "@understudy/types";
import {
	buildUnderstudySystemPrompt,
	type ContextFile,
	type PromptMode,
	type SystemPromptOptions,
} from "../system-prompt.js";
import { buildSystemPromptParams, type SystemPromptRuntimeParams } from "../system-prompt-params.js";
import { buildToolSummaryMap } from "../tool-summaries.js";
import {
	buildUnderstudyPromptReport,
	type UnderstudyPromptReport,
} from "../prompt-report.js";
import { filterOpenClawCompatibilityToolNames } from "../openclaw-compat.js";
import { buildWorkspaceSkillSnapshot, type SkillSnapshot } from "../skills/workspace.js";
import {
	buildTaughtTaskDraftPromptContent,
	loadPersistedTaughtTaskDraftLedger,
} from "../task-drafts.js";
import {
	buildPromptImageModeGuidance,
	resolvePromptImageSupportMode,
} from "./prompt-image-support.js";
import type { RuntimePolicyPipeline } from "./policy-pipeline.js";
import type { RuntimeToolDefinition } from "./types.js";
import { isHiddenCompatibilityToolDefinition, loadContextFiles, buildModelFallbackPromptContent } from "./orchestrator-helpers.js";
import type { UnderstudySessionOptions } from "./orchestrator.js";

export interface BuildSessionPromptResult {
	systemPrompt: string;
	promptReport: UnderstudyPromptReport;
	advertisedToolNames: string[];
	runtimeParams: SystemPromptRuntimeParams;
	contextFiles: ContextFile[];
	skillsSnapshot: SkillSnapshot;
}

export async function buildSessionPrompt(params: {
	config: UnderstudyConfig;
	opts: UnderstudySessionOptions;
	cwd: string;
	workspaceContext: { repoRoot?: string };
	modelLabel: string;
	exposedTools: AgentTool[];
	preflight: { enabledToolNames: string[] };
	runtimeProfile: string;
	policyPipeline: RuntimePolicyPipeline;
	model: Model<any> | undefined;
	customToolDefs: RuntimeToolDefinition[];
}): Promise<BuildSessionPromptResult> {
	const { config, opts, cwd, workspaceContext, modelLabel, exposedTools, preflight, runtimeProfile, policyPipeline, model, customToolDefs } = params;

	const runtimeCapabilities = Array.from(
		new Set(filterOpenClawCompatibilityToolNames([
			...(opts.capabilities ?? []),
			...preflight.enabledToolNames,
		])),
	);
	const runtimeParams = buildSystemPromptParams({
		model: modelLabel,
		defaultModel: `${config.defaultProvider}/${config.defaultModel}`,
		channel: opts.channel,
		capabilities: runtimeCapabilities,
		workspaceDir: cwd,
		cwd,
		userTimezone: config.agent.userTimezone,
		repoRoot: workspaceContext.repoRoot ?? config.agent.repoRoot,
	});

	const toolSummaries = buildToolSummaryMap(exposedTools);

	const contextFiles = loadContextFiles(cwd, config.agent.contextFiles);

	const skillsSnapshot = buildWorkspaceSkillSnapshot({
		workspaceDir: cwd,
		config,
	});

	const advertisedToolNames = Array.from(
		new Set(filterOpenClawCompatibilityToolNames(preflight.enabledToolNames)),
	);
	const modelFallbackSection = buildModelFallbackPromptContent(config.agent.modelFallbacks);
	const taughtDraftLedger = cwd
		? await loadPersistedTaughtTaskDraftLedger({ workspaceDir: cwd }).catch(() => undefined)
		: undefined;
	const taughtDraftPromptContent = buildTaughtTaskDraftPromptContent(taughtDraftLedger);
	const promptImageMode = resolvePromptImageSupportMode(model);
	const promptImageGuidance = buildPromptImageModeGuidance(promptImageMode);

	const baseSystemPromptOptions: SystemPromptOptions = {
		identity: config.agent.identity,
		toolNames: advertisedToolNames,
		toolSummaries,
		skills: skillsSnapshot.resolvedSkills,
		cwd,
		safetyInstructions: config.agent.safetyInstructions,
		promptMode: opts.promptMode ?? (config.agent.promptMode as PromptMode | undefined) ?? "full",
		runtimeInfo: runtimeParams.runtimeInfo,
		userTimezone: runtimeParams.userTimezone,
		userTime: runtimeParams.userTime,
		defaultThinkLevel: config.defaultThinkingLevel,
		ownerIds: config.agent.ownerIds,
		ownerDisplay: config.agent.ownerDisplay,
		ownerDisplaySecret: config.agent.ownerDisplaySecret,
		contextFiles,
		memoryCitationsMode: config.agent.memoryCitationsMode,
		heartbeatPrompt: config.agent.heartbeatPrompt,
		ttsHint: config.agent.ttsHint,
		docsUrl: config.agent.docsUrl,
		modelAliasLines: config.agent.modelAliasLines,
		extraSystemPrompt: opts.extraSystemPrompt,
		reactionGuidance: opts.reactionGuidance,
		reasoningTagHint: opts.reasoningTagHint,
		reasoningLevel: opts.reasoningLevel,
		sandboxInfo: opts.sandboxInfo,
		extraSections: [
			{
				title: "Runtime Profile",
				content: `profile=${runtimeProfile}`,
			},
			...(modelFallbackSection
				? [
					{
						title: "Model Fallback",
						content: modelFallbackSection,
					},
				]
				: []),
				...(promptImageGuidance
					? [
						{
							title: "Image Input Mode",
							content: promptImageGuidance,
						},
					]
					: []),
				...(taughtDraftPromptContent
					? [
						{
							title: "Teach Drafts",
							content: taughtDraftPromptContent,
						},
					]
					: []),
			],
		};
	const promptBuild = await policyPipeline.runBeforePromptBuild({
		options: baseSystemPromptOptions,
	});
	const systemPrompt = buildUnderstudySystemPrompt(promptBuild.options);
	const visibleToolNames = customToolDefs.map((toolDef) => toolDef.name);
	const visibleToolDefinitions = customToolDefs.filter(
		(toolDef) => !isHiddenCompatibilityToolDefinition(toolDef.name, visibleToolNames),
	);
	const promptReport = buildUnderstudyPromptReport({
		workspaceDir: cwd,
		systemPrompt,
		contextFiles,
		skills: skillsSnapshot.resolvedSkills,
		toolNames: advertisedToolNames,
		toolSummaries,
		toolDefinitions: visibleToolDefinitions,
	});

	return {
		systemPrompt,
		promptReport,
		advertisedToolNames,
		runtimeParams,
		contextFiles,
		skillsSnapshot,
	};
}
