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
