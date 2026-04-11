import { getTeamAbbr, getTeamLogoUrl } from "./team-logo-helper.js";

const METS_TEAM_ID = 121;
const EASTERN_TIME_ZONE = "America/New_York";

function getTodayISO() {
  return new Date().toISOString().slice(0, 10);
}

function getTodayET() {
  return new Date().toLocaleDateString("en-CA", { timeZone: EASTERN_TIME_ZONE });
}

function formatGameTimeET(dateTime) {
  if (!dateTime) return "TBD";
  return new Date(dateTime).toLocaleTimeString("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit"
  });
}

function createFallbackPitching(probables = {}) {
  return {
    mets: {
      name: probables.mets?.fullName || "TBD",
      mlbId: probables.mets?.id ?? null,
      announced: Boolean(probables.mets)
    },
    opp: {
      name: probables.opp?.fullName || "TBD",
      mlbId: probables.opp?.id ?? null,
      announced: Boolean(probables.opp)
    },
    metsBullpen: {},
    oppBullpen: {}
  };
}

function isValidRecordString(value) {
  return /^\d+-\d+$/.test(String(value || "").trim());
}

function getMetsRecord(game) {
  if (isValidRecordString(game?.metsRecord)) return game.metsRecord;
  const last10 = game?.trends?.find(t => t.category === "Last 10 Games");
  if (isValidRecordString(last10?.mets)) return last10.mets;
  return "0-0";
}

function getOppRecord(game) {
  if (isValidRecordString(game?.oppRecord)) return game.oppRecord;
  const last10 = game?.trends?.find(t => t.category === "Last 10 Games");
  if (isValidRecordString(last10?.opp)) return last10.opp;
  return "0-0";
}

function getPitcherRecordBadge(pitcher) {
  if (isValidRecordString(pitcher?.seasonRecord)) return pitcher.seasonRecord;
  const linePrefix = String(pitcher?.seasonLine || "").split(",")[0].trim();
  return isValidRecordString(linePrefix) ? linePrefix : null;
}

function mergeLiveGame(staticGame, liveGame) {
  if (!liveGame) return staticGame;
  if (!staticGame) return liveGame;

  const sameMatchup =
    staticGame.date === liveGame.date &&
    staticGame.opponent === liveGame.opponent &&
    staticGame.homeAway === liveGame.homeAway;

  if (!sameMatchup) return liveGame;

  const hasMeaningfulValue = (value) => {
    if (value == null) return false;
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      return Boolean(normalized && normalized !== "tbd" && normalized !== "n/a" && normalized !== "not_released");
    }
    if (Array.isArray(value)) return value.some(hasMeaningfulValue);
    if (typeof value === "object") return Object.values(value).some(hasMeaningfulValue);
    return false;
  };

  const pickPreferred = (primary, fallback) => (hasMeaningfulValue(primary) ? primary : fallback);

  const mergeMoneyline = (liveMoneyline, staticMoneyline) => {
    if (!liveMoneyline && !staticMoneyline) return null;
    return {
      ...(staticMoneyline || {}),
      ...(liveMoneyline || {}),
      mets: hasMeaningfulValue(liveMoneyline?.mets) ? liveMoneyline.mets : staticMoneyline?.mets ?? null,
      opp: hasMeaningfulValue(liveMoneyline?.opp) ? liveMoneyline.opp : staticMoneyline?.opp ?? null
    };
  };

  return {
    ...staticGame,
    ...liveGame,
    moneyline: mergeMoneyline(liveGame.moneyline, staticGame.moneyline),
    // Prefer live data for core game state so Todays Report always reflects the latest intel
    lineups: pickPreferred(liveGame.lineups, staticGame.lineups),
    pitching: pickPreferred(liveGame.pitching, staticGame.pitching),
    advancedMatchup: pickPreferred(liveGame.advancedMatchup, staticGame.advancedMatchup),
    teamAdvanced: pickPreferred(liveGame.teamAdvanced, staticGame.teamAdvanced),
    gameContext: pickPreferred(liveGame.gameContext, staticGame.gameContext),
    // Keep trends and weather favoring live when available
    trends: pickPreferred(liveGame.trends, staticGame.trends),
    weather: pickPreferred(liveGame.weather, staticGame.weather),
    // If we ever generate a live writeup, let it win; otherwise fall back to static
    writeup: pickPreferred(liveGame.writeup, staticGame.writeup)
  };
}

async function fetchInternalJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Internal endpoint failed: ${path} (${res.status})`);
  return res.json();
}

function buildRecentLogRows(recentGames = []) {
  return recentGames.slice(0, 5).map((game) => ({
    date: String(game.date || "").slice(0, 10),
    opponent: game.opponent?.name || "Opponent",
    homeAway: game.isMetsHome ? "home" : "road",
    result: game.result,
    score: `${game.metsScore ?? "-"}-${game.oppScore ?? "-"}`
  }));
}

function mapOddsSummaryToMoneyline(odds, game) {
  const consensus = odds?.consensus || {};
  const markets = Array.isArray(consensus.markets) ? consensus.markets : Array.isArray(odds?.markets) ? odds.markets : [];
  const moneylineMarket = markets.find((market) => /moneyline|h2h/i.test(market.label || market.key || ""));
  if (!moneylineMarket) return { mets: null, opp: null };

  const opponentName = game.opponent;
  const getPrice = (teamName) => {
    const outcome = Array.isArray(moneylineMarket.outcomes)
      ? moneylineMarket.outcomes.find((entry) => String(entry.name || "").toLowerCase().includes(String(teamName).toLowerCase()))
      : null;
    return typeof outcome?.price === "number" ? outcome.price : null;
  };

  return {
    mets: getPrice("Mets"),
    opp: getPrice(opponentName)
  };
}

function mapInternalGameToSiteGame(endpointGame, standings, recentGames, odds) {
  if (!endpointGame?.gameId || !endpointGame?.homeTeam || !endpointGame?.awayTeam) return null;

  const isHome = Boolean(endpointGame.isMetsHome);
  const opponentTeam = isHome ? endpointGame.awayTeam : endpointGame.homeTeam;
  const standingsTeams = Array.isArray(standings?.teams) ? standings.teams : [];
  const metsStanding = standingsTeams.find((team) => String(team.teamId) === String(METS_TEAM_ID)) || null;
  const opponentTeamId = opponentTeam?.mlbStatsTeamId ?? opponentTeam?.id ?? null;
  const oppStanding = standingsTeams.find((team) => String(team.teamId) === String(opponentTeamId)) || null;
  const recent = Array.isArray(recentGames?.games) ? recentGames.games : [];
  const mapped = {
    id: String(endpointGame.gameId),
    date: String(endpointGame.startTime || "").slice(0, 10),
    time: formatGameTimeET(endpointGame.startTime),
    ballpark: endpointGame.venue || "Venue TBD",
    opponent: opponentTeam?.name || "Opponent TBD",
    oppTeamId: opponentTeamId,
    oppCanonicalKey: opponentTeam?.canonicalKey || null,
    homeAway: isHome ? "home" : "road",
    metsRecord: metsStanding ? `${metsStanding.wins}-${metsStanding.losses}` : "0-0",
    oppRecord: oppStanding ? `${oppStanding.wins}-${oppStanding.losses}` : "0-0",
    moneyline: mapOddsSummaryToMoneyline(odds, { opponent: opponentTeam?.name || "" }),
    runLine: null,
    total: null,
    overUnder: null,
    status: /final|completed/i.test(endpointGame.status || "") ? "final" : /live|in progress/i.test(endpointGame.status || "") ? "live" : "upcoming",
    finalScore: endpointGame.homeScore != null && endpointGame.awayScore != null ? `${isHome ? endpointGame.homeScore : endpointGame.awayScore}-${isHome ? endpointGame.awayScore : endpointGame.homeScore}` : null,
    result: endpointGame.homeScore != null && endpointGame.awayScore != null
      ? ((isHome ? endpointGame.homeScore : endpointGame.awayScore) > (isHome ? endpointGame.awayScore : endpointGame.homeScore) ? "W" : "L")
      : null,
    lineups: { lineupStatus: "not_released", mets: [], opp: [] },
    pitching: createFallbackPitching({}),
    advancedMatchup: [],
    teamAdvanced: null,
    gameContext: {
      metsRecentGames: buildRecentLogRows(recent),
      oppRecentGames: [],
      metsInjuries: [],
      oppInjuries: [],
      headToHead: { wins: 0, losses: 0 },
      metsPitcherLog: [],
      oppPitcherLog: []
    },
    trends: [
      {
        category: "Last 10 Games",
        mets: metsStanding?.last10 || "0-0",
        opp: oppStanding?.last10 || "0-0",
        edge: "Neutral"
      },
      {
        category: "Home/Road",
        mets: `${isHome ? "Home" : "Road"} ${isHome ? (metsStanding?.home || "0-0") : (metsStanding?.road || "0-0")}`,
        opp: `${isHome ? "Road" : "Home"} ${isHome ? (oppStanding?.road || "0-0") : (oppStanding?.home || "0-0")}`,
        edge: "Neutral"
      }
    ],
    weather: null,
    writeup: null
  };

  if (endpointGame.homeTeam?.record && !isValidRecordString(mapped.oppRecord) && !isHome) {
    mapped.oppRecord = endpointGame.homeTeam.record;
  }
  if (endpointGame.awayTeam?.record && !isValidRecordString(mapped.oppRecord) && isHome) {
    mapped.oppRecord = endpointGame.awayTeam.record;
  }
  if (endpointGame.homeTeam?.record && !isValidRecordString(mapped.metsRecord) && isHome) {
    mapped.metsRecord = endpointGame.homeTeam.record;
  }
  if (endpointGame.awayTeam?.record && !isValidRecordString(mapped.metsRecord) && !isHome) {
    mapped.metsRecord = endpointGame.awayTeam.record;
  }

  return mapped;
}

async function loadGameData() {
  const [data, nextGame, liveGame, standings, recentGames, odds] = await Promise.all([
    fetchInternalJson("data/sample-game.json").catch(() => ({ games: [], recentBreakdowns: [], generatedAt: null })),
    fetchInternalJson("api/mlb/mets/next-game").catch(() => null),
    fetchInternalJson("api/mlb/mets/live-game").catch(() => null),
    fetchInternalJson("api/mlb/mets/standings").catch(() => null),
    fetchInternalJson("api/mlb/mets/recent-games").catch(() => null),
    fetchInternalJson("api/mlb/mets/odds").catch(() => null)
  ]);

  try {
    const endpointGame = liveGame?.gameId ? liveGame : nextGame;
    const normalizedGame = mapInternalGameToSiteGame(endpointGame, standings, recentGames, odds);
    const games = Array.isArray(data?.games) ? [...data.games] : [];

    if (normalizedGame) {
      const liveIndex = games.findIndex(game =>
        game?.date === normalizedGame.date &&
        game?.opponent === normalizedGame.opponent &&
        game?.homeAway === normalizedGame.homeAway
      );

      if (liveIndex >= 0) {
        games[liveIndex] = mergeLiveGame(games[liveIndex], normalizedGame);
      } else {
        games.unshift(normalizedGame);
      }
    }
    data.games = games;
    if (endpointGame?.meta?.generatedAt || standings?.meta?.generatedAt) {
      data.generatedAt = endpointGame?.meta?.generatedAt || standings?.meta?.generatedAt || new Date().toISOString();
    }
  } catch (err) {
    console.warn("Unable to refresh internal Mets data endpoints.", err);
  }

  return data;
}

  const TEAM_STORYLINES = {
  "New York Mets": {
    note: "New York is trying to turn its high-end talent into steadier early-season form."
  },
  "Toronto Blue Jays": {
    note: "Toronto is still trying to settle a reshaped lineup and get more consistency from its veteran core heading into this matchup."
  }
};

function formatOrdinal(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n}st`;
  if (mod10 === 2 && mod100 !== 12) return `${n}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${n}rd`;
  return `${n}th`;
}

