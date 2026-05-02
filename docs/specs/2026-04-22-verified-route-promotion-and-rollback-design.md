# Verified Route Promotion And Rollback Design

> **Date:** 2026-04-22
> **Status:** Draft
> **Priority:** P1
> **Layer:** 4 (Get Faster Over Time)
> **Target:** `main`
> **Depends On:** Week 2 rule-first promotion, Week 3 route guard stabilization

---

## 1. Problem

The product design already describes the desired Layer 4 loop:

1. discover a faster route
2. verify it
3. promote it
4. rollback on failure

The codebase is not there yet.

Current behavior is still mostly:

- prefer known higher-level routes in prompts
- preserve route annotations from teach/crystallization
- fall back when needed

That means route guidance exists, but route upgrading is still mostly static.

## 2. Goal

Ship a **conservative MVP** for route upgrading:

- only use **already-known routes**
- only promote after **repeated verified success**
- rollback on the **first verified failure**
- keep the entire process explainable in persisted state

This week is about safe promotion of known routes, not discovery of unknown ones.

## 3. MVP Boundary

To keep Week 4 realistic, the MVP intentionally narrows scope.

### 3.1 Known routes only

Only consider routes that already exist in the skill's guidance:

- crystallized skill `routeOptions`
- optionally taught-skill route metadata if a later phase expands the scope

Week 4 does **not** search the web, APIs, CLIs, or MCP surfaces for brand-new routes.

### 3.2 Pure-route runs only

Only runs with a clear dominant actionable route should count toward promotion.

For the MVP, a run is promotion-eligible only when its actionable tool trace is effectively one route family, ignoring neutral helper routes like:

- memory
- schedule
- session
- filesystem

Mixed browser+gui rescue runs remain observational, not promotable.

### 3.3 Skill-level preference updates only

Week 4 updates route preference ordering and related metadata.

It does **not**:

- resynthesize skill stages
- rewrite procedure semantics
- invent new route instructions

The MVP changes "which known route is preferred," not "what the skill means."

## 4. Current State (Evidence)

### 4.1 Crystallized skills already persist route guidance

`WorkflowCrystallizationSkill` already contains:

- `routeOptions`
- `observedStatusCounts`
- `successCriteria`
- `failurePolicy`

This is enough to support route promotion metadata without inventing a second artifact format.

### 4.2 Session traces already capture route usage

`SessionRunTrace.toolTrace` already stores route-tagged tool events.

That provides the raw runtime evidence needed to answer:

- which route was actually used
- whether the run stayed on one route family
- whether the promoted route later failed

### 4.3 There is no persisted verification state yet

No current ledger structure records:

- candidate route
- verified-success streak
- promoted-at timestamp
- rollback reason

Week 4 adds that missing state.

## 5. Specification

### 5.1 Add persisted route-verification state

Extend the crystallized skill record with route-upgrade metadata:

```ts
export interface WorkflowCrystallizationRouteVerificationState {
  route: TaughtTaskExecutionRoute;
  state: "observed" | "candidate" | "promoted" | "rolled_back";
  verifiedSuccessStreak: number;
  verifiedFailureCount: number;
  lastVerifiedAt?: number;
  lastVerifiedRunId?: string;
  promotedAt?: number;
  rolledBackAt?: number;
  rollbackReason?: string;
}
```

And on the skill:

```ts
routeVerification?: {
  currentPreferredRoute?: TaughtTaskExecutionRoute;
  previousPreferredRoute?: TaughtTaskExecutionRoute;
  routes: WorkflowCrystallizationRouteVerificationState[];
}
```

This must persist in the existing workflow-crystallization ledger, not in a separate sidecar store.

### 5.2 Candidate extraction

Add a deterministic helper that inspects a completed `SessionRunTrace` and decides whether a promotion candidate exists.

MVP algorithm:

1. collect actionable tool results
2. discard neutral helper routes
3. if actionable steps span more than one route family, return `undefined`
4. if the surviving route is not already present in the skill's `routeOptions`, return `undefined`
5. if the surviving route is not faster than the current preferred route, return `undefined`
6. otherwise, emit a candidate route

Priority order remains:

`skill > browser > shell > gui`

### 5.3 Verification step

Promotion must not rely on route usage alone.

Use a bounded internal verifier session to compare:

- the skill objective
- success criteria
- failure policy
- the completed run's route/tool trace
- the assistant's final reply / run summary

Verifier output:

```json
{
  "verified": true,
  "summary": "Run satisfied the skill success criteria using the browser route.",
  "reasons": ["success_criteria_met", "no_gui_fallback_used"]
}
```

The verifier may remain LLM-assisted. The **promotion decision** based on verifier results must remain rule-first.

### 5.4 Promotion rule

Recommended MVP defaults:

- promote after `2` consecutive verified successes on the faster known route
- require the route to be faster than the current preferred route
- require the run to be pure-route eligible

When promoted:

1. update `routeVerification.currentPreferredRoute`
2. demote the old preferred route to fallback
3. rewrite `routeOptions` ordering/preference fields
4. republish the crystallized skill markdown

### 5.5 Rollback rule

Rollback should be immediate and conservative.

If a promoted route later produces a verified failure:

1. mark the route state as `rolled_back`
2. restore the previous preferred route
3. reset the success streak for the failed promoted route
4. append a short rollback note to failure metadata
5. republish the skill with the restored preference order

No grace window. No partial demotion state for the MVP.

### 5.6 Publication behavior

Published skill markdown should expose the upgrade state in human-readable form.

At minimum include:

- current preferred route
- promoted route history
- verification streak or promoted-at metadata
- rollback note if the latest promoted route failed

This can live in metadata and/or a short "Route Guidance" augmentation.

## 6. Files To Change

Expected Week 4 write scope:

- `packages/core/src/workflow-crystallization.ts`
- `packages/gateway/src/workflow-crystallization.ts`
- `packages/gateway/src/session-runtime.ts`
- `packages/gateway/src/session-types.ts`
- `packages/types/src/config.ts`
- `packages/core/src/__tests__/workflow-crystallization.test.ts`
- `packages/gateway/src/__tests__/session-runtime.test.ts`

## 7. Test Plan

Required coverage:

1. candidate extraction ignores mixed-route rescue runs
2. candidate extraction accepts pure faster known routes
3. two consecutive verified successes promote the route
4. one verified failure after promotion rolls back immediately
5. route option ordering is republished correctly after promotion and rollback
6. persisted ledger state survives load/save round-trips

## 8. Acceptance Criteria

Week 4 is complete only if:

1. at least one known faster route can move from observed/candidate to promoted
2. promotion requires repeated verified success, not a single lucky run
3. a later verified failure restores the previous preferred route
4. the ledger explains when and why promotion or rollback happened

## 9. Non-Goals

Not part of Week 4:

- automatic discovery of unknown APIs or CLIs
- cross-app route mining across arbitrary tasks
- multi-stage route optimization inside every synthesized stage
- passive observation or other Layer 5 behavior
