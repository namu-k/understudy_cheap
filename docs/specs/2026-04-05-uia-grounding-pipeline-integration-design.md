# UIA Grounding Pipeline Integration Design

> **Date:** 2026-04-05
> **Status:** Draft
> **Author:** Claude + kkach
> **Background:** The uia-tree subcommand was infrastructure-only with no runtime consumers. This spec wires it into the runtime grounding pipeline so the agent uses UIA tree data for coordinate resolution.

## Goal

Enable the Win32 GUI runtime to use UIA accessibility tree data as a fast, deterministic first-pass for GUI grounding, falling back to screenshot-based LLM grounding only when UIA matching fails.

 This replaces the current screenshot-only grounding for all GUI actions on Windows.

 The Faster resolution for named/accessible controls (zero model cost)
- Deterministic handling of enabled/disabled/offscreen state
- No prompt changes to existing screenshot grounding provider

- Telemetry for hit rate, fallback rate, and misfire rate

## Constraints

- **Windows 10 2004+ only** — UIA requires Win10 2004+
- **No macOS code changes** — additive Win32-only
 all changes are `if (platform === "win32")` branches
- **Same interfaces** — `GuiGroundingProvider`, `GuiGroundingResult`, `GuiGroundingRequest` unchanged
- **C++ field-name fix included** — fix mismatches between C++ output and TS interface as a subtask
- **UIA-only provider** — new `Win32UiaGroundingProvider` wrapping existing screenshot provider

- **All GUI actions** — UIA-first grounding applies to click, right_click, double_click, hover, click_and_hold, drag, scroll, type, wait, observe, key, move

- **Telemetry** — instrumentation for hit rate, fallback rate, latency tracking
- **Graceful degradation** — if UIA tree fetch fails or times out, falls back to screenshot-only path
- **Fallback is always to the screenshot provider** — never skips UIA entirely

- **The confidence threshold is high** — only return UIA results when singular, unambiguous match found

- **No heuristic scoring** — exact/near-exact match only, no fuzzy/partial string matching

- **Offscreen nodes always excluded** — `isOffscreen: true` nodes are filtered out before matching

