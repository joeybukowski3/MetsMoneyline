const fs = require("fs");
const path = require("path");

const SITE_ORIGIN = "https://www.metsmoneyline.com";
const SAMPLE_GAME_PATH = path.join(__dirname, "../public/data/sample-game.json");
const OUTPUT_PATH = path.join(__dirname, "../public/rss.xml");

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

function toRfc822(dateString) {
  const date = new Date(`${dateString}T09:00:00Z`);
  return date.toUTCString();
}

function getSummary(game) {
  const candidates = [
    game?.writeup?.summary,
    game?.writeup?.synopsis,
    game?.writeup?.quickRead,
    game?.writeup?.analysis,
    game?.writeup?.gameAnalysis,
    game?.writeup?.pickSummary,
    game?.writeup?.headline
  ].filter(Boolean);

  const value = candidates[0];
  if (!value) return `NY Mets game analysis and moneyline breakdown for ${game?.date || "today"}.`;
  return String(value).replace(/\s+/g, " ").trim().slice(0, 200);
}

function buildItem(game) {
  const slug = slugifyOpponent(game.opponent);
  const link = `${SITE_ORIGIN}/game/mets-vs-${slug}-${game.date}`;
  const title = `Mets vs. ${game.opponent} - ${game.date} Betting Breakdown`;
  return [
    "    <item>",
    `      <title>${escapeXml(title)}</title>`,
    `      <link>${escapeXml(link)}</link>`,
    `      <description>${escapeXml(getSummary(game))}</description>`,
    `      <pubDate>${escapeXml(toRfc822(game.date))}</pubDate>`,
    `      <guid>${escapeXml(link)}</guid>`,
    "    </item>"
  ].join("\n");
}

function generateRss() {
  const sampleGame = readJson(SAMPLE_GAME_PATH);
  const games = (Array.isArray(sampleGame?.games) ? sampleGame.games : [])
    .filter((game) => game?.date && game?.opponent)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 20);

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "<channel>",
    "  <title>Mets Moneyline</title>",
    `  <link>${SITE_ORIGIN}</link>`,
    "  <description>Daily NY Mets game analysis, moneyline value, and betting insights.</description>",
    "  <language>en-us</language>",
    `  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>`,
    ...games.map(buildItem),
    "</channel>",
    "</rss>",
    ""
  ].join("\n");

  fs.writeFileSync(OUTPUT_PATH, xml);
  console.log(`Wrote ${games.length} RSS items to ${OUTPUT_PATH}`);
  return games.length;
}

if (require.main === module) {
  generateRss();
}

module.exports = generateRss;
