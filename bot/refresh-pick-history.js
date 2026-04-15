const fs = require("fs");
const path = require("path");

const TEAM_ID = 121;
const TIME_ZONE = "America/New_York";
const SAMPLE_JSON_PATH = path.join(__dirname, "../public/data/sample-game.json");
const PICK_HISTORY_PATH = path.join(__dirname, "../public/data/pick-history.json");
const PICK_HISTORY_SEED_PATH = path.join(__dirname, "../public/data/pick-history-seed.json");
const MANUAL_HISTORY_ODDS = [
  { date: "2026-04-14", opponent: "Los Angeles Dodgers", homeAway: "road", odds: 145 },
  { date: "2026-04-13", opponent: "Los Angeles Dodgers", homeAway: "road", odds: 155 },
  { date: "2026-04-12", opponent: "Athletics", homeAway: "home", odds: -185 },
  { date: "2026-04-11", opponent: "Athletics", homeAway: "home", odds: -175 },
  { date: "2026-04-10", opponent: "Athletics", homeAway: "home", odds: -180 },
  { date: "2026-04-09", opponent: "Arizona Diamondbacks", homeAway: "home", odds: -125 },
  { date: "2026-04-08", opponent: "Arizona Diamondbacks", homeAway: "home", odds: -130 },
  { date: "2026-04-07", opponent: "Arizona Diamondbacks", homeAway: "home", odds: -120 },
  { date: "2026-04-05", opponent: "San Francisco Giants", homeAway: "road", odds: 110 },
  { date: "2026-04-04", opponent: "San Francisco Giants", homeAway: "road", odds: 105 },
  { date: "2026-04-02", opponent: "San Francisco Giants", homeAway: "road", odds: 115 },
  { date: "2026-03-26", opponent: "Pittsburgh Pirates", homeAway: "home", odds: -165 }
];

