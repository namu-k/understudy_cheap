# Windows GUI Automation Migration Design

> **Date:** 2026-03-29
> **Status:** Draft
> **Author:** Claude + kkach
> **Background:** Understudy is a local-first teachable GUI agent runtime currently macOS-only. This spec defines the migration to support Windows 10 2004+.

## Goal

Enable Understudy's full GUI automation pipeline on Windows 10 2004+:
- Screenshot capture via Windows Graphics Capture (WGC) API
- Mouse/keyboard input injection via Win32 SendInput
- Window enumeration and management via EnumWindows
- Event recording for `/teach` demonstration recorder via SetWindowsHookEx

## Constraints

- **Target:** Windows 10 version 2004+ (build 19041+), x86_64. ARM64 is out of scope for now but the build system should support cross-compilation later.
- **No compiler dependency on end-user machines:** Pre-built `understudy-win32-helper.exe` distributed via npm or GitHub Releases
- **macOS code untouched:** All changes are additive (`if (platform === "win32")` branches). No refactoring of existing macOS code paths.
- **Same interfaces:** Existing TypeScript interfaces (`GuiGroundingProvider`, `GuiActionResult`, `RecordedEvent`) unchanged
- **Same JSON schema:** Demo recorder outputs identical `RecordedEvent[]` JSON as macOS

## Key Design Decision: How runtime.ts Integrates

The existing `runtime.ts` does NOT use an OOP interface pattern. It calls platform-specific functions directly (e.g., `performPointClick()`, `captureScreenshotArtifact()`, `resolveCaptureContext()`), which internally call `runNativeHelper()` with env vars on macOS.

**For Windows, we add parallel functions alongside macOS ones, NOT a shared interface.** This avoids refactoring macOS code:

```typescript
// runtime.ts — action methods (simplified)

async performPointClick(params: ClickParams): Promise<GuiActionResult> {
  if (process.platform === "win32") {
    return performWin32Click(params);     // new function
  }
  return performMacosClick(params);       // existing, untouched
}

async captureScreenshotArtifact(params: ScreenshotParams): Promise<string> {
  if (process.platform === "win32") {
    return captureWin32Screenshot(params); // new function
  }
  return captureMacosScreenshot(params);   // existing, untouched
}
```

**Why NOT a shared `NativeGuiHelper` interface:**
1. macOS uses env vars for parameters; Windows uses CLI args — the abstraction leaks
2. The existing macOS functions have different signatures than what a unified interface would need
3. Wrapping existing macOS code in a class is unnecessary refactoring that risks breaking it
4. The `if/else` pattern is explicit and matches how the code already works

**The `native-helper-factory.ts` module** provides the Win32 helper resolution (find/download exe) and exports convenience functions. It does NOT define a shared interface.

## Approach: Single C++ Helper Binary

macOS uses multiple external tools (`screencapture`, `swift`, `osascript`). Windows has no equivalent built-in CLIs, so all native operations go through a single `understudy-win32-helper.exe` with subcommands.

**Important:** This is a DIFFERENT invocation pattern from macOS:
- **macOS:** `execFileAsync(binaryPath, [command], { env: { UNDERSTUDY_GUI_EVENT_MODE: "...", UNDERSTUDY_GUI_X: "..." } })`
- **Windows:** `execFileAsync(helperPath, [subcommand, ...positionalArgs, ...flags])` — parameters as CLI args, not env vars

This difference is intentional. CLI args are more debuggable and testable. The TypeScript side abstracts this difference away.

### Subcommands

```
understudy-win32-helper.exe click <x> <y> [--button left|right|middle] [--count 1] [--hold-ms 0]
understudy-win32-helper.exe type <text> [--method unicode|paste]
understudy-win32-helper.exe hotkey <key> [--modifiers ctrl,alt,shift]
understudy-win32-helper.exe scroll <x> <y> <deltaX> <deltaY>
understudy-win32-helper.exe drag <fromX> <fromY> <toX> <toY> [--duration 300]
understudy-win32-helper.exe screenshot <outputPath> [--display N] [--window-title ...] [--include-cursor]
understudy-win32-helper.exe enumerate-windows [--app ...] [--title ...]
understudy-win32-helper.exe activate-window [--app ...] [--title ...]
understudy-win32-helper.exe capture-context [--app ...]
understudy-win32-helper.exe check-readiness
understudy-win32-helper.exe record-events <outputPath>
```

### Subcommand Details

