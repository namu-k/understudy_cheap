# 테스트 커버리지 및 품질 이슈 — 1차 조사 결과

**생성일**: 2026-04-11
**조사 방법**: 3개 explore 에이전트 병렬 실행
**조사 범위**: `packages/{core,gateway,tools,channels,gui}/src/`
**목적**: 2차 조사 에이전트가 중복 조사를 피하기 위한 참고 자료

---

## 1. 테스트 파일이 없는 소스 파일 (82개)

전체 180개 소스 파일 중 82개(45.5%)가 테스트 없음.

### packages/core (33개 미테스트 / 61개 전체)

**런타임 어댑터/오케스트레이션**:
- `src/runtime/adapters/acp.ts` — ACP 원격 런타임 어댑터
- `src/runtime/adapters/embedded.ts` — 임베디드 런타임 어댑터
- `src/runtime/adapters/session-handle.ts` — 세션 핸들
- `src/runtime/orchestrator.ts` — 런타임 오케스트레이터
- `src/runtime/preflight.ts` — 사전 검증
- `src/runtime/tool-watchdog.ts` — 도구 감시
- `src/runtime/tool-result-char-estimator.ts` — 결과 크기 추정
- `src/runtime/system-prompt-override.ts` — 시스템 프롬프트 오버라이드
- `src/runtime/types.ts` — 런타임 타입

**런타임 정책**:
- `src/runtime/policies/sanitize-tool-params-policy.ts` — 도구 파라미터 정제
- `src/runtime/policies/route-guard-policy.ts` — 라우트 가드
- `src/runtime/policies/normalize-tool-result-policy.ts` — 결과 정규화

**ACP 프로토콜**:
- `src/runtime/acp/types.ts` — ACP 타입
- `src/runtime/acp/registry.ts` — ACP 레지스트리

**설정/인증**:
- `src/config.ts` — 설정 로더
- `src/config-schema.ts` — 설정 스키마
- `src/auth-records.ts` — 인증 레코드

**스킬 시스템**:
- `src/skills/workspace.ts` — 워크스페이스 스킬 로더
- `src/skills/frontmatter.ts` — YAML 프론트매터 파서
- `src/skills/eligibility.ts` — 스킬 자격 확인

**유틸/프롬프트**:
- `src/workspace-context.ts`
- `src/value-helpers.ts`
- `src/utils/with-timeout.ts`
- `src/tool-summaries.ts`
- `src/tool-policy-matcher.ts`
- `src/system-prompt-sections.ts`
- `src/system-prompt-params.ts`
- `src/session-reset-prompt.ts`
- `src/sanitize-for-prompt.ts`
- `src/prompt-report.ts`
- `src/media-utils.ts`
- `src/logger.ts`
- `src/file-logger.ts`

### packages/gateway (21개 미테스트 / 43개 전체)

**RPC 핸들러 (전부 미테스트)**:
- `src/handlers/usage-handlers.ts`
- `src/handlers/session-handlers.ts`
- `src/handlers/schedule-handlers.ts`
- `src/handlers/pairing-handlers.ts`
- `src/handlers/message-handlers.ts`
- `src/handlers/health-handlers.ts`
- `src/handlers/discovery-handlers.ts`
- `src/handlers/config-handlers.ts`

**런타임/세션**:
- `src/subagent-spawn-plan.ts`
- `src/subagent-registry.ts`
- `src/skill-runtime.ts`
- `src/inline-runtime.ts`
- `src/session-scope.ts`
- `src/session-ui-helpers.ts`

**UI/설정**:
- `src/webchat-ui.ts`
- `src/ui-brand.ts`
- `src/display-sanitize.ts`
- `src/security-headers.ts`
- `src/config-reload.ts`
- `src/value-coerce.ts`
- `src/protocol.ts`

### packages/tools (18개 미테스트 / 54개 전체)

