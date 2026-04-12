# 테스트 품질 심층 감사 — 2차 조사 결과

**생성일**: 2026-04-11
**조사 방법**: 8개 explore 에이전트 병렬 실행 + 직접 grep/ast-grep/LSP 분석
**조사 범위**: `packages/{core,gateway,tools,channels,gui}/src/__tests__/`
**선행 조사**: `.sisyphus/specs/test-coverage-issues-round1.md` (82개 미테스트 파일, 73개 as any, 과도 모킹, setTimeout, 플랫폼 가드)
**목적**: 1차에서 다루지 않은 5가지 새로운 관점에서 테스트 품질 심층 분석

---

## 조사 영역 1: Assertion 품질

### 요약: 13개 이슈 발견 (High: 3, Medium: 5, Low: 5)

#### 1-A. 약한 Assertion — `toBeDefined()`만 있고 실제 값 검증이 없는 경우

| 파일 | 테스트 | 심각도 | 이슈 |
|------|--------|--------|------|
| `packages/core/src/__tests__/agent.test.ts:161-162` | "builds session with trusted custom tools and system prompt" | Low | `expect(args.authStorage).toBeDefined()` + `expect(args.modelRegistry).toBeDefined()` — 존재만 확인. 단, 같은 테스트의 `expect(result.session).toBeDefined()` (line 142) 뒤에는 20개 이상의 구체적 assertion이 뒤따르므로 세션 검증은 정상 |
| `packages/core/src/__tests__/auth.test.ts:131-132` | "creates in-memory auth manager" | Low | `expect(mgr.authStorage).toBeDefined()` + `expect(mgr.modelRegistry).toBeDefined()` — 존재만 확인 |
| `packages/gui/src/__tests__/runtime-win32.test.ts` (1-2곳) | observe/click/drag/scroll/type/key/move 테스트들 | Medium | `.find()` 후 `.toBeDefined()`로 존재 확인. 대부분 `.args.toContain()` 등 후속 검증이 있으나, 극소수 케이스는 `toBeDefined()`가 유일한 assertion |

**SNIPPET** (agent.test.ts — toBeDefined 이후 풍부한 검증):
```typescript
// Line 142 — toBeDefined 후 20+개의 구체적 assertion이 뒤따름
expect(result.session).toBeDefined();
expect(mocks.setSystemPrompt).toHaveBeenCalledTimes(1);
expect(mocks.setSystemPrompt.mock.calls[0][0]).toContain("Understudy");
expect(mocks.setSystemPrompt.mock.calls[0][0]).toContain("demo_tool");
expect(toPosix(result.sessionMeta.workspaceDir)).toBe("/tmp/understudy");
expect(result.sessionMeta.backend).toBe("embedded");
expect(result.sessionMeta.promptReport.systemPrompt.chars).toBeGreaterThan(0);
// ... 총 20+개 검증
```

**SNIPPET** (runtime-win32.test.ts — 정상 케이스):
```typescript
// Line 163-166 — toBeDefined 후 속성 검증이 뒤따름 (정상)
const clickCall = mocks.win32HelperCalls.find((c) => c.subcommand === "click");
expect(clickCall).toBeDefined();
expect(clickCall?.args).toContain("200");
expect(clickCall?.args).toContain("300");
```

**SNIPPET** (runtime-win32.test.ts — 문제 케이스):
```typescript
// 일부 테스트에서 toBeDefined가 유일한 assertion인 케이스가 1-2곳 존재
// 대부분의 find+toBeDefined 패턴은 후속 검증이 있어 정상
```

#### 1-B. 약한 Assertion — `toBeTruthy()` / `toBeFalsy()` 로 구체적 값 검증 회피

| 파일 | 테스트 | 심각도 | 이슈 |
|------|--------|--------|------|
| `packages/tools/src/__tests__/exec-tool.test.ts:40` | "backgrounds long-running commands..." | High | `expect(sessionId).toBeTruthy()` — 빈 문자열도 통과. UUID 형식 검증 필요 |
| `packages/tools/src/__tests__/exec-tool.test.ts:80` | "supports session writes and submit for background exec runs" | High | `expect(sessionId).toBeTruthy()` — 동일 |
| `packages/core/src/__tests__/model-resolution-bridge.test.ts:44,70` | 모델 해석 테스트 | Low | `expect(result.candidates[0]?.model).toBeTruthy()` — 모델 이름이 어떤 값인지 검증 안 함 |
| `packages/gateway/src/__tests__/session-runtime.test.ts` | "crystallizes repeated multi-turn workflows..." | Medium | `expect(skill.publishedSkill?.skillPath).toBeTruthy()` — 경로 문자열 값 검증 필요 |