function getTeamLocationName(teamName) {
  if (!teamName) return "The opponent";
  return teamName.replace(/^(The\s+)/i, "").replace(/\s+(Mets|Nationals|Yankees|Phillies|Braves|Marlins|Brewers|Pirates|Reds|Cubs|Cardinals|Dodgers|Padres|Giants|Diamondbacks|Rockies|Angels|Astros|Rangers|Mariners|Athletics|Guardians|Tigers|Royals|Twins|White Sox|Red Sox|Blue Jays|Orioles|Rays)$/i, "").trim() || teamName;
}

function describeStreakClause(games, teamLabel) {
  if (!games?.length) return `${teamLabel} have not established a meaningful streak yet`;
  const latest = games[0]?.result;
  if (!latest || !["W", "L"].includes(latest)) return `${teamLabel} are still settling into the season`;
  let count = 0;
  for (const game of games) {
    if (game.result !== latest) break;
    count += 1;
  }
  const streakType = latest === "W" ? "winning" : "losing";
  return `${teamLabel} enter on a ${count}-game ${streakType} streak`;
}

function getTeamStoryline(teamName) {
  return TEAM_STORYLINES[teamName]?.note || `${teamName} are still looking for steadier production from their current core as the season settles in.`;
}

function summarizeLastGame(game) {
  const lastGame = game.gameContext?.metsRecentGames?.[0];
  if (!lastGame) return "The Mets are still building their first full run of form for 2026.";
  const venueText = lastGame.homeAway === "home" ? "at Citi Field" : `on the road against ${lastGame.opponent}`;
  const resultText = lastGame.result === "W" ? "won" : "lost";
  return `In the last game, the Mets ${resultText} ${lastGame.score} ${venueText} against ${lastGame.opponent}, so this matchup picks up directly from that result rather than starting from scratch.`;
}

function buildGameBreakdown(game) {
  const gc = game.gameContext || {};
  const oppAbbr = getTeamAbbr(game.opponent);
  const lastMeeting = gc.lastMeeting || null;
  const h2hWins = gc.headToHead?.wins ?? 0;
  const h2hLosses = gc.headToHead?.losses ?? 0;
  const priorMeetings = h2hWins + h2hLosses;
  const recentSource = game.editorial?.recentSources?.[0] || null;
  const isToday = game.date === getTodayET();

  const lines = [];

  if (lastMeeting) {
    const resultWord = lastMeeting.result === "win" ? "won" : "lost";
    lines.push(`Last meeting: the Mets ${resultWord} ${lastMeeting.metsScore}-${lastMeeting.oppScore} over ${oppAbbr} on ${lastMeeting.date}.`);
  } else {
    lines.push(`Matchup set: New York ${game.homeAway === "road" ? "travels to face" : "hosts"} ${game.opponent}${game.ballpark ? ` at ${game.ballpark}` : ""}.`);
  }

  lines.push(`Record check: New York is ${getMetsRecord(game)}. ${oppAbbr} is ${getOppRecord(game)}.`);

  if (priorMeetings === 0) {
    lines.push("Season series: first meeting.");
  } else {
    lines.push(`Season series: Mets lead ${h2hWins}-${h2hLosses} entering game ${priorMeetings + 1}.`);
  }

  if (game.pitching?.mets?.name || game.pitching?.opp?.name) {
    lines.push(`Probable starters: ${game.pitching?.mets?.name || "TBD"} vs ${game.pitching?.opp?.name || "TBD"}.`);
  }

  if (recentSource?.headline) {
    lines.push(`Source note: ${recentSource.headline}.`);
  } else if (!game.writeup) {
    lines.push(isToday
      ? "Full written analysis is still catching up for today's matchup refresh."
      : "Full written analysis will appear once the next-game package is generated.");
  }

  return `
    <div class="section-floating-label">Game Breakdown</div>
    <div class="card full-card" style="padding:1.25rem">
      <div style="display:grid;gap:0.45rem;color:var(--ink);line-height:1.55">
        ${lines.map(line => `<p style="margin:0">${line}</p>`).join("")}
      </div>
    </div>`;
}

// Legacy lineup constants retained only as a last-resort UI placeholder; live views use generated 2026 lineups.
const DEFAULT_METS_LINEUP = [
  { order: 1, name: "Francisco Lindor",  pos: "SS", hand: "S", playerId: 596019 },
  { order: 2, name: "Juan Soto",         pos: "LF", hand: "L", playerId: 665742 },
  { order: 3, name: "Pete Alonso",       pos: "1B", hand: "R", playerId: 624413 },
  { order: 4, name: "Marcus Semien",     pos: "2B", hand: "R", playerId: 543760 },
  { order: 5, name: "Bo Bichette",       pos: "3B", hand: "R", playerId: 666182 },
  { order: 6, name: "Francisco Alvarez", pos: "C",  hand: "R", playerId: 682626 },
  { order: 7, name: "Mark Vientos",      pos: "DH", hand: "R", playerId: 672724 },
  { order: 8, name: "Brandon Nimmo",     pos: "CF", hand: "L", playerId: 607043 },
  { order: 9, name: "Luis Robert Jr.",   pos: "RF", hand: "R", playerId: 673357 },
];

function isMissingStat(value) {
  return value == null || value === "" || value === "N/A";
}

function getMetsPitchingStat(liveValue) {
  return isMissingStat(liveValue) ? "N/A" : liveValue;
}

function getMetsHitterSeasonOps(player) {
  return isMissingStat(player.seasonOPS) ? "N/A" : player.seasonOPS;
}

function getMetsHitterAVG(player) {
  return isMissingStat(player.seasonAVG) ? "N/A" : player.seasonAVG;
}

function resolveBullpen(bullpenObj) {
  const bp = bullpenObj || {};
  return {
    era: isMissingStat(bp.seasonERA) ? "N/A" : bp.seasonERA,
    xfip: isMissingStat(bp.seasonXFIP) ? "N/A" : bp.seasonXFIP,
    last14: isMissingStat(bp.last14ERA) ? (isMissingStat(bp.seasonERA) ? "N/A" : bp.seasonERA) : bp.last14ERA,
    kPct: isMissingStat(bp.seasonKPct) ? "N/A" : bp.seasonKPct,
    bbPct: isMissingStat(bp.seasonBBPct) ? "N/A" : bp.seasonBBPct,
    whip: isMissingStat(bp.seasonWHIP) ? "N/A" : bp.seasonWHIP,
    rating: bp.rating ?? 65
  };
}

function resolveAdvancedMatchup(game) {
  return Array.isArray(game.advancedMatchup) ? game.advancedMatchup : [];
}

function parseMetricNumber(value) {
  const num = parseFloat(String(value ?? "").replace(/<[^>]*>/g, "").replace(/%/g, "").trim());
  return Number.isFinite(num) ? num : null;
}

