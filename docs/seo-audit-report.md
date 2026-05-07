# MetsMoneyline SEO Audit Report
**Date:** May 4, 2026  
**Scope:** All 5 HTML pages + sitemap.xml + robots.txt  
**Commit message:** `seo: full technical SEO audit and optimization`

---

## Summary of Changes

6 files modified, 141 insertions, 239 deletions across:
- `public/index.html`
- `public/report.html`
- `public/betting-history.html`
- `public/advanced-stats.html`
- `public/news.html`
- `public/sitemap.xml`

No betting logic, data files, or workflow scripts were modified.

---

## Severity Table

| # | Severity | Page | Issue | Status |
|---|----------|------|-------|--------|
| 1 | **CRITICAL** | report.html | Canonical URL pointed to `/` instead of `/report.html` | ✅ Fixed |
| 2 | **CRITICAL** | report.html | `og:url` pointed to `/` instead of `/report.html` | ✅ Fixed |
| 3 | **CRITICAL** | betting-history.html | `og:url` pointed to `/` instead of `/betting-history.html` | ✅ Fixed |
| 4 | **CRITICAL** | advanced-stats.html | `og:url` pointed to `/` instead of `/advanced-stats.html` | ✅ Fixed |
| 5 | **CRITICAL** | news.html | `og:url` pointed to `/` instead of `/news.html` | ✅ Fixed |
| 6 | **CRITICAL** | All pages | `og:image` referenced non-existent `og-image.png` | ✅ Fixed → MLB Mets logo SVG |
| 7 | **CRITICAL** | All pages | `twitter:image` referenced non-existent `og-image.png` | ✅ Fixed → MLB Mets logo SVG |
| 8 | **CRITICAL** | sitemap.xml | Missing core pages (report.html, betting-history.html, news.html) | ✅ Fixed |
| 9 | **CRITICAL** | report.html | Google Analytics tracking completely missing | ✅ Fixed |
| 10 | **WARNING** | report.html, betting-history, advanced-stats, news | OG title identical across all pages (not unique) | ✅ Fixed |
| 11 | **WARNING** | report.html, betting-history, advanced-stats, news | OG description identical across all pages | ✅ Fixed |
| 12 | **WARNING** | report.html, betting-history, advanced-stats, news | Twitter title/description identical across all pages | ✅ Fixed |
| 13 | **WARNING** | report.html | Missing SportsEvent structured data for today's game | ✅ Fixed (dynamic JS) |
| 14 | **WARNING** | report.html, betting-history, advanced-stats, news | Duplicate WebSite schema on every page | ✅ Fixed → WebPage |
| 15 | **WARNING** | index.html | WebSite schema missing SearchAction | ✅ Fixed |
| 16 | **WARNING** | betting-history.html | H1 missing primary keyword ("Pick History" → "Mets Moneyline Pick History") | ✅ Fixed |
| 17 | **WARNING** | advanced-stats.html | H1 missing primary keyword ("Stats & Standings" → "Mets Stats & NL East Standings") | ✅ Fixed |
| 18 | **WARNING** | news.html | H1 missing primary keyword ("Team News" → "New York Mets News") | ✅ Fixed |
| 19 | **WARNING** | All pages | Meta keywords identical across all pages | ✅ Fixed (unique per page) |
| 20 | **WARNING** | sitemap.xml | Had phantom `/picks/` and `/game/` URLs that may not exist as real pages | ✅ Fixed (cleaned) |
| 21 | **INFO** | index.html | H1 populated by JavaScript (empty in HTML source) | ⚠️ Not changed — would break dynamic matchup display |
| 22 | **INFO** | All pages | AdSense script is render-blocking in `<head>` | ⚠️ Not changed — moving breaks ad loading per Google's requirements |
| 23 | **INFO** | All pages | Favicon is JPEG (favicon.jpg) instead of ICO/PNG | ⚠️ Note — works but ICO/PNG is more broadly supported |
| 24 | **INFO** | robots.txt | Already correct | ✅ Verified |
| 25 | **INFO** | All pages | Viewport meta tag present | ✅ Verified |
| 26 | **INFO** | All pages | `font-display: swap` set via Google Fonts URL | ✅ Verified |
| 27 | **INFO** | All pages | All actual `<img>` tags have `alt` attributes | ✅ Verified |
| 28 | **INFO** | All pages | Nav links use descriptive anchor text | ✅ Verified |
| 29 | **INFO** | All pages | Internal linking via nav covers all 5 pages | ✅ Verified |
| 30 | **INFO** | All pages | HTTPS used for all resource URLs | ✅ Verified |

---

## JSON-LD Structured Data Added/Modified

### index.html — WebSite + SearchAction
```json
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "Mets Moneyline",
  "url": "https://www.metsmoneyline.com",
  "description": "The most thorough game-by-game analysis for the 2026 New York Mets...",
  "potentialAction": {
    "@type": "SearchAction",
    "target": "https://www.metsmoneyline.com/?q={search_term_string}",
    "query-input": "required name=search_term_string"
  }
}
```

### report.html — WebPage + Dynamic SportsEvent
Static WebPage schema in `<head>`, plus a JavaScript block that reads `/data/sample-game.json` at runtime and injects a SportsEvent schema like:
```json
{
  "@context": "https://schema.org",
  "@type": "SportsEvent",
  "name": "New York Mets at Colorado Rockies - 2026-05-04",
  "startDate": "2026-05-04",
  "location": { "@type": "Place", "name": "Coors Field" },
  "homeTeam": { "@type": "SportsTeam", "name": "Colorado Rockies" },
  "awayTeam": { "@type": "SportsTeam", "name": "New York Mets" },
  "sport": "Baseball"
}
```

### Other pages — WebPage with isPartOf
Each subpage now uses `@type: WebPage` with an `isPartOf` reference back to the main WebSite.

---

## How to Commit These Changes

Since I couldn't push directly, here's what to do:

1. Download the `seo-fixes.zip` file
2. Extract it — you'll find all modified files under `seo-fixes/public/`
3. Copy each file into your repo's `public/` folder, replacing the existing versions
4. Run:
   ```
   git add public/
   git commit -m "seo: full technical SEO audit and optimization"
   git push origin main
   ```

The `seo-audit-changes.diff` file in the zip shows every line changed if you want to review before committing.
