const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { normalizeTeamIdentity } = require("../lib/mlb-team-identity");
const { apiSportsGet, getApiSportsConfig } = require("./lib/api-sports-client");
const {
  extractApiSportsGames,
  normalizeLiveGame,
  normalizeNextGame,
  normalizeOdds,
  normalizeRecentGames,
  normalizeStandings
} = require("./lib/api-sports-normalizers");

const PUBLIC_API_ROOT = path.join(__dirname, "../public/api/mlb/mets");
const GAME_ROOT = path.join(PUBLIC_API_ROOT, "game");
const EASTERN_TIME_ZONE = "America/New_York";
const ODDS_API_BASE_URL = "https://api.the-odds-api.com/v4";
const MLB_STATS_METS_TEAM_ID = 121;

function getCurrentSeason() {
  return Number(new Date().toLocaleDateString("en-CA", { timeZone: EASTERN_TIME_ZONE }).slice(0, 4));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJsonEndpoint(relativePath, payload) {
  const fullPath = path.join(PUBLIC_API_ROOT, relativePath);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, JSON.stringify(payload, null, 2));
}

async function fetchJsonOrNull(url) {
  try {
    const response = await axios.get(url, { timeout: 15000 });
    return response.data;
  } catch {
    return null;
  }
}

function sortByDateAsc(games) {
  return [...games].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
}

function sortByDateDesc(games) {
  return [...games].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

function isLiveStatus(game) {
  return Boolean(game?.status?.isLive);
}

function isFinalStatus(game) {
  return Boolean(game?.status?.isFinal);
}

function isUpcomingStatus(game) {
  return !isLiveStatus(game) && !isFinalStatus(game);
}

async function fetchMlbStatsUpcomingGame() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: EASTERN_TIME_ZONE });
  const endDate = new Date(`${today}T12:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 7);
  const endDateIso = endDate.toISOString().slice(0, 10);
  const payload = await fetchJsonOrNull(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${MLB_STATS_METS_TEAM_ID}&startDate=${today}&endDate=${endDateIso}&hydrate=team,venue,linescore`
  );
  const games = (payload?.dates || [])
    .flatMap((dateEntry) => dateEntry.games || [])
    .sort((a, b) => new Date(a.gameDate || 0) - new Date(b.gameDate || 0));
  const game = games[0] || null;
  if (!game) return null;
  return {
    date: game.gameDate || null,
    home: { name: game?.teams?.home?.team?.name || null },
    away: { name: game?.teams?.away?.team?.name || null }
  };
}

async function fetchApiSportsGames(config, season) {
  const payload = await apiSportsGet("/games", {
    league: config.leagueId,
    season,
    team: config.metsTeamId
  });
  return extractApiSportsGames(payload);
}

async function fetchApiSportsStandings(config, season) {
  const payload = await apiSportsGet("/standings", {
    league: config.leagueId,
    season
  });
  return normalizeStandings(payload, config.metsTeamId);
}

async function fetchApiSportsOdds(config, targetGameId) {
  if (!targetGameId) {
    return {
      gameId: null,
      markets: [],
      bookmakers: [],
      consensus: null,
      raw: null
    };
  }

  try {
    const payload = await apiSportsGet("/odds", {
      league: config.leagueId,
      season: getCurrentSeason(),
      game: targetGameId
    });
    return normalizeOdds(payload, targetGameId);
  } catch (error) {
    console.warn(`[warn] API-SPORTS odds fetch failed: ${error.message}`);
    return {
      gameId: targetGameId,
      markets: [],
      bookmakers: [],
      consensus: null,
      raw: null
    };
  }
}

function canonicalTeamKeyFromName(name) {
  return normalizeTeamIdentity({ name }).canonicalKey || String(name || "").toLowerCase();
}

function normalizeTheOddsApiMarket(market = {}) {
  return {
    key: market?.key || null,
    label: market?.key || "Market",
    outcomes: Array.isArray(market?.outcomes)
      ? market.outcomes.map((outcome) => ({
          name: outcome?.name || null,
          price: typeof outcome?.price === "number" ? outcome.price : null,
          point: typeof outcome?.point === "number" ? outcome.point : null
        }))
      : []
  };
}

function normalizeTheOddsApiEvent(event) {
  if (!event) {
    return {
      gameId: null,
      markets: [],
      bookmakers: [],
      consensus: null,
      raw: null
    };
  }

  const bookmakers = Array.isArray(event?.bookmakers)
    ? event.bookmakers.map((bookmaker) => ({
        key: bookmaker?.key || null,
        title: bookmaker?.title || bookmaker?.key || "Bookmaker",
        markets: Array.isArray(bookmaker?.markets) ? bookmaker.markets.map(normalizeTheOddsApiMarket) : []
      }))
    : [];

  return {
    gameId: event?.id || null,
    markets: bookmakers[0]?.markets || [],
    bookmakers,
    consensus: bookmakers[0] || null,
    raw: event
  };
}

