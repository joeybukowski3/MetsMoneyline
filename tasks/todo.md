# Current architectural priorities

- Preserve the current hybrid runtime model without accidental cross-boundary breakage.
- Prefer source-level fixes over artifact-level edits.
- Improve safety around large mixed-responsibility files before attempting deeper structural changes.

## Active documentation goals

- Keep `docs/` aligned with the current repo shape.
- Keep runtime boundaries explicit for future agents.
- Keep generated-artifact guidance visible and practical.

## Current code risks to watch

- `bot/generator.js` is oversized and mixes many responsibilities.
- `public/js/main.js` is large and blends fetching, normalization, rendering, and fallback logic.
- `public/js/advanced-stats.js` is also large and mixed-responsibility.
- Team identity and normalization logic exist in more than one place.
- Static cache artifacts and live API handlers can be confused easily.

## Safe next-step work

- tighten architecture docs as the repo evolves
- document source vs generated ownership near risky files when needed
- make narrowly scoped fixes inside the correct runtime boundary
- add verification notes when changing generation or endpoint logic

## Work that should be confirmed before starting

- deployment model changes
- workflow schedule changes
- route structure changes
- environment variable model changes
- changes that alter whether frontend pages prefer static cache or live API responses

## Deferred structural concerns

- refactoring oversized files
- reducing duplicated normalization and team identity logic
- clarifying long-term deployment precedence between `api/*` and `public/api/*`

Those may be valid future tasks, but they are not current default work.
