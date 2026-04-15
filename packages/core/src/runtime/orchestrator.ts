/**
 * Understudy runtime orchestrator.
 * Central place to build tools + prompt and start a runtime adapter session.
 */

import { type Model, type ThinkingLevel } from "@mariozechner/pi-ai";
import type { AgentMessage, AgentTool } from "@mariozechner/pi-agent-core";
import type { ToolEntry, UnderstudyConfig } from "@understudy/types";
import { ConfigManager } from "../config.js";
import { ToolRegistry } from "../tool-registry.js";
import { TrustEngine } from "../trust-engine.js";
import type { PromptMode, SystemPromptOptions } from "../system-prompt.js";
import {
	type UnderstudyPromptReport,
	type UnderstudySessionMeta,
} from "../prompt-report.js";
import {
	createOpenClawCompatibilityToolAliases,
	filterOpenClawCompatibilityToolNames,
} from "../openclaw-compat.js";
import { createLogger } from "../logger.js";
import type {
	RuntimeAdapter,
	RuntimeCreateSessionResult,
	RuntimeSessionManager,
	RuntimeToolDefinition,
} from "./types.js";
import {
	type RuntimeProfile,
} from "./identity-policy.js";
import { applySystemPromptOverrideToSession } from "./system-prompt-override.js";
import { runRuntimePreflight } from "./preflight.js";
import {
	wrapToolsWithWatchdog,
} from "./tool-watchdog.js";
import {
	installToolResultContextGuard,
	recoverContextAfterOverflowInPlace,
} from "./tool-result-context-guard.js";
import {
	RuntimePolicyPipeline,
	wrapToolsWithPolicyPipeline,
	type RuntimePolicy,
} from "./policy-pipeline.js";
import {
	wrapToolsWithExecutionTrace,
	type UnderstudySessionToolEvent,
} from "./tool-execution-trace.js";
import {
	createDefaultRuntimePolicyRegistry,
	type RuntimePolicyRegistry,
} from "./policy-registry.js";
import { ensureRuntimeEngineAgentDirEnv, resolveUnderstudyAgentDir } from "../runtime-paths.js";
import { createSandboxBashSpawnHook } from "./sandbox-bash-hook.js";
import {
	resolveRuntimeModelCandidates,
	type RuntimeResolvedModelCandidate,
} from "./bridge/model-resolution-bridge.js";
import { prepareRuntimeAuthContext } from "../auth.js";
import { resolveWorkspaceContext } from "../workspace-context.js";
import { getModel } from "@mariozechner/pi-ai";
import {
	preparePromptImageSupport,
} from "./prompt-image-support.js";
import {
	mergeAgentMessage,
	agentToolToDefinition,
	describeUnknownError,
	isContextWindowOverflowError,
	isRetryablePromptDispatchError,
	promptRetryBackoffMs,
	runLifecycleHook,
	createRuntimeSessionWithModelFallback,
} from "./orchestrator-helpers.js";
import { buildSessionPrompt } from "./orchestrator-prompt.js";

export interface UnderstudySessionPromptBuiltEvent {
	config: UnderstudyConfig;
	systemPrompt: string;
	promptReport: UnderstudyPromptReport;
	sessionMeta: UnderstudySessionMeta;
}

export interface UnderstudySessionCreatedEvent extends UnderstudySessionPromptBuiltEvent {
	session: RuntimeCreateSessionResult["session"];
	runtimeSession: RuntimeCreateSessionResult["runtimeSession"];
	extensionsResult?: unknown;
}

export interface UnderstudySessionAssistantReplyEvent {
	message: AgentMessage;
	sessionMeta: UnderstudySessionMeta;
}

export interface UnderstudySessionClosedEvent {
	sessionMeta: UnderstudySessionMeta;
}

export interface UnderstudySessionLifecycleHooks {
	onPromptBuilt?(
		event: UnderstudySessionPromptBuiltEvent,
	): Promise<void> | void;
	onSessionCreated?(
		event: UnderstudySessionCreatedEvent,
	): Promise<void> | void;
	onAssistantReply?(
		event: UnderstudySessionAssistantReplyEvent,
	): Promise<void> | void;
	onToolEvent?(
		event: UnderstudySessionToolEvent,
	): Promise<void> | void;
	onSessionClosed?(
		event: UnderstudySessionClosedEvent,
	): Promise<void> | void;
}

