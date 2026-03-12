const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const axios = require("axios");
const OpenAI = require("openai");
const fs = require("fs");
const { parse } = require("csv-parse/sync");

function getTodayET() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York"
  }); // returns YYYY-MM-DD in ET
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TEAM_ID = 121; // New York Mets

let cachedMets2025 = null;
let cachedSavantLeaderboard2025 = null;
let cachedSavantTeamStats = null;    // Baseball Savant team expected stats
let cachedMlbTeamStats    = null;    // MLB Stats API team batting/pitching
const BALLPARK_COORDS = {
  "Citi Field": { lat: 40.7571, lon: -73.8458 },
  "Yankee Stadium": { lat: 40.8296, lon: -73.9262 },
  "Fenway Park": { lat: 42.3467, lon: -71.0972 },
  "Wrigley Field": { lat: 41.9484, lon: -87.6553 },
  "Busch Stadium": { lat: 38.6226, lon: -90.1928 },
  "Great American Ball Park": { lat: 39.0979, lon: -84.5082 },
  "Dodger Stadium": { lat: 34.0739, lon: -118.2400 },
  "Oracle Park": { lat: 37.7786, lon: -122.3893 },
  "T-Mobile Park": { lat: 47.5914, lon: -122.3325 },
  "Truist Park": { lat: 33.8908, lon: -84.4678 },
  "Citizens Bank Park": { lat: 39.9061, lon: -75.1665 },
  "Globe Life Field": { lat: 32.7473, lon: -97.0825 },
  "American Family Field": { lat: 43.0280, lon: -87.9712 },
  "Chase Field": { lat: 33.4453, lon: -112.0667 },
  "Petco Park": { lat: 32.7076, lon: -117.1570 },
  "loanDepot park": { lat: 25.7781, lon: -80.2197 },
  "Nationals Park": { lat: 38.8730, lon: -77.0074 },
  "Camden Yards": { lat: 39.2838, lon: -76.6218 },
  "PNC Park": { lat: 40.4469, lon: -80.0057 },
  "Kauffman Stadium": { lat: 39.0517, lon: -94.4803 },
  "Target Field": { lat: 44.9817, lon: -93.2781 },
  "Guaranteed Rate Field": { lat: 41.8300, lon: -87.6339 },
  "Progressive Field": { lat: 41.4962, lon: -81.6852 },
  "Comerica Park": { lat: 42.3390, lon: -83.0485 },
  "Rogers Centre": { lat: 43.6414, lon: -79.3894 },
  "Tropicana Field": { lat: 27.7683, lon: -82.6534 },
  "Oakland Coliseum": { lat: 37.7516, lon: -122.2005 },
  "Minute Maid Park": { lat: 29.7572, lon: -95.3555 },
  "Angel Stadium": { lat: 33.8003, lon: -117.8827 },
  "Coors Field": { lat: 39.7559, lon: -104.9942 },
  "Roger Dean Chevrolet Stadium": { lat: 26.8912, lon: -80.1262 }
};

function isMissingStat(value) {
  return value == null || value === "" || value === "N/A";
}

function firstPresent(...values) {
  for (const value of values) {
    if (!isMissingStat(value)) return value;
  }
  return "N/A";
}

function inningsToOuts(ip) {
  if (ip == null || ip === "") return 0;
  const [whole, frac = "0"] = String(ip).split(".");
  return (parseInt(whole, 10) || 0) * 3 + (parseInt(frac, 10) || 0);
}

function outsToInnings(outs) {
  const whole = Math.floor(outs / 3);
  const frac = outs % 3;
  return `${whole}.${frac}`;
}

// ─────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────

async function loadMets2025() {
  if (cachedMets2025) return cachedMets2025;
  const dataPath = path.join(__dirname, "../public/data/mets2025.js");
  const source = fs.readFileSync(dataPath, "utf8");
  const match = source.match(/const METS_2025 = ([\s\S]*);\s*export default METS_2025;/);
  if (!match) throw new Error("Unable to parse METS_2025 fallback data.");
  cachedMets2025 = Function(`return (${match[1]});`)();
  return cachedMets2025;
}

async function loadSavantPitcherLeaderboard2025() {
  if (cachedSavantLeaderboard2025) return cachedSavantLeaderboard2025;
  const url =
    "https://baseballsavant.mlb.com/leaderboard/custom" +
    "?type=pitcher" +
    "&year=2025" +
    "&selections=player_name,player_id,k_percent,bb_percent,whiff_percent,oz_swing_percent,barrel_batted_rate,hard_hit_percent,gb_percent,xera" +
    "&sort=player_name&sortDir=asc&min=0&csv=true";

  const res = await axios.get(url, { timeout: 15000, responseType: "text" });
  const rows = parse(res.data, { columns: true, skip_empty_lines: true, relax_quotes: true });
  cachedSavantLeaderboard2025 = rows;
  return rows;
}

// ── Baseball Savant team expected stats (xBA, xwOBA, Hard-Hit%, Barrel%) ──
async function loadSavantTeamStats(season = "2026") {
  if (cachedSavantTeamStats?.[season]) return cachedSavantTeamStats[season];

  // Try current season first, fall back to 2025 if empty
  for (const yr of [season, "2025"]) {
    try {
      const url =
        "https://baseballsavant.mlb.com/leaderboard/expected_statistics" +
        `?type=team&year=${yr}&position=&team=&min=q&csv=true`;
      const res = await axios.get(url, { timeout: 15000, responseType: "text" });
      const rows = parse(res.data, { columns: true, skip_empty_lines: true, relax_quotes: true });
      if (rows && rows.length > 0) {
        console.log(`  Savant team stats loaded (${yr}), ${rows.length} teams`);
        if (!cachedSavantTeamStats) cachedSavantTeamStats = {};
        cachedSavantTeamStats[season] = { rows, yr };
        return cachedSavantTeamStats[season];
      }
    } catch (err) {
      console.warn(`  [warn] Savant team stats (${yr}) failed: ${err.message}`);
    }
  }
  return null;
}

// ── MLB Stats API team batting + pitching stats ──
async function loadMlbTeamStats(teamId, season = "2026") {
  const cacheKey = `${teamId}-${season}`;
  if (cachedMlbTeamStats?.[cacheKey]) return cachedMlbTeamStats[cacheKey];

  const [hitting, pitching] = await Promise.all([
    safeGet(
      `https://statsapi.mlb.com/api/v1/teams/${teamId}/stats?stats=season&group=hitting&season=${season}`,
      `MLB team hitting ${teamId} ${season}`
    ),
    safeGet(
      `https://statsapi.mlb.com/api/v1/teams/${teamId}/stats?stats=season&group=pitching&season=${season}`,
      `MLB team pitching ${teamId} ${season}`
    )
  ]);

  // Fall back to 2025 if 2026 has no splits yet
  const hSplits = hitting?.stats?.[0]?.splits;
  const pSplits = pitching?.stats?.[0]?.splits;

  let hStat = hSplits?.[0]?.stat || null;
  let pStat = pSplits?.[0]?.stat || null;

  if (!hStat && season === "2026") {
    const fb = await safeGet(
      `https://statsapi.mlb.com/api/v1/teams/${teamId}/stats?stats=season&group=hitting&season=2025`,
      `MLB team hitting ${teamId} 2025 fallback`
    );
    hStat = fb?.stats?.[0]?.splits?.[0]?.stat || null;
  }
  if (!pStat && season === "2026") {
    const fb = await safeGet(
      `https://statsapi.mlb.com/api/v1/teams/${teamId}/stats?stats=season&group=pitching&season=2025`,
      `MLB team pitching ${teamId} 2025 fallback`
    );
    pStat = fb?.stats?.[0]?.splits?.[0]?.stat || null;
  }

  if (!hStat && !pStat) return null;

  const pa   = hStat?.plateAppearances || 0;
  const kPct = pa > 0
    ? ((hStat.strikeOuts / pa) * 100).toFixed(1)
    : null;

  const result = {
    ops:          hStat?.ops   ?? null,
    avg:          hStat?.avg   ?? null,
    obp:          hStat?.obp   ?? null,
    slg:          hStat?.slg   ?? null,
    kPct,
    era:          pStat?.era   ?? null,
    whip:         pStat?.whip  ?? null,
  };

  console.log(`  MLB team stats loaded for ${teamId}: OPS ${result.ops}, K% ${result.kPct}`);
  if (!cachedMlbTeamStats) cachedMlbTeamStats = {};
  cachedMlbTeamStats[cacheKey] = result;
  return result;
}