#### click
- `--button`: `left` (default), `right`, `middle`
- `--count`: number of clicks (1=single, 2=double). `0` = move only (no click, no settle)
- `--hold-ms`: if > 0, performs a click-and-hold for the specified duration (maps to `click_and_hold` action intent)
- `--settle-ms`: post-move settle time before clicking (default: 150ms). Use `0` for `gui_move` action

This covers all macOS action intents:
| runtime.ts action | helper invocation |
|---|---|
| `performPointClick` | `click <x> <y>` |
| `performRightClick` | `click <x> <y> --button right` |
| `performDoubleClick` | `click <x> <y> --count 2` |
| `performHover` | `click <x> <y> --count 0 --settle-ms 300` |
| `move` (gui_move) | `click <x> <y> --count 0 --settle-ms 0` |
| `performClickAndHold` | `click <x> <y> --hold-ms <ms>` |

#### type
- `--method unicode`: Uses `SendInput` with `KEYBDINPUT` and `KEYEVENTF_UNICODE` flag — works for any Unicode text including Korean
- `--method paste`: Copies text to clipboard via `SetClipboardData()`, then sends Ctrl+V — used as fallback or for large text blocks
- `--method physical_keys`: Maps individual characters to virtual key codes via `VkKeyScanW()`, sends `KEYBDINPUT` without UNICODE flag — matches macOS `physical_keys` strategy. Used for apps that don't accept Unicode input (e.g., some games).
- `--replace`: Selects all existing text (Ctrl+A) before typing — maps to `GuiTypeParams.replace`
- `--submit`: Appends Enter key after typing — maps to `GuiTypeParams.submit`

All three methods map to `GuiTypeStrategy`: `unicode` → `system_events_keystroke`, `paste` → `clipboard_paste`, `physical_keys` → `physical_keys`.

#### hotkey
- `<key>`: Virtual key name (e.g., `Enter`, `Tab`, `Escape`, `F1`)
- `--modifiers`: Comma-separated: `ctrl`, `alt`, `shift`, `win`
- `--repeat`: Number of times to press the key combination (default: 1) — maps to `GuiKeyParams.repeat`
- Translates key names to VK codes internally

#### screenshot
- Output: PNG file via `stb_image_write.h`
- `--display N`: 1-based display index (default: primary)
- `--window-title ...`: Capture specific window instead of full display
- `--include-cursor`: Composite cursor into screenshot (off by default)
- WGC captures the cursor separately; compositing is done in C++ when this flag is set

#### scroll
- `<x> <y>`: screen coordinates to scroll at
- `<deltaX> <deltaY>`: scroll deltas
  - Positive Y = scroll UP (toward beginning), Negative Y = scroll DOWN (toward end)
  - Positive X = scroll RIGHT, Negative X = scroll LEFT
  - Unit: **lines** (matches `GuiScrollUnit.line` default in runtime.ts)
  - Implementation: one `WHEEL_DELTA` (120) per line via `MOUSEINPUT.mouseData`
- `--unit`: `line` (default) or `pixel` — maps to `GuiScrollUnit`
  - `line`: each delta unit = one `WHEEL_DELTA` increment
  - `pixel`: `deltaX/deltaY` are raw pixel counts, accumulated and sent in `WHEEL_DELTA` increments

Maps to `performScroll()` in runtime.ts which sends `UNDERSTUDY_GUI_SCROLL_UNIT` and `UNDERSTUDY_GUI_SCROLL_DELTA_X/Y`.

#### capture-context

```json
{
  "status": "ok",
  "data": {
    "displays": [
      { "index": 1, "bounds": { "x": 0, "y": 0, "width": 1920, "height": 1080 }, "scaleFactor": 1.0 }
    ],
    "cursor": { "x": 487, "y": 312 },
    "windows": [
      { "title": "Google - Chrome", "appName": "chrome", "bounds": { "x": 0, "y": 0, "width": 1920, "height": 1080 }, "pid": 1234 }
    ],
    "frontmostApp": "chrome",
    "frontmostWindowTitle": "Google - Chrome"
  }
}
```

#### check-readiness
Returns full capability report with explicit pass/fail reasons:

```json
{
  "status": "ok",
  "data": {
    "platform": "win32",
    "checks": {
      "wgc_available": {
        "status": true,
        "detail": "Windows.Graphics.Capture API available (build 26200 >= 19041)"
      },
      "sendinput_available": {
        "status": true,
        "detail": "SendInput API callable"
      },
      "ui_automation_accessible": {
        "status": true,
        "detail": "IUIAutomation COM object created successfully"
      },
      "dpi_awareness": {
        "status": "per_monitor_v2",
        "detail": "DPI awareness context: PerMonitorV2"
      },
      "is_elevated": {
        "status": false,
        "detail": "Not running as Administrator. UAC prompts may block SendInput."
      },
      "os_version": {
        "status": "10.0.26200"
      }
    }
  }
}
```

