# MetsMoneyline — Pre-Launch Site Audit Report
**Date:** May 19, 2026  
**Audited by:** Claude (automated + manual code review)  
**Scope:** Full public site — 20 HTML pages, all JS/CSS, API routes, vercel.json, sitemap, robots.txt

---

## Executive Summary

The site is in strong shape overall. The core tech stack is sound, security headers are well-configured, no API keys are exposed in public JS (with one notable exception below), and navigation/routing is mostly complete. The main issues are a handful of SEO gaps, one legitimate security note about the Supabase anon key, some path inconsistencies across pages (relative vs. absolute), one page missing its footer script, and a few missing Vercel routes for newly renamed pages. None of these are blockers, but several should be resolved before a formal public launch or press push.

---

## 🔴 Critical Issues

### 1. Supabase Anon Key Exposed in Public JS
**File:** `public/js/depth-chart-config.js`  
**What:** The Supabase project URL and anon key are hardcoded and publicly readable in the browser.  
**Why it matters:** The anon key is a client-side key by design — Supabase expects it to be public — but without Row Level Security (RLS) properly configured, anyone can query or write to the database directly. The real risk is abuse of the voting RPC if RLS policies are too permissive.  
**Recommended fix:** Confirm RLS is active on `dc_live_user_votes_v2` (the migration we ran enables it). Add a rate limit or CAPTCHA to the `/api/vote` route if spam becomes a concern. The key itself being public is acceptable — what matters is RLS is enforced.  
**Priority:** Critical (needs verification, not necessarily code change)

### 2. CSP Blocks Google AdSense and Buttondown Form
**File:** `vercel.json` (Content-Security-Policy header)  
**What:** The CSP `script-src` does not include `pagead2.googlesyndication.com` or `*.googlesyndication.com`. The CSP `form-action` is `'self'` but `index.html` POSTs to `https://buttondown.com`.  
**Why it matters:** AdSense scripts will be blocked by the CSP in strict browsers/extensions, breaking ad revenue. The Buttondown email form POST will be blocked by `form-action 'self'`.  
**Recommended fix:**  
```json
"script-src": "... https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net",
"img-src": "... https://pagead2.googlesyndication.com https://www.google.com",
"connect-src": "... https://pagead2.googlesyndication.com",
"form-action": "'self' https://buttondown.com"
```
**Priority:** Critical

---

## 🟠 High-Priority Issues

### 3. `report.html` Missing `site-footer.js` and Uses Relative Script Paths
**File:** `public/report.html`  
**What:** `report.html` has a hardcoded footer instead of using the `site-footer.js` component. It also loads scripts with relative paths (`js/site-header.js`) instead of absolute paths (`/js/site-header.js`). This means if the report page is ever served from a subdirectory, scripts will 404.  
**Why it matters:** The footer is out of sync — any footer changes (links, disclaimer, copyright year) won't apply to the report page. Relative paths break routing resilience.  
**Recommended fix:** Add `<script defer src="/js/site-footer.js"></script>` to `report.html`, replace `<footer>...</footer>` hardcoded content with `<footer></footer>`, and change `src="js/site-header.js"` → `src="/js/site-header.js"`.  
**Priority:** High

### 4. `game-log.html` Missing Canonical Tag, OG Tags, Twitter Card, and JSON-LD
**File:** `public/game-log.html`  
**What:** The Analytics/game-log page has no `<link rel="canonical">`, no `og:title`, no `og:description`, no `og:image`, no `twitter:card`, and no JSON-LD structured data.  
**Why it matters:** This is a primary nav page and one of the more content-rich pages on the site. Without a canonical, search engines may treat it as a duplicate. Without OG tags, social shares will show no preview.  
**Recommended fix:** Add full SEO head tags matching the pattern of other pages.  
**Priority:** High

### 5. `/analytics` Route Missing from Vercel Config
**File:** `vercel.json`  
**What:** The nav calls the game-log page "Analytics" but there's no `/analytics` rewrite — only `/game-log` exists. If a user types `metsmoneyline.com/analytics` they get a 404.  
**Why it matters:** Confusing UX, potential for broken links from social sharing or external sites referencing the new name.  
**Recommended fix:** Add to `vercel.json` rewrites: `{ "source": "/analytics", "destination": "/game-log.html" }` and a redirect from `/analytics` → `/game-log` for consistency.  
**Priority:** High

