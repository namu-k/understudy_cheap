# Handoff: 2026-04-23 — Layer 3/4 Spec Closure Decisions

**Branch:** `chore/post-pr8-script-cleanups`
**Commit:** `e6403e0`
**Date:** 2026-04-23
**Context:** `docs/specs/2026-04-22-*` 4-week roadmap spec review follow-up
**Focus:** prior review에서 implementation 전에 spec에서 먼저 닫아야 한다고 판단한 항목 `1, 2, 3, 5, 6`

---

## 1. Why This Handoff Exists

Layer 3/4 roadmap spec는 방향성과 분할은 좋다. 문제는 몇몇 항목이 아직 "구현 중에 정하면 될 것 같은 세부사항"처럼 남아 있다는 점이다.

이 다섯 항목은 그런 성격이 아니다. 모두 다음 중 하나에 직접 연결된다.

- persisted ledger state의 의미
- skill publication / hot-refresh의 일관성
- route promotion / rollback의 사용자 설명 가능성
- 운영 중 잘못된 승격, 잘못된 rollback, state churn

즉, 이 항목들은 코드를 먼저 짜고 나중에 맞출수록 비용이 커진다. spec에서 먼저 닫지 않으면 구현자는 각자 다른 암묵 규칙을 넣게 되고, 이후 migration, dedup, operator support 비용이 커진다.

---

## 2. Closure Set

원문 번호를 유지한다.

| 원문 번호 | 주제 | 왜 지금 닫아야 하나 |
|-----------|------|---------------------|
| 1 | Stable identity for cluster/skill state | 승격 이력과 route verification state의 durable key를 정하지 않으면 reclustering 시 state 유실 |
| 2 | Run-to-skill binding | 어떤 run이 어떤 crystallized skill의 증거인지 모르면 잘못된 skill을 승격/롤백 |
| 3 | Failure attribution for rollback | 환경 장애와 route 자체 문제를 구분하지 않으면 rollback flapping 발생 |
| 5 | Canonical faster-route definition | planner / verifier / promotion engine이 서로 다른 route order를 쓰면 일관된 promotion 불가 |
| 6 | Verified overlay vs re-synthesis precedence | verified promotion state가 다음 synthesis pass에서 덮어써질 위험 |

---

## 3. Decision 1 — Stable Identity

### Why This Must Be Closed In The Spec

현재 cluster ID는 LLM이 만든 title/objective/workflowFamilyHint 기반으로 계산된다.

- cluster ID 생성: [packages/gateway/src/workflow-crystallization.ts](/mnt/c/Users/kkach/workspace/understudy_win+cheap/packages/gateway/src/workflow-crystallization.ts:408)
- skill ID 생성: [packages/gateway/src/workflow-crystallization.ts](/mnt/c/Users/kkach/workspace/understudy_win+cheap/packages/gateway/src/workflow-crystallization.ts:659)

이 구조에서는 wording만 조금 바뀌어도 "같은 workflow인데 다른 cluster / 다른 skill"이 된다. Week 2의 promotionDecision, Week 4의 routeVerification을 이런 불안정한 ID에 붙이면 다음 문제가 생긴다.

- verified success streak 초기화
- route promotion history orphaning
- repo 안에 유사 crystallized skill 중복 생성
- rollback 대상 식별 실패
- operator가 보기에는 같은 workflow인데 ledger 상 다른 객체로 분기

이건 구현 중에 얼버무릴 수 있는 문제가 아니다. 어떤 ID가 durable state의 소유자인지 spec에서 못 박아야 한다.

### Recommended Closure

`clusterId`와 `skill.id`는 분석 스냅샷용 식별자로만 보고, long-lived state에는 별도의 durable identity를 도입한다.

권고안:

- `workflowFamilyId` 또는 `durableWorkflowId`를 도입한다.
- `clusterId`는 "이번 reclustering 결과"를 가리키는 ephemeral ID로 유지한다.
- publication, promotion decision history, route verification, rollback history, operator-facing references는 전부 durable ID에 붙인다.
- reclustering 단계에서 새 cluster를 기존 durable workflow에 연결하는 continuity rule을 먼저 수행한다.

### Continuity Rule Requirements

continuity rule은 LLM 판단이 아니라 deterministic merge rule이어야 한다.

최소 기준:

- normalized objective/title exact-or-close match
- parameter schema overlap
- source episode overlap
- existing published skill metadata match