**SNIPPET** (exec-tool.test.ts):
```typescript
// Line 40 — truthy만 확인, 빈 문자열 " "도 통과
expect(sessionId).toBeTruthy();
// → expect(sessionId).toMatch(/^[a-f0-9-]+$/) 등 구체적 검증 필요
```

#### 1-C. 부분 검증 — 여러 필드 중 일부만 검증

| 파일 | 테스트 | 심각도 | 이슈 |
|------|--------|--------|------|
| `packages/gateway/src/__tests__/server.test.ts` | "serves health/channels/dashboard/webchat..." | Medium | 채널 객체에서 `id`, `name`, `runtime.state`만 검증. `capabilities`, messaging adapter 등 미검증 |
| `packages/gateway/src/__tests__/session-runtime.test.ts` | "crystallizes repeated multi-turn workflows..." | Medium | cluster 객체에서 `title`, `objective`, count들만 검증. `episodes` 배열 내용 미검증 |

**SNIPPET** (server.test.ts):
```typescript
// 채널 객체의 일부 필드만 검증
expect(channels.body.channels[0]).toMatchObject({
    id: "web",
    name: "mock-web",
    runtime: { state: "running" },
});
// → capabilities, messagingAdapter 등 누락 필드 변경 시 감지 불가
```

#### 1-D. 역방향 검증 누락 — Happy path만 테스트

**전체 통계**: packages 내 132개 `describe()` 블록 중 error/fail/invalid 관련 이름의 describe는 **단 2개** (`win32-native-helper.test.ts`의 "error paths", `ocr-engine-retry.test.ts`의 "retry after failure").

| 파일 | 심각도 | 이슈 |
|------|--------|------|
| `packages/channels/src/__tests__/telegram-channel.test.ts` | High | 4개 테스트 모두 성공 케이스. invalid token, network failure, malformed input 테스트 없음 |
| `packages/core/src/__tests__/agent.test.ts` | Medium | 세션 생성 성공 케이스 위주. invalid config, 누락 의존성 등 실패 경로 불충분 |
| `packages/core/src/__tests__/auth.test.ts` | Medium | 인증 설정/검사 성공 케이스. invalid credentials, network error 테스트 없음 |
| `packages/tools/src/__tests__/exec-tool.test.ts` | High | 성공 시나리오 위주. 명령 실패, 타임아웃, invalid input 테스트 없음 |

**정상 케이스** (역방향 검증이 잘 된 파일):
- `packages/core/src/__tests__/config.test.ts` — rejection 테스트 풍부
- `packages/core/src/__tests__/policy-pipeline.test.ts` — short-circuit, error 테스트 포함
- `packages/tools/src/__tests__/web-search.test.ts` — empty query, no API key, API error 케이스 포함
- `packages/tools/src/__tests__/web-fetch.test.ts` — empty URL, SSRF, oversized, HTTP error 포함
- `packages/tools/src/__tests__/memory-tool.test.ts` — validation error, not-found 케이스 포함
- `packages/tools/src/__tests__/schedule-tool.test.ts` — validation error, unknown action 포함
- `packages/tools/src/__tests__/browser-tool.test.ts` — validation error, unknown action 포함

---

## 조사 영역 2: 테스트 독립성

### 요약: 3개 이슈 발견 (High: 1, Medium: 1, Low: 1)

#### 2-A. 공유 상태 오염 — process.env 복원 누락

| 파일 | 심각도 | 이슈 |
|------|--------|------|
| `packages/core/src/__tests__/auth.test.ts` | **High** | `process.env.UNDERSTUDY_AGENT_DIR`, API key들 설정. `afterEach`에서 복원하지 않음 |

> **정정 (2026-04-11)**: 1차 검토에서 `agent.test.ts`도 복원 누락으로 분류했으나, 실제 코드 확인 결과 `afterEach`에서 `process.env = originalEnv`로 전체 복원 수행 중. 따라서 `agent.test.ts`는 이 이슈에서 제외. `auth.test.ts`만 해당.

