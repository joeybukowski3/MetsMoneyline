# ADR 0002: Generated Artifacts Policy

## Status

Accepted

## Context

This repository publishes generated outputs directly from the repo tree, including:

- `public/report.html`
- `public/data/sample-game.json`
- `public/data/pick-history.json`
- `public/api/mlb/mets/*`
- `public/api/mlb/mets/*.json`

These files are consumed by the frontend and by deployment/publishing workflows.

Because the generated outputs live beside source files, it is easy to mistake them for hand-maintained code.

## Decision

Generated artifacts are not the default place to make behavior changes.

Policy:

- prefer editing the source that generates the artifact
- do not hand-edit generated files unless explicitly required
- if a generated file is edited intentionally, document that it was an artifact-level change
- treat scheduled regeneration as the expected overwrite mechanism for generated outputs

## Consequences

Positive:

- stabilizes the repo’s source-of-truth model
- reduces temporary fixes that disappear on the next scheduled run
- makes automation safer for future agents

Tradeoffs:

- quick artifact-only patches are discouraged
- some fixes require tracing generation paths before editing

## Alternatives Considered

- Freely edit generated outputs when convenient. Rejected because scheduled regeneration will overwrite those changes.
- Treat generated files as equal source of truth. Rejected because it blurs ownership and makes fixes unstable.

## Examples

Preferred:

- change `bot/generator.js` instead of changing `public/report.html`
- change `bot/build-api-cache.js` or `api/_lib/*` instead of changing `public/api/mlb/mets/*`

Not preferred:

- hand-tuning generated JSON that will be overwritten
- treating generated pages as the long-term maintained source

## Notes

This policy reflects the current architecture and publishing model. It does not prevent artifact-level edits when the task explicitly calls for them.
