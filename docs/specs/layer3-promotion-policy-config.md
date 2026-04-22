# Layer 3 Promotion Policy Configuration

> **Status:** Draft
> **Priority:** P1 — Quick Win (1-2 days)
> **Layer:** 3 (Crystallized Memory)
> **Target:** `main` branch
> **Blocks:** Layer 4 route upgrading (promotion thresholds are prerequisites for route upgrade decisions)

---

## 1. Problem

Workflow crystallization (Layer 3) has 7 configurable thresholds defined in `WorkflowCrystallizationRuntimeOptions` (gateway/session-types.ts:163-171). These thresholds control when segmentation, clustering, and skill promotion happen.

**The gap:** These options are never passed from the CLI entry point to the gateway runtime. At `apps/cli/src/commands/gateway.ts:2948`, `createGatewaySessionRuntime()` is called without `workflowCrystallization`, so it defaults to `{}` (session-runtime.ts:518). All thresholds fall back to hardcoded defaults.

**Result:** Users cannot tune crystallization behavior without editing source code.

## 2. Goal

Wire the existing `WorkflowCrystallizationRuntimeOptions` through the configuration system so that users can override crystallization thresholds via:

1. **Config file** (`~/.understudy/config.json5`) — primary path
2. **Environment variables** (`UNDERSTUDY_WORKFLOW_*`) — for CI/test overrides
3. **CLI flags** (`--crystallization-min-promotion`, etc.) — for one-off overrides

No algorithm changes. No new thresholds. Just plumbing existing options through to the runtime.

## 3. Current State (Evidence)

### 3.1 Options Interface (exists, unused at entry)

**File:** `packages/gateway/src/session-types.ts:163-171`

```typescript
export interface WorkflowCrystallizationRuntimeOptions {
    minTurnsForSegmentation?: number;
    segmentationReanalyzeDelta?: number;
    minEpisodesForClustering?: number;
    minClusterOccurrencesForPromotion?: number;
    maxClusteringEpisodes?: number;
    maxPromotedWorkflowCandidates?: number;
    maxSynthesisEpisodeExamples?: number;
}
```

### 3.2 Threshold Consumption (exists, reads from options)

**File:** `packages/gateway/src/workflow-crystallization.ts:101-108`

```typescript
const MIN_TURNS_FOR_WORKFLOW_SEGMENTATION =
    Math.max(1, Math.floor(workflowCrystallizationOptions.minTurnsForSegmentation ?? 2));
const WORKFLOW_SEGMENTATION_REANALYZE_DELTA =
    Math.max(1, Math.floor(workflowCrystallizationOptions.segmentationReanalyzeDelta ?? 3));
const MIN_EPISODES_FOR_WORKFLOW_CLUSTERING =
    Math.max(1, Math.floor(workflowCrystallizationOptions.minEpisodesForClustering ?? 2));
const MIN_CLUSTER_OCCURRENCES_FOR_PROMOTION =
    Math.max(1, Math.floor(workflowCrystallizationOptions.minClusterOccurrencesForPromotion ?? 3));
const MAX_CLUSTERING_EPISODES =
    Math.max(1, Math.floor(workflowCrystallizationOptions.maxClusteringEpisodes ?? 80));
const MAX_PROMOTED_WORKFLOW_CANDIDATES =
    Math.max(1, Math.floor(workflowCrystallizationOptions.maxPromotedWorkflowCandidates ?? 5));
const MAX_SYNTHESIS_EPISODE_EXAMPLES =
    Math.max(1, Math.floor(workflowCrystallizationOptions.maxSynthesisEpisodeExamples ?? 6));
```

### 3.3 Pipeline Wiring (exists, receives options)

**File:** `packages/gateway/src/session-runtime.ts:518,757-764`

