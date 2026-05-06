const fs = require("fs");
const path = require("path");

const SOURCE_PATH = path.join(__dirname, "depth-chart-source.json");
const OUTPUT_PATH = path.join(__dirname, "..", "public", "data", "depth-chart.json");
const SEED_NET_BY_POSITION = {
  C: [103, 86, 74, 61, 49, 36, 26, 18, 10, 4],
  "1B": [97, 92, 76, 55, 46, 34, 24, 17, 9, 5],
  "2B": [98, 89, 77, 61, 50, 39, 29, 21, 13, 7],
  "3B": [105, 87, 75, 62, 50, 37, 27, 18, 11, 6],
  SS: [97, 93, 74, 56, 43, 31, 22, 15, 9, 4],
  LF: [92, 80, 72, 58, 46, 34, 25, 19, 12, 7],
  CF: [95, 84, 78, 71, 52, 39, 28, 20, 12, 8],
  RF: [104, 83, 76, 68, 47, 34, 25, 16, 10, 6],
  DH: [64, 51],
  SP: [111, 103, 94, 85, 73, 62, 54, 47, 39, 33, 27, 21, 16, 11, 6],
  RP: [92, 87, 83, 79, 74, 53, 36, 24, 14, 8]
};

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
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function seedNetVotesFor(pos, posRank) {
  const profile = SEED_NET_BY_POSITION[pos];
  if (!Array.isArray(profile) || !profile.length) return 0;
  return Number(profile[posRank - 1] ?? profile[profile.length - 1] ?? 0) || 0;
}

function seedDownvotesFor(pos, posRank, netVotes) {
  const posHash = Array.from(pos).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  let base;
  if (netVotes >= 100) base = 12;
  else if (netVotes >= 80) base = 11;
  else if (netVotes >= 60) base = 9;
  else if (netVotes >= 40) base = 8;
  else if (netVotes >= 20) base = 6;
  else if (netVotes >= 10) base = 4;
  else base = 3;

  const variation = (posHash + (posRank * 3)) % 3;
  const debateBump = posRank >= 2 && posRank <= 5 ? 1 : 0;
  return base + variation + debateBump;
}

function normalizePlayer(player, positionsSet, seenIds, sourceOrder, posRank) {
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

  const seedNetVotes = seedNetVotesFor(pos, posRank);
  const seedDownvotes = seedDownvotesFor(pos, posRank, seedNetVotes);
  const seedUpvotes = seedNetVotes + seedDownvotes;

  return {
    id,
    name,
    pos,
    playerId: `${pos}:${slugify(name)}`,
    sourceOrder,
    posRank,
    seedLabel: "Seeded ranking points",
    seedUpvotes,
    seedDownvotes,
    seedNetVotes,
    mlbId: Number.isFinite(Number(player.mlbId)) ? Number(player.mlbId) : null,
    stats: normalizedStats
  };
}

function buildDepthChartData() {
  const source = readJson(SOURCE_PATH);
  const positions = Array.isArray(source.positions) ? source.positions.map((pos) => sanitizeText(pos).toUpperCase()) : [];
  const positionsSet = new Set(positions);
  const seenIds = new Set();
  const posCounts = new Map();
  const players = Array.isArray(source.players)
    ? source.players.map((player, index) => {
        const pos = sanitizeText(player.pos).toUpperCase();
        const nextRank = (posCounts.get(pos) || 0) + 1;
        posCounts.set(pos, nextRank);
        return normalizePlayer(player, positionsSet, seenIds, index + 1, nextRank);
      })
    : [];

  return {
    generatedAt: new Date().toISOString(),
    meta: {
      title: sanitizeText(source.meta?.title),
      description: sanitizeText(source.meta?.description),
      votingMode: "shared-online-supported",
      seededBaselineLabel: "Seeded ranking points",
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
  console.log("Depth chart base data regenerated. Shared vote totals, if enabled, are loaded by the frontend from Supabase.");
}

if (require.main === module) {
  main();
}

module.exports = {
  buildDepthChartData
};
