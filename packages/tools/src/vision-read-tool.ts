import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ImageContent } from "@mariozechner/pi-ai";
import {
	DEFAULT_MAX_IMAGE_BYTES,
	MAX_EMBEDDED_IMAGE_BYTES,
	loadImageSource,
	toSha256,
} from "./image-shared.js";
import { textResult as baseTextResult } from "./bridge/bridge-rpc.js";

const VisionReadSchema = Type.Object({
	image: Type.String({
		description: "Local path, file:// URL, or http(s) URL of the image to inspect.",
	}),
	focus: Type.Optional(
		Type.String({
			description: "What to focus on, such as an error message, a control, or UI state.",
		}),
	),
	includeImage: Type.Optional(
		Type.Boolean({
			description: "Attach the image to the tool result for downstream visual reasoning (default true).",
		}),
	),
	maxBytes: Type.Optional(
		Type.Number({
			description: "Maximum bytes to read from the image source (default 10MB).",
		}),
	),
});

type VisionReadParams = Static<typeof VisionReadSchema>;

function textResult(
	text: string,
	details: Record<string, unknown> = {},
	imageBlock?: { data: string; mimeType: string } | null,
): AgentToolResult<unknown> {
	const result = baseTextResult(text, details);
	if (imageBlock) {
		const imageContent: ImageContent = {
			type: "image",
			data: imageBlock.data,
			mimeType: imageBlock.mimeType,
		};
		result.content.push(imageContent);
	}
	return result;
}

export function createVisionReadTool(): AgentTool<typeof VisionReadSchema> {
	return {
		name: "vision_read",
		label: "Vision Read",
		description:
			"Inspect a screenshot or photo and attach the image for downstream visual reasoning.",
		parameters: VisionReadSchema,
		execute: async (_toolCallId, params: VisionReadParams): Promise<AgentToolResult<unknown>> => {
			const maxBytes = Math.max(1_024, Math.floor(params.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES));
			const includeImage = params.includeImage !== false;
			const focus = params.focus?.trim();

			try {
				const loaded = await loadImageSource(params.image, maxBytes);
				const probe = loaded.probe;
				if (!probe.mimeType.startsWith("image/")) {
					throw new Error(`Unsupported image type: ${probe.mimeType}`);
				}

				let imageAttached = false;
				let imageAttachedReason = "Image payload omitted by request.";
				let imageBlock: { data: string; mimeType: string } | null = null;
				if (includeImage) {
					if (loaded.bytes.byteLength <= MAX_EMBEDDED_IMAGE_BYTES) {
						imageAttached = true;
						imageAttachedReason = "Image payload attached for downstream visual reasoning.";
						imageBlock = {
							data: loaded.bytes.toString("base64"),
							mimeType: probe.mimeType,
						};
					} else {
						imageAttachedReason =
							`Image payload omitted because it exceeds ${MAX_EMBEDDED_IMAGE_BYTES} bytes.`;
					}
				}

				const details: Record<string, unknown> = {
					source: loaded.source,
					mimeType: probe.mimeType,
					sizeBytes: loaded.bytes.byteLength,
					width: probe.width,
					height: probe.height,
					sha256: toSha256(loaded.bytes),
					imageAttached,
					imageAttachedReason,
				};
				if (focus) {
					details.focus = focus;
				}

				const lines = [
					"Understudy vision read",
					`Source: ${loaded.source}`,
					...(focus ? [`Focus: ${focus}`] : []),
					`MIME: ${probe.mimeType}`,
					`Bytes: ${loaded.bytes.byteLength}`,
					`Dimensions: ${probe.width && probe.height ? `${probe.width}x${probe.height}` : "unknown"}`,
					`SHA256: ${String(details.sha256)}`,
				];

				lines.push(imageAttachedReason);

				return textResult(lines.join("\n"), details, imageBlock);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return textResult(`Understudy vision read failed: ${message}`, { error: message });
			}
		},
	};
}