export interface UnderstudySessionOptions {
	/** Path to config file */
	configPath?: string;
	/** In-memory config (overrides configPath) */
	config?: Partial<UnderstudyConfig>;
	/** Working directory */
	cwd?: string;
	/** Explicit model to use */
	model?: Model<any>;
	/** Thinking level */
	thinkingLevel?: ThinkingLevel;
	/** Additional custom tools (AgentTool format) */
	extraTools?: AgentTool<any>[];
	/** Optional allowlist of tool names exposed to the runtime session */
	allowedToolNames?: string[];
	/** Custom approval handler */
	onApprovalRequired?: (toolName: string, params?: unknown) => Promise<boolean>;
	/** Disable specific tool categories */
	disableCategories?: string[];
	/** Explicit session manager for resume/branch control */
	sessionManager?: RuntimeSessionManager;
	/** Runtime storage directory for auth/settings/models/sessions */
	agentDir?: string;
	/** Channel name for runtime info (e.g., "web", "telegram") */
	channel?: string;
	/** Channel capabilities for runtime info */
	capabilities?: string[];
	/** System prompt mode override */
	promptMode?: PromptMode;
	/** Extra system prompt context appended after the base sections */
	extraSystemPrompt?: string;
	/** Optional reaction guidance for the current runtime/channel */
	reactionGuidance?: SystemPromptOptions["reactionGuidance"];
	/** Whether to include reasoning format guidance */
	reasoningTagHint?: boolean;
	/** Reasoning behavior hint shown in the prompt */
	reasoningLevel?: string;
	/** Optional sandbox runtime info exposed in the prompt */
	sandboxInfo?: SystemPromptOptions["sandboxInfo"];
	/** Runtime behavior profile */
	runtimeProfile?: RuntimeProfile;
	/** Runtime backend hint (resolved by createUnderstudySession entrypoint). */
	runtimeBackend?: "embedded" | "acp";
	/** Additional runtime policies appended after the built-in defaults */
	runtimePolicies?: RuntimePolicy[];
	/** Runtime policy registry override (used for custom module registration/testing) */
	runtimePolicyRegistry?: RuntimePolicyRegistry;
	/** Optional lifecycle hooks for prompt/session/reply/close events */
	lifecycleHooks?: UnderstudySessionLifecycleHooks;
}

export interface UnderstudySessionResult extends RuntimeCreateSessionResult {
	config: UnderstudyConfig;
	toolRegistry: ToolRegistry;
	sessionMeta: UnderstudySessionMeta;
}

const logger = createLogger("UnderstudySession");

