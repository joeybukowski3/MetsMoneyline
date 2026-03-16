import METS_2025 from "../data/mets2025.js";

const METS_TEAM_ID = 121;
const EASTERN_TIME_ZONE = "America/New_York";

function getTodayISO() {
  return new Date().toISOString().slice(0, 10);
}

function getTodayET() {
  return new Date().toLocaleDateString("en-CA", { timeZone: EASTERN_TIME_ZONE });
}

function toEtDateString(dateLike) {
  return new Date(dateLike).toLocaleDateString("en-CA", { timeZone: EASTERN_TIME_ZONE });
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

function formatLeagueRecord(record) {
  if (record?.w == null || record?.l == null) return "";
  return `${record.w}-${record.l}`;
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

function mapScheduleGame(game) {
  const away = game?.teams?.away?.team || {};
  const home = game?.teams?.home?.team || {};
  const metsAreAway = away.id === METS_TEAM_ID;
  const opponent = metsAreAway ? home : away;
  const metsProbable = metsAreAway ? game?.teams?.away?.probablePitcher : game?.teams?.home?.probablePitcher;
  const oppProbable = metsAreAway ? game?.teams?.home?.probablePitcher : game?.teams?.away?.probablePitcher;
  const metsRecord = metsAreAway ? game?.teams?.away?.leagueRecord : game?.teams?.home?.leagueRecord;
  const oppRecord = metsAreAway ? game?.teams?.home?.leagueRecord : game?.teams?.away?.leagueRecord;

  return {
    date: game.officialDate,
    opponent: opponent?.name || "Opponent TBD",
    oppTeamId: opponent?.id ?? null,
    homeAway: metsAreAway ? "away" : "home",
    time: formatGameTimeET(game.gameDate),
    ballpark: game?.venue?.name || "Venue TBD",
    status: "upcoming",
    metsRecord: formatLeagueRecord(metsRecord),
    oppRecord: formatLeagueRecord(oppRecord),
    moneyline: {},
    total: null,
    overUnder: null,
    lineups: { lineupStatus: "not_released", mets: [], opp: [] },
    pitching: createFallbackPitching({ mets: metsProbable, opp: oppProbable }),
    advancedMatchup: [],
    teamAdvanced: null,
    gameContext: null,
    trends: [],
    weather: null,
    writeup: null
  };
}

async function fetchLiveMetsGame() {
  const today = getTodayET();
  const start = new Date();
  start.setDate(start.getDate() - 1);
  const end = new Date();
  end.setDate(end.getDate() + 14);

  const url = new URL("https://statsapi.mlb.com/api/v1/schedule/games/");
  url.searchParams.set("sportId", "1");
  url.searchParams.set("teamId", String(METS_TEAM_ID));
  url.searchParams.set("startDate", toEtDateString(start));
  url.searchParams.set("endDate", toEtDateString(end));
  url.searchParams.set("hydrate", "team,venue,probablePitcher");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`MLB schedule request failed: ${res.status}`);

  const data = await res.json();
  const games = (data?.dates || [])
    .flatMap(d => d.games || [])
    .sort((a, b) => new Date(a.gameDate) - new Date(b.gameDate));

  const todaysGame = games.find(g => g.officialDate === today);
  if (todaysGame) return mapScheduleGame(todaysGame);

  const nextGame = games.find(g => g.officialDate > today);
  return nextGame ? mapScheduleGame(nextGame) : null;
}

function mergeLiveGame(staticGame, liveGame) {
  if (!liveGame) return staticGame;
  if (!staticGame) return liveGame;

  const sameMatchup =
    staticGame.date === liveGame.date &&
    staticGame.opponent === liveGame.opponent &&
    staticGame.homeAway === liveGame.homeAway;

  if (!sameMatchup) return liveGame;

  return {
    ...staticGame,
    ...liveGame,
    moneyline: staticGame.moneyline || liveGame.moneyline,
    lineups: staticGame.lineups || liveGame.lineups,
    pitching: staticGame.pitching || liveGame.pitching,
    advancedMatchup: staticGame.advancedMatchup || liveGame.advancedMatchup,
    teamAdvanced: staticGame.teamAdvanced || liveGame.teamAdvanced,
    gameContext: staticGame.gameContext || liveGame.gameContext,
    trends: staticGame.trends || liveGame.trends,
    weather: staticGame.weather || liveGame.weather,
    writeup: staticGame.writeup || liveGame.writeup
  };
}

async function loadGameData() {
  const res = await fetch("data/sample-game.json");
  const data = await res.json();

  try {
    const liveGame = await fetchLiveMetsGame();
    if (data?.games?.length) {
      data.games = [mergeLiveGame(data.games[0], liveGame)];
    } else if (liveGame) {
      data.games = [liveGame];
    }
  } catch (err) {
    console.warn("Unable to refresh live Mets schedule.", err);
  }

  return data;
}

// ── MLB team ID lookup (covers all 30 teams) ──
const TEAM_MLB_ID = {
  "Arizona Diamondbacks":    109, "Atlanta Braves":          144,
  "Baltimore Orioles":       110, "Boston Red Sox":          111,
  "Chicago Cubs":            112, "Chicago White Sox":       145,
  "Cincinnati Reds":         113, "Cleveland Guardians":     114,
  "Colorado Rockies":        115, "Detroit Tigers":          116,
  "Houston Astros":          117, "Kansas City Royals":      118,
  "Los Angeles Angels":      108, "Los Angeles Dodgers":     119,
  "Miami Marlins":           146, "Milwaukee Brewers":       158,
  "Minnesota Twins":         142, "New York Mets":           121,
  "New York Yankees":        147, "Oakland Athletics":       133,
  "Philadelphia Phillies":   143, "Pittsburgh Pirates":      134,
  "San Diego Padres":        135, "San Francisco Giants":    137,
  "Seattle Mariners":        136, "St. Louis Cardinals":     138,
  "Tampa Bay Rays":          139, "Texas Rangers":           140,
  "Toronto Blue Jays":       141, "Washington Nationals":    120,
};

const TEAM_ABBR = {
  "Arizona Diamondbacks": "ARI",
  "Atlanta Braves": "ATL",
  "Baltimore Orioles": "BAL",
  "Boston Red Sox": "BOS",
  "Chicago Cubs": "CHC",
  "Chicago White Sox": "CWS",
  "Cincinnati Reds": "CIN",
  "Cleveland Guardians": "CLE",
  "Colorado Rockies": "COL",
  "Detroit Tigers": "DET",
  "Houston Astros": "HOU",
  "Kansas City Royals": "KC",
  "Los Angeles Angels": "LAA",
  "Los Angeles Dodgers": "LAD",
  "Miami Marlins": "MIA",
  "Milwaukee Brewers": "MIL",
  "Minnesota Twins": "MIN",
  "New York Mets": "NYM",
  "New York Yankees": "NYY",
  "Oakland Athletics": "ATH",
  "Philadelphia Phillies": "PHI",
  "Pittsburgh Pirates": "PIT",
  "San Diego Padres": "SD",
  "San Francisco Giants": "SF",
  "Seattle Mariners": "SEA",
  "St. Louis Cardinals": "STL",
  "Tampa Bay Rays": "TB",
  "Texas Rangers": "TEX",
  "Toronto Blue Jays": "TOR",
  "Washington Nationals": "WSH"
};

const TEAM_STORYLINES = {
  "New York Mets": {
    season2025: "89-73",
    note: "New York is coming off an 89-73 season and is looking for quick impact from Juan Soto, Marcus Semien, Bo Bichette, Jorge Polanco, and Luis Robert Jr."
  },
  "Toronto Blue Jays": {
    season2025: null,
    note: "Toronto is still trying to settle a reshaped lineup and get more consistency from its veteran core heading into this matchup."
  }
};

function getTeamLogoUrl(teamNameOrId) {
  const id = typeof teamNameOrId === "number"
    ? teamNameOrId
    : TEAM_MLB_ID[teamNameOrId];
  return id ? `https://www.mlbstatic.com/team-logos/${id}.svg` : "";
}

function getTeamAbbr(teamName) {
  if (TEAM_ABBR[teamName]) return TEAM_ABBR[teamName];
  const words = (teamName || "").split(" ");
  return words[words.length - 1].substring(0, 3).toUpperCase();
}

function formatOrdinal(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n}st`;
  if (mod10 === 2 && mod100 !== 12) return `${n}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${n}rd`;
  return `${n}th`;
}

function describeStreak(games, teamLabel) {
  if (!games?.length) return `${teamLabel} have not established a meaningful streak yet`;
  const latest = games[0]?.result;
  if (!latest || !["W", "L"].includes(latest)) return `${teamLabel} are still settling into the season`;
  let count = 0;
  for (const game of games) {
    if (game.result !== latest) break;
    count += 1;
  }
  const streakType = latest === "W" ? "winning" : "losing";
  return `${count}-game ${streakType} streak`;
}

function getTeamStoryline(teamName) {
  return TEAM_STORYLINES[teamName]?.note || `${teamName} are still looking for steadier production from their current core as the season settles in.`;
}

function buildGameBreakdown(game) {
  const gc = game.gameContext || {};
  const metsStory = getTeamStoryline("New York Mets");
  const oppStory = getTeamStoryline(game.opponent);
  const metsStreak = describeStreak(gc.metsRecentGames, "The Mets");
  const oppStreak = describeStreak(gc.oppRecentGames, game.opponent);
  const h2hWins = gc.headToHead?.wins ?? 0;
  const h2hLosses = gc.headToHead?.losses ?? 0;
  const priorMeetings = h2hWins + h2hLosses;
  const meetingText = priorMeetings === 0
    ? "This is the 1st meeting between these teams this season."
    : `This is their ${formatOrdinal(priorMeetings + 1)} matchup of the season, with ${h2hWins > h2hLosses ? "the Mets" : h2hLosses > h2hWins ? game.opponent : "neither side"} ${h2hWins === h2hLosses ? `even at ${h2hWins}-${h2hLosses}` : `ahead ${Math.max(h2hWins, h2hLosses)}-${Math.min(h2hWins, h2hLosses)}`}.`;

  const parts = [
    `Both teams come into this game with the Mets on a ${metsStreak} and ${getTeamAbbr(game.opponent)} on a ${oppStreak}. New York is ${getMetsRecord(game)} on the year while ${game.opponent} is ${getOppRecord(game)}.`,
    meetingText,
    metsStory,
    oppStory
  ];

  return `
    <div class="section-floating-label">Game Breakdown</div>
    <div class="card full-card" style="padding:1.25rem">
      <p style="margin:0;color:var(--ink);line-height:1.7">${parts.join(" ")}</p>
    </div>`;
}

// ── Default lineup fallback — 2026 projected starting 9 (stats from 2025) ──
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

function get2025PlayerStat(name, group, stat) {
  const entry = METS_2025[group]?.[name];
  if (!entry || entry[stat] == null) return "N/A";
  return `${entry[stat]} <span class="stat-year">(2025)</span>`;
}

function getMetsPitchingStat(liveValue, playerName, stat) {
  return isMissingStat(liveValue) ? get2025PlayerStat(playerName, "starters", stat) : liveValue;
}

function getMetsHitterSeasonOps(player) {
  return isMissingStat(player.seasonOPS)
    ? get2025PlayerStat(player.name, "hitters", "OPS")
    : player.seasonOPS;
}

function getMetsHitterAVG(player) {
  return isMissingStat(player.seasonAVG)
    ? get2025PlayerStat(player.name, "hitters", "AVG")
    : player.seasonAVG;
}

function stat2025(val) {
  return `${val} <span class="stat-year">(2025)</span>`;
}

function fallback(liveVal, fallbackVal) {
  return isMissingStat(liveVal) ? stat2025(fallbackVal) : liveVal;
}

/* FIX 2 — bullpen 2025 fallbacks */
function resolveBullpen(bullpenObj, isNYM, oppName) {
  const bp = bullpenObj || {};
  if (isNYM) {
    return {
      era:    fallback(bp.seasonERA,  METS_2025.bullpenERA),
      xfip:   fallback(bp.seasonXFIP, METS_2025.bullpenxFIP),
      last14: fallback(bp.last14ERA,  METS_2025.bullpenERA),
      rating: bp.rating ?? 70
    };
  }
  const oppData = METS_2025.opponents2025?.[oppName];
  return {
    era:    isMissingStat(bp.seasonERA)  ? (oppData?.bullpenERA  ? stat2025(oppData.bullpenERA)  : stat2025(METS_2025.leagueAvg2025.bullpenERA)) : bp.seasonERA,
    xfip:   isMissingStat(bp.seasonXFIP) ? (oppData?.bullpenxFIP ? stat2025(oppData.bullpenxFIP) : stat2025(METS_2025.leagueAvg2025.bullpenxFIP)) : bp.seasonXFIP,
    last14: isMissingStat(bp.last14ERA) ? (oppData?.bullpenLast14ERA ? stat2025(oppData.bullpenLast14ERA) : (oppData?.bullpenERA ? stat2025(oppData.bullpenERA) : stat2025(METS_2025.leagueAvg2025.bullpenERA))) : bp.last14ERA,
    rating: bp.rating ?? 65
  };
}

/* FIX 3 — advanced metrics 2025 fallbacks */
function resolveAdvancedMatchup(game) {
  const oppData = METS_2025.opponents2025?.[game.opponent];
  const live    = game.advancedMatchup || [];
  const labels  = ["wRC+", "Hard-Hit%", "Barrel%", "BB%", "K%"];

  const get = (i, key) => live[i]?.[key];

  const metsWRC = METS_2025.teamWRC_plus;
  const oppWRC  = oppData?.teamWRC_plus ?? METS_2025.leagueAvg2025.teamWRC_plus;
  const wrcEdge = (metsWRC && oppWRC && (metsWRC - oppWRC) >= 5) ? "Mets" : "Neutral";
  const oppHardHit = oppData?.hardHitPct ?? METS_2025.leagueAvg2025.hardHitPct;
  const oppBarrel = oppData?.barrelPct ?? METS_2025.leagueAvg2025.barrelPct;
  const oppBB = oppData?.bbPct ?? METS_2025.leagueAvg2025.bbPct;
  const oppK = oppData?.kPct ?? METS_2025.leagueAvg2025.kPct;

  const resolveRow = (i, metsFallback, oppFallback, edgeFallback) => ({
    category: get(i, "category") || labels[i],
    mets: !isMissingStat(get(i, "mets")) ? get(i, "mets") : stat2025(metsFallback),
    opp:  !isMissingStat(get(i, "opp"))  ? get(i, "opp")  : (oppFallback != null ? stat2025(oppFallback) : "N/A"),
    edge: (get(i, "edge") && get(i, "edge") !== "Neutral") ? get(i, "edge") : edgeFallback
  });

  return [
    resolveRow(0, metsWRC, oppWRC, wrcEdge),
    resolveRow(1, METS_2025.hardHitPct, oppHardHit, "N/A"),
    resolveRow(2, METS_2025.barrelPct,  oppBarrel, "N/A"),
    resolveRow(3, METS_2025.bbPct,      oppBB, "N/A"),
    resolveRow(4, METS_2025.kPct,       oppK, "N/A")
  ];
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

  const oppLogoUrl = game.oppTeamId
    ? getTeamLogoUrl(game.oppTeamId)
    : getTeamLogoUrl(game.opponent);

  const oppLogoHtml = oppLogoUrl
    ? `<img src="${oppLogoUrl}" alt="${game.opponent}">`
    : `<span style="width:36px;height:36px;display:inline-block;"></span>`;
  const metsRecord = getMetsRecord(game);
  const oppRecord = getOppRecord(game);

  return `
    <div class="matchup-bar-compact">
      <div class="mb-teams">
        <div class="mb-team">
          <img src="https://www.mlbstatic.com/team-logos/121.svg" alt="NYM">
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
   Maps a raw stat value to an estimated 0–100 MLB percentile.
   Lower-is-better stats (ERA, WHIP, BB%) are inverted so 100 = best.
   Curves based on 2025 MLB starter distributions. */
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
  // BB%: elite ~4%, avg ~8%, poor ~13% — lower is better
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
  // Rating: direct 0–100
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

  // Season stats with 2025 fallbacks for Mets pitcher
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

  // Bullpen — apply 2025 fallbacks
  const metsBP = resolveBullpen(p.metsBullpen, true,  game.opponent);
  const oppBP  = resolveBullpen(p.oppBullpen,  false, game.opponent);

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

  // vs. Current Roster — colored stat tile grid
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
      { label: "Exit Velo", val: vsRoster.exitVelo,    fmt: v => `${v} mph`,                  pct: v => inv(v, 82, 95) },
      { label: "Launch °",  val: vsRoster.launchAngle, fmt: v => `${v}°`,                     pct: () => 50 },
      { label: "xBA",       val: vsRoster.xBA,         fmt: v => v,                           pct: v => inv(v, 0.170, 0.330) },
      { label: "xSLG",      val: vsRoster.xSLG,        fmt: v => v,                           pct: v => inv(v, 0.280, 0.560) },
    ];
    const tilesHtml = tiles.map(t => {
      if (t.val == null) {
        return `<div class="vsr-tile" style="background:#f0f2f8">
          <div class="vsr-label" style="color:#9099b0">${t.label}</div>
          <div class="vsr-val" style="color:#9099b0">—</div>
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
  const pitcherCard = (sideLabel, pitcher, seasonStats, vsRoster) => {
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
          ${pitcher.seasonRecord ? `<span class="pitcher-record-tag">Record ${pitcher.seasonRecord}</span>` : ""}
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
      </div>
    </div>`;
  };

  const metsCard = pitcherCard(
    "NYM", p.mets,
    { era: mERA, fip: mFIP, xera: mXERA, whip: mWHIP, kbb: mKBB, kpct: mKPct, bbpct: mBBPct }
  );
  const oppCard = pitcherCard(
    game.opponent, p.opp,
    { era: oERA, fip: oFIP, xera: oXERA, whip: oWHIP, kbb: oKBB, kpct: oKPct, bbpct: oBBPct }
  );

  const vsRosterSection = `
    <div class="section-floating-label">Career Matchup — vs. Current Roster</div>
    <div class="pitcher-two-col">
      <div class="card full-card">
        <div class="card-header">${p.mets.name} vs ${getTeamAbbr(game.opponent)} Roster</div>
        ${vsRosterGrid(p.mets.vsRoster)}
      </div>
      <div class="card full-card">
        <div class="card-header">${p.opp.name} vs NYM Roster</div>
        ${vsRosterGrid(p.opp.vsRoster)}
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
    <div class="section-floating-label">Starting Pitching (2025)</div>
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
        ${statBar("Last 14d ERA", metsBP.last14?.replace ? metsBP.last14.replace(/<[^>]*>/g,"").trim() : metsBP.last14, PCTL.BPERA, metsBP.last14)}
        ${statBar("Rating",    String(metsBP.rating), PCTL.Rating, `${metsBP.rating}/100`)}
      </div>
      <div class="card full-card" style="padding:1.25rem">
        <div class="sbar-section-label" style="margin-bottom:0.6rem">${getTeamAbbr(game.opponent)} Bullpen</div>
        ${statBar("ERA",       oppBP.era?.replace ? oppBP.era.replace(/<[^>]*>/g,"").trim() : oppBP.era,   PCTL.BPERA,  oppBP.era)}
        ${statBar("xFIP",      oppBP.xfip?.replace ? oppBP.xfip.replace(/<[^>]*>/g,"").trim() : oppBP.xfip, PCTL.BPxFIP, oppBP.xfip)}
        ${statBar("Last 14d ERA", oppBP.last14?.replace ? oppBP.last14.replace(/<[^>]*>/g,"").trim() : oppBP.last14, PCTL.BPERA, oppBP.last14)}
        ${statBar("Rating",    String(oppBP.rating), PCTL.Rating, `${oppBP.rating}/100`)}
      </div>
    </div>`;
}

/* ── ROW 3: Lineups + Advanced Metrics ── */
function buildRow3(game) {
  const l = game.lineups || {};
  const metsLineup = (Array.isArray(l.mets) && l.mets.length > 0) ? l.mets : DEFAULT_METS_LINEUP;
  const oppLineup  = Array.isArray(l.opp) ? l.opp : [];
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

  const metsRows = metsLineup.map(p => `
    <tr>
      <td>${p.order}</td>
      <td class="player-name-cell">${headshotImg(p)}<span style="font-weight:600">${p.name}</span></td>
      <td>${p.pos}</td>
      <td>${getMetsHitterAVG(p)}</td>
      <td>${getMetsHitterSeasonOps(p)}</td>
    </tr>`).join("");

  const oppRows = oppLineup.length > 0
    ? oppLineup.map(p => `
    <tr>
      <td>${p.order}</td>
      <td class="player-name-cell">${headshotImg(p)}<span style="font-weight:600">${p.name}</span></td>
      <td>${p.pos}</td>
      <td>${p.seasonAVG ?? "N/A"}</td>
      <td>${p.seasonOPS ?? "N/A"}</td>
    </tr>`).join("")
    : `<tr><td colspan="5" style="color:#9099b0;text-align:center;padding:1rem">Lineup TBD</td></tr>`;

  const metsBattingBlock = notReleased
    ? `<div class="lineup-pending"><span class="stat-year">📋 Lineup not yet released</span></div>`
    : `<div class="table-wrap"><table>
         <thead><tr><th>#</th><th>Player</th><th>POS</th><th>AVG</th><th>OPS</th></tr></thead>
         <tbody>${metsRows}</tbody>
       </table></div>`;

  const oppBattingBlock = notReleased
    ? `<div class="lineup-pending"><span class="stat-year">📋 Lineup not yet released</span></div>`
    : `<div class="table-wrap"><table>
         <thead><tr><th>#</th><th>Player</th><th>POS</th><th>AVG</th><th>OPS</th></tr></thead>
         <tbody>${oppRows}</tbody>
       </table></div>`;

  // Advanced metrics — individual cards with progress bars (matching Lovable design)
  const resolvedMetrics = resolveAdvancedMatchup(game);
  const advCards = resolvedMetrics.map(r => {
    // Extract raw numeric values for progress bar calculation
    const nymRaw = parseFloat(String(r.mets).replace(/<[^>]*>/g, "").trim());
    const oppRaw = parseFloat(String(r.opp).replace(/<[^>]*>/g, "").trim());
    const isKPct = r.category === "K%";
    // For K%, lower is better for NYM. Otherwise higher = better.
    const nymWins = isKPct ? (nymRaw < oppRaw) : (nymRaw > oppRaw);
    // Progress bar widths: scale both relative to the higher value
    const maxVal = Math.max(nymRaw, oppRaw, 0.001);
    const nymPct = Math.min((nymRaw / (maxVal * 1.25)) * 100, 100) || 50;
    const oppPct = Math.min((oppRaw / (maxVal * 1.25)) * 100, 100) || 50;
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
          <span class="amc-abbr ${!nymWins ? "winner" : ""}">${oppAbbr}</span>
          <span class="amc-val ${!nymWins ? "winner" : ""}">${r.opp}</span>
        </div>
        <div class="amc-bar-track">
          <div class="amc-bar-fill ${!nymWins ? "win" : "lose"}" style="width:${oppPct.toFixed(1)}%"></div>
        </div>
      </div>`;
  }).join("");

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

    <div class="adv-metrics-section">
      <div class="adv-metrics-header">
        <span class="section-floating-label" style="margin:0">Advanced Metrics (2025)</span>
        <span class="adv-edge-tag">&#x2197; Edge: NYM</span>
      </div>
      <div class="adv-metric-cards-grid">
        ${advCards}
      </div>
    </div>`;
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
  if (!game.writeup?.sections?.length) return "";
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
      <div style="font-size:0.9rem">${g.finalScore || "—"}</div>
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

  // Recent results pills
  const resultPills = (games, label) => {
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
      return `<span style="background:${bg};color:${co};font-size:0.72rem;font-weight:800;padding:1px 7px;border-radius:4px;margin-right:6px;">${last}${s}</span>`;
    })();
    const pills = games.slice(0, 5).map(g => {
      const bg = g.result === "W" ? "#22c55e" : "#ef4444";
      const tip = `${g.homeAway === "home" ? "vs" : "@"} ${g.opponent} (${g.date})`;
      return `<span title="${tip}" style="display:inline-block;background:${bg};color:#fff;font-size:0.7rem;font-weight:700;padding:2px 6px;border-radius:3px;margin-right:3px;cursor:default;">${g.result} ${g.score}</span>`;
    }).join("");
    return `<div style="margin-bottom:0.4rem"><span style="font-size:0.72rem;font-weight:700;color:#9099b0;text-transform:uppercase;letter-spacing:0.07em;">${label}</span> ${streak}</div><div>${pills}</div>`;
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
    ? `<span style="background:#dbeafe;color:#1d4ed8;font-size:0.75rem;font-weight:700;padding:3px 10px;border-radius:5px;">Season Series: Mets ${h2h.wins}–${h2h.losses} vs ${oppAbbr}</span>`
    : `<span style="background:#f1f5f9;color:#64748b;font-size:0.75rem;font-weight:600;padding:3px 10px;border-radius:5px;">No prior matchups this season</span>`;

  // Pitcher recent starts mini-table
  const pitcherLogTable = (starts, name) => {
    if (!starts?.length) return "";
    const rows = starts.slice(0, 4).map(s => {
      const er = parseInt(s.er);
      const erColor = isNaN(er) ? "" : er <= 2 ? "color:#15803d;font-weight:700" : er <= 4 ? "color:#92400e;font-weight:700" : "color:#b91c1c;font-weight:700";
      return `<tr>
        <td style="color:#9099b0;font-size:0.75rem">${s.date}</td>
        <td style="font-size:0.78rem">vs ${s.opponent}</td>
        <td style="font-size:0.78rem">${s.ip} IP</td>
        <td style="font-size:0.78rem;${erColor}">${s.er} ER</td>
        <td style="font-size:0.78rem">${s.k} K</td>
        <td style="font-size:0.75rem;font-weight:700;color:${s.result==="W"?"#15803d":s.result==="L"?"#b91c1c":"#9099b0"}">${s.result}</td>
      </tr>`;
    }).join("");
    return `
      <div style="margin-bottom:0.3rem;font-size:0.72rem;font-weight:700;color:#9099b0;text-transform:uppercase;letter-spacing:0.07em;">${name} — Recent Starts</div>
      <div class="table-wrap" style="margin-bottom:0.75rem">
        <table style="font-size:0.8rem">
          <thead><tr><th>Date</th><th>Opp</th><th>IP</th><th>ER</th><th>K</th><th>W/L</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  };

  return `
    <div class="section-floating-label">Game Context</div>
    <div class="card full-card" style="padding:1.25rem">

      <!-- Recent form row -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:1rem;padding-bottom:1rem;border-bottom:1px solid var(--border)">
        <div>
          ${resultPills(gc.metsRecentGames, "Mets Last 5")}
        </div>
        <div>
          ${resultPills(gc.oppRecentGames, `${oppAbbr} Last 5`)}
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

      <!-- Pitcher logs -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem">
        <div>${pitcherLogTable(gc.metsPitcherLog, game.pitching?.mets?.name || "Mets SP")}</div>
        <div>${pitcherLogTable(gc.oppPitcherLog,  game.pitching?.opp?.name  || "Opp SP")}</div>
      </div>

    </div>`;
}

/* ── Team Advanced Stats Card ── */
function buildTeamAdvancedCard(game) {
  const ta = game.teamAdvanced;
  if (!ta?.mets || !ta?.opp) return "";
  const oppAbbr = getTeamAbbr(game.opponent);

  const rows = [
    { label: "wRC+",         mVal: ta.mets.wrcPlus,  oVal: ta.opp.wrcPlus,  higherBetter: true  },
    { label: "xBA",          mVal: ta.mets.xba,       oVal: ta.opp.xba,      higherBetter: true  },
    { label: "OPS",          mVal: ta.mets.ops,        oVal: ta.opp.ops,      higherBetter: true  },
    { label: "Hard-Hit%",    mVal: ta.mets.hardHit,   oVal: ta.opp.hardHit,  higherBetter: true  },
    { label: "K%",           mVal: ta.mets.kPct,      oVal: ta.opp.kPct,     higherBetter: false },
    { label: "Rotation FIP", mVal: ta.mets.rotFip,    oVal: ta.opp.rotFip,   higherBetter: false },
  ].map(r => {
    const fmt = v => (v == null || v === "") ? "—" : String(v);
    const mNum = parseFloat(String(r.mVal ?? ""));
    const oNum = parseFloat(String(r.oVal ?? ""));
    const hasComparison = !isNaN(mNum) && !isNaN(oNum);
    const metsLeads = hasComparison && (r.higherBetter ? mNum > oNum : mNum < oNum);
    const oppLeads  = hasComparison && !metsLeads && mNum !== oNum;
    const mStyle = metsLeads ? "font-weight:700;color:#15803d" : "";
    const oStyle = oppLeads  ? "font-weight:700;color:#b91c1c" : "";
    return `<tr>
      <td>${r.label}</td>
      <td style="${mStyle}">${fmt(r.mVal)}</td>
      <td style="${oStyle}">${fmt(r.oVal)}</td>
      <td>${metsLeads ? "✅ Mets" : oppLeads ? `❌ ${oppAbbr}` : "—"}</td>
    </tr>`;
  }).join("");

  return `
    <div class="section-floating-label">Team Advanced Stats</div>
    <div class="card full-card">
      <div class="card-header">2026 Team Metrics</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Stat</th><th>NYM</th><th>${oppAbbr}</th><th>Edge</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p style="font-size:0.72rem;color:#9099b0;padding:0.5rem 1rem 0.75rem;">Sources: Baseball Savant · MLB Stats API · mets2025.js</p>
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
  const todayGame = games.find(g => g.date === today);

  // Update hero headline — three separate lines
  if (!todayGame) {
    showNoGameTodayState();
  } else {
    const isToday = todayGame.date === today;
    const isFuture = todayGame.date > today;
    const vsAt = todayGame.homeAway === "away" ? "@" : "vs";
    const labelEl = document.getElementById("hero-game-label");
    const dateEl = document.getElementById("hero-game-date");
    const matchupEl = document.getElementById("hero-game-matchup");
    if (labelEl) {
      labelEl.textContent = isToday ? "Today's Game" : isFuture ? "Next Game" : "Latest Game";
    }
    if (dateEl && todayGame.date) {
      dateEl.textContent = new Date(todayGame.date + "T12:00:00")
        .toLocaleDateString("en-US", { month: "long", day: "numeric" });
    }
    if (matchupEl) matchupEl.textContent = `New York Mets ${vsAt} ${todayGame.opponent}`;

  const container = document.getElementById("today-game-container");
  container.innerHTML =
    buildMatchupStrip(todayGame) +            // Row 1 — matchup header
    buildGameBreakdown(todayGame) +           // Row 2 — top-level matchup recap
    buildGameContextCard(todayGame) +         // Row 3 — recent form, injuries, H2H, pitcher logs
    buildPitchingCard(todayGame) +            // Row 4 — starting pitching comparison
    buildRow3(todayGame) +                    // Row 5 — lineups + advanced metrics
    buildTeamAdvancedCard(todayGame) +        // Row 6 — team advanced stats table
    buildAnalysisRow(todayGame) +             // Row 7 — 3 analysis tiles
    buildPickSection(todayGame) +             // Row 8 — pick banner
    buildTrendsCard(todayGame);               // supplemental trends

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