**What each check verifies:**
- `wgc_available`: Calls `RoGetActivationFactory` for `Windows.Graphics.Capture.GraphicsCaptureSession`. Pass = API present and usable.
- `sendinput_available`: Calls `SendInput` with a null input (zero count). Pass = no error return.
- `ui_automation_accessible`: Creates `IUIAutomation` COM instance via `CoCreateInstance`. Pass = UI Automation available.
- `dpi_awareness`: Reports current DPI awareness context via `GetThreadDpiAwarenessContext()`. The helper calls `SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)` at startup and reports whether it succeeded.
- `is_elevated`: Checks via `OpenProcessToken` + `GetTokenInformation(TokenElevation)`.

#### enumerate-windows
- `--app`: Matches against process executable name (case-insensitive, substring match). E.g., `--app chrome` matches `chrome.exe`.
- `--title`: Matches against window title (case-insensitive, substring match).
- Returns array of `{ title, appName, pid, bounds: {x,y,width,height} }`.

#### record-events
Long-running process. Writes `RecordedEvent[]` JSON to `<outputPath>` on termination.

- Uses `SetWindowsHookEx(WH_MOUSE_LL, WH_KEYBOARD_LL)` for global event hooks
- Windows message loop via `GetMessage()` (required for hooks to fire)
- `SetConsoleCtrlHandler` handles Ctrl+C / Ctrl+Break / Console Close events → persists JSON and exits
- **Node.js signal handling on Windows:** `child.kill()` sends `SIGTERM` which Node.js translates to `CTRL_BREAK_EVENT` on Windows. The C++ handler catches all three: `CTRL_C_EVENT`, `CTRL_BREAK_EVENT`, `CTRL_CLOSE_EVENT`.
- Same `RecordedEvent` JSON schema as macOS:

```json
[
  {
    "type": "mouse_down",
    "timestampMs": 1711706400000,
    "source": "input",
    "app": "chrome",
    "windowTitle": "Google - Chrome",
    "target": "Search | edit",
    "x": 487.0,
    "y": 312.0,
    "importance": "high"
  }
]
```

- Semantic context (app, windowTitle, target) populated via UI Automation:
  - `app`: `GetWindowThreadProcessId` → `OpenProcess` → `QueryFullProcessImageName`
  - `windowTitle`: `GetWindowText`
  - `target`: `IUIAutomation::ElementFromPoint` → `CurrentName` / `CurrentAutomationId` / `CurrentClassName`

## Data Flow: Win32 Helper → runtime.ts

The C++ helper's `capture-context` returns a flat JSON object. `win32-native-helper.ts` maps it to the existing `GuiCaptureContext` type consumed by `runtime.ts`:

```
C++ capture-context JSON           →  GuiCaptureContext (existing TypeScript type)
─────────────────────────────────────────────────────────────────────
displays[0].bounds                   →  display.bounds: { x, y, width, height }
displays[0].scaleFactor              →  display.scaleFactor: number
displays[0].index                    →  display.index: number
cursor.x, cursor.y                  →  cursor: { x, y }
frontmostApp                         →  frontmostApp: string
frontmostWindowTitle                 →  windowTitle: string
frontmostWindowBounds                →  windowBounds: { x, y, width, height }
windows.length                       →  windowCount: number
```

The mapping function in `win32-native-helper.ts`:

```typescript
function mapCaptureContext(raw: Win32CaptureContext): GuiCaptureContext {
  const primary = raw.displays[0];
  const frontWin = raw.windows.find(w => w.title === raw.frontmostWindowTitle);
  return {
    display: { index: primary.index, bounds: primary.bounds, scaleFactor: primary.scaleFactor },
    cursor: raw.cursor,
    windowId: frontWin?.hwnd?.toString(16),
    windowTitle: raw.frontmostWindowTitle,
    windowBounds: frontWin?.bounds,
    windowCount: raw.windows.length,
    windowCaptureStrategy: "wgc",
    appName: raw.frontmostApp,
  };
}
```

This ensures `runtime.ts` functions like `parseCaptureContext()`, `resolveCaptureMode()`, `buildCaptureDetails()` work unchanged on Windows.

