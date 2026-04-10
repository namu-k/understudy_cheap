# TODOS

Deferred work captured during `/plan-eng-review` on 2026-04-01.

---

## ~~TODO-1: Windows CI runner job in ci.yml~~ DONE

**Status:** DONE — `test-windows` job added to `.github/workflows/ci.yml`.

---

## ~~TODO-2: `--stop-after-ms N` flag for `record-events` subcommand~~ DONE

**Status:** DONE — `--stop-after-ms N` flag added to `event_recorder.cpp`.

---

## ~~TODO-3: Read-only UIA enumeration subcommand (`uia-tree`)~~ DONE

**Status:** DONE — `uia-tree` subcommand implemented in `packages/gui/native/win32/uia_tree.cpp`. Targets windows by `--hwnd`, `--app`, or `--title` with `--max-depth` (default 8) and `--max-count` (default 2000) guards. TypeScript wrapper `getUiaTree()` and `Win32UiaTreeNode` interface in `win32-native-helper.ts`. Smoke tests in `test-smoke.ps1`, unit tests in `win32-native-helper.test.ts`.

---

## ~~TODO-4: UIA grounding pipeline (target matcher + hybrid wiring)~~ DONE

**Status:** DONE — `Win32UiaGroundingProvider` in `packages/tools/src/uia-grounding-provider.ts` tries UIA tree matching first, falls back to screenshot-based grounding. Target matcher (`uia-target-matcher.ts`): `flattenUiaTree` / `scoreCandidate` / `findBestUiaMatch` with multi-signal scoring and ambiguity rejection. Wired into hybrid grounding path via `gui-tools.ts` → `createDefaultGuiRuntime()`. Configurable via `UNDERSTUDY_UIA_ENABLED`, `UNDERSTUDY_UIA_MAX_DEPTH`, `UNDERSTUDY_UIA_TIMEOUT_MS`. 39 unit tests across 3 test files.