**EVIDENCE** (auth.test.ts):
```typescript
// "creates file-backed auth manager under the default agent dir" 테스트
process.env.UNDERSTUDY_AGENT_DIR = testDir;

// "imports environment API keys" 테스트
process.env.ANTHROPIC_API_KEY = "sk-test-key";
process.env.OPENAI_API_KEY = "sk-oai-key";
process.env.GEMINI_API_KEY = "gemini-key";

// → afterEach에서 원래 값 복원 없음
```

**EVIDENCE** (agent.test.ts — 정상, 복원 수행 중):
```typescript
// Line 89
const originalEnv = process.env;

// Line 102-105 — afterEach에서 전체 복원
afterEach(() => {
    process.env = originalEnv;
    vi.useRealTimers();
});
```

**대조 — 잘 된 사례** (`runtime-paths.test.ts`, `runtime-watchdog.test.ts`):
```typescript
// runtime-watchdog.test.ts — 올바른 정리
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();  // ← env 자동 복원
});
```

#### 2-B. Fake Timers 정리 — 대부분 올바름

**vi.useFakeTimers() 사용 파일 (6개)**: 모두 `vi.useRealTimers()`로 복원 확인됨.

| 파일 | 복원 방식 | 정상 |
|------|----------|------|
| `packages/gui/src/__tests__/runtime.test.ts` (3곳) | `try/finally` 블록 내 복원 | ✅ |
| `packages/gateway/src/__tests__/router.test.ts` (2곳) | 최상위 `afterEach`에서 복원 | ✅ |
| `packages/tools/src/__tests__/sessions-tool.test.ts` (2곳) | `beforeEach`/`afterEach` 쌍 | ✅ |
| `packages/tools/src/__tests__/runtime-status-tool.test.ts` (1곳) | `beforeEach`/`afterEach` 쌍 | ✅ |
| `packages/tools/src/__tests__/gui-tools.test.ts` (1곳) | `try/finally` 블록 내 복원 | ✅ |
| `packages/core/src/__tests__/runtime-watchdog.test.ts` (5곳) | 최상위 `afterEach`에서 복원 | ✅ |

#### 2-C. beforeAll / afterAll 불균형

**전체 통계**: `beforeAll` 사용 파일 1개 vs `afterAll` 사용 파일 3개. 대부분의 테스트가 `beforeEach`/`afterEach`를 사용하여 올바른 패턴.

유일한 `beforeAll` 사용:
- `packages/gui/src/__tests__/runtime.real.test.ts` — `beforeAll`만 있고 `afterAll` 없음 (단, real 테스트는 수동 실행 전용이므로 심각도 낮음)

#### 2-D. process.env 사용 통계

224건의 `process.env.` 참조가 29개 테스트 파일에서 발견. 그중 `vi.stubEnv()`/`vi.unstubAllEnvs()` 사용은 `runtime-watchdog.test.ts` 단 1개 파일. `agent.test.ts`는 `process.env = originalEnv`로 직접 복원하여 양호. 나머지 직접 할당 파일 중 `auth.test.ts`만 복원 누락.

---

## 조사 영역 3: Mock Rot

### 요약: 2개 이슈 발견 (High: 1, Medium: 1)

#### 3-A. 인터페이스 불일치

| 파일 | 모킹된 모듈 | 심각도 | 불일치 내용 |
|------|------------|--------|------------|
| `packages/tools/src/__tests__/video-teach-analyzer.test.ts` | `@understudy/core`의 `createUnderstudySession` | **High** | mock은 `{ session, runtimeSession }`만 반환. 실제 시그니처는 `{ session, runtimeSession, config, toolRegistry, sessionMeta }` — 3개 필드 누락 |
| `packages/gui/src/__tests__/runtime-win32.test.ts` | `ComputerUseGuiRuntime` 의존성 | Medium | `process.platform`을 "win32"로 오버라이드하지만 skipIf 가드 없음. 비Windows에서 mock만 검증됨 |

**SNIPPET** (video-teach-analyzer.test.ts — mock 반환값):
```typescript
// Mock 반환값 — 누락된 필드: config, toolRegistry, sessionMeta
vi.mock("@understudy/core", () => ({
    createUnderstudySession: vi.fn().mockResolvedValue({
        session: { ... },
        runtimeSession: { ... },
        // config: ← 누락
        // toolRegistry: ← 누락
        // sessionMeta: ← 누락
    }),
}));
```

