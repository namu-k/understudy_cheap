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

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
