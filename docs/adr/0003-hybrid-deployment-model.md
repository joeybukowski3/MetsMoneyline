# ADR 0003: Hybrid Deployment Model

## Status

Accepted

## Context

The repository contains evidence of more than one deployment model:

- `public/` is structured to be deployed as a static site
- `vercel.json` configures serverless functions for `api/**/*.js`
- GitHub Actions workflows generate artifacts, deploy GitHub Pages, refresh history, and send reports

This means the repo is not purely static and not purely serverless. It is hybrid.

At the same time, one important detail is unclear from repository contents alone:

- exact production host precedence between live `api/*` handlers and static `public/api/*` cache files

## Decision

Document the deployment model as hybrid and preserve uncertainty where the repository does not prove exact behavior.

Working assumptions:

- static site assets are built from and served out of `public/`
- serverless handlers may serve live JSON under `api/*`
- scheduled GitHub workflows regenerate and publish content artifacts
- static cache files under `public/api/*` are part of the serving/publishing model

Explicit non-assumption:

- do not assume exact host precedence between `api/*` and `public/api/*` without confirmation

## Consequences

Positive:

- avoids false certainty about deployment behavior
- helps agents avoid breaking hosting assumptions
- keeps deployment-sensitive changes conservative

Tradeoffs:

- some architecture questions remain intentionally unresolved
- deployment changes should be treated as higher-risk work requiring confirmation

## Alternatives Considered

- Document the repo as purely static. Rejected because `api/` and `vercel.json` are present.
- Document the repo as purely serverless. Rejected because `public/` artifacts and GitHub Pages workflows are first-class parts of the repo.
- State exact host precedence between `api/*` and `public/api/*`. Rejected because that is unclear from the repository alone.

## Operational Rule

Before changing any of the following, confirm intent:

- deployment config
- GitHub workflows
- route layout
- environment variable handling
- publishing schedule behavior

## Notes

This ADR records the current repository model. It does not standardize on a single host or runtime.
