# Known pitfalls for agents

- `public/`, `api/`, and `bot/` are separate runtime boundaries. Do not treat them as one app layer.
- `public/report.html` is generated output, not the preferred place for long-term behavior changes.
- `public/api/mlb/mets/*` can look like source routes but many of those files are generated cache artifacts.
- The frontend is plain multi-page HTML/CSS/JS. Do not assume React, Vite, components, or a client router.
- Deployment behavior is hybrid, and exact host precedence is unclear. Do not guess.

## Practical lessons

### Source vs artifact

When output is wrong, first ask:

- is this a source bug?
- is this a generated artifact?
- what script or handler produced it?

### Large-file caution

Before editing these files, inspect nearby logic and likely downstream effects:

- `bot/generator.js`
- `public/js/main.js`
- `public/js/advanced-stats.js`

Small edits in those files can change unrelated behavior.

### Deployment caution

Changes to these areas should be confirmed first:

- `.github/workflows/*`
- `vercel.json`
- env variable contracts
- route layout under `api/`

### Data-path caution

The same conceptual data may exist in more than one form:

- live endpoint output from `api/*`
- generated cache output under `public/api/*`
- generated frontend data under `public/data/*`

Always verify which path the relevant page or workflow actually uses.

## Documentation habit

For non-trivial changes, read:

- `AGENTS.md`
- `docs/architecture.md`
- `docs/generated-files.md`
- `tasks/todo.md`

before editing.
