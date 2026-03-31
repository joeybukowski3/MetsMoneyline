const { normalizeTeamIdentity } = require("../../lib/mlb-team-identity");

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function normalizeDateTime(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeTeam(rawTeam = {}, fallback = {}) {
  const apiSportsTeamId = firstDefined(rawTeam.id, rawTeam.team_id, fallback.id, null);
  const name = firstDefined(rawTeam.name, rawTeam.team?.name, fallback.name, "Unknown Team");
  const abbreviation = firstDefined(rawTeam.code, rawTeam.abbreviation, rawTeam.team?.code, null);
  const identity = normalizeTeamIdentity({ name, abbreviation }, apiSportsTeamId);
  return {
    id: identity.mlbStatsTeamId ?? apiSportsTeamId,
    canonicalKey: identity.canonicalKey,
    mlbStatsTeamId: identity.mlbStatsTeamId,
    apiSportsTeamId: identity.apiSportsTeamId,
    name,
    abbreviation: identity.abbreviation || abbreviation,
    logo: firstDefined(rawTeam.logo, rawTeam.team?.logo, null),
    record: fallback.record || null
  };
}

function normalizeGameStatus(rawStatus = {}) {
  const short = String(firstDefined(rawStatus.short, rawStatus.code, rawStatus.state, "")).toUpperCase();
  const long = firstDefined(rawStatus.long, rawStatus.description, rawStatus.detail, rawStatus.state, "Scheduled");
  const inning = firstDefined(rawStatus.inning, rawStatus.period, null);

  const isLive = ["LIVE", "IN", "1", "2", "3", "4", "5", "6", "7", "8", "9", "ET", "P"].includes(short) || /live|progress/i.test(long);
  const isFinal = ["FT", "FINAL", "AOT", "POST"].includes(short) || /final|completed/i.test(long);

  return {
    short,
    long,
    inning,
    isLive,
    isFinal
  };
}

function extractApiSportsGames(payload) {
  return toArray(payload?.response).map((entry) => {
    const game = entry?.game || entry?.fixture || entry || {};
    const teams = entry?.teams || game?.teams || {};
    const scores = entry?.scores || game?.scores || {};
    const status = normalizeGameStatus(entry?.status || game?.status || {});

    const home = normalizeTeam(teams.home || {}, {
      record: firstDefined(teams.home?.record, null)
    });
    const away = normalizeTeam(teams.away || {}, {
      record: firstDefined(teams.away?.record, null)
    });

    return {
      gameId: firstDefined(game.id, game.game_id, entry?.id, null),
      leagueId: firstDefined(entry?.league?.id, game?.league?.id, null),
      season: firstDefined(entry?.league?.season, game?.season, null),
      date: normalizeDateTime(firstDefined(game.date, game.datetime, entry?.date)),
      status,
      home,
      away,
      venue: firstDefined(game.venue?.name, entry?.venue?.name, null),
      country: firstDefined(entry?.country?.name, null),
      scores: {
        home: firstDefined(scores.home?.total, scores.home, null),
        away: firstDefined(scores.away?.total, scores.away, null)
      },
      raw: entry
    };
  }).filter((game) => game.gameId || game.date);
}

function normalizeStandings(payload, metsTeamId) {
  const rows = toArray(payload?.response).flatMap((entry) => {
    const table = toArray(entry?.standings || entry?.table || entry?.groups);
    if (table.length) {
      return table.map((teamRow) => ({ row: teamRow, division: entry?.group?.name || entry?.division?.name || entry?.league?.name || "Standings" }));
    }
    return [{ row: entry, division: entry?.group?.name || entry?.division?.name || entry?.league?.name || "Standings" }];
  });

  const teams = rows.map(({ row, division }) => ({
    ...(function buildIdentity() {
      const apiSportsTeamId = firstDefined(row?.team?.id, row?.id, null);
      const name = firstDefined(row?.team?.name, row?.name, "Unknown Team");
      const abbreviation = firstDefined(row?.team?.code, row?.team?.abbreviation, row?.code, null);
      const identity = normalizeTeamIdentity({ name, abbreviation }, apiSportsTeamId);
      return {
        teamId: identity.mlbStatsTeamId ?? apiSportsTeamId,
        canonicalKey: identity.canonicalKey,
        mlbStatsTeamId: identity.mlbStatsTeamId,
        apiSportsTeamId: identity.apiSportsTeamId,
        team: identity.name || name,
        abbreviation: identity.abbreviation || abbreviation
      };
    })(),
    wins: firstDefined(row?.games?.win?.total, row?.wins, 0),
    losses: firstDefined(row?.games?.lose?.total, row?.losses, 0),
    pct: firstDefined(row?.win?.percentage, row?.pct, null),
    gamesBack: firstDefined(row?.gamesBack, row?.gb, "-"),
    home: row?.home ? `${firstDefined(row.home.win, 0)}-${firstDefined(row.home.lose, 0)}` : null,
    road: row?.away ? `${firstDefined(row.away.win, 0)}-${firstDefined(row.away.lose, 0)}` : null,
    last10: row?.last10 ? `${firstDefined(row.last10.win, 0)}-${firstDefined(row.last10.lose, 0)}` : null,
    streak: firstDefined(row?.streak, row?.form, null),
    division
  }));

  const metsIdentity = normalizeTeamIdentity({ mlbStatsTeamId: 121, apiSportsTeamId: metsTeamId, name: "New York Mets", abbreviation: "NYM" }, metsTeamId);
  const mets = teams.find((team) =>
    String(team.teamId) === String(metsIdentity.mlbStatsTeamId) ||
    String(team.apiSportsTeamId) === String(metsIdentity.apiSportsTeamId)
  ) || null;

  return {
    division: mets?.division || "NL East",
    season: firstDefined(payload?.parameters?.season, null),
    teams
  };
}

function normalizeOdds(payload, targetGameId) {
  const entries = toArray(payload?.response);
  const event = entries.find((entry) => String(firstDefined(entry?.game?.id, entry?.id, "")) === String(targetGameId)) || entries[0] || null;
  if (!event) {
    return {
      gameId: targetGameId || null,
      markets: [],
      bookmakers: [],
      consensus: null,
      raw: null
    };
  }

  const bookmakers = toArray(event?.bookmakers).map((bookmaker) => ({
    key: firstDefined(bookmaker?.id, bookmaker?.key, bookmaker?.name, null),
    title: firstDefined(bookmaker?.name, bookmaker?.title, "Bookmaker"),
    markets: toArray(bookmaker?.bets || bookmaker?.markets).map((market) => ({
      key: firstDefined(market?.id, market?.name, market?.label, null),
      label: firstDefined(market?.name, market?.label, "Market"),
      outcomes: toArray(market?.values || market?.outcomes).map((outcome) => ({
        name: firstDefined(outcome?.value, outcome?.name, null),
        price: firstDefined(outcome?.odd, outcome?.price, null),
        point: firstDefined(outcome?.handicap, outcome?.point, null)
      }))
    }))
  }));

  return {
    gameId: firstDefined(event?.game?.id, event?.id, targetGameId, null),
    markets: bookmakers[0]?.markets || [],
    bookmakers,
    consensus: bookmakers[0] || null,
    raw: event
  };
}

function normalizeLiveGame(game) {
  if (!game) {
    return {
      gameId: null,
      inning: null,
      status: "No live Mets game",
      homeScore: null,
      awayScore: null,
      outs: null,
      bases: null,
      lastUpdated: new Date().toISOString(),
      raw: null
    };
  }

  return {
    gameId: game.gameId,
    inning: game.status?.inning || null,
    status: game.status?.long || "Scheduled",
    homeScore: game.scores?.home ?? null,
    awayScore: game.scores?.away ?? null,
    outs: null,
    bases: null,
    lastUpdated: new Date().toISOString(),
    raw: game.raw
  };
}

function normalizeNextGame(game, metsTeamId, odds = null) {
  const metsIdentity = normalizeTeamIdentity({ mlbStatsTeamId: 121, apiSportsTeamId: metsTeamId, name: "New York Mets", abbreviation: "NYM" }, metsTeamId);
  if (!game) {
    return {
      gameId: null,
      startTime: null,
      status: "No upcoming Mets game",
      homeTeam: null,
      awayTeam: null,
      isMetsHome: null,
      venue: null,
      league: null,
      sportsbookSummary: null,
      raw: null
    };
  }

  return {
    gameId: game.gameId,
    startTime: game.date,
    status: game.status?.long || "Scheduled",
    homeTeam: game.home,
    awayTeam: game.away,
    isMetsHome:
      String(game.home?.id) === String(metsIdentity.mlbStatsTeamId) ||
      String(game.home?.apiSportsTeamId) === String(metsIdentity.apiSportsTeamId),
    venue: game.venue,
    league: game.leagueId,
    sportsbookSummary: odds?.consensus || null,
    raw: game.raw
  };
}

function normalizeRecentGames(games, metsTeamId) {
  const metsIdentity = normalizeTeamIdentity({ mlbStatsTeamId: 121, apiSportsTeamId: metsTeamId, name: "New York Mets", abbreviation: "NYM" }, metsTeamId);
  return games.map((game) => {
    const isMetsHome =
      String(game.home?.id) === String(metsIdentity.mlbStatsTeamId) ||
      String(game.home?.apiSportsTeamId) === String(metsIdentity.apiSportsTeamId);
    const metsScore = isMetsHome ? game.scores?.home : game.scores?.away;
    const oppScore = isMetsHome ? game.scores?.away : game.scores?.home;
    const opponent = isMetsHome ? game.away : game.home;
    return {
      gameId: game.gameId,
      date: game.date,
      opponent,
      isMetsHome,
      status: game.status?.long || "Final",
      metsScore,
      oppScore,
      result: metsScore == null || oppScore == null ? null : (metsScore > oppScore ? "W" : metsScore < oppScore ? "L" : "T"),
      raw: game.raw
    };
  });
}

module.exports = {
  extractApiSportsGames,
  normalizeLiveGame,
  normalizeNextGame,
  normalizeOdds,
  normalizeRecentGames,
  normalizeStandings
};
