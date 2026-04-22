# 5-Layer 기능 완성표

**기준일:** 2026-04-20
**브랜치:** `chore/post-pr8-script-cleanups` (PR #9 merged)
**버전:** 0.3.6

---

## Layer 1 — Native GUI Capability (23/25, 92%)

> **목표:** 모든 데스크탑 앱을 사람처럼 조작 — 클릭, 타이핑, 드래그, 스크롤, 결과 검증

| # | 기능 | 상태 | 구현 위치 |
|---|------|------|-----------|
| 1 | `gui_observe` (스크린샷 + 요소 인식) | ✅ | `packages/tools/src/gui-tools.ts` |
| 2 | `gui_click` (좌표 클릭) | ✅ | `packages/tools/src/gui-tools.ts` |
| 3 | `gui_drag` (드래그) | ✅ | `packages/tools/src/gui-tools.ts` |
| 4 | `gui_scroll` (스크롤) | ✅ | `packages/tools/src/gui-tools.ts` |
| 5 | `gui_type` (텍스트 입력) | ✅ | `packages/tools/src/gui-tools.ts` |
| 6 | `gui_key` (키 입력/단축키) | ✅ | `packages/tools/src/gui-tools.ts` |
| 7 | `gui_wait` (대상 대기) | ✅ | `packages/tools/src/gui-tools.ts` |
| 8 | `gui_move` (커서 이동) | ✅ | `packages/tools/src/gui-tools.ts` |
| 9 | 듀얼 모델 그라운딩 (main model + grounding model) | ✅ | `packages/tools/src/grounding/` |
| 10 | HiDPI 정규화 + adaptive scaling (≤2000×2000) | ✅ | 그라운딩 루프 내 |
| 11 | Single 모드 (단일 예측) | ✅ | `packages/tools/src/grounding/grounding-loop.ts` |
| 12 | Complex 모드 (simulation overlay + validator 확인) | ✅ | `packages/tools/src/grounding/validation.ts` |
| 13 | Small target 자동 고해상도 정제 (≤160px, ≥360×320) | ✅ | `packages/tools/src/grounding/grounding-loop.ts` |
| 14 | Click point 안정화 (엣지 편향 보정) | ✅ | 그라운딩 루프 내 |
| 15 | Debounced wait (2회 연속 일치 확인) | ✅ | `gui_wait` 내 `probeForTarget()` |
| 16 | macOS 네이티브 헬퍼 (Swift, runtime 컴파일) | ✅ | `packages/gui/src/native-helper.ts` |
| 17 | Windows 네이티브 헬퍼 (C++, WGC) | ✅ | `packages/gui/src/win32-native-helper.ts` |
| 18 | Windows UIA 트리 기반 타겟 매칭 | ✅ | `packages/gui/src/` + `packages/tools/src/` |
| 19 | Browser 자동화 (Playwright, 3모드) | ✅ | `packages/tools/src/browser/browser-tool.ts` |
| 20 | Shell (`bash`) | ✅ | tools |
| 21 | Web 검색/패치 | ✅ | `packages/tools/src/web-search.ts`, `web-fetch.ts` |
| 22 | 메모리 (SQLite FTS5, 선택적) | ✅ | `packages/tools/src/memory/memory-tool.ts` |
| 23 | 스케줄링 (cron + one-shot) | ✅ | `packages/tools/src/schedule/schedule-tool.ts` |
| 24 | 서브에이전트 (child sessions) | ✅ | core |
| — | **Personalized UI Memory** | ❌ | Product Design에 계획으로 명시 |
| — | **Linux AT-SPI** | ❌ | AGENTS.md에 "open contribution area" |

**그라운딩 벤치마크:** 30/30 타겟 해결 (explicit labels, ambiguous targets, icon-only elements, fuzzy prompts)

---

## Layer 2 — Learn from Demonstrations (15/15, 100%)

> **목표:** 사용자가 한 번 시연하면, 재사용 가능한 스킬로 추출

| # | 기능 | 상태 | 구현 위치 |
|---|------|------|-----------|
| 1 | `/teach start` (듀얼 트랙 녹화: 비디오 + 이벤트) | ✅ | `packages/gui/src/demonstration-recorder.ts` |
| 2 | `/teach stop` (녹화 종료) | ✅ | gateway teach handlers |
| 3 | Scene detection (`ffmpeg`, scene>0.12, 900ms 간격) | ✅ | evidence pack 내 |
| 4 | Event clustering (drag 60 / pointer 42 / keyboard 34 / scroll 24) | ✅ | evidence pack 내 |
| 5 | 3-소스 머지 (event + scene + context windows) | ✅ | evidence pack 내 |
| 6 | Adaptive budget (최대 18 episodes, 64 keyframes) | ✅ | evidence pack 내 |
| 7 | Semantic keyframes (최대 6/episode, before/action/settled/after/context) | ✅ | evidence pack 내 |
| 8 | AI 분석 → teach draft 생성 | ✅ | `packages/core/src/task-drafts.ts` |
| 9 | Multi-turn clarification 대화 | ✅ | `packages/gateway/src/teach-orchestration.ts` |
| 10 | `/teach confirm [--validate]` | ✅ | gateway teach handlers |
| 11 | Replay validation (실행 + trace 분석, 선택적) | ✅ | teach validation |
| 12 | `/teach publish` → SKILL.md 생성 | ✅ | `packages/core/src/skills/workspace.ts` |
| 13 | 3-레이어 추상화 (intent procedure + route options + GUI replay hints) | ✅ | SKILL.md frontmatter |
| 14 | Hot-refresh (활성 세션에 즉시 로드) | ✅ | workspace skill loader |
| 15 | Skill / worker / playbook 아티팩트 타입 | ✅ | publish 파이프라인 |

**비고:** 좌표 매크로가 아닌 **의도(Intent)** 학습 — UI 재설계, 창 크기 변경, 유사 앱 전환에도 스킬 작동

---

## Layer 3 — Remember Successful Paths (8/11, 73%)

> **목표:** 같은 해결책을 반복해서 찾지 않도록, 성공 경로를 기억

| # | 기능 | 상태 | 구현 위치 |
|---|------|------|-----------|
| 1 | Compact turn record (성공 턴 기록) | ✅ | `packages/core/src/workflow-crystallization.ts` |
| 2 | Day-level segmentation (대화 경계 탐지) | ✅ | crystallization pipeline |
| 3 | Episode summarization (실행 증거 포함 요약) | ✅ | crystallization pipeline |
| 4 | Cross-history clustering (LLM-assisted similarity) | ✅ | crystallization pipeline |
| 5 | Skill synthesis → SKILL.md publish | ✅ | `packages/core/src/workflow-crystallization.ts` |
| 6 | 비동기 백그라운드 처리 | ✅ | `packages/gateway/src/workflow-crystallization.ts` |
| 7 | Hot-refresh active sessions | ✅ | workspace skill loader |
| 8 | E2E 테스트 | ✅ | `tests/e2e/gateway-workflow-crystallization.e2e.test.ts` |
| — | **Promotion 정책 (rule-first, 명시적 임계값)** | 🟡 | 정책 자체는 존재(`workflow-crystallization.ts:950`), CLI/config wiring 누락 |
| — | **자동 route upgrading (결정화 스킬 내 경로 최적화)** | 🟡 | 관측 상속만, 능동적 최적화 미구현 |
| — | **Stage 0→3 자동 진행** | 🟡 | "still being refined" (Product Design) |
| — | **Task skill graph (합성 가능한 그래프 구조)** | ❌ | 여전히 절차적 SKILL.md |

**현재 경계:** segmentation/clustering/synthesis는 LLM-first. Promotion 임계값은 rule-first로 이미 결정적(`cluster.completeCount >= MIN_CLUSTER_OCCURRENCES_FOR_PROMOTION`). 빠진 건 CLI→config→gateway→session-runtime wiring — 직접 호출자(e2e test)는 이미 옵션을 전달 가능.

---

## Layer 4 — Get Faster Over Time (5/10, 50%)

> **목표:** 같은 작업이 항상 가장 느린 GUI 경로로 실행되지 않도록, 더 빠른 경로를 발견하고 전환

| # | 기능 | 상태 | 구현 위치 |
|---|------|------|-----------|
| 1 | System prompt route preference (`API > CLI > browser > GUI`) | ✅ | system prompt |
| 2 | Teach route annotations (preferred/fallback/observed) | ✅ | SKILL.md frontmatter |
| 3 | Browser auto-fallback (extension → managed) | ✅ | `packages/tools/src/browser/` |
| 4 | GUI capability matrix (권한 기반 도구 동적 활성화) | ✅ | `packages/tools/src/gui-tools.ts` |
| 5 | Execution policy (`toolBinding: adaptive`, `stepInterpretation: fallback_replay`) | ✅ | teach SKILL 실행 |
| — | **Route guard policy (실패 카운터 + 대안 유도)** | 🟡 | `packages/core/src/runtime/policies/route-guard-policy.ts` (실험적, 기본 비활성화) |
| — | **Route guard 테스트** | 🟡 | `route-retry-guard-policy.test.ts` 존재 |
| — | **자동 route discovery (API probing, CLI 탐색)** | ❌ | Product Design "future direction" |
| — | **자동 route promotion (N회 성공 → 기본 승격)** | ❌ | |
| — | **Route rollback on failure (실패 시 이전 경로 복귀)** | ❌ | |
| — | **Cross-layer integration (결정화 스킬 내 route 적극 최적화)** | ❌ | |

**Route 피라미드:**
```
Fastest ▲  API call (ms)
         │  CLI tool (s)
         │  Browser (s)
Slowest ▼  GUI (s~10s)
```

**현재 경계:** 알려진 빠른 경로가 있으면 그쪽으로 유도하지만, **스스로 새 경로를 찾지는 않음.**

---

## Layer 5 — Proactive Autonomy (1/12, 8%)

> **목표:** 장기간 관찰하여 사용자 작업 패턴을 이해하고, 먼저 제안하고, 격리된 공간에서 자율 실행

| # | 기능 | 상태 | 구현 위치 |
|---|------|------|-----------|
| 1 | Scheduled triggers (cron + one-shot) | ✅ | `packages/tools/src/schedule/schedule-tool.ts` |
| 2 | 4단계 신뢰 모델 설계 (manual / suggest / auto_with_confirm / full_auto) | 📝 | Product Design에 명시, 코드 정의 없음 |
| — | **Passive observation (지속적 데스크탑 관찰)** | ❌ | |
| — | **Pattern discovery (관찰 데이터 → 반복 패턴 추출)** | ❌ | |
| — | **Preference learning (작업 습관, 도구 선호 학습)** | ❌ | |
| — | **Proactive suggestions (관찰 기반 제안, 알림 전달)** | ❌ | |
| — | **Non-intrusive delivery (팝업 없는 알림)** | ❌ | |
| — | **Isolated workspace — macOS second desktop** | ❌ | |
| — | **Isolated workspace — Docker + VNC / cloud VM** | ❌ | |
| — | **Cross-app orchestration (멀티앱 병렬 제어)** | ❌ | |
| — | **Autonomy level management (승격/강등 런타임 시행)** | ❌ | `autonomy`, `trust_level` 등 코드 검색 결과 0건 |
| — | **Progressive trust model (런타임 시행 + 롤백)** | ❌ | |

**현재 경계:** 스케줄링은 가능하지만, 수동 트리거만 가능. 자율 관찰, 패턴 발견, 격리 실행 모두 미래 작업.

---

## 전체 통계

```
Layer 1  Native GUI Capability       23/25   92%   ████████████████████░
Layer 2  Learn from Demonstrations   15/15  100%   █████████████████████
Layer 3  Remember Successful Paths    8/11   73%   ███████████████░░░░░
Layer 4  Get Faster Over Time         5/10   50%   ██████████░░░░░░░░░░
Layer 5  Proactive Autonomy           1/12    8%   ██░░░░░░░░░░░░░░░░░░
                                    ─────
총합                                52/73   71%
```

---

## 채널 어댑터 (8/8, 100%)

모두 실구현 (stub 없음).

| 채널 | 방향 | 기반 기술 | 선택적 의존성 |
|------|------|-----------|--------------|
| Telegram | 양방향 | grammy | 선택적 |
| Discord | 양방향 | discord.js | 선택적 |
| Slack | 양방향 | @slack/bolt | 선택적 |
| Web (WebSocket) | 양방향 | ws | 기본 |
| WhatsApp | 양방향 | @whiskeysockets/baileys | 선택적 |
| Signal | 아웃바운드 | signal-cli | 선택적 |
| LINE | 아웃바운드 | REST API | 선택적 |
| iMessage | 아웃바운드 | AppleScript (macOS) | 선택적 |
