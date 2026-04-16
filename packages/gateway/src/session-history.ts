import { stripInlineDirectiveTagsForDisplay } from "@understudy/core";
import type { ImageContent } from "@mariozechner/pi-ai";
import type { Attachment } from "@understudy/types";
import {
	asBoolean,
	asNumber,
	asRecord,
	asString,
	normalizeComparableText,
} from "./value-coerce.js";
import { trimToUndefined } from "./teach-normalization.js";
import type { SessionEntry, SessionRunTrace } from "./session-runtime.js";
import {
	normalizeHistoryAttachments,
	normalizeHistoryImages,
	resolveTeachValidationTrace,
	sanitizeTraceValue,
} from "./session-runtime.js";

function buildHistoryAttachmentSummary(attachments: Attachment[] | undefined): string | undefined {
	if (!attachments || attachments.length === 0) {
		return undefined;
	}
	const labels = attachments
		.slice(0, 3)
		.map((attachment) => attachment.name || attachment.url || attachment.type)
		.filter(Boolean);
	if (labels.length === 0) {
		return `Attached ${attachments.length} file${attachments.length === 1 ? "" : "s"}.`;
	}
	return `Attached ${attachments.length} file${attachments.length === 1 ? "" : "s"}: ${labels.join(", ")}${attachments.length > labels.length ? ", ..." : ""}`;
}

function buildRuntimeHistoryContent(entry: SessionEntry["history"][number]): Array<Record<string, unknown>> {
	const content: Array<Record<string, unknown>> = [];
	if (entry.text.trim().length > 0) {
		content.push({ type: "text", text: entry.text });
	}
	for (const image of entry.images ?? []) {
		content.push({
			type: "image",
			data: image.data,
			mimeType: image.mimeType,
		});
	}
	if (content.length === 0) {
		const attachmentSummary = buildHistoryAttachmentSummary(entry.attachments);
		if (attachmentSummary) {
			content.push({ type: "text", text: attachmentSummary });
		} else {
			content.push({ type: "text", text: entry.text });
		}
	}
	return content;
}

function extractMessageText(message: unknown): string {
	const chunks = (message as { content?: unknown[] } | null | undefined)?.content;
	if (!Array.isArray(chunks)) return "";
	return chunks
		.filter(
			(chunk): chunk is { type?: unknown; text?: unknown } =>
				Boolean(chunk) && typeof chunk === "object",
		)
		.filter((chunk) => chunk.type === "text" && typeof chunk.text === "string")
		.map((chunk) => chunk.text)
		.join("\n")
		.trim();
}

function sanitizeAssistantHistoryEntry(
	entry: SessionEntry["history"][number],
): SessionEntry["history"][number] {
	const nextEntry: SessionEntry["history"][number] = {
		...entry,
		...(normalizeHistoryImages(entry.images) ? { images: normalizeHistoryImages(entry.images) } : {}),
		...(normalizeHistoryAttachments(entry.attachments) ? { attachments: normalizeHistoryAttachments(entry.attachments) } : {}),
	};
	if (entry.role !== "assistant") {
		return nextEntry;
	}
	const text = stripInlineDirectiveTagsForDisplay(entry.text).text;
	return text === entry.text ? nextEntry : { ...nextEntry, text };
}

function normalizeActiveRunSnapshot(result: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
	if (!result) {
		return undefined;
	}
	const rawStatus = asString(result.status);
	if (rawStatus === "ok" || rawStatus === "error") {
		return undefined;
	}
	const progress = asRecord(result.progress);
	const steps = Array.isArray(progress?.steps)
		? progress.steps
			.map((entry) => asRecord(entry))
			.filter((entry): entry is Record<string, unknown> => Boolean(entry))
			.map((entry) => sanitizeTraceValue(entry) as Record<string, unknown>)
		: [];
	const summary = trimToUndefined(asString(progress?.summary));
	const thoughtText = trimToUndefined(asString(progress?.thoughtText));
	const assistantText = trimToUndefined(asString(progress?.assistantText));
	const runId = asString(result.runId);
	const startedAt = asNumber(result.startedAt);
	const updatedAt = asNumber(progress?.updatedAt) ?? asNumber(result.endedAt) ?? startedAt;
	const error = trimToUndefined(asString(result.error));
	if (!runId && !summary && !thoughtText && !assistantText && steps.length === 0 && !error) {
		return undefined;
	}
	return {
		...(runId ? { runId } : {}),
		status: "in_flight",
		...(startedAt !== undefined ? { startedAt } : {}),
		...(updatedAt !== undefined ? { updatedAt } : {}),
		...(summary ? { summary } : {}),
		...(thoughtText ? { thoughtText } : {}),
		...(assistantText ? { assistantText } : {}),
		...(steps.length > 0 ? { steps } : {}),
		...(error ? { error } : {}),
	};
}

