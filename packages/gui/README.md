# @understudy/gui

Native GUI runtime for Understudy — screenshot-grounded desktop automation.

## What This Package Does

- **GUI action execution**: 8 tool-facing actions (`observe`, `click`, `drag`, `scroll`, `type`, `key`, `wait`, `move`) with click sub-modes for right-click, double-click, hover-only, and click-and-hold
- **Screenshot grounding**: LLM-based target resolution from screenshots via pluggable `GuiGroundingProvider`
- **Native helper**: Swift-based macOS binary for window enumeration, accessibility queries, and input events
- **Graceful degradation**: dynamically disables tools based on available permissions (Accessibility, Screen Recording)
- **Demonstration recorder**: screen + event capture for teach-by-demonstration workflows
- **Readiness checks**: platform detection, permission status, and native helper availability

## Platform Support

| Capability | macOS | Linux | Windows |
|-----------|:-----:|:-----:|:-------:|
| Screenshot capture | Yes | Planned | Yes |
| Native input events | Yes | Planned | Yes |
| Window enumeration | Yes | Planned | Yes |
| Demonstration recording | Yes | Planned | Yes |
| UIA tree enumeration | — | — | Yes |
| UIA-based grounding | — | — | Yes |

The type-level abstractions (`GuiActionResult`, `GuiObservation`, `GuiGroundingProvider`) are platform-agnostic. macOS uses Swift compiled at runtime. Windows uses a pre-compiled C++ binary with UIA tree-based grounding as the primary path and screenshot grounding as fallback.

## Key Files

| File | Purpose |
|------|---------|
| `runtime.ts` | `ComputerUseGuiRuntime` — main execution engine |
| `types.ts` | Action types, observation types, grounding provider interface |
| `capabilities.ts` | Platform detection and feature flags |
| `readiness.ts` | Permission and dependency readiness checks |
| `native-helper.ts` | macOS Swift native helper compilation and invocation |
| `win32-native-helper.ts` | Windows native helper (UIA tree enumeration, screenshot capture, input injection) |
| `demonstration-recorder.ts` | macOS screen recording + event capture for teach flows |
| `win32-demonstration-recorder.ts` | Windows demonstration recording |

## Development

```bash
pnpm build      # tsc -p tsconfig.build.json
pnpm typecheck  # tsc --noEmit
pnpm test       # vitest
```