**SNIPPET** (실제 createUnderstudySession 시그니처):
```typescript
// agent.ts에서 반환하는 전체 객체
return { session, runtimeSession, config, toolRegistry, sessionMeta };
```

#### 3-B. 순환 자가검증

발견되지 않음. 모든 mock은 실제 코드를 테스트하기 위한 의존성 격리 목적으로 사용됨.

#### 3-C. 과도한 모킹 (1차에서 이미 보고됨, 참고용)

- `apps/cli/src/commands/chat.test.ts` — 17개 `vi.mock()` (1차 보고)
- 이번 조사에서 packages 내 추가 과도 모킹 파일은 발견되지 않음

---

## 조사 영역 4: 엣지 케이스 및 경계 조건 누락

### 요약: 21개 이슈 발견 (High: 4, Medium: 11, Low: 5)

#### 4-A. packages/core + packages/tools

| SOURCE | BRANCH | TEST_FILE | STATUS | 누락 케이스 |
|--------|--------|-----------|--------|------------|
| `core/src/config.ts` | 파일 없을 때 / invalid JSON5 파싱 | `config.test.ts` | 부분 | invalid JSON5 파싱 에러 케이스 없음. null/undefined 값 병합 케이스 없음 |
| `core/src/auth.ts` | provider 이름 검증 / 만료된 OAuth 토큰 | `auth.test.ts` | **누락** | invalid provider 이름 에러, 만료된 토큰 처리 테스트 없음 |
| `tools/src/web-fetch.ts` | 타임아웃 / redirect limit / 빈 응답 / binary content | `web-fetch.test.ts` | 부분 | 타임아웃, redirect 한계, 빈 body, binary content 감지 테스트 없음 |
| `tools/src/schedule-tool.ts` | invalid cron / 과거 날짜 / 중복 ID | `schedule-tool.test.ts` | **누락** | invalid cron 표현식, 과거 날짜 생성, 중복 ID 방지 테스트 없음 |
| `tools/src/memory/memory-store.ts` | 빈 쿼리 / 특수문자 / 동시 쓰기 | `memory-store.test.ts` | **누락** | 특수문자 검색, 동시 쓰기 안전성 테스트 없음 |

#### 4-B. packages/gateway

| SOURCE | BRANCH | TEST_FILE | STATUS | 누락 케이스 |
|--------|--------|-----------|--------|------------|
| `gateway/src/router.ts:262` | `if (this.isDuplicate(message))` 중복 메시지 드롭 | `router.test.ts` | **누락** | 빈 텍스트 메시지(`text: ""`) 라우팅 테스트 없음 |
| `gateway/src/router.ts:262` | `isDuplicate` 가드 | `router.test.ts` | **누락** | `channelId`가 undefined/미등록인 케이스 없음 |
| `gateway/src/router.ts:305` | `isDuplicate()` TTL 기반 dedup 로직 | `router.test.ts` | **누락** | 동시 dedup 경계 (여러 스레드가 같은 키로 동시 호출) 테스트 없음 |
| `gateway/src/router.ts:305` | attachment-only 메시지 (text 없음) | `router.test.ts` | **누락** | 첨부파일만 있고 텍스트 없는 메시지의 dedup 케이스 |
| `gateway/src/handler-registry.ts:25` | `register()` — 같은 메서드 중복 등록 | `handler-registry.test.ts` | **누락** | 동일 method 재등록 시 overwrite 동작 테스트 없음 |
| `gateway/src/handler-registry.ts:45` | `dispatch()` — 존재하지 않는 메서드 | `handler-registry.test.ts` | **누락** | 빈 문자열, 특수문자 method name dispatch 테스트 없음 |
| `gateway/src/rate-limiter.ts:47` | `check()` — 루프백 면제 / 잠금 해제 | `rate-limiter.test.ts` | **누락** | 한계 경계 동시 요청 (maxAttempts 동시 hit) 테스트 없음 |
| `gateway/src/rate-limiter.ts:32` | 생성자 — 음수 maxAttempts | `rate-limiter.test.ts` | **누락** | `maxAttempts: -1` 등 음수 설정값 테스트 없음 |
| `gateway/src/rate-limiter.ts:92` | `prune()` — 만료 레코드 정리 | `rate-limiter.test.ts` | **누락** | windowMs 경과 후 레코드 정리 동작 테스트 없음 |
| `gateway/src/session-runtime.ts:344` | `buildSessionSummary()` | `session-runtime.test.ts` | **누락** | 세션 타임아웃 처리 (비활성 세션 정리) 테스트 없음 |
| `gateway/src/session-runtime.ts:1222` | `promptSession` 동시 실행 | `session-runtime.test.ts` | **누락** | 단일 프롬프트 실행 내 동시 tool 실행 테스트 없음 |
| `gateway/src/session-runtime.ts:284` | `abortSessionEntry` | `session-runtime.test.ts` | **누락** | 프롬프트 실행 중 abort 호출 테스트 없음 |

