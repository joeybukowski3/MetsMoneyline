const { apiSportsGet, getApiSportsConfig } = require("./api-sports");
const { buildUrl, fetchJsonWithRetry } = require("./http");
const { normalizeTeamIdentity } = require("../../lib/mlb-team-identity");
const {
  extractApiSportsGames,
  normalizeLiveGame,
  normalizeNextGame,
  normalizeOdds,
  normalizeRecentGames,
  normalizeStandings
} = require("./normalizers");

const EASTERN_TIME_ZONE = "America/New_York";
const DEFAULT_MLB_STATS_TEAM_ID = 121;

function getCurrentSeason() {
  return Number(new Date().toLocaleDateString("en-CA", { timeZone: EASTERN_TIME_ZONE }).slice(0, 4));
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

async function fetchApiSportsGames(config = getApiSportsConfig(), season = getCurrentSeason()) {
  const payload = await apiSportsGet("/games", {
    league: config.leagueId,
    season,
    team: config.metsTeamId
  });
  return extractApiSportsGames(payload);
}

async function fetchApiSportsStandings(config = getApiSportsConfig(), season = getCurrentSeason()) {
  const params = {
    league: config.leagueId,
    season
  };
  const url = buildUrl(`${config.baseUrl}/standings`, params);
  console.log(`[debug] Fetching standings from ${url}`);
  const payload = await apiSportsGet("/standings", params);
  console.log(`[debug] Standings payload response keys: ${Object.keys(payload || {}).join(", ")}`);
  console.log(`[debug] Standings response length: ${Array.isArray(payload?.response) ? payload.response.length : 0}`);
  if (payload?.errors) {
    console.log(`[debug] Standings errors: ${JSON.stringify(payload.errors, null, 2)}`);
  }
  console.log(`[debug] Standings raw payload (truncated): ${JSON.stringify({
    parameters: payload?.parameters,
    response: Array.isArray(payload?.response) ? payload.response.slice(0, 2) : payload?.response
  }, null, 2)}`);
  console.log('[debug] Standings raw errors:', JSON.stringify(payload?.errors));
  console.log('[debug] Standings response[0]:', JSON.stringify(payload?.response?.[0] ?? 'EMPTY'));
  return normalizeStandings(payload, config.metsTeamId);
}

async function fetchApiSportsOdds(targetGameId, config = getApiSportsConfig(), season = getCurrentSeason()) {
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
      season,
      game: targetGameId
    });
    return normalizeOdds(payload, targetGameId);
  } catch (error) {
    return {
      gameId: targetGameId,
      markets: [],
      bookmakers: [],
      consensus: null,
      raw: null,
      error: error.message
    };
  }
}

async function getGamesBundle(config = getApiSportsConfig(), season = getCurrentSeason()) {
  const games = sortByDateAsc(await fetchApiSportsGames(config, season));
  const liveGame = games.find(isLiveStatus) || null;
  const nextGame = games.filter(isUpcomingStatus)[0] || null;
  const recentGamesRaw = sortByDateDesc(games.filter(isFinalStatus)).slice(0, 10);

  return {
    config,
    season,
    games,
    liveGame,
    nextGame,
    recentGamesRaw
  };
}

async function buildNextGamePayload() {
  const bundle = await getGamesBundle();
  const odds = await fetchApiSportsOdds(bundle.liveGame?.gameId || bundle.nextGame?.gameId || null, bundle.config, bundle.season);
  return {
    ...normalizeNextGame(bundle.nextGame, bundle.config.metsTeamId, odds),
    meta: {
      provider: "api-sports",
      generatedAt: new Date().toISOString(),
      cacheHint: "schedule: 15-30 minutes"
    }
  };
}

async function buildLiveGamePayload() {
  const bundle = await getGamesBundle();
  return {
    ...normalizeLiveGame(bundle.liveGame),
    meta: {
      provider: "api-sports",
      generatedAt: new Date().toISOString(),
      cacheHint: bundle.liveGame ? "live: 15-30 seconds" : "schedule: 15-30 minutes"
    }
  };
}

async function buildStandingsPayload() {
  const standings = await fetchApiSportsStandings();
  return {
    ...standings,
    meta: {
      provider: "api-sports",
      generatedAt: new Date().toISOString(),
      cacheHint: "standings: 10-15 minutes"
    }
  };
}

async function buildRecentGamesPayload() {
  const config = getApiSportsConfig();
  const season = getCurrentSeason();
  const bundle = await getGamesBundle(config, season);
  const metsIdentity = normalizeTeamIdentity({ mlbStatsTeamId: 121, apiSportsTeamId: config.metsTeamId, name: "New York Mets", abbreviation: "NYM" }, config.metsTeamId);
  return {
    season,
    teamId: metsIdentity.mlbStatsTeamId || 121,
    games: normalizeRecentGames(bundle.recentGamesRaw, config.metsTeamId),
    meta: {
      provider: "api-sports",
      generatedAt: new Date().toISOString(),
      cacheHint: "history: long cache"
    }
  };
}

