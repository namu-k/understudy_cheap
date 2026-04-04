# TODOS

Deferred work captured during `/plan-eng-review` on 2026-04-01.

---

## ~~TODO-1: Windows CI runner job in ci.yml~~ DONE

**Status:** DONE — `test-windows` job added to `.github/workflows/ci.yml`.

---

## ~~TODO-2: `--stop-after-ms N` flag for `record-events` subcommand~~ DONE

**Status:** DONE — `--stop-after-ms N` flag added to `event_recorder.cpp`.

---

## TODO-3: Read-only UIA enumeration subcommand (`uia-tree`)

**What:** Add a `uia-tree` subcommand to `packages/gui/native/win32/windows_mgmt.cpp` that enumerates the UI Automation accessibility tree for a given window. Output: JSON array of control elements with `controlType`, `name`, `boundingRect`, `automationId`, `isEnabled`, `isVisible`.

**Why:** Screenshot grounding (pixel-based coordinate targeting) is the current approach. Research shows ~10-15% of Win32 apps are "UIA-dark" (legacy apps, game engines, Electron without a11y enabled), but the remaining 85-90% have accessible UIA trees. Teachable task replay without semantic anchors is brittle under DPI shifts, UI theme changes, and window moves. UIA provides stable identifiers that survive visual changes.

**Pros:** Significantly improves replay reliability for the 85% of apps with accessible UIA trees. Enables hybrid grounding strategy (UIA first, vision fallback for UIA-dark apps) — the approach adopted by UFO2, Windows-Use, Agent-S. COM STA threading is already handled by the out-of-process binary architecture (Node.js doesn't need to manage a COM apartment).

**Cons:** WinRT/UIA COM complexity in C++. Requires `uiautomation.h` / `UIAutomationClient.h` and linking `uiautomationcore.lib`. Testing UIA output requires a real accessibility tree, which means CI testing is limited.

**Context:** Codex second opinion (office-hours session, 2026-04-01) rated this the highest-risk deferred item — called it "minimum viable reliability layer" rather than a future enhancement. The Understudy differentiator ("teachable tasks") depends on replay robustness. UIA is the missing piece that makes replay robust enough to trust across UI changes.

**Depends on:** Nothing — standalone new subcommand. Can be developed independently of WGC implementation.