#### 4-C. packages/gui

| SOURCE | BRANCH | TEST_FILE | STATUS | 누락 케이스 |
|--------|--------|-----------|--------|------------|
| `gui/src/runtime.ts:232` | `unsupportedResult()` — 미지원 액션 | `runtime.test.ts` | **누락** | groundingProvider가 undefined 반환 시 grounding failure 테스트 없음 |
| `gui/src/runtime.ts:461` | `parsePngDimensions()` — PNG 헤더 검증 | `runtime.test.ts` | **누락** | 유효하지 않은 PNG 데이터로 인한 스크린샷 캡처 실패 테스트 없음 |
| `gui/src/runtime.ts:536` | `pointFallsWithinImage()` — 좌표 범위 검증 | `runtime.test.ts` | **누락** | HiDPI 환경에서 소수점 좌표, 음수 좌표 엣지 케이스 테스트 없음 |

#### 4-D. 하드코딩 sleep 및 타이밍 의존성

| 파일 | 라인 | 내용 | 심각도 | 이슈 |
|------|------|------|--------|------|
| `packages/gateway/src/__tests__/session-runtime.test.ts` | 310 | `await sleep(25)` | Medium | 하드코딩 25ms 대기. CI 환경에서 간헐적 실패 가능. `vi.useFakeTimers()` + `vi.advanceTimersByTime()`으로 대체 권장 |

#### 4-E. 플랫폼 조건부 skip — 발견하기 어려운 패턴

`describe.skipIf`/`it.skipIf` 대신 삼항 연산자를 사용한 조건부 skip. 기능은 동일하나 grep에서 `skip`으로 검색 시 누락 가능.

| 파일 | 방식 | 대상 |
|------|------|------|
| `packages/tools/src/__tests__/exec-tool.test.ts:14` | `(process.platform === "win32" ? describe.skip : describe)` | 전체 describe |
| `packages/tools/src/__tests__/video-teach-analyzer.test.ts:127` | `(process.platform === "win32" ? it.skip : it)` | 개별 테스트 |

---

## 조사 영역 5: 커버리지 보고의 정확성

### 요약: 8개 이슈 발견 (High: 3, Medium: 4, Low: 1)

#### 5-A. 의미 없는 커버리지

| 파일 | 테스트 | 심각도 | 이슈 |
|------|--------|--------|------|
| `packages/gateway/src/__tests__/server.test.ts:69-77` | `assertInlineScriptsCompile` | Low | `.not.toThrow()`로 스크립트 컴파일만 확인. 실제 스크립트 기능 검증 없음 |
| `packages/core/src/__tests__/config.test.ts:83` | config 로드 테스트 | Low | `expect(typeof config.agent.mcpConfigPath).toBe("string")` — 타입만 확인, 값 미검증 |
| `packages/gateway/src/__tests__/server.test.ts:213` | 페어링 엔드포인트 | Low | `expect(typeof pairReq.body.code).toBe("string")` — 타입만 확인 |

**SNIPPET** (server.test.ts — 의미 없는 커버리지):
```typescript
// Line 75 — 컴파일은 되지만 기능은 검증 안 함
expect(() => new vm.Script(source, { filename: `${label}-${index + 1}.js` })).not.toThrow();
```

#### 5-B. Vitest 설정 이슈

**파일**: `vitest.config.ts`

