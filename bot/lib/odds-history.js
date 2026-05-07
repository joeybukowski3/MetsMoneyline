const fs = require("fs");

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
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

function normalizeDate(value) {
  return String(value || "").slice(0, 10) || null;
}

function normalizeStartTime(value) {
  return value ? new Date(value).toISOString() : null;
}

function buildArchiveKey({ date, opponent, homeAway, startTime }) {
  const normalizedDate = normalizeDate(date) || "unknown-date";
  const normalizedOpponent = slugify(opponent) || "unknown-opponent";
  const normalizedHomeAway = String(homeAway || "unknown").toLowerCase();
  const timeToken = normalizeStartTime(startTime)?.slice(11, 16).replace(":", "") || "unknown";
  return `${normalizedDate}::${normalizedHomeAway}::${normalizedOpponent}::${timeToken}`;
}

function formatOddsValue(odds) {
  return typeof odds === "number" && Number.isFinite(odds)
    ? (odds > 0 ? `+${odds}` : String(odds))
    : "N/A";
}

function getMoneylineMarket(oddsPayload = {}) {
  const primaryMarkets = Array.isArray(oddsPayload?.markets) ? oddsPayload.markets : [];
  const consensusMarkets = Array.isArray(oddsPayload?.consensus?.markets) ? oddsPayload.consensus.markets : [];
  return [...primaryMarkets, ...consensusMarkets]
    .find((market) => /moneyline|h2h/i.test(String(market?.label || market?.key || ""))) || null;
}

function findOutcomePrice(market, teamName) {
  if (!market || !teamName) return null;
  const outcome = Array.isArray(market?.outcomes)
    ? market.outcomes.find((entry) => String(entry?.name || "").toLowerCase() === String(teamName).toLowerCase())
    : null;
  return typeof outcome?.price === "number" && Number.isFinite(outcome.price) ? outcome.price : null;
}

function extractMoneylineSnapshot(oddsPayload, teams = {}) {
  const homeTeamName = teams?.homeTeamName || null;
  const awayTeamName = teams?.awayTeamName || null;
  const market = getMoneylineMarket(oddsPayload);
  if (!market || !homeTeamName || !awayTeamName) return null;

  const homePrice = findOutcomePrice(market, homeTeamName);
  const awayPrice = findOutcomePrice(market, awayTeamName);
  if (homePrice == null && awayPrice == null) return null;

  return {
    home: homePrice,
    away: awayPrice,
    bookmaker: oddsPayload?.consensus?.title || oddsPayload?.consensus?.key || null
  };
}

function upsertOddsHistoryEntry(history, payload) {
  const {
    date,
    startTime,
    opponent,
    homeAway,
    apiGameId,
    homeTeamName,
    awayTeamName,
    oddsPayload,
    capturedAt = new Date().toISOString()
  } = payload || {};

  const snapshot = extractMoneylineSnapshot(oddsPayload, { homeTeamName, awayTeamName });
  if (!snapshot) return null;

  const key = buildArchiveKey({ date, opponent, homeAway, startTime });
  const entries = Array.isArray(history?.entries) ? [...history.entries] : [];
  const entryIndex = entries.findIndex((entry) => entry?.key === key);
  const existingEntry = entryIndex >= 0 ? entries[entryIndex] : null;
  const existingSnapshots = Array.isArray(existingEntry?.snapshots) ? existingEntry.snapshots : [];

  const dedupeToken = `${normalizeStartTime(capturedAt)}::${snapshot.home ?? "na"}::${snapshot.away ?? "na"}::${snapshot.bookmaker || "na"}`;
  const alreadyExists = existingSnapshots.some((entry) => (
    `${normalizeStartTime(entry?.capturedAt)}::${entry?.home ?? "na"}::${entry?.away ?? "na"}::${entry?.bookmaker || "na"}`
  ) === dedupeToken);

  const snapshots = alreadyExists
    ? existingSnapshots
    : [...existingSnapshots, {
        capturedAt: normalizeStartTime(capturedAt),
        home: snapshot.home,
        away: snapshot.away,
        bookmaker: snapshot.bookmaker,
        provider: oddsPayload?.meta?.provider || null,
        sourceGameId: oddsPayload?.gameId || null
      }].sort((a, b) => new Date(a.capturedAt || 0) - new Date(b.capturedAt || 0));

  const nextEntry = {
    key,
    date: normalizeDate(date),
    startTime: normalizeStartTime(startTime),
    opponent,
    homeAway,
    apiGameId: apiGameId || existingEntry?.apiGameId || null,
    homeTeamName,
    awayTeamName,
    lastCapturedAt: normalizeStartTime(capturedAt),
    latest: {
      home: snapshot.home,
      away: snapshot.away,
      bookmaker: snapshot.bookmaker,
      provider: oddsPayload?.meta?.provider || null,
      sourceGameId: oddsPayload?.gameId || null
    },
    snapshots
  };

  if (entryIndex >= 0) entries[entryIndex] = nextEntry;
  else entries.push(nextEntry);

  return {
    updatedAt: normalizeStartTime(capturedAt),
    entries: entries.sort((a, b) => String(a.startTime || a.date).localeCompare(String(b.startTime || b.date)))
  };
}

