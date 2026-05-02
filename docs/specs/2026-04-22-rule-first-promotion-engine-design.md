# Rule-First Promotion Engine Design

> **Date:** 2026-04-22
> **Status:** Draft
> **Priority:** P1
> **Layer:** 3 (Crystallized Memory)
> **Target:** `main`
> **Depends On:** Week 1 foundation hardening
> **Blocks:** verified route promotion in Week 4

---

## 1. Problem

The current crystallization pipeline is already strong at:

- collecting compact turn records
- segmenting work
- summarizing episodes
- clustering repeated workflow families
- synthesizing reusable skills

But the **promotion decision itself is still too thin**.

Today, the main durable gate is effectively:

- cluster complete count >= `MIN_CLUSTER_OCCURRENCES_FOR_PROMOTION`

That is not enough for a system that wants to explain why a workflow was promoted.

Specifically, the current flow does not persist:

- why a cluster was promoted
- why a cluster was held back
- which rules were satisfied
- which rules blocked promotion

If Layer 4 later upgrades routes on top of crystallized skills, Layer 3 promotion must be more deterministic first.

## 2. Goal

Make promotion **rule-first and auditable** without trying to remove LLM usage from segmentation, clustering, or synthesis.

The intended boundary is:

- **LLM-assisted:** segmentation, episode summarization, clustering, skill synthesis
- **Rule-first:** promotion eligibility and publication decision

The same ledger state should produce the same promotion outcome every time.

## 3. Current State (Evidence)

### 3.1 Promotion currently hinges on complete-run count

`packages/gateway/src/workflow-crystallization.ts` synthesizes only when:

- successful episode count for the cluster meets `MIN_CLUSTER_OCCURRENCES_FOR_PROMOTION`

Later, promotable clusters are selected with:

- `cluster.completeCount >= MIN_CLUSTER_OCCURRENCES_FOR_PROMOTION`

This is useful, but still too coarse.

### 3.2 Cluster and skill records do not persist a promotion decision model

Current persisted shapes include:

- `WorkflowCrystallizationCluster`
- `WorkflowCrystallizationSkill`
- `WorkflowCrystallizationAnalysisState`

None of these carry a structured promotion evaluation record.

## 4. Specification

### 4.1 Add a persisted promotion decision record

Introduce a ledger-persisted record:

```ts
export interface WorkflowCrystallizationPromotionDecision {
  state: "candidate" | "promoted" | "held" | "rejected";
  evaluatedAt: number;
  metrics: {
    occurrenceCount: number;
    completeCount: number;
    partialCount: number;
    failedCount: number;
    distinctDayCount: number;
    completionRate: number;
    failureRate: number;
  };
  satisfiedRules: string[];
  blockingRules: string[];
  fingerprint: string;
}
```

Persist this on the cluster, not just the published skill, because promotion is a property of the observed workflow family before publication.

### 4.2 Add explicit promotion rules

Week 2 should convert promotion from a single threshold into a rule set.

Default MVP rules:

1. `completeCount >= minClusterOccurrencesForPromotion`
2. `distinctDayCount >= minDistinctDaysForPromotion` (default: 2)
3. `completionRate >= minCompletionRateForPromotion` (default: 0.6)
4. `failureRate <= maxFailureRateForPromotion` (default: 0.34)
5. cluster still has at least one valid episode after normalization

These rules are intentionally conservative. They are not trying to be "smart." They are trying to be reproducible.

### 4.3 Config surface

Week 1 only wires existing thresholds. Week 2 introduces new promotion-policy knobs:

```ts
export interface WorkflowCrystallizationRuntimeOptions {
  // existing fields...
  minDistinctDaysForPromotion?: number;
  minCompletionRateForPromotion?: number;
  maxFailureRateForPromotion?: number;
}
```

These should also be supported in the config schema after Week 1 plumbing exists.

### 4.4 Evaluation flow

Promotion flow should become:

1. cluster episodes
2. normalize cluster metrics
3. evaluate promotion rules deterministically
4. persist the decision on the cluster
5. only synthesize/publish for `state === "promoted"`

`held` and `rejected` are both useful:

- `held` means "not enough evidence yet"
- `rejected` means "evidence currently points against promotion"

For the MVP, use:

- `held` for insufficient volume or insufficient consistency
- `rejected` only for clearly unstable clusters with enough observations

### 4.5 Publication metadata

When a skill is published, carry the promotion evidence forward into the markdown metadata.

At minimum, publish:

- promotion state
- complete / partial / failed counts
- distinct day count
- evaluation timestamp

This makes the artifact easier to inspect during dogfooding.

### 4.6 Keep synthesis LLM-assisted

This spec does **not** attempt to replace the LLM synthesis step.

Week 2 only changes:

- whether the cluster is eligible for synthesis/publication
- how that eligibility is recorded

It does not change:

- segmentation prompt design
- clustering prompt design
- synthesis prompt design

## 5. Files To Change

Expected Week 2 write scope:

- `packages/core/src/workflow-crystallization.ts`
- `packages/gateway/src/workflow-crystallization.ts`
- `packages/gateway/src/session-types.ts`
- `packages/types/src/config.ts`
- `packages/core/src/config-schema.ts`
- `packages/core/src/__tests__/workflow-crystallization.test.ts`
- `packages/gateway/src/__tests__/session-runtime.test.ts`

## 6. Test Plan

Required coverage:

1. **Pure rule evaluator tests**
   Stable input metrics must always produce the same decision.
2. **Boundary tests**
   Values exactly on the threshold must behave predictably.
3. **Persistence tests**
   Promotion decisions must round-trip through the ledger JSON.
4. **Integration tests**
   A promotable cluster publishes; a held/rejected cluster does not.

## 7. Acceptance Criteria

Week 2 is complete only if:

1. promotion eligibility is no longer equivalent to one complete-count check
2. cluster promotion decisions persist blocking and satisfied rules
3. repeated runs on unchanged ledger state produce identical promotion decisions
4. published skills carry enough metadata to explain why they were promoted

## 8. Non-Goals

Not part of Week 2:

- automatic route discovery
- route promotion across unknown surfaces
- Layer 5 proactive behavior
- rewriting synthesized stage instructions to be fully rule-generated