### 6. `game-log.html` Missing `game-log.html` in Sitemap
**File:** `public/sitemap.xml`  
**What:** `/game-log` is not in the sitemap. Also `/betting-history` (the canonical URL for the Moneyline Tracker page) is missing.  
**Why it matters:** Search engines won't discover or prioritize these pages without sitemap entries.  
**Recommended fix:** Add `/game-log` and `/pick-history` (canonical) to sitemap.xml. Note: `/pick-history` may already be there — it was in the sitemap scan above.  
**Priority:** High

### 7. Inconsistent Script Path Prefixes (Relative vs. Absolute)
**Files:** `advanced-stats.html`, `betting.html`, `depth-chart.html`, `social-pulse.html`, and others  
**What:** Most pages load page-specific JS with relative paths (`src="js/betting.js"`) while `site-header.js` and `site-footer.js` use absolute paths (`src="/js/site-header.js"`). Vercel's rewriting serves all pages from `/`, so relative paths currently work — but this is fragile.  
**Why it matters:** If routing changes or any page is linked from a subdirectory context, relative JS paths will 404.  
**Recommended fix:** Standardize all `<script src="...">` and `<link href="...">` to use absolute paths starting with `/`.  
**Priority:** High

---

## 🟡 Medium-Priority Issues

### 8. Five Pages Missing `twitter:card` Meta Tag
**Files:** `about.html`, `disclaimer.html`, `editorial-policy.html`, `privacy-policy.html`, `terms.html`  
**What:** These pages have OG tags but are missing `<meta name="twitter:card" content="summary">`.  
**Why it matters:** Twitter/X will not generate a preview card when these pages are shared. For legal/trust pages this matters less, but `about.html` in particular benefits from a card.  
**Recommended fix:** Add `<meta name="twitter:card" content="summary">` to each missing page.  
**Priority:** Medium

### 9. Seven Pages Missing JSON-LD Structured Data
**Files:** `about.html`, `disclaimer.html`, `editorial-policy.html`, `game-log.html`, `gear.html`, `privacy-policy.html`, `terms.html`, `social-pulse.html`  
**What:** No schema.org markup on these pages.  
**Why it matters:** Structured data helps Google understand page type and can improve rich results. For `about.html` an `Organization` schema would be valuable. For `gear.html` a `Product` or `ItemList` schema helps.  
**Recommended fix:** Add minimal JSON-LD to key pages. `about.html` → `Organization`. `gear.html` → `Product`. Legal pages can use `WebPage`.  
**Priority:** Medium

### 10. Alert Banner Text Inconsistent Across Pages
**Files:** Multiple  
**What:** Some pages use `&mdash;` entity, others use a plain `-` dash. Some have slightly different messages.  
**Examples:** `about.html` uses `"Live 2026 season mode - stats..."` while `index.html` uses `"Live 2026 season mode &mdash; stats..."`.  
**Why it matters:** Minor visual inconsistency — the dash renders differently across browsers/OS.  
**Recommended fix:** Standardize to `&mdash;` across all pages.  
**Priority:** Medium (cosmetic but easy fix)

### 11. `game-log.html` Uses Mixed Relative/Absolute Paths
**File:** `public/game-log.html`  
**What:** This page uniquely has both `href="css/styles.css"` (relative) and `href="/css/styles.css"` (absolute) in the same file.  
**Why it matters:** One will win, one is redundant — and the relative one may cause a double-load or fail under routing.  
**Recommended fix:** Remove the relative path reference, keep only `/css/styles.css`.  
**Priority:** Medium

### 12. `depth-chart.html` Loads Supabase CDN Without SRI Hash
**File:** `public/depth-chart.html`  
**What:** `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2">` has no `integrity="sha384-..."` attribute.  
**Why it matters:** If jsDelivr were compromised, a malicious version of the Supabase client could be served. Subresource Integrity (SRI) prevents this.  
**Recommended fix:** Add the integrity hash. Get it from: `https://www.srihash.org/` or jsDelivr's built-in SRI endpoint.  
**Priority:** Medium