function metricValueClass(label, value) {
  const num = parseMetricNumber(value);
  if (num == null) return "";
  const lowerBetter = /k%|strikeout rate/i.test(label);
  const thresholds = /wrc\+/.test(label.toLowerCase())
    ? { good: 115, bad: 90 }
    : /avg|xba/i.test(label)
      ? { good: 0.26, bad: 0.235 }
      : /ops|xslg|iso|woba|xwoba/i.test(label)
        ? { good: 0.34, bad: 0.3 }
        : /bb%|walk rate/i.test(label)
          ? { good: 9, bad: 6.5 }
          : /k%|strikeout rate/i.test(label)
            ? { good: 20, bad: 25 }
            : null;
  if (!thresholds) return "";
  if (lowerBetter) {
    if (num <= thresholds.good) return "metric-positive";
    if (num >= thresholds.bad) return "metric-negative";
    return "metric-neutral";
  }
  if (num >= thresholds.good) return "metric-positive";
  if (num <= thresholds.bad) return "metric-negative";
  return "metric-neutral";
}

function computeAdvancedEdgeLabel(rows, oppAbbr) {
  let metsEdges = 0;
  let oppEdges = 0;
  for (const row of rows) {
    const m = parseMetricNumber(row.mets);
    const o = parseMetricNumber(row.opp);
    if (m == null || o == null || m === o) continue;
    const lowerBetter = /k%|strikeout rate/i.test(row.category);
    const metsWins = lowerBetter ? m < o : m > o;
    if (metsWins) metsEdges += 1;
    else oppEdges += 1;
  }
  if (metsEdges === oppEdges) return "Even";
  return metsEdges > oppEdges ? "NYM" : oppAbbr;
}