function loadOddsHistory(filePath) {
  return readJson(filePath, {
    updatedAt: null,
    entries: []
  });
}

function saveOddsHistory(filePath, history) {
  writeJson(filePath, history);
}

function resolveArchivedOdds(history, game) {
  const entries = Array.isArray(history?.entries) ? history.entries : [];
  const gameDate = normalizeDate(game?.date);
  const gameTime = normalizeStartTime(game?.startTime);
  const gameOpponent = String(game?.opponent || "");
  const gameHomeAway = String(game?.homeAway || "").toLowerCase();
  const manualBackfill = entries.find((entry) => (
    entry?.archived === true &&
    entry?.source === "manual-backfill" &&
    normalizeDate(entry?.date) === gameDate &&
    String(entry?.opponent || "") === gameOpponent &&
    typeof entry?.metsML === "number" &&
    Number.isFinite(entry.metsML)
  ));

  if (manualBackfill) {
    return {
      odds: manualBackfill.metsML,
      oppOdds: null,
      source: "odds-history-manual-backfill",
      capturedAt: null,
      bookmaker: manualBackfill.source,
      key: `manual-backfill::${gameDate}::${gameOpponent}::${gameHomeAway || "unknown"}`
    };
  }

  const candidates = entries.filter((entry) => (
    normalizeDate(entry?.date) === gameDate &&
    String(entry?.opponent || "") === gameOpponent &&
    String(entry?.homeAway || "").toLowerCase() === gameHomeAway
  ));

  if (!candidates.length) return null;

  const exact = gameTime
    ? candidates.find((entry) => normalizeStartTime(entry?.startTime) === gameTime)
    : null;
  const chosenEntry = exact || candidates.sort((a, b) => {
    const aDiff = Math.abs(new Date(normalizeStartTime(a?.startTime) || 0).getTime() - new Date(gameTime || 0).getTime());
    const bDiff = Math.abs(new Date(normalizeStartTime(b?.startTime) || 0).getTime() - new Date(gameTime || 0).getTime());
    return aDiff - bDiff;
  })[0];

  const snapshots = Array.isArray(chosenEntry?.snapshots) ? chosenEntry.snapshots : [];
  const beforeFirstPitch = gameTime
    ? snapshots.filter((entry) => new Date(entry?.capturedAt || 0).getTime() <= new Date(gameTime).getTime())
    : snapshots;
  const selectedSnapshot = beforeFirstPitch[beforeFirstPitch.length - 1] || snapshots[snapshots.length - 1] || null;
  if (!selectedSnapshot) return null;

  const metsOdds = gameHomeAway === "home" ? selectedSnapshot.home : selectedSnapshot.away;
  const oppOdds = gameHomeAway === "home" ? selectedSnapshot.away : selectedSnapshot.home;
  if (typeof metsOdds !== "number" || !Number.isFinite(metsOdds)) return null;

  return {
    odds: metsOdds,
    oppOdds: typeof oppOdds === "number" && Number.isFinite(oppOdds) ? oppOdds : null,
    source: "odds-history",
    capturedAt: selectedSnapshot.capturedAt || chosenEntry?.lastCapturedAt || null,
    bookmaker: selectedSnapshot.bookmaker || chosenEntry?.latest?.bookmaker || null,
    key: chosenEntry.key
  };
}

module.exports = {
  buildArchiveKey,
  formatOddsValue,
  loadOddsHistory,
  resolveArchivedOdds,
  saveOddsHistory,
  upsertOddsHistoryEntry
};