// ── Recent team game results (last N completed games before a date) ──
async function getTeamRecentGames(teamId, beforeDate, n = 5) {
  // Walk back up to 20 days to collect N completed games
  const end   = new Date(beforeDate + "T12:00:00");
  const start = new Date(end);
  start.setDate(start.getDate() - 20);
  const startStr = start.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const endStr   = new Date(end.getTime() - 86400000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  const url =
    `https://statsapi.mlb.com/api/v1/schedule` +
    `?sportId=1&teamId=${teamId}&startDate=${startStr}&endDate=${endStr}` +
    `&hydrate=linescore,decisions&gameType=R,S`;
  const data = await safeGet(url, `recent games team ${teamId}`);
  if (!data?.dates) return [];

  const results = [];
  const allDates = [...data.dates].reverse(); // newest first
  for (const dt of allDates) {
    for (const g of dt.games) {
      const state = g.status?.detailedState || "";
      if (!["Final", "Completed Early", "Game Over"].includes(state)) continue;
      const isHome = g.teams.home.team.id === teamId;
      const myTeam  = isHome ? g.teams.home : g.teams.away;
      const oppTeam = isHome ? g.teams.away : g.teams.home;
      const won = (myTeam.score ?? 0) > (oppTeam.score ?? 0);
      results.push({
        date:     dt.date,
        homeAway: isHome ? "home" : "road",
        opponent: oppTeam.team.name,
        score:    `${myTeam.score ?? "?"}–${oppTeam.score ?? "?"}`,
        result:   won ? "W" : "L",
        winningPitcher: g.decisions?.winner?.fullName  || null,
        losingPitcher:  g.decisions?.loser?.fullName   || null,
      });
      if (results.length >= n) break;
    }
    if (results.length >= n) break;
  }
  return results;
}

// ── Team injuries from MLB Stats API ──
async function getTeamInjuries(teamId) {
  const url = `https://statsapi.mlb.com/api/v1/injuries?sportId=1&season=${new Date().getFullYear()}`;
  const data = await safeGet(url, `injuries team ${teamId}`);
  if (!data?.injuries) return [];
  return data.injuries
    .filter(i => i.team?.id === teamId)
    .map(i => ({
      name:       i.person?.fullName || "Unknown",
      status:     i.status           || "IL",
      description: i.notes           || null,
    }));
}

// ── Pitcher recent game log (last N starts) ──
async function getPitcherRecentStarts(mlbId, n = 4) {
  if (!mlbId) return [];
  const season = new Date().getFullYear();
  const url =
    `https://statsapi.mlb.com/api/v1/people/${mlbId}/stats` +
    `?stats=gameLog&group=pitching&season=${season}&gameType=R,S`;
  const data = await safeGet(url, `pitcher game log ${mlbId}`);
  const splits = data?.stats?.[0]?.splits || [];
  // Newest first; take last N starts (GS > 0)
  const starts = splits.filter(s => (s.stat?.gamesStarted ?? 0) > 0).slice(-n).reverse();
  return starts.map(s => ({
    date:     s.date,
    opponent: s.opponent?.name || "?",
    ip:       s.stat?.inningsPitched || "?",
    er:       s.stat?.earnedRuns     ?? "?",
    h:        s.stat?.hits           ?? "?",
    bb:       s.stat?.baseOnBalls    ?? "?",
    k:        s.stat?.strikeOuts     ?? "?",
    era:      s.stat?.era            || null,
    result:   s.stat?.wins > 0 ? "W" : s.stat?.losses > 0 ? "L" : "ND",
  }));
}

// ── Head-to-head results this season between two teams ──
async function getHeadToHead(teamId, oppTeamId, season) {
  const url =
    `https://statsapi.mlb.com/api/v1/schedule` +
    `?sportId=1&teamId=${teamId}&season=${season}&gameType=R` +
    `&hydrate=linescore`;
  const data = await safeGet(url, `h2h schedule ${teamId}`);
  if (!data?.dates) return { wins: 0, losses: 0, games: [] };

  let wins = 0, losses = 0;
  const games = [];
  for (const dt of data.dates) {
    for (const g of dt.games) {
      const ht = g.teams.home.team.id;
      const at = g.teams.away.team.id;
      if (ht !== oppTeamId && at !== oppTeamId) continue;
      const state = g.status?.detailedState || "";
      if (!["Final", "Completed Early", "Game Over"].includes(state)) continue;
      const isHome = g.teams.home.team.id === teamId;
      const myScore  = isHome ? (g.teams.home.score ?? 0) : (g.teams.away.score ?? 0);
      const oppScore = isHome ? (g.teams.away.score ?? 0) : (g.teams.home.score ?? 0);
      const won = myScore > oppScore;
      if (won) wins++; else losses++;
      games.push({ date: dt.date, result: won ? "W" : "L", score: `${myScore}–${oppScore}` });
    }
  }
  return { wins, losses, games: games.slice(-5) }; // last 5 matchups for context
}

async function safeGet(url, label) {
  try {
    const res = await axios.get(url, { timeout: 10000 });
    return res.data;
  } catch (err) {
    console.warn(`  [warn] ${label} fetch failed: ${err.message}`);
    return null;
  }
}

function loadPreviousOutput() {
  try {
    const jsonPath = path.join(__dirname, "../public/data/sample-game.json");
    return JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// STEP 1 — Find next Mets game (today + up to 7 days)
// ─────────────────────────────────────────────

async function findNextGame(startDate) {
  for (let i = 0; i < 7; i++) {
    const checkDate = new Date(startDate + "T12:00:00");
    checkDate.setDate(checkDate.getDate() + i);
    const dateStr = checkDate.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const url =
      `https://statsapi.mlb.com/api/v1/schedule` +
      `?sportId=1&teamId=${TEAM_ID}&date=${dateStr}` +
      `&hydrate=team,linescore,probablePitcher`;
    const data = await safeGet(url, `schedule ${dateStr}`);
    const games = data?.dates?.[0]?.games;
    if (games && games.length > 0) {
      const g = games[0];
      const isHome = g.teams.home.team.id === TEAM_ID;
      const oppName = isHome ? g.teams.away.team.name : g.teams.home.team.name;
      if (i === 0) {
        console.log(`Game found today (${dateStr}): Mets vs ${oppName}`);
      } else {
        console.log(`No game today. Next game found: ${dateStr} vs ${oppName}`);
      }
      return { game: g, date: dateStr };
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// STEP 2 — Live game feed (lineups + handedness)
// ─────────────────────────────────────────────

async function getGameFeed(gamePk) {
  if (!gamePk) return null;
  const url = `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;
  const data = await safeGet(url, `game feed (${gamePk})`);
  return data || null;
}

function extractPitcherHand(feed, pitcherId, side) {
  // Try live boxscore first (available pre/during game)
  if (feed && pitcherId) {
    const players = feed.liveData?.boxscore?.teams?.[side]?.players || {};
    const entry = players[`ID${pitcherId}`];
    if (entry?.pitchHand?.code) return entry.pitchHand.code;
    // Also check gameData.probablePitchers
    const pp = feed.gameData?.probablePitchers?.[side];
    if (pp?.pitchHand?.code) return pp.pitchHand.code;
  }
  return null;
}

async function getPitcherInfo(pitcherId) {
  if (!pitcherId) return null;
  const data = await safeGet(`https://statsapi.mlb.com/api/v1/people/${pitcherId}`, `pitcher info ${pitcherId}`);
  return data?.people?.[0] || null;
}

function extractLineups(feed, metsIsHome) {
  const empty = { mets: [], opp: [], status: "projected" };
  if (!feed) return empty;

  const teams = feed.liveData?.boxscore?.teams;
  if (!teams) return empty;

  const metsKey = metsIsHome ? "home" : "away";
  const oppKey  = metsIsHome ? "away" : "home";

  function parseTeam(teamData) {
    const order   = teamData.battingOrder || [];
    const players = teamData.players || {};
    if (!order.length) return [];

    return order.map((pid, idx) => {
      const p      = players[`ID${pid}`] || {};
      const person = p.person || {};
      const pos    = p.position || {};
      return {
        order:     idx + 1,
        playerId:  person.id || null,
        name:      person.fullName || "Unknown",
        pos:       pos.abbreviation || "?",
        hand:      p.batSide?.code || "?",
        seasonOPS: "N/A",
        last14OPS: "N/A"
      };
    });
  }

  const metsLineup = parseTeam(teams[metsKey]);
  const oppLineup  = parseTeam(teams[oppKey]);
  const lineupStatus = metsLineup.length > 0 ? "confirmed" : "not_released";

  return {
    mets:        metsLineup,
    opp:         oppLineup,
    lineupStatus
  };
}

// ─────────────────────────────────────────────
// STEP 3 — Pitcher season stats (2026 → 2025 fallback)
// ─────────────────────────────────────────────

async function getPitcherStats(pitcherId, pitcherName) {
  if (!pitcherId) return [];
  for (const season of ["2026", "2025"]) {
    const url =
      `https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats` +
      `?stats=gameLog,season&group=pitching&season=${season}`;
    const data = await safeGet(url, `pitcher stats ${pitcherName || pitcherId} ${season}`);
    const stats = data?.stats || [];
    const seasonSplits = stats.find(s => s.type?.displayName === "season")?.splits || [];
    if (seasonSplits.length > 0) {
      console.log(`  ${pitcherName || pitcherId}: using ${season} stats`);
      return stats;
    }
  }
  console.warn(`  ${pitcherName || pitcherId}: no stats found for 2026 or 2025`);
  return [];
}

function extractPitcherSummary(statsData) {
  const season  = statsData.find(s => s.type?.displayName === "season");
  const gamelog = statsData.find(s => s.type?.displayName === "gameLog");
  const s       = season?.splits?.[0]?.stat || {};

  // K/BB ratio computed from raw totals (MLB API doesn't expose FIP directly)
  const kbb = s.strikeOuts > 0 && s.baseOnBalls > 0
    ? (s.strikeOuts / s.baseOnBalls).toFixed(2)
    : s.strikeoutWalkRatio || "N/A";

  // Last 3 starts ERA from game log
  const last3 = gamelog?.splits?.slice(-3) || [];
  let last3ERA = "N/A";
  let last3WHIP = "N/A";
  let last3IP = "N/A";
  if (last3.length > 0) {
    const totalERA = last3.reduce((sum, g) => sum + parseFloat(g.stat.era || 0), 0);
    last3ERA = (totalERA / last3.length).toFixed(2);

    const totalHits = last3.reduce((sum, g) => sum + (g.stat.hits || 0), 0);
    const totalWalks = last3.reduce((sum, g) => sum + (g.stat.baseOnBalls || 0), 0);
    const totalOuts = last3.reduce((sum, g) => sum + inningsToOuts(g.stat.inningsPitched), 0);
    if (totalOuts > 0) {
      last3WHIP = (((totalHits + totalWalks) * 3) / totalOuts).toFixed(2);
      last3IP = outsToInnings(totalOuts);
    }
  }

  // Last 3 FIP-adjacent: K/BB over last 3 starts
  let last3KBB = "N/A";
  if (last3.length > 0) {
    const totalK  = last3.reduce((sum, g) => sum + (g.stat.strikeOuts || 0), 0);
    const totalBB = last3.reduce((sum, g) => sum + (g.stat.baseOnBalls || 0), 0);
    last3KBB = totalBB > 0 ? (totalK / totalBB).toFixed(2) : "N/A";
  }

  const battersFaced = s.battersFaced || 0;
  const strikeOuts = s.strikeOuts || 0;
  const walks = s.baseOnBalls || 0;
  const groundOuts = s.groundOuts || 0;
  const airOuts = s.airOuts || 0;
  const gamesStarted = s.gamesStarted || 0;

  return {
    seasonRecord: gamesStarted > 0 ? `${s.wins || 0}-${s.losses || 0}` : "N/A",
    seasonERA:  s.era  || "N/A",
    seasonFIP:  "N/A", // Not available from MLB Stats API; GPT may supplement
    seasonWHIP: s.whip || "N/A",
    seasonHR9:  s.homeRunsPer9 || "N/A",
    seasonKBB:  kbb,
    seasonKPct: battersFaced > 0 ? ((strikeOuts / battersFaced) * 100).toFixed(1) + "%" : "N/A",
    seasonBBPct: battersFaced > 0 ? ((walks / battersFaced) * 100).toFixed(1) + "%" : "N/A",
    seasonGBPct: (groundOuts + airOuts) > 0 ? ((groundOuts / (groundOuts + airOuts)) * 100).toFixed(1) + "%" : "N/A",
    last3ERA,
    last3WHIP,
    last3IP,
    last3KBB,
    note: gamesStarted > 0
      ? `${season?.splits?.[0]?.season || "Current"} — ${s.inningsPitched || "0.0"} IP, ${strikeOuts} K, ${walks} BB`
      : ""
  };
}

async function getHitterStats(playerId, playerName) {
  if (!playerId) return null;
  for (const season of ["2026", "2025"]) {
    const url =
      `https://statsapi.mlb.com/api/v1/people/${playerId}/stats` +
      `?stats=season&group=hitting&season=${season}`;
    const data = await safeGet(url, `hitter stats ${playerName} ${season}`);
    const splits = data?.stats?.[0]?.splits || [];
    if (splits.length > 0) {
      const s = splits[0].stat;
      console.log(`  ${playerName}: using ${season} hitting stats`);
      return {
        seasonAVG: s.avg ?? "N/A",
        seasonOPS: s.ops ?? "N/A",
        seasonHR: s.homeRuns ?? "N/A",
        seasonAB: s.atBats ?? "N/A",
        seasonH: s.hits ?? "N/A",
        seasonSeason: season
      };
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// STEP 3b — Baseball Savant stats via CSV
// ─────────────────────────────────────────────

async function getSavantStats(mlbId, name) {
  if (!mlbId) return null;
  try {
    const rows = await loadSavantPitcherLeaderboard2025();
    const row = rows.find(r => String(r.player_id) === String(mlbId));
    if (!row) return null;
    const fmtPct = v => !isMissingStat(v) ? `${parseFloat(v).toFixed(1)}%` : "N/A";
    const fmtNum = v => !isMissingStat(v) ? parseFloat(v).toFixed(2) : "N/A";

    console.log(`  Savant stats fetched for ${name || mlbId}`);
    return {
      xERA: fmtNum(row.xera),
      barrelPct: fmtPct(row.barrel_batted_rate),
      hardHitPct: fmtPct(row.hard_hit_percent),
      whiffPct: fmtPct(row.whiff_percent),
      chasePct: fmtPct(row.oz_swing_percent),
      kPct: fmtPct(row.k_percent),
      bbPct: fmtPct(row.bb_percent),
      gbPct: fmtPct(row.gb_percent)
    };
  } catch (err) {
    console.warn(`  [warn] Savant stats for ${name || mlbId} failed: ${err.message}`);
    return null;
  }
}

function mergeSavantStats(current, previous, summary) {
  return {
    xERA: firstPresent(current?.xERA, previous?.xERA),
    barrelPct: firstPresent(current?.barrelPct, previous?.barrelPct),
    hardHitPct: firstPresent(current?.hardHitPct, previous?.hardHitPct),
    whiffPct: firstPresent(current?.whiffPct, previous?.whiffPct),
    chasePct: firstPresent(current?.chasePct, previous?.chasePct),
    kPct: firstPresent(current?.kPct, summary?.seasonKPct, previous?.kPct),
    bbPct: firstPresent(current?.bbPct, summary?.seasonBBPct, previous?.bbPct),
    gbPct: firstPresent(current?.gbPct, summary?.seasonGBPct, previous?.gbPct)
  };
}

function mergePitcherWithFallbacks(current, previous, starterFallback) {
  const mergedSavant = mergeSavantStats(current.savant, previous?.savant, current);
  return {
    ...current,
    hand: firstPresent(current.hand, previous?.hand),
    seasonRecord: firstPresent(current.seasonRecord, previous?.seasonRecord),
    seasonFIP: firstPresent(current.seasonFIP, previous?.seasonFIP, starterFallback?.FIP),
    seasonXERA: firstPresent(current.seasonXERA, mergedSavant.xERA, previous?.seasonXERA, starterFallback?.xFIP),
    seasonWHIP: firstPresent(current.seasonWHIP, previous?.seasonWHIP, starterFallback?.WHIP),
    seasonHR9: firstPresent(current.seasonHR9, previous?.seasonHR9),
    last3ERA: firstPresent(current.last3ERA, previous?.last3ERA),
    last3FIP: firstPresent(current.last3FIP, previous?.last3FIP),
    last3WHIP: firstPresent(current.last3WHIP, previous?.last3WHIP),
    last3KBB: firstPresent(current.last3KBB, previous?.last3KBB, starterFallback?.KBB),
    last3IP: firstPresent(current.last3IP, previous?.last3IP),
    note: firstPresent(current.note, previous?.note),
    savant: mergedSavant,
    vsRoster: current.vsRoster || previous?.vsRoster || null
  };
}

// ─────────────────────────────────────────────
// STEP 3c — Pitcher vs roster matchup stats (Baseball Savant)
// ─────────────────────────────────────────────

async function getPitcherVsRoster(pitcherMlbId, opponentLineup) {
  if (!pitcherMlbId) return null;
  const rosterIds = opponentLineup.map(p => p.playerId).filter(Boolean);
  if (!rosterIds.length) return null;

  const batterParams = rosterIds.map(id => `batters_lookup[]=${id}`).join("&");
  const url =
    `https://baseballsavant.mlb.com/statcast_search/csv` +
    `?player_type=pitcher&player_id=${pitcherMlbId}` +
    `&${batterParams}` +
    `&game_date_gt=2022-01-01&type=details&group_by=name` +
    `&min_pitches=0&min_results=0&min_pas=0`;

  try {
    const res = await axios.get(url, { timeout: 20000, responseType: "text" });
    const text = res.data;
    if (!text || text.trim().length < 20) return null;

    const rows = parse(text, { columns: true, skip_empty_lines: true, relax_quotes: true });
    if (!rows || rows.length === 0) return null;

    // --- aggregate pitch rows into matchup stats ---
    const toNum = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };

    const paRows    = rows.filter(r => toNum(r.woba_denom) === 1);
    const totalPA   = paRows.length;
    if (totalPA === 0) return null;

    const kRows     = paRows.filter(r => r.events === "strikeout");
    const bbRows    = paRows.filter(r => r.events === "walk" || r.events === "intent_walk");
    const hitEvents = new Set(["single", "double", "triple", "home_run"]);
    const hitRows   = paRows.filter(r => hitEvents.has(r.events));
    const sfRows    = paRows.filter(r => r.events === "sac_fly");
    const hbpRows   = paRows.filter(r => r.events === "hit_by_pitch");
    const AB        = totalPA - bbRows.length - hbpRows.length - sfRows.length;

    const wobaDenomSum = paRows.reduce((s, r) => s + (toNum(r.woba_denom) || 0), 0);
    const wobaValSum   = paRows.reduce((s, r) => s + (toNum(r.woba_value) || 0), 0);

    const xwobaRows = paRows.filter(r => toNum(r.estimated_woba_using_speedangle) !== null);
    const xwobaSum  = xwobaRows.reduce((s, r) => s + toNum(r.estimated_woba_using_speedangle), 0);

    const bipRows    = rows.filter(r => (toNum(r.launch_speed) || 0) > 0);
    const xbaSum     = bipRows.reduce((s, r) => s + (toNum(r.estimated_ba_using_speedangle) || 0), 0);
    const xslgSum    = bipRows.reduce((s, r) => s + (toNum(r.estimated_slg_using_speedangle) || 0), 0);
    const exitVSum   = bipRows.reduce((s, r) => s + (toNum(r.launch_speed) || 0), 0);
    const laSum      = bipRows.reduce((s, r) => s + (toNum(r.launch_angle) || 0), 0);

    const fmt3 = v => v !== null ? +v.toFixed(3) : null;
    const fmt1 = v => v !== null ? +v.toFixed(1) : null;

    console.log(`  vsRoster: pitcher ${pitcherMlbId} vs ${rosterIds.length} batters — ${totalPA} PA`);
    return {
      PA:          totalPA,
      kPct:        fmt3(kRows.length  / totalPA),
      bbPct:       fmt3(bbRows.length / totalPA),
      AVG:         AB > 0 ? fmt3(hitRows.length / AB) : null,
      wOBA:        wobaDenomSum > 0 ? fmt3(wobaValSum / wobaDenomSum) : null,
      xwOBA:       xwobaRows.length > 0 ? fmt3(xwobaSum / xwobaRows.length) : null,
      exitVelo:    bipRows.length > 0 ? fmt1(exitVSum  / bipRows.length) : null,
      launchAngle: bipRows.length > 0 ? fmt1(laSum     / bipRows.length) : null,
      xBA:         bipRows.length > 0 ? fmt3(xbaSum    / bipRows.length) : null,
      xSLG:        bipRows.length > 0 ? fmt3(xslgSum   / bipRows.length) : null,
    };
  } catch (err) {
    console.warn(`  [warn] vsRoster for pitcher ${pitcherMlbId} failed: ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────
// Standings
// ─────────────────────────────────────────────

async function getStandings() {
  const data = await safeGet(
    "https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=2026",
    "standings"
  );
  return data?.records || [];
}

function extractTeamRecord(standings, teamId) {
  for (const division of standings) {
    const team = division.teamRecords?.find(t => t.team.id === teamId);
    if (team) return `${team.wins}-${team.losses}`;
  }
  return "0-0";
}

// ─────────────────────────────────────────────
// STEP 4 — Build structured game context for prompt
// ─────────────────────────────────────────────

function buildGameContext(gameObject) {
  const p = gameObject.pitching;
  const l = gameObject.lineups;

  const fmtLineup = (players, teamLabel) => {
    if (!players || players.length === 0) return `  ${teamLabel}: Lineup not yet posted`;
    return players.map(pl =>
      `  ${pl.order}. ${pl.name} (${pl.pos}, bats ${pl.hand})`
    ).join("\n");
  };

  const fmtPitcher = (pitcher, label) => {
    const parts = [
      `${label}: ${pitcher.name} (${pitcher.hand}HP)`,
      pitcher.seasonERA  !== "N/A" ? `ERA ${pitcher.seasonERA}`  : null,
      pitcher.seasonWHIP !== "N/A" ? `WHIP ${pitcher.seasonWHIP}` : null,
      pitcher.seasonKBB  !== "N/A" ? `K/BB ${pitcher.seasonKBB}`  : null,
      pitcher.last3ERA   !== "N/A" ? `Last-3 ERA ${pitcher.last3ERA}` : null,
    ].filter(Boolean);
    return "  " + parts.join(" | ");
  };

  return `=== VERIFIED GAME DATA — DO NOT MODIFY OR INVENT ===

GAME:    New York Mets vs ${gameObject.opponent}
DATE:    ${gameObject.date}
TIME:    ${gameObject.time}
VENUE:   ${gameObject.ballpark}
STATUS:  Mets ${gameObject.homeAway === "home" ? "at home" : "on the road"}
RECORDS: Mets ${gameObject.metsRecord} | ${gameObject.opponent} ${gameObject.oppRecord}
MONEYLINE (approximate): NYM ${gameObject.moneyline.mets > 0 ? "+" : ""}${gameObject.moneyline.mets} / OPP ${gameObject.moneyline.opp > 0 ? "+" : ""}${gameObject.moneyline.opp}

PROBABLE PITCHERS:
${fmtPitcher(p.mets, "NYM")}
${fmtPitcher(p.opp, `OPP (${gameObject.opponent.split(" ").pop()})`)}

LINEUP STATUS: ${l.status === "confirmed" ? "Confirmed" : "Not yet posted — use projected order if needed"}
NYM BATTING ORDER:
${fmtLineup(l.mets, "NYM")}
${gameObject.opponent.split(" ").pop().toUpperCase()} BATTING ORDER:
${fmtLineup(l.opp, gameObject.opponent.split(" ").pop())}

=== END VERIFIED DATA ===`;
}

// ─────────────────────────────────────────────
// Parse GPT writeup output
// ─────────────────────────────────────────────

function parseWriteup(rawText) {
  const sections = [];
  const lines = rawText.split("\n");
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isHeading =
      /^#{1,3}\s+/.test(trimmed) ||
      /^\*\*[^*]+\*\*$/.test(trimmed) ||
      (trimmed.endsWith(":") && trimmed.length < 60 && !trimmed.includes("."));

    if (isHeading) {
      if (current) sections.push(current);
      const heading = trimmed.replace(/^#+\s*/, "").replace(/\*\*/g, "").replace(/:$/, "").trim();
      current = { heading, body: "" };
    } else if (trimmed.startsWith("PICK_SUMMARY:") || trimmed.startsWith("OFFICIAL_PICK:")) {
      if (current) sections.push(current);
      current = null;
    } else if (current) {
      current.body += (current.body ? " " : "") + trimmed;
    }
  }
  if (current && current.body) sections.push(current);

  const summaryLine = rawText.match(/PICK_SUMMARY:\s*(.+)/);
  return {
    raw: rawText,
    sections: sections.length > 0
      ? sections
      : [{ heading: "Analysis", body: rawText.replace(/OFFICIAL_PICK:.+/, "").trim() }],
    pickSummary:  summaryLine ? summaryLine[1].trim() : "",
    officialPick: "Today's Pick: New York Mets Moneyline"
  };
}

async function getGameWeather(ballparkName, gameDate, gameTimeET) {
  const normalizedBallpark = (ballparkName || "").replace(", Queens NY", "").trim();
  const coords = BALLPARK_COORDS[normalizedBallpark];
  if (!coords) {
    console.warn(`  [warn] No coords found for ballpark: ${ballparkName}`);
    return null;
  }

  const [hour, minutePart] = gameTimeET.replace(" ET", "").split(":");
  const isPM = minutePart?.includes("PM");
  const isAM = minutePart?.includes("AM");
  const minutes = minutePart?.replace(/[APM]/g, "") || "00";
  let gameHour = parseInt(hour, 10);
  if (isPM && gameHour !== 12) gameHour += 12;
  if (isAM && gameHour === 12) gameHour = 0;

  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${coords.lat}&longitude=${coords.lon}` +
    `&hourly=temperature_2m,windspeed_10m,winddirection_10m,precipitation_probability` +
    `&temperature_unit=fahrenheit&windspeed_unit=mph` +
    `&timezone=America%2FNew_York&forecast_days=2`;

  const data = await safeGet(url, `weather for ${ballparkName}`);
  if (!data?.hourly) return null;

  const targetTime = `${gameDate}T${String(gameHour).padStart(2, "0")}:${minutes.padStart(2, "0")}`;
  const idx = data.hourly.time.findIndex(t => t === targetTime);
  if (idx === -1) {
    console.warn(`  [warn] Weather time ${targetTime} not found in forecast`);
    return null;
  }

  const windDir = data.hourly.winddirection_10m[idx];
  const windSpd = data.hourly.windspeed_10m[idx];
  const temp = data.hourly.temperature_2m[idx];
  const precip = data.hourly.precipitation_probability[idx];

  function degToCompass(deg) {
    const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return dirs[Math.round(deg / 22.5) % 16];
  }

  const compass = degToCompass(windDir);
  const hitFriendly = ["S", "SSW", "SW", "WSW", "SSE", "SE"].includes(compass);
  const pitchFriendly = ["N", "NNE", "NE", "ENE", "NNW", "NW"].includes(compass);
  const windImpact = hitFriendly
    ? "blowing out (hitter-friendly)"
    : pitchFriendly
      ? "blowing in (pitcher-friendly)"
      : "blowing across (neutral)";

  console.log(`  Weather: ${temp}°F, wind ${windSpd} mph ${compass} (${windImpact}), precip ${precip}%`);

  return {
    tempF: temp,
    windMph: windSpd,
    windDir: compass,
    windImpact,
    precipPct: precip,
    label: `${temp}°F · Wind ${windSpd} mph ${compass} (${windImpact}) · Rain ${precip}%`
  };
}

// ─────────────────────────────────────────────
// OpenAI call — grounded by verified context
// ─────────────────────────────────────────────

async function generateAnalysis(gameObject) {
  const mets2025 = await loadMets2025();
  const g = gameObject;
  const mp = g.pitching.mets;
  const op = g.pitching.opp;
  const oppName = g.opponent;
  const oppShort = oppName.split(" ").pop();

  function row(...cells) {
    return `| ${cells.join(" | ")} |`;
  }

  function tableHeader(...cols) {
    return [
      row(...cols),
      row(...cols.map(() => "---"))
    ].join("\n");
  }

  function ps(pitcher, key, fallbackKey) {
    const v = pitcher[key];
    if (!isMissingStat(v)) return v;
    const fb = mets2025?.starters?.[pitcher.name];
    return fb?.[fallbackKey] ?? "N/A";
  }

  const pitchingTraditional =
    tableHeader("Pitcher", "Team", "W–L", "ERA", "WHIP", "IP note", "K", "BB", "HR/9") +
    "\n" +
    row(
      mp.name,
      "New York Mets",
      firstPresent(mp.seasonRecord, "N/A"),
      firstPresent(mp.seasonERA, "N/A"),
      firstPresent(mp.seasonWHIP, ps(mp, "seasonWHIP", "WHIP")),
      mp.note || "N/A",
      "N/A",
      "N/A",
      firstPresent(mp.seasonHR9, "N/A")
    ) +
    "\n" +
    row(
      op.name,
      oppName,
      firstPresent(op.seasonRecord, "N/A"),
      firstPresent(op.seasonERA, "N/A"),
      firstPresent(op.seasonWHIP, "N/A"),
      op.note || "N/A",
      "N/A",
      "N/A",
      firstPresent(op.seasonHR9, "N/A")
    );

  const mSavant = mp.savant || {};
  const oSavant = op.savant || {};
  const pitchingAdvanced =
    tableHeader("Pitcher", "FIP", "xERA", "K%", "BB%", "K/BB", "Hard-Hit%", "Barrel%", "Last 3 ERA") +
    "\n" +
    row(
      mp.name,
      firstPresent(mp.seasonFIP, ps(mp, "seasonFIP", "FIP")),
      firstPresent(mp.seasonXERA, mSavant.xERA, "N/A"),
      firstPresent(mSavant.kPct, "N/A"),
      firstPresent(mSavant.bbPct, "N/A"),
      firstPresent(mp.last3KBB, mp.seasonKBB, "N/A"),
      firstPresent(mSavant.hardHitPct, "N/A"),
      firstPresent(mSavant.barrelPct, "N/A"),
      firstPresent(mp.last3ERA, "N/A")
    ) +
    "\n" +
    row(
      op.name,
      firstPresent(op.seasonFIP, "N/A"),
      firstPresent(op.seasonXERA, oSavant.xERA, "N/A"),
      firstPresent(oSavant.kPct, "N/A"),
      firstPresent(oSavant.bbPct, "N/A"),
      firstPresent(op.last3KBB, op.seasonKBB, "N/A"),
      firstPresent(oSavant.hardHitPct, "N/A"),
      firstPresent(oSavant.barrelPct, "N/A"),
      firstPresent(op.last3ERA, "N/A")
    );

  const metsLineup = g.lineups.mets.slice(0, 9);
  const oppLineup = g.lineups.opp.slice(0, 9);
  const maxLen = Math.max(metsLineup.length, oppLineup.length, 9);

  let lineupTable = tableHeader("#", "NYM Player", "Pos", "AVG", "xBA", "OPS", "HR", "", "OPP Player", "Pos", "AVG", "xBA", "OPS", "HR") + "\n";
  for (let i = 0; i < maxLen; i++) {
    const m = metsLineup[i];
    const o = oppLineup[i];
    const mFb = m ? (mets2025?.hitters?.[m.name] || {}) : {};
    const mAvg = m ? firstPresent(m.seasonAVG, mFb.AVG, "N/A") : "—";
    const mOps = m ? firstPresent(m.seasonOPS, mFb.OPS, "N/A") : "—";
    const mHr = m ? firstPresent(m.seasonHR, mFb.HR, "N/A") : "—";
    const oAvg = o ? firstPresent(o.seasonAVG, "N/A") : "—";
    const oOps = o ? firstPresent(o.seasonOPS, "N/A") : "—";
    const oHr = o ? firstPresent(o.seasonHR, "N/A") : "—";
    const mAvgLabel = m?.statsSeason === "2025" ? `${mAvg} (2025)` : mAvg;
    const mOpsLabel = m?.statsSeason === "2025" ? `${mOps} (2025)` : mOps;
    const mHrLabel = m?.statsSeason === "2025" ? `${mHr} (2025)` : mHr;
    const oAvgLabel = o?.statsSeason === "2025" ? `${oAvg} (2025)` : oAvg;
    const oOpsLabel = o?.statsSeason === "2025" ? `${oOps} (2025)` : oOps;
    const oHrLabel = o?.statsSeason === "2025" ? `${oHr} (2025)` : oHr;
    lineupTable += row(
      i + 1,
      m?.name ?? "—",
      m?.pos ?? "—",
      mAvgLabel,
      "N/A",
      mOpsLabel,
      mHrLabel,
      "|",
      o?.name ?? "—",
      o?.pos ?? "—",
      oAvgLabel,
      "N/A",
      oOpsLabel,
      oHrLabel
    ) + "\n";
  }

  const mb = g.pitching.metsBullpen;
  const ob = g.pitching.oppBullpen;
  const bullpenTable =
    tableHeader("Team", "ERA", "xFIP", "Last 14d ERA", "Last 3d IP", "Rating") +
    "\n" +
    row(
      "New York Mets",
      firstPresent(mb.seasonERA, mets2025?.bullpenERA, "N/A"),
      firstPresent(mb.seasonXFIP, mets2025?.bullpenxFIP, "N/A"),
      firstPresent(mb.last14ERA, "N/A"),
      firstPresent(mb.last3DaysIP, "N/A"),
      mb.rating ? `${mb.rating}/100` : "70/100"
    ) +
    "\n" +
    row(
      oppName,
      firstPresent(ob.seasonERA, "N/A"),
      firstPresent(ob.seasonXFIP, "N/A"),
      firstPresent(ob.last14ERA, "N/A"),
      firstPresent(ob.last3DaysIP, "N/A"),
      ob.rating ? `${ob.rating}/100` : "65/100"
    );

  const mWRC = mets2025?.teamWRC_plus ?? "N/A";
  const mOPS = mets2025?.teamOPS ?? "N/A";
  const mHH = mets2025?.hardHitPct ?? "N/A";
  const mBRL = mets2025?.barrelPct ?? "N/A";
  const mKPct = mets2025?.kPct ?? "N/A";
  const mBBPct = mets2025?.bbPct ?? "N/A";

  const oppStats = mets2025?.opponents2025?.[oppName] || {};
  const oWRC = oppStats.teamWRC_plus ?? "N/A";
  const oOPS = oppStats.teamOPS ?? "N/A";

  function bar(val, max, width = 10) {
    if (val === "N/A" || isNaN(val)) return "N/A";
    const filled = Math.round((val / max) * width);
    return "█".repeat(Math.max(0, filled)) + "░".repeat(Math.max(0, width - filled));
  }

  const offenseBars = [
    `wRC+:     New York Mets ${bar(mWRC, 140)} ${mWRC}   ${oppShort} ${bar(oWRC, 140)} ${oWRC}`,
    `OPS:      New York Mets ${bar(mOPS * 1000, 900)} ${mOPS}  ${oppShort} ${bar((oOPS || 0) * 1000, 900)} ${oOPS}`,
    `Hard-Hit: New York Mets ${bar(mHH, 50)} ${mHH}%  ${oppShort} N/A`,
    `Barrel%:  New York Mets ${bar(mBRL, 15)} ${mBRL}%  ${oppShort} N/A`,
    `K%:       New York Mets ${bar(mKPct, 30)} ${mKPct}%  ${oppShort} N/A`,
    `BB%:      New York Mets ${bar(mBBPct, 15)} ${mBBPct}%  ${oppShort} N/A`,
  ].join("\n");

  const mVs = mp.vsRoster;
  const oVs = op.vsRoster;
  const vsRosterSection = (mVs || oVs) ? `
PITCHER VS CURRENT ROSTER (career Statcast):
${mp.name} vs ${oppShort} lineup: ${mVs ? `${mVs.PA} PA | AVG ${mVs.AVG ?? "N/A"} | wOBA ${mVs.wOBA ?? "N/A"} | xwOBA ${mVs.xwOBA ?? "N/A"} | Exit Velo ${mVs.exitVelo ?? "N/A"} | xBA ${mVs.xBA ?? "N/A"}` : "No prior matchup data."}
${op.name} vs Mets lineup: ${oVs ? `${oVs.PA} PA | AVG ${oVs.AVG ?? "N/A"} | wOBA ${oVs.wOBA ?? "N/A"} | xwOBA ${oVs.xwOBA ?? "N/A"} | Exit Velo ${oVs.exitVelo ?? "N/A"} | xBA ${oVs.xBA ?? "N/A"}` : "No prior matchup data."}
` : "";

  const baselineLines = [];
  const newSigningsLines = [];
  if (mets2025?.starters?.[mp.name]) {
    const s = mets2025.starters[mp.name];
    baselineLines.push(`${mp.name}: ERA ${s.ERA}, FIP ${s.FIP}, xFIP ${s.xFIP}, WHIP ${s.WHIP}, K/BB ${s.KBB}`);
  }
  for (const hitter of g.lineups?.mets || []) {
    const h = mets2025?.hitters?.[hitter.name];
    if (h) baselineLines.push(`${hitter.name}: AVG ${h.AVG}, OPS ${h.OPS}, wRC+ ${h.wRC_plus}, HR ${h.HR}`);
    else if (!isMissingStat(hitter.seasonAVG) || !isMissingStat(hitter.seasonOPS) || !isMissingStat(hitter.seasonHR)) {
      newSigningsLines.push(`${hitter.name}: ${hitter.statsSeason ?? "2025"} AVG ${firstPresent(hitter.seasonAVG, "N/A")}, OPS ${firstPresent(hitter.seasonOPS, "N/A")}, HR ${firstPresent(hitter.seasonHR, "N/A")}`);
    }
  }
  const baselineSection = baselineLines.length
    ? `2025 BASELINE (use where 2026 data is unavailable; label as 2025 in your output):\n${baselineLines.join("\n")}\n\n`
    : "";
  const newSigningsContext = newSigningsLines.length ? `${newSigningsLines.join("\n")}\n\n` : "";

  const systemMessage = `You are a daily baseball analyst who writes data-driven Mets game previews for a serious audience of fans and bettors.

VOICE:
- Modern beat writer with a heavy analytics bias.
- Short sentences. 1–3 per paragraph max.
- No hype, no clichés, no filler.
- Factual and direct. Confident but not sycophantic.
- Alternate between full city name and team nickname for flow (e.g. "New York" and "Mets"). Never use abbreviations like NYM or STL in prose.

RULES:
- Only use facts, names, and stats from the context you are given.
- Never invent stats, streaks, injuries, or quotes.
- If a stat is listed as N/A, do not use it or make one up.
- If 2025 baseline stats are provided for a player or team, you may reference them but must label them as 2025 figures.
- Include relevant news and context from the NEWS ITEMS block if provided.
- Reuse all provided Markdown tables exactly as given — do not alter them.
- Do not use betting verbs: no "bet", "wager", "fade", "hammer", "lock."
- Always conclude New York wins. Do not hedge.

OUTPUT FORMAT:
You must output valid Markdown following the 6-section structure below exactly.
Do not add sections. Do not skip sections. Do not rename sections.`;

  // ── Format game context for GPT ──
  const gc = g.gameContext || {};

  function fmtRecentGames(games, teamLabel) {
    if (!games?.length) return `${teamLabel}: No recent game data available.`;
    const streak = (() => {
      let s = 0, last = null;
      for (const gm of games) {
        if (last === null) { last = gm.result; s = 1; }
        else if (gm.result === last) s++;
        else break;
      }
      return `${last === "W" ? "W" : "L"}${s}`;
    })();
    const lines = games.map(gm =>
      `  ${gm.result} ${gm.score} ${gm.homeAway === "home" ? "vs" : "@"} ${gm.opponent} (${gm.date})`
    ).join("\n");
    return `${teamLabel} [Current streak: ${streak}]:\n${lines}`;
  }

  function fmtInjuries(injuries, teamLabel) {
    if (!injuries?.length) return `${teamLabel}: No active IL listings found.`;
    return `${teamLabel}:\n` + injuries.map(i =>
      `  ${i.name} — ${i.status}${i.description ? ` (${i.description})` : ""}`
    ).join("\n");
  }

  function fmtPitcherLog(starts, name) {
    if (!starts?.length) return `${name}: No recent start data available.`;
    const lines = starts.map(s =>
      `  ${s.date} vs ${s.opponent}: ${s.ip} IP, ${s.er} ER, ${s.h} H, ${s.bb} BB, ${s.k} K (${s.result})`
    ).join("\n");
    return `${name} — last ${starts.length} starts:\n${lines}`;
  }

  function fmtHeadToHead(h2h, oppName) {
    if (!h2h || (h2h.wins + h2h.losses === 0)) return `Head-to-head vs ${oppName}: No games played yet this season.`;
    const recent = h2h.games.map(g => `${g.result} ${g.score} (${g.date})`).join(", ");
    return `Head-to-head vs ${oppName} this season: Mets ${h2h.wins}–${h2h.losses}\nRecent: ${recent}`;
  }

  const contextBlock = `
RECENT RESULTS (last 5 games, newest first):
${fmtRecentGames(gc.metsRecentGames, "New York Mets")}

${fmtRecentGames(gc.oppRecentGames, oppName)}

INJURY REPORT:
${fmtInjuries(gc.metsInjuries, "New York Mets")}
${fmtInjuries(gc.oppInjuries, oppName)}

PITCHER RECENT STARTS:
${fmtPitcherLog(gc.metsPitcherLog, mp.name || "Mets SP")}

${fmtPitcherLog(gc.oppPitcherLog, op.name || "Opp SP")}

${fmtHeadToHead(gc.headToHead, oppName)}
`.trim();

  const userMessage = `${buildGameContext(g)}

${baselineSection}TRADITIONAL PITCHING TABLE (include this unchanged under Section 2):
${pitchingTraditional}

ADVANCED PITCHING TABLE (include this unchanged under Section 2):
${pitchingAdvanced}

${vsRosterSection}LINEUP TABLE (include this unchanged under Section 3):
${lineupTable}

BULLPEN TABLE (include this unchanged under Section 4):
${bullpenTable}

OFFENSE BARS (include these unchanged under Section 5):
${offenseBars}

NEW SIGNINGS / OFFSEASON ROSTER (2025 stats from prior team — use as context for their expected production profile):
${newSigningsContext || "[No additional offseason roster context provided.]"}

WEATHER AT GAME TIME:
${g.weather ? g.weather.label : "Dome/weather unavailable"}

${contextBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Write the email now using EXACTLY this structure:

SUBJECT: MetsMoneyline — [Full date, e.g. March 27]: New York Mets vs [Full opponent name]

# New York Mets vs ${oppName}
[date] · [venue] · [time] ET

## 1. Game Preview
[5–7 sentences total split across these areas — use only data provided above, do not invent:]
- Schedule context: Is this a home stand opener or closer? Road trip game number? Back-to-back or well-rested? Reference the homeAway status and records.
- Recent form: Cite actual W/L results and scores from RECENT RESULTS above. Name the current streak. If early in the season and no results yet, note it's an early-season game and pivot to offseason narrative (roster moves, expectations, lineup construction).
- Injuries: Mention any notable IL players from the INJURY REPORT that affect today's lineup or rotation. Skip minor or irrelevant listings.
- Head-to-head: If H2H data exists and is non-zero, cite the season series record. If no games played yet, acknowledge it's their first meeting of the season.
- Early-season note (only if fewer than 10 games played): Briefly note one or two lineup changes, new signings, or storylines from the offseason that are relevant to today's game.

## 2. Pitching Matchup
[For each starter write 2–3 sentences of analytical commentary using ONLY the data above. Cover:]
- Recent form trajectory: Is ERA trending up or down vs. FIP/xERA? Reference specific starts from PITCHER RECENT STARTS if available.
- Key edge or vulnerability: What does the advanced profile say? High K% but elevated BB%? FIP well below ERA suggesting outperformance due soon? Hard-Hit% or Barrel% concern?
- Matchup angle: How does this pitcher profile match up against today's opposing lineup based on K%, contact quality, or handedness?
[Then include both pitching tables exactly as provided — do not alter them.]

## 3. Lineup Comparison
[2–4 short sentences: notable absences from injury report, rest days, call-ups, hot/cold streaks with stats. Then include the lineup table exactly as provided.]

## 4. Bullpen
[2–3 short sentences: recent workload, who is likely down or unavailable, closer status. Then include the bullpen table exactly as provided. If closer data is available add a closer row.]

## 5. Key Edges
[Bullet list only. 4–6 bullets. Each bullet is one analytical edge backed by a specific stat. Cover a mix of: pitching profile edge, offensive quality of contact, bullpen depth, schedule/rest, recent form, park factors, historical splits if available. If wind is >= 12 mph blowing out, note it as a power/HR environment. If wind is >= 12 mph blowing in, note it as a pitcher-friendly suppression factor. Always include temp and precip probability if available.]

## 6. Today's Pick
[2–3 sentences referencing the strongest edges from above.]

**Today's Pick: New York Mets Moneyline**

PICK_SUMMARY: [Copy the 2–3 sentence pick reasoning here as a single line]
OFFICIAL_PICK: Today's Pick: New York Mets Moneyline`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemMessage },
      { role: "user", content: userMessage }
    ],
    max_tokens: 1800,
    temperature: 0.5
  });

  return response.choices[0].message.content;
}

// ─────────────────────────────────────────────
// Assemble full game object
// ─────────────────────────────────────────────

async function buildGameObject(game, standings, isGameDay, previousGame, mets2025) {
  const isHome   = game.teams.home.team.id === TEAM_ID;
  const metsTeam = isHome ? game.teams.home : game.teams.away;
  const oppTeam  = isHome ? game.teams.away : game.teams.home;

  const metsPitcherRaw = metsTeam.probablePitcher || null;
  const oppPitcherRaw  = oppTeam.probablePitcher  || null;
  const metsAnnounced  = !!(metsPitcherRaw?.id);
  const oppAnnounced   = !!(oppPitcherRaw?.id);

  // STEP 2: Live feed for lineups + pitcher handedness
  console.log(`Fetching live game feed (gamePk: ${game.gamePk})...`);
  const feed = await getGameFeed(game.gamePk);

  const metsHand = extractPitcherHand(feed, metsPitcherRaw?.id, isHome ? "home" : "away");
  const oppHand  = extractPitcherHand(feed, oppPitcherRaw?.id,  isHome ? "away" : "home");
  const lineups  = extractLineups(feed, isHome);

  await Promise.all(lineups.mets.map(async (player) => {
    const fb = mets2025?.hitters?.[player.name];
    if (fb) {
      player.seasonAVG = fb.AVG ?? "N/A";
      player.seasonOPS = fb.OPS ?? "N/A";
      player.seasonHR = fb.HR ?? "N/A";
      player.statsSeason = "2025";
      return;
    }
    if (player.playerId) {
      const stats = await getHitterStats(player.playerId, player.name);
      if (stats) {
        player.seasonAVG = stats.seasonAVG;
        player.seasonOPS = stats.seasonOPS;
        player.seasonHR = stats.seasonHR;
        player.statsSeason = stats.seasonSeason;
      }
    }
  }));

  await Promise.all(lineups.opp.map(async (player) => {
    if (player.playerId) {
      const stats = await getHitterStats(player.playerId, player.name);
      if (stats) {
        player.seasonAVG = stats.seasonAVG;
        player.seasonOPS = stats.seasonOPS;
        player.seasonHR = stats.seasonHR;
        player.statsSeason = stats.seasonSeason;
      }
    }
  }));

  // STEP 3: Season stats (only for announced pitchers)
  console.log(`Fetching pitcher stats...`);
  const [metsPitcherStats, oppPitcherStats] = await Promise.all([
    metsAnnounced ? getPitcherStats(metsPitcherRaw.id, metsPitcherRaw.fullName) : Promise.resolve([]),
    oppAnnounced  ? getPitcherStats(oppPitcherRaw.id,  oppPitcherRaw.fullName)  : Promise.resolve([])
  ]);

  const [metsPitcherInfo, oppPitcherInfo] = await Promise.all([
    metsAnnounced ? getPitcherInfo(metsPitcherRaw.id) : Promise.resolve(null),
    oppAnnounced ? getPitcherInfo(oppPitcherRaw.id) : Promise.resolve(null)
  ]);

  // STEP 3b: Savant stats (only for announced pitchers)
  console.log(`Fetching Savant stats...`);
  const [metsSavant, oppSavant] = await Promise.all([
    metsAnnounced ? getSavantStats(metsPitcherRaw.id, metsPitcherRaw.fullName) : Promise.resolve(null),
    oppAnnounced  ? getSavantStats(oppPitcherRaw.id,  oppPitcherRaw.fullName)  : Promise.resolve(null)
  ]);

  // STEP 3c: Pitcher vs opposing roster matchup stats
  console.log(`Fetching pitcher vs roster matchup data...`);
  const [metsVsRoster, oppVsRoster] = await Promise.all([
    metsAnnounced ? getPitcherVsRoster(metsPitcherRaw.id, lineups.opp)  : Promise.resolve(null),
    oppAnnounced  ? getPitcherVsRoster(oppPitcherRaw.id,  lineups.mets) : Promise.resolve(null)
  ]);

  // STEP 3d: Team advanced stats (Savant team leaderboard + MLB Stats API)
  console.log(`Fetching team advanced stats...`);
  const season = new Date().getFullYear().toString();  const [savantTeam, metsTeamMlb, oppTeamMlb] = await Promise.all([
    loadSavantTeamStats(season),
    loadMlbTeamStats(TEAM_ID, season),
    loadMlbTeamStats(oppTeam.team.id, season)
  ]);

  // Helper: find a team row in Savant data by MLB team ID
  function getSavantTeamRow(savantData, mlbTeamId) {
    if (!savantData?.rows) return null;
    // Savant uses team abbreviations; map MLB ID → abbrev
    const idToAbbrev = {
      121: "NYM", 138: "STL", 116: "DET", 117: "HOU", 118: "KC",
      119: "LAD", 120: "WSH", 133: "OAK", 134: "PIT", 135: "SD",
      136: "SEA", 137: "SF",  139: "TB",  140: "TEX", 141: "TOR",
      142: "MIN", 143: "PHI", 144: "ATL", 145: "CWS", 146: "MIA",
      147: "NYY", 108: "LAA", 109: "ARI", 110: "BAL", 111: "BOS",
      112: "CHC", 113: "CIN", 114: "CLE", 115: "COL"
    };
    const abbrev = idToAbbrev[mlbTeamId];
    if (!abbrev) return null;
    return savantData.rows.find(r =>
      (r.team_name || r.Team || "").toUpperCase().includes(abbrev) ||
      (r.player_name || r.team_abbrev || "").toUpperCase() === abbrev
    ) || null;
  }

  const metsSavantTeam = getSavantTeamRow(savantTeam, TEAM_ID);
  const oppSavantTeam  = getSavantTeamRow(savantTeam, oppTeam.team.id);

  const fmtPct = v => (v != null && !isNaN(v)) ? `${parseFloat(v).toFixed(1)}%` : null;
  const fmtNum = v => (v != null && !isNaN(v)) ? parseFloat(v).toFixed(3) : null;

  const teamAdvanced = {
    mets: {
      wrcPlus:    mets2025?.teamWRC_plus     ?? null,
      ops:        metsTeamMlb?.ops           ?? mets2025?.teamOPS     ?? null,
      xba:        fmtNum(metsSavantTeam?.xba ?? metsSavantTeam?.["xBA"]),
      hardHit:    fmtPct(metsSavantTeam?.hard_hit_percent ?? mets2025?.hardHitPct),
      kPct:       fmtPct(metsTeamMlb?.kPct  ?? mets2025?.kPct),
      rotFip:     mets2025?.rotationFIP      ?? null,
      war:        null   // not reliably fetchable; GPT may add context
    },
    opp: {
      wrcPlus:    mets2025?.opponents2025?.[oppTeam.team.name]?.teamWRC_plus ?? null,
      ops:        oppTeamMlb?.ops    ?? mets2025?.opponents2025?.[oppTeam.team.name]?.teamOPS ?? null,
      xba:        fmtNum(oppSavantTeam?.xba  ?? oppSavantTeam?.["xBA"]),
      hardHit:    fmtPct(oppSavantTeam?.hard_hit_percent),
      kPct:       fmtPct(oppTeamMlb?.kPct),
      rotFip:     mets2025?.opponents2025?.[oppTeam.team.name]?.rotationFIP ?? null,
      war:        null
    }
  };

  // STEP 3e: Game context — recent results, injuries, pitcher logs, H2H
  console.log(`Fetching game context (recent games, injuries, pitcher logs, H2H)...`);
  const gameDate = game.gameDate.split("T")[0];
  const [
    metsRecentGames,
    oppRecentGames,
    metsInjuries,
    oppInjuries,
    metsPitcherLog,
    oppPitcherLog,
    headToHead,
  ] = await Promise.all([
    getTeamRecentGames(TEAM_ID, gameDate, 5),
    getTeamRecentGames(oppTeam.team.id, gameDate, 5),
    getTeamInjuries(TEAM_ID),
    getTeamInjuries(oppTeam.team.id),
    metsAnnounced ? getPitcherRecentStarts(metsPitcherRaw.id, 4) : Promise.resolve([]),
    oppAnnounced  ? getPitcherRecentStarts(oppPitcherRaw.id,  4) : Promise.resolve([]),
    getHeadToHead(TEAM_ID, oppTeam.team.id, new Date().getFullYear()),
  ]);

  const gameContext = {
    metsRecentGames,
    oppRecentGames,
    metsInjuries,
    oppInjuries,
    metsPitcherLog,
    oppPitcherLog,
    headToHead,
  };

  const metsRecord = extractTeamRecord(standings, TEAM_ID);
  const oppRecord  = extractTeamRecord(standings, oppTeam.team.id);
  const metsPStats = extractPitcherSummary(metsPitcherStats);
  const oppPStats  = extractPitcherSummary(oppPitcherStats);

  const dateStr = game.gameDate.split("T")[0];
  const oppSlug = oppTeam.team.name.toLowerCase().replace(/\s+/g, "-");

  const gameObject = {
    id:        `${dateStr}-mets-vs-${oppSlug}`,
    date:      dateStr,
    time:      new Date(game.gameDate).toLocaleTimeString("en-US", {
                 hour: "2-digit", minute: "2-digit", timeZone: "America/New_York"
               }) + " ET",
    ballpark:  `${game.venue?.name || "TBD"}${isHome ? ", Queens NY" : ""}`,
    opponent:  oppTeam.team.name,
    oppTeamId: oppTeam.team.id,
    homeAway:  isHome ? "home" : "road",
    metsRecord,
    oppRecord,
    moneyline: { mets: -115, opp: -105 },
    runLine:   { mets: -1.5, price: 160 },
    status:    "upcoming",
    finalScore: null,
    result:    null,
    pitching: {
      mets: {
        name:        metsAnnounced ? metsPitcherRaw.fullName : "TBD",
        mlbId:       metsAnnounced ? metsPitcherRaw.id : null,
        announced:   metsAnnounced,
        hand:        metsHand || metsPitcherInfo?.pitchHand?.code || null,
        seasonRecord: metsPStats.seasonRecord,
        seasonERA:   metsPStats.seasonERA,
        seasonFIP:   metsPStats.seasonFIP,
        seasonXERA:  "N/A",
        seasonWHIP:  metsPStats.seasonWHIP,
        seasonHR9:   metsPStats.seasonHR9,
        last3ERA:    metsPStats.last3ERA,
        last3FIP:    "N/A",
        last3WHIP:   metsPStats.last3WHIP,
        last3KBB:    metsPStats.last3KBB,
        last3IP:     metsPStats.last3IP,
        note:        metsPStats.note,
        savant:      metsSavant,
        vsRoster:    metsVsRoster
      },
      opp: {
        name:        oppAnnounced ? oppPitcherRaw.fullName : "TBD",
        mlbId:       oppAnnounced ? oppPitcherRaw.id : null,
        announced:   oppAnnounced,
        hand:        oppHand || oppPitcherInfo?.pitchHand?.code || null,
        seasonRecord: oppPStats.seasonRecord,
        seasonERA:   oppPStats.seasonERA,
        seasonFIP:   oppPStats.seasonFIP,
        seasonXERA:  "N/A",
        seasonWHIP:  oppPStats.seasonWHIP,
        seasonHR9:   oppPStats.seasonHR9,
        last3ERA:    oppPStats.last3ERA,
        last3FIP:    "N/A",
        last3WHIP:   oppPStats.last3WHIP,
        last3KBB:    oppPStats.last3KBB,
        last3IP:     oppPStats.last3IP,
        note:        oppPStats.note,
        savant:      oppSavant,
        vsRoster:    oppVsRoster
      },
      metsBullpen: { seasonERA: "N/A", seasonXFIP: "N/A", last14ERA: "N/A", last3DaysIP: "N/A", rating: 70 },
      oppBullpen:  { seasonERA: "N/A", seasonXFIP: "N/A", last14ERA: "N/A", last3DaysIP: "N/A", rating: 65 }
    },
    lineups,
    teamAdvanced,
    gameContext,
    advancedMatchup: [
      { category: "Offense vs SP Hand - wRC+", mets: "N/A", opp: "N/A", edge: "Neutral" },
      { category: "Hard-Hit %",               mets: "N/A", opp: "N/A", edge: "Neutral" },
      { category: "Barrel %",                 mets: "N/A", opp: "N/A", edge: "Neutral" },
      { category: "Walk Rate (BB%)",          mets: "N/A", opp: "N/A", edge: "Neutral" },
      { category: "Strikeout Rate (K%)",      mets: "N/A", opp: "N/A", edge: "Neutral" }
    ],
    trends: [
      { category: "Last 10 Games",   mets: metsRecord,               opp: oppRecord,                edge: "Neutral" },
      { category: "Home/Road",       mets: isHome ? "Home" : "Road", opp: isHome ? "Road" : "Home", edge: "Neutral" },
      { category: "Series Context",  mets: "Game 1",                 opp: "Game 1",                 edge: "Neutral" }
    ],
    writeup: null,
    bettingHistory: null
  };

  const previousPitching = previousGame?.pitching || {};
  gameObject.pitching.mets = mergePitcherWithFallbacks(
    gameObject.pitching.mets,
    previousPitching.mets,
    mets2025?.starters?.[gameObject.pitching.mets.name]
  );
  gameObject.pitching.opp = mergePitcherWithFallbacks(
    gameObject.pitching.opp,
    previousPitching.opp,
    null
  );
  const weather = await getGameWeather(gameObject.ballpark, dateStr, gameObject.time);
  gameObject.weather = weather || null;

  // STEP 4: Generate AI analysis only on game day
  if (isGameDay) {
    console.log("Generating AI analysis...");
    const rawWriteup = await generateAnalysis(gameObject);
    gameObject.writeup = parseWriteup(rawWriteup);
  } else {
    console.log("Not game day — skipping analysis generation.");
  }

  return gameObject;
}

// ─────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────

async function run() {
  console.log("Searching for next Mets game...");
  const result = await findNextGame(getTodayET());

  if (!result) {
    console.log("No Mets game found in the next 7 days. Exiting.");
    process.exit(0);
  }

  const { game, date: gameDate } = result;
  const isGameDay = (gameDate === getTodayET());
  console.log(`isGameDay: ${isGameDay} (game: ${gameDate}, today: ${getTodayET()})`);

  const previousOutput = loadPreviousOutput();
  const previousGame = previousOutput?.games?.[0] || null;
  const mets2025 = await loadMets2025();
  const standings   = await getStandings();
  const gameObject  = await buildGameObject(game, standings, isGameDay, previousGame, mets2025);

  console.log(`\n--- Game object summary ---`);
  console.log(`  Date:     ${gameObject.date}`);
  console.log(`  Opponent: ${gameObject.opponent}`);
  console.log(`  gamePk:   ${game.gamePk}`);
  console.log(`  Mets SP:  ${gameObject.pitching.mets.name} (mlbId: ${gameObject.pitching.mets.mlbId})`);
  console.log(`  Opp SP:   ${gameObject.pitching.opp.name}  (mlbId: ${gameObject.pitching.opp.mlbId})`);
  console.log(`---------------------------\n`);

  const jsonPath = path.join(__dirname, "../public/data/sample-game.json");

  const output = {
    generatedAt: new Date().toISOString(),
    games: [gameObject]
  };

  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
  console.log("sample-game.json overwritten with fresh data. Review before pushing.");
  await createButtondownEmailFromOutput(jsonPath);
}

// ─────────────────────────────────────────────
// HTML Email Builder
// ─────────────────────────────────────────────

function buildEmailHTML(game) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Stats &amp; Standings | MetsMoneyline</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="icon" type="image/jpeg" href="favicon.jpg">
  <link rel="stylesheet" href="css/styles.css">
  <style>
    /* -- Stats & Standings page-local styles -- */
    .stats-page-header { padding: 2rem 0 1rem; text-align: center; }
    .stats-page-header h1 { font-size: 1.6rem; font-weight: 800; color: var(--navy); margin-bottom: 0.25rem; }
    .stats-page-header p  { color: var(--text-muted); font-size: 0.9rem; }

    .at-a-glance {
      display: flex; flex-wrap: wrap; gap: 0;
      background: var(--navy); border-radius: 10px;
      overflow: hidden; margin-bottom: 1.5rem;
    }
    .glance-item {
      flex: 1 1 100px; padding: 0.9rem 1rem;
      text-align: center; border-right: 1px solid rgba(255,255,255,0.1);
    }
    .glance-item:last-child { border-right: none; }
    .glance-label { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.5); margin-bottom: 0.25rem; }
    .glance-value { font-size: 1.05rem; font-weight: 800; color: #fff; }
    .glance-value.highlight { color: var(--orange); }

    .stats-section { margin-bottom: 1.5rem; }
    .stats-section-title {
      font-size: 0.72rem; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase;
      color: #9099b0; padding: 0 0 0.6rem; margin-bottom: 0;
    }

    .player-row-headshot {
      width: 28px; height: 28px; border-radius: 50%; object-fit: cover;
      margin-right: 0.5rem; vertical-align: middle; background: #e4e8f0; flex-shrink: 0;
    }
    .player-name-td { display: flex; align-items: center; }

    .divider-row td {
      background: #f4f6fa; font-size: 0.7rem; font-weight: 700;
      letter-spacing: 0.07em; text-transform: uppercase; color: #9099b0;
      padding: 0.35rem 0.75rem !important;
    }

    .standings-table .mets-row td:first-child {
      border-left: 3px solid var(--orange);
    }
    .standings-team-cell { display: flex; align-items: center; gap: 0.5rem; }
    .standings-logo { width: 22px; height: 22px; object-fit: contain; }

    .full-standings-toggle {
      display: block; width: 100%; text-align: center; padding: 0.6rem;
      background: none; border: none; color: var(--navy); font-size: 0.85rem;
      font-weight: 600; cursor: pointer; border-top: 1px solid var(--border);
    }
    .full-standings-toggle:hover { color: var(--orange); }
    #full-nl-standings { display: none; }
    #full-nl-standings.open { display: block; }

    .preseason-note {
      background: #fff8f5; border-left: 3px solid var(--orange);
      padding: 0.75rem 1rem; border-radius: 6px; font-size: 0.83rem;
      color: #6b7280; margin-bottom: 1.25rem;
    }

    @media (max-width: 640px) {
      .at-a-glance { gap: 0; }
      .glance-item { flex: 1 1 45%; border-bottom: 1px solid rgba(255,255,255,0.1); }
    }
  </style>
</head>
<body>

  <!-- Alert Banner -->
  <div class="alert-banner">Pre-Season &mdash; Stats shown are 2025 actuals as baseline</div>

  <!-- Nav -->
  <header>
    <nav>
      <a href="/" class="nav-brand">
        <span class="brand-mets">METS</span><span class="brand-mono">MONEYLINE</span>
      </a>
      <button class="nav-hamburger" aria-label="Toggle menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
      <ul class="nav-links">
        <li>
          <a href="/" class="nav-link">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            Game Day
          </a>
        </li>
        <li>
          <a href="advanced-stats.html" class="nav-link active">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
            </svg>
            Stats &amp; Standings
          </a>
        </li>
        <li>
          <a href="betting-history.html" class="nav-link">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            History
          </a>
        </li>
        <li>
          <a href="news.html" class="nav-link">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M2 15h10"/><path d="M9 18l3-3-3-3"/>
            </svg>
            Team News
          </a>
        </li>
      </ul>
    </nav>
  </header>

  <main>
    <div class="stats-page-header">
      <h1>Stats &amp; Standings</h1>
      <p>2026 Mets � team stats, player splits, rotation, and NL East standings.</p>
    </div>

    <div class="preseason-note">
      2026 season stats not yet available. All Mets values shown are verified 2025 baselines.
    </div>

    <!-- Season At A Glance -->
    <div id="at-a-glance" class="at-a-glance"></div>

    <!-- Team Stats -->
    <div class="stats-section">
      <div class="stats-section-title">Team Stats</div>
      <div class="tile-grid">
        <div class="table-wrap">
          <div class="section-title">Offensive Metrics</div>
          <table>
            <thead><tr><th>Stat</th><th>Mets</th><th>Lg Avg</th></tr></thead>
            <tbody id="offense-body"></tbody>
          </table>
        </div>
        <div class="table-wrap">
          <div class="section-title">Pitching &amp; Bullpen</div>
          <table>
            <thead><tr><th>Stat</th><th>Mets</th><th>Lg Avg</th></tr></thead>
            <tbody id="pitching-body"></tbody>
          </table>
        </div>
        <div class="table-wrap">
          <div class="section-title">Defense &amp; Baserunning</div>
          <table>
            <thead><tr><th>Stat</th><th>Mets</th><th>Lg Avg</th></tr></thead>
            <tbody id="defense-body"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Position Players -->
    <div class="stats-section">
      <div class="stats-section-title">Position Players</div>
      <div class="card full-card">
        <div class="card-header">Hitters � 2025 Stats</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Player</th><th>Pos</th><th>AVG</th><th>OPS</th><th>wRC+</th><th>HR</th><th>BB%</th><th>K%</th></tr></thead>
            <tbody id="hitters-body"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Starting Rotation -->
    <div class="stats-section">
      <div class="stats-section-title">Pitching</div>
      <div class="card full-card">
        <div class="card-header">Starting Rotation � 2025 Stats</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Pitcher</th><th>ERA</th><th>FIP</th><th>xERA</th><th>WHIP</th><th>K/BB</th><th>K/9</th><th>BB/9</th></tr></thead>
            <tbody id="rotation-body"></tbody>
          </table>
        </div>
      </div>
      <div class="card full-card" style="margin-top:1rem;">
        <div class="card-header">Bullpen � 2025 Stats</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Group</th><th>ERA</th><th>xFIP</th><th>Hold%</th><th>ERA+</th></tr></thead>
            <tbody id="bullpen-body"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- NL East Standings -->
    <div class="stats-section">
      <div class="stats-section-title">Standings</div>
      <div class="card full-card">
        <div class="card-header">NL East Standings</div>
        <div class="table-wrap">
          <table class="standings-table">
            <thead><tr><th>Team</th><th>W</th><th>L</th><th>PCT</th><th>GB</th><th>Home</th><th>Road</th><th>L10</th><th>Streak</th></tr></thead>
            <tbody id="nle-body"></tbody>
          </table>
        </div>
        <button class="full-standings-toggle" onclick="toggleFullStandings()">
          Full NL Standings &#x25BC;
        </button>
        <div id="full-nl-standings">
          <div class="table-wrap">
            <table class="standings-table">
              <thead><tr><th>Team</th><th>W</th><th>L</th><th>PCT</th><th>GB</th></tr></thead>
              <tbody id="nl-full-body"></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- Glossary -->
    <div class="glossary" id="glossary">
      <h3>Stats Glossary</h3>
      <dl>
        <dt>wRC+</dt><dd>Weighted Runs Created Plus. Measures overall offensive value relative to league average. 100 is average; higher is better.</dd>
        <dt>xwOBA</dt><dd>Expected Weighted On-Base Average. Based on quality of contact; removes luck from hitting results.</dd>
        <dt>FIP</dt><dd>Fielding Independent Pitching. ERA-like stat based only on strikeouts, walks, and home runs.</dd>
        <dt>xFIP</dt><dd>Expected FIP. Normalizes home run rate to league average to isolate pitcher skill.</dd>
        <dt>xERA</dt><dd>Expected ERA based on quality of contact allowed. A good indicator of whether ERA will rise or fall.</dd>
        <dt>Barrel%</dt><dd>Percentage of batted balls hit with ideal exit velocity and launch angle.</dd>
        <dt>Hard-Hit%</dt><dd>Percentage of batted balls with exit velocity of 95 mph or higher.</dd>
        <dt>BB%</dt><dd>Walk rate. Higher is better for hitters, lower is better for pitchers.</dd>
        <dt>K%</dt><dd>Strikeout rate. Lower is better for hitters, higher is better for pitchers.</dd>
        <dt>WHIP</dt><dd>Walks plus Hits per Inning Pitched.</dd>
        <dt>DRS</dt><dd>Defensive Runs Saved. How many runs saved versus an average defender.</dd>
        <dt>OAA</dt><dd>Outs Above Average. Statcast-based fielding metric.</dd>
      </dl>
    </div>
  </main>

  <!-- Footer -->
  <footer>
    <div class="footer-brand">
      <span class="brand-mets">METS</span><span class="brand-mono">MONEYLINE</span>
    </div>
    <p class="footer-disclaimer">For entertainment purposes only. Always gamble responsibly.</p>
    <p class="footer-copy">&copy; 2026 MetsMoneyline. Not affiliated with the New York Mets or MLB.</p>
    <p id="data-timestamp" style="font-size:0.72rem;color:#9099b0;margin-top:0.25rem;"></p>
  </footer>

  <script type="module">
    import METS_2025 from "./data/mets2025.js";

    const TEAM_MLB_ID = {
      "New York Mets":121,"Atlanta Braves":144,"Philadelphia Phillies":143,
      "Washington Nationals":120,"Miami Marlins":146
    };
    function logoUrl(team) {
      const id = TEAM_MLB_ID[team];
      return id ? "https://www.mlbstatic.com/team-logos/" + id + ".svg" : "";
    }
  </script>
  <script>
    const hamburger = document.querySelector('.nav-hamburger');
    const navLinks  = document.querySelector('.nav-links');
    hamburger.addEventListener('click', () => {
      const open = navLinks.classList.toggle('open');
      hamburger.classList.toggle('open', open);
      hamburger.setAttribute('aria-expanded', open);
    });
    navLinks.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
        hamburger.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
      });
    });
  </script>
</body>
</html>`;
}
// Buttondown email sender
// ─────────────────────────────────────────────

async function createButtondownEmailFromOutput(jsonPath) {
  const apiKey = process.env.BUTTONDOWN_API_KEY;
  if (!apiKey) {
    console.log("No BUTTONDOWN_API_KEY set; skipping email creation.");
    return;
  }

  try {
    const gameData = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const game = gameData?.games?.[0];
    if (!game) {
      console.log("No game data found after write; skipping email creation.");
      return;
    }

    const gameDate = game.date
      ? new Date(`${game.date}T12:00:00`).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "America/New_York"
        })
      : "TBD";

    const subject = `MetsMoneyline — ${gameDate}: New York Mets vs ${game.opponent}`;
    const bodyHtml = buildEmailHTML(game);
    const publishDate = getPublishDate(game.date);

    const response = await axios.post(
      "https://api.buttondown.com/v1/emails",
      {
        subject,
        body: bodyHtml,
        status: "scheduled",
        publish_date: publishDate
      },
      {
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );

    const email = response.data;
    console.log(`Buttondown email created: ${email.id} (${email.status})`);
  } catch (err) {
    console.error("Failed to create Buttondown email", err.response?.data || err.message);
  }
}

function getPublishDate(gameDateStr) {
  if (!gameDateStr) return null;

  const [y, m, d] = gameDateStr.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const tzName = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset"
  }).formatToParts(probe).find(part => part.type === "timeZoneName")?.value || "GMT-5";

  const match = tzName.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
  const offsetHours = match ? parseInt(match[1], 10) : -5;
  const offsetMinutes = match?.[2] ? parseInt(match[2], 10) : 0;
  const totalOffsetMinutes = (offsetHours * 60) + (offsetHours >= 0 ? offsetMinutes : -offsetMinutes);
  const utcMillis = Date.UTC(y, m - 1, d, 12, 45, 0) - (totalOffsetMinutes * 60 * 1000);

  return new Date(utcMillis).toISOString();
}

run().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});

