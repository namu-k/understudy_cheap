import {
	loadPersistedWorkflowCrystallizationLedger,
	normalizeAssistantDisplayText,
	publishWorkflowCrystallizedSkill,
	replaceWorkflowCrystallizationClusters,
	replaceWorkflowCrystallizationDayEpisodes,
	replaceWorkflowCrystallizationDaySegments,
	replaceWorkflowCrystallizationSkills,
	updatePersistedWorkflowCrystallizationLedger,
	withTimeout,
	type TaughtTaskDraftParameter,
	type WorkflowCrystallizationCluster,
	type WorkflowCrystallizationCompletion,
	type WorkflowCrystallizationEpisode,
	type WorkflowCrystallizationLedger,
	type WorkflowCrystallizationRouteOption,
	type WorkflowCrystallizationSegment,
	type WorkflowCrystallizationSkill,
	type WorkflowCrystallizationSkillStage,
	type WorkflowCrystallizationStatusCounts,
	type WorkflowCrystallizationToolStep,
	type WorkflowCrystallizationTurn,
} from "@understudy/core";
import { extractJsonObject } from "@understudy/tools";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { SessionEntry } from "./session-types.js";
import type { WorkflowCrystallizationRuntimeOptions } from "./session-types.js";
import {
	normalizeTeachExecutionRoute,
	trimToUndefined,
	uniqueStrings,
} from "./teach-normalization.js";
import {
	asNumber,
	asRecord,
	asString,
	normalizeComparableText,
} from "./value-coerce.js";
import { asStringList } from "./teach-normalization.js";

export interface WorkflowCrystallizationDeps {
	createScopedSession: (context: import("./session-types.js").SessionCreateContext) => Promise<SessionEntry>;
	promptSession: (
		entry: SessionEntry,
		text: string,
		runId?: string,
		promptOptions?: Record<string, unknown>,
	) => Promise<{ response: string; runId: string; images?: unknown[]; meta?: Record<string, unknown> }>;
	abortSessionEntry: (entry: SessionEntry) => Promise<boolean>;
	runSerializedSessionTurn: <T>(entry: SessionEntry, task: () => Promise<T>) => Promise<T>;
	notifyUser?: (params: {
		entry: SessionEntry;
		text: string;
		title?: string;
		source: "workflow_crystallization";
		details?: Record<string, unknown>;
	}) => Promise<void>;
	runtimeLearningDir: string;
	workflowCrystallizationOptions: WorkflowCrystallizationRuntimeOptions;
	refreshPublishedSkillPrompts: (
		entry: SessionEntry,
		published: {
			draft: { objective?: string };
			skill: { name?: string; skillPath?: string };
		},
	) => Promise<string | undefined>;
}