function runSupportsHistoryChannels(run: SessionRunTrace | Record<string, unknown> | undefined): boolean {
	if (!run || typeof run !== "object") {
		return false;
	}
	return Boolean(trimToUndefined(asString(run.thoughtText)))
		|| (Array.isArray(run.progressSteps) && run.progressSteps.length > 0)
		|| (Array.isArray(run.toolTrace) && run.toolTrace.length > 0)
		|| (Array.isArray(run.attempts) && run.attempts.length > 0)
		|| Boolean(resolveTeachValidationTrace(run));
}

function assistantMessageMatchesRun(
	message: SessionEntry["history"][number],
	run: SessionRunTrace | undefined,
): boolean {
	if (!run || message.role !== "assistant") {
		return false;
	}
	const messageText = normalizeComparableText(stripInlineDirectiveTagsForDisplay(message.text).text);
	const preview = normalizeComparableText(asString(run.responsePreview) ?? "");
	if (!messageText || !preview) {
		return false;
	}
	if (messageText === preview || messageText.startsWith(preview)) {
		return true;
	}
	const prefixLength = Math.min(120, messageText.length, preview.length);
	return prefixLength >= 24 && messageText.slice(0, prefixLength) === preview.slice(0, prefixLength);
}

function buildHistoryTimeline(
	messages: SessionEntry["history"],
	runs: SessionRunTrace[],
): Array<Record<string, unknown>> {
	const sanitizedMessages = messages.map((message) => sanitizeAssistantHistoryEntry(message));
	const pairedRunsByMessageIndex = new Map<number, SessionRunTrace>();
	let runIndex = 0;
	for (let messageIndex = sanitizedMessages.length - 1; messageIndex >= 0 && runIndex < runs.length; messageIndex -= 1) {
		const message = sanitizedMessages[messageIndex];
		const candidate = runs[runIndex];
		if (assistantMessageMatchesRun(message, candidate)) {
			pairedRunsByMessageIndex.set(messageIndex, candidate);
			runIndex += 1;
		}
	}
	return sanitizedMessages.map((message, index) => {
		const pairedRun = pairedRunsByMessageIndex.get(index);
		if (message.role === "assistant" && pairedRun && runSupportsHistoryChannels(pairedRun)) {
			return {
				kind: "run",
				role: "assistant",
				timestamp: message.timestamp,
				runId: pairedRun.runId,
				recordedAt: pairedRun.recordedAt,
				durationMs: pairedRun.durationMs,
				assistantText: message.text,
				thoughtText: pairedRun.thoughtText,
				progressSteps: pairedRun.progressSteps,
				toolTrace: pairedRun.toolTrace,
				attempts: pairedRun.attempts,
				teachValidation: resolveTeachValidationTrace(pairedRun),
				agentMeta: pairedRun.agentMeta,
				responsePreview: pairedRun.responsePreview,
			};
		}
		return {
			kind: "message",
			role: message.role,
			text: message.text,
			timestamp: message.timestamp,
			...(message.images ? { images: message.images } : {}),
			...(message.attachments ? { attachments: message.attachments } : {}),
		};
	});
}

export type RunTurnResult = {
	response: string;
	runId: string;
	sessionId: string;
	status: "ok" | "in_flight";
	images?: ImageContent[];
	meta?: Record<string, unknown>;
};