/* ── ROW 1: Matchup Bar ── */
function buildMatchupStrip(game) {
  const metsML = game.moneyline?.mets != null
    ? (game.moneyline.mets > 0 ? `+${game.moneyline.mets}` : `${game.moneyline.mets}`)
    : null;
  const oppML = game.moneyline?.opp != null
    ? (game.moneyline.opp > 0 ? `+${game.moneyline.opp}` : `${game.moneyline.opp}`)
    : null;

  const gameDate = game.date || "";
  const dateDisplay = gameDate
    ? new Date(gameDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    : "";

  const total = game.total ?? game.overUnder ?? null;
  const ouItem = total != null
    ? `<span class="mb-meta-item"><span>&#x2197;</span> O/U ${total}</span>`
    : "";

  const oppLogoUrl = getTeamLogoUrl({
    canonicalKey: game.oppCanonicalKey,
    mlbStatsTeamId: game.oppTeamId,
    name: game.opponent
  });

  const oppLogoHtml = oppLogoUrl
    ? `<img src="${oppLogoUrl}" alt="${game.opponent}">`
    : `<span style="width:36px;height:36px;display:inline-block;"></span>`;
  const metsRecord = getMetsRecord(game);
  const oppRecord = getOppRecord(game);

  return `
    <div class="matchup-bar-compact">
      <div class="mb-teams">
        <div class="mb-team">
          <img src="${getTeamLogoUrl(METS_TEAM_ID)}" alt="NYM">
          <div>
            <div class="mb-team-name">New York Mets</div>
            <span class="mb-record">${metsRecord}</span>
          </div>
        </div>
        <div class="mb-vs">
          <span class="mb-vs-label">VS</span>
          <span class="mb-vs-time">${game.time}</span>
        </div>
        <div class="mb-team">
          ${oppLogoHtml}
          <div>
            <div class="mb-team-name">${game.opponent}</div>
            <span class="mb-record">${oppRecord}</span>
          </div>
        </div>
      </div>
      <div class="mb-divider"></div>
      <div class="mb-meta">
        ${dateDisplay ? `<span class="mb-meta-item">&#x1F550; ${dateDisplay}</span>` : ""}
        <span class="mb-meta-item">&#x1F4CD; ${game.ballpark}</span>
        ${metsML != null && oppML != null ? `<span class="mb-meta-item">$ <span class="mb-ml-nym">NYM ${metsML}</span> / OPP ${oppML}</span>` : ""}
        ${ouItem}
      </div>
    </div>`;
}

const METS_PITCHER_IDS = {
  "Kodai Senga":       663853,
  "David Peterson":    656945,
  "Sean Manaea":       640455,
  "Clay Holmes":       669203,
  "Griffin Canning":   663158,
  "Jose Quintana":     542432,
  "Luis Severino":     622663,
  "Max Scherzer":      453286,
  "Tylor Megill":      676477,
  "Jose Butto":        683737
};

/* ── Percentile Engine ──
   Maps a raw stat value to an estimated 0-100 MLB percentile.
   Lower-is-better stats (ERA, WHIP, BB%) are inverted so 100 = best.
   Curves based on approximate modern MLB starter distributions. */
const PCTL = {
  // ERA: elite ~2.50 (99th), avg ~4.20 (50th), poor ~5.50 (10th)
  ERA:  v => clamp(Math.round(100 - ((parseFloat(v) - 2.50) / (5.80 - 2.50)) * 90), 5, 99),
  // FIP: elite ~2.80, avg ~4.10, poor ~5.20
  FIP:  v => clamp(Math.round(100 - ((parseFloat(v) - 2.80) / (5.40 - 2.80)) * 90), 5, 99),
  // xERA: similar to FIP
  xERA: v => clamp(Math.round(100 - ((parseFloat(v) - 2.70) / (5.30 - 2.70)) * 90), 5, 99),
  // WHIP: elite ~0.90, avg ~1.28, poor ~1.65
  WHIP: v => clamp(Math.round(100 - ((parseFloat(v) - 0.90) / (1.70 - 0.90)) * 90), 5, 99),
  // K%: elite ~33%, avg ~22%, poor ~13%
  KPct: v => clamp(Math.round(((parseFloat(v) - 10) / (36 - 10)) * 95), 5, 99),
  // BB%: elite ~4%, avg ~8%, poor ~13% - lower is better
  BBPct: v => clamp(Math.round(100 - ((parseFloat(v) - 3.5) / (13.5 - 3.5)) * 90), 5, 99),
  // K/BB: elite ~5.0, avg ~2.8, poor ~1.5
  KBB:  v => clamp(Math.round(((parseFloat(v) - 1.2) / (6.0 - 1.2)) * 95), 5, 99),
  // Hard-Hit%: lower is better for pitcher; elite ~28%, avg ~37%, poor ~45%
  HardHit: v => clamp(Math.round(100 - ((parseFloat(v) - 26) / (47 - 26)) * 90), 5, 99),
  // GB%: higher is generally better; elite ~55%, avg ~43%, poor ~33%
  GB:   v => clamp(Math.round(((parseFloat(v) - 30) / (58 - 30)) * 95), 5, 99),
  // Bullpen ERA: elite ~3.00, avg ~4.00, poor ~5.20
  BPERA: v => clamp(Math.round(100 - ((parseFloat(v) - 2.80) / (5.50 - 2.80)) * 90), 5, 99),
  // Bullpen xFIP: elite ~3.10, avg ~4.00, poor ~5.00
  BPxFIP: v => clamp(Math.round(100 - ((parseFloat(v) - 3.00) / (5.20 - 3.00)) * 90), 5, 99),
  // Rating: direct 0-100
  Rating: v => clamp(Math.round(parseFloat(v)), 0, 100),
};

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/* Color the bar: blue (poor) → gray (avg) → red (elite) */
function pctlColor(pct) {
  if (pct >= 80) return "#c0392b";   // elite red
  if (pct >= 60) return "#e08060";   // good orange-red
  if (pct >= 45) return "#aab8c8";   // avg gray
  if (pct >= 25) return "#5a9fd4";   // below avg blue
  return "#1a6bb5";                  // poor blue
}

function pctlTone(pct) {
  if (pct >= 80) return "elite";
  if (pct >= 60) return "good";
  if (pct >= 45) return "neutral";
  if (pct >= 25) return "poor";
  return "bad";
}

function formatStatcastValue(value) {
  if (value == null || value === "") return "N/A";
  return typeof value === "number" ? value.toFixed(1) : String(value);
}

function getStatcastMetricMeta(label) {
  switch (label) {
    case "xERA":
      return { pct: v => PCTL.xERA(v) };
    case "Barrel%":
      return { pct: v => PCTL.HardHit(v) };
    case "Hard-Hit%":
      return { pct: v => PCTL.HardHit(v) };
    case "Whiff%":
      return { pct: v => clamp(Math.round(((parseFloat(v) - 16) / (36 - 16)) * 95), 5, 99) };
    case "Chase%":
      return { pct: v => clamp(Math.round(((parseFloat(v) - 18) / (38 - 18)) * 95), 5, 99) };
    case "K%":
      return { pct: v => PCTL.KPct(v) };
    case "BB%":
      return { pct: v => PCTL.BBPct(v) };
    default:
      return null;
  }
}

function statcastCell(label, value) {
  if (value == null || value === "") return `<td><span class="statcast-chip statcast-chip-neutral">N/A</span></td>`;
  const meta = getStatcastMetricMeta(label);
  if (!meta) return `<td>${formatStatcastValue(value)}</td>`;
  const pct = meta.pct(parseFloat(value));
  const tone = pctlTone(pct);
  return `<td><span class="statcast-chip statcast-chip-${tone}">${formatStatcastValue(value)}</span></td>`;
}

/* Build a single stat row with percentile bar */
function statBar(label, rawVal, pctlFn, displayVal) {
  if (rawVal == null || rawVal === "N/A" || rawVal === "") {
    return `<div class="sbar-row">
      <span class="sbar-label">${label}</span>
      <div class="sbar-track"><div class="sbar-fill" style="width:0%"></div></div>
      <span class="sbar-val">N/A</span>
    </div>`;
  }
  const numStr = String(rawVal).replace(/<[^>]*>/g, "").replace("%","").trim();
  const pct    = pctlFn(numStr);
  const color  = pctlColor(pct);
  const shown  = displayVal || rawVal;
  return `<div class="sbar-row">
    <span class="sbar-label">${label}</span>
    <div class="sbar-track">
      <div class="sbar-fill" style="width:${pct}%;background:${color}">
        <span class="sbar-pct">${pct}</span>
      </div>
    </div>
    <span class="sbar-val">${shown}</span>
  </div>`;
}

/* ── ROW 2: Starting Pitching (two-column pitcher card layout) ── */
function buildPitchingCard(game) {
  if (!game.pitching?.mets || !game.pitching?.opp) return "";
  const p  = game.pitching;
  const mn = p.mets.name;

  const toNumeric = (value) => {
    if (value == null || value === "") return null;
    const parsed = parseFloat(String(value).replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  };

  const aggregateLineupSnapshot = (lineup = [], pitcherSavant = null) => {
    if (!Array.isArray(lineup) || !lineup.length) return null;
    const hitters = lineup.filter(player => player && player.name);
    if (!hitters.length) return null;

    const pa = hitters.reduce((sum, player) => sum + (toNumeric(player?.savant?.pa) || 0), 0);
    const weightedAverage = (getter) => {
      let weighted = 0;
      let weight = 0;
      hitters.forEach(player => {
        const value = toNumeric(getter(player));
        const playerPa = toNumeric(player?.savant?.pa) || 0;
        if (value == null) return;
        const appliedWeight = playerPa > 0 ? playerPa : 1;
        weighted += value * appliedWeight;
        weight += appliedWeight;
      });
      return weight ? (weighted / weight) : null;
    };

    return {
      PA: pa || hitters.length,
      kPct: weightedAverage(player => player?.savant?.kPct) / 100,
      bbPct: weightedAverage(player => player?.savant?.bbPct) / 100,
      AVG: (() => {
        const value = weightedAverage(player => player?.seasonAVG);
        return value == null ? null : value.toFixed(3);
      })(),
      wOBA: (() => {
        const value = weightedAverage(player => player?.fangraphs?.wOBA);
        return value == null ? null : value.toFixed(3);
      })(),
      xwOBA: (() => {
        const value = weightedAverage(player => player?.savant?.xwOBA);
        return value == null ? null : value.toFixed(3);
      })(),
      exitVelo: toNumeric(pitcherSavant?.exitVeloAllowed),
      launchAngle: toNumeric(pitcherSavant?.launchAngleAllowed),
      xBA: (() => {
        const value = weightedAverage(player => player?.savant?.xBA);
        return value == null ? null : value.toFixed(3);
      })(),
      xSLG: (() => {
        const value = weightedAverage(player => player?.savant?.xSLG);
        return value == null ? null : value.toFixed(3);
      })()
    };
  };

  const pitcherLogTable = (starts, name) => {
    if (!starts?.length) return "";
    const compactOpponent = (teamName) => {
      const abbr = getTeamAbbr(teamName);
      return abbr && abbr !== teamName ? abbr : teamName;
    };
    const rows = starts.slice(0, 4).map(s => {
      const er = parseInt(s.er);
      const erClass = isNaN(er) ? "" : er <= 2 ? " good" : er <= 4 ? " warn" : " bad";
      const resultClass = s.result === "W" ? " good" : s.result === "L" ? " bad" : " muted";
      return `<tr>
        <td class="compact-date">${String(s.date || "").slice(5)}</td>
        <td class="compact-opp">${compactOpponent(s.opponent)}</td>
        <td>${s.ip}</td>
        <td class="compact-er${erClass}">${s.er}</td>
        <td>${s.k}</td>
        <td class="compact-wl${resultClass}">${s.result}</td>
      </tr>`;
    }).join("");
    return `
      <div class="compact-log-title" style="margin-top:1rem">${name} - Recent Starts</div>
      <div class="table-wrap compact-log-wrap">
        <table class="compact-log-table">
          <thead><tr><th>Date</th><th>Opp</th><th>IP</th><th>ER</th><th>K</th><th>W/L</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  };

  // Season stats - 2026 only
  const mERA  = getMetsPitchingStat(p.mets.seasonERA,  mn, "ERA");
  const mFIP  = getMetsPitchingStat(p.mets.seasonFIP,  mn, "FIP");
  const mXERA = getMetsPitchingStat(p.mets.seasonXERA, mn, "xFIP");
  const mWHIP = getMetsPitchingStat(p.mets.seasonWHIP, mn, "WHIP");
  const mKBB  = getMetsPitchingStat(p.mets.last3KBB,   mn, "KBB");
  const mKPct  = p.mets.savant?.kPct  ?? "N/A";
  const mBBPct = p.mets.savant?.bbPct ?? "N/A";

  const oERA  = isMissingStat(p.opp.seasonERA)  ? "N/A" : p.opp.seasonERA;
  const oFIP  = isMissingStat(p.opp.seasonFIP)  ? "N/A" : p.opp.seasonFIP;
  const oXERA = isMissingStat(p.opp.seasonXERA) ? "N/A" : p.opp.seasonXERA;
  const oWHIP = isMissingStat(p.opp.seasonWHIP) ? "N/A" : p.opp.seasonWHIP;
  const oKBB  = isMissingStat(p.opp.last3KBB)   ? "N/A" : p.opp.last3KBB;
  const oKPct  = p.opp.savant?.kPct  ?? "N/A";
  const oBBPct = p.opp.savant?.bbPct ?? "N/A";

  // Bullpen - 2026 only
  const metsBP = resolveBullpen(p.metsBullpen);
  const oppBP  = resolveBullpen(p.oppBullpen);

  // Headshot: rectangular MLB CDN crop, placeholder on failure
  const pitcherPhoto = (mlbId, name) => {
    const id = mlbId || METS_PITCHER_IDS[name] || 0;
    if (!id) return `<div class="pitcher-photo-placeholder">&#9918;</div>`;
    return `<img
      src="https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_200,q_auto:best/v1/people/${id}/headshot/67/current"
      class="pitcher-photo" alt="${name}"
      onerror="this.outerHTML='<div class=&quot;pitcher-photo-placeholder&quot;>&#9918;</div>'">`;
  };

  // xwOBA color class
  const xwobaClass = val => {
    if (val == null) return "";
    if (val < 0.290) return "xwoba-good";
    if (val > 0.340) return "xwoba-bad";
    return "xwoba-neutral";
  };

  // vs. Current Roster - colored stat tile grid
  const vsRosterGrid = vsRoster => {
    if (!vsRoster) {
      return `<div style="color:#9099b0;font-size:0.85rem;text-align:center;padding:1.25rem 0">No prior matchup data available</div>`;
    }
    // For pitcher-allowed stats: lower offensive value = better for pitcher = higher pct = red
    const inv = (v, lo, hi) => clamp(Math.round(100 - ((v - lo) / (hi - lo)) * 90), 5, 99);
    const tiles = [
      { label: "PA",        val: vsRoster.PA,          fmt: v => v,                           pct: () => 50 },
      { label: "K%",        val: vsRoster.kPct,        fmt: v => `${(v*100).toFixed(1)}%`,    pct: v => PCTL.KPct(v*100) },
      { label: "BB%",       val: vsRoster.bbPct,       fmt: v => `${(v*100).toFixed(1)}%`,    pct: v => PCTL.BBPct(v*100) },
      { label: "AVG",       val: vsRoster.AVG,         fmt: v => v,                           pct: v => inv(v, 0.160, 0.340) },
      { label: "wOBA",      val: vsRoster.wOBA,        fmt: v => v,                           pct: v => inv(v, 0.240, 0.400) },
      { label: "xwOBA",     val: vsRoster.xwOBA,       fmt: v => v,                           pct: v => inv(v, 0.240, 0.400) },
      { label: "Exit Velo",   val: vsRoster.exitVelo,    fmt: v => `${Number(v).toFixed(1)} mph`, pct: v => inv(v, 82, 95) },
      { label: "Launch Angle", val: vsRoster.launchAngle, fmt: v => `${Number(v).toFixed(1)}&deg;`, pct: () => 50 },
      { label: "xBA",       val: vsRoster.xBA,         fmt: v => v,                           pct: v => inv(v, 0.170, 0.330) },
      { label: "xSLG",      val: vsRoster.xSLG,        fmt: v => v,                           pct: v => inv(v, 0.280, 0.560) },
    ];
    const tilesHtml = tiles.map(t => {
      if (t.val == null) {
        return `<div class="vsr-tile" style="background:#f0f2f8">
          <div class="vsr-label" style="color:#9099b0">${t.label}</div>
          <div class="vsr-val" style="color:#9099b0">N/A</div>
        </div>`;
      }
      const pct  = t.pct(t.val);
      const bg   = pct === 50 ? "#e8ecf2" : pctlColor(pct);
      const isColored = pct !== 50;
      const labelColor = isColored ? "rgba(255,255,255,0.72)" : "#9099b0";
      const valColor   = isColored ? "#fff" : "#1a1a2e";
      return `<div class="vsr-tile" style="background:${bg}">
        <div class="vsr-label" style="color:${labelColor}">${t.label}</div>
        <div class="vsr-val" style="color:${valColor}">${t.fmt(t.val)}</div>
      </div>`;
    }).join("");
    return `<div class="vsr-grid">${tilesHtml}</div>`;
  };

  // Build one pitcher card
  const pitcherCard = (sideLabel, pitcher, seasonStats, recentStarts) => {
    const prow = (label, val) =>
      `<div class="pstat-row"><span class="pstat-label">${label}</span><span class="pstat-val">${val}</span></div>`;

    if (pitcher.announced === false) {
      return `<div class="pitcher-card-v2">
        <div class="pitcher-img-panel">
          <div class="pitcher-photo-placeholder">&#9918;</div>
        </div>
        <div class="pitcher-stats-panel">
          <div class="pitcher-name-lg">TBD</div>
          <div class="pitcher-meta-line">${sideLabel} &middot; Not yet announced</div>
        </div>
      </div>`;
    }

    const { era, fip, xera, whip, kbb, kpct, bbpct } = seasonStats;
    const hhPct = pitcher.savant?.hardHitPct ?? null;
    const whiffPct = pitcher.savant?.whiffPct ?? null;
    const recordBadge = getPitcherRecordBadge(pitcher);

    const id = pitcher.mlbId || METS_PITCHER_IDS[pitcher.name] || 0;
    // Action shot URL (larger crop, person standing)
    const photoHtml = id
      ? `<img class="pitcher-photo-sm"
           src="https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:action:hero:current.png/w_360,q_auto:best/v1/people/${id}/action/hero/current"
           alt="${pitcher.name}"
           onerror="this.src='https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_200,q_auto:best/v1/people/${id}/headshot/67/current'">`
      : `<div class="pitcher-photo-placeholder">&#9918;</div>`;

    // Strip HTML tags from stat values for numeric parsing
    const raw = s => String(s).replace(/<[^>]*>/g, "").replace("%","").trim();

    return `<div class="pitcher-card-v2">
      <div class="pitcher-img-panel">
        ${photoHtml}
      </div>
      <div class="pitcher-stats-panel">
        <div class="pitcher-name-row">
          <span class="pitcher-name-lg">${pitcher.name}</span>
          ${recordBadge ? `<span class="pitcher-record-tag">Record ${recordBadge}</span>` : ""}
        </div>
        <div class="pitcher-meta-line">
          <span class="pitcher-team-tag">${sideLabel}</span>
        </div>
        <div class="sbar-section-label">Traditional</div>
        ${statBar("ERA",  raw(era),  PCTL.ERA,  era)}
        ${statBar("WHIP", raw(whip), PCTL.WHIP, whip)}
        ${statBar("K%",   raw(kpct).replace("%",""), PCTL.KPct, kpct)}
        ${statBar("BB%",  raw(bbpct).replace("%",""), PCTL.BBPct, bbpct)}
        <div class="sbar-section-label" style="margin-top:0.6rem">Advanced</div>
        ${statBar("FIP",       raw(fip),  PCTL.FIP,     fip)}
        ${statBar("xERA",      raw(xera), PCTL.xERA,    xera)}
        ${statBar("K/BB",      raw(kbb),  PCTL.KBB,     kbb)}
        ${statBar("Hard-Hit%", hhPct ? raw(hhPct).replace("%","") : null, PCTL.HardHit, hhPct)}
        ${statBar("Whiff%",    whiffPct ? raw(whiffPct).replace("%","") : null, v => clamp(Math.round(((parseFloat(v) - 16) / (36 - 16)) * 95), 5, 99), whiffPct)}
        ${pitcherLogTable(recentStarts, pitcher.name)}
      </div>
    </div>`;
  };

  const metsCard = pitcherCard(
    "NYM", p.mets,
    { era: mERA, fip: mFIP, xera: mXERA, whip: mWHIP, kbb: mKBB, kpct: mKPct, bbpct: mBBPct },
    game.gameContext?.metsPitcherLog
  );
  const oppCard = pitcherCard(
    game.opponent, p.opp,
    { era: oERA, fip: oFIP, xera: oXERA, whip: oWHIP, kbb: oKBB, kpct: oKPct, bbpct: oBBPct },
    game.gameContext?.oppPitcherLog
  );

  const mergeVsRoster = (fallbackSnapshot, explicitSnapshot) => {
    if (!fallbackSnapshot && !explicitSnapshot) return null;
    return { ...(fallbackSnapshot || {}), ...(explicitSnapshot || {}) };
  };

  const metsVsRoster = mergeVsRoster(aggregateLineupSnapshot(game.lineups?.opp, p.mets.savant), p.mets.vsRoster);
  const oppVsRoster = mergeVsRoster(aggregateLineupSnapshot(game.lineups?.mets, p.opp.savant), p.opp.vsRoster);
  const vsRosterLabel = (p.mets.vsRoster || p.opp.vsRoster)
    ? "Career Matchup - vs. Current Roster"
    : "Current Roster Snapshot";

  const vsRosterSection = `
    <div class="section-floating-label">${vsRosterLabel}</div>
    <div class="pitcher-two-col">
      <div class="card full-card">
        <div class="card-header">${p.mets.name} vs ${getTeamAbbr(game.opponent)} Roster</div>
        ${vsRosterGrid(metsVsRoster)}
      </div>
      <div class="card full-card">
        <div class="card-header">${p.opp.name} vs NYM Roster</div>
        ${vsRosterGrid(oppVsRoster)}
      </div>
    </div>`;

  const statcastSection = (p.mets.savant || p.opp.savant) ? `
    <div class="section-floating-label">Statcast Profile</div>
    <div class="pitching-table-label">Command, Whiff & Contact Quality</div>
    <div class="table-wrap statcast-table-wrap">
      <table class="statcast-table">
        <thead><tr><th>Pitcher</th><th>xERA</th><th>Barrel%</th><th>Hard-Hit%</th><th>Whiff%</th><th>Chase%</th><th>K%</th><th>BB%</th></tr></thead>
        <tbody>
          <tr>
            <td class="statcast-pitcher statcast-pitcher-mets">${p.mets.name}</td>
            ${statcastCell("xERA", p.mets.savant?.xERA)}
            ${statcastCell("Barrel%", p.mets.savant?.barrelPct)}
            ${statcastCell("Hard-Hit%", p.mets.savant?.hardHitPct)}
            ${statcastCell("Whiff%", p.mets.savant?.whiffPct)}
            ${statcastCell("Chase%", p.mets.savant?.chasePct)}
            ${statcastCell("K%", p.mets.savant?.kPct)}
            ${statcastCell("BB%", p.mets.savant?.bbPct)}
          </tr>
          <tr>
            <td class="statcast-pitcher">${p.opp.name}</td>
            ${statcastCell("xERA", p.opp.savant?.xERA)}
            ${statcastCell("Barrel%", p.opp.savant?.barrelPct)}
            ${statcastCell("Hard-Hit%", p.opp.savant?.hardHitPct)}
            ${statcastCell("Whiff%", p.opp.savant?.whiffPct)}
            ${statcastCell("Chase%", p.opp.savant?.chasePct)}
            ${statcastCell("K%", p.opp.savant?.kPct)}
            ${statcastCell("BB%", p.opp.savant?.bbPct)}
          </tr>
        </tbody>
      </table>
    </div>` : "";

  return `
    <div class="section-floating-label">Starting Pitching</div>
    <div class="pitcher-two-col">
      ${metsCard}
      ${oppCard}
    </div>
    ${vsRosterSection}
    ${statcastSection ? `<div class="card full-card statcast-card">${statcastSection}</div>` : ""}

    <div class="section-floating-label">Bullpen</div>
    <div class="pitcher-two-col">
      <div class="card full-card" style="padding:1.25rem">
        <div class="sbar-section-label" style="margin-bottom:0.6rem">NYM Bullpen</div>
        ${statBar("ERA",       metsBP.era?.replace ? metsBP.era.replace(/<[^>]*>/g,"").trim() : metsBP.era,   PCTL.BPERA,  metsBP.era)}
        ${statBar("xFIP",      metsBP.xfip?.replace ? metsBP.xfip.replace(/<[^>]*>/g,"").trim() : metsBP.xfip, PCTL.BPxFIP, metsBP.xfip)}
        ${statBar("WHIP",      metsBP.whip?.replace ? metsBP.whip.replace(/<[^>]*>/g,"").trim() : metsBP.whip, PCTL.WHIP, metsBP.whip)}
        ${statBar("K%",        metsBP.kPct?.replace ? metsBP.kPct.replace(/<[^>]*>/g,"").trim() : metsBP.kPct, PCTL.KPct, metsBP.kPct)}
        ${statBar("Rating",    String(metsBP.rating), PCTL.Rating, `${metsBP.rating}/100`)}
      </div>
      <div class="card full-card" style="padding:1.25rem">
        <div class="sbar-section-label" style="margin-bottom:0.6rem">${getTeamAbbr(game.opponent)} Bullpen</div>
        ${statBar("ERA",       oppBP.era?.replace ? oppBP.era.replace(/<[^>]*>/g,"").trim() : oppBP.era,   PCTL.BPERA,  oppBP.era)}
        ${statBar("xFIP",      oppBP.xfip?.replace ? oppBP.xfip.replace(/<[^>]*>/g,"").trim() : oppBP.xfip, PCTL.BPxFIP, oppBP.xfip)}
        ${statBar("WHIP",      oppBP.whip?.replace ? oppBP.whip.replace(/<[^>]*>/g,"").trim() : oppBP.whip, PCTL.WHIP, oppBP.whip)}
        ${statBar("K%",        oppBP.kPct?.replace ? oppBP.kPct.replace(/<[^>]*>/g,"").trim() : oppBP.kPct, PCTL.KPct, oppBP.kPct)}
        ${statBar("Rating",    String(oppBP.rating), PCTL.Rating, `${oppBP.rating}/100`)}
      </div>
    </div>`;
}