이 네 기준을 점수화해서 threshold 이상이면 기존 durable workflow에 귀속시키고, 아니면 새 durable workflow를 만든다.

### Spec Text Draft

```md
`clusterId` is an analysis-snapshot identifier and MUST NOT be used as the durable key for
publication paths, promotion history, route verification state, rollback history, or
operator-facing references.

The pipeline MUST assign or reuse a durable `workflowFamilyId` before publication.
All long-lived Layer 3/4 state is keyed by `workflowFamilyId`, not `clusterId`.

Reclustering MUST run a deterministic continuity pass that maps new clusters onto existing
`workflowFamilyId` records before creating a new durable workflow identity.
```

---

## 4. Decision 2 — Run-To-Skill Binding

### Why This Must Be Closed In The Spec

Week 4는 completed run을 보고 route candidate를 추출하고 승격/롤백을 하려 한다. 그런데 현재 `SessionRunTrace`에는 어떤 crystallized skill이 실제로 선택되어 실행되었는지에 대한 durable reference가 없다.

- trace shape: [packages/gateway/src/session-types.ts](/mnt/c/Users/kkach/workspace/understudy_win+cheap/packages/gateway/src/session-types.ts:42)
- prompt refresh / skill loading path: [packages/gateway/src/session-runtime.ts](/mnt/c/Users/kkach/workspace/understudy_win+cheap/packages/gateway/src/session-runtime.ts:647)

지금 상태로는 다음 구현 유혹이 생긴다.

- prompt text에서 skill name 추론
- `responsePreview`에서 skill 사용 흔적 추론
- `skillPath` 문자열 매칭

이런 접근은 비슷한 workflow가 둘 이상 있는 workspace에서 바로 잘못된 승격으로 이어진다. 이건 telemetry bug가 아니라 memory corruption에 가깝다.

### Recommended Closure

skill selection 시점에 run trace에 explicit binding을 남긴다.

권고 shape:

```ts
boundSkill?: {
  workflowFamilyId: string;
  workflowSkillId: string;
  skillName: string;
  skillPath: string;
  artifactKind: "skill";
  selectionSource: "workspace_skill_prompt" | "explicit_tool_route" | "other";
  selectedAt: number;
}
```

MVP에서는 더 단순해도 된다. 핵심은 `workflowSkillId`와 durable workflow reference가 run trace에 남는 것이다.

### Eligibility Rule

Week 4 mutation 대상은 아래 경우로 제한해야 한다.

- 정확히 하나의 crystallized workflow skill이 run에 bound됨
- binding이 runtime에서 explicit하게 기록됨

아래 경우는 observation-only다.

- bound skill 없음
- 둘 이상 ambiguous
- taught skill / non-crystallized artifact

### Spec Text Draft

```md
A run is eligible for route verification only when it carries an explicit bound crystallized
workflow skill reference persisted in the run trace.

The runtime MUST record the selected `workflowSkillId` and `workflowFamilyId` at
skill-selection time.

If a run has no single bound crystallized workflow skill, it MAY contribute observational
telemetry but MUST NOT mutate route preference state.
```

---

## 5. Decision 3 — Failure Attribution For Rollback

### Why This Must Be Closed In The Spec

"first verified failure -> immediate rollback"은 문장으로는 명쾌하지만 운영에서는 너무 거칠다.

실제 실패의 많은 비율은 다음 원인이다.

- auth/session expiry
- 429 / rate limit
- upstream outage
- permission missing
- UI drift outside the route's real responsibility
- user-provided precondition missing

이걸 route 자체 실패와 구분하지 않으면, 시스템은 더 빠른 route를 환경 문제 때문에 잃는다. 그 결과 Layer 4는 빨라지기보다 점점 보수적으로만 된다.

이건 verifier가 임의로 판단하면 안 되고, spec에서 failure attribution taxonomy를 먼저 고정해야 한다.

### Recommended Closure

rollback 조건을 "verified failure"가 아니라 "route-attributable verified failure"로 좁힌다.

권고 verifier output:

```json
{
  "verified": true,
  "attribution": "route",
  "rollbackEligible": true,
  "summary": "...",
  "reasons": ["success_criteria_not_met", "route_specific_failure"]
}
```

권고 attribution set:

- `route`
- `precondition`
- `environment`
- `transient`
- `unknown`

권고 rollback rule:

- `route`만 immediate rollback
- `precondition`, `environment`, `transient`는 note만 남기고 rollback 금지
- `unknown`은 MVP에서는 rollback 금지 또는 2회 연속 후 rollback

