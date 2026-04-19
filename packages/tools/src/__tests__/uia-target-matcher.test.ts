import { describe, it, expect } from "vitest";
import {
	flattenUiaTree,
	findBestUiaMatch,
	scoreCandidate,
	type FlatUiaCandidate,
} from "../uia-target-matcher.js";
import type { Win32UiaTreeNode } from "@understudy/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<Win32UiaTreeNode> = {}): Win32UiaTreeNode {
	return {
		name: "",
		controlType: "Text",
		automationId: "",
		className: "",
		bounds: { x: 0, y: 0, width: 100, height: 30 },
		isEnabled: true,
		isOffscreen: false,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// flattenUiaTree
// ---------------------------------------------------------------------------

describe("flattenUiaTree", () => {
	it("returns empty array for a tree with no eligible nodes", () => {
		const root = makeNode({ name: "", automationId: "" });
		expect(flattenUiaTree(root)).toEqual([]);
	});

	it("includes a named node with non-zero bounds", () => {
		const root = makeNode({ name: "Save" });
		const result = flattenUiaTree(root);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("Save");
		expect(result[0].depth).toBe(0);
	});

	it("skips offscreen nodes", () => {
		const root = makeNode({ name: "Hidden", isOffscreen: true });
		expect(flattenUiaTree(root)).toHaveLength(0);
	});

	it("skips zero-area nodes", () => {
		const root = makeNode({ name: "Tiny", bounds: { x: 0, y: 0, width: 0, height: 0 } });
		expect(flattenUiaTree(root)).toHaveLength(0);
	});

	it("includes nodes with no name but with automationId", () => {
		const root = makeNode({ name: "", automationId: "btnSubmit" });
		const result = flattenUiaTree(root);
		expect(result).toHaveLength(1);
		expect(result[0].automationId).toBe("btnSubmit");
	});

	it("flattens nested children", () => {
		const root = makeNode({
			name: "Window",
			children: [
				makeNode({ name: "Toolbar", children: [
					makeNode({ name: "Save" }),
					makeNode({ name: "Open" }),
				]}),
				makeNode({ name: "Content" }),
			],
		});
		const result = flattenUiaTree(root);
		expect(result).toHaveLength(5);
		expect(result.map((c) => c.name)).toEqual(["Window", "Toolbar", "Save", "Open", "Content"]);
		// Verify depth
		expect(result.find((c) => c.name === "Save")!.depth).toBe(2);
	});

	it("respects maxDepth (including nodes at the configured depth limit)", () => {
		const root = makeNode({
			name: "Root",
			children: [
				makeNode({ name: "L1", children: [
					makeNode({ name: "L2", children: [
						makeNode({ name: "L3" }),
					]}),
				]}),
			],
		});
		// C++ stops descending once the parent is already at maxDepth, so depth 2 is still included.
		const result = flattenUiaTree(root, 2);
		expect(result.map((c) => c.name)).toEqual(["Root", "L1", "L2"]);
	});
});

// ---------------------------------------------------------------------------
// scoreCandidate
// ---------------------------------------------------------------------------

describe("scoreCandidate", () => {
	it("scores exact name match at 1.0", () => {
		const candidate = makeCandidate({ name: "Save" });
		const result = scoreCandidate(candidate, "Save");
		expect(result).toEqual({ score: 1.0, strategy: "exact_name" });
	});

	it("scores case-insensitively", () => {
		const candidate = makeCandidate({ name: "Save" });
		const result = scoreCandidate(candidate, "save");
		expect(result).toEqual({ score: 1.0, strategy: "exact_name" });
	});

	it("scores partial name match when target contains node name", () => {
		const candidate = makeCandidate({ name: "Save" });
		const result = scoreCandidate(candidate, "Save button");
		expect(result).toEqual({ score: 0.7, strategy: "partial_name" });
	});

	it("scores target-contains-name at 0.65", () => {
		const candidate = makeCandidate({ name: "File Explorer" });
		const result = scoreCandidate(candidate, "explorer");
		expect(result).toEqual({ score: 0.65, strategy: "target_contains_name" });
	});

	it("scores automationId match at 0.4", () => {
		const candidate = makeCandidate({ automationId: "btnSave" });
		const result = scoreCandidate(candidate, "btnSave");
		expect(result).toEqual({ score: 0.4, strategy: "automation_id" });
	});

	it("returns null for no match", () => {
		const candidate = makeCandidate({ name: "Save" });
		expect(scoreCandidate(candidate, "Completely Different")).toBeNull();
	});

	it("returns null for single-char name partial match (too ambiguous)", () => {
		const candidate = makeCandidate({ name: "X" });
		expect(scoreCandidate(candidate, "some X thing")).toBeNull();
	});
});

function makeCandidate(overrides: Partial<FlatUiaCandidate> = {}): FlatUiaCandidate {
	return {
		name: "",
		controlType: "Button",
		automationId: "",
		className: "",
		bounds: { x: 0, y: 0, width: 100, height: 30 },
		isEnabled: true,
		isOffscreen: false,
		depth: 0,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// findBestUiaMatch
// ---------------------------------------------------------------------------

describe("findBestUiaMatch", () => {
	it("returns null for empty candidates", () => {
		expect(findBestUiaMatch([], "Save")).toBeNull();
	});

	it("returns null for empty target", () => {
		expect(findBestUiaMatch([makeCandidate({ name: "Save" })], "")).toBeNull();
	});

	it("finds exact match", () => {
		const candidates = [
			makeCandidate({ name: "Open" }),
			makeCandidate({ name: "Save" }),
			makeCandidate({ name: "Close" }),
		];
		const result = findBestUiaMatch(candidates, "Save");
		expect(result).not.toBeNull();
		expect(result!.candidate.name).toBe("Save");
		expect(result!.score).toBe(1.0);
		expect(result!.strategy).toBe("exact_name");
	});

	it("picks best score among multiple matches", () => {
		const candidates = [
			makeCandidate({ name: "Save As", automationId: "" }),
			makeCandidate({ name: "Save", automationId: "btnSave" }),
		];
		const result = findBestUiaMatch(candidates, "Save");
		expect(result!.candidate.name).toBe("Save");
		expect(result!.score).toBe(1.0);
	});

	it("rejects score below 0.6 threshold", () => {
		const candidates = [
			makeCandidate({ automationId: "btnSave" }),
		];
		// automationId match → 0.4 < 0.6
		const result = findBestUiaMatch(candidates, "btnSave");
		expect(result).toBeNull();
	});

	it("matches 'Save' target against 'Save As' button via target_contains_name at 0.65", () => {
		const candidates = [
			makeCandidate({ name: "Save As" }),
		];
		const result = findBestUiaMatch(candidates, "Save");
		expect(result).not.toBeNull();
		expect(result!.candidate.name).toBe("Save As");
		expect(result!.strategy).toBe("target_contains_name");
		expect(result!.score).toBe(0.65);
	});

	it("returns null on ambiguity (same name+type, same score)", () => {
		const candidates = [
			makeCandidate({ name: "OK", controlType: "Button" }),
			makeCandidate({ name: "OK", controlType: "Button", bounds: { x: 500, y: 500, width: 100, height: 30 } }),
		];
		const result = findBestUiaMatch(candidates, "OK");
		expect(result).toBeNull(); // ambiguous
	});

	it("resolves ambiguity when controlTypes differ", () => {
		const candidates = [
			makeCandidate({ name: "OK", controlType: "Button" }),
			makeCandidate({ name: "OK", controlType: "Text", bounds: { x: 500, y: 500, width: 100, height: 30 } }),
		];
		const result = findBestUiaMatch(candidates, "OK");
		// Both score 1.0 but name+type combos are different, so no ambiguity
		expect(result).not.toBeNull();
		expect(result!.candidate.name).toBe("OK");
	});

	it("filters disabled controls for click actions", () => {
		const candidates = [
			makeCandidate({ name: "Save", isEnabled: false }),
		];
		const result = findBestUiaMatch(candidates, "Save", { isClickAction: true });
		expect(result).toBeNull();
	});

	it("includes disabled controls for non-click actions", () => {
		const candidates = [
			makeCandidate({ name: "Save", isEnabled: false }),
		];
		const result = findBestUiaMatch(candidates, "Save", { isClickAction: false });
		expect(result).not.toBeNull();
	});

	it("prefers shallower nodes on same score", () => {
		const candidates = [
			makeCandidate({ name: "Menu", controlType: "MenuItem", depth: 3 }),
			makeCandidate({ name: "Menu", controlType: "Button", depth: 1 }),
		];
		const result = findBestUiaMatch(candidates, "Menu");
		expect(result).not.toBeNull();
		expect(result!.candidate.depth).toBe(1);
	});

	it("uses location hint as tiebreaker among same-score candidates", () => {
		const candidates = [
			makeCandidate({ name: "OK", bounds: { x: 0, y: 0, width: 100, height: 30 } }),
			makeCandidate({ name: "OK", controlType: "Text", bounds: { x: 500, y: 500, width: 100, height: 30 } }),
		];
		const result = findBestUiaMatch(candidates, "OK", { locationHint: "520,510" });
		expect(result).not.toBeNull();
		expect(result!.candidate.bounds.x).toBe(500);
	});
});
