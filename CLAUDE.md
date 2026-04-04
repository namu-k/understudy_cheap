# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install          # install all workspace dependencies
pnpm build            # compile all packages (tsc)
pnpm lint             # oxlint
pnpm typecheck        # TypeScript strict check across all packages
pnpm test             # vitest unit + integration tests
pnpm test:coverage    # with v8 coverage (70% threshold)
pnpm check            # full CI validation: build + lint + typecheck + test + pack check
pnpm clean            # remove all dist/ and build artifacts
```

**Run a single test file:**
```bash
pnpm vitest run packages/core/src/some-feature.test.ts
```

**Run tests matching a pattern:**
```bash
pnpm vitest run --reporter=verbose -t "pattern"
```

**Runtime:**
```bash
pnpm start                          # run the local agent
node understudy.mjs daemon --start  # start background daemon
node understudy.mjs gateway         # HTTP + WebSocket gateway (port 23333)
```

## Architecture

Understudy is a **local-first teachable GUI agent runtime** — a monorepo of pnpm workspaces targeting ESM/Node.js ≥20.6.

### Package Layout

```
apps/cli           # Commander.js CLI with 30+ commands (chat, daemon, gateway, teach, etc.)
packages/core      # Agent session runtime, config, auth, skill loading, policies, playbooks
packages/gateway   # Express 5 HTTP + WebSocket gateway, JSON-RPC protocol, session routing
packages/gui       # Native macOS + Windows GUI runtime, screenshot grounding, demo recorder
packages/tools     # Built-in tool implementations (browser, web, memory, schedule, GUI, message)
packages/channels  # 8 messaging channel adapters (Telegram, Discord, Slack, WhatsApp, Signal, etc.)
packages/plugins   # Plugin registry and loader
packages/types     # Shared TypeScript types (shared across all packages)
skills/            # 47+ built-in SKILL.md files with YAML frontmatter
```

### Key Architectural Patterns

**Session lifecycle** — `packages/core/src/agent.ts` is the entry point. `createUnderstudySession()` resolves either an `EmbeddedRuntimeAdapter` (direct pi-agent-core) or `AcpRuntimeAdapter` (remote ACP protocol) via `resolveRuntimeBackendForSession()`.

**Skill system** — Skills are `SKILL.md` files with YAML frontmatter (`name`, `description`, `tools`). Bundled skills live in `skills/`; workspace skills are created via `/teach`. The skill loader checks eligibility (required binaries, config). Taught tasks can crystallize into skills with route annotations (preferred/fallback/observed).

**GUI grounding** — Dual-model architecture: the main model decides *what* to do; a separate grounding model predicts screen coordinates from screenshots. HiDPI-aware with automatic high-res refinement for small targets. macOS and Windows (Win32/WGC) supported; Linux (AT-SPI) is an open contribution area. Win32 path: `packages/gui/src/win32-native-helper.ts` exposes `resolveWin32Helper`, `execWin32Helper`, and `mapCaptureContext`; the compiled C++ helper lives at `packages/gui/native/win32/` (CMake, MSVC). Demonstration recording on Windows uses `packages/gui/src/win32-demonstration-recorder.ts`.

**Gateway** — JSON-RPC over HTTP and WebSocket. Sessions identified by unique keys. Capability inventory describes available methods. Rate limiting and auth middleware sit in front of session routing.

**Channel adapters** — Each channel (`packages/channels/src/<name>/`) is optional (channel-specific deps like `grammy`, `discord.js`, `baileys` are not installed unless the channel is configured). Channel policies define trust levels per sender.

**Policy pipeline** — Tool execution passes through a chain of safety/trust/logging hooks registered in the policy registry before and after execution.

**Task drafts** — `TaughtTaskDraft` represents a learned task with parameters, steps, routes, and dependencies. Linting, evidence pack construction from demonstrations, and playbook support are all in `packages/core`.

### Build System

- Each package: `src/` → `tsc` → `dist/` with identical config extending `tsconfig.base.json`
- Target: ES2024, module: NodeNext, strict mode, isolated modules
- Vitest test pattern: `packages/*/src/**/*.test.ts` and `apps/*/src/**/*.test.ts`
- Tests colocate next to source files; use `vi.hoisted()` for module mocking, `mkdtemp` for file isolation
- Coverage tracked on `core`, `gateway`, `tools`, `channels` (excludes individual channel implementations)

### Upstream Dependency

The agent loop is built on `pi-agent-core` / `pi-ai` / `pi-coding-agent` (Mario Zechner). The root `understudy.mjs` maps `UNDERSTUDY_AGENT_DIR` → `PI_CODING_AGENT_DIR` for compatibility.

## Coding Guidelines

- **TypeScript only** (ESM, strict mode)
- **Small focused modules** — prefer composition over monoliths
- **Explicit over implicit** — no magic, no hidden state
- **Test what matters** — especially tool execution, skill parsing, and gateway routing

## Commit Style

Use [Conventional Commits](https://www.conventionalcommits.org/):
```
feat(gateway): add webchat route
fix(cli): handle missing api key gracefully
test(tools): add memory tool coverage
docs(readme): update quick start section
refactor(gui): extract grounding into separate module
```

## Branching & Pull Requests

- Create feature branches from `main`
- Use descriptive names: `feat/linux-gui-backend`, `fix/teach-video-parsing`, `docs/quick-start-guide`
- Before opening a PR: run `pnpm check`, add tests, update docs
- PR should include: summary of changes, test evidence, behavior/migration notes

## Writing Skills

Skills are `SKILL.md` files with YAML frontmatter:

```yaml
---
name: my-skill
description: What this skill does
tools: [bash, browser, web_fetch]
---

# Instructions for the agent when this skill is activated
...
```

Submit new skills as PRs to `skills/`. See `skills/` for examples.