### Spec Text Draft

```md
For Week 4 MVP, rollback is triggered only by a verifier-confirmed, route-attributable
failure under satisfied task preconditions.

Failures attributed to auth, permissions, upstream outage, rate limiting, missing
preconditions, or other environment/transient causes MUST NOT trigger rollback.

The verifier MUST emit both `attribution` and `rollbackEligible`, and the rollback rule
MUST key off those fields rather than generic run failure.
```

---

## 6. Decision 5 — Canonical Faster-Route Definition

### Why This Must Be Closed In The Spec

현재 문서와 runtime guidance는 route ordering에 대해 서로 다른 말을 하고 있다.

- Product Design route options: `skill -> browser -> shell -> gui`
  [docs/Product_Design.md](/mnt/c/Users/kkach/workspace/understudy_win+cheap/docs/Product_Design.md:170)
- Product Design tool routing: `API/CLI > browser > GUI`
  [docs/Product_Design.md](/mnt/c/Users/kkach/workspace/understudy_win+cheap/docs/Product_Design.md:329)
- System prompt: fixed waterfall이 아니라 cost/confidence 기반 peer tools
  [packages/core/src/system-prompt-sections.ts](/mnt/c/Users/kkach/workspace/understudy_win+cheap/packages/core/src/system-prompt-sections.ts:217)
- Week 4 spec: `skill > browser > shell > gui`
  [docs/specs/2026-04-22-verified-route-promotion-and-rollback-design.md](/mnt/c/Users/kkach/workspace/understudy_win+cheap/docs/specs/2026-04-22-verified-route-promotion-and-rollback-design.md:159)

게다가 trace taxonomy는 `web`을 기록하지만 `skill` route는 기록하지 않는다.

- tool route taxonomy: [packages/core/src/runtime/tool-execution-trace.ts](/mnt/c/Users/kkach/workspace/understudy_win+cheap/packages/core/src/runtime/tool-execution-trace.ts:6)

즉, Week 4는 지금 정의대로면 "비교 기준은 있는데 실제 관측 불가능한 route"를 포함한다. 이 상태에서는 planner, verifier, promotion engine이 서로 다른 route model을 쓸 수밖에 없다.

### Recommended Closure

Week 4 MVP의 promotable route domain을 현재 data model이 표현 가능하고 trace에서 관측 가능한 집합으로 좁힌다.

권고안:

- MVP promotable routes: `browser`, `shell`, `gui`
- `skill` route 자동 promotion: out of scope
- `web` route 자동 promotion: out of scope

이후 `skill`과 `web`을 자동 promotion에 넣으려면 먼저 shared taxonomy를 만들고 teach/crystallization/trace를 통합해야 한다.

### Canonical Rule

Week 4용 canonical comparison은 아래처럼 별도 명시하는 편이 안전하다.

- For promotion: `shell > browser > gui` 또는 `browser > shell > gui`
- 위 둘 중 하나를 Product/teach/spec/system prompt에 일관되게 맞춘다.

개인적 권고는 현재 runtime guidance와 실제 tool semantics를 생각하면 `shell or direct deterministic route > browser > gui`가 더 자연스럽다. 다만 MVP에서 `web`과 `skill`을 뺄 경우, 문서 전체에 한 번만 canonical order를 정의하고 그것을 재사용해야 한다.

### Spec Text Draft

```md
For Week 4 MVP, route promotion is limited to the route classes explicitly representable in
crystallized skill route metadata and reliably observable in run traces.

Therefore the promotable route set is `shell`, `browser`, and `gui` only.
`skill` and `web` routes are out of scope for automatic promotion until their metadata and
trace attribution are unified.

The canonical Week 4 faster-route order MUST be defined once and reused across the Week 4
spec, Product Design summary, teach guidance, and runtime prompt guidance.
```

---

## 7. Decision 6 — Verified Overlay Vs Re-Synthesis

### Why This Must Be Closed In The Spec

Week 4는 verified success를 통해 route를 승격하고 routeOptions를 재정렬하려 한다. 그런데 현재 synthesis path는 새 LLM payload로 `routeOptions`를 다시 만든다.

- routeOptions normalization: [packages/gateway/src/workflow-crystallization.ts](/mnt/c/Users/kkach/workspace/understudy_win+cheap/packages/gateway/src/workflow-crystallization.ts:676)
- existing skill에서 유지되는 것은 `publishedSkill` / `notification` 중심:
  [packages/gateway/src/workflow-crystallization.ts](/mnt/c/Users/kkach/workspace/understudy_win+cheap/packages/gateway/src/workflow-crystallization.ts:688)