function scoreOddsEventMatch(event, nextGame) {
  if (!event || !nextGame) return -1;
  const homeKey = canonicalTeamKeyFromName(event.home_team);
  const awayKey = canonicalTeamKeyFromName(event.away_team);
  const nextHomeKey = canonicalTeamKeyFromName(nextGame.home?.name);
  const nextAwayKey = canonicalTeamKeyFromName(nextGame.away?.name);
  let score = 0;
  if (homeKey === nextHomeKey) score += 2;
  if (awayKey === nextAwayKey) score += 2;
  const eventTime = event?.commence_time ? new Date(event.commence_time).getTime() : NaN;
  const nextTime = nextGame?.date ? new Date(nextGame.date).getTime() : NaN;
  if (Number.isFinite(eventTime) && Number.isFinite(nextTime)) {
    const diffMinutes = Math.abs(eventTime - nextTime) / 60000;
    if (diffMinutes <= 10) score += 2;
    else if (diffMinutes <= 60) score += 1;
  }
  return score;
}

async function fetchTheOddsApiOdds(nextGame) {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return null;

  const response = await axios.get(`${ODDS_API_BASE_URL}/sports/baseball_mlb/odds`, {
    timeout: 15000,
    params: {
      apiKey,
      regions: "us",
      markets: "h2h,spreads,totals",
      oddsFormat: "american",
      dateFormat: "iso"
    }
  });

  const events = Array.isArray(response.data) ? response.data : [];
  console.log(`[odds] The Odds API returned ${events.length} MLB events`);

  if (events.length === 0) return null;

  // Primary: score-based matching against the reference game (requires both teams to match)
  if (nextGame) {
    const best = events
      .map((event) => ({ event, score: scoreOddsEventMatch(event, nextGame) }))
      .filter((entry) => entry.score >= 4)
      .sort((a, b) => b.score - a.score)[0];
    if (best) {
      console.log(`[odds] Score match: ${best.event.home_team} vs ${best.event.away_team} (score ${best.score})`);
      return normalizeTheOddsApiEvent(best.event);
    }
    console.log(`[odds] No score >= 4 match found; falling back to Mets name search`);
  }

  // Fallback: find any upcoming event that includes the Mets
  const metsEvent = events.find((e) =>
    /new york mets|^mets$/i.test(e.home_team || "") ||
    /new york mets|^mets$/i.test(e.away_team || "")
  );
  if (metsEvent) {
    console.log(`[odds] Mets name match: ${metsEvent.home_team} vs ${metsEvent.away_team}`);
    return normalizeTheOddsApiEvent(metsEvent);
  }

  console.log(`[odds] No Mets game found in The Odds API response`);
  return null;
}

async function buildOverviewEndpoint(config, season, standings) {
  const metsIdentity = normalizeTeamIdentity({ mlbStatsTeamId: 121, apiSportsTeamId: config.metsTeamId, name: "New York Mets", abbreviation: "NYM" }, config.metsTeamId);
  const metsMlbStatsTeamId = metsIdentity.mlbStatsTeamId || 121;
  const teamStats = await fetchJsonOrNull(`https://statsapi.mlb.com/api/v1/teams/${metsMlbStatsTeamId}/stats?stats=season&group=hitting,pitching,fielding&season=${season}`);
  const hitters = await fetchJsonOrNull(`https://statsapi.mlb.com/api/v1/teams/${metsMlbStatsTeamId}/roster?rosterType=active&hydrate=person(stats(type=season,group=hitting,season=${season}))`);
  const pitchers = await fetchJsonOrNull(`https://statsapi.mlb.com/api/v1/teams/${metsMlbStatsTeamId}/roster?rosterType=active&hydrate=person(stats(type=season,group=pitching,season=${season}))`);

  return {
    teamId: metsMlbStatsTeamId,
    season,
    standings,
    teamStats: teamStats?.stats || [],
    hitters: hitters?.roster || [],
    pitchers: pitchers?.roster || [],
    source: {
      provider: "mlb-stats-api",
      note: "Overview remains server-side MLB Stats API because API-SPORTS is only being used as the primary provider for game, standings, recent results, and odds data."
    }
  };
}