## stdout/stderr Contract

All subcommands follow the same output protocol:

**Success** → stdout:
```json
{"status":"ok","data":{...}}
```

**Error** → stdout (not stderr):
```json
{"status":"error","code":"WGC_NOT_AVAILABLE","message":"Windows Graphics Capture requires Windows 10 2004+ (build 19041)"}
```

**Diagnostic/log messages** → stderr (free-form text, ignored by TypeScript parser)

**Exception:** `record-events` writes `RecordedEvent[]` JSON to `<outputPath>` file, not stdout. Stderr contains periodic status messages ("Recording N events...").

Error codes:
| Code | Meaning |
|------|---------|
| `WGC_NOT_AVAILABLE` | Windows Graphics Capture API not found (pre-Win10 2004) |
| `SENDINPUT_FAILED` | SendInput returned 0 (blocked by UIPI or other) |
| `WINDOW_NOT_FOUND` | No window matching --app/--title criteria |
| `DISPLAY_NOT_FOUND` | Invalid display index |
| `HOOK_INSTALL_FAILED` | SetWindowsHookEx returned NULL |
| `COM_INIT_FAILED` | CoInitializeEx failed |
| `INTERNAL_ERROR` | Unexpected exception (includes message) |

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                    runtime.ts (modified)                         │
│             ComputerUseGuiRuntime                                │
│     isGuiPlatformSupported() → darwin || win32                   │
│                                                                  │
│     Action methods:                                              │
│       if (win32) → performWin32Click(), captureWin32Screenshot() │
│       else       → existing macOS functions (untouched)          │
└────────────┬────────────────────────────┬────────────────────────┘
             │                            │
  ┌──────────▼──────────┐     ┌──────────▼──────────────────────┐
  │ macOS (unchanged)    │     │ win32 (new)                      │
  │ native-helper.ts     │     │ win32-native-helper.ts           │
  │ Swift binary         │     │ resolve/download pre-built exe   │
  │ Env vars for params  │     │ CLI args for params              │
  │ CGEvent, AXUIElement │     │ SendInput, WGC, UIA              │
  └─────────────────────┘     └──────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│           demonstration-recorder.ts (modified)                   │
│     platform branch: macOS recorder / win32 recorder             │
│     Same RecordedEvent JSON schema on both platforms             │
│                                                                  │
│     macOS: screencapture + swift event recorder                  │
│     Win32: WGC frame capture + C++ event recorder                │
│     Both produce .events.json (same schema)                      │
│     macOS: .mov video                                            │
│     Win32: .mp4 video (ffmpeg)                                   │
└────────────────────────────────────────────────────────────────┘
```

## File Structure

### New files

```
packages/gui/src/
├── win32-native-helper.ts              # Resolve/download exe, exec subcommands, convenience functions
├── win32-demonstration-recorder.ts     # createWin32DemonstrationRecorder()
├── __tests__/
│   ├── win32-native-helper.test.ts
│   └── win32-demonstration-recorder.test.ts

packages/gui/native/win32/              # C++ source (outside src/, not processed by tsc)
├── main.cpp                            # Subcommand routing
├── input.cpp / input.h                 # click, type, hotkey, scroll, drag (SendInput)
├── capture.cpp / capture.h             # screenshot (WGC → PNG via stb_image_write)
├── windows.cpp / windows.h             # enumerate-windows, activate-window (EnumWindows)
├── context.cpp / context.h             # capture-context (combined metadata)
├── readiness.cpp / readiness.h         # check-readiness (all capability checks)
├── event_recorder.cpp / event_recorder.h  # record-events (SetWindowsHookEx + message loop)
├── json_output.h                       # {"status":"ok|error",...} format helpers
├── stb_image_write.h                   # Single-header PNG encoding
└── CMakeLists.txt                      # MSVC build configuration
```

### Modified files

```
packages/gui/src/runtime.ts             # platform branch in each action method
packages/gui/src/readiness.ts           # win32 branch in inspectGuiEnvironmentReadiness()
packages/gui/src/capabilities.ts        # platformSupported: darwin || win32, platform-specific messages
packages/gui/src/demonstration-recorder.ts  # platform branch for recorder selection
packages/gui/src/index.ts               # Export new modules:
                                        #   createWin32DemonstrationRecorder,
                                        #   resolveWin32Helper (if needed externally)