즉, verified promotion state가 authoritative인지 아닌지를 닫지 않으면 다음 synthesis pass가 이를 덮어쓸 수 있다.

이 문제를 spec에서 미리 닫아야 하는 이유는 간단하다. 안 닫으면 아래 두 상태가 쉽게 어긋난다.

- ledger 상 `routeVerification.currentPreferredRoute`
- published SKILL.md 상 실제 `routeOptions`

이 불일치는 user explanation도, rollback logic도, hot-refresh도 모두 약하게 만든다.

### Recommended Closure

route data를 두 층으로 나눈다.

- `synthesizedRouteOptions`: LLM이 제안한 current candidate set
- `routeVerification`: deterministic verified overlay

published/effective `routeOptions`는 raw synthesis 결과가 아니라 merge 결과여야 한다.

권고 precedence:

1. `routeVerification.currentPreferredRoute` / rollback state가 preference ordering에 대해 authoritative
2. synthesis는 새 candidate route 추가 가능
3. synthesis는 instruction text refresh 가능
4. synthesis는 verified promoted/rolled-back ordering을 뒤집을 수 없음

추가 권고:

- verified history에 있는 route는 fresh synthesis output에 없더라도 즉시 삭제하지 말고 `fallback` 또는 dormant 상태로 유지
- route deletion은 별도 pruning rule이 있을 때만 허용

### Spec Text Draft

```md
LLM-synthesized route options are advisory inputs, not the source of truth for verified route
promotion state.

The effective/published `routeOptions` MUST be computed by applying a deterministic verified
route overlay on top of synthesized route candidates.

A re-synthesis pass MAY add new candidate routes or refresh route instructions, but it MUST
NOT override a promoted or rolled-back route ordering established by `routeVerification`.
```

---

## 8. Recommended Order Of Closure

이 다섯 개는 서로 연결되어 있다. 닫는 순서도 중요하다.

1. **Decision 1: Stable identity**
   durable key가 없으면 나머지 상태가 모두 흔들린다.
2. **Decision 5: Canonical faster-route definition**
   비교 대상 route 집합과 ordering이 없으면 Week 4의 승격 기준 자체가 흔들린다.
3. **Decision 2: Run-to-skill binding**
   어떤 run이 어떤 skill에 대한 증거인지 명확히 해야 mutation이 가능하다.
4. **Decision 3: Failure attribution**
   rollback rule을 generic failure에서 route-caused failure로 좁혀야 운영 중 flapping을 막을 수 있다.
5. **Decision 6: Verified overlay vs re-synthesis**
   verified state가 publication 단계에서 살아남도록 precedence를 고정한다.

---

## 9. Practical Next Step

다음 작업자는 바로 코드 구현으로 들어가기보다 먼저 아래를 수행하는 것이 맞다.

- `2026-04-22-rule-first-promotion-engine-design.md`에 durable identity와 depublish/lifecycle 규칙 추가
- `2026-04-22-verified-route-promotion-and-rollback-design.md`에 run binding, attribution taxonomy, promotable route domain, overlay precedence 추가
- `docs/Product_Design.md`와 teach/runtime prompt guidance의 route ordering 표현을 한 번 정렬

이 다섯 항목이 닫히면 Week 2-4 구현은 "어떤 상태를 어디에 저장할지"에서 헤매지 않고 straight-line으로 진행될 가능성이 높다.

---

## 10. Plan-Authoring Brainstorm For Decision 1

### Why Decision 1 Should Become Plan Docs Before Further Spec Editing

Decision 1 is not a single-line spec clarification. It is really four coupled problems hiding under one label:

- identity model: durable key를 무엇으로 둘지
- continuity rule: reclustering 시 기존 객체와 새 객체를 어떻게 잇는지
- persistence and migration: 기존 ledger / published skill metadata를 어떻게 호환시킬지
- ownership boundary: 어떤 state가 cluster에 붙고 어떤 state가 durable workflow에 붙는지

이 네 문제를 Week 2/4 spec 본문 안에서 한 번에 닫으려 하면, spec이 금방 implementation-free architecture memo처럼 커진다. 반대로 바로 코드를 만지기 시작하면 durable identity의 의미가 code path별로 갈라진다.

