const { apiSportsGet, getApiSportsConfig } = require("./api-sports");
const { buildUrl, fetchJsonWithRetry } = require("./http");
const { normalizeTeamIdentity } = require("../../lib/mlb-team-identity");
const {
  addDaysToDateISO,
  buildDateScopedCacheKey,
  getEasternDateISO,
  getEasternYear,
  resolveFeaturedGameState
} = require("../../public/js/featured-game-state.js");
const {
  extractApiSportsGames,
  normalizeLiveGame,
  normalizeNextGame,
  normalizeOdds,
  normalizeRecentGames,
  normalizeStandings
} = require("./normalizers");

const EASTERN_TIME_ZONE = "America/New_York";
const ODDS_API_BASE_URL = "https://api.the-odds-api.com/v4";
const DEFAULT_MLB_STATS_TEAM_ID = 121;
const NATIONAL_LEAGUE_ID = 104;
const MLB_DIVISION_NAMES = {
  200: "American League West",
  201: "American League East",
  202: "American League Central",
  203: "National League West",
  204: "National League East",
  205: "National League Central"
};

function getCurrentSeason() {
  return getEasternYear();
}

function sortByDateAsc(games) {
  return [...games].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
}

function sortByDateDesc(games) {
  return [...games].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

function isFutureStartTime(value) {
  if (!value) return false;
  const startMs = new Date(value).getTime();
  if (!Number.isFinite(startMs)) return false;
  return startMs > (Date.now() + 60000);
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

function normalizePct(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.startsWith("0.") ? text.slice(1) : text;
}

function getSplitSummary(teamRecord, splitType) {
  const splitRecords = Array.isArray(teamRecord?.records?.splitRecords)
    ? teamRecord.records.splitRecords
    : Array.isArray(teamRecord?.records)
      ? teamRecord.records
      : [];
  const match = splitRecords.find((record) => String(record?.type || "").toLowerCase() === String(splitType).toLowerCase());
  if (!match) return null;
  const wins = Number(match?.wins);
  const losses = Number(match?.losses);
  if (!Number.isFinite(wins) || !Number.isFinite(losses)) return null;
  return `${wins}-${losses}`;
}

function sortDivisionTeams(a, b) {
  const aRank = Number(a?.divisionRank);
  const bRank = Number(b?.divisionRank);
  if (Number.isFinite(aRank) && Number.isFinite(bRank) && aRank !== bRank) {
    return aRank - bRank;
  }
  return String(a?.team || "").localeCompare(String(b?.team || ""));
}

function getMlbDivisionName(record = {}) {
  const divisionId = Number(record?.division?.id);
  return MLB_DIVISION_NAMES[divisionId]
    || record?.division?.name
    || record?.name
    || record?.league?.name
    || "National League";
}

function normalizeMlbStandings(payload) {
  const records = Array.isArray(payload?.records) ? payload.records : [];
  const teams = records.flatMap((divisionRecord) => {
    const divisionName = getMlbDivisionName(divisionRecord);
    const teamRecords = Array.isArray(divisionRecord?.teamRecords) ? divisionRecord.teamRecords : [];
    return teamRecords.map((teamRecord) => {
      const identity = normalizeTeamIdentity(teamRecord?.team || {}, null);
      return {
        teamId: identity.mlbStatsTeamId ?? teamRecord?.team?.id ?? null,
        canonicalKey: identity.canonicalKey,
        mlbStatsTeamId: identity.mlbStatsTeamId ?? teamRecord?.team?.id ?? null,
        apiSportsTeamId: identity.apiSportsTeamId,
        team: identity.name || teamRecord?.team?.name || "Unknown Team",
        abbreviation: identity.abbreviation || teamRecord?.team?.abbreviation || null,
        wins: Number(teamRecord?.wins) || 0,
        losses: Number(teamRecord?.losses) || 0,
        pct: normalizePct(teamRecord?.winningPercentage ?? teamRecord?.pct),
        gamesBack: teamRecord?.divisionGamesBack || teamRecord?.gamesBack || "-",
        home: getSplitSummary(teamRecord, "home"),
        road: getSplitSummary(teamRecord, "away"),
        last10: getSplitSummary(teamRecord, "lastTen"),
        streak: teamRecord?.streak?.streakCode || null,
        division: divisionName,
        divisionRank: Number(teamRecord?.divisionRank) || null
      };
    });
  });

  teams.sort(sortDivisionTeams);
  const mets = teams.find((team) => String(team.teamId) === String(DEFAULT_MLB_STATS_TEAM_ID)) || null;

  return {
    division: mets?.division || "NL East",
    season: Number(payload?.records?.[0]?.league?.season || payload?.records?.[0]?.season || getCurrentSeason()),
    teams
  };
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

async function fetchMlbStatsStandings(season = getCurrentSeason()) {
  const payload = await fetchJsonWithRetry(
    `https://statsapi.mlb.com/api/v1/standings?leagueId=${NATIONAL_LEAGUE_ID}&season=${season}&standingsTypes=regularSeason`
  );
  return normalizeMlbStandings(payload);
}

function getPitcherStatValue(playerPayload, groupName, statType, statKey) {
  const stats = Array.isArray(playerPayload?.stats) ? playerPayload.stats : [];
  const entry = stats.find((item) => (
    String(item?.group?.displayName || item?.group?.name || "").toLowerCase() === String(groupName).toLowerCase()
    && String(item?.type?.displayName || item?.type?.name || "").toLowerCase() === String(statType).toLowerCase()
  ));
  return entry?.splits?.[0]?.stat?.[statKey] ?? null;
}

async function fetchPitcherPreviewStats(pitcherId) {
  if (!pitcherId) return null;
  const payload = await fetchJsonWithRetry(
    `https://statsapi.mlb.com/api/v1/people/${pitcherId}?hydrate=stats(group=[pitching],type=[season,seasonAdvanced],sportId=1)`
  ).catch(() => null);
  const player = payload?.people?.[0];
  if (!player) return null;
  return {
    era: getPitcherStatValue(player, "pitching", "season", "era"),
    whip: getPitcherStatValue(player, "pitching", "season", "whip"),
    fip: getPitcherStatValue(player, "pitching", "season advanced", "fip")
  };
}

async function buildProbablePitcherPreview(probablePitcher) {
  if (!probablePitcher?.id && !probablePitcher?.fullName) return null;
  const stats = probablePitcher?.id ? await fetchPitcherPreviewStats(probablePitcher.id) : null;
  return {
    id: probablePitcher?.id ?? null,
    fullName: probablePitcher?.fullName || "TBD",
    era: stats?.era ?? null,
    fip: stats?.fip ?? null,
    whip: stats?.whip ?? null
  };
}

function normalizeLineupSlot(player, fallbackOrder) {
  if (!player) {
    return {
      order: fallbackOrder,
      name: "Lineup TBD",
      pos: "TBD"
    };
  }

  return {
    order: player?.order ?? player?.battingOrder ?? fallbackOrder,
    playerId: player?.id ?? player?.playerId ?? player?.person?.id ?? null,
    name: player?.fullName || player?.name || player?.person?.fullName || "Lineup TBD",
    pos: player?.position?.abbreviation || player?.primaryPosition?.abbreviation || player?.pos || "TBD"
  };
}

function extractScheduleLineupPlayers(rawGame, side) {
  const lineups = rawGame?.lineups || rawGame?.lineup || null;
  if (!lineups) return [];
  const direct = lineups?.[`${side}Players`]
    || lineups?.[side]?.players
    || rawGame?.teams?.[side]?.lineup
    || [];
  return Array.isArray(direct) ? direct.map((player, index) => normalizeLineupSlot(player, index + 1)) : [];
}

async function buildUpcomingGameSnapshot(rawGame) {
  if (!rawGame) return null;
  const homeIdentity = normalizeTeamIdentity(rawGame?.teams?.home?.team || {}, null);
  const awayIdentity = normalizeTeamIdentity(rawGame?.teams?.away?.team || {}, null);
  const isMetsHome = Number(homeIdentity.mlbStatsTeamId ?? rawGame?.teams?.home?.team?.id) === DEFAULT_MLB_STATS_TEAM_ID;
  const [metsProbable, oppProbable] = await Promise.all([
    buildProbablePitcherPreview(isMetsHome ? rawGame?.teams?.home?.probablePitcher : rawGame?.teams?.away?.probablePitcher),
    buildProbablePitcherPreview(isMetsHome ? rawGame?.teams?.away?.probablePitcher : rawGame?.teams?.home?.probablePitcher)
  ]);

  return {
    gameId: rawGame?.gamePk || null,
    leagueId: 1,
    season: getCurrentSeason(),
    date: rawGame?.gameDate || null,
    status: {
      short: String(rawGame?.status?.codedGameState || "S"),
      long: rawGame?.status?.detailedState || rawGame?.status?.abstractGameState || "Scheduled",
      inning: null,
      isLive: false,
      isFinal: false
    },
    home: {
      id: homeIdentity.mlbStatsTeamId ?? rawGame?.teams?.home?.team?.id ?? null,
      canonicalKey: homeIdentity.canonicalKey,
      mlbStatsTeamId: homeIdentity.mlbStatsTeamId ?? rawGame?.teams?.home?.team?.id ?? null,
      apiSportsTeamId: homeIdentity.apiSportsTeamId,
      name: homeIdentity.name || rawGame?.teams?.home?.team?.name || null,
      abbreviation: homeIdentity.abbreviation || rawGame?.teams?.home?.team?.abbreviation || null,
      record: null
    },
    away: {
      id: awayIdentity.mlbStatsTeamId ?? rawGame?.teams?.away?.team?.id ?? null,
      canonicalKey: awayIdentity.canonicalKey,
      mlbStatsTeamId: awayIdentity.mlbStatsTeamId ?? rawGame?.teams?.away?.team?.id ?? null,
      apiSportsTeamId: awayIdentity.apiSportsTeamId,
      name: awayIdentity.name || rawGame?.teams?.away?.team?.name || null,
      abbreviation: awayIdentity.abbreviation || rawGame?.teams?.away?.team?.abbreviation || null,
      record: null
    },
    venue: rawGame?.venue?.name || null,
    probablePitchers: {
      mets: metsProbable,
      opp: oppProbable
    },
    lineups: {
      lineupStatus: extractScheduleLineupPlayers(rawGame, "home").length || extractScheduleLineupPlayers(rawGame, "away").length
        ? "confirmed"
        : "not_released",
      mets: isMetsHome ? extractScheduleLineupPlayers(rawGame, "home") : extractScheduleLineupPlayers(rawGame, "away"),
      opp: isMetsHome ? extractScheduleLineupPlayers(rawGame, "away") : extractScheduleLineupPlayers(rawGame, "home")
    },
    raw: rawGame
  };
}

async function fetchMlbStatsUpcomingGame() {
  const today = getEasternDateISO();
  const endDateIso = addDaysToDateISO(today, 7);
  const payload = await fetchJsonWithRetry(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${DEFAULT_MLB_STATS_TEAM_ID}&startDate=${today}&endDate=${endDateIso}&hydrate=team,venue,linescore,probablePitcher,lineups,seriesStatus`
  );
  const games = (payload?.dates || [])
    .flatMap((dateEntry) => dateEntry.games || [])
    .filter((game) => isFutureStartTime(game?.gameDate))
    .sort((a, b) => new Date(a.gameDate || 0) - new Date(b.gameDate || 0));
  return buildUpcomingGameSnapshot(games[0] || null);
}

function mergeUpcomingGameDetails(primaryGame, fallbackGame) {
  if (!primaryGame) return fallbackGame || null;
  if (!fallbackGame) return primaryGame;

  const sameMatchup =
    String(primaryGame?.home?.mlbStatsTeamId || primaryGame?.home?.id || "") === String(fallbackGame?.home?.mlbStatsTeamId || fallbackGame?.home?.id || "")
    && String(primaryGame?.away?.mlbStatsTeamId || primaryGame?.away?.id || "") === String(fallbackGame?.away?.mlbStatsTeamId || fallbackGame?.away?.id || "")
    && String(primaryGame?.date || "").slice(0, 10) === String(fallbackGame?.date || "").slice(0, 10);

  if (!sameMatchup) return fallbackGame;

  return {
    ...primaryGame,
    probablePitchers: fallbackGame.probablePitchers || primaryGame.probablePitchers || null,
    lineups: fallbackGame.lineups || primaryGame.lineups || null,
    raw: fallbackGame.raw || primaryGame.raw
  };
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
          description: outcome?.description || null,
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

async function fetchTheOddsApiEvent(nextGame, options = {}) {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return null;

  const path = options.path || "/sports/baseball_mlb/odds";
  const params = {
    apiKey,
    regions: "us",
    oddsFormat: "american",
    dateFormat: "iso",
    ...options.params
  };
  const url = buildUrl(`${ODDS_API_BASE_URL}${path}`, params);
  const payload = await fetchJsonWithRetry(url);
  const events = Array.isArray(payload) ? payload : payload ? [payload] : [];

  if (events.length === 0) return null;

  if (nextGame) {
    const scored = events
      .map((event) => ({ event, score: scoreOddsEventMatch(event, nextGame) }))
      .filter((entry) => entry.score >= 3)
      .sort((a, b) => b.score - a.score);
    if (scored[0]) return scored[0].event;
  }

  return events.find((event) => (
    /new york mets|^mets$/i.test(event?.home_team || "")
    || /new york mets|^mets$/i.test(event?.away_team || "")
  )) || events[0] || null;
}

async function fetchStandingsWithFallback(config = getApiSportsConfig()) {
  const season = getCurrentSeason();
  try {
    const primary = await fetchMlbStatsStandings(season);
    if (Array.isArray(primary?.teams) && primary.teams.length > 0) {
      console.log(`[standings] MLB Stats API standings loaded for season ${season} (${primary.teams.length} teams)`);
      return {
        ...primary,
        sourceProvider: "mlb-stats-api"
      };
    }
    console.warn(`[standings] MLB Stats API returned no teams for season ${season}`);
  } catch (error) {
    console.warn(`[warn] MLB Stats standings primary fetch failed: ${error?.message || error}`);
  }

  try {
    const result = await fetchApiSportsStandings(config, season);
    if (Array.isArray(result?.teams) && result.teams.length > 0) {
      console.log(`[standings] API-Sports fallback standings loaded for season ${season} (${result.teams.length} teams)`);
      return {
        ...result,
        sourceProvider: "api-sports"
      };
    }
  } catch (error) {
    console.warn(`[warn] API-Sports standings fetch failed: ${error?.message || error}`);
  }
  console.warn(`[warn] Standings unavailable for current season ${season}`);
  return null;
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
  const featuredState = resolveFeaturedGameState(games, {
    referenceDate: getEasternDateISO(),
    lookaheadDays: 7
  });
  const liveGame = games.find(isLiveStatus) || null;
  const mlbStatsUpcomingGame = await fetchMlbStatsUpcomingGame().catch(() => null);
  const nextGame = mergeUpcomingGameDetails(
    featuredState.todayGame || featuredState.nextUpcomingGame || games.filter(isUpcomingStatus)[0] || null,
    mlbStatsUpcomingGame
  ) || mlbStatsUpcomingGame || null;
  const recentGamesRaw = sortByDateDesc(games.filter(isFinalStatus)).slice(0, 10);

  return {
    config,
    season,
    games,
    featuredState,
    liveGame,
    nextGame,
    recentGamesRaw
  };
}

async function buildNextGamePayload() {
  const bundle = await getGamesBundle();
  const referenceDate = getEasternDateISO();
  const odds = await fetchApiSportsOdds(bundle.liveGame?.gameId || bundle.nextGame?.gameId || null, bundle.config, bundle.season);
  return {
    ...normalizeNextGame(bundle.nextGame, bundle.config.metsTeamId, odds),
    meta: {
      provider: "api-sports",
      generatedAt: new Date().toISOString(),
      cacheHint: "schedule: 15-30 minutes",
      referenceDate,
      cacheKey: buildDateScopedCacheKey("next-game", referenceDate)
    }
  };
}

async function buildLiveGamePayload() {
  const bundle = await getGamesBundle();
  const referenceDate = getEasternDateISO();
  return {
    ...normalizeLiveGame(bundle.liveGame),
    meta: {
      provider: "api-sports",
      generatedAt: new Date().toISOString(),
      cacheHint: bundle.liveGame ? "live: 15-30 seconds" : "schedule: 15-30 minutes",
      referenceDate,
      cacheKey: buildDateScopedCacheKey("live-game", referenceDate)
    }
  };
}

async function buildStandingsPayload() {
  const standings = await fetchStandingsWithFallback();
  const provider = standings?.sourceProvider || "api-sports";
  return {
    ...(standings || { division: "NL East", season: null, teams: [] }),
    meta: {
      provider,
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
  var bundle;
  try {
    bundle = await getGamesBundle();
  } catch (error) {
    console.warn(`[warn] Odds bundle fallback using MLB Stats only: ${error?.message || error}`);
    bundle = {
      config: getApiSportsConfig(),
      season: getCurrentSeason(),
      liveGame: null,
      nextGame: await fetchMlbStatsUpcomingGame().catch(() => null)
    };
  }
  const targetGame = bundle.liveGame || bundle.nextGame || null;
  let odds = null;
  let props = null;
  let provider = "api-sports";

  try {
    // Explicitly request the sportsbooks we display — some API tiers require this
    const TRACKED_BOOK_KEYS = "draftkings,fanduel,betmgm,caesars,williamhill_us,fanatics";
    const oddsEvent = await fetchTheOddsApiEvent(targetGame, {
      params: {
        markets: "h2h,spreads,totals",
        bookmakers: TRACKED_BOOK_KEYS
      }
    });

    if (oddsEvent) {
      odds = normalizeTheOddsApiEvent(oddsEvent);
      provider = "the-odds-api";

      if (oddsEvent.id) {
        const propsEvent = await fetchTheOddsApiEvent(targetGame, {
          path: `/sports/baseball_mlb/events/${oddsEvent.id}/odds`,
          params: {
            markets: "player_strikeouts,player_home_runs"
          }
        }).catch(() => null);

        if (propsEvent) {
          props = normalizeTheOddsApiEvent(propsEvent);
        }
      }
    }
  } catch (error) {
    console.warn(`[warn] The Odds API odds fetch failed: ${error?.message || error}`);
  }

  if (!odds) {
    odds = await fetchApiSportsOdds(bundle.liveGame?.gameId || bundle.nextGame?.gameId || null, bundle.config, bundle.season);
  }

  const trackedSportsbooks = ["Fanatics", "DraftKings", "FanDuel", "BetMGM", "Caesars"];
  const availableSportsbooks = Array.isArray(odds?.bookmakers)
    ? odds.bookmakers.map((bookmaker) => bookmaker?.title).filter(Boolean)
    : [];

  return {
    ...odds,
    props,
    context: targetGame ? normalizeNextGame(targetGame, bundle.config.metsTeamId, odds) : null,
    diagnostics: {
      mainEndpoint: "/v4/sports/baseball_mlb/odds",
      mainMarkets: ["h2h", "spreads", "totals"],
      propsEndpoint: odds?.gameId ? `/v4/sports/baseball_mlb/events/${odds.gameId}/odds` : null,
      propsMarkets: ["player_strikeouts", "player_home_runs"],
      availableSportsbooks,
      missingTrackedSportsbooks: trackedSportsbooks.filter((name) => !availableSportsbooks.includes(name))
    },
    meta: {
      provider,
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
