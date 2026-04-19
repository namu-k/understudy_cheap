import type { Win32UiaTreeNode } from "@understudy/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A flattened UIA node with depth metadata for scoring. */
export interface FlatUiaCandidate {
	name: string;
	controlType: string;
	automationId: string;
	className: string;
	bounds: { x: number; y: number; width: number; height: number };
	isEnabled: boolean;
	isOffscreen: boolean;
	depth: number;
}

/** The result of a successful UIA match. */
export interface UiaMatchResult {
	candidate: FlatUiaCandidate;
	score: number;
	strategy: "exact_name" | "partial_name" | "automation_id" | "target_contains_name";
}

// ---------------------------------------------------------------------------
// Flattening
// ---------------------------------------------------------------------------

/**
 * Flatten a UIA tree into an array of candidates for matching.
 * Skips offscreen nodes, zero-area nodes, and nodes with empty names
 * (unless they have a non-empty automationId).
 */
export function flattenUiaTree(
	root: Win32UiaTreeNode,
	maxDepth: number = 10,
): FlatUiaCandidate[] {
	const candidates: FlatUiaCandidate[] = [];

	function walk(node: Win32UiaTreeNode, depth: number): void {
		if (depth > maxDepth) return;

		const bounds = node.bounds;
		const hasArea = bounds.width > 0 && bounds.height > 0;
		const hasName = node.name.trim().length > 0;
		const hasAutomationId = node.automationId.trim().length > 0;

		// Include if: has non-zero area AND (has name OR has automationId)
		// Skip: offscreen, zero-area, no identifying info
		if (
			!node.isOffscreen &&
			hasArea &&
			(hasName || hasAutomationId)
		) {
			candidates.push({
				name: node.name,
				controlType: node.controlType,
				automationId: node.automationId,
				className: node.className,
				bounds,
				isEnabled: node.isEnabled,
				isOffscreen: node.isOffscreen,
				depth,
			});
		}

		if (node.children) {
			for (const child of node.children) {
				walk(child, depth + 1);
			}
		}
	}

	walk(root, 0);
	return candidates;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Determine the match strategy and score for a candidate against a target string.
 * Returns null if no meaningful match.
 */
export function scoreCandidate(
	candidate: FlatUiaCandidate,
	target: string,
): { score: number; strategy: UiaMatchResult["strategy"] } | null {
	const targetLower = target.toLowerCase();
	const nameLower = candidate.name.toLowerCase();
	const aidLower = candidate.automationId.toLowerCase();

	// 1. Exact name match
	if (nameLower === targetLower && nameLower.length > 0) {
		return { score: 1.0, strategy: "exact_name" };
	}

	// 2. Target contains the full node name (user says "click Save button", target is "Save")
	if (nameLower.length > 0 && targetLower.includes(nameLower)) {
		// But not if name is a single character — too ambiguous
		if (nameLower.length >= 2) {
			return { score: 0.7, strategy: "partial_name" };
		}
	}

	// 3. Node name contains the target (target is a substring of name)
	if (nameLower.length > 0 && nameLower.includes(targetLower) && targetLower.length >= 2) {
		return { score: 0.65, strategy: "target_contains_name" };
	}

	// 4. AutomationId match
	if (aidLower.length > 0 && targetLower.includes(aidLower)) {
		return { score: 0.4, strategy: "automation_id" };
	}

	return null;
}

/**
 * Find the best UIA match among candidates for a given target string.
 *
 * Hard filters applied during flattening: offscreen, zero-area, no identifying info.
 * Additional hard filter here: disabled controls for click-type actions.
 *
 * Scoring: exact name (1.0) > partial name (0.7) > target contains name (0.65) > automationId (0.4)
 * Accept match if score >= 0.6 and no ambiguity among top candidates.
 */
export function findBestUiaMatch(
	candidates: FlatUiaCandidate[],
	target: string,
	options?: {
		scope?: string;
		app?: string;
		title?: string;
		locationHint?: string;
		isClickAction?: boolean;
	},
): UiaMatchResult | null {
	if (candidates.length === 0 || !target.trim()) return null;

	// Filter: reject disabled controls for click-type actions
	const eligible = options?.isClickAction
		? candidates.filter((c) => c.isEnabled)
		: candidates;

	if (eligible.length === 0) return null;

	// Score all candidates
	const scored: Array<UiaMatchResult> = [];
	for (const candidate of eligible) {
		const result = scoreCandidate(candidate, target);
		if (result) {
			scored.push({
				candidate,
				score: result.score,
				strategy: result.strategy,
			});
		}
	}

	if (scored.length === 0) return null;

	// Sort by score descending, then by depth ascending (prefer shallower/nearer)
	scored.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		return a.candidate.depth - b.candidate.depth;
	});

	const best = scored[0];

	// Reject if score is too low
	if (best.score < 0.6) return null;

	// Ambiguity check: if multiple top candidates have the same score
	// AND the same name+controlType, it's ambiguous
	const sameScore = scored.filter(
		(s) => s.score === best.score,
	);
	if (sameScore.length > 1) {
		const bestKey = `${best.candidate.name.toLowerCase()}::${best.candidate.controlType.toLowerCase()}`;
		const ambiguousCount = sameScore.filter(
			(s) =>
				`${s.candidate.name.toLowerCase()}::${s.candidate.controlType.toLowerCase()}` === bestKey,
		).length;
		if (ambiguousCount > 1) return null; // ambiguous
	}

	// Location hint disambiguation: if hint provided and multiple candidates at same score,
	// prefer the one whose bounds contain the hinted location
	if (options?.locationHint && sameScore.length > 1) {
		const hintMatch = options.locationHint.match(/^(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)$/);
		if (hintMatch) {
			const hx = parseFloat(hintMatch[1]);
			const hy = parseFloat(hintMatch[2]);
			for (const s of sameScore) {
				const b = s.candidate.bounds;
				if (
					hx >= b.x && hx <= b.x + b.width &&
					hy >= b.y && hy <= b.y + b.height
				) {
					return s;
				}
			}
		}
	}

	// Scope filter: if scope is provided, prefer candidates whose name/controlType
	// contains the scope string. Only applies as a tiebreaker among same-score candidates.
	if (options?.scope && sameScore.length > 1) {
		const scopeLower = options.scope.toLowerCase();
		const scopeMatch = sameScore.find(
			(s) =>
				s.candidate.name.toLowerCase().includes(scopeLower) ||
				s.candidate.className.toLowerCase().includes(scopeLower),
		);
		if (scopeMatch) return scopeMatch;
	}

	return best;
}
