# AGENTS.md
Read this file first before making changes in this repository.

## Session Startup
Before doing anything else:
1. Read `SOUL.md` — this is who you are
2. Read `USER.md` — this is who you're helping
3. Read `memory/YYYY-MM-DD.md` (today + yesterday) for recent context
4. Read `docs/architecture.md` and `docs/generated-files.md`
5. Read `tasks/todo.md` and `tasks/lessons.md` for current priorities and known pitfalls
6. Identify which runtime boundary the task touches: `public/`, `api/`, or `bot/`

Don't ask permission. Just do it.

## Memory
You wake up fresh each session. These files are your continuity.
- **Daily notes:** `memory/YYYY-MM-DD.md` — log decisions, context, changes made
- **No mental notes** — if it matters, write it to a file. Files survive restarts. Memory doesn't.
- When you learn a lesson or make a mistake, document it in `tasks/lessons.md` so future-you doesn't repeat it.

## Purpose
This repository is a hybrid Mets content site with three separate runtime boundaries:
- `public/`: static multi-page frontend
- `api/`: thin Node/CommonJS serverless handlers
- `bot/`: content, data, cache, and report generation pipeline

Treat those boundaries as separate systems. Do not assume a change in one area is safe for the others.

## Working Rules
- Prefer editing source files over generated output.
- Do not hand-edit generated files unless the task explicitly requires artifact-level changes.
- Generated files include:
  - `public/report.html`
  - `public/data/sample-game.json`
  - `public/data/pick-history.json`
  - `public/api/mlb/mets/*`
  - generated `.json` cache files under `public/api/`
- Make minimal, scoped edits. Avoid opportunistic cleanup unless requested.
- Preserve the current architecture. Do not invent React, a client-side router, or a component system.

## Ask Before Changing
Stop and confirm before touching any of the following:
- deployment config (`vercel.json`, `.github/workflows/*`)
- GitHub workflows
- routing structure
- environment variable handling
- scheduled automation behavior
- the relationship between `public/`, `api/`, and `bot/`

## Source vs Generated
- **Source:** hand-maintained code in `api/`, `bot/`, `lib/`, `public/js/`, `public/css/`, and hand-authored HTML in `public/`
- **Generated:** outputs written by scripts and workflows for serving or publishing

Do not treat generated files as canonical source unless explicitly asked.

## Risk Areas
These files mix responsibilities and can break unrelated behavior. Inspect surrounding logic and downstream outputs before editing:
- `bot/generator.js`
- `public/js/main.js`
- `public/js/advanced-stats.js`

## Data Path Caution
The same conceptual data may exist in more than one form:
- live endpoint output from `api/*`
- generated cache output under `public/api/*`
- generated frontend data under `public/data/*`

Always verify which path the relevant page or workflow actually uses before changing anything.

## Unclear Areas
Host precedence between static `public/api/*` artifacts and live `api/*` handlers is unclear from the repository alone. Do not assume hosting behavior without confirming current deployment intent.

---

## Code Update Rules
These apply before and during every code change.

**Before every change:**
- State what you believe the goal is before writing any code.
- If the goal is ambiguous, stop and surface it. Do not guess.
- Read the relevant file, function, and immediate callers before touching anything.
- If you don't know why something is structured a certain way, ask before changing it.

**Making changes:**
- Write the minimum code that solves the problem. Nothing more.
- Touch only what is necessary. Do not clean up or reformat adjacent code.
- Match the existing style, naming, and conventions of the file exactly.
- If two patterns conflict, pick the more recent one and flag it. Do not blend them.
- Push back when a simpler approach exists.

**Verifying changes:**
- Define what success looks like before finishing.
- Verify output matches actual intent, not just the literal instruction.
- After each significant step, summarize: what changed, what was verified, what remains.
- If anything was skipped or unverified, say so before marking done.

**Reporting changes:**
When you finish work, report exactly which files changed and label each as:
- source file
- generated file
- documentation file

If you intentionally changed a generated artifact, say why.

**Fail loud:**
- "Done" is wrong if anything was skipped silently.
- "It works" is wrong if it was not actually tested or verified.
- If you lose track of the goal, stop and restate before continuing.
- Surface uncertainty. Never hide it.

**Token efficiency:**
- Be concise. Omit filler and redundant explanation.
- If a task is growing complex, break it into steps and checkpoint between them.
- If context is getting long, flag it and offer to summarize before continuing.

## Red Lines
- Don't exfiltrate private data. Ever.
- Don't run destructive commands without asking.
- `trash` > `rm` — recoverable beats gone forever.
- When in doubt, ask.
