# ADR 0001: Runtime Boundaries

## Status

Accepted

## Context

The repository contains three materially different runtime areas:

- `public/` browser runtime
- `api/` serverless Node runtime
- `bot/` scheduled/offline Node runtime

These areas share data and concepts, but they are not one application runtime.

Without documenting those boundaries, it is easy to make changes in the wrong layer, especially because:

- generated artifacts live inside `public/`
- route-shaped cache files exist under `public/api/`
- live handlers exist under `api/`
- the bot writes user-facing outputs directly into `public/`

## Decision

Treat `public/`, `api/`, and `bot/` as separate runtime boundaries.

Apply these rules:

- `public/` is the static frontend surface.
- `api/` is the live serverless handler surface.
- `bot/` is the generation and automation surface.
- changes should be made in the correct boundary for the behavior being changed
- cross-boundary edits should be minimized and justified

## Consequences

Positive:

- makes it clearer where behavior actually lives
- reduces accidental edits to generated outputs
- improves agent discipline when changing data or rendering behavior

Tradeoffs:

- the architecture remains mixed rather than unified
- some logic duplication still exists across boundaries
- developers must check both source and generated consumers before changing behavior

## Alternatives Considered

- Treat the repo as a single app layer. Rejected because the runtime boundaries are materially different.
- Organize documentation around file types only. Rejected because runtime separation is the stronger constraint.

## Notes

This ADR documents the current repo as it exists today. It does not propose a redesign.