function buildGameEndpointPayload(game, config, standings, recentGames, odds) {
  const metsIdentity = normalizeTeamIdentity({ mlbStatsTeamId: 121, apiSportsTeamId: config.metsTeamId, name: "New York Mets", abbreviation: "NYM" }, config.metsTeamId);
  return {
    gameId: game?.gameId || null,
    startTime: game?.date || null,
    status: game?.status?.long || null,
    homeTeam: game?.home || null,
    awayTeam: game?.away || null,
    isMetsHome:
      String(game?.home?.id) === String(metsIdentity.mlbStatsTeamId) ||
      String(game?.home?.apiSportsTeamId) === String(metsIdentity.apiSportsTeamId),
    venue: game?.venue || null,
    league: game?.leagueId || config.leagueId,
    sportsbookSummary: odds?.consensus || null,
    standings,
    recentGames,
    raw: game?.raw || null
  };
}

async function run() {
  const config = getApiSportsConfig();
  const metsIdentity = normalizeTeamIdentity({ mlbStatsTeamId: 121, apiSportsTeamId: config.metsTeamId, name: "New York Mets", abbreviation: "NYM" }, config.metsTeamId);
  const season = getCurrentSeason();
  ensureDir(PUBLIC_API_ROOT);
  ensureDir(GAME_ROOT);

  // Confirm these IDs against your API-SPORTS account if their Baseball API uses different IDs.
  const games = sortByDateAsc(await fetchApiSportsGames(config, season));
  const standings = await fetchApiSportsStandings(config, season);

  const liveGame = games.find(isLiveStatus) || null;
  const nextGame = games.filter(isUpcomingStatus)[0] || null;
  const mlbStatsUpcomingGame = await fetchMlbStatsUpcomingGame();
  const recentGamesRaw = sortByDateDesc(games.filter(isFinalStatus)).slice(0, 10);
  const recentGames = normalizeRecentGames(recentGamesRaw, config.metsTeamId);
  let odds = null;
  try {
    odds = await fetchTheOddsApiOdds(nextGame || liveGame || mlbStatsUpcomingGame);
  } catch (error) {
    console.warn(`[warn] OddsAPI odds fetch failed: ${error.message}`);
  }
  if (!odds) {
    odds = await fetchApiSportsOdds(config, liveGame?.gameId || nextGame?.gameId || null);
  }

  const nextGamePayload = {
    ...normalizeNextGame(nextGame, config.metsTeamId, odds),
    meta: {
      provider: "api-sports",
      generatedAt: new Date().toISOString(),
      cacheHint: "schedule: 15-30 minutes"
    }
  };

  const liveGamePayload = {
    ...normalizeLiveGame(liveGame),
    meta: {
      provider: "api-sports",
      generatedAt: new Date().toISOString(),
      cacheHint: liveGame ? "live: 15-30 seconds" : "schedule: 15-30 minutes"
    }
  };

  const standingsPayload = {
    ...standings,
    meta: {
      provider: "api-sports",
      generatedAt: new Date().toISOString(),
      cacheHint: "standings: 10-15 minutes"
    }
  };

  const recentGamesPayload = {
    season,
    teamId: metsIdentity.mlbStatsTeamId || 121,
    games: recentGames,
    meta: {
      provider: "api-sports",
      generatedAt: new Date().toISOString(),
      cacheHint: "history: long cache"
    }
  };

  const oddsPayload = {
    ...odds,
    meta: {
      provider: process.env.ODDS_API_KEY ? (odds?.raw?.sport_key ? "the-odds-api" : "api-sports") : "api-sports",
      generatedAt: new Date().toISOString(),
      cacheHint: "odds: 2-5 minutes"
    }
  };

  const overviewPayload = await buildOverviewEndpoint(config, season, standingsPayload);

  writeJsonEndpoint("next-game", nextGamePayload);
  writeJsonEndpoint("live-game", liveGamePayload);
  writeJsonEndpoint("standings", standingsPayload);
  writeJsonEndpoint("recent-games", recentGamesPayload);
  writeJsonEndpoint("odds", oddsPayload);
  writeJsonEndpoint("overview", overviewPayload);

  for (const game of games) {
    const gamePayload = buildGameEndpointPayload(game, config, standingsPayload, recentGamesPayload.games, oddsPayload);
    fs.writeFileSync(path.join(GAME_ROOT, String(game.gameId)), JSON.stringify(gamePayload, null, 2));
  }

  console.log("Wrote API-SPORTS-backed internal MLB endpoints to public/api/mlb/mets");
}

run().catch((error) => {
  console.error("Failed to build API cache:", error.message);
  process.exit(1);
});