- **Zero-area bounds excluded** — nodes with zero-width or zero-height are filtered out
- **Disabled nodes excluded for — unless the target explicitly describes "disabled", nodes where `isEnabled: false` are filtered out
- **AutomationId hint** - if the request includes `automationId` or matches on automationId as a fallback signal
- **Duplicates rejected** - multiple sibling nodes with the same name+type are treated as ambiguous, fallback to screenshot
- **Empty names skipped** - nodes with empty or whitespace-only names are filtered out before matching
- **Scope filtering** - if `scope` hint is provided, candidate must be within the scope's bounds
- **Location hint** - if `locationHint` is provided ( use it to disambiguate among siblings with same name

- **app hint** - if `app` hint is provided, filter to nodes belonging to that app's windows
- **windowTitle hint** - if `windowTitle` is provided, filter to top-level window node matching the title
- **No app/window targeting** - when no app or window title, or hwnd is available, target the desktop root tree

- **When UIA tree fetch fails** ( timeout, COM error, → fall back to screenshot
- **When UIA tree is empty** ( root has no children after filtering) → fall back to screenshot
- **When window has no matching UIA tree** | getUiaTree returns empty tree) → fall back to screenshot

- **Match candidate selection** - `undefined` → fall back
 screenshot
- **No match** → fall back to screenshot

- **Multiple matches** → fall back to screenshot

- **Match too ambiguous** ( low relevance) → fall back to screenshot

- **Match result** → `Win32UiaMatchResult`
  ```typescript
  interface Win32UiaMatchResult {
    node: Win32UiaTreeNode;
    score: number;  // 0-1, higher = better
    matchStrategy: "name" | "controlType" | "name+controlType" | "automationId" | "location";
  }
  ```
- **`GuiGroundingResult` construction** — transform UIA match into the grounding result
  ```typescript
  function uiaMatchToGroundingResult(
    match: Win32UiaMatchResult,
    coordinateSpace: GuiGroundingCoordinateSpace,
  ): GuiGroundingResult {
    return {
      method: "grounding",
      provider: "win32-uia",
      confidence: match.score,
      reason: `UIA matched: ${match.node.name} (${match.node.controlType})`,
      coordinateSpace,
      point: {
        x: match.node.bounds.x + match.node.bounds.width / 2,
        y: match.node.bounds.y + match.node.bounds.height / 2,
      },
      box: {
        x: match.node.bounds.x,
        y: match.node.bounds.y,
        width: match.node.bounds.width,
        height: match.node.bounds.height,
      },
      raw: {
        source: "uia-tree",
        uiaNode: {
          name: match.node.name,
          controlType: match.node.controlType,
          automationId: match.node.automationId,
          className: match.node.className,
          bounds: match.node.bounds,
          isEnabled: match.node.isEnabled,
          isOffscreen: match.node.isOffscreen,
        },
      },
    };
  }
  ```

- **Recursive tree walk** - flatten tree into candidate array, depth-first search
  ```typescript
  function flattenUiaTree(
    root: Win32UiaTreeNode,
    maxDepth?: number,
  ): Win32UiaTreeNode[] {
    const candidates: Win32UiaTreeNode[] = [];
    const stack: Array<{ node: Win32UiaTreeNode; depth: number }> = [{ node: root, depth: 0 }];

    while (stack.length > 0) {
      const { node, depth } = stack.pop()!;
      if (maxDepth !== undefined && depth >= maxDepth) continue;
      candidates.push(node);
      if (node.children) {
        for (const child of node.children) {
          stack.push({ node: child, depth: depth + 1 });
        }
      }
    }
    return candidates;
  }
  ```

- **Target matching** - find best match from candidates
  ```typescript
  function findBestUiaMatch(params: {
    candidates: Win32UiaTreeNode[];
    target: string;
    scope?: string;
    app?: string;
    windowTitle?: string;
    locationHint?: string;
  }): Win32UiaMatchResult | undefined {
    // Filter out invalid candidates
    const valid = candidates.filter(c =>
      c.name.trim().length > 0 &&
      !c.isOffscreen &&
      c.bounds.width > 0 && c.bounds.height > 0
    );
    if (valid.length === 0) return undefined;

    // Score each candidate
    const scored = valid.map(node => {
      let score = 0;
      const nameLower = node.name.toLowerCase().trim();
      const targetLower = target.toLowerCase().trim();

      // Exact name match (highest signal)
      if (nameLower === targetLower) score += 1.0;

      // Target contains full name
      else if (nameLower.includes(targetLower)) score += 0.7;
      // Name contains target
      else if (targetLower.includes(nameLower)) score += 0.5;
      // automationId match
      if (node.automationId && targetLower.includes(node.automationId.toLowerCase())) {
        score += 0.4;
      }

      // Scope filtering
      if (scope) {
        // TODO: check if node bounds overlap with scope bounds
      }
      // App filtering
      if (app && windowTitle) {
        // TODO: check if node belongs to the right app window
      }

      // Location hint disambiguation
      if (locationHint) {
        // TODO: use location to prefer among siblings
      }

      return { node, score, matchStrategy: determineMatchStrategy(node, target) };
    });

    // Filter duplicates ( same name+type with similar scores )
    const byNameType = new Map<string, Win32UiaMatchResult[]>();
    for (const s of scored) {
      const key = `${s.node.controlType}:${s.node.name}`;
      if (!byNameType.has(key)) byNameType.set(key, []);
      byNameType.get(key)!.push(s);
    }
    // Reject if multiple same-name candidates
    if ([...byNameType.values()].some(v => v.length > 1)) {
      return undefined; // ambiguous
    }
    // Return best match if score exceeds threshold
    const best = scored[0];
    if (best.score < 0.6) return undefined; // too ambiguous
    return best;
  }
  ```
- **Match strategy detection**
  ```typescript
  function determineMatchStrategy(
    node: Win32UiaTreeNode,
    target: string,
  ): Win32UiaMatchResult["matchStrategy"] {
    // Exact name → "name"
    if (node.name.toLowerCase().trim() === target.toLowerCase().trim()) return "name";
    // automationId → "automationId"
    if (node.automationId && target.toLowerCase().includes(node.automationId.toLowerCase())) {
      return "automationId";
    // Partial name → "name+controlType"
    return "name+controlType";
  }
  ```
- **Provider wiring** — `Win32UiaGroundingProvider` wraps existing screenshot provider
  ```typescript
  export class Win32UiaGroundingProvider implements GuiGroundingProvider {
    private readonly fallbackProvider: GuiGroundingProvider;
    private readonly helperPath: string;

    constructor(options: {
      fallbackProvider: GuiGroundingProvider;
      helperPath: string;
    }) {
      this.fallbackProvider = options.fallbackProvider;
      this.helperPath = options.helperPath;
    }

    async ground(params: GuiGroundingRequest): Promise<GuiGroundingResult | undefined> {
      // 1. Try UIA matching (Win32 only)
      if (process.platform === "win32") {
        const uiaResult = await this.tryUiaGrounding(params);
        if (uiaResult) return uiaResult;
      }

      // 2. Fall back to screenshot provider
      return this.fallbackProvider.ground(params);
    }
  }
  ```

- **Provider instantiation** - in `gui-tools.ts`
  ```typescript
  // In createDefaultGuiRuntime() or createGuiRuntime():
  if (process.platform === "win32" && groundingProvider) {
    const helperPath = await resolveWin32Helper();
    const uiaProvider = new Win32UiaGroundingProvider({
      fallbackProvider: groundingProvider,
      helperPath,
    });
    runtime = new ComputerUseGuiRuntime({
      groundingProvider: uiaProvider,
      // ...other options
    });
  }
  ```

- **Integration point** - `runtime.ts::groundTarget()` unchanged
  - The provider is called via `this.groundingProvider`
  - The provider decides whether to use UIA or screenshot
  - `runtime.ts` does not need to know about UIA at all
- Clean separation of concerns

  - UIA logic isolated in the provider (tools layer)
  - Runtime unchanged beyond provider wiring
  - Screenshot provider unchanged

  - `GuiGroundingProvider` interface unchanged
- **Data flow**:
  ```
  runtime.ts: groundTarget()
    → this.groundingProvider.ground(request)
      → [Win32UiaGroundingProvider]
        → tryUiaGrounding(request)
          → getUiaTree({ helperPath, app, windowTitle })
          → flattenUiaTree(root)
          → findBestUiaMatch(candidates, target, scope, app, windowTitle, locationHint)
          → if (high-confidence match)
              → return uiaMatchToGroundingResult(match, "display_pixels")
          → else
              → return this.fallbackProvider.ground(request)
  ```

- **Latency budget**:
  - UIA tree fetch: 50-200ms (acceptable for Win32 GUI automation)
  - Total UIA matching: <10ms (pure string comparison)
  - Screenshot fallback: same latency as current behavior when UIA misses
  - Expected: most named controls resolved in <100ms total, icon-only/ambiguous controls fallback to ~2-3s screenshot flow

- **Scope of changes**:
  - New files: `uia-grounding-provider.ts`, `uia-target-matcher.ts` in `packages/tools/src/`
  - Modified: `uia_tree.cpp` (field names), `gui-tools.ts` (provider wiring)
  - Tests: `uia-target-matcher.test.ts`, `uia-grounding-provider.test.ts`

- **NOT changed**:
  - `runtime.ts` action logic
  - `response-grounding-provider.ts` (screenshot provider)
  - `openai-grounding-provider.ts` (OpenAI provider)
  - `types.ts` (interfaces)

  - `win32-native-helper.ts` (Win32UiaTreeNode interface, already correct)
