# 4-Week Layer 3/4 Delivery Spec Index

> **Date:** 2026-04-22
> **Status:** Draft
> **Scope:** 4-week execution plan for Layer 3 / Layer 4
> **Target:** `main`
> **Outcome Window:** 2026-04-22 -> 2026-05-19

---

## 1. Why This Exists

The project has a clear roadmap, but the next 4 weeks need implementation-grade specifications.

The immediate objective is not "start Layer 5 broadly." It is to make the existing Layer 3 and Layer 4 surfaces production-shaped:

1. Workflow crystallization must be tunable without source edits.
2. Workflow promotion must be explainable and deterministic.
3. Route guard must be stable enough to run by default.
4. Known faster routes must be promotable only after verification, with immediate rollback on failure.

This index turns that roadmap into linked specs that can be implemented in order.

## 2. Delivery Goal By 2026-05-19

By the end of this 4-week window, the repository should support the following baseline:

- Crystallization thresholds are configurable via config and runtime overrides.
- Promotion decisions are rule-first, auditable, and reproducible.
- Route guard is a real built-in runtime policy, not an inert placeholder.
- Crystallized skills can upgrade to already-known faster routes after repeated verified success.
- Any promoted route can fall back immediately after a verified failure.

## 3. Week-by-Week Spec Map

### Week 1: Foundation Hardening

- **Primary doc:** [2026-04-22-foundation-hardening-design.md](./2026-04-22-foundation-hardening-design.md)
- **Normative sub-spec:** [layer3-promotion-policy-config.md](./layer3-promotion-policy-config.md)
- **Focus:** unblock the rest of the roadmap by fixing configurability, local verification reliability, and test maintainability.

### Week 2: Rule-First Promotion Engine

- **Spec:** [2026-04-22-rule-first-promotion-engine-design.md](./2026-04-22-rule-first-promotion-engine-design.md)
- **Focus:** make promotion eligibility deterministic even if segmentation, clustering, and synthesis remain LLM-assisted.

### Week 3: Route Guard Stabilization

- **Spec:** [2026-04-22-route-guard-stabilization-design.md](./2026-04-22-route-guard-stabilization-design.md)
- **Focus:** ship `route_retry_guard` as a real built-in policy with configurable thresholds and safe default behavior.

### Week 4: Verified Route Promotion And Rollback

- **Spec:** [2026-04-22-verified-route-promotion-and-rollback-design.md](./2026-04-22-verified-route-promotion-and-rollback-design.md)
- **Focus:** promote only already-known faster routes after repeated verified success, then demote immediately on failure.

## 4. Cross-Week Dependency Chain

1. **Week 1 blocks everything else.**
   `workflowCrystallization` must be configurable before the promotion engine can be tuned in practice.
2. **Week 2 blocks Week 4.**
   Verified route promotion depends on a stable, deterministic promotion gate.
3. **Week 3 reduces Week 4 risk.**
   Route guard prevents the system from stubbornly reusing a broken route while verified promotion is being introduced.

## 5. Success Metrics

At the end of this roadmap slice, the repo should meet these concrete checks:

- At least one crystallized workflow can be tuned through config/env without source edits.
- Promotion decisions persist their rule inputs and blocking reasons in the ledger.
- `route_retry_guard` is present in the default runtime policy list and produces real prompt guidance after repeated failures.
- At least one already-known faster route can move from observed/candidate to preferred/promoted after verified runs.
- A promoted route can be rolled back after a later verified failure.

## 6. Explicitly Out Of Scope

These items remain valid roadmap targets, but are not part of this 4-week spec set:

- Linux AT-SPI implementation
- New channel adapters
- Full automatic route discovery across unknown APIs or CLIs
- Passive observation / proactive suggestion engine
- Full Layer 5 isolated workspace implementation

If time remains after Week 4, the next artifact should be a separate design spike for Layer 5 isolated workspace, not an opportunistic partial implementation.