```typescript
// Line 518: destructured from params, defaults to {}
workflowCrystallization: workflowCrystallizationOptions = {},

// Line 757-764: passed to pipeline
const workflowCrystallizationPipeline = createWorkflowCrystallizationPipeline({
    createScopedSession,
    promptSession,
    abortSessionEntry,
    runSerializedSessionTurn,
    notifyUser,
    runtimeLearningDir,
    workflowCrystallizationOptions,  // <-- options flow here
    refreshPublishedSkillPrompts,
});
```

### 3.4 Entry Point (MISSING — the gap)

**File:** `apps/cli/src/commands/gateway.ts:2948-3020`

```typescript
sessionRuntime = createGatewaySessionRuntime({
    sessionEntries,
    inFlightSessionIds,
    config,
    usageTracker,
    estimateTokens,
    appendHistory,
    // ... other params ...
    notifyUser: async ({ ... }) => { ... },
    // ❌ workflowCrystallization is NOT passed
    //    → defaults to {} in session-runtime.ts:518
    //    → all thresholds use hardcoded fallbacks
} as any);
```

## 4. Specification

### 4.1 Config Type Extension

**File:** `packages/types/src/config.ts`

Add `WorkflowCrystallizationConfig` interface and add it to `GatewayConfig`:

```typescript
/** Workflow crystallization (Layer 3) configuration */
export interface WorkflowCrystallizationConfig {
    /** Minimum turns in a day before segmentation is attempted (default: 2) */
    minTurnsForSegmentation?: number;
    /** Turn delta before re-analyzing a day's segments (default: 3) */
    segmentationReanalyzeDelta?: number;
    /** Minimum episodes before clustering is attempted (default: 2) */
    minEpisodesForClustering?: number;
    /** Complete episodes in a cluster required for promotion (default: 3) */
    minClusterOccurrencesForPromotion?: number;
    /** Maximum episodes fed into clustering (default: 80) */
    maxClusteringEpisodes?: number;
    /** Maximum clusters promoted per analysis cycle (default: 5) */
    maxPromotedWorkflowCandidates?: number;
    /** Maximum episodes used in synthesis prompt (default: 6) */
    maxSynthesisEpisodeExamples?: number;
}
```

Add to `GatewayConfig`:

```typescript
export interface GatewayConfig {
    // ... existing fields ...
    /** Workflow crystallization thresholds (Layer 3) */
    workflowCrystallization?: WorkflowCrystallizationConfig;
}
```

### 4.2 Config Schema Extension

**File:** `packages/core/src/config-schema.ts`

Add validation schema for the new `workflowCrystallization` field under `GatewayConfigSchema`. Each field should be:
- Type: `number`
- Optional: `true`
- Validate: positive integer (or use `z.number().int().positive().optional()`)

### 4.3 Config Defaults

**File:** `packages/types/src/config.ts` (in `DEFAULT_CONFIG`)

No change needed. `workflowCrystallization` is optional; undefined means "use hardcoded defaults in workflow-crystallization.ts". This preserves backward compatibility.

### 4.4 CLI Entry Point Wiring

**File:** `apps/cli/src/commands/gateway.ts`

At line 2948, add `workflowCrystallization` to the `createGatewaySessionRuntime` call:

```typescript
sessionRuntime = createGatewaySessionRuntime({
    // ... existing params ...
    notifyUser: async ({ ... }) => { ... },
    workflowCrystallization: config.gateway?.workflowCrystallization ?? {},
} as any);
```

### 4.5 Environment Variable Support

**File:** `packages/gateway/src/session-runtime.ts` or a new helper

Add a function that reads `UNDERSTUDY_WORKFLOW_*` env vars and merges them with config:

```typescript
function resolveWorkflowCrystallizationOptions(
    configOptions?: WorkflowCrystallizationConfig,
): WorkflowCrystallizationRuntimeOptions {
    return {
        minTurnsForSegmentation:
            parseEnvInt("UNDERSTUDY_WORKFLOW_MIN_TURNS") ?? configOptions?.minTurnsForSegmentation,
        segmentationReanalyzeDelta:
            parseEnvInt("UNDERSTUDY_WORKFLOW_REANALYZE_DELTA") ?? configOptions?.segmentationReanalyzeDelta,
        minEpisodesForClustering:
            parseEnvInt("UNDERSTUDY_WORKFLOW_MIN_EPISODES") ?? configOptions?.minEpisodesForClustering,
        minClusterOccurrencesForPromotion:
            parseEnvInt("UNDERSTUDY_WORKFLOW_MIN_PROMOTION") ?? configOptions?.minClusterOccurrencesForPromotion,
        maxClusteringEpisodes:
            parseEnvInt("UNDERSTUDY_WORKFLOW_MAX_CLUSTERING") ?? configOptions?.maxClusteringEpisodes,
        maxPromotedWorkflowCandidates:
            parseEnvInt("UNDERSTUDY_WORKFLOW_MAX_CANDIDATES") ?? configOptions?.maxPromotedWorkflowCandidates,
        maxSynthesisEpisodeExamples:
            parseEnvInt("UNDERSTUDY_WORKFLOW_MAX_SYNTHESIS") ?? configOptions?.maxSynthesisEpisodeExamples,
    };
}

function parseEnvInt(name: string): number | undefined {
    const val = process.env[name];
    if (val == null) return undefined;
    const parsed = parseInt(val, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
```

**Priority order:** CLI flag > env var > config file > hardcoded default

### 4.6 CLI Flags (Optional, Low Priority)

**File:** `apps/cli/src/commands/gateway.ts`

Add flags to the `GatewayOptions` interface and Commander registration:

```
--crystallization-min-promotion <n>   Min cluster occurrences for promotion (default: 3)
--crystallization-min-episodes <n>    Min episodes for clustering (default: 2)
--crystallization-min-turns <n>       Min turns for segmentation (default: 2)
```

Only expose the 3 most user-facing thresholds as CLI flags. The remaining 4 (reanalyzeDelta, maxClusteringEpisodes, maxPromotedCandidates, maxSynthesisExamples) are advanced and should be config-file-only.

## 5. Threshold Reference

| Constant | Default | Controls | Config Key | Env Var |
|----------|---------|----------|------------|---------|
| `MIN_TURNS_FOR_WORKFLOW_SEGMENTATION` | 2 | Minimum turns before segmentation | `minTurnsForSegmentation` | `UNDERSTUDY_WORKFLOW_MIN_TURNS` |
| `WORKFLOW_SEGMENTATION_REANALYZE_DELTA` | 3 | Re-segmentation cadence | `segmentationReanalyzeDelta` | `UNDERSTUDY_WORKFLOW_REANALYZE_DELTA` |
| `MIN_EPISODES_FOR_WORKFLOW_CLUSTERING` | 2 | Minimum episodes for clustering | `minEpisodesForClustering` | `UNDERSTUDY_WORKFLOW_MIN_EPISODES` |
| `MIN_CLUSTER_OCCURRENCES_FOR_PROMOTION` | 3 | Promotion eligibility threshold | `minClusterOccurrencesForPromotion` | `UNDERSTUDY_WORKFLOW_MIN_PROMOTION` |
| `MAX_CLUSTERING_EPISODES` | 80 | Clustering input cap | `maxClusteringEpisodes` | `UNDERSTUDY_WORKFLOW_MAX_CLUSTERING` |
| `MAX_PROMOTED_WORKFLOW_CANDIDATES` | 5 | Max promoted clusters per cycle | `maxPromotedWorkflowCandidates` | `UNDERSTUDY_WORKFLOW_MAX_CANDIDATES` |
| `MAX_SYNTHESIS_EPISODE_EXAMPLES` | 6 | Episode examples in synthesis | `maxSynthesisEpisodeExamples` | `UNDERSTUDY_WORKFLOW_MAX_SYNTHESIS` |

## 6. Files to Change

