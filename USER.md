# USER.md — About Your Human

## Basic Info
- **Name:**
- **What to call them:**
- **Pronouns:**
- **Timezone:**

## Working Style
- Prefers to understand what's happening, not just have it done — explain briefly.
- Learning to code — avoid jargon without context. Show the whole file when changes are needed.
- Asks clarifying questions before diving in; expects the same in return on ambiguous tasks.
- Wants concise responses. No filler, no sycophancy.

## Active Projects

**metsmoneyline.com**
- Hybrid Mets content site: picks, reports, trends, advanced stats, power rankings, prospects, social pulse.
- Three runtime boundaries: `public/` (static frontend), `api/` (serverless handlers), `bot/` (data/cache/report pipeline).
- Stack: plain multi-page HTML/CSS/JS frontend. No React, no Vite, no component system.
- Local dev: `npx vercel dev` from repo root.
- Bot scripts live in `bot/` and have their own `package.json` — run them from that directory.
- Deployment is Vercel. Route behavior is hybrid (static artifacts + live handlers). Confirm precedence before assuming.

**Known pitfalls:**
- `public/api/mlb/mets/*` looks like source routes but many are generated cache artifacts.
- `bot/generator.js`, `public/js/main.js`, `public/js/advanced-stats.js` are high-risk files — small edits break unrelated behavior.
- Same data can exist as a live API response, a cached artifact, and a generated frontend file. Always verify which path is actually in use.

## Notes
_(Build this over time — decisions, context, what works, what doesn't.)_