export async function createUnderstudySessionWithRuntime(
	adapter: RuntimeAdapter,
	opts: UnderstudySessionOptions = {},
): Promise<UnderstudySessionResult> {
	// Load config
	const configManager = opts.config
		? ConfigManager.inMemory(opts.config)
		: await ConfigManager.load(opts.configPath);
	const config = configManager.get();

	const workspaceContext = resolveWorkspaceContext({
		requestedWorkspaceDir: opts.cwd,
		configuredRepoRoot: config.agent.repoRoot,
		fallbackWorkspaceDir: process.cwd(),
	});
	const cwd = workspaceContext.workspaceDir;
	const agentDir = ensureRuntimeEngineAgentDirEnv(resolveUnderstudyAgentDir(opts.agentDir));
	const runtimeProfile = opts.runtimeProfile ?? config.agent.runtimeProfile ?? "assistant";
	const authContext = prepareRuntimeAuthContext({ agentDir });
	const modelCandidates = resolveRuntimeModelCandidates({
		explicitModel: opts.model,
		defaultProvider: config.defaultProvider,
		defaultModel: config.defaultModel,
		modelFallbacks: config.agent.modelFallbacks,
		resolveModel: (provider, modelId) =>
			authContext.modelRegistry.find(provider, modelId) ??
			getModel(provider as any, modelId as any),
	});
	const resolvedModel = opts.model
		? {
			model: modelCandidates.candidates[0]?.model ?? opts.model,
			modelLabel: modelCandidates.modelLabelFallback,
			source: "explicit" as const,
			attempts: modelCandidates.attempts,
		}
		: modelCandidates.candidates[0]
			? {
				model: modelCandidates.candidates[0].model,
				modelLabel: modelCandidates.candidates[0].modelLabel,
				source: modelCandidates.candidates[0].source,
				attempts: modelCandidates.attempts,
			}
			: {
				model: undefined,
				modelLabel: modelCandidates.modelLabelFallback,
				source: "default_label_only" as const,
				attempts: modelCandidates.attempts,
			};
	let model = resolvedModel.model;
	let modelLabel = resolvedModel.modelLabel;
	if (!model && resolvedModel.source !== "explicit") {
		logger.warn("Could not resolve configured model chain, will let createAgentSession handle it", {
			attempts: resolvedModel.attempts,
		});
	}

		// Set up the registry with builtin tools plus any runtime-specific extras.
		const toolRegistry = new ToolRegistry();
	toolRegistry.registerBuiltins(cwd, {
		bashSpawnHook: createSandboxBashSpawnHook(config, logger),
	});

	// Register extra AgentTools (if any)
	if (opts.extraTools) {
		for (const tool of opts.extraTools) {
			toolRegistry.register(tool);
		}
	}
	for (const tool of createOpenClawCompatibilityToolAliases(toolRegistry.getTools())) {
		toolRegistry.register(tool);
	}

	const allowedToolNameSet = new Set(
		(opts.allowedToolNames ?? [])
			.map((value) => value.trim())
			.filter(Boolean),
	);
	const filterAllowedToolEntries = (entries: ToolEntry[]): ToolEntry[] =>
		allowedToolNameSet.size > 0
			? entries.filter((entry) => allowedToolNameSet.has(entry.tool.name))
			: entries;

	// Set up trust engine
	const trustEngine = new TrustEngine({
		policies: config.tools.policies,
		autoApproveReadOnly: config.tools.autoApproveReadOnly,
		onApprovalRequired: opts.onApprovalRequired,
	});

	// Wrap all registered tools with trust gating.
	const trustedTools = trustEngine.wrapTools(filterAllowedToolEntries(toolRegistry.getEntries()));
	const preflight = runRuntimePreflight({
		profile: runtimeProfile,
		toolNames: trustedTools.map((tool) => tool.name),
	});
	for (const warning of preflight.warnings) {
		logger.warn(warning);
	}

	// Runtime watchdog enforces timeouts and preflight tool availability.
	const guardedTools = wrapToolsWithWatchdog(trustedTools, {
		runtimeProfile,
		preflight,
	});

	const runtimePolicyContext = {
		runtimeProfile,
		modelLabel,
		cwd,
		config,
	};
	const runtimePolicyRegistry =
		opts.runtimePolicyRegistry ??
		createDefaultRuntimePolicyRegistry({
			onModuleMissing: (moduleName) => {
				logger.warn(`Runtime policy module not found: ${moduleName}`);
			},
		});
	const configuredPolicies = await runtimePolicyRegistry.build({
		context: runtimePolicyContext,
		config: config.agent.runtimePolicies,
	});

	const policyPipeline = new RuntimePolicyPipeline({
		context: runtimePolicyContext,
		policies: [
			...configuredPolicies.policies,
			...(opts.runtimePolicies ?? []),
		],
		onPolicyError: (policyName, phase, error) => {
			logger.warn(`Runtime policy "${policyName}" failed during ${phase}: ${String(error)}`);
		},
	});
	const policyWrappedTools = wrapToolsWithPolicyPipeline(guardedTools, policyPipeline);
	let sessionMetaRef: UnderstudySessionMeta | undefined;
	const traceWrappedTools = wrapToolsWithExecutionTrace(policyWrappedTools, {
		onEvent: async (event) => {
			await runLifecycleHook("onToolEvent", opts.lifecycleHooks?.onToolEvent, event);
		},
		getSessionMeta: () => sessionMetaRef,
	});
	const exposedTools = traceWrappedTools.filter((tool) => preflight.enabledToolNames.includes(tool.name));
	const customToolDefs: RuntimeToolDefinition[] = exposedTools.map(agentToolToDefinition);

	const resolvedThinkingLevel =
		opts.thinkingLevel ??
		(config.defaultThinkingLevel === "off"
			? undefined
			: (config.defaultThinkingLevel as ThinkingLevel));

	// Create session via runtime adapter, retrying through the configured model
	// fallback chain only for model/auth-class failures.
	const sessionCreation = await createRuntimeSessionWithModelFallback({
		adapter,
		cwd,
		agentDir,
		authContext,
		initialModel: model,
		initialModelLabel: modelLabel,
		candidates: modelCandidates.candidates,
		thinkingLevel: resolvedThinkingLevel,
		customTools: customToolDefs,
		sessionManager: opts.sessionManager,
		acpConfig: config.agent.acp,
		onModelLabelResolved: (nextLabel) => {
			runtimePolicyContext.modelLabel = nextLabel;
		},
		explicitModelRequested: Boolean(opts.model),
	});
	const sessionResult = sessionCreation.sessionResult;
	model = sessionCreation.model;
	modelLabel = sessionCreation.modelLabel;
	runtimePolicyContext.modelLabel = modelLabel;

	const { session, runtimeSession } = sessionResult;

	const promptResult = await buildSessionPrompt({
		config,
		opts,
		cwd,
		workspaceContext,
		modelLabel,
		exposedTools,
		preflight,
		runtimeProfile,
		policyPipeline,
		model,
		customToolDefs,
	});
	const { systemPrompt, promptReport, advertisedToolNames, runtimeParams } = promptResult;

	const sessionMeta: UnderstudySessionMeta = {
		backend: adapter.name,
		model: modelLabel || "auto",
		runtimeProfile,
		workspaceDir: cwd,
		toolNames: advertisedToolNames,
		promptReport,
		auth: authContext.report,
	};
	sessionMetaRef = sessionMeta;
	const promptBuiltEvent: UnderstudySessionPromptBuiltEvent = {
		config,
		systemPrompt,
		promptReport,
		sessionMeta,
	};
	await runLifecycleHook(
		"onPromptBuilt",
		opts.lifecycleHooks?.onPromptBuilt,
		promptBuiltEvent,
	);

	// Apply prompt override so session prompt rebuilds keep the Understudy system prompt.
	applySystemPromptOverrideToSession(session as any, systemPrompt);

	// Guard oversized tool results so context windows stay stable across long turns.
	const contextWindowTokens =
		typeof model?.contextWindow === "number" && model.contextWindow > 0
			? model.contextWindow
			: 128_000;
	installToolResultContextGuard({
		agent: session.agent as any,
		contextWindowTokens,
	});

	// Runtime policy pipeline: prompt rewriting and reply hooks.
	const originalPrompt = session.prompt.bind(session);
	(session as unknown as { prompt: (text: string, options?: unknown) => Promise<void> }).prompt = async (
		text: string,
		options?: unknown,
	) => {
		const transformed = await policyPipeline.runBeforePrompt({
			text,
			options,
		});
		const promptImageSupport = await preparePromptImageSupport({
			text: transformed.text,
			options: transformed.options,
			cwd,
			model,
		});
		let recoveredOverflow = false;
		for (let attempt = 1; attempt <= 3; attempt += 1) {
			const messageCountBeforePrompt = session.agent.state.messages.length;
			try {
				return await originalPrompt(promptImageSupport.text, promptImageSupport.options as any);
			} catch (error) {
				if (!recoveredOverflow && isContextWindowOverflowError(error)) {
					const recovery = recoverContextAfterOverflowInPlace({
						messages: session.agent.state.messages,
						contextWindowTokens,
					});
					if (!recovery.changed) {
						throw error;
					}
					recoveredOverflow = true;
					logger.warn(
						`Prompt hit a context overflow. Recovered context to ~${recovery.estimatedChars} chars and retrying once.`,
					);
					continue;
				}

				const messageCountAfterError = session.agent.state.messages.length;
				const safeToRetry = messageCountAfterError === messageCountBeforePrompt;
				if (attempt >= 3 || !safeToRetry || !isRetryablePromptDispatchError(error)) {
					throw error;
				}

				const backoffMs = promptRetryBackoffMs(attempt);
				logger.warn(
					`Prompt dispatch failed with a transient model error: ${describeUnknownError(error)}. ` +
					`Retrying in ${backoffMs}ms (attempt ${attempt + 1}/3).`,
				);
				await new Promise((resolve) => setTimeout(resolve, backoffMs));
			}
		}
	};
	(runtimeSession as unknown as { prompt: (text: string, options?: unknown) => Promise<void> }).prompt =
		(session as unknown as { prompt: (text: string, options?: unknown) => Promise<void> }).prompt;

	runtimeSession.onEvent((event) => {
		if ((event as { type?: string }).type !== "message_end") return;
		const message = (event as { message?: any }).message;
		if (!message || message.role !== "assistant") return;
		void (async () => {
				let workingMessage = message;
				const beforeReply = await policyPipeline.runBeforeReply({ message: workingMessage });
				if (beforeReply.message && beforeReply.message !== workingMessage) {
					workingMessage = mergeAgentMessage(workingMessage, beforeReply.message);
				}
				const afterReply = await policyPipeline.runAfterReply({
					message: workingMessage,
				});
				if (afterReply.message && afterReply.message !== workingMessage) {
					workingMessage = mergeAgentMessage(workingMessage, afterReply.message);
				}
			await runLifecycleHook("onAssistantReply", opts.lifecycleHooks?.onAssistantReply, {
				message: workingMessage,
				sessionMeta,
			});
		})().catch((error) => {
			logger.warn(`Runtime policy reply hooks failed: ${String(error)}`);
		});
	});

	let sessionClosed = false;
	const emitSessionClosed = async () => {
		if (sessionClosed) {
			return;
		}
		sessionClosed = true;
		await runLifecycleHook("onSessionClosed", opts.lifecycleHooks?.onSessionClosed, {
			sessionMeta,
		});
	};
	const runtimeSessionClose = runtimeSession.close.bind(runtimeSession);
	(runtimeSession as { close: () => Promise<void> | void }).close = async () => {
		try {
			return await runtimeSessionClose();
		} finally {
			await emitSessionClosed();
		}
	};
	const sessionWithDispose = session as { dispose?: () => Promise<void> | void };
	if (typeof sessionWithDispose.dispose === "function") {
		const originalDispose = sessionWithDispose.dispose.bind(sessionWithDispose);
		sessionWithDispose.dispose = async () => {
			try {
				return await originalDispose();
			} finally {
				await emitSessionClosed();
			}
		};
	}

	const mergedExtensions =
		sessionResult.extensionsResult && typeof sessionResult.extensionsResult === "object"
			? { ...(sessionResult.extensionsResult as Record<string, unknown>) }
			: {};

	logger.debug("Understudy session created", {
		backend: adapter.name,
		model: modelLabel || "auto",
		tools: advertisedToolNames,
		policies: policyPipeline.getPolicyNames(),
		policyModules: configuredPolicies.modules,
		runtime: `${runtimeParams.runtimeInfo.os} (${runtimeParams.runtimeInfo.arch})`,
		timezone: runtimeParams.userTimezone,
	});
	if (sessionCreation.fallbackUsed) {
		logger.info("Runtime session created via fallback candidate", {
			model: modelLabel,
			defaultModel: `${config.defaultProvider}/${config.defaultModel}`,
		});
	}

	await runLifecycleHook("onSessionCreated", opts.lifecycleHooks?.onSessionCreated, {
		...promptBuiltEvent,
		session,
		runtimeSession,
		extensionsResult: mergedExtensions,
	});

	return {
		...sessionResult,
		extensionsResult: mergedExtensions,
		config,
		toolRegistry,
		sessionMeta,
	};
}
