const fs = require("fs");
const path = require("path");

const SAMPLE_JSON_PATH = path.join(__dirname, "../public/data/sample-game.json");
const PICK_HISTORY_PATH = path.join(__dirname, "../public/data/pick-history.json");
const PICK_HISTORY_SEED_PATH = path.join(__dirname, "../public/data/pick-history-seed.json");

function buildHistoryKey(entry = {}) {
  return entry.gameId || `${entry.date || ""}::${entry.opponent || ""}::${entry.homeAway || ""}`;
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function calculateMoneylineProfit(odds, stake = 100) {
  if (typeof odds !== "number") return null;
  if (odds < 0) return Number(((stake / Math.abs(odds)) * 100).toFixed(2));
  return Number(((odds / 100) * stake).toFixed(2));
}

function normalizeEntry(entry) {
  if (!entry?.date || !entry?.opponent) return null;
  const odds = typeof entry.odds === "number" ? entry.odds : null;
  const stake = typeof entry.stake === "number" ? entry.stake : 100;
  const status = entry.status || (entry.result ? "final" : "pending");
  const normalizedResult = entry.result === "W" || entry.result === "L" ? entry.result : null;
  const profit = typeof entry.profit === "number"
    ? entry.profit
    : (status !== "final" || odds == null || !normalizedResult
      ? null
      : (normalizedResult === "W" ? calculateMoneylineProfit(odds, stake) : -stake));

  return {
    gameId: entry.gameId || null,
    date: entry.date,
    opponent: entry.opponent,
    homeAway: entry.homeAway || null,
    estimated: Boolean(entry.estimated),
    status,
    finalScore: entry.finalScore || null,
    officialPick: entry.officialPick || "Today's Pick: New York Mets Moneyline",
    market: entry.market || "Mets Moneyline",
    odds,
    stake,
    result: normalizedResult,
    profit
  };
}

function summarize(entries) {
  const summary = { wins: 0, losses: 0, profit: 0, totalBets: 0, totalWagered: 0, roi: 0 };
  for (const entry of entries) {
    summary.totalBets += 1;
    if (typeof entry.stake === "number") summary.totalWagered += entry.stake;
    if (entry.status === "final" && entry.result === "W") summary.wins += 1;
    if (entry.status === "final" && entry.result === "L") summary.losses += 1;
    if (entry.status === "final" && typeof entry.profit === "number") summary.profit += entry.profit;
  }
  summary.profit = Number(summary.profit.toFixed(2));
  summary.totalWagered = Number(summary.totalWagered.toFixed(2));
  summary.roi = summary.totalWagered > 0
    ? Number(((summary.profit / summary.totalWagered) * 100).toFixed(2))
    : 0;
  return summary;
}

function main() {
  const sample = readJson(SAMPLE_JSON_PATH, { recentBreakdowns: [] });
  const existingHistory = readJson(PICK_HISTORY_PATH, { entries: [] });
  const seed = readJson(PICK_HISTORY_SEED_PATH, { entries: [] });

  const mergedMap = new Map();
  const add = (rawEntry) => {
    const entry = normalizeEntry(rawEntry);
    if (!entry) return;
    const key = buildHistoryKey(entry);
    const previous = mergedMap.get(key) || {};
    mergedMap.set(key, { ...previous, ...entry });
  };

  (existingHistory.entries || []).forEach(add);
  (seed.entries || []).forEach(add);
  (sample.recentBreakdowns || []).forEach(add);

  const entries = Array.from(mergedMap.values())
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const output = {
    updatedAt: new Date().toISOString(),
    record: summarize(entries),
    entries,
    recentBreakdowns: entries
  };

  writeJson(PICK_HISTORY_PATH, output);
  console.log(`Backfilled ${entries.length} settled history entr${entries.length === 1 ? "y" : "ies"}.`);
}

main();