async function buildOddsPayload() {
  const bundle = await getGamesBundle();
  const odds = await fetchApiSportsOdds(bundle.liveGame?.gameId || bundle.nextGame?.gameId || null, bundle.config, bundle.season);
  return {
    ...odds,
    meta: {
      provider: "api-sports",
      generatedAt: new Date().toISOString(),
      cacheHint: "odds: 2-5 minutes"
    }
  };
}

async function buildOverviewPayload() {
  const config = getApiSportsConfig();
  const season = getCurrentSeason();
  const metsIdentity = normalizeTeamIdentity(
    { mlbStatsTeamId: DEFAULT_MLB_STATS_TEAM_ID, apiSportsTeamId: config.metsTeamId, name: "New York Mets", abbreviation: "NYM" },
    config.metsTeamId
  );
  const metsMlbStatsTeamId = Number(metsIdentity.mlbStatsTeamId) || DEFAULT_MLB_STATS_TEAM_ID;
  const standings = await buildStandingsPayload();

  let teamStatsPayload = null;
  let hittersPayload = null;
  let pitchersPayload = null;
  try {
    [teamStatsPayload, hittersPayload, pitchersPayload] = await Promise.all([
      fetchJsonWithRetry(`https://statsapi.mlb.com/api/v1/teams/${metsMlbStatsTeamId}/stats?stats=season&group=hitting,pitching,fielding&season=${season}`),
      fetchJsonWithRetry(`https://statsapi.mlb.com/api/v1/teams/${metsMlbStatsTeamId}/roster?rosterType=active&hydrate=person(stats(type=season,group=hitting,season=${season}))`),
      fetchJsonWithRetry(`https://statsapi.mlb.com/api/v1/teams/${metsMlbStatsTeamId}/roster?rosterType=active&hydrate=person(stats(type=season,group=pitching,season=${season}))`)
    ]);
  } catch (error) {
    console.warn("MLB stats overview fetch failed:", error?.message || error);
  }

  return {
    teamId: metsMlbStatsTeamId,
    season,
    standings,
    teamStats: teamStatsPayload?.stats || [],
    hitters: hittersPayload?.roster || [],
    pitchers: pitchersPayload?.roster || [],
    source: {
      provider: "mlb-stats-api",
      note: "Overview remains server-side MLB Stats API because API-SPORTS is the primary structured provider for game state, standings, recent results, and odds."
    },
    meta: {
      provider: "mlb-stats-api",
      generatedAt: new Date().toISOString(),
      cacheHint: "overview: 10-15 minutes"
    }
  };
}

async function buildGameDetailsPayload(gameId) {
  const config = getApiSportsConfig();
  const season = getCurrentSeason();
  const metsIdentity = normalizeTeamIdentity({ mlbStatsTeamId: 121, apiSportsTeamId: config.metsTeamId, name: "New York Mets", abbreviation: "NYM" }, config.metsTeamId);
  const bundle = await getGamesBundle(config, season);
  const game = bundle.games.find((entry) => String(entry.gameId) === String(gameId)) || null;
  if (!game) {
    const error = new Error(`Game not found: ${gameId}`);
    error.statusCode = 404;
    throw error;
  }

  const [standings, odds] = await Promise.all([
    buildStandingsPayload(),
    fetchApiSportsOdds(game.gameId, config, season)
  ]);

  return {
    gameId: game.gameId,
    startTime: game.date || null,
    status: game.status?.long || null,
    homeTeam: game.home || null,
    awayTeam: game.away || null,
    isMetsHome:
      String(game.home?.id) === String(metsIdentity.mlbStatsTeamId) ||
      String(game.home?.apiSportsTeamId) === String(metsIdentity.apiSportsTeamId),
    venue: game.venue || null,
    league: game.leagueId || config.leagueId,
    sportsbookSummary: odds?.consensus || null,
    standings,
    recentGames: normalizeRecentGames(bundle.recentGamesRaw, config.metsTeamId),
    raw: game.raw || null,
    meta: {
      provider: "api-sports",
      generatedAt: new Date().toISOString()
    }
  };
}

module.exports = {
  buildGameDetailsPayload,
  buildLiveGamePayload,
  buildNextGamePayload,
  buildOddsPayload,
  buildOverviewPayload,
  buildRecentGamesPayload,
  buildStandingsPayload,
  getCurrentSeason
};