```

## TypeScript Type Definitions

The following types are defined in `win32-native-helper.ts` to match the existing TypeScript schemas:

```typescript
/** Matches the existing GuiCaptureContext fields used in runtime.ts */
interface Win32CaptureContext {
  displays: Array<{ index: number; bounds: { x: number; y: number; width: number; height: number }; scaleFactor: number }>;
  cursor: { x: number; y: number };
  windows: Array<{ title: string; appName: string; pid: number; bounds: { x: number; y: number; width: number; height: number } }>;
  frontmostApp: string;
  frontmostWindowTitle: string;
}

/** Window info returned by enumerate-windows */
interface Win32WindowInfo {
  title: string;
  appName: string;     // process executable name (e.g., "chrome.exe")
  pid: number;
  bounds: { x: number; y: number; width: number; height: number };
}

/** Readiness check result */
interface Win32ReadinessReport {
  wgc_available: boolean;
  sendinput_available: boolean;
  ui_automation_accessible: boolean;
  dpi_awareness: string;    // "per_monitor_v2" | "per_monitor" | "system" | "unaware"
  is_elevated: boolean;
  os_version: string;
}
```

## Binary Distribution

`win32-native-helper.ts` resolves the helper exe:

1. Check `UNDERSTUDY_WIN32_HELPER_PATH` env var (explicit override)
2. Check `packages/gui/native/win32/bin/understudy-win32-helper.exe` (bundled in npm package)
3. Check `%LOCALAPPDATA%/understudy/bin/understudy-win32-helper.exe` (cached download)
4. Download from GitHub Releases if not found, cache to step 3 location
5. Verify SHA256 hash

**SHA256 verification:**
- Hash source: `SHA256SUMS.txt` downloaded alongside the exe from GitHub Releases
- Format: `<hash>  understudy-win32-helper.exe` (standard shasum format)
- Behavior on failure: Throw error with clear message. Do not silently proceed. User can override by setting `UNDERSTUDY_WIN32_HELPER_PATH` explicitly.

**Version pinning:**
- `UNDERSTUDY_WIN32_HELPER_VERSION` env var pins to a specific release tag (e.g., `v1.2.0`)
- Default: `latest` — resolves to the most recent GitHub Release

## Capabilities — Platform-Specific Behavior

`capabilities.ts` needs platform-specific permission messages:

```typescript
// macOS (existing)
const GUI_ACCESSIBILITY_REQUIRED_REASON =
  "Accessibility permission is not granted. " +
  "Grant Accessibility permission in System Settings > Privacy & Security > Accessibility.";

// Windows (new)
const GUI_WIN32_INPUT_REQUIRED_REASON =
  "GUI input injection may require running as Administrator if interacting with elevated processes. " +
  "Run understudy from an elevated terminal if SendInput fails on UAC dialogs.";

const GUI_WIN32_CAPTURE_REQUIRED_REASON =
  "Screen capture requires Windows Graphics Capture capability (Windows 10 2004+). " +
  "Ensure your Windows version is up to date.";