### 13. `sample-game.json` is 527KB — Served Publicly
**File:** `public/data/sample-game.json`  
**What:** This file is 527KB and served as a public static file. It contains full game report data including AI-generated writeups, betting analysis, and raw API responses.  
**Why it matters:** No security risk (no private data found), but it's a large file that every homepage visitor downloads. It also contains internal generation metadata that isn't user-facing.  
**Recommended fix:** Consider serving only the fields the frontend actually needs, or gzip compression (Vercel does this automatically, so the impact is reduced). Strip internal metadata fields before writing.  
**Priority:** Medium (performance, not security)

### 14. `overview.json` is 189KB — Possibly Over-serving Data
**File:** `public/api/mlb/mets/overview.json`  
**What:** This file contains full player-level stats for the roster.  
**Why it matters:** Same as above — Vercel gzips it, but the raw size suggests the frontend may not need all fields.  
**Recommended fix:** Audit which fields `advanced-stats.js` actually reads and trim the rest before writing.  
**Priority:** Medium

---

## 🔵 Low-Priority Polish Items

### 15. `about.html` Missing `twitter:card`
Already captured in #8 above.

### 16. `index.html` H1 is Empty/Dynamic
**File:** `public/index.html`  
**What:** The `<h1>` tag in `index.html` is populated dynamically by JS (the hero headline changes per game). The raw HTML has an empty `<h1>`.  
**Why it matters:** Search engine crawlers may index the page before JS runs and see an empty H1. This is partly mitigated by the dynamic content being in the hero section.  
**Recommended fix:** Add a static fallback H1 in the HTML that JS can replace on load: `<h1 id="hero-headline">Mets Game Day Analysis</h1>`.  
**Priority:** Low

### 17. `about.html` Title is Redundant (`About MetsMoneyline | MetsMoneyline`)
**File:** `public/about.html`  
**What:** Title tag reads "About MetsMoneyline | MetsMoneyline" — the brand name is repeated.  
**Recommended fix:** Change to `About | MetsMoneyline` or `About MetsMoneyline — Fan Analysis Site`.  
**Priority:** Low

