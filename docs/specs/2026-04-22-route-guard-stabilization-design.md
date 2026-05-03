# Route Guard Stabilization Design

> **Date:** 2026-04-22
> **Status:** Draft
> **Priority:** P1
> **Layer:** 4 (Get Faster Over Time)
> **Target:** `main`
> **Depends On:** none
> **Supports:** Week 4 verified route promotion

---

## 1. Problem

The route guard policy exists in code, but it is not yet a real built-in runtime behavior.

Today:

- `createRouteRetryGuardPolicy()` exists
- there are direct policy tests
- the built-in policy registry entry for `route_retry_guard` returns `[]`
- default config does not include the module

So the project has a route guard implementation, but not an active route guard feature.

That is too weak for Layer 4. Before the system can promote faster routes, it must also be reliable at backing away from failing ones.

## 2. Goal

Promote `route_retry_guard` from "tested but inert" to a stable built-in runtime policy with safe defaults.

The key behavior remains intentionally conservative:

- **advisory, not hard-blocking**
- **failure-driven, not novelty-seeking**
- **route-level, not tool-name-level**

## 3. Current State (Evidence)

### 3.1 The policy implementation already exists

`packages/core/src/runtime/policies/route-guard-policy.ts` already:

- tracks repeated failures per route
- injects a prompt warning after repeated failures
- resets the state after a successful result on that route

### 3.2 The policy is not actually enabled through the built-in registry

`packages/core/src/runtime/policies/index.ts` currently registers:

```ts
route_retry_guard: () => [],
```

That means a configured module load produces no policy instance.

### 3.3 Default config does not opt in

`packages/types/src/config.ts` currently enables:

- `sanitize_tool_params`
- `normalize_tool_result`
- `strip_assistant_directive_tags`
- `guard_assistant_reply`

It does not include `route_retry_guard`.

## 4. Specification

### 4.1 Make the built-in module real

Change the built-in runtime policy factory so that:

```ts
route_retry_guard: ({ options }) => createRouteRetryGuardPolicy(options)
```

The policy must be constructible from config-provided module options.

### 4.2 Add explicit policy options

Extend `createRouteRetryGuardPolicy()` to accept options:

```ts
export interface RouteRetryGuardPolicyOptions {
  maxConsecutiveFailures?: number; // default 2
  maxReportedRoutes?: number;      // default 3
  guardedRoutes?: string[];        // default ["gui", "browser", "web", "shell", "process"]
}
```

No new top-level config type is required. These values can live in `RuntimePolicyModuleConfig.options`.

### 4.3 Enable it in default config

Add the module to `DEFAULT_CONFIG.agent.runtimePolicies.modules`.

Recommended default order:

1. `sanitize_tool_params`
2. `normalize_tool_result`
3. `route_retry_guard`
4. `strip_assistant_directive_tags`
5. `guard_assistant_reply`

It should run **after** tool result normalization so it sees consistent result shapes, and **before** assistant-reply cleanup.

### 4.4 Keep the guard advisory

Week 3 should not hard-block tool execution.

The guard should continue to:

- annotate the next prompt with route-level guidance
- preserve the model's ability to retry if it truly has new evidence

That is safer than inventing a runtime-level denial rule too early.

### 4.5 Improve observability

The stabilized version should emit at least lightweight observability:

- include the guarded route names in the injected prompt note
- expose the active policy name through normal policy-registry loading
- make module options visible in config-driven tests

Optional but recommended:

- include route-guard activation details in debug logging or trace metadata

### 4.6 Do not widen scope into route optimization

Week 3 is about retry discipline, not route promotion.

This policy should not:

- discover new routes
- rewrite preferred route order
- mutate published skills

Its job is to stop repeated blind retries from dominating a session.

## 5. Files To Change

Expected Week 3 write scope:

- `packages/core/src/runtime/policies/route-guard-policy.ts`
- `packages/core/src/runtime/policies/index.ts`
- `packages/types/src/config.ts`
- `packages/core/src/__tests__/route-retry-guard-policy.test.ts`
- `packages/core/src/__tests__/runtime-policy-registry.test.ts`
- `packages/core/src/__tests__/config.test.ts`

## 6. Test Plan

Required coverage:

1. registry builds the real policy when `route_retry_guard` is requested
2. default config includes the module
3. module options override defaults
4. repeated failures trigger prompt guidance
5. success clears the route state
6. non-guarded routes remain unaffected

## 7. Acceptance Criteria

Week 3 is complete only if:

1. `route_retry_guard` loads as a real built-in policy through the default registry
2. default config includes the module
3. the policy can be tuned through module options
4. repeated failures produce route guidance in ordinary sessions without breaking successful flows

## 8. Non-Goals

Not part of Week 3:

- hard route denial
- autonomous route discovery
- publication-time route rewriting
- Layer 5 autonomy surfaces
