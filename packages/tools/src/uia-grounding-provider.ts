import {
	type GuiGroundingCoordinateSpace,
	type GuiGroundingProvider,
	type GuiGroundingRequest,
	type GuiGroundingResult,
} from "@understudy/gui";
import { getUiaTree, resolveWin32Helper } from "@understudy/gui";
import {
	findBestUiaMatch,
	flattenUiaTree,
	type UiaMatchResult,
} from "./uia-target-matcher.js";

const UIA_GROUNDING_TIMEOUT_MS = 2_000;
const UIA_TREE_MAX_DEPTH = 10;

/** Click-type actions that require enabled controls. */
const CLICK_ACTIONS: ReadonlySet<string> = new Set([
	"click",
	"right_click",
	"double_click",
	"hover",
	"click_and_hold",
]);

export interface Win32UiaGroundingProviderOptions {
	fallbackProvider: GuiGroundingProvider;
}

/**
 * Convert a UIA match result to a GuiGroundingResult.
 * UIA bounds are in display (screen) pixels.
 */
function uiaMatchToGroundingResult(
	match: UiaMatchResult,
): GuiGroundingResult {
	const { bounds } = match.candidate;
	// Click point = center of the bounding box
	const centerX = Math.round(bounds.x + bounds.width / 2);
	const centerY = Math.round(bounds.y + bounds.height / 2);

	return {
		method: "grounding",
		provider: `win32-uia-${match.strategy}`,
		confidence: match.score,
		reason: `UIA match: ${match.strategy} (score=${match.score.toFixed(2)}, name="${match.candidate.name}", controlType="${match.candidate.controlType}")`,
		coordinateSpace: "display_pixels" as GuiGroundingCoordinateSpace,
		point: { x: centerX, y: centerY },
		box: {
			x: bounds.x,
			y: bounds.y,
			width: bounds.width,
			height: bounds.height,
		},
		raw: {
			strategy: match.strategy,
			name: match.candidate.name,
			controlType: match.candidate.controlType,
			automationId: match.candidate.automationId,
			className: match.candidate.className,
			depth: match.candidate.depth,
		},
	};
}

/**
 * Win32 UIA-first grounding provider.
 *
 * Attempts UIA tree matching first; falls back to the screenshot-based
 * provider if UIA fails or produces no match.
 *
 * The helper path is resolved lazily on first ground() call.
 * This keeps createDefaultGuiRuntime() synchronous.
 */
export class Win32UiaGroundingProvider implements GuiGroundingProvider {
	private readonly fallbackProvider: GuiGroundingProvider;
	private helperPathPromise: Promise<string> | undefined;

	constructor(options: Win32UiaGroundingProviderOptions) {
		this.fallbackProvider = options.fallbackProvider;
	}

	private async getHelperPath(): Promise<string> {
		if (!this.helperPathPromise) {
			this.helperPathPromise = resolveWin32Helper();
		}
		return this.helperPathPromise;
	}

	async ground(params: GuiGroundingRequest): Promise<GuiGroundingResult | undefined> {
		// Try UIA first
		const uiaResult = await this.tryUiaGrounding(params);
		if (uiaResult) return uiaResult;

		// Fall back to screenshot provider
		return this.fallbackProvider.ground(params);
	}

	private async tryUiaGrounding(
		params: GuiGroundingRequest,
	): Promise<GuiGroundingResult | undefined> {
		try {
			const helperPath = await this.getHelperPath();
			const tree = await getUiaTree({
				helperPath,
				app: params.app,
				title: params.windowTitle,
				maxDepth: UIA_TREE_MAX_DEPTH,
				timeoutMs: UIA_GROUNDING_TIMEOUT_MS,
			});

			const candidates = flattenUiaTree(tree, UIA_TREE_MAX_DEPTH);
			const isClickAction = params.action != null && CLICK_ACTIONS.has(params.action);

			const match = findBestUiaMatch(candidates, params.target, {
				scope: params.scope,
				app: params.app,
				title: params.windowTitle,
				locationHint: params.locationHint,
				isClickAction,
			});

			if (match) {
				return uiaMatchToGroundingResult(match);
			}

			return undefined;
		} catch {
			// UIA tree fetch failed (timeout, COM error, helper not found, etc.)
			// Graceful degradation — fall back to screenshot
			return undefined;
		}
	}
}

/**
 * Factory function following the package convention:
 * `create*GroundingProvider(options)` returns `GuiGroundingProvider`.
 */
export function createWin32UiaGroundingProvider(
	options: Win32UiaGroundingProviderOptions,
): GuiGroundingProvider {
	return new Win32UiaGroundingProvider(options);
}