function getCurrentSeason() {
  return Number(new Date().toLocaleDateString("en-CA", { timeZone: TIME_ZONE }).slice(0, 4));
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function buildGameId(date, opponent) {
  return `${date}-mets-vs-${slugify(opponent)}`;
}

function buildEntryKey(entry = {}) {
  return entry.gameId || `${entry.date || ""}::${entry.opponent || ""}::${entry.homeAway || ""}`;
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function calculateMoneylineProfit(odds, stake = 100) {
  if (typeof odds !== "number" || !Number.isFinite(odds)) return null;
  if (odds < 0) return Number(((stake / Math.abs(odds)) * 100).toFixed(2));
  return Number(((odds / 100) * stake).toFixed(2));
}

function isFinalGameStatus(game = {}) {
  const abstractState = String(game?.status?.abstractGameState || "").toLowerCase();
  const detailedState = String(game?.status?.detailedState || "").toLowerCase();
  const codedState = String(game?.status?.codedGameState || "").toUpperCase();
  return abstractState === "final"
    || /final|completed|game over/.test(detailedState)
    || ["F", "O"].includes(codedState);
}

function toHomeAway(game) {
  return Number(game?.teams?.home?.team?.id) === TEAM_ID ? "home" : "road";
}

function toOpponent(game) {
  return Number(game?.teams?.home?.team?.id) === TEAM_ID
    ? game?.teams?.away?.team?.name
    : game?.teams?.home?.team?.name;
}

function getFinalScore(game) {
  const metsSide = Number(game?.teams?.home?.team?.id) === TEAM_ID ? game?.teams?.home : game?.teams?.away;
  const oppSide = Number(game?.teams?.home?.team?.id) === TEAM_ID ? game?.teams?.away : game?.teams?.home;
  const metsScore = Number(metsSide?.score);
  const oppScore = Number(oppSide?.score);
  if (!Number.isFinite(metsScore) || !Number.isFinite(oppScore)) return null;
  return {
    mets: metsScore,
    opp: oppScore,
    display: `${metsScore}-${oppScore}`
  };
}

function normalizeStoredEntries(entries = []) {
  return Array.isArray(entries)
    ? entries.filter((entry) => entry?.date && entry?.opponent)
    : [];
}

function addOddsCandidate(map, entry, candidate) {
  if (typeof candidate?.odds !== "number" || !Number.isFinite(candidate.odds)) return;
  const keys = [buildEntryKey(entry)];
  if (entry?.date && entry?.opponent) {
    keys.push(`${entry.date}::${entry.opponent}::${entry.homeAway || ""}`);
    keys.push(buildGameId(entry.date, entry.opponent));
  }
  for (const key of keys) {
    if (!key) continue;
    const existing = map.get(key);
    if (!existing || candidate.priority < existing.priority) {
      map.set(key, candidate);
    }
  }
}

function buildOddsLookup(existingEntries, seedEntries, sampleGames) {
  const oddsMap = new Map();
  const metaMap = new Map();

  const captureMeta = (entry, meta = {}) => {
    const keys = [buildEntryKey(entry)];
    if (entry?.date && entry?.opponent) {
      keys.push(`${entry.date}::${entry.opponent}::${entry.homeAway || ""}`);
      keys.push(buildGameId(entry.date, entry.opponent));
    }
    for (const key of keys) {
      if (!key || metaMap.has(key)) continue;
      metaMap.set(key, {
        officialPick: entry?.officialPick || null,
        estimated: Boolean(entry?.estimated),
        market: entry?.market || "Mets Moneyline",
        ...meta
      });
    }
  };

  for (const entry of existingEntries) {
    captureMeta(entry);
    addOddsCandidate(oddsMap, entry, {
      odds: entry.odds,
      source: entry.estimated ? "pick-history-estimated" : "pick-history",
      priority: entry.estimated ? 4 : 3
    });
  }

  for (const entry of seedEntries) {
    captureMeta(entry, { estimated: true });
    addOddsCandidate(oddsMap, entry, {
      odds: entry.odds,
      source: "pick-history-seed",
      priority: 5
    });
  }

  for (const game of sampleGames) {
    const entry = {
      gameId: game?.id || null,
      date: game?.date || null,
      opponent: game?.opponent || null,
      homeAway: game?.homeAway || null,
      officialPick: game?.writeup?.officialPick || null,
      estimated: false,
      market: "Mets Moneyline"
    };
    captureMeta(entry);
    addOddsCandidate(oddsMap, entry, {
      odds: game?.moneyline?.mets,
      source: "sample-game.moneyline",
      priority: 1
    });
    addOddsCandidate(oddsMap, entry, {
      odds: game?.bettingHistory?.odds,
      source: "sample-game.bettingHistory",
      priority: 2
    });
  }

  for (const entry of MANUAL_HISTORY_ODDS) {
    captureMeta(entry, { estimated: false });
    addOddsCandidate(oddsMap, entry, {
      odds: entry.odds,
      source: "history-manual-override",
      priority: 0
    });
  }

  return { oddsMap, metaMap };
}

async function fetchSeasonSchedule(season) {
  const startDate = `${season}-03-01`;
  const endDate = `${season}-11-30`;
  const url = `https://statsapi.mlb.com/api/v1/schedule?teamId=${TEAM_ID}&sportId=1&gameType=R&startDate=${startDate}&endDate=${endDate}&hydrate=team,linescore`;
  console.log(`[history-refresh] Fetching season schedule: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Schedule request failed: ${response.status}`);
  }
  const payload = await response.json();
  const games = (payload?.dates || []).flatMap((dateEntry) => dateEntry.games || []);
  console.log(`[history-refresh] Loaded ${games.length} scheduled Mets games for ${season}`);
  return games;
}

function buildHistoryEntry(game, oddsLookup, metaLookup) {
  const date = String(game?.officialDate || game?.gameDate || "").slice(0, 10);
  const opponent = toOpponent(game);
  const homeAway = toHomeAway(game);
  const gameId = buildGameId(date, opponent);
  const lookupKeys = [gameId, `${date}::${opponent}::${homeAway}`];
  const oddsMatch = lookupKeys.map((key) => oddsLookup.get(key)).find(Boolean) || null;
  const metaMatch = lookupKeys.map((key) => metaLookup.get(key)).find(Boolean) || {};
  const isFinal = isFinalGameStatus(game);
  const finalScore = isFinal ? getFinalScore(game) : null;
  const result = isFinal && finalScore
    ? (finalScore.mets > finalScore.opp ? "W" : "L")
    : null;
  const gradingStatus = !isFinal
    ? "pending"
    : typeof oddsMatch?.odds === "number"
      ? "graded"
      : "missing_odds";
  const profit = gradingStatus === "graded"
    ? (result === "W" ? calculateMoneylineProfit(oddsMatch.odds, 100) : -100)
    : null;

  return {
    gameId,
    date,
    opponent,
    homeAway,
    estimated: Boolean(metaMatch.estimated),
    status: isFinal ? "final" : "pending",
    gradingStatus,
    finalScore: finalScore?.display || null,
    officialPick: metaMatch.officialPick || "Official Pick: Mets ML",
    market: metaMatch.market || "Mets Moneyline",
    odds: typeof oddsMatch?.odds === "number" ? oddsMatch.odds : null,
    oddsSource: oddsMatch?.source || "missing",
    resultSource: "mlb-stats-schedule",
    sourceGamePk: game?.gamePk || null,
    stake: 100,
    result,
    profit
  };
}

function summarize(entries) {
  const chronological = [...entries].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let runningProfit = 0;
  let wins = 0;
  let losses = 0;
  let gradedBets = 0;
  let pendingGames = 0;
  let missingOddsGames = 0;

  for (const entry of chronological) {
    if (entry.gradingStatus === "graded" && typeof entry.profit === "number") {
      gradedBets += 1;
      runningProfit += entry.profit;
      if (entry.result === "W") wins += 1;
      if (entry.result === "L") losses += 1;
      entry.cumulativeProfit = Number(runningProfit.toFixed(2));
    } else {
      entry.cumulativeProfit = null;
      if (entry.gradingStatus === "pending") pendingGames += 1;
      if (entry.gradingStatus === "missing_odds") missingOddsGames += 1;
    }

    console.log(
      `[history-refresh] ${entry.date} ${entry.opponent} ${entry.homeAway} `
      + `gamePk=${entry.sourceGamePk || "n/a"} odds=${entry.odds ?? "missing"} (${entry.oddsSource}) `
      + `score=${entry.finalScore || "pending"} result=${entry.result || "pending"} `
      + `grade=${entry.gradingStatus} gamePL=${entry.profit ?? "n/a"} cumulative=${entry.cumulativeProfit ?? "n/a"}`
    );
  }

  const totalWagered = gradedBets * 100;
  const profit = Number(runningProfit.toFixed(2));

  return {
    orderedEntries: chronological.sort((a, b) => String(b.date).localeCompare(String(a.date))),
    record: {
      completedGames: chronological.length,
      wins,
      losses,
      profit,
      totalBets: gradedBets,
      totalWagered: Number(totalWagered.toFixed(2)),
      roi: totalWagered > 0 ? Number(((profit / totalWagered) * 100).toFixed(2)) : 0,
      pendingGames,
      missingOddsGames
    }
  };
}

async function main() {
  const season = getCurrentSeason();
  const existingHistory = readJson(PICK_HISTORY_PATH, { entries: [] });
  const seededHistory = readJson(PICK_HISTORY_SEED_PATH, { entries: [] });
  const sampleGame = readJson(SAMPLE_JSON_PATH, { games: [] });
  const existingEntries = normalizeStoredEntries(existingHistory.entries || existingHistory.recentBreakdowns);
  const seedEntries = normalizeStoredEntries(seededHistory.entries);
  const sampleGames = Array.isArray(sampleGame?.games) ? sampleGame.games : [];
  const { oddsMap, metaMap } = buildOddsLookup(existingEntries, seedEntries, sampleGames);
  const scheduleGames = await fetchSeasonSchedule(season);
  const completedGames = scheduleGames.filter((game) => isFinalGameStatus(game));
  const pendingGames = Math.max(scheduleGames.length - completedGames.length, 0);
  console.log(`[history-refresh] Completed games=${completedGames.length} pending games omitted=${pendingGames}`);
  const entries = completedGames.map((game) => buildHistoryEntry(game, oddsMap, metaMap));
  const { orderedEntries, record } = summarize(entries);

  const output = {
    updatedAt: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    season,
    record,
    omittedPendingGames: pendingGames,
    entries: orderedEntries,
    recentBreakdowns: orderedEntries
  };

  fs.writeFileSync(PICK_HISTORY_PATH, JSON.stringify(output, null, 2));
  console.log(`[history-refresh] Wrote ${PICK_HISTORY_PATH}`);
  console.log(`[history-refresh] Summary graded=${record.totalBets} wins=${record.wins} losses=${record.losses} pending=${record.pendingGames} missingOdds=${record.missingOddsGames} profit=${record.profit}`);
}

main().catch((error) => {
  console.error(`[history-refresh] Failed: ${error.stack || error.message}`);
  process.exit(1);
});