그래서 Decision 1은 spec 본문에 곧바로 큰 문단을 추가하기보다, 먼저 `docs/superpowers/plans` 스타일의 실행 계획문서로 구체화하는 편이 더 적합하다.

### Why `docs/superpowers/plans` Style Fits This Problem

repo 안의 계획문서들은 대체로 다음 형태를 갖는다.

- `Goal / Architecture / Tech Stack`
- `File Structure`
- `Chunk 1, Chunk 2, ...`
- 각 chunk 아래 `Task`
- 각 task 아래 구체적인 step, verification, sometimes commit boundary

이 스타일은 "좋은 설계 설명"보다 "좋은 실행 문서"에 가깝다. Decision 1은 바로 이 형태가 필요하다. 이유는 durable identity 문제를 해결하려면, 좋은 아이디어 자체보다도 다음이 더 중요하기 때문이다.

- 어떤 타입이 바뀌는지
- 어떤 read path / write path가 영향을 받는지
- 어떤 테스트가 invariants를 보장하는지
- 어디서 old-state compatibility를 유지하는지

즉, Decision 1은 prose만 늘리는 것보다 chunk/task/step으로 강제 변환될 때 더 잘 닫힌다.

### Recommended Split: Two Plan Docs, Not One Large Spec Patch

권고는 문서 2개다.

1. `docs/superpowers/plans/2026-04-23-layer3-durable-workflow-identity.md`
2. `docs/superpowers/plans/2026-04-23-layer3-cluster-continuity-and-ledger-migration.md`

이렇게 나누는 이유:

- 첫 문서는 "새 계약"을 정의한다.
- 둘째 문서는 "그 계약을 기존 시스템에 어떻게 입힐지"를 정의한다.

한 문서에 다 몰아넣으면 architecture rewrite처럼 커지고, 반대로 4문서 이상으로 찢으면 cross-reference가 너무 많아져 worker가 문서 하나만 읽고 실행하기 어렵다.

### Plan Doc A: Durable Workflow Identity Contract

**Suggested file:**
`docs/superpowers/plans/2026-04-23-layer3-durable-workflow-identity.md`

**Purpose:**
`clusterId` / `skill.id` / `workflowFamilyId`의 역할을 분리하고, 어떤 state가 durable identity에 붙는지 명시하는 문서.

**What This Doc Should Lock Down:**

- `clusterId`는 snapshot-scoped only
- long-lived Layer 3/4 state는 durable workflow identity에만 귀속
- published skill metadata는 durable identity를 반드시 담아야 함
- promotion history / route verification / rollback history는 durable identity 기준

**Recommended structure:**

- Goal
- Architecture
- Non-Goals
- File Structure
- Chunk 1: inventory existing identity sources
- Chunk 2: define durable identity contract
- Chunk 3: attach long-lived state to durable identity
- Chunk 4: align publication metadata
- Chunk 5: invariants and tests

**Recommended chunks in more detail:**

- Chunk 1: Existing Identity Inventory
  - cluster ID generation source 정리
  - skill ID generation source 정리
  - current failure stories 2-3개 작성
- Chunk 2: Durable Identity Contract
  - `workflowFamilyId` type 추가
  - ownership table 작성
  - forbidden usages 정리 (`clusterId`를 long-lived state key로 쓰지 말 것)
- Chunk 3: Persisted Shape Changes
  - ledger types 변경
  - published skill metadata backfill field 추가
  - operator/debug references 정렬
- Chunk 4: Publication Alignment
  - publish path가 durable identity를 유지하도록 수정
  - hot-refresh / notification detail payload 정렬
- Chunk 5: Invariants And Tests
  - reclustering 후에도 durable identity 유지
  - wording-only synthesis drift가 identity를 바꾸지 않음
  - persisted state round-trip 보장

### Plan Doc B: Cluster Continuity And Ledger Migration

**Suggested file:**
`docs/superpowers/plans/2026-04-23-layer3-cluster-continuity-and-ledger-migration.md`

**Purpose:**
새 cluster가 기존 durable workflow에 연결되는 continuity rule과, old ledger / old published skill metadata를 어떻게 호환시킬지 정의하는 문서.

**What This Doc Should Lock Down:**

- continuity pass가 publication 전에 수행됨
- ambiguity policy가 deterministic함
- old ledger는 read-path 또는 write-path migration으로 안전하게 수용됨
- unmatched / ambiguous cases는 silent merge 금지

**Recommended structure:**

