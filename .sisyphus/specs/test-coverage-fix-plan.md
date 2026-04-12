# 테스트 커버리지 수정 계획 — 합의 완료

**생성일**: 2026-04-11
**합의 방법**: Claude 3차 감사 + Codex 2nd opinion 교차 검증 후 이견 해소
**선행 문서**:
- `.sisyphus/specs/test-coverage-issues-round1.md` (1차 조사)
- `.sisyphus/specs/test-coverage-issues-round2.md` (2차 조사)

---

## 합의된 수정 항목 (8개)

### A. GUI 패키지 coverage 누락 [High]

**파일**: `vitest.config.ts`
**현황**: `coverage.include`에 `packages/core`, `packages/gateway`, `packages/tools`, `packages/channels`만 포함. `packages/gui` 누락.
**수정**:
```typescript
// vitest.config.ts coverage.include에 추가:
"packages/gui/src/**/*.ts",
```

---

### B. Windows exec-tool 테스트 공백 [Medium-High]

**파일**: `packages/tools/src/__tests__/exec-tool.test.ts`, `packages/tools/src/__tests__/exec-tool-shell.test.ts`
**현황**: `exec-tool.test.ts:14`에서 `(process.platform === "win32" ? describe.skip : describe)`로 전체 describe를 Windows에서 skip. `exec-tool-shell.test.ts`는 shell invocation shape만 검증. Windows에서 실제 exec lifecycle이 전혀 테스트되지 않음.
**수정**:
- Windows에서도 실행 가능한 exec-tool 통합 테스트 추가 (Windows 호환 명령어 사용, 예: `echo`, `dir`)
- 또는 기존 skip을 제거하고 플랫폼별 명령어를 조건부로 선택하는 패턴 도입

---

### C. auth.test.ts UNDERSTUDY_AGENT_DIR 복원 누락 [Medium]

**파일**: `packages/core/src/__tests__/auth.test.ts`
**현황**: `"creates file-backed auth manager under the default agent dir"` 테스트에서 `process.env.UNDERSTUDY_AGENT_DIR` 설정 후 `afterEach`에서 복원하지 않음. API key env vars는 `vi.clearAllMocks()`로 정리되나, `UNDERSTUDY_AGENT_DIR`은 직접 할당이므로 정리 안 됨.
**수정**:
```typescript
// afterEach 또는 개별 테스트의 cleanup에서:
const originalAgentDir = process.env.UNDERSTUDY_AGENT_DIR;
// ... 테스트 실행 ...
afterEach(() => {
    if (originalAgentDir === undefined) {
        delete process.env.UNDERSTUDY_AGENT_DIR;
    } else {
        process.env.UNDERSTUDY_AGENT_DIR = originalAgentDir;
    }
});
```
또는 `vi.stubEnv()` / `vi.unstubAllEnvs()` 사용 (권장 패턴, `runtime-watchdog.test.ts` 참고).

---

### D. testTimeout 60s → 30s (루트 CI) [Medium]

**파일**: `vitest.config.ts`
**현황**: 루트 설정 `testTimeout: 60000` (60초). 패키지별 `vitest.package.config.ts`는 30초. CI에서 `pnpm test` 실행 시 루트 설정이 적용되어 느린 테스트가 탐지되지 않음.
**수정**:
```typescript
// vitest.config.ts
testTimeout: 30000,  // 60s → 30s
hookTimeout: 60000,  // 120s → 60s
```
단, 실제로 30초를 초과하는 테스트가 있는지 먼저 확인 필요. `pnpm test` 실행 후 타임아웃 발생 시 해당 테스트에만 개별 timeout 설정.

---

### E. video-teach-analyzer double-close 검증 [Medium-Low]

**파일**: `packages/tools/src/video-teach-analyzer.ts`, `packages/tools/src/__tests__/video-teach-analyzer.test.ts`
**현황**: timeout callback(`:2330`)에서 `runtimeSession.close()` fire-and-forget 호출, finally(`:2351`)에서 다시 `await runtimeSession.close()`. timeout 발생 시 close가 두 번 호출됨. `.catch(() => {})`로 crash는 방지되나 idempotence 보장 불확실.
**수정**:
- timeout 테스트(`:1076,1141`)에서 `close` 호출 횟수 검증 추가:
  ```typescript
  expect(close).toHaveBeenCalledTimes(1); // 또는 toHaveBeenCalled() (idempotent한 경우)
  ```
- 소스 코드에서 close 호출 플래그 추가 검토 (선택사항)

---

### F. channels coverage.exclude 재검토 [Medium]

**파일**: `vitest.config.ts`
**현황**: `coverage.exclude`에서 `discord/**`, `slack/**`, `telegram/**`, `whatsapp/**` 전체 제외. 이 채널 코드의 커버리지가 0%로 보고됨.
**수정**:
- 옵션 1: exclude에서 제거하고 채널별 테스트 추가
- 옵션 2: 현재 상태 유지하되 의도적인 결정으로 문서화 (AGENTS.md 또는 vitest.config.ts 주석)
- 권장: 옵션 2 (채널 구현은 선택적 의존성이므로 제외가 합리적일 수 있음)

---

### G. branches 임계값 65% → 70% [Low]

**파일**: `vitest.config.ts`
**현황**: `coverage.thresholds.branches: 65`. 다른 임계값은 모두 70.
**수정**:
```typescript
thresholds: {
    statements: 70,
    branches: 70,   // 65 → 70
    functions: 70,
    lines: 70,
},
```
단, 현재 branches 커버리지가 65-70% 사이인지 먼저 확인 필요. 미달 시 점진적 상향.

---

### H. exec-tool sessionId toBeTruthy → toMatch [Low]

**파일**: `packages/tools/src/__tests__/exec-tool.test.ts`
**현황**: `expect(sessionId).toBeTruthy()` (lines 42, 81). 약한 assertion.
**주의**: sessionId는 UUID가 아님. 실제 형식은 `exec_<timestamp>_<suffix>` (`exec-sessions.ts:124`).
**수정**:
```typescript
// Before:
expect(sessionId).toBeTruthy();
// After:
expect(sessionId).toMatch(/^exec_[a-z0-9]+_[a-z0-9]+$/);
```

---

## 기각된 항목 (합의 불가, plan에서 제외)

| 항목 | 원래 주장 | 기각 사유 |
|------|----------|----------|
| orchestrator.ts 927LOC 테스트 전무 | P0 High | `orchestrator-policy.test.ts` (319 LOC)에서 전용 테스트 존재 확인 |
| Mock 인터페이스 불일치 (video-teach-analyzer) | P0 High | 누락된 config/toolRegistry/sessionMeta 필드를 실제 코드에서 사용하지 않음 |
| sessionId → UUID 검증 | P1 High | 실제 ID 형식이 `exec_<timestamp>_<suffix>`이므로 UUID 검증은 잘못된 수정 |

---

## 실행 순서 권고

1. **A** (GUI coverage 추가) — 설정 변경만으로 즉시 효과
2. **D** (testTimeout 단축) — A와 같은 파일, 함께 수정
3. **G** (branches 임계값) — A, D와 같은 파일, 함께 수정
4. **C** (auth.test.ts env 복원) — 독립적, 빠른 수정
5. **H** (exec-tool sessionId assertion) — 독립적, 빠른 수정
6. **F** (channels exclude 결정) — 의사결정 필요, 문서화 위주
7. **E** (double-close 검증) — 테스트 보강
8. **B** (Windows exec 테스트) — 가장 큰 작업량, 별도 브랜치 권장