- `src/bridge/subagents-tool.ts`
- `src/bridge/sessions-spawn-tool.ts`
- `src/bridge/gateway-tool.ts`
- `src/bridge/bridge-rpc.ts`
- `src/bridge/agents-list-tool.ts`
- `src/memory/provider.ts`
- `src/memory/provider-factory.ts`
- `src/grounding/vision-ocr-helper.ts`
- `src/grounding-simulation-image.ts`
- `src/grounding-model-image.ts`
- `src/grounding-guide-image.ts`
- `src/response-grounding-provider.ts`
- `src/response-extract-helpers.ts`
- `src/apply-patch-update.ts`
- `src/platform-capabilities-tool.ts`
- `src/svg-to-png.ts`
- `src/svg-helpers.ts`
- `src/photon.ts`

### packages/channels (8개 미테스트 / 13개 전체)

- `src/whatsapp/whatsapp-channel.ts`
- `src/signal/signal-channel.ts`
- `src/line/line-channel.ts`
- `src/imessage/imessage-channel.ts`
- `src/discord/discord-channel.ts`
- `src/shared/outbound-media.ts`
- `src/shared/media-utils.ts`
- `src/shared/inbound-media.ts`

### packages/gui (2개 미테스트 / 9개 전체)

- `src/types.ts`
- `src/exec-utils.ts`

---

## 2. `as any` 타입 단언 사용 테스트 (73개 파일)

테스트에서 타입 안전성을 우회. 실제 인터페이스 변경 시 버그를 놓칠 위험.

### packages/tools (20개 파일)
- `src/__tests__/apply-patch-tool.test.ts`
- `src/__tests__/bridge-tools.test.ts`
- `src/__tests__/browser-tool-connection.test.ts`
- `src/__tests__/browser-tool-manager.test.ts`
- `src/__tests__/browser-tool.test.ts`
- `src/__tests__/exec-tool-shell.test.ts`
- `src/__tests__/gui-tools.test.ts`
- `src/__tests__/image-tool.test.ts`
- `src/__tests__/memory-tool.test.ts`
- `src/__tests__/message-tool.test.ts`
- `src/__tests__/pdf-tool.test.ts`
- `src/__tests__/process-tool.test.ts`
- `src/__tests__/runtime-status-tool.test.ts`
- `src/__tests__/runtime-toolset.test.ts`
- `src/__tests__/schedule-tool.test.ts`
- `src/__tests__/sessions-tool.test.ts`
- `src/__tests__/video-teach-analyzer.test.ts`
- `src/__tests__/vision-read-tool.test.ts`
- `src/__tests__/web-fetch.test.ts`
- `src/__tests__/web-search.test.ts`

### packages/core (21개 파일)
- `src/__tests__/agent.test.ts`
- `src/__tests__/auth.test.ts`
- `src/__tests__/config.test.ts`
- `src/__tests__/guard-assistant-reply-policy.test.ts`
- `src/__tests__/model-resolution-bridge.test.ts`
- `src/__tests__/orchestrator-policy.test.ts`
- `src/__tests__/policy-pipeline.test.ts`
- `src/__tests__/prompt-image-support.test.ts`
- `src/__tests__/route-retry-guard-policy.test.ts`
- `src/__tests__/runtime-adapters.test.ts`
- `src/__tests__/runtime-policy-registry.test.ts`
- `src/__tests__/runtime-watchdog.test.ts`
- `src/__tests__/session-trace.test.ts`
- `src/__tests__/skills-workspace.test.ts`
- `src/__tests__/strip-assistant-directive-tags-policy.test.ts`
- `src/__tests__/system-prompt.test.ts`
- `src/__tests__/task-drafts.test.ts`
- `src/__tests__/tool-execution-trace.test.ts`
- `src/__tests__/tool-result-context-guard.test.ts`
- `src/__tests__/workflow-crystallization.test.ts`
- `src/__tests__/workspace-artifacts.test.ts`

### packages/gui (2개 파일)
- `src/__tests__/demonstration-recorder.test.ts`
- `src/__tests__/runtime.test.ts`

### packages/gateway (9개 파일)
- `src/__tests__/handler-registry.test.ts`
- `src/__tests__/lifecycle.test.ts`
- `src/__tests__/message-timestamp.test.ts`
- `src/__tests__/playbook-session-handlers.test.ts`
- `src/__tests__/router.test.ts`
- `src/__tests__/server.test.ts`
- `src/__tests__/session-runtime.real.test.ts`
- `src/__tests__/session-runtime.test.ts`
- `src/__tests__/task-drafts.test.ts`