- Goal
- Architecture
- Tech Stack
- File Structure
- Chunk 1: continuity pass before publication
- Chunk 2: deterministic match rule
- Chunk 3: read-path compatibility
- Chunk 4: write-path backfill / migration
- Chunk 5: ambiguity and failure policy
- Chunk 6: migration test matrix

**Recommended chunks in more detail:**

- Chunk 1: Continuity Pass Placement
  - clustering 후, publication 전에 continuity pass 삽입
  - new cluster -> existing durable workflow matching 단계 추가
- Chunk 2: Match Rule
  - normalized objective/title
  - parameter schema overlap
  - source episode overlap
  - existing published skill metadata match
  - weighted score 또는 strict precedence 정의
- Chunk 3: Ambiguity Policy
  - exact match 1개면 reuse
  - 복수 후보면 no-merge + note
  - 후보 없음이면 new durable workflow 생성
- Chunk 4: Ledger Compatibility
  - old ledger load 시 missing `workflowFamilyId` 처리
  - published SKILL metadata missing field backfill
  - lazy migration vs eager migration 결정
- Chunk 5: Migration Safety
  - silent destructive merge 금지
  - orphan된 old state 보존 규칙
- Chunk 6: Test Matrix
  - title drift only
  - parameter schema expansion
  - overlapping episodes with wording changes
  - ambiguous two-cluster case
  - old ledger load/save round-trip

### Where New Closure Ideas Are Most Likely To Emerge

Decision 1은 처음부터 정답을 안고 쓰는 문서가 아니다. 오히려 아래 섹션을 쓰는 과정에서 closure 아이디어가 더 잘 나온다.

1. `Current Failure Stories`
   같은 workflow가 왜 duplicate skill로 갈라지는지 서술하다 보면 durable key 필요성이 더 명확해진다.
2. `Identity Ownership Table`
   cluster / skill / durable workflow 각각이 무엇을 소유하는지 표로 정리하면 2번(run binding)과 6번(overlay precedence) 연결점이 보인다.
3. `Before / After Ledger Examples`
   실제 JSON 예시를 쓰다 보면 migration 부담과 compatibility 전략이 구체화된다.
4. `Ambiguity Policy`
   continuity rule을 서술하다 보면 spec이 어디까지 deterministic해야 하는지가 분명해진다.
5. `Test Matrix`
   stable identity가 무엇을 보장해야 하는지 추상어가 아니라 executable invariant로 바뀐다.

즉, Decision 1은 문서를 쓰는 과정 자체가 closure를 만들어내는 타입의 문제다.

### Why Not A Single Giant Plan Doc

한 문서에 identity contract + continuity + migration + metadata + tests를 모두 넣으면 다음 문제가 생긴다.

- 중간부터 architecture note처럼 비대해짐
- chunk/task 경계가 흐려짐
- worker가 어느 chunk부터 실행해야 하는지 불명확해짐
- document approval도 어려워짐

반대로 너무 잘게 쪼개서 4문서 이상으로 만들면 다음 문제가 생긴다.

- 문서 간 context switching 증가
- cross-reference가 많아짐
- 문서 하나만 읽고는 실행이 어려워짐

따라서 2문서 구성이 가장 균형이 좋다.

### Recommended Authoring Sequence

1. 먼저 짧은 identity contract note를 손으로 정리한다.
2. 그 note를 바탕으로 Plan Doc A를 `docs/superpowers/plans` 스타일로 작성한다.
3. Plan Doc A를 쓰고 나면 continuity questions가 드러나므로 Plan Doc B를 작성한다.
4. Plan Doc B까지 쓰고 나면, 그 결과를 다시 Week 2 / Week 4 spec 본문에 압축해 넣는다.

즉, Decision 1은 spec 본문을 곧바로 확장하기보다, 먼저 plan docs로 "실행 가능한 설계"로 만드는 것이 맞다.

### Suggested Immediate Next Authoring Task

가장 먼저 작성할 문서는 아래다.

- `docs/superpowers/plans/2026-04-23-layer3-durable-workflow-identity.md`

이 문서의 성공 조건:

- durable identity naming이 고정됨
- ownership boundary가 표로 정리됨
- file structure와 first-pass chunk/task가 정의됨
- continuity/migration이 별도 후속 문서로 분리됨

이 문서가 먼저 나오면, 이후 spec 수정은 "추상 논의"가 아니라 "합의된 plan에서 필요한 규칙을 spec으로 역반영"하는 작업이 된다.
