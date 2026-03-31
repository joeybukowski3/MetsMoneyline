const fs = require("fs");
const path = require("path");
const axios = require("axios");
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

async function buildOverviewEndpoint(config, season, standings) {
  const teamStats = await fetchJsonOrNull(`https://statsapi.mlb.com/api/v1/teams/${config.metsTeamId}/stats?stats=season&group=hitting,pitching,fielding&season=${season}`);
  const hitters = await fetchJsonOrNull(`https://statsapi.mlb.com/api/v1/teams/${config.metsTeamId}/roster?rosterType=active&hydrate=person(stats(type=season,group=hitting,season=${season}))`);
  const pitchers = await fetchJsonOrNull(`https://statsapi.mlb.com/api/v1/teams/${config.metsTeamId}/roster?rosterType=active&hydrate=person(stats(type=season,group=pitching,season=${season}))`);

  return {
    teamId: config.metsTeamId,
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
  return {
    gameId: game?.gameId || null,
    startTime: game?.date || null,
    status: game?.status?.long || null,
    homeTeam: game?.home || null,
    awayTeam: game?.away || null,
    isMetsHome: String(game?.home?.id) === String(config.metsTeamId),
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
  const season = getCurrentSeason();
  ensureDir(PUBLIC_API_ROOT);
  ensureDir(GAME_ROOT);

  // Confirm these IDs against your API-SPORTS account if their Baseball API uses different IDs.
  const games = sortByDateAsc(await fetchApiSportsGames(config, season));
  const standings = await fetchApiSportsStandings(config, season);

  const liveGame = games.find(isLiveStatus) || null;
  const nextGame = games.filter(isUpcomingStatus)[0] || null;
  const recentGamesRaw = sortByDateDesc(games.filter(isFinalStatus)).slice(0, 10);
  const recentGames = normalizeRecentGames(recentGamesRaw, config.metsTeamId);
  const odds = await fetchApiSportsOdds(config, liveGame?.gameId || nextGame?.gameId || null);

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
    teamId: config.metsTeamId,
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
      provider: "api-sports",
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