### 18. Footer Links Don't Include `game-log`, `power-rankings`, or `social`
**File:** `public/js/site-footer.js`  
**What:** Footer links are: About · Support · Privacy Policy · Terms · Editorial Policy · Disclaimer. None of the main content pages are linked.  
**Why it matters:** Footer internal linking is a light SEO signal and helps users navigate when they've scrolled to the bottom.  
**Recommended fix:** Add a second footer column with key content links (Today's Report, Analytics, Power Rankings, Social Score).  
**Priority:** Low

### 19. `on-this-day.html` Not in Primary Nav or Footer
**File:** `public/on-this-day.html`  
**What:** The "On This Day" page exists and is in the sitemap but is only reachable via the More menu (if present) or direct URL.  
**Why it matters:** Discoverable only by power users.  
**Recommended fix:** Add to the More/hamburger menu if not already there.  
**Priority:** Low

### 20. `betting-history.html` vs `/pick-history` — Two Names, One Page
**What:** The file is `betting-history.html`, the canonical URL is `/pick-history`, the nav label is "Moneyline Tracker". Three different names for one page causes confusion in the codebase.  
**Recommended fix:** No user-facing change needed, but internally rename the file to `pick-history.html` and update the Vercel rewrite to match. This is cosmetic/maintenance.  
**Priority:** Low

---

## Dead Links / Broken Routes Found

| Route | Status | Notes |
|-------|--------|-------|
| `/analytics` | 404 | Nav renamed page to "Analytics" but no Vercel route exists |
| `/social` (nav) | Shows "MISSING" in script check | Maps correctly in Vercel to `social-pulse.html` — false alarm from path checker |
| `/pick-history.html` | 301 → `/pick-history` | Redirect exists — OK |
| `/betting-history` | 301 → `/pick-history` | Redirect exists — OK |
| `/social-pulse` | 301 → `/social` | Redirect exists — OK |
| `/power-rankings` | 301 → `/rankings` | Redirect exists — OK |

---

## SEO Issues Found

| Page | Issue |
|------|-------|
| `game-log.html` | Missing canonical, all OG tags, twitter:card, JSON-LD |
| `about.html` | Missing twitter:card; redundant title tag |
| `disclaimer.html` | Missing twitter:card |
| `editorial-policy.html` | Missing twitter:card, JSON-LD |
| `privacy-policy.html` | Missing twitter:card, JSON-LD |
| `terms.html` | Missing twitter:card, JSON-LD |
| `game-log.html` | Missing from sitemap.xml |
| All pages | OG images use SVG logo — Twitter may not render SVG previews correctly. Consider a PNG fallback. |
| `index.html` | H1 is empty in raw HTML (JS-populated only) |

---

## Security Issues Found

| Issue | Risk | Fix |
|-------|------|-----|
| Supabase anon key in `depth-chart-config.js` | Low (by design, but RLS must be verified) | Confirm RLS policies active; monitor for abuse |
| CSP missing `pagead2.googlesyndication.com` | Medium — AdSense blocked | Add to CSP script-src and img-src |
| CSP `form-action: 'self'` blocks Buttondown POST | High — email signup broken in strict mode | Add `buttondown.com` to form-action |
| Supabase CDN loaded without SRI hash | Low-Medium | Add integrity attribute |
| `unsafe-inline` in script-src | Low (standard for sites with inline scripts) | Long-term: move inline scripts to files with nonces |

---

## Navigation Issues Found

| Issue | Pages |
|-------|-------|
| `/analytics` 404 (no Vercel route) | All — nav link broken |
| `report.html` not in PRIMARY_NAV but appears as "Today's Report" — OK | None |
| "Trend Lines" label correct in nav | OK |
| "Analytics" label correct in nav | OK |
| "All Time Depth Chart" moved to More menu | OK |
| `on-this-day.html` hard to find | Low discoverability |

---

## Responsive / Mobile Issues Found

| Issue | Breakpoint | File |
|-------|-----------|------|
| 17 different breakpoints in styles.css — fragmented | All | `styles.css` |
| No `768px` breakpoint for tablet (only 700px and 900px) | Tablets | `styles.css` |
| `social-pulse.html` side panel grid on tablet (860px) may overlap posts | ~860px | `social-pulse.html` |
| Power Rankings tab strip may wrap at ~480px | Mobile | `power-rankings.html` |
| Alert banners use inconsistent dash encoding (may render differently) | All | Multiple |

---

## Recommended Fix Order

### Do immediately (before any press/launch):
1. Fix CSP to allow AdSense and Buttondown form-action (#2)
2. Add `/analytics` Vercel route (#5)
3. Add `site-footer.js` to `report.html` and fix relative script paths (#3)
4. Add full SEO head to `game-log.html` (#4)
5. Add `/game-log` to sitemap.xml (#6)

### Do before sustained traffic:
6. Standardize all script paths to absolute (#7)
7. Add `twitter:card` to 5 missing pages (#8)
8. Fix mixed CSS paths in `game-log.html` (#11)
9. Add SRI hash to Supabase CDN load (#12)
10. Verify Supabase RLS is active (#1)

### Polish (do when convenient):
11. Add JSON-LD to remaining pages (#9)
12. Standardize alert banner dashes (#10)
13. Add static H1 fallback to index.html (#16)
14. Fix redundant `about.html` title (#17)
15. Add content links to footer (#18)
16. Add `on-this-day` to More menu (#19)

---

## Files Likely Needing Changes

| File | Changes Needed |
|------|---------------|
| `vercel.json` | Add `/analytics` rewrite; fix CSP for AdSense and Buttondown |
| `public/report.html` | Add site-footer.js; fix relative paths |
| `public/game-log.html` | Add canonical, OG tags, twitter:card, JSON-LD; fix mixed CSS paths |
| `public/sitemap.xml` | Add `/game-log` entry |
| `public/about.html` | Add twitter:card; fix title |
| `public/disclaimer.html` | Add twitter:card |
| `public/editorial-policy.html` | Add twitter:card |
| `public/privacy-policy.html` | Add twitter:card |
| `public/terms.html` | Add twitter:card |
| `public/depth-chart.html` | Add SRI hash to Supabase CDN |
| `public/js/site-footer.js` | Add content page links |
| Multiple `.html` files | Standardize relative → absolute script/CSS paths |

---

## Small Safe Fixes Applied During This Audit

None — per instructions, no changes were made. All findings are documented above for your review and approval before any changes are pushed.