/* ── ROW 3: Lineups + Advanced Metrics ── */
function buildRow3(game) {
  const l = game.lineups || {};
  const metsLineup = (Array.isArray(l.mets) && l.mets.length > 0) ? l.mets : [];
  const oppLineup  = Array.isArray(l.opp) ? l.opp : [];
  const hasLineups = metsLineup.length > 0 || oppLineup.length > 0;
  const hasMetrics = Array.isArray(game.advancedMatchup) && game.advancedMatchup.length > 0;
  if (!hasLineups && !hasMetrics) {
    return `
      <div class="section-floating-label">Lineups & Advanced Metrics</div>
      <div class="card full-card" style="padding:1.25rem;text-align:center;color:#9099b0;line-height:1.6">
        The new matchup loaded, but lineup and advanced matchup data have not been generated yet. Check back after the next data refresh.
      </div>`;
  }
  const isConfirmed = l.lineupStatus === "confirmed";
  const statusLabel = isConfirmed ? "Confirmed Lineups" : "Projected Lineups";
  const statusNote = isConfirmed
    ? ""
    : `<span style="font-size:0.72rem;color:#9099b0;font-weight:500;text-transform:none;letter-spacing:normal;">Lineup for the game will be updated once announced by both teams.</span>`;
  const notReleased = false;
  const oppAbbr = getTeamAbbr(game.opponent);

  const headshotImg = (p) => {
    const pid = p.playerId || p.id || 0;
    return `<img src="https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_60,q_auto:best/v1/people/${pid}/headshot/67/current" class="player-headshot" alt="${p.name}" onerror="this.style.display='none'">`;
  };

  const statCell = (label, value) => `<td class="metric-cell ${metricValueClass(label, value)}">${value ?? "N/A"}</td>`;

  const metsRows = metsLineup.length > 0
    ? metsLineup.map(p => `
    <tr>
      <td>${p.order}</td>
      <td class="player-name-cell">${headshotImg(p)}<span style="font-weight:600">${p.name}</span></td>
      <td>${p.pos}</td>
      ${statCell("AVG", getMetsHitterAVG(p))}
      ${statCell("OPS", getMetsHitterSeasonOps(p))}
      ${statCell("wRC+", p.fangraphs?.wRCPlus ?? p.fangraphs?.war ?? "N/A")}
      ${statCell("xBA", p.savant?.xBA ?? p.seasonAVG ?? "N/A")}
      ${statCell("xwOBA", p.savant?.xwOBA ?? p.fangraphs?.wOBA ?? p.seasonOPS ?? "N/A")}
    </tr>`).join("")
    : `<tr><td colspan="8" style="color:#9099b0;text-align:center;padding:1rem">Lineup TBD</td></tr>`;

  const oppRows = oppLineup.length > 0
    ? oppLineup.map(p => `
    <tr>
      <td>${p.order}</td>
      <td class="player-name-cell">${headshotImg(p)}<span style="font-weight:600">${p.name}</span></td>
      <td>${p.pos}</td>
      ${statCell("AVG", p.seasonAVG ?? "N/A")}
      ${statCell("OPS", p.seasonOPS ?? "N/A")}
      ${statCell("wRC+", p.fangraphs?.wRCPlus ?? p.fangraphs?.war ?? "N/A")}
      ${statCell("xBA", p.savant?.xBA ?? p.seasonAVG ?? "N/A")}
      ${statCell("xwOBA", p.savant?.xwOBA ?? p.fangraphs?.wOBA ?? p.seasonOPS ?? "N/A")}
    </tr>`).join("")
    : `<tr><td colspan="8" style="color:#9099b0;text-align:center;padding:1rem">Lineup TBD</td></tr>`;

  const metsBattingBlock = notReleased
    ? `<div class="lineup-pending"><span class="stat-year">📋 Lineup not yet released</span></div>`
    : `<div class="table-wrap"><table>
         <thead><tr><th>#</th><th>Player</th><th>POS</th><th>AVG</th><th>OPS</th><th>wRC+</th><th>xBA</th><th>xwOBA</th></tr></thead>
         <tbody>${metsRows}</tbody>
       </table></div>`;

  const oppBattingBlock = notReleased
    ? `<div class="lineup-pending"><span class="stat-year">📋 Lineup not yet released</span></div>`
    : `<div class="table-wrap"><table>
         <thead><tr><th>#</th><th>Player</th><th>POS</th><th>AVG</th><th>OPS</th><th>wRC+</th><th>xBA</th><th>xwOBA</th></tr></thead>
         <tbody>${oppRows}</tbody>
       </table></div>`;

  // Advanced metrics - individual cards with progress bars (matching Lovable design)
  const resolvedMetrics = resolveAdvancedMatchup(game);
  const edgeLabel = computeAdvancedEdgeLabel(resolvedMetrics, oppAbbr);
  const advCards = resolvedMetrics.map(r => {
    const nymRaw = parseMetricNumber(r.mets);
    const oppRaw = parseMetricNumber(r.opp);
    const lowerBetter = /k%|strikeout rate/i.test(r.category);
    const comparable = nymRaw != null && oppRaw != null;
    const nymWins = comparable ? (lowerBetter ? nymRaw < oppRaw : nymRaw > oppRaw) : false;
    const maxVal = comparable ? Math.max(nymRaw, oppRaw, 0.001) : 1;
    const nymPct = comparable ? (Math.min((nymRaw / (maxVal * 1.25)) * 100, 100) || 50) : 50;
    const oppPct = comparable ? (Math.min((oppRaw / (maxVal * 1.25)) * 100, 100) || 50) : 50;
    return `
      <div class="adv-metric-card">
        <div class="amc-label">${r.category}</div>
        <div class="amc-row">
          <span class="amc-abbr ${nymWins ? "winner" : ""}">NYM</span>
          <span class="amc-val ${nymWins ? "winner" : ""}">${r.mets}</span>
        </div>
        <div class="amc-bar-track">
          <div class="amc-bar-fill ${nymWins ? "win" : "lose"}" style="width:${nymPct.toFixed(1)}%"></div>
        </div>
        <div class="amc-row" style="margin-top:0.5rem">
          <span class="amc-abbr ${comparable && !nymWins ? "winner" : ""}">${oppAbbr}</span>
          <span class="amc-val ${comparable && !nymWins ? "winner" : ""}">${r.opp}</span>
        </div>
        <div class="amc-bar-track">
          <div class="amc-bar-fill ${comparable && !nymWins ? "win" : "lose"}" style="width:${oppPct.toFixed(1)}%"></div>
        </div>
      </div>`;
  }).join("");

  const advancedMetricsSection = resolvedMetrics.length
    ? `
    <div class="adv-metrics-section">
      <div class="adv-metrics-header">
        <span class="section-floating-label" style="margin:0">Advanced Metrics</span>
        <span class="adv-edge-tag">&#x2197; Edge: ${edgeLabel}</span>
      </div>
      <div class="adv-metric-cards-grid">
        ${advCards}
      </div>
    </div>`
    : `
    <div class="adv-metrics-section">
      <div class="adv-metrics-header">
        <span class="section-floating-label" style="margin:0">Advanced Metrics</span>
      </div>
      <div class="card full-card" style="padding:1rem;text-align:center;color:#9099b0;line-height:1.6">
        Advanced matchup stats are not available for this refreshed game yet.
      </div>
    </div>`;

  return `
    <div class="section-floating-label">${statusLabel} ${statusNote}</div>
    <div class="lineup-two-col">
      <div class="card full-card">
        <div class="lineup-team-header mets-header">New York Mets</div>
        ${metsBattingBlock}
      </div>
      <div class="card full-card">
        <div class="lineup-team-header opp-header">${game.opponent}</div>
        ${oppBattingBlock}
      </div>
    </div>

    ${advancedMetricsSection}`;
}