| File | Change | Scope |
|------|--------|-------|
| `packages/types/src/config.ts` | Add `WorkflowCrystallizationConfig` interface, add field to `GatewayConfig` | Types only |
| `packages/core/src/config-schema.ts` | Add validation schema for `workflowCrystallization` under gateway | Validation |
| `apps/cli/src/commands/gateway.ts` | Pass `config.gateway?.workflowCrystallization` to `createGatewaySessionRuntime`; add optional CLI flags | Wiring |
| `packages/gateway/src/session-runtime.ts` | Add `resolveWorkflowCrystallizationOptions()` helper for env var merging | Resolution |
| Test files (new/updated) | See Section 7 | Tests |

**No changes to:** `packages/gateway/src/workflow-crystallization.ts` (it already reads from the options correctly).

## 7. Test Plan

### 7.1 Unit Tests

**File:** `packages/core/src/__tests__/config-schema.test.ts` (or co-located)

1. **Config validation:** Assert that `config.gateway.workflowCrystallization` accepts valid partial overrides and rejects non-integer/negative values.
2. **Config defaults:** Assert that omitting `workflowCrystallization` produces undefined (falls through to runtime defaults).

**File:** `packages/gateway/src/__tests__/session-runtime.test.ts` (existing, extend)

3. **Option propagation:** Mock `createWorkflowCrystallizationPipeline`, create a session runtime with custom `workflowCrystallization` options, verify the pipeline receives them.
4. **Env var override:** Set `UNDERSTUDY_WORKFLOW_MIN_PROMOTION=5`, verify it overrides config value.
5. **Priority order:** Set both env var and config, verify env var wins.

### 7.2 Integration Tests

**File:** New `packages/gateway/src/__tests__/workflow-crystallization-config.test.ts`

6. **End-to-end threshold effect:** Create a crystallization pipeline with `minClusterOccurrencesForPromotion=2`, simulate 2 complete episodes in a cluster, verify promotion happens. Then test with `minClusterOccurrencesForPromotion=5` and verify it does NOT promote with only 2 episodes.
7. **Boundary validation:** Test that `Math.max(1, ...)` clamping works for edge cases (0, -1, NaN).

### 7.3 Existing Tests (Regression)

8. Run existing `session-runtime.test.ts` crystallization test suite — must pass unchanged (defaults preserved).
9. Run `gateway-workflow-crystallization.real.test.ts` — must pass unchanged.

## 8. Acceptance Criteria

- [ ] `config.json5` accepts `gateway.workflowCrystallization` with any subset of the 7 threshold fields
- [ ] Invalid values (negative, zero, non-integer) are rejected by config schema validation
- [ ] `createGatewaySessionRuntime` receives `workflowCrystallization` from config
- [ ] Environment variables override config file values
- [ ] Omitting all overrides preserves current hardcoded defaults (backward compatible)
- [ ] Existing crystallization tests pass without modification
- [ ] New tests cover: config validation, option propagation, env var override, threshold effect
- [ ] `pnpm check` passes (build + lint + typecheck + test)

## 9. Out of Scope

- **No algorithm changes** to segmentation, clustering, or synthesis
- **No new thresholds** — only plumbing existing ones
- **No `timeoutMs` exposure** — the `WORKFLOW_CRYSTALLIZATION_TIMEOUT_MS` (90s) is an internal implementation detail, not a promotion threshold
- **No Layer 4/Layer 5 changes** — this is purely Layer 3 configuration
- **No UI changes** — config file is the primary interface; Dashboard integration is a separate task
- **No Stage 0→4 progression tracking** — that's a separate feature

## 10. Migration / Backward Compatibility

- Fully backward compatible: `workflowCrystallization` is optional in both config and runtime
- No config migration needed: existing `config.json5` files without the field continue to work
- No API changes: `CreateGatewaySessionRuntimeParams.workflowCrystallization` is already optional

## 11. Future Considerations

After this is wired:

1. **Dashboard integration** — expose thresholds in the Control UI settings panel
2. **Per-skill overrides** — allow individual crystallized skills to override global thresholds
3. **Adaptive thresholds** — auto-tune based on workspace size and episode quality (Layer 4 territory)
4. **Stage 0→4 progression** — implement the 5-stage model from Product Design with configurable progression criteria