export function createWorkflowCrystallizationPipeline(deps: WorkflowCrystallizationDeps) {
	const {
		createScopedSession,
		promptSession,
		abortSessionEntry,
		runSerializedSessionTurn,
		notifyUser,
		runtimeLearningDir,
		workflowCrystallizationOptions = {},
		refreshPublishedSkillPrompts,
	} = deps;

	const activeAnalyses = new Map<string, Promise<void>>();
	const pendingAnalyses = new Set<string>();
	const workflowLedgerMutationChains = new Map<string, Promise<unknown>>();

	const runSerializedWorkflowLedgerMutation = <T>(workspaceDir: string, task: () => Promise<T>): Promise<T> => {
		const workspaceKey = resolve(workspaceDir);
		const previous = workflowLedgerMutationChains.get(workspaceKey) ?? Promise.resolve();
		const queued = previous.catch(() => {}).then(task);
		let trackedPromise: Promise<unknown>;
		const cleanupPromise = queued.finally(() => {
			if (workflowLedgerMutationChains.get(workspaceKey) === trackedPromise) {
				workflowLedgerMutationChains.delete(workspaceKey);
			}
		});
		trackedPromise = cleanupPromise.catch(() => {});
		workflowLedgerMutationChains.set(workspaceKey, trackedPromise);
		return queued;
	};

	const WORKFLOW_CRYSTALLIZATION_TIMEOUT_MS = 90_000;
	const MIN_TURNS_FOR_WORKFLOW_SEGMENTATION = Math.max(1, Math.floor(workflowCrystallizationOptions.minTurnsForSegmentation ?? 2));
	const WORKFLOW_SEGMENTATION_REANALYZE_DELTA = Math.max(1, Math.floor(workflowCrystallizationOptions.segmentationReanalyzeDelta ?? 3));
	const MIN_EPISODES_FOR_WORKFLOW_CLUSTERING = Math.max(1, Math.floor(workflowCrystallizationOptions.minEpisodesForClustering ?? 2));
	const MIN_CLUSTER_OCCURRENCES_FOR_PROMOTION = Math.max(1, Math.floor(workflowCrystallizationOptions.minClusterOccurrencesForPromotion ?? 3));
	const MAX_CLUSTERING_EPISODES = Math.max(1, Math.floor(workflowCrystallizationOptions.maxClusteringEpisodes ?? 80));
	const MAX_PROMOTED_WORKFLOW_CANDIDATES = Math.max(1, Math.floor(workflowCrystallizationOptions.maxPromotedWorkflowCandidates ?? 5));
	const MAX_SYNTHESIS_EPISODE_EXAMPLES = Math.max(1, Math.floor(workflowCrystallizationOptions.maxSynthesisEpisodeExamples ?? 6));

	const createWorkflowCrystallizationInternalSession = async (
		entry: SessionEntry,
		purpose: "segment" | "summarize" | "cluster" | "synthesize",
	): Promise<SessionEntry | undefined> => {
		try {
			return await createScopedSession({
				sessionKey: `${entry.id}::workflow-${purpose}::${randomUUID()}`,
				parentId: entry.id,
				channelId: entry.channelId,
				senderId: entry.senderId,
				senderName: entry.senderName,
				conversationName: entry.conversationName,
				conversationType: entry.conversationType,
				threadId: entry.threadId,
				workspaceDir: entry.workspaceDir,
				explicitWorkspace: true,
				configOverride: entry.configOverride,
				sandboxInfo: entry.sandboxInfo,
				executionScopeKey: entry.executionScopeKey,
				allowedToolNames: [],
				extraSystemPrompt: "This is an internal workflow crystallization analysis session. Never call tools. Return only the requested JSON payload.",
			});
		} catch {
			return undefined;
		}
	};

	const runWorkflowCrystallizationPrompt = async (params: {
		entry: SessionEntry;
		purpose: "segment" | "summarize" | "cluster" | "synthesize";
		prompt: string;
		timeoutMs?: number;
	}): Promise<string> => {
		const internalEntry = await createWorkflowCrystallizationInternalSession(params.entry, params.purpose);
		if (!internalEntry) {
			throw new Error("Could not create an isolated workflow crystallization session.");
		}
		try {
			const result = await withTimeout(
				runSerializedSessionTurn(
					internalEntry,
					async () => await promptSession(internalEntry, params.prompt),
				),
				params.timeoutMs ?? WORKFLOW_CRYSTALLIZATION_TIMEOUT_MS,
			);
			return normalizeAssistantDisplayText(result.response ?? "").text;
		} finally {
			if (internalEntry !== params.entry) {
				await abortSessionEntry(internalEntry).catch(() => false);
			}
		}
	};

	const buildWorkflowDialogueTurnPreview = (turn: WorkflowCrystallizationTurn, index: number): string => [
		`${index}. [${new Date(turn.timestamp).toISOString()}] session=${turn.sessionId ?? "unknown"} run=${turn.runId}`,
		`   user: ${turn.userText || "--"}`,
		`   assistant: ${turn.assistantText || "--"}`,
	].join("\n");

	const buildWorkflowExecutionTurnPreview = (turn: WorkflowCrystallizationTurn): string => [
		`   user: ${turn.userText || "--"}`,
		`   assistant: ${turn.assistantText || "--"}`,
		...(turn.evidence.parameterHints.length > 0 ? [`   parameters: ${turn.evidence.parameterHints.join(", ")}`] : []),
		...(turn.evidence.successSignals.length > 0 ? [`   outcome_signals: ${turn.evidence.successSignals.join(" | ")}`] : []),
		...(turn.evidence.uncertainties.length > 0 ? [`   open_issues: ${turn.evidence.uncertainties.join(" | ")}`] : []),
		...(turn.evidence.routeSignature ? [`   route_signature: ${turn.evidence.routeSignature}`] : []),
		...(turn.evidence.toolChain.length > 0
			? [
				"   tool_chain:",
				...turn.evidence.toolChain.slice(0, 6).map((step: WorkflowCrystallizationToolStep) =>
					`     - [${step.route}/${step.toolName}] ${step.instruction}${step.verificationSummary ? ` | verify: ${step.verificationSummary}` : ""}`),
			]
			: []),
	].join("\n");

	const normalizeWorkflowEpisodeCompletion = (value: unknown): WorkflowCrystallizationCompletion => {
		switch (trimToUndefined(asString(value))?.toLowerCase()) {
			case "failed":
				return "failed";
			case "partial":
				return "partial";
			default:
				return "complete";
		}
	};

	const buildEmptyWorkflowStatusCounts = (): WorkflowCrystallizationStatusCounts => ({
		completeCount: 0,
		partialCount: 0,
		failedCount: 0,
	});

	const countWorkflowEpisodeStatuses = (
		episodes: Array<Pick<WorkflowCrystallizationEpisode, "completion">>,
	): WorkflowCrystallizationStatusCounts => {
		const counts = buildEmptyWorkflowStatusCounts();
		for (const episode of episodes) {
			switch (episode.completion) {
				case "failed":
					counts.failedCount += 1;
					break;
				case "partial":
					counts.partialCount += 1;
					break;
				default:
					counts.completeCount += 1;
					break;
			}
		}
		return counts;
	};

	const buildWorkflowSegmentId = (workspaceDir: string, dayStamp: string, startTurnIndex: number, endTurnIndex: number): string =>
		createHash("sha1")
			.update(resolve(workspaceDir))
			.update(dayStamp)
			.update(String(startTurnIndex))
			.update(String(endTurnIndex))
			.digest("hex")
			.slice(0, 12);

	const buildWorkflowSegmentationPrompt = (params: {
		workspaceDir: string;
		dayStamp: string;
		turns: WorkflowCrystallizationTurn[];
	}): string => [
		"You are segmenting compressed Understudy workspace session dialogue into complete work segments.",
		"Use only the ordered user/assistant dialogue timeline below.",
		"Do not rely on tool chains, hidden state, or chain-of-thought.",
		"A complete work segment may span multiple consecutive turns and should represent one real-world job from request through meaningful completion.",
		"Ignore pure chit-chat, tiny acknowledgements, or fragments that do not belong to a larger work segment.",
		"Prefer fewer, larger segments when adjacent turns obviously belong to the same job.",
		"Mark completion=complete only when the segment appears to reach an externally meaningful outcome.",
		"Use completion=partial when the work clearly started but did not finish.",
		"Use completion=failed when the segment appears to conclude unsuccessfully or hits a clear dead end.",
		`Workspace: ${params.workspaceDir}`,
		`Day: ${params.dayStamp}`,
		"Dialogue timeline:",
		...params.turns.map((turn, index) => buildWorkflowDialogueTurnPreview(turn, index + 1)),
		"Return strict JSON only.",
		'Schema: {"segments":[{"startTurnIndex":1,"endTurnIndex":3,"completion":"complete|partial|failed"}]}',
	].join("\n");

	const normalizeWorkflowSegments = (params: {
		payload: Record<string, unknown>;
		dayStamp: string;
		turns: WorkflowCrystallizationTurn[];
		workspaceDir: string;
	}): WorkflowCrystallizationSegment[] => {
		const raw = Array.isArray(params.payload.segments) ? params.payload.segments : [];
		const segments: WorkflowCrystallizationSegment[] = [];
		for (const entry of raw) {
			const record = asRecord(entry);
			if (!record) {
				continue;
			}
			const startTurnIndex = Math.max(1, Math.floor(asNumber(record.startTurnIndex) ?? 0));
			const endTurnIndex = Math.min(params.turns.length, Math.floor(asNumber(record.endTurnIndex) ?? 0));
			if (endTurnIndex < startTurnIndex || startTurnIndex > params.turns.length) {
				continue;
			}
			const slice = params.turns.slice(startTurnIndex - 1, endTurnIndex);
			if (slice.length === 0) {
				continue;
			}
			segments.push({
				id: buildWorkflowSegmentId(params.workspaceDir, params.dayStamp, startTurnIndex, endTurnIndex),
				dayStamp: params.dayStamp,
				startTurnIndex,
				endTurnIndex,
				turnIds: slice.map((turn) => turn.id),
				startedAt: slice[0]?.timestamp ?? Date.now(),
				endedAt: slice[slice.length - 1]?.timestamp ?? Date.now(),
				completion: normalizeWorkflowEpisodeCompletion(record.completion),
			});
		}
		return segments
			.sort((left, right) => left.startTurnIndex - right.startTurnIndex || left.endTurnIndex - right.endTurnIndex)
			.filter((segment, index, list) => index === 0 || segment.startTurnIndex > list[index - 1]!.endTurnIndex);
	};

	const buildWorkflowEpisodeSummaryPrompt = (params: {
		workspaceDir: string;
		dayStamp: string;
		turns: WorkflowCrystallizationTurn[];
		segments: WorkflowCrystallizationSegment[];
	}): string => [
		"You are summarizing segmented Understudy workspace dialogue into reusable work episodes.",
		"The segment boundaries are already decided. For each segment, infer the real job, summarize the outcome, and extract stable reusable signals.",
		"Use the dialogue and compact execution evidence below. Ignore chain-of-thought and verbose intermediate outputs.",
		"Focus first on the underlying user need or work goal, even if the run completed only partially or failed.",
		"Provide workflowFamilyHint as a short stable label for the recurring user demand this segment belongs to.",
		"Parameter hints should name variable inputs that recur across runs.",
		"Success criteria should describe externally meaningful completion signals.",
		"Uncertainties should capture remaining ambiguity or weak evidence.",
		"Triggers should be short request cues that indicate when the future task matches this episode type.",
		`Workspace: ${params.workspaceDir}`,
		`Day: ${params.dayStamp}`,
		"Segments:",
		...params.segments.map((segment, index) => {
			const slice = params.turns.slice(segment.startTurnIndex - 1, segment.endTurnIndex);
			return [
				`${index + 1}. segment_id=${segment.id} turns=${segment.startTurnIndex}-${segment.endTurnIndex} completion=${segment.completion}`,
				...slice.map((turn) => buildWorkflowExecutionTurnPreview(turn)),
			].join("\n");
		}),
		"Return strict JSON only.",
		'Schema: {"episodes":[{"segmentId":"...","title":"...","objective":"...","summary":"...","workflowFamilyHint":"...","parameterHints":["..."],"successCriteria":["..."],"uncertainties":["..."],"keyTools":["browser","shell"],"routeSignature":"browser -> shell","triggers":["..."],"completion":"complete|partial|failed"}]}',
	].join("\n");

	const normalizeWorkflowEpisodes = (params: {
		payload: Record<string, unknown>;
		segments: WorkflowCrystallizationSegment[];
		turns: WorkflowCrystallizationTurn[];
		workspaceDir: string;
	}): WorkflowCrystallizationEpisode[] => {
		const segmentById = new Map(params.segments.map((segment) => [segment.id, segment] as const));
		const raw = Array.isArray(params.payload.episodes) ? params.payload.episodes : [];
		const episodes: WorkflowCrystallizationEpisode[] = [];
		for (const entry of raw) {
			const record = asRecord(entry);
			if (!record) {
				continue;
			}
			const segmentId = trimToUndefined(asString(record.segmentId));
			const segment = segmentId ? segmentById.get(segmentId) : undefined;
			if (!segment) {
				continue;
			}
			const slice = params.turns.slice(segment.startTurnIndex - 1, segment.endTurnIndex);
			if (slice.length === 0) {
				continue;
			}
			const title = trimToUndefined(asString(record.title))
				?? trimToUndefined(asString(record.objective))
				?? slice[0]?.evidence.titleGuess
				?? `Workflow episode ${episodes.length + 1}`;
			const objective = trimToUndefined(asString(record.objective)) ?? title;
			const summary = trimToUndefined(asString(record.summary))
				?? `Compressed workflow episode from turn ${segment.startTurnIndex} to ${segment.endTurnIndex}.`;
			const workflowFamilyHint = trimToUndefined(asString(record.workflowFamilyHint))
				?? trimToUndefined(asString(record.objective))
				?? slice[0]?.evidence.objectiveGuess
				?? title;
			const parameterHints = uniqueStrings([
				...asStringList(record.parameterHints),
				...slice.flatMap((turn) => turn.evidence.parameterHints),
			]).slice(0, 12);
			const successSignals = uniqueStrings([
				...asStringList(record.successCriteria),
				...slice.flatMap((turn) => turn.evidence.successSignals),
			]).slice(0, 12);
			const uncertainties = uniqueStrings([
				...asStringList(record.uncertainties),
				...slice.flatMap((turn) => turn.evidence.uncertainties),
			]).slice(0, 12);
			const keyTools = uniqueStrings([
				...asStringList(record.keyTools),
				...slice.flatMap((turn) => turn.evidence.toolChain.map((step) => step.toolName)),
			]).slice(0, 12);
			const routeSignature = trimToUndefined(asString(record.routeSignature))
				?? uniqueStrings(slice.map((turn) => turn.evidence.routeSignature ?? "")).join(" || ");
			const triggers = uniqueStrings([
				...asStringList(record.triggers),
				...slice.map((turn) => turn.userText).filter(Boolean),
			]).slice(0, 6);
			const id = createHash("sha1")
				.update(segment.id)
				.update(normalizeComparableText(title))
				.update(normalizeComparableText(objective))
				.digest("hex")
				.slice(0, 12);
			episodes.push({
				id,
				segmentId: segment.id,
				dayStamp: segment.dayStamp,
				startTurnIndex: segment.startTurnIndex,
				endTurnIndex: segment.endTurnIndex,
				turnIds: segment.turnIds,
				startedAt: segment.startedAt,
				endedAt: segment.endedAt,
				title,
				objective,
				summary,
				...(workflowFamilyHint ? { workflowFamilyHint } : {}),
				parameterHints,
				successSignals,
				uncertainties,
				keyTools,
				routeSignature,
				triggers,
				completion: normalizeWorkflowEpisodeCompletion(record.completion ?? segment.completion),
			});
		}
		return episodes.sort((left, right) => left.startTurnIndex - right.startTurnIndex || left.endTurnIndex - right.endTurnIndex);
	};

	const buildWorkflowClusterId = (
		title: string,
		objective: string,
		parameterSchema: string[],
		workflowFamilyHint?: string,
	): string =>
		createHash("sha1")
			.update(normalizeComparableText(title))
			.update(normalizeComparableText(objective))
			.update(normalizeComparableText(workflowFamilyHint ?? ""))
			.update(parameterSchema.map((value) => normalizeComparableText(value)).sort().join("|"))
			.digest("hex")
			.slice(0, 12);

	const buildWorkflowClusterPrompt = (params: {
		episodes: WorkflowCrystallizationEpisode[];
	}): string => [
		"You are clustering recurring workflow families inferred from compressed Understudy session history.",
		"Group episodes when they represent the same underlying user need or work objective despite different wording, parameters, or run status.",
		"Use user request cues and intended work goal first, then outcome, then stable execution evidence.",
		"Do not split the same workflow family only because one run was complete while another was partial or failed.",
		"Do not cluster generic chit-chat, one-off debugging, or unrelated work together.",
		"Only return clusters that contain at least 2 episode ids.",
		"Episode catalog:",
		...params.episodes.map((episode) => [
			`- ${episode.id}`,
			`  title=${episode.title}`,
			`  objective=${episode.objective}`,
			`  workflow_family_hint=${episode.workflowFamilyHint || "--"}`,
			`  summary=${episode.summary}`,
			`  triggers=${episode.triggers.join(" | ") || "--"}`,
			`  parameters=${episode.parameterHints.join(", ") || "--"}`,
			`  success=${episode.successSignals.join(" | ") || "--"}`,
			`  key_tools=${episode.keyTools.join(", ") || "--"}`,
			`  route_signature=${episode.routeSignature || "--"}`,
			`  completion=${episode.completion}`,
		].join("\n")),
		"Return strict JSON only.",
		'Schema: {"clusters":[{"episodeIds":["ep1","ep2"],"title":"...","objective":"...","summary":"...","workflowFamilyHint":"...","parameterSchema":["..."]}]}',
	].join("\n");

	const normalizeWorkflowClusters = (params: {
		payload: Record<string, unknown>;
		episodes: WorkflowCrystallizationEpisode[];
	}): WorkflowCrystallizationCluster[] => {
		const episodeById = new Map(params.episodes.map((episode) => [episode.id, episode] as const));
		const raw = Array.isArray(params.payload.clusters) ? params.payload.clusters : [];
		const clusters: WorkflowCrystallizationCluster[] = [];
		for (const entry of raw) {
			const record = asRecord(entry);
			if (!record) {
				continue;
			}
			const episodeIds = uniqueStrings(asStringList(record.episodeIds)).filter((id) => episodeById.has(id));
			if (episodeIds.length < 2) {
				continue;
			}
			const members = episodeIds
				.map((id) => episodeById.get(id))
				.filter((episode): episode is WorkflowCrystallizationEpisode => Boolean(episode));
			if (members.length < 2) {
				continue;
			}
			const title = trimToUndefined(asString(record.title))
				?? members[0]?.title
				?? `Workflow cluster ${clusters.length + 1}`;
			const objective = trimToUndefined(asString(record.objective))
				?? members[0]?.objective
				?? title;
			const summary = trimToUndefined(asString(record.summary));
			const workflowFamilyHint = trimToUndefined(asString(record.workflowFamilyHint))
				?? members[0]?.workflowFamilyHint
				?? objective;
			const parameterSchema = uniqueStrings([
				...asStringList(record.parameterSchema),
				...members.flatMap((episode) => episode.parameterHints),
			]).slice(0, 12);
			const statusCounts = countWorkflowEpisodeStatuses(members);
			clusters.push({
				id: buildWorkflowClusterId(title, objective, parameterSchema, workflowFamilyHint),
				title,
				objective,
				...(summary ? { summary } : {}),
				...(workflowFamilyHint ? { workflowFamilyHint } : {}),
				parameterSchema,
				episodeIds,
				occurrenceCount: members.length,
				completeCount: statusCounts.completeCount,
				partialCount: statusCounts.partialCount,
				failedCount: statusCounts.failedCount,
				firstSeenAt: Math.min(...members.map((episode) => episode.startedAt)),
				lastSeenAt: Math.max(...members.map((episode) => episode.endedAt)),
			});
		}
		return clusters.sort((left, right) =>
			right.occurrenceCount - left.occurrenceCount ||
			right.lastSeenAt - left.lastSeenAt);
	};

	const buildWorkflowSkillSynthesisPrompt = (params: {
		cluster: WorkflowCrystallizationCluster;
		episodes: WorkflowCrystallizationEpisode[];
		turnsById: Map<string, WorkflowCrystallizationTurn>;
	}): string => [
		"You are synthesizing a reusable Understudy workspace skill from repeated workflow-family episodes.",
		"Return a teach-like reusable skill spec, not a narrative recap.",
		"Describe functional stages, not low-level GUI clicks or pixel-based replay instructions.",
		"Each stage should explain the goal it accomplishes and list concrete instructions that preserve the same outcome.",
		"Separate stable invariants from variable parameters.",
		"Prefer higher-level routes when they preserve the same outcome: skill > browser > shell > gui.",
		"If the examples only prove a GUI path, keep higher-level routes as fallback or omit them.",
		"Prioritize complete runs when inferring the staged path and success criteria.",
		"Use partial and failed runs only to strengthen failurePolicy, guardrails, or missing-precondition notes.",
		`Cluster title: ${params.cluster.title}`,
		`Cluster objective: ${params.cluster.objective}`,
		`Observed occurrence count: ${params.cluster.occurrenceCount}`,
		`Observed status counts: complete=${params.cluster.completeCount} partial=${params.cluster.partialCount} failed=${params.cluster.failedCount}`,
		"Episode examples:",
		...params.episodes.slice(0, MAX_SYNTHESIS_EPISODE_EXAMPLES).map((episode, index) => {
			const sourceTurns = episode.turnIds
				.map((id) => params.turnsById.get(id))
				.filter((turn): turn is WorkflowCrystallizationTurn => Boolean(turn));
			return [
				`${index + 1}. ${episode.title}`,
				`   objective: ${episode.objective}`,
				`   workflow_family_hint: ${episode.workflowFamilyHint || "--"}`,
				`   completion: ${episode.completion}`,
				`   summary: ${episode.summary}`,
				`   parameters: ${episode.parameterHints.join(", ") || "--"}`,
				`   success: ${episode.successSignals.join(" | ") || "--"}`,
				`   route_signature: ${episode.routeSignature || "--"}`,
				...sourceTurns.map((turn) => buildWorkflowExecutionTurnPreview(turn)),
			].join("\n");
		}),
		"Return strict JSON only.",
		'Schema: {"title":"...","objective":"...","summary":"...","triggers":["..."],"parameterSlots":[{"name":"...","label":"...","sampleValue":"...","required":true,"notes":"..."}],"stages":[{"title":"...","goal":"...","instructions":["..."]}],"routeOptions":[{"route":"skill|browser|shell|gui","preference":"preferred|fallback|observed","instruction":"...","toolName":"optional-tool"}],"successCriteria":["..."],"failurePolicy":["..."]}',
	].join("\n");

	const normalizeWorkflowCandidateParameterSlots = (value: unknown): TaughtTaskDraftParameter[] => {
		const raw = Array.isArray(value) ? value : [];
		const slots: TaughtTaskDraftParameter[] = [];
		for (const entry of raw) {
			if (typeof entry === "string") {
				const name = trimToUndefined(entry)?.toLowerCase().replace(/[^a-z0-9]+/g, "_");
				if (!name) {
					continue;
				}
				slots.push({
					name,
					label: name.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
					required: true,
				});
				continue;
			}
			const record = asRecord(entry);
			if (!record) {
				continue;
			}
			const name = trimToUndefined(asString(record.name))?.toLowerCase().replace(/[^a-z0-9]+/g, "_");
			if (!name) {
				continue;
			}
			slots.push({
				name,
				label: trimToUndefined(asString(record.label))
					?? name.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
				sampleValue: trimToUndefined(asString(record.sampleValue)),
				required: record.required !== false,
				notes: trimToUndefined(asString(record.notes)),
			});
		}
		return slots.slice(0, 12);
	};

	const normalizeWorkflowCandidateRouteOptions = (value: unknown): WorkflowCrystallizationRouteOption[] => {
		const raw = Array.isArray(value) ? value : [];
		const options: WorkflowCrystallizationRouteOption[] = [];
		for (const entry of raw) {
			const record = asRecord(entry);
			if (!record) {
				continue;
			}
			const route = normalizeTeachExecutionRoute(record.route);
			const instruction = trimToUndefined(asString(record.instruction));
			if (!route || !instruction) {
				continue;
			}
			const preference = (() => {
				switch (trimToUndefined(asString(record.preference))?.toLowerCase()) {
					case "fallback":
						return "fallback" as const;
					case "observed":
						return "observed" as const;
					default:
						return "preferred" as const;
				}
			})();
			options.push({
				route,
				preference,
				instruction,
				...(trimToUndefined(asString(record.toolName)) ? { toolName: trimToUndefined(asString(record.toolName)) } : {}),
			});
		}
		return options.slice(0, 16);
	};

	const normalizeWorkflowSkillStages = (value: unknown): WorkflowCrystallizationSkillStage[] => {
		const raw = Array.isArray(value) ? value : [];
		const stages: WorkflowCrystallizationSkillStage[] = [];
		for (const entry of raw) {
			const record = asRecord(entry);
			if (!record) {
				continue;
			}
			const title = trimToUndefined(asString(record.title))
				?? `Stage ${stages.length + 1}`;
			const goal = trimToUndefined(asString(record.goal))
				?? trimToUndefined(asString(record.summary))
				?? title;
			const instructions = uniqueStrings([
				...asStringList(record.instructions),
				...asStringList(record.steps),
				...(trimToUndefined(asString(record.instruction)) ? [trimToUndefined(asString(record.instruction))!] : []),
			]).slice(0, 6);
			if (instructions.length === 0) {
				continue;
			}
			stages.push({
				title,
				goal,
				instructions,
			});
		}
		return stages.slice(0, 8);
	};

	const normalizeWorkflowSkill = (params: {
		payload: Record<string, unknown>;
		cluster: WorkflowCrystallizationCluster;
		sourceEpisodeIds: string[];
		successfulEpisodeIds: string[];
		now: number;
		existing?: WorkflowCrystallizationSkill;
	}): WorkflowCrystallizationSkill | undefined => {
		const title = trimToUndefined(asString(params.payload.title)) ?? params.cluster.title;
		const objective = trimToUndefined(asString(params.payload.objective)) ?? params.cluster.objective;
		if (!title || !objective) {
			return undefined;
		}
		const stages = normalizeWorkflowSkillStages(params.payload.stages);
		return {
			id: createHash("sha1")
				.update(params.cluster.id)
				.update(normalizeComparableText(title))
				.update(normalizeComparableText(objective))
				.digest("hex")
				.slice(0, 12),
			clusterId: params.cluster.id,
			title,
			objective,
			...(trimToUndefined(asString(params.payload.summary)) ? { summary: trimToUndefined(asString(params.payload.summary)) } : {}),
			...(params.cluster.workflowFamilyHint ? { workflowFamilyHint: params.cluster.workflowFamilyHint } : {}),
			triggers: uniqueStrings([
				...asStringList(params.payload.triggers),
				...(params.existing?.triggers ?? []),
			]).slice(0, 8),
			parameterSlots: normalizeWorkflowCandidateParameterSlots(params.payload.parameterSlots),
			stages,
			routeOptions: normalizeWorkflowCandidateRouteOptions(params.payload.routeOptions),
			successCriteria: uniqueStrings(asStringList(params.payload.successCriteria)).slice(0, 12),
			failurePolicy: uniqueStrings(asStringList(params.payload.failurePolicy)).slice(0, 12),
			sourceEpisodeIds: params.sourceEpisodeIds,
			sourceEpisodeCount: params.sourceEpisodeIds.length,
			successfulEpisodeCount: params.successfulEpisodeIds.length,
			observedStatusCounts: {
				completeCount: params.cluster.completeCount,
				partialCount: params.cluster.partialCount,
				failedCount: params.cluster.failedCount,
			},
			lastSynthesizedAt: params.now,
			...(params.existing?.publishedSkill ? { publishedSkill: params.existing.publishedSkill } : {}),
			...(params.existing?.notification ? { notification: params.existing.notification } : {}),
		};
	};

	const collectWorkflowEpisodes = (ledger: WorkflowCrystallizationLedger): WorkflowCrystallizationEpisode[] =>
		ledger.days
			.flatMap((day) => day.episodes);

	const buildWorkflowEpisodeFingerprint = (episodes: WorkflowCrystallizationEpisode[]): string =>
		createHash("sha1")
			.update(episodes.map((episode) =>
				`${episode.id}:${episode.segmentId}:${episode.completion}:${episode.workflowFamilyHint ?? ""}:${episode.summary}`).join("|"))
			.digest("hex")
			.slice(0, 16);

	const buildWorkflowPromotionFingerprint = (clusters: WorkflowCrystallizationCluster[]): string =>
		createHash("sha1")
			.update(clusters.map((cluster) =>
				`${cluster.id}:${cluster.occurrenceCount}:${cluster.completeCount}:${cluster.partialCount}:${cluster.failedCount}:${cluster.episodeIds.join(",")}`).join("|"))
			.digest("hex")
			.slice(0, 16);

	const buildWorkflowTurnsById = (ledger: WorkflowCrystallizationLedger): Map<string, WorkflowCrystallizationTurn> =>
		new Map(
			ledger.days
				.flatMap((day) => day.turns)
				.map((turn) => [turn.id, turn] as const),
		);

	const segmentWorkflowDay = async (params: {
		entry: SessionEntry;
		workspaceDir: string;
		dayStamp: string;
		turns: WorkflowCrystallizationTurn[];
	}): Promise<WorkflowCrystallizationSegment[]> => {
		const prompt = buildWorkflowSegmentationPrompt(params);
		const response = await runWorkflowCrystallizationPrompt({
			entry: params.entry,
			purpose: "segment",
			prompt,
		});
		return normalizeWorkflowSegments({
			payload: extractJsonObject(response),
			dayStamp: params.dayStamp,
			turns: params.turns,
			workspaceDir: params.workspaceDir,
		});
	};

	const summarizeWorkflowSegments = async (params: {
		entry: SessionEntry;
		workspaceDir: string;
		dayStamp: string;
		turns: WorkflowCrystallizationTurn[];
		segments: WorkflowCrystallizationSegment[];
	}): Promise<WorkflowCrystallizationEpisode[]> => {
		if (params.segments.length === 0) {
			return [];
		}
		const prompt = buildWorkflowEpisodeSummaryPrompt(params);
		const response = await runWorkflowCrystallizationPrompt({
			entry: params.entry,
			purpose: "summarize",
			prompt,
		});
		return normalizeWorkflowEpisodes({
			payload: extractJsonObject(response),
			segments: params.segments,
			turns: params.turns,
			workspaceDir: params.workspaceDir,
		});
	};

	const clusterWorkflowEpisodes = async (params: {
		entry: SessionEntry;
		episodes: WorkflowCrystallizationEpisode[];
	}): Promise<WorkflowCrystallizationCluster[]> => {
		const prompt = buildWorkflowClusterPrompt({
			episodes: params.episodes.slice(0, MAX_CLUSTERING_EPISODES),
		});
		const response = await runWorkflowCrystallizationPrompt({
			entry: params.entry,
			purpose: "cluster",
			prompt,
		});
		return normalizeWorkflowClusters({
			payload: extractJsonObject(response),
			episodes: params.episodes,
		});
	};

	const synthesizeWorkflowSkill = async (params: {
		entry: SessionEntry;
		cluster: WorkflowCrystallizationCluster;
		ledger: WorkflowCrystallizationLedger;
		existing?: WorkflowCrystallizationSkill;
	}): Promise<WorkflowCrystallizationSkill | undefined> => {
		const episodesById = new Map(collectWorkflowEpisodes(params.ledger).map((episode) => [episode.id, episode] as const));
		const clusterEpisodes = params.cluster.episodeIds
			.map((id) => episodesById.get(id))
			.filter((episode): episode is WorkflowCrystallizationEpisode => Boolean(episode))
			.sort((left, right) => right.endedAt - left.endedAt);
		const successfulEpisodes = clusterEpisodes.filter((episode) => episode.completion === "complete");
		if (successfulEpisodes.length < MIN_CLUSTER_OCCURRENCES_FOR_PROMOTION) {
			return undefined;
		}
		const sourceEpisodes = [
			...successfulEpisodes,
			...clusterEpisodes.filter((episode) => episode.completion !== "complete"),
		].slice(0, MAX_SYNTHESIS_EPISODE_EXAMPLES);
		const prompt = buildWorkflowSkillSynthesisPrompt({
			cluster: params.cluster,
			episodes: sourceEpisodes,
			turnsById: buildWorkflowTurnsById(params.ledger),
		});
		const response = await runWorkflowCrystallizationPrompt({
			entry: params.entry,
			purpose: "synthesize",
			prompt,
		});
		return normalizeWorkflowSkill({
			payload: extractJsonObject(response),
			cluster: params.cluster,
			sourceEpisodeIds: clusterEpisodes.map((episode) => episode.id),
			successfulEpisodeIds: successfulEpisodes.map((episode) => episode.id),
			now: Date.now(),
			existing: params.existing,
		});
	};

	const shouldReanalyzeWorkflowDay = (turnCount: number, lastSegmentedTurnCount?: number): boolean => {
		if (turnCount < MIN_TURNS_FOR_WORKFLOW_SEGMENTATION) {
			return false;
		}
		if (lastSegmentedTurnCount === undefined) {
			return true;
		}
		return turnCount - lastSegmentedTurnCount >= WORKFLOW_SEGMENTATION_REANALYZE_DELTA;
	};

	const notifyWorkflowCrystallizationPublished = async (params: {
		entry: SessionEntry;
		skills: Array<{
			skill: WorkflowCrystallizationSkill;
			previous?: WorkflowCrystallizationSkill;
		}>;
	}): Promise<number | undefined> => {
		if (!notifyUser || params.skills.length === 0) {
			return undefined;
		}
		const timestamp = Date.now();
		const summaryLines = params.skills.slice(0, 3).map(({ skill, previous }) =>
			`- ${skill.publishedSkill?.name ?? skill.title}: ${previous?.publishedSkill ? "updated" : "new"} skill from ${skill.successfulEpisodeCount} successful runs (${skill.sourceEpisodeCount} observed total).`);
		const extraCount = params.skills.length - summaryLines.length;
		const text = [
			params.skills.length === 1
				? "A crystallized workflow skill was published and hot-loaded into this workspace."
				: `${params.skills.length} crystallized workflow skills were published and hot-loaded into this workspace.`,
			...summaryLines,
			...(extraCount > 0 ? [`- ${extraCount} additional crystallized skills were also refreshed.`] : []),
		].join("\n");
		await notifyUser({
			entry: params.entry,
			source: "workflow_crystallization",
			title: "Crystallized workflow skill ready",
			text,
			details: {
				skills: params.skills.map(({ skill, previous }) => ({
					id: skill.id,
					title: skill.title,
					skillName: skill.publishedSkill?.name,
					skillPath: skill.publishedSkill?.skillPath,
					sourceEpisodeCount: skill.sourceEpisodeCount,
					successfulEpisodeCount: skill.successfulEpisodeCount,
					updated: Boolean(previous?.publishedSkill),
				})),
			},
		}).catch(() => {});
		return timestamp;
	};

	const runWorkflowCrystallizationAnalysis = (entry: SessionEntry): void => {
		if (!entry.workspaceDir) {
			return;
		}
		const workspaceKey = resolve(entry.workspaceDir);
		if (activeAnalyses.has(workspaceKey)) {
			pendingAnalyses.add(workspaceKey);
			return;
		}
		const task = (async () => {
			let ledger = await loadPersistedWorkflowCrystallizationLedger({
				workspaceDir: workspaceKey,
				learningDir: runtimeLearningDir,
			}).catch(() => undefined);
			if (!ledger) {
				return;
			}
			let dayNeedingSegmentation = [...ledger.days]
				.sort((left, right) => left.dayStamp.localeCompare(right.dayStamp))
				.find((day) => shouldReanalyzeWorkflowDay(day.turns.length, day.lastSegmentedTurnCount));
			while (dayNeedingSegmentation) {
				const segments = await segmentWorkflowDay({
					entry,
					workspaceDir: workspaceKey,
					dayStamp: dayNeedingSegmentation.dayStamp,
					turns: dayNeedingSegmentation.turns,
				});
				const segmentedAt = Date.now();
				ledger = await runSerializedWorkflowLedgerMutation(workspaceKey, async () =>
					await updatePersistedWorkflowCrystallizationLedger({
						workspaceDir: workspaceKey,
						learningDir: runtimeLearningDir,
						updater: (current) => replaceWorkflowCrystallizationDaySegments(current, {
							dayStamp: dayNeedingSegmentation!.dayStamp,
							segments,
							segmentedAt,
							segmentedTurnCount: dayNeedingSegmentation!.turns.length,
						}),
					}));
				const episodes = await summarizeWorkflowSegments({
					entry,
					workspaceDir: workspaceKey,
					dayStamp: dayNeedingSegmentation.dayStamp,
					turns: dayNeedingSegmentation.turns,
					segments,
				});
				ledger = await runSerializedWorkflowLedgerMutation(workspaceKey, async () =>
					await updatePersistedWorkflowCrystallizationLedger({
						workspaceDir: workspaceKey,
						learningDir: runtimeLearningDir,
						updater: (current) => replaceWorkflowCrystallizationDayEpisodes(current, {
							dayStamp: dayNeedingSegmentation!.dayStamp,
							episodes,
							summarizedAt: Date.now(),
						}),
					}));
				dayNeedingSegmentation = [...ledger.days]
					.sort((left, right) => left.dayStamp.localeCompare(right.dayStamp))
					.find((day) => shouldReanalyzeWorkflowDay(day.turns.length, day.lastSegmentedTurnCount));
			}
			const allEpisodes = collectWorkflowEpisodes(ledger);
			const episodeFingerprint = buildWorkflowEpisodeFingerprint(allEpisodes);
			if (allEpisodes.length >= MIN_EPISODES_FOR_WORKFLOW_CLUSTERING
				&& episodeFingerprint !== ledger.analysisState?.lastClusteredFingerprint) {
				const clusters = await clusterWorkflowEpisodes({
					entry,
					episodes: allEpisodes,
				});
				ledger = await runSerializedWorkflowLedgerMutation(workspaceKey, async () =>
					await updatePersistedWorkflowCrystallizationLedger({
						workspaceDir: workspaceKey,
						learningDir: runtimeLearningDir,
						updater: (current) => replaceWorkflowCrystallizationClusters(current, {
							clusters,
							clusteredAt: Date.now(),
							clusteredEpisodeCount: allEpisodes.length,
							clusteredFingerprint: episodeFingerprint,
						}),
					}));
			}
			const promotableClusters = [...ledger.clusters]
				.filter((cluster) => cluster.completeCount >= MIN_CLUSTER_OCCURRENCES_FOR_PROMOTION)
				.sort((left, right) =>
					right.completeCount - left.completeCount ||
					right.occurrenceCount - left.occurrenceCount ||
					right.lastSeenAt - left.lastSeenAt)
				.slice(0, MAX_PROMOTED_WORKFLOW_CANDIDATES);
			const promotionFingerprint = buildWorkflowPromotionFingerprint(promotableClusters);
			if (promotionFingerprint !== ledger.analysisState?.lastPublishedFingerprint) {
				const existingSkillsById = new Map(ledger.skills.map((skill) => [skill.id, skill] as const));
				const synthesized: WorkflowCrystallizationSkill[] = [];
				const publishedChanges: Array<{
					skill: WorkflowCrystallizationSkill;
					previous?: WorkflowCrystallizationSkill;
				}> = [];
				for (const cluster of promotableClusters) {
					const existing = [...existingSkillsById.values()].find((skill) => skill.clusterId === cluster.id);
					const skill = await synthesizeWorkflowSkill({
						entry,
						cluster,
						ledger,
						existing,
					}).catch(() => undefined);
					if (!skill) {
						continue;
					}
					const publishedSkill = await publishWorkflowCrystallizedSkill({
						workspaceDir: workspaceKey,
						skill,
						overwrite: true,
					}).catch(() => undefined);
					const finalized: WorkflowCrystallizationSkill = publishedSkill
						? {
							...skill,
							publishedSkill,
						}
						: skill;
					synthesized.push(finalized);
					const previousFingerprint = existing?.publishedSkill?.contentFingerprint;
					const nextFingerprint = finalized.publishedSkill?.contentFingerprint;
					if (!existing?.publishedSkill || !nextFingerprint || previousFingerprint !== nextFingerprint || !existing.notification?.notifiedAt) {
						publishedChanges.push({
							skill: finalized,
							previous: existing,
						});
					}
				}
				if (publishedChanges.length > 0) {
					const promptRefreshError = await refreshPublishedSkillPrompts(entry, {
						draft: { objective: publishedChanges[0]!.skill.objective },
						skill: {
							name: publishedChanges[0]!.skill.publishedSkill?.name,
							skillPath: publishedChanges[0]!.skill.publishedSkill?.skillPath,
						},
					});
					if (promptRefreshError) {
						publishedChanges[0]!.skill.failurePolicy = uniqueStrings([
							...publishedChanges[0]!.skill.failurePolicy,
							`Hot refresh warning: ${promptRefreshError}`,
						]).slice(0, 12);
					}
				}
				const notifiedAt = await notifyWorkflowCrystallizationPublished({
					entry,
					skills: publishedChanges,
				});
				const skills = synthesized.map((skill) =>
					publishedChanges.some((change) => change.skill.id === skill.id)
					&& skill.publishedSkill
					&& notifiedAt
						? {
							...skill,
							notification: {
								notifiedAt,
							},
						}
						: skill);
				ledger = await runSerializedWorkflowLedgerMutation(workspaceKey, async () =>
					await updatePersistedWorkflowCrystallizationLedger({
						workspaceDir: workspaceKey,
						learningDir: runtimeLearningDir,
						updater: (current) => replaceWorkflowCrystallizationSkills(current, {
							skills,
							publishedAt: Date.now(),
							publishedClusterCount: promotableClusters.length,
							publishedFingerprint: promotionFingerprint,
						}),
					}));
			}
		})()
			.catch(() => {})
			.finally(() => {
				activeAnalyses.delete(workspaceKey);
				if (pendingAnalyses.delete(workspaceKey)) {
					queueMicrotask(() => {
						runWorkflowCrystallizationAnalysis(entry);
					});
				}
			});
		activeAnalyses.set(workspaceKey, task);
	};

	return {
		runWorkflowCrystallizationAnalysis,
		runSerializedWorkflowLedgerMutation,
	};
}