/* Strip pipe-table rows that GPT may have injected into section prose */
function cleanSectionBody(body) {
  if (!body) return "";
  return body
    .split(/(?<=\.)\s+|\n/)   // split on sentence breaks or newlines
    .filter(line => !line.trim().startsWith("|") && !/^\s*[-|]+\s*$/.test(line))
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/* ── ROW 4: Analysis tiles (3 side-by-side) ── */
function buildAnalysisRow(game) {
  if (!game.writeup?.sections?.length) {
    return `
      <div class="section-floating-label">Game Analysis</div>
      <div class="card full-card" style="padding:1.25rem;color:#9099b0;line-height:1.6">
        Detailed matchup analysis will appear here after the new game's writeup is generated.
      </div>`;
  }
  const sections = game.writeup.sections;

  // Find specific sections by heading keyword rather than hard index
  const find = (patterns) => sections.find(s =>
    patterns.some(p => p.test(s.heading))
  );
  const pitchingS = find([/pitching/i]);
  const lineupS   = find([/lineup/i]);
  const bullpenS  = find([/bullpen/i]);
  const tiles3 = [pitchingS, lineupS, bullpenS].filter(Boolean);
  if (!tiles3.length) return "";

  const icons = ["⚔️", "🎯", "🛡️"];
  const tiles = tiles3.map((s, i) => `
    <div class="analysis-tile">
      <div class="analysis-tile-title">${s.heading.replace(/^\d+\.\s*/, "")}</div>
      <div class="analysis-advantage">
        <span class="advantage-icon">${icons[i]}</span>
        <span class="advantage-label">Advantage: NYM</span>
      </div>
      <p class="analysis-tile-body">${cleanSectionBody(s.body)}</p>
    </div>`).join("");

  return `
    <div class="section-floating-label">Game Analysis</div>
    <div class="analysis-three-col">${tiles}</div>`;
}

/* ── ROW 5: Pick Banner ── */
function buildPickSection(game) {
  if (!game.writeup) {
    const isToday = game.date === getTodayET();
    const dateDisplay = game.date
      ? new Date(game.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
      : "";
    const pendingMessage = isToday
      ? "Today's analysis and pick are scheduled for 9:05 AM ET, with a backup refresh at 10:05 AM ET."
      : "Next game's analysis and pick are scheduled for 9:05 AM ET on game day, with a backup refresh at 10:05 AM ET.";
    return `
      <div class="pick-section pick-pending">
        <p class="pick-summary">${pendingMessage}</p>
        <p class="pick-label">📅 ${isToday ? "Today's Game" : "Next Game"}: ${dateDisplay} vs ${game.opponent}</p>
      </div>`;
  }

  const sections = game.writeup.sections ?? [];
  // Find pick/today section by heading keyword
  const pickSection = sections.find(s => /today|pick|final|bottom line/i.test(s.heading));
  const summary = cleanSectionBody(pickSection?.body || game.writeup?.pickSummary || game.matchupSummary || "");

  const metsML  = game.moneyline?.mets;
  const oddsStr = metsML != null ? (metsML > 0 ? `+${metsML}` : `${metsML}`) : "";

  return `
    <div class="pick-section">
      <div class="pick-left">
        <div class="pick-fire-row">
          <span>&#x1F525;</span>
          <span class="pick-tag">Today's Pick</span>
        </div>
        <p class="pick-summary">${summary}</p>
      </div>
      <div class="pick-right">
        <div class="pick-badge-rect">
          NYM Moneyline <span class="pick-odds">${oddsStr}</span>
        </div>
      </div>
    </div>`;
}

/* ── Trends Card (full-width, below pick if present) ── */
function buildTrendsCard(game) {
  if (!game.trends || game.trends.length === 0) return "";
  const rows = game.trends.map(r => {
    const edgeColor = r.edge === "Mets"
      ? "color:var(--orange);font-weight:700"
      : r.edge === "Neutral"
        ? "color:#9099b0"
        : "color:#c0392b;font-weight:700";
    return `<tr>
      <td>${r.category}</td>
      <td>${r.mets}</td>
      <td>${r.opp}</td>
      <td style="${edgeColor}">${r.edge}</td>
    </tr>`;
  }).join("");
  return `
    <div class="card full-card">
      <div class="card-header">Schedule &amp; Trend Notes</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Category</th><th>Mets</th><th>Opponent</th><th>Edge</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

/* ── Recent Game Tiles ── */
function buildRecentTiles(games, recentBreakdowns) {
  // Prefer persisted recentBreakdowns; fall back to filtering games array
  const items = (recentBreakdowns && recentBreakdowns.length > 0)
    ? recentBreakdowns
    : games.filter(g => g.status === "final").slice(-5).reverse();
  if (!items.length) return "<p style='color:#9099b0;padding:1rem;'>No completed games yet.</p>";
  return items.slice(0, 5).map(g => {
    const pickLine = g.officialPick
      ? `<div style="font-size:0.7rem;color:#9099b0;margin-top:0.15rem;font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${g.officialPick}">${g.officialPick}</div>`
      : "";
    return `
    <div class="game-tile ${g.result === "W" ? "win" : ""}">
      <div style="font-size:0.78rem;color:#9099b0;margin-bottom:0.2rem">${g.date}</div>
      <div style="font-weight:700;color:var(--navy);margin-bottom:0.2rem">${g.opponent}</div>
      <div style="font-size:0.9rem">${g.finalScore || "-"}</div>
      ${pickLine}
      <div style="font-size:0.82rem;color:${g.result === "W" ? "var(--orange)" : "#9099b0"};margin-top:0.2rem">
        ${g.result === "W" ? "Mets Win" : "Loss"}
      </div>
    </div>`;
  }).join("");
}

/* ── Init ── */
/* ── Game Context Card (injuries, recent form, H2H) ── */
function buildGameContextCard(game) {
  const gc = game.gameContext;
  if (!gc || !Object.keys(gc).length) return "";

  const oppAbbr = getTeamAbbr(game.opponent);

  // Recent results log
  const resultLog = (games, label) => {
    if (!games?.length) return `<span style="color:#9099b0;font-size:0.82rem;">No data</span>`;
    const streak = (() => {
      let s = 0, last = null;
      for (const g of games) {
        if (!last) { last = g.result; s = 1; }
        else if (g.result === last) s++;
        else break;
      }
      const bg = last === "W" ? "#dcfce7" : "#fee2e2";
      const co = last === "W" ? "#15803d" : "#b91c1c";
      return `<span style="background:${bg};color:${co};font-size:0.72rem;font-weight:800;padding:1px 7px;border-radius:4px;margin-left:6px;">${last}${s}</span>`;
    })();

    const rows = games.slice(0, 5).map(g => {
      const resultWord = g.result === "W" ? "Win" : g.result === "L" ? "Loss" : (g.result || "-");
      const badgeBg = g.result === "W" ? "#dcfce7" : "#fee2e2";
      const badgeColor = g.result === "W" ? "#15803d" : "#b91c1c";
      const dateText = g.date
        ? new Date(`${g.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : "--";
      const isMetsLog = label.toLowerCase().includes("mets");
      const teamName = isMetsLog ? "New York Mets" : game.opponent;
      const teamLogo = getTeamLogoUrl(isMetsLog ? METS_TEAM_ID : {
        canonicalKey: game.oppCanonicalKey,
        mlbStatsTeamId: game.oppTeamId,
        name: game.opponent
      });
      const oppLogo = getTeamLogoUrl(g.opponent);
      const [rawLeftScore, rawRightScore] = String(g.score || "-").split("-").map(part => (part || "-").trim());
      const teamScore = isMetsLog ? rawLeftScore : rawRightScore;
      const oppScore = isMetsLog ? rawRightScore : rawLeftScore;
      return `
        <div style="display:grid;grid-template-columns:70px auto 1fr;gap:0.75rem;align-items:center;padding:0.45rem 0;border-bottom:1px solid #eef2f7;">
          <div style="font-size:0.78rem;color:#64748b;font-weight:600;">${dateText}</div>
          <div style="background:${badgeBg};color:${badgeColor};font-size:0.72rem;font-weight:800;padding:2px 8px;border-radius:999px;">${resultWord}</div>
          <div style="display:flex;align-items:center;gap:0.55rem;min-width:0;flex-wrap:wrap;">
            ${teamLogo ? `<img src="${teamLogo}" alt="${teamName}" style="width:18px;height:18px;object-fit:contain;">` : ""}
            <span style="font-size:0.9rem;font-weight:800;color:var(--ink);min-width:18px;">${teamScore}</span>
            ${oppLogo ? `<img src="${oppLogo}" alt="${g.opponent}" style="width:18px;height:18px;object-fit:contain;">` : ""}
            <span style="font-size:0.9rem;font-weight:800;color:var(--ink);min-width:18px;">${oppScore}</span>
          </div>
        </div>`;
    }).join("");

    return `<div><div style="margin-bottom:0.45rem;font-size:0.72rem;font-weight:700;color:#9099b0;text-transform:uppercase;letter-spacing:0.07em;">${label}${streak}</div><div>${rows}</div></div>`;
  };

  // Injury chips
  const injuryChips = (injuries, label) => {
    if (!injuries?.length) return `<div style="color:#9099b0;font-size:0.82rem;">${label}: None reported</div>`;
    const chips = injuries.slice(0, 5).map(i =>
      `<span title="${i.description || ""}" style="display:inline-block;background:#fef3c7;color:#92400e;font-size:0.72rem;font-weight:600;padding:2px 8px;border-radius:4px;margin:2px 3px 2px 0;cursor:default;">${i.name} <em style="font-weight:400">${i.status}</em></span>`
    ).join("");
    return `<div style="margin-bottom:0.3rem;font-size:0.72rem;font-weight:700;color:#9099b0;text-transform:uppercase;letter-spacing:0.07em;">${label} IL</div><div>${chips}</div>`;
  };

  // H2H badge
  const h2h = gc.headToHead;
  const h2hHtml = (h2h && (h2h.wins + h2h.losses) > 0)
    ? `<span style="background:#dbeafe;color:#1d4ed8;font-size:0.75rem;font-weight:700;padding:3px 10px;border-radius:5px;">Season Series: Mets ${h2h.wins}-${h2h.losses} vs ${oppAbbr}</span>`
    : `<span style="background:#f1f5f9;color:#64748b;font-size:0.75rem;font-weight:600;padding:3px 10px;border-radius:5px;">No prior matchups this season</span>`;

  return `
    <div class="section-floating-label">Game Context</div>
    <div class="card full-card" style="padding:1.25rem">

      <!-- Recent form row -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:1rem;padding-bottom:1rem;border-bottom:1px solid var(--border)">
        <div>
          ${resultLog(gc.metsRecentGames, "Mets Last 5")}
        </div>
        <div>
          ${resultLog(gc.oppRecentGames, `${oppAbbr} Last 5`)}
        </div>
      </div>

      <!-- Head to head -->
      <div style="margin-bottom:1rem;padding-bottom:1rem;border-bottom:1px solid var(--border)">
        <div style="font-size:0.72rem;font-weight:700;color:#9099b0;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:0.4rem">Head-to-Head</div>
        ${h2hHtml}
      </div>

      <!-- Injury report -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:1rem;padding-bottom:1rem;border-bottom:1px solid var(--border)">
        <div>${injuryChips(gc.metsInjuries, "Mets")}</div>
        <div>${injuryChips(gc.oppInjuries, oppAbbr)}</div>
      </div>

    </div>`;
}

