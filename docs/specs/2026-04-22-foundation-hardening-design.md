# Foundation Hardening Design

> **Date:** 2026-04-22
> **Status:** Draft
> **Priority:** P0
> **Layer:** Cross-cutting (Layer 3 / Layer 4 enablement)
> **Target:** `main`
> **Blocks:** Week 2-4 roadmap work
> **Related:** [layer3-promotion-policy-config.md](./layer3-promotion-policy-config.md)

---

## 1. Problem

The next roadmap slice is blocked by three practical issues:

1. **Crystallization thresholds are not fully tunable at the entry point.**
   The runtime already has `WorkflowCrystallizationRuntimeOptions`, but users still cannot reliably tune the behavior from supported configuration surfaces.
2. **The local webchat verification helper is more brittle than it should be.**
   `scripts/verify-webchat-output.mjs` reconstructs a baseline module from TypeScript source text and a historical Git commit. That is useful, but the current approach relies on ad hoc source rewriting rather than a formal transform step.
3. **The largest test files are now the main refactor tax.**
   Production modules have been decomposed aggressively, but the biggest test files still concentrate unrelated behavior into a handful of monoliths.

None of these tasks are glamorous, but without them Week 2-4 work will either drift or slow down.

## 2. Goal

End Week 1 with a stable base layer that makes the rest of the roadmap cheaper to implement:

- workflow crystallization behavior can be tuned through supported config/runtime surfaces
- the webchat verification helper is deterministic and repo-location-safe
- the top test monoliths are split into maintainable suites without behavior changes

## 3. Current State (Evidence)

### 3.1 Crystallization options exist, but entry-point plumbing is incomplete

- `packages/gateway/src/session-types.ts` already defines `WorkflowCrystallizationRuntimeOptions`
- `packages/gateway/src/workflow-crystallization.ts` already consumes those values
- `docs/specs/layer3-promotion-policy-config.md` already documents the missing wiring and is the normative spec for this subtask

### 3.2 The webchat verifier reconstructs a baseline module from raw source text

`[scripts/verify-webchat-output.mjs](/mnt/c/Users/kkach/workspace/understudy_win+cheap/scripts/verify-webchat-output.mjs)` currently:

- reads a historical baseline source blob via `git show`
- rewrites import paths
- strips a TypeScript return type with string replacement
- writes a temporary `.mjs` file and imports it dynamically

That works, but it is intentionally narrow and brittle.

### 3.3 The test bottleneck is concentrated in a few files

Largest test files today:

- `packages/gateway/src/__tests__/session-runtime.test.ts` - 3066 LOC
- `packages/gui/src/__tests__/runtime.real.test.ts` - 2862 LOC
- `packages/gui/src/__tests__/runtime.test.ts` - 2037 LOC
- `packages/gateway/src/__tests__/server.test.ts` - 1850 LOC

These files are large enough to hide fixture drift, duplicate setup, and unrelated regressions.

## 4. Specification

### 4.1 Crystallization Config Plumbing

This subtask is already specified in [layer3-promotion-policy-config.md](./layer3-promotion-policy-config.md).

For Week 1, that document is the source of truth. The implementation must land at least:

1. config-file support
2. environment-variable support
3. gateway runtime wiring

CLI flags are optional for Week 1, but config and env support are not optional.

### 4.2 Webchat Verification Hardening

#### 4.2.1 Replace regex-only TypeScript stripping with a real transform step

The baseline verifier should stop depending on a single string replacement for TypeScript syntax.

Instead:

1. Read the baseline source from Git as today.
2. Rewrite its relative imports as today.
3. Run the resulting source through `esbuild.transform()` with `loader: "ts"` and `format: "esm"`.
4. Import the emitted JavaScript from the temporary module path.

This keeps the historical baseline workflow intact while making the helper resilient to future TypeScript syntax changes.

#### 4.2.2 Centralize repo-root and build-artifact resolution

All path resolution for the verifier should flow through one helper module, derived from `import.meta.url`.

The hardened helper must:

- never rely on the caller's `process.cwd()`
- resolve repo-local file URLs from the script location
- fail early with a clear error if required `packages/gateway/dist/*` files are missing

#### 4.2.3 Keep the helper local-only and explicit

The script remains a developer helper, not a production runtime dependency.

That means:

- writing temporary artifacts to the system temp dir is still acceptable
- comparing exact HTML output is still acceptable
- requiring a built `packages/gateway/dist` before verification is acceptable

The goal is reliability, not abstraction for its own sake.

### 4.3 Test Decomposition Plan

Week 1 does not need to split every large test file. It should split the highest-cost ones first.

#### 4.3.1 Gateway session runtime tests

Split `packages/gateway/src/__tests__/session-runtime.test.ts` into focused suites, for example:

- `session-runtime.history.test.ts`
- `session-runtime.tracing.test.ts`
- `session-runtime.branching.test.ts`
- `session-runtime.teach.test.ts`
- `session-runtime.playbook.test.ts`

Shared setup and test data should move into helpers under:

- `packages/gateway/src/__tests__/helpers/`

#### 4.3.2 GUI runtime real tests

Split `packages/gui/src/__tests__/runtime.real.test.ts` by scenario surface, not by assertion style. For example:

- browser-grounding flows
- native app navigation flows
- text-entry and hotkey flows
- real grounding benchmarks or optional cases

The important point is that each file should describe one real-user story.

#### 4.3.3 Gateway server tests

Split `packages/gateway/src/__tests__/server.test.ts` into HTTP/RPC concerns:

- auth and rate limiting
- session endpoints
- control UI / webchat serving
- websocket behavior

#### 4.3.4 First pass is mechanical extraction

Week 1 is not the moment to redesign assertions.

The first-pass decomposition should:

- preserve existing test semantics
- extract common fixtures and builders
- remove setup duplication
- keep snapshots and golden outputs stable

Behavioral improvements can happen later after the suites are separated.

## 5. Files To Change

Expected Week 1 write scope:

- `apps/cli/src/commands/gateway.ts`
- `packages/types/src/config.ts`
- `packages/core/src/config-schema.ts`
- `packages/gateway/src/session-types.ts`
- `packages/gateway/src/session-runtime.ts`
- `scripts/verify-webchat-output.mjs`
- `scripts/webchat-baseline-utils.mjs`
- selected files under `packages/gateway/src/__tests__/`
- selected files under `packages/gui/src/__tests__/`

## 6. Acceptance Criteria

Week 1 is complete only if all of the following are true:

1. `workflowCrystallization` can be controlled from supported config/env surfaces without source edits.
2. `node scripts/verify-webchat-output.mjs` no longer depends on regex-only TypeScript stripping.
3. The verifier resolves repo-local paths from script location, not shell cwd.
4. The largest test monoliths are reduced by splitting at least the first gateway and GUI suites into focused files.
5. CI behavior is unchanged apart from the intended hardening.

## 7. Non-Goals

Week 1 should not broaden into feature work.

Out of scope:

- route guard behavior changes
- route promotion logic
- passive observation / Layer 5 work
- Linux AT-SPI

This week is about reducing implementation friction for the remaining roadmap.
