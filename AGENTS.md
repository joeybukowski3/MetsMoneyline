# AGENTS.md

Read this file first before making changes in this repository.

## Quick Start

Always do these steps first:

1. Read `AGENTS.md`.
2. Read `docs/architecture.md` and `docs/generated-files.md`.
3. Read `tasks/todo.md` and `tasks/lessons.md` for current priorities and known pitfalls.
4. Identify which runtime boundary the task touches: `public/`, `api/`, or `bot/`.
5. Prefer changing source files, not generated artifacts.

For any non-trivial task, inspect these files before editing:

- `docs/architecture.md`
- `docs/generated-files.md`
- `tasks/todo.md`
- `tasks/lessons.md`

## Purpose

This repository is a hybrid Mets content site with three separate runtime boundaries:

- `public/`: static multi-page frontend
- `api/`: thin Node/CommonJS serverless handlers
- `bot/`: content, data, cache, and report generation pipeline

Treat those boundaries as separate systems. Do not assume a change in one area is safe for the others.

## Working Rules

- Prefer editing source files over generated output.
- Do not hand-edit generated files unless the task explicitly requires artifact-level changes.
- Generated files usually include:
  - `public/report.html`
  - `public/data/sample-game.json`
  - `public/data/pick-history.json`
  - `public/api/mlb/mets/*`
  - generated `.json` cache files under `public/api/`
- If behavior must change, update the source that produces the artifact when possible.
- Make minimal, scoped edits. Avoid opportunistic cleanup unless requested.
- Preserve the current architecture. Do not invent React, a client-side router, or a component system.

## Ask Before Changing

Ask before changing any of the following:

- deployment config
- GitHub workflows
- routing structure
- environment variable handling
- scheduled automation behavior
- the relationship between `public/`, `api/`, and `bot/`

If the task appears to require one of those changes, stop and confirm intent first.

## Source vs Generated

In this repo, the distinction matters:

- Source files are typically hand-maintained code in `api/`, `bot/`, `lib/`, `public/js/`, `public/css/`, and hand-authored HTML pages in `public/`.
- Generated artifacts are outputs written by scripts and workflows for serving or publishing.

Do not treat generated files as the canonical source unless the user explicitly asks for artifact-only changes.

## Risk Areas

Be careful in these files because they mix responsibilities and can break unrelated behavior:

- `bot/generator.js`
- `public/js/main.js`
- `public/js/advanced-stats.js`

Before editing them, inspect surrounding logic and downstream outputs.

## Reporting Changes

When you finish work, report exactly which files changed and label each one as:

- source file
- generated file
- documentation file

If you intentionally changed a generated artifact, say why.

## Unclear Areas

Host precedence between static `public/api/*` artifacts and live `api/*` handlers is unclear from the repository alone. Do not assume hosting behavior without confirming current deployment intent.
