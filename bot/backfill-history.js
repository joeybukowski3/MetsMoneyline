const fs = require("fs");
const path = require("path");

const SAMPLE_JSON_PATH = path.join(__dirname, "../public/data/sample-game.json");
const PICK_HISTORY_PATH = path.join(__dirname, "../public/data/pick-history.json");
const PICK_HISTORY_SEED_PATH = path.join(__dirname, "../public/data/pick-history-seed.json");

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
  if (!entry?.date || !entry?.opponent || !entry?.result) return null;
  const odds = typeof entry.odds === "number" ? entry.odds : null;
  const profit = typeof entry.profit === "number"
    ? entry.profit
    : (odds == null ? null : (entry.result === "W" ? calculateMoneylineProfit(odds) : -100));

  return {
    date: entry.date,
    opponent: entry.opponent,
    finalScore: entry.finalScore || null,
    officialPick: entry.officialPick || "Today's Pick: New York Mets Moneyline",
    market: entry.market || "Mets Moneyline",
    odds,
    result: entry.result,
    profit
  };
}

function summarize(entries) {
  const summary = { wins: 0, losses: 0, profit: 0 };
  for (const entry of entries) {
    if (entry.result === "W") summary.wins += 1;
    if (entry.result === "L") summary.losses += 1;
    if (typeof entry.profit === "number") summary.profit += entry.profit;
  }
  summary.profit = Number(summary.profit.toFixed(2));
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
    mergedMap.set(`${entry.date}__${entry.opponent}`, entry);
  };

  (existingHistory.entries || []).forEach(add);
  (seed.entries || []).forEach(add);
  (sample.recentBreakdowns || []).forEach(add);

  const entries = Array.from(mergedMap.values())
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const output = {
    updatedAt: new Date().toISOString(),
    record: summarize(entries),
    entries
  };

  writeJson(PICK_HISTORY_PATH, output);
  console.log(`Backfilled ${entries.length} settled history entr${entries.length === 1 ? "y" : "ies"}.`);
}

main();
