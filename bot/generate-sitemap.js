const fs = require("fs");
const path = require("path");

const SITE_ORIGIN = "https://www.metsmoneyline.com";
const OUTPUT_PATH = path.join(__dirname, "../public/sitemap.xml");

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildUrlNode(entry) {
  return [
    "  <url>",
    `    <loc>${escapeXml(entry.loc)}</loc>`,
    `    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`,
    `    <changefreq>${escapeXml(entry.changefreq)}</changefreq>`,
    `    <priority>${escapeXml(entry.priority)}</priority>`,
    "  </url>"
  ].join("\n");
}

function generateSitemap() {
  const today = new Date().toISOString().slice(0, 10);

  const urls = [
    { loc: `${SITE_ORIGIN}/`, lastmod: today, changefreq: "daily", priority: "1.0" },
    { loc: `${SITE_ORIGIN}/report.html`, lastmod: today, changefreq: "daily", priority: "0.9" },
    { loc: `${SITE_ORIGIN}/trends.html`, lastmod: today, changefreq: "daily", priority: "0.7" },
    { loc: `${SITE_ORIGIN}/advanced-stats.html`, lastmod: today, changefreq: "daily", priority: "0.7" },
    { loc: `${SITE_ORIGIN}/power-rankings.html`, lastmod: today, changefreq: "daily", priority: "0.7" },
    { loc: `${SITE_ORIGIN}/prospects.html`, lastmod: today, changefreq: "weekly", priority: "0.7" },
    { loc: `${SITE_ORIGIN}/betting-history.html`, lastmod: today, changefreq: "daily", priority: "0.7" },
    { loc: `${SITE_ORIGIN}/depth-chart.html`, lastmod: today, changefreq: "weekly", priority: "0.7" },
    { loc: `${SITE_ORIGIN}/news.html`, lastmod: today, changefreq: "daily", priority: "0.6" },
    { loc: `${SITE_ORIGIN}/on-this-day.html`, lastmod: today, changefreq: "daily", priority: "0.5" },
    { loc: `${SITE_ORIGIN}/social-pulse.html`, lastmod: today, changefreq: "daily", priority: "0.5" },
    { loc: `${SITE_ORIGIN}/betting.html`, lastmod: today, changefreq: "weekly", priority: "0.6" },
    { loc: `${SITE_ORIGIN}/gear.html`, lastmod: today, changefreq: "monthly", priority: "0.4" },
    { loc: `${SITE_ORIGIN}/support.html`, lastmod: today, changefreq: "monthly", priority: "0.4" },
  ];

  const deduped = Array.from(new Map(urls.map((entry) => [entry.loc, entry])).values());
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...deduped.map(buildUrlNode),
    "</urlset>",
    ""
  ].join("\n");

  fs.writeFileSync(OUTPUT_PATH, xml);
  console.log(`Wrote ${deduped.length} URLs to ${OUTPUT_PATH}`);
  return deduped.length;
}

if (require.main === module) {
  generateSitemap();
}

module.exports = generateSitemap;
