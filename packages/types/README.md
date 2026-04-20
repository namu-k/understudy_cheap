# @understudy/types

Shared type definitions and lightweight helpers for the Understudy monorepo.

## What This Package Does

Provides the TypeScript interfaces, constants, and small shared helpers used across all Understudy packages. The primary purpose is types, enums, and default values — but a few minimal runtime helpers live here when they are shared by multiple packages and must not introduce heavier cross-package dependencies.

### Channel types (`channel.ts`)

Interfaces for multi-platform messaging adapters:

- `ChannelAdapter`, `ChannelIdentity`, `ChannelCapabilities`
- `InboundMessage`, `OutboundMessage`, `Attachment`
- `ChannelAuthAdapter`, `ChannelMessagingAdapter`, `ChannelStreamingAdapter`, `ChannelGroupAdapter`
- `ChannelRuntimeStatus`, `ChannelRuntimeState`

### Tool schema types (`tool-schema.ts`)

Trust-gated tool metadata:

- `ToolRiskLevel` — `"read" | "write" | "execute" | "network" | "dangerous"`
- `ToolCategory` — `"filesystem" | "shell" | "search" | "web" | "messaging" | ...`
- `ToolEntry`, `ToolPolicy`

### Configuration types (`config.ts`)

Full configuration surface for `~/.understudy/config.json5`:

- `UnderstudyConfig` (top-level) and nested interfaces for agent, channels, tools, memory, skills, browser, gateway, plugins, and runtime policies
- `DEFAULT_CONFIG` — built-in default values

### GUI shared types (`gui.ts`)

Types shared between `packages/gui` and `packages/tools` to avoid tight coupling:

- `Win32UiaTreeNode` — UI Automation tree node shape (used by Win32 grounding and UIA target matcher)

### Grounding shared helpers (`grounding.ts`)

Types and helpers shared between `packages/gui` and `packages/tools` for grounding:

- `normalizeGuiGroundingMode()` — normalizes grounding mode input to a canonical value

## Usage

This package is internal to the Understudy monorepo and not published separately.

```typescript
import type { UnderstudyConfig, ChannelAdapter, ToolEntry, Win32UiaTreeNode } from "@understudy/types";
import { DEFAULT_CONFIG, normalizeGuiGroundingMode } from "@understudy/types";
```

## Development

```bash
pnpm build      # tsc -p tsconfig.build.json
pnpm typecheck  # tsc --noEmit
```

## License

MIT
