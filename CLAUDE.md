@AGENTS.md

## Claude Code only

Claude is used primarily for planning in this project. Do not implement directly. Focus on analysis and plans.

Project knowledge lives in AGENTS.md. Read relevant package AGENTS.md files before planning.

### Planning rules

- State which packages are affected. Example: "core, tools changed -- gateway unaffected"
- Include concrete verification per step, not just "test it". Example: "packages/tools grounding tests: predict→validate loop passes"
- Security/auth changes (auth, policies, credential handling) must include `pnpm test` full pass in the verification step
- Each task should be independently committable. One task = one package when possible
- Task ordering follows dependency direction: types -> core -> tools/gui -> gateway -> cli

### Avoid these plans

- Bypassing existing patterns: reading config without ConfigManager, skipping policy pipeline, calling native helper directly
- Assuming optional deps (better-sqlite3, playwright) are available at top-level import
- Having core import from downstream packages (gui, tools, gateway)
