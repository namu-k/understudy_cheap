# TODOS

Deferred work captured during `/plan-eng-review` on 2026-04-01.

---

## TODO-1: Windows CI runner job in ci.yml

**What:** Add a `test-windows` job to `.github/workflows/ci.yml` using a `windows-latest` runner that builds the Win32 helper binary and runs the non-destructive subset of `test-smoke.ps1` automatically on every PR.

**Why:** Currently no Windows automation exists. Binary regressions are caught only by manual runs. The smoke script written in Task 10 of the bring-up plan is CI-ready for its non-destructive tests.

**Pros:** Automatic regression detection on every PR touching `packages/gui/native/win32/**` or `packages/gui/src/**`.

**Cons:** Requires Windows runner time (GitHub Actions billing if repo is private). WGC API likely unavailable in headless CI — only GDI screenshot tests will pass. Need to pin Windows SDK version.

**Context:** The smoke script (`test-smoke.ps1`) must exist in the repo first (committed in the Win32 bring-up plan). The CI job is ~20 lines of YAML. Pin `windows-sdk-version: 10.0.19041.0` in the job to ensure WGC-related code compiles even if the runtime check fails.

**Depends on:** Task 10 of `docs/superpowers/plans/2026-03-31-win32-build-and-smoke-test.md` (smoke script committed).

---

## TODO-2: `--stop-after-ms N` flag for `record-events` subcommand

**What:** Add a `--stop-after-ms N` argument to the `record-events` subcommand in `packages/gui/native/win32/event_recorder.cpp`. After N milliseconds, the recorder stops cleanly and flushes the event file without requiring an external kill signal.

**Why:** The current approach (run recorder until `taskkill /PID` without `/F`) relies on graceful console handler invocation. When launched via `Start-Process -PassThru`, session association is not guaranteed across all Windows versions — some may degrade to force-kill, causing the event file to not be flushed. The `realEvents.length > 0` success criterion in the smoke test plan depends on graceful shutdown.

**Pros:** Eliminates session-association ambiguity. Makes the event recorder testable deterministically (no kill signal needed). Enables headless/CI usage of the recorder in future.

**Cons:** None meaningful — ~20 lines in `event_recorder.cpp`. No TypeScript changes needed.

**Context:** The out-of-process binary architecture already handles process lifecycle correctly on the TypeScript side (`win32-demonstration-recorder.ts`). The fix is purely in the C++ binary. A simple `SetTimer` or `std::thread` sleep + stop flag would work.

**Depends on:** Nothing (standalone enhancement to the binary).

---

## TODO-3: Read-only UIA enumeration subcommand (`uia-tree`)

**What:** Add a `uia-tree` subcommand to `packages/gui/native/win32/windows_mgmt.cpp` that enumerates the UI Automation accessibility tree for a given window. Output: JSON array of control elements with `controlType`, `name`, `boundingRect`, `automationId`, `isEnabled`, `isVisible`.

**Why:** Screenshot grounding (pixel-based coordinate targeting) is the current approach. Research shows ~10-15% of Win32 apps are "UIA-dark" (legacy apps, game engines, Electron without a11y enabled), but the remaining 85-90% have accessible UIA trees. Teachable task replay without semantic anchors is brittle under DPI shifts, UI theme changes, and window moves. UIA provides stable identifiers that survive visual changes.

**Pros:** Significantly improves replay reliability for the 85% of apps with accessible UIA trees. Enables hybrid grounding strategy (UIA first, vision fallback for UIA-dark apps) — the approach adopted by UFO2, Windows-Use, Agent-S. COM STA threading is already handled by the out-of-process binary architecture (Node.js doesn't need to manage a COM apartment).

**Cons:** WinRT/UIA COM complexity in C++. Requires `uiautomation.h` / `UIAutomationClient.h` and linking `uiautomationcore.lib`. Testing UIA output requires a real accessibility tree, which means CI testing is limited.

**Context:** Codex second opinion (office-hours session, 2026-04-01) rated this the highest-risk deferred item — called it "minimum viable reliability layer" rather than a future enhancement. The Understudy differentiator ("teachable tasks") depends on replay robustness. UIA is the missing piece that makes replay robust enough to trust across UI changes.

**Depends on:** Nothing — standalone new subcommand. Can be developed independently of WGC implementation.