### packages/channels (3개 파일)
- `src/__tests__/outbound-media-channel.test.ts`
- `src/__tests__/slack-discord-channel.test.ts`
- `src/__tests__/telegram-channel.test.ts`

### packages/plugins (1개 파일)
- `src/__tests__/loader.test.ts`

### apps/cli (15개 파일)
- `src/commands/browser-extension-relay-controller.test.ts`
- `src/commands/browser-extension-setup.test.ts`
- `src/commands/browser-extension.test.ts`
- `src/commands/chat-branding.test.ts`
- `src/commands/chat-gateway-session.test.ts`
- `src/commands/chat-interactive-browser-extension.test.ts`
- `src/commands/chat.test.ts`
- `src/commands/gateway-runtime-readiness.test.ts`
- `src/commands/gateway-session-query-store.test.ts`
- `src/commands/gateway-session-store.test.ts`
- `src/commands/gateway.test.ts`
- `src/commands/gui-grounding.test.ts`
- `src/commands/message.test.ts`
- `src/commands/schedule.test.ts`
- `src/commands/setup-checklist.test.ts`

### tests/e2e (2개 파일)
- `tests/e2e/gateway-workflow-crystallization.e2e.test.ts`
- `tests/e2e/webchat-gateway.e2e.test.ts`

---

## 3. 과도한 모킹 (1개 파일)

- `apps/cli/src/commands/chat.test.ts` — **17개 `vi.mock()` 호출**
  - 모킹된 모듈이 많아 실제 동작이 아닌 mock을 테스트할 가능성 있음

---

## 4. setTimeout 사용 테스트 (40개 파일)

대부분 적절히 await되는 것으로 보이나, assertion 없이 타이머만 설정하는 케이스 감사 필요.

### packages/tools (11개 파일)
- `src/__tests__/video-teach-analyzer.test.ts`
- `src/__tests__/uia-grounding-provider.test.ts`
- `src/__tests__/teach-capability-snapshot.test.ts`
- `src/__tests__/schedule-tool.test.ts`
- `src/__tests__/process-tool.test.ts`
- `src/__tests__/memory-store.test.ts`
- `src/__tests__/grounding/ocr-engine-retry.test.ts`
- `src/__tests__/exec-tool-shell.test.ts`
- `src/__tests__/browser-tool-manager.test.ts`
- `src/__tests__/browser-tool-connection.test.ts`
- `src/__tests__/browser-manager.test.ts`

### apps/cli (18개 파일)
- `src/commands/chat.test.ts`
- `src/commands/chat-interactive-teach.test.ts`
- `src/commands/browser-extension-setup.test.ts`
- `src/commands/browser-extension-relay-controller.test.ts`
- `src/commands/chat-interactive-browser-extension.test.ts`
- `src/commands/chat-gateway-session.test.ts`
- `src/commands/agents.test.ts`
- `src/commands/agent.test.ts`
- `src/commands/channels.test.ts`
- `src/commands/browser.test.ts`
- `src/commands/webchat.test.ts`
- `src/commands/models.test.ts`
- `src/commands/status.test.ts`
- `src/commands/setup-checklist.test.ts`
- `src/commands/schedule.test.ts`
- `src/commands/message.test.ts`
- `src/commands/dashboard.test.ts`
- `src/commands/gateway-browser-auth.test.ts`

### packages/gui (5개 파일)
- `src/__tests__/win32-native-helper.test.ts`
- `src/__tests__/win32-demonstration-recorder.test.ts`
- `src/__tests__/runtime.test.ts`
- `src/__tests__/runtime-win32.test.ts`
- `src/__tests__/native-helper.test.ts`

### packages/core (4개 파일)
- `src/__tests__/sandbox-bash-hook.test.ts`
- `src/__tests__/runtime-adapters.test.ts`
- `src/__tests__/auth.test.ts`
- `src/__tests__/agent.test.ts`

### packages/gateway (1개 파일)
- `src/__tests__/task-drafts.test.ts`

### packages/channels (1개 파일)
- `src/__tests__/outbound-media-channel.test.ts`

---

## 5. 플랫폼 가드 이슈

### 5A. 가드가 있어야 하지만 없는 테스트