/* ── Team Advanced Stats Card ── */
function buildTeamAdvancedCard(game) {
  const ta = game.teamAdvanced;
  if (!ta?.mets || !ta?.opp) {
    return `
      <div class="section-floating-label">Team Advanced Stats</div>
      <div class="card full-card" style="padding:1.25rem;color:#9099b0;line-height:1.6">
        Team advanced stats for this refreshed matchup are still loading and will appear after the data package updates.
      </div>`;
  }
  const oppAbbr = getTeamAbbr(game.opponent);
  const metsLogo = getTeamLogoUrl("New York Mets");
  const oppLogo = getTeamLogoUrl({
    canonicalKey: game.oppCanonicalKey,
    mlbStatsTeamId: game.oppTeamId,
    name: game.opponent
  });
  const teamHeader = (label, logoUrl) => `<span class="team-metric-header">${logoUrl ? `<img src="${logoUrl}" alt="${label}">` : ""}<span>${label}</span></span>`;

  const rows = [
    { label: "wRC+",         mVal: ta.mets.wrcPlus,   oVal: ta.opp.wrcPlus,   higherBetter: true  },
    { label: "wOBA",         mVal: ta.mets.woba,      oVal: ta.opp.woba,      higherBetter: true  },
    { label: "ISO",          mVal: ta.mets.iso,       oVal: ta.opp.iso,       higherBetter: true  },
    { label: "xBA",          mVal: ta.mets.xba,       oVal: ta.opp.xba,       higherBetter: true  },
    { label: "xSLG",         mVal: ta.mets.xslg,      oVal: ta.opp.xslg,      higherBetter: true  },
    { label: "xwOBA",        mVal: ta.mets.xwoba,     oVal: ta.opp.xwoba,     higherBetter: true  },
    { label: "OPS",          mVal: ta.mets.ops,       oVal: ta.opp.ops,       higherBetter: true  },
    { label: "BB%",          mVal: ta.mets.bbPct,     oVal: ta.opp.bbPct,     higherBetter: true  },
    { label: "K%",           mVal: ta.mets.kPct,      oVal: ta.opp.kPct,      higherBetter: false },
    { label: "Rotation xFIP",mVal: ta.mets.rotXfip || ta.mets.rotFip, oVal: ta.opp.rotXfip || ta.opp.rotFip, higherBetter: false },
  ].map(r => {
    const fmt = v => (v == null || v === "") ? "-" : String(v);
    const mNum = parseMetricNumber(r.mVal);
    const oNum = parseMetricNumber(r.oVal);
    const hasComparison = mNum != null && oNum != null;
    const metsLeads = hasComparison && (r.higherBetter ? mNum > oNum : mNum < oNum);
    const oppLeads  = hasComparison && !metsLeads && mNum !== oNum;
    const mStyle = metsLeads ? "font-weight:700;color:#15803d" : "";
    const oStyle = oppLeads  ? "font-weight:700;color:#b91c1c" : "";
    const edgeBadge = metsLeads
      ? `${teamHeader("Mets", metsLogo)} <span class="team-edge-badge team-edge-badge-mets">edge</span>`
      : oppLeads
        ? `${teamHeader(game.opponent, oppLogo)} <span class="team-edge-badge team-edge-badge-opp">edge</span>`
        : "-";
    return `<tr>
      <td>${r.label}</td>
      <td style="${mStyle}">${fmt(r.mVal)}</td>
      <td style="${oStyle}">${fmt(r.oVal)}</td>
      <td>${edgeBadge}</td>
    </tr>`;
  }).join("");

  return `
    <div class="section-floating-label">Team Advanced Stats</div>
    <div class="card full-card">
      <div class="card-header">2026 Team Metrics</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Stat</th><th>${teamHeader("NYM", metsLogo)}</th><th>${teamHeader(oppAbbr, oppLogo)}</th><th>Edge</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p style="font-size:0.72rem;color:#9099b0;padding:0.5rem 1rem 0.75rem;">Sources: FanGraphs ? Baseball Savant ? MLB Stats API</p>
    </div>`;
}

