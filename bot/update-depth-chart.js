const fs = require("fs");
const path = require("path");

const SOURCE_PATH = path.join(__dirname, "depth-chart-source.json");
const OUTPUT_PATH = path.join(__dirname, "..", "public", "data", "depth-chart.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function sanitizeText(value) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value) {
  return sanitizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizePlayer(player, positionsSet, seenIds) {
  const id = sanitizeText(player.id) || slugify(player.name);
  const name = sanitizeText(player.name);
  const pos = sanitizeText(player.pos).toUpperCase();

  if (!id) throw new Error("Depth chart player is missing an id.");
  if (!name) throw new Error(`Depth chart player ${id} is missing a name.`);
  if (!positionsSet.has(pos)) throw new Error(`Depth chart player ${name} has invalid position ${pos}.`);
  if (seenIds.has(id)) throw new Error(`Duplicate depth chart player id: ${id}`);
  seenIds.add(id);

  const stats = player.stats && typeof player.stats === "object" ? player.stats : {};
  const normalizedStats = {};
  for (const [key, value] of Object.entries(stats)) {
    if (value == null) continue;
    normalizedStats[sanitizeText(key)] = typeof value === "string" ? sanitizeText(value) : value;
  }

  return {
    id,
    name,
    pos,
    mlbId: Number.isFinite(Number(player.mlbId)) ? Number(player.mlbId) : null,
    stats: normalizedStats
  };
}

function buildDepthChartData() {
  const source = readJson(SOURCE_PATH);
  const positions = Array.isArray(source.positions) ? source.positions.map((pos) => sanitizeText(pos).toUpperCase()) : [];
  const positionsSet = new Set(positions);
  const seenIds = new Set();
  const players = Array.isArray(source.players)
    ? source.players.map((player) => normalizePlayer(player, positionsSet, seenIds))
    : [];

  players.sort((a, b) => {
    if (a.pos !== b.pos) return positions.indexOf(a.pos) - positions.indexOf(b.pos);
    return a.name.localeCompare(b.name);
  });

  return {
    generatedAt: new Date().toISOString(),
    meta: {
      title: sanitizeText(source.meta?.title),
      description: sanitizeText(source.meta?.description),
      votingMode: "browser-local",
      weeklyRebuild: true,
      notes: Array.isArray(source.meta?.notes) ? source.meta.notes.map(sanitizeText).filter(Boolean) : []
    },
    positions,
    players
  };
}

function main() {
  const data = buildDepthChartData();
  writeJson(OUTPUT_PATH, data);
  console.log(`Wrote ${data.players.length} depth chart players across ${data.positions.length} positions to ${OUTPUT_PATH}`);
  console.log("Voting mode remains browser-local; no shared backend is configured.");
}

if (require.main === module) {
  main();
}

module.exports = {
  buildDepthChartData
};