| 설정값 | 현재 값 | 심각도 | 이슈 |
|--------|---------|--------|------|
| `testTimeout` | `60000` (60초) | **High** | 단위 테스트 기준 과도하게 김. 느린 테스트를 숨김. 10-30초 권장 |
| `hookTimeout` | `120000` (2분) | Medium | beforeAll/afterAll 훅 타임아웃. 과도함 |
| `coverage.include` | core, gateway, tools, channels만 포함 | **High** | `packages/gui` **완전 누락** — GUI 패키지 커버리지 추적 안 됨 |
| `coverage.include` | (동일) | **High** | `apps/cli` **누락** — 37개 CLI 테스트 파일이 커버리지에 영향 없음 |
| `coverage.exclude` | discord/\*\*, slack/\*\*, telegram/\*\*, whatsapp/\*\* | Medium | 4개 채널 구현 전체 제외. 채널 코드 커버리지가 0%로 보고됨 |
| `coverage.exclude` | `packages/gateway/src/protocol.ts` | Low | 프로토콜 타입 파일 제외 — 적절할 수 있으나 검토 필요 |
| `coverage.thresholds` | statements: 70, branches: 65, functions: 70, lines: 70 | Medium | branches 65%는 낮은 편. 70% 이상 권장 |

**SNIPPET** (vitest.config.ts):
```typescript
coverage: {
    include: [
        "packages/core/src/**/*.ts",
        "packages/gateway/src/**/*.ts",
        "packages/tools/src/**/*.ts",
        "packages/channels/src/**/*.ts",
        // ← "packages/gui/src/**/*.ts" 누락
        // ← "apps/cli/src/**/*.ts" 누락
    ],
    exclude: [
        // ...
        "packages/channels/src/discord/**",    // 채널 구현 제외
        "packages/channels/src/slack/**",
        "packages/channels/src/telegram/**",
        "packages/channels/src/whatsapp/**",
    ],
    thresholds: {
        statements: 70,
        branches: 65,  // ← 낮음
        functions: 70,
        lines: 70,
    },
},
test: {
    testTimeout: 60000,  // ← 60초, 과도
    hookTimeout: 120000, // ← 2분, 과도
}
```

#### 5-C. vitest.package.config.ts

```typescript
// 별도 패키지 단위 설정 — 더 합리적
testTimeout: 30000,  // 30초
include: ["src/**/*.test.ts"],
```

단, 이 설정은 개별 패키지 디렉토리에서 실행할 때만 사용됨. 모노레포 루트의 `vitest.config.ts`가 기본 설정.

---

## 종합 우선순위 권고

### P0 — 즉시 수정 (버그를 놓칠 위험이 높음)

| # | 이슈 | 영역 | 파일 | 이유 |
|---|------|------|------|------|
| 1 | **process.env 복원 누락** | 독립성 | `auth.test.ts` | 테스트 실행 순서에 따라 결과가 달라질 수 있음. `vi.stubEnv()` 사용 또는 `afterEach`에서 수동 복원 |
| 2 | **Mock 인터페이스 불일치** | Mock Rot | `video-teach-analyzer.test.ts` | 실제 시그니처에 `config`, `toolRegistry`, `sessionMeta` 필드가 추가되었으나 mock에 반영 안 됨. 향후 해당 필드 접근 시 테스트는 통과하나 실제로는 버그 |
| 3 | **GUI 패키지 커버리지 누락** | 커버리지 | `vitest.config.ts` | GUI 런타임(스크린샷, grounding, 네이티브 헬퍼)이 커버리지에서 완전히 제외됨 |
| 4 | **과도한 testTimeout** | 커버리지 | `vitest.config.ts` | 60초 타임아웃이 느린 테스트를 숨김. 실제 성능 회귀를 감지 불가 |

### P1 — 단기 개선 (1-2주 내)