| 파일 | 문제 | 필요한 가드 |
|------|------|------------|
| `packages/gui/src/__tests__/native-helper.test.ts` | macOS Swift 헬퍼 테스트, 비macOS에서 swiftc 없음 | `describe.skipIf(process.platform !== "darwin")` |
| `packages/gui/src/__tests__/win32-native-helper.test.ts` | Windows 전용, 비Windows에서 exe 없음 | `describe.skipIf(process.platform !== "win32")` |
| `packages/gui/src/__tests__/win32-demonstration-recorder.test.ts` | Windows 전용, 비Windows에서 실패 | `describe.skipIf(process.platform !== "win32")` |

### 5B. 기존 플랫폼 가드 (정상 작동)

| 파일 | 가드 조건 | 스킵 대상 |
|------|----------|----------|
| `packages/gui/src/__tests__/readiness.test.ts` | `process.platform === "darwin" && UNDERSTUDY_RUN_REAL_GUI_TESTS === "1"` | 전체 describe |
| `packages/tools/src/__tests__/gui-tools.test.ts` | `describe.skipIf(process.platform !== "darwin")` | vision OCR 테스트 |
| `packages/tools/src/__tests__/grounding/ocr-engine.test.ts` | `describe.skipIf(process.platform !== "darwin")` | vision OCR 테스트 |
| `packages/tools/src/__tests__/exec-tool.test.ts` | `(process.platform === "win32" ? describe.skip : describe)` — 삼항 연산자 방식 | 전체 describe (Windows에서 스킵) |
| `packages/tools/src/__tests__/video-teach-analyzer.test.ts` | `(process.platform === "win32" ? it.skip : it)` — 삼항 연산자 방식 | "retries slightly earlier when ffmpeg exits..." 개별 테스트 (Windows에서 스킵) |
| `packages/gui/src/__tests__/demonstration-recorder.real.test.ts` | `describe.skipIf(!shouldRunRealRecorderTests)` | 전체 describe |
| `packages/gateway/src/__tests__/session-runtime.real.test.ts` | `describe.skipIf(!shouldRunRealTeachTests)` | 전체 describe |
| `tests/e2e/gateway-workflow-crystallization.real.test.ts` | `UNDERSTUDY_RUN_REAL_WORKFLOW_CRYSTALLIZATION_TESTS === "1"` + auth 파일 | 전체 describe |

### 5C. Windows 전용 테스트의 mock 기반 검증

- `packages/gui/src/__tests__/runtime-win32.test.ts` — `beforeEach`에서 `process.platform`을 "win32"로 오버라이드하지만 skipIf 가드 없음. 비Windows에서 실행 시 mock만 검증됨.

---

## 6. 1차 조사에서 확인된 정상 항목 (문제 없음)

- **빈 테스트 본문**: 없음
- **`expect` 없는 테스트**: 없음
- **무조건 통과 테스트** (`expect(true).toBe(true)`): 없음
- **주석 처리된 assertion** (`// expect(...)`): 없음
- **`test.only()` / `it.only()` 잔존**: 없음

---

## 7. 1차 조사에서 누락된 추가 발견

### 7A. 플랫폼 조건부 skip — 삼항 연산자 방식 (5B에서 누락)

`describe.skipIf`/`it.skipIf` 대신 삼항 연산자를 사용한 조건부 skip. 기능은 동일하나 grep에서 쉽게 발견되지 않아 감사에서 누락되기 쉬움.

| 파일 | 방식 | 대상 |
|------|------|------|
| `packages/tools/src/__tests__/exec-tool.test.ts:14` | `(process.platform === "win32" ? describe.skip : describe)` | 전체 describe |
| `packages/tools/src/__tests__/video-teach-analyzer.test.ts:127` | `(process.platform === "win32" ? it.skip : it)` | 개별 테스트 1개 |

### 7B. 하드코딩된 sleep — 테스트 비결정성

| 파일 | 라인 | 내용 | 문제 |
|------|------|------|------|
| `packages/gateway/src/__tests__/session-runtime.test.ts` | 310 | `await sleep(25)` | 25ms 하드코딩 대기. 타이밍 의존적이어서 CI 환경에서 간헐적 실패 가능. `vi.useFakeTimers()` + `vi.advanceTimersByTime()`으로 대체 권장 |
