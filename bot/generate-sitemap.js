const fs = require("fs");
const path = require("path");

const SITE_ORIGIN = "https://www.metsmoneyline.com";
const SAMPLE_GAME_PATH = path.join(__dirname, "../public/data/sample-game.json");
const PICK_HISTORY_PATH = path.join(__dirname, "../public/data/pick-history.json");
const OUTPUT_PATH = path.join(__dirname, "../public/sitemap.xml");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function slugifyOpponent(opponent) {
  return String(opponent || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");
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
  const sampleGame = readJson(SAMPLE_GAME_PATH);
  const pickHistory = readJson(PICK_HISTORY_PATH);

  const urls = [
    {
      loc: `${SITE_ORIGIN}/`,
      lastmod: new Date().toISOString().slice(0, 10),
      changefreq: "daily",
      priority: "1.0"
    },
    {
      loc: `${SITE_ORIGIN}/advanced-stats.html`,
      lastmod: new Date().toISOString().slice(0, 10),
      changefreq: "daily",
      priority: "0.5"
    }
  ];

  for (const game of Array.isArray(sampleGame?.games) ? sampleGame.games : []) {
    if (!game?.date || !game?.opponent) continue;
    const slug = slugifyOpponent(game.opponent);
    urls.push({
      loc: `${SITE_ORIGIN}/game/mets-vs-${slug}-${game.date}`,
      lastmod: game.date,
      changefreq: "daily",
      priority: "0.8"
    });
  }

  for (const entry of Array.isArray(pickHistory?.entries) ? pickHistory.entries : []) {
    if (!entry?.date) continue;
    urls.push({
      loc: `${SITE_ORIGIN}/picks/${entry.date}`,
      lastmod: entry.date,
      changefreq: "weekly",
      priority: "0.6"
    });
  }

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