| # | 이슈 | 영역 | 이유 |
|---|------|------|------|
| 5 | 역방향 검증 누락 — `exec-tool.test.ts` | Assertion | 타임아웃, 명령 실패, invalid input 케이스 전무 |
| 6 | 역방향 검증 누락 — `telegram-channel.test.ts` | Assertion | 4개 테스트 모두 성공 케이스. 에러 핸들링 검증 없음 |
| 7 | `toBeTruthy()` → 구체적 검증 (`exec-tool.test.ts`) | Assertion | sessionId UUID 형식 검증 필요 |
| 8 | 채널 구현 coverage.exclude 제거 | 커버리지 | discord/slack/telegram/whatsapp 코드가 0% 커버리지로 보고됨 |
| 9 | branches 임계값 65→70% 상향 | 커버리지 | 조건 분기 커버리지가 낮음 |
| 10 | 엣지 케이스 — router.ts 빈 메시지, 누락 채널 | 엣지 케이스 | 실제 운영에서 발생 가능한 입력 |
| 11 | 엣지 케이스 — rate-limiter.ts 경계값, prune | 엣지 케이스 | 동시 요청, 만료 정리 검증 없음 |
| 12 | 엣지 케이스 — session-runtime.ts abort, timeout | 엣지 케이스 | 세션 타이아웃, 실행 중 abort 미테스트 |
| 13 | 엣지 케이스 — grounding failure (runtime.ts) | 엣지 케이스 | groundingProvider가 undefined 반환 시 동작 미검증 |
| 14 | 하드코딩 `await sleep(25)` — session-runtime.test.ts | 타이밍 | CI 환경에서 간헐적 실패 가능 |

### P2 — 점진적 개선 (지속적)

| # | 이슈 | 영역 | 이유 |
|---|------|------|------|
| 15 | `toBeDefined()` 단독 사용 교체 | Assertion | 10+ 파일에서 존재만 확인. 속성 검증 추가 |
| 16 | `auth.test.ts` — 실패 경로 추가 | Assertion | invalid credentials, network error 케이스 |
| 17 | `agent.test.ts` — 실패 경로 추가 | Assertion | invalid config, 누락 의존성 케이스 |
| 18 | 부분 검증 보완 — server.test.ts 채널 객체 | Assertion | capabilities, messagingAdapter 필드 검증 |
| 19 | 부분 검증 보완 — session-runtime.test.ts cluster | Assertion | episodes 배열 내용 검증 |
| 20 | `typeof` 만 확인하는 assertion에 값 검증 추가 | Assertion | config.test.ts, server.test.ts |
| 21 | handler-registry.ts — 중복 등록, 빈 메서드명 | 엣지 케이스 | 견고성 향상 |
| 22 | memory-store.ts — 특수문자, 동시 쓰기 | 엣지 케이스 | SQLite FTS5 특수문자 처리 |
| 23 | schedule-tool.ts — invalid cron, 과거 날짜 | 엣지 케이스 | 입력 검증 |
| 24 | parsePngDimensions — invalid PNG, HiDPI 소수점 | 엣지 케이스 | GUI grounding 견고성 |
| 25 | 삼항 연산자 skip 패턴 표준화 | 플랫폼 가드 | `(cond ? describe.skip : describe)` → `describe.skipIf()`로 통일 권장 |

### 심각도 분포 요약

| 조사 영역 | High | Medium | Low | 총계 |
|-----------|------|--------|-----|------|
| 1. Assertion 품질 | 3 | 5 | 5 | 13 |
| 2. 테스트 독립성 | 1 | 1 | 1 | 3 |
| 3. Mock Rot | 1 | 1 | 0 | 2 |
| 4. 엣지 케이스 누락 | 4 | 11 | 5 | 20 |
| 5. 커버리지 정확성 | 3 | 4 | 1 | 8 |
| **총계** | **12** | **22** | **12** | **46** |

> **정정 이력 (2026-04-11)**: agent.test.ts process.env 복원 누락 → 복원 확인됨 (이슈 삭제), agent.test.ts:142 toBeDefined 단독 사용 → 후속 검증 20+개 확인됨 (Medium → 정상으로 재분류), runtime-win32.test.ts toBeDefined 15곳 → 실제로는 1-2곳만 단독 (심각도 동일)

---

## 부록: 1차 조사와의 중복 없음 확인

- ✅ as any 타입 단언 (73개 파일) — 1차에서 보고, 2차에서 재조사 안 함
- ✅ 테스트 파일 없는 소스 (82개) — 1차에서 보고, 2차에서 재조사 안 함
- ✅ 과도한 모킹 chat.test.ts (17개 vi.mock) — 1차에서 보고, 2차에서 재조사 안 함
- ✅ setTimeout 사용 (40개 파일) — 1차에서 보고, 2차에서 재조사 안 함
- ✅ 플랫폼 가드 누락 (3개 파일) — 1차에서 보고, 2차에서 재조사 안 함