```

`readiness.ts` — `buildCaptureDetails` on Windows reports `capture_method: "win32_helper"` (vs macOS's `"screencapture"`).

## Demonstration Recorder

`createWin32DemonstrationRecorder()` follows same architectural pattern as macOS:

1. **Event recording**: spawn `understudy-win32-helper.exe record-events <path>` — long-running process
2. **Video**: WGC periodic frame capture → written as frames → ffmpeg encodes to `.mp4`
   - Output format: MP4 (H.264) — the macOS recorder produces `.mov`; both are playable by downstream /teach pipeline
   - Fallback: single screenshot → ffmpeg creates 1-second still video
3. **Fallback event log**: if event recorder fails to persist output, write minimal `RecordedEvent[]` with `recording_started` / `recording_stopped` events
4. **Same `RecordedEvent` JSON schema** — downstream /teach pipeline works unchanged

```typescript
// demonstration-recorder.ts modification:
function createRecorderForPlatform(deps: RecorderDeps): GuiDemonstrationRecorder {
  if (deps.platform === "win32") return createWin32DemonstrationRecorder(deps);
  return createMacosDemonstrationRecorder(deps);
}
```

## Phase Breakdown

### Phase 1: Minimum Working Pipeline + Demo Recorder

**Goal:** Screenshot, click, type, drag, scroll, hotkey, and /teach recording on Windows

| Component | Subcommands |
|-----------|-------------|
| C++ helper | `click`, `type`, `hotkey`, `scroll`, `drag`, `screenshot`, `capture-context`, `check-readiness`, `record-events` |
| TypeScript | `win32-native-helper.ts` (resolve/download exe, convenience functions), `win32-demonstration-recorder.ts` |
| runtime.ts | `isGuiPlatformSupported()` win32, each action method gets `if (win32)` branch |
| readiness.ts | win32 branch via `check-readiness` |
| capabilities.ts | `platformSupported` expansion, platform-specific messages |
| Demo recorder | `createWin32DemonstrationRecorder()` |

### Phase 2: Window Management + Advanced

| Component | Subcommands |
|-----------|-------------|
| C++ helper | `enumerate-windows`, `activate-window` |
| runtime.ts | Window selection/activation (EnumWindows matching) |
| HiDPI | DPI scaling for Per-Monitor V2 — coordinate conversion in input.cpp |
| Multi-monitor | Display enumeration via `EnumDisplayMonitors`, per-display capture |

### Phase 3: Advanced Features

| Component | Description |
|-----------|-------------|
| UI Automation | Accessibility tree queries (AXUIElement equivalent) |
| Site graph | /teach event + screenshot → auto skill generation |
| Real E2E tests | `.real.test.ts` on actual Windows GUI |

## Windows API Reference

| Operation | API | Header | Notes |
|-----------|-----|--------|-------|
| Mouse/keyboard input | `SendInput()` | `<windows.h>` | Primary input method |
| Mouse events | `MOUSEINPUT` struct | `<windows.h>` | MOVE, LEFTDOWN, LEFTUP, WHEEL |
| Keyboard events | `KEYBDINPUT` struct | `<windows.h>` | UNICODE flag for text input |
| Screenshot | `Windows.Graphics.Capture` | `<windows.graphics.capture.h>` | Win10 2004+, C++/WinRT |
| Window enumeration | `EnumWindows()` | `<windows.h>` | Callback-based iteration |
| Window info | `GetWindowText()`, `GetWindowRect()` | `<windows.h>` | Title, class, bounds |
| Process info | `GetWindowThreadProcessId()` | `<windows.h>` | Owner PID |
| Event hooks | `SetWindowsHookEx()` | `<windows.h>` | WH_MOUSE_LL, WH_KEYBOARD_LL |
| Message loop | `GetMessage()` | `<windows.h>` | Required for hooks |
| Signal handling | `SetConsoleCtrlHandler()` | `<windows.h>` | CTRL_C, CTRL_BREAK, CLOSE |
| DPI awareness | `SetProcessDpiAwarenessContext()` | `<windows.h>` | Per-Monitor V2 |
| Display info | `EnumDisplayMonitors()` | `<windows.h>` | Multi-monitor support |
| Process name | `QueryFullProcessImageName()` | `<windows.h>` | For app matching |
| Clipboard | `SetClipboardData()`, `OpenClipboard()` | `<windows.h>` | For paste-type method |
| UI Automation | `IUIAutomation` COM | `<uiautomation.h>` | For element-from-point queries |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `UNDERSTUDY_WIN32_HELPER_PATH` | (auto-resolved) | Explicit path to helper exe |
| `UNDERSTUDY_WIN32_HELPER_VERSION` | (latest) | Pin to specific helper version |
| `UNDERSTUDY_WIN32_HELPER_DOWNLOAD_URL` | (GitHub Releases) | Custom download URL for air-gapped environments |

## Testing Strategy

1. **Unit tests** — mock `execFile`, verify subcommand args and JSON parsing
2. **Platform-gated tests** — `it.skipIf(process.platform !== "win32")` for real API calls
3. **C++ unit tests** — separate test runner for native code (optional, Phase 2+)
4. **E2E tests** — `.real.test.ts` with actual GUI interactions (Phase 3)

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| WGC API doesn't capture certain apps (UWP, hardware-accelerated) | Medium | High | GDI BitBlt fallback path in `capture.cpp` |
| UAC elevated processes block SendInput | Low | Medium | Document admin requirement; detect via `is_elevated` check |
| HiDPI coordinate mismatch | High | Medium | DPI-aware coordinate conversion in input.cpp; per-monitor scaling |
| SetWindowsHookEx blocked by security software | Low | High | Fallback to polling-based event recording |
| Pre-built binary size | Low | Low | Static linking estimate ~2-5MB; acceptable |

## Out of Scope

- Windows 7/8 support (WGC requires Win10 2004+)
- ARM64 binaries (build system should support cross-compilation later)
- Linux GUI migration (separate future effort, AT-SPI + X11/Wayland)
- Remote desktop (RDP) session capture
- Touch/pen input
- Multi-session (Terminal Services) support
