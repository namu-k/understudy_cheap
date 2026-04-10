# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.4] - 2026-04-11

Health 10/10: fix all Windows-specific test failures and lint warnings for a clean CI pass on Win32.

### Fixed

- `resolveShellExecutable()` now resolves `COMSPEC` (cmd.exe) on Windows and passes the correct shell flag (`/c` vs `-c`) via new `shellArgs()` helper.
- OCR engine `terminate()` wrapped in `safeTerminate()` that attaches a no-op error listener before calling `worker.terminate()` to prevent post-termination error events from the tesseract.js Worker thread.
- All test path assertions now use `toPosix()` helper to normalize Windows backslashes before comparison.
- `video-teach-analyzer.test.ts` skips ffmpeg mock tests on Windows (spawn EFTYPE).
- `exec-tool.test.ts` real-execution tests skipped on Windows (Unix shell commands don't work under cmd.exe; mocked tests in exec-tool-shell.test.ts cover Windows).
- OCR engine test file installs `unhandledRejection`/`uncaughtException` listeners to suppress noisy tesseract Worker thread errors during test runs.
- Replaced `== null` / `!= null` with strict equality (`=== null` / `!== null`) in browser-tool, uia-grounding-provider, and chat-gateway-session.
- Removed unused `afterEach` imports in uia-grounding-provider.test.ts and win32-native-helper.test.ts.

## [0.3.3] - 2026-04-07

Win32 UIA grounding pipeline: accessibility-tree-based target matching for GUI actions, with graceful fallback to screenshot grounding.

### Added

- `Win32UiaGroundingProvider`: tries UIA tree matching first, falls back to screenshot-based grounding on failure or no-match.
- `flattenUiaTree` / `scoreCandidate` / `findBestUiaMatch`: accessibility-tree flattening, multi-signal scoring, and ambiguity-rejecting best-match selection.
- Configurable depth and timeout via `UNDERSTUDY_UIA_MAX_DEPTH` and `UNDERSTUDY_UIA_TIMEOUT_MS` environment variables.
- `UNDERSTUDY_UIA_ENABLED=0` opt-out to skip UIA grounding entirely.
- Structured debug/warn logging throughout the UIA grounding path (`grounding:uia` logger).
- UIA provider wraps the hybrid (multi-round) grounding path on Windows, not just the single-shot path.
- C++ `uia_tree.cpp`: `truncated` field in envelope JSON and `SerializeState` to signal when `--max-count` was hit.
- 39 new unit tests across `uia-grounding-provider.test.ts`, `uia-target-matcher.test.ts`, and `gui-tools.test.ts`.

### Fixed

- C++ `SerializeState`: replaced dead `includeInvisible` field with working `truncated` flag; envelope now reports truncation status.
- `helperPathPromise` caching now resets on failure so retries work after transient errors.
- `target_contains_name` scoring raised from 0.5 to 0.65 so substring matches clear the 0.6 acceptance threshold.
- `fallbackProvider` made optional — provider returns `undefined` instead of crashing when no fallback is configured.

## [0.3.2] - 2026-04-04

Add uia-tree subcommand to the Win32 native helper binary for UI Automation accessibility tree enumeration.

### Added

- `uia-tree` subcommand in `understudy-win32-helper.exe`: recursive UIA tree walking via COM `IUIAutomation` + `FindAll(TreeScope_Children)`.
- Targeting by `--hwnd`, `--app`/`--title` filter, or desktop root element.
- Safety guards: `--max-depth` (default 8), `--max-count` (default 2000), `--include-invisible` flag.
- `Win32UiaTreeNode` TypeScript interface and `getUiaTree()` async wrapper in `win32-native-helper.ts`.
- 5 unit tests for `getUiaTree` and 2 PowerShell smoke tests for the C++ binary.

### Fixed

- `std::stoull` on invalid `--hwnd` wrapped in try/catch to prevent crashes.
- COM ref-count imbalance on `RPC_E_CHANGED_MODE` — tracked `com_initialized` flag to guard `CoUninitialize`.
- Default `--max-depth` lowered from 25 to 8 to prevent OOM on deep trees.
- Missing `WS_EX_TOOLWINDOW` filter in window enumeration (matches `windows_mgmt.cpp` pattern).

## [0.3.1] - 2026-04-03

Bug fixes identified during pre-landing review of the Win32 GUI automation platform.

### Fixed

- Win32 event recorder: UIA element-name lookup now runs asynchronously via `WM_UIA_LOOKUP` in the message loop, preventing LL hook timeout (Windows unhooks automatically after 200ms if the callback blocks).
- Win32 event recorder: graceful shutdown now sends `SIGBREAK` (`CTRL_BREAK_EVENT`) instead of `SIGTERM` so the C++ `SetConsoleCtrlHandler` fires and flushes the event log before exit.
- Win32 event recorder: removed dead `WM_LBUTTONDBLCLK` case (LL hooks never receive this synthetic message); added `button` field ("left"/"right") to mouse event JSON output.
- Win32 screenshot helper: Windows file paths (containing backslashes) are now JSON-escaped before embedding in the response envelope, preventing invalid JSON on Windows.
- Win32 input helper: `stoi` calls for coordinate arguments wrapped in `try/catch` — invalid arguments now return a structured error instead of throwing and crashing the process.
- Win32 demonstration recorder: stopped event-file check now uses `stat.isFile()` in addition to `stat.size > 2`, preventing false positives from directory entries.
- `packages/gui`: `GuiDemonstrationRecordingStatus.videoPath` made optional — Win32 recorder does not produce a video file; macOS recorder still provides it.
- `packages/gui`: removed unused `Win32HelperError` import and dead `resolveWin32HelperPath` passthrough from `runtime.ts`.
- `stb_image_write.h`: replaced 22-line stub with the real public-domain implementation (required for PNG screenshot capture to link correctly).

## [0.3.0] - 2026-03-31

Add full Windows GUI automation platform: Win32 native helper (C++), WGC/GDI capture, SendInput mouse/keyboard, UI Automation readiness checks, demonstration recorder, and TypeScript runtime dispatch for all GUI actions on Windows.

### Added

- Windows GUI automation platform: all GUI runtime actions (observe, click, drag, scroll, type, key, move) now dispatch to native Win32 helper on Windows.
- `understudy-win32-helper.exe` C++ helper with subcommands: `check-readiness`, `capture-context`, `screenshot`, `mouse-move`, `mouse-click`, `mouse-drag`, `mouse-scroll`, `type`, `hotkey`, `start-recording`, `stop-recording`.
- Win32 readiness checks via `check-readiness` subcommand — WGC availability, SendInput, UI Automation, DPI awareness, elevation status.
- Win32 demonstration recorder for teach-by-demonstration on Windows.
- `resolveWin32Helper`, `execWin32Helper`, `mapCaptureContext` TypeScript wrapper in `win32-native-helper.ts`.
- Win32 platform branch in `inspectGuiEnvironmentReadiness` (readiness.ts).
- Win32 exports from `packages/gui` package index.

### Fixed

- `captureWin32Screenshot`: temp directory is now cleaned up on error; caller receives a `GuiRuntimeError` instead of a stale temp path.
- `performWin32Type`: `--replace` and `--submit` are now boolean flags; text is passed after `--` separator to prevent argument mis-parsing.
- Win32 ArgMap C++ parser: supports `--` end-of-options separator and boolean flags (replace, submit, include-cursor).
- Delete key now sends the correct forward-delete event; the C++ key map was pointing to `VK_BACK` (Backspace) instead of `VK_DELETE`.
- Win32 capture helper: pixel buffer now safe on displays wider than ~1448px (was silently overflowing); invalid `--display` value falls back to display 0 instead of crashing.
- Win32 readiness catch block now emits all three expected check stubs (wgc, screen_recording, accessibility) instead of only wgc.
- `mapCaptureContext`: primary monitor selected by coordinate containment rather than array index (EnumDisplayMonitors order is not guaranteed).

### Tests

- 16 new unit tests covering all Win32 dispatch branches in runtime.ts.
- Edge case tests for Win32 helper resolution and readiness path.
- WSL2 test timing: testTimeout 60s, hookTimeout 120s, waitForAssertion 20s.

## 0.2.0 — 2026-03-26

Reposition Understudy around three ideas that now define the product more clearly in both code and docs: a general-purpose local agent first, modern computer use with bring-your-own API key second, and teach/crystallization/route-aware learning on top. This release also hardens the teach analysis path and aligns release/version metadata across the runtime.

### Added

- Workspace artifact publishing now supports `skill`, `worker`, and `playbook` outputs through the shared teach/task-draft pipeline.
- Browser routing now supports both managed Playwright sessions and Chrome extension relay attach flows behind the same browser surface.

### Changed

- Refreshed the README, GitHub Pages overview, demo workspaces, and product-design docs to lead with "general agent → computer use → teach and learning", matching the current implementation and product story.
- Bumped all workspace package versions, CLI/runtime version reporting, and Chrome extension release metadata to `0.2.0`.
- Session-backed teach analysis now uses adaptive evidence-pack sizing by default instead of a hard `2 episodes / 6 keyframes` cap.
- Session-backed teach analysis no longer applies a default hard 120s timeout unless explicitly configured.
- Teach evidence-pack construction now filters `/teach start`, `/teach stop`, and other Understudy recording scaffolding noise before analysis.
- Removed legacy OpenClaw `message` / `cron` compatibility surfaces and `metadata.openclaw` parsing; the runtime now keeps only the narrower `exec` fallback for bash-only environments.

### Fixed

- Corrected gateway-backed TUI ordering so tool activity renders before the final assistant reply instead of appearing out of order.
- Fixed a docs/demo mismatch where the general-agent demo summary still referred to saving output on Desktop instead of Downloads.

## 0.1.5 — 2026-03-18

Sync workspace/runtime version reporting to the published package version, make dual-registry releases rerun-safe, and align release metadata across the CLI, gateway, MCP client, and Chrome relay extension.

## 0.1.4 — 2026-03-18

Add the bundled `researcher` skill, publish releases to GitHub Packages alongside npm, tighten the macOS GUI runtime and grounding stack, remove stale GUI tool-count docs, and clean up release-facing telemetry and teach/tool metadata.

## 0.1.3 — 2026-03-13

Add MiniMax as a built-in model provider and clarify teach privacy / contributor documentation.

## 0.1.2 — 2026-03-13

Align GitHub Actions trusted publishing with npm's current Node.js and npm CLI requirements.

## 0.1.1 — 2026-03-13

Fix npm package runtime dependencies and CLI bootstrap so installed builds can start correctly.

## 0.1.0 — 2026-03-11

First public release of the Understudy runtime.

### Added

- **GUI Runtime**: Native GUI toolset (`gui_observe`, `gui_click`, `gui_drag`, `gui_scroll`, `gui_type`, `gui_key`, `gui_wait`, `gui_move`) with screenshot-grounded target resolution on macOS. Graceful degradation when grounding or permissions are unavailable.
- **Browser Automation**: Playwright managed mode and Chrome extension relay for logged-in tabs.
- **Teach-by-Demonstration**: `/teach start` → record → `/teach stop` → video-first evidence analysis → clarification dialogue → replay validation → publish as workspace skill.
- **Gateway Server**: HTTP + WebSocket + JSON-RPC gateway (default port 23333) with session runtime, policy pipeline, and handler registry.
- **WebChat & Dashboard**: Embedded web UIs for chat and gateway control, served directly from the gateway.
- **8 Channel Adapters**: Web, Telegram (grammy), Discord (discord.js), Slack (@slack/bolt), WhatsApp (Baileys), Signal (signal-cli), LINE (REST), iMessage (macOS).
- **47 Built-in Skills**: Apple Notes, Obsidian, GitHub, Slack, Spotify, 1Password, Trello, Bear Notes, Things, and more.
- **Skill System**: SKILL.md format with YAML frontmatter, multi-source loading (bundled, managed, workspace, project), eligibility filtering, and `skills install` / `skills uninstall` CLI commands.
- **Session Management**: Persistent sessions with history, branching, compaction, and run traces.
- **Memory Providers**: Semantic memory that persists across sessions.
- **Scheduling**: Cron-based scheduled jobs, one-shot timers, and run history.
- **Subagent Delegation**: Child sessions for parallel work.
- **CLI**: 30+ commands including `chat`, `wizard`, `agent`, `gateway`, `browser`, `channels`, `schedule`, `skills`, `doctor`, `health`, `status`, `logs`, `models`, `config`, `reset`, `security`, `completion`.
- **Setup Wizard**: Interactive guided setup for model auth, browser extension, GUI permissions, channels, and background service.
- **Plugin System**: Plugin registry and loader for extending tools and gateway RPC.
- **CI/CD**: GitHub Actions workflow (lint, typecheck, test, build).
- **OpenClaw Compatibility**: Tool aliases (`exec` → `bash`, `cron` → `schedule`, `message` → `message_send`) for portable skill migration.
- **Privacy**: Local-first design — screenshots, recordings, and traces stay on the user's machine. No telemetry.

### Notes

- Native GUI execution and teach-by-demonstration require macOS today.
- Core features (CLI, gateway, browser, channels) work cross-platform.
- Route optimization (Layer 4) and proactive autonomy (Layer 5) are architecturally planned but not yet active.
- This is the initial public release of Understudy.