function showNoGameTodayState() {
  const labelEl = document.getElementById("hero-game-label");
  const dateEl = document.getElementById("hero-game-date");
  const matchupEl = document.getElementById("hero-game-matchup");
  const container = document.getElementById("today-game-container");

  if (labelEl) labelEl.textContent = "Today's Game";
  if (dateEl) {
    dateEl.textContent = new Date(getTodayISO() + "T12:00:00")
      .toLocaleDateString("en-US", { month: "long", day: "numeric" });
  }
  if (matchupEl) matchupEl.textContent = "No breakdown available yet";
  if (container) {
    container.innerHTML = `
      <div class="card full-card" style="padding:1.5rem;text-align:center">
        <p style="margin:0;color:var(--ink);line-height:1.7">No breakdown available yet for today's game. Check back soon.</p>
      </div>`;
  }
}

async function init() {
  const { games, generatedAt, recentBreakdowns } = await loadGameData();
  const today = getTodayISO();
  const sortedGames = [...games].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  const todayGame = sortedGames.find(g => g.date === today);
  const nextGame = sortedGames.find(g => g.date > today);
  const latestGame = [...sortedGames].reverse().find(g => g.date < today);
  const featuredGame = todayGame || nextGame || latestGame || null;

  // Update hero headline - three separate lines
  if (!featuredGame) {
    showNoGameTodayState();
  } else {
    const isToday = featuredGame.date === today;
    const isFuture = featuredGame.date > today;
    const vsAt = featuredGame.homeAway === "away" ? "@" : "vs";
    const labelEl = document.getElementById("hero-game-label");
    const dateEl = document.getElementById("hero-game-date");
    const matchupEl = document.getElementById("hero-game-matchup");
    if (labelEl) {
      labelEl.textContent = isToday ? "Today's Game" : isFuture ? "Next Game" : "Latest Game";
    }
    if (dateEl && featuredGame.date) {
      dateEl.textContent = new Date(featuredGame.date + "T12:00:00")
        .toLocaleDateString("en-US", { month: "long", day: "numeric" });
    }
    if (matchupEl) matchupEl.textContent = `New York Mets ${vsAt} ${featuredGame.opponent}`;

  const container = document.getElementById("today-game-container");
  container.innerHTML =
    buildMatchupStrip(featuredGame) +         // Row 1 - matchup header
    buildGameContextCard(featuredGame) +      // Row 2 - recent form, injuries, H2H, pitcher logs
    buildPitchingCard(featuredGame) +         // Row 3 - starting pitching comparison
    buildRow3(featuredGame) +                 // Row 4 - lineups + advanced metrics
    buildTeamAdvancedCard(featuredGame) +     // Row 5 - team advanced stats table
    buildAnalysisRow(featuredGame) +          // Row 6 - 3 analysis tiles
    buildPickSection(featuredGame) +          // Row 7 - pick banner
    buildTrendsCard(featuredGame);            // supplemental trends

  }

  document.getElementById("recent-games-container").innerHTML = buildRecentTiles(games, recentBreakdowns);

  if (generatedAt) {
    const el = document.getElementById("data-timestamp");
    if (el) {
      const d = new Date(generatedAt);
      el.textContent = "Last updated: " + d.toLocaleString("en-US", {
        timeZone: "America/New_York", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short"
      });
    }
  }
}

init();

async function refreshFeaturedGame() {
  const { games, generatedAt } = await loadGameData();
  const today = getTodayISO();
  const featuredGame = games.find(g => g.date === today) || games.find(g => g.date > today) || games[0] || null;

  if (!featuredGame) return;

  const isToday = featuredGame.date === today;
  const isFuture = featuredGame.date > today;
  const vsAt = featuredGame.homeAway === "away" ? "@" : "vs";
  const labelEl = document.getElementById("hero-game-label");
  const dateEl = document.getElementById("hero-game-date");
  const matchupEl = document.getElementById("hero-game-matchup");
  const container = document.getElementById("today-game-container");

  if (labelEl) {
    labelEl.textContent = isToday ? "Today's Game" : isFuture ? "Next Game" : "Latest Game";
  }
  if (dateEl && featuredGame.date) {
    dateEl.textContent = new Date(featuredGame.date + "T12:00:00")
      .toLocaleDateString("en-US", { month: "long", day: "numeric" });
  }
  if (matchupEl) {
    matchupEl.textContent = `New York Mets ${vsAt} ${featuredGame.opponent}`;
  }
  if (container) {
    container.innerHTML =
      buildMatchupStrip(featuredGame) +
      buildGameContextCard(featuredGame) +
      buildPitchingCard(featuredGame) +
      buildRow3(featuredGame) +
      buildTeamAdvancedCard(featuredGame) +
      buildAnalysisRow(featuredGame) +
      buildPickSection(featuredGame) +
      buildTrendsCard(featuredGame);
  }

  if (generatedAt) {
    const el = document.getElementById("data-timestamp");
    if (el) {
      const d = new Date(generatedAt);
      el.textContent = "Last updated: " + d.toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZoneName: "short"
      });
    }
  }
}

refreshFeaturedGame().catch(err => {
  console.warn("Unable to refresh featured Mets game.", err);
});