export function touchSession(entry: SessionEntry, timestamp: number = Date.now()): void {
	entry.lastActiveAt = timestamp;
}

export function cloneValue<T>(value: T): T {
	if (typeof structuredClone === "function") {
		return structuredClone(value);
	}
	return JSON.parse(JSON.stringify(value)) as T;
}

export function forkRuntimeMessages(parentMessages: unknown[], forkHistory: SessionEntry["history"]): unknown[] {
	if (forkHistory.length === 0) {
		const preserved = parentMessages.filter((message) => {
			const role = (message as { role?: unknown } | null | undefined)?.role;
			return role === "system";
		});
		return cloneValue(preserved);
	}
	let targetIndex = 0;
	let lastMatchIndex = -1;
	for (let i = 0; i < parentMessages.length && targetIndex < forkHistory.length; i++) {
		const message = parentMessages[i] as { role?: unknown } | undefined;
		if (!message || (message.role !== "user" && message.role !== "assistant")) {
			continue;
		}
		const expected = forkHistory[targetIndex];
		if (!expected || message.role !== expected.role) {
			continue;
		}
		const text = normalizeComparableText(extractMessageText(message));
		const expectedText = normalizeComparableText(expected.text);
		if (!expectedText) {
			targetIndex += 1;
			lastMatchIndex = i;
			continue;
		}
		if (text === expectedText) {
			targetIndex += 1;
			lastMatchIndex = i;
		}
	}
	if (targetIndex === 0) {
		return cloneValue(parentMessages);
	}
	return cloneValue(parentMessages.slice(0, lastMatchIndex + 1));
}

export function copyRuntimeMessagesForBranch(
	parent: SessionEntry,
	child: SessionEntry,
	forkHistory: SessionEntry["history"],
): void {
	const parentState = (parent.session as { agent?: { state?: { messages?: unknown[] } } } | undefined)?.agent?.state;
	const childState = (child.session as { agent?: { state?: { messages?: unknown[] } } } | undefined)?.agent?.state;
	if (!Array.isArray(parentState?.messages) || !Array.isArray(childState?.messages)) {
		return;
	}
	childState.messages = forkRuntimeMessages(parentState.messages, forkHistory);
}

export function buildRuntimeMessagesFromHistory(
	existingMessages: unknown[],
	history: SessionEntry["history"],
): unknown[] {
	const preserved = existingMessages.filter((message) => {
		const role = (message as { role?: unknown } | null | undefined)?.role;
		return role === "system";
	});
	const seededAssistant = [...existingMessages]
		.reverse()
		.find((message) => (message as { role?: unknown } | null | undefined)?.role === "assistant") as
			| { api?: unknown; provider?: unknown; model?: unknown }
			| undefined;
	return [
		...cloneValue(preserved),
		...history.map((entry) => entry.role === "assistant"
			? {
				role: "assistant",
				content: buildRuntimeHistoryContent(entry),
				api: asString(seededAssistant?.api) ?? "openai-codex-responses",
				provider: asString(seededAssistant?.provider) ?? "understudy-gateway",
				model: asString(seededAssistant?.model) ?? "gateway-history",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						total: 0,
					},
				},
				stopReason: "stop",
				timestamp: entry.timestamp,
			}
			: {
				role: "user",
				content: buildRuntimeHistoryContent(entry),
				timestamp: entry.timestamp,
			}),
	];
}

export function seedRuntimeMessagesFromHistory(
	entry: SessionEntry,
	history: SessionEntry["history"],
): void {
	const state = (entry.session as { agent?: { state?: { messages?: unknown[] } } } | undefined)?.agent?.state;
	if (!Array.isArray(state?.messages)) {
		return;
	}
	state.messages = buildRuntimeMessagesFromHistory(state.messages, history);
}

export function resolveWaitForCompletion(value: unknown): boolean {
	const explicit = asBoolean(value);
	return explicit !== undefined ? explicit : true;
}

export {
	sanitizeAssistantHistoryEntry,
	normalizeActiveRunSnapshot,
	runSupportsHistoryChannels,
	assistantMessageMatchesRun,
	buildHistoryTimeline,
};
