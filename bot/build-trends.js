/**
 * build-trends.js
 * Generates public/data/trends.json with BA vs xBA trend data
 * for the Mets team and individual hitters.
 *
 * Data sources:
 *   - MLB Stats API: game logs for BA/OPS/SLG per game
 *   - Baseball Savant: expected stats (xBA) from CSV leaderboards
 *
 * CHART DATA MODEL:
 *   - rolling.ba    = 5-game rolling batting average (H in last 5 / AB in last 5)
 *   - rolling.game  = per-game BA for each game (scatter dots)
 *   - xba           = single season-level value (horizontal reference line)
 *
 * Usage: node bot/build-trends.js
 */

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { parse } = require("csv-parse/sync");

const TEAM_ID = 121;
const SEASON = new Date().getFullYear();
const ROLLING_WINDOW = 5; // 5-game rolling average
const OUTPUT_PATH = path.join(__dirname, "../public/data/trends.json");

async function fetchJson(url) {
  try {
    const { data } = await axios.get(url, { timeout: 15000 });
    return data;
  } catch (e) {
    console.warn(`[trends] fetch failed: ${url}`, e.message);
    return null;
  }
}

async function fetchText(url) {
  try {
    const { data } = await axios.get(url, { timeout: 15000, responseType: "text" });
    return data;
  } catch (e) {
    console.warn(`[trends] text fetch failed: ${url}`, e.message);
    return null;
  }
}

async function getActiveHitters() {
  const data = await fetchJson(
    `https://statsapi.mlb.com/api/v1/teams/${TEAM_ID}/roster/active?season=${SEASON}`
  );
  if (!data || !data.roster) return [];
  return data.roster
    .filter(p => p.position?.type !== "Pitcher")
    .map(p => ({
      mlbId: p.person.id,
      name: p.person.fullName,
      position: p.position?.abbreviation || "",
    }));
}

async function getPlayerGameLog(playerId) {
  const data = await fetchJson(
    `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=gameLog&season=${SEASON}&group=hitting`
  );
  const splits = data?.stats?.[0]?.splits;
  if (!Array.isArray(splits)) return [];
  return splits.map(s => ({
    date: s.date,
    opponent: s.opponent?.name || "",
    ab: s.stat?.atBats ?? 0,
    h: s.stat?.hits ?? 0,
    doubles: s.stat?.doubles ?? 0,
    triples: s.stat?.triples ?? 0,
    hr: s.stat?.homeRuns ?? 0,
    rbi: s.stat?.rbi ?? 0,
    bb: s.stat?.baseOnBalls ?? 0,
    hbp: s.stat?.hitByPitch ?? 0,
    sf: s.stat?.sacFlies ?? 0,
    pa: s.stat?.plateAppearances ?? 0,
    avg: parseFloat(s.stat?.avg) || 0,
    obp: parseFloat(s.stat?.obp) || 0,
    ops: parseFloat(s.stat?.ops) || 0,
    slg: parseFloat(s.stat?.slg) || 0,
  }));
}

async function getSavantExpectedStats() {
  const url =
    `https://baseballsavant.mlb.com/leaderboard/expected_statistics` +
    `?type=batter&year=${SEASON}&position=&team=${TEAM_ID}` +
    `&min=1&csv=true`;
  const csv = await fetchText(url);
  if (!csv) return {};
  try {
    const rows = parse(csv, { columns: true, skip_empty_lines: true });
    const map = {};
    for (const row of rows) {
      const id = parseInt(row.player_id, 10);
      if (id) {
        map[id] = {
          xba: parseFloat(row.est_ba) || null,
          xslg: parseFloat(row.est_slg) || null,
          xwoba: parseFloat(row.est_woba) || null,
          ba: parseFloat(row.ba) || null,
          pa: parseInt(row.pa, 10) || 0,
        };
      }
    }
    return map;
  } catch (e) {
    console.warn("[trends] savant CSV parse failed:", e.message);
    return {};
  }
}

/**
 * Compute a true N-game rolling BA.
 * Each point = sum(hits in last N games) / sum(AB in last N games).
 * Also returns per-game BA for scatter dots.
 */
function computeRolling(gameLogs, rollingN = ROLLING_WINDOW) {
  const labels = [];
  const rollingBa = [];
  const perGameBa = [];
  const perGameOps = [];
  const perGameHr = [];

  gameLogs.forEach((g, i) => {
    labels.push(g.date ? g.date.slice(5) : `G${i + 1}`);

    // Per-game BA
    const gameBa = g.ab > 0 ? g.h / g.ab : null;
    perGameBa.push(gameBa != null ? parseFloat(gameBa.toFixed(3)) : null);
    perGameOps.push(typeof g.ops === "number" ? parseFloat(g.ops.toFixed(3)) : null);
    perGameHr.push(typeof g.hr === "number" ? g.hr : 0);

    // Rolling: use the last N games up to and including this one
    const windowStart = Math.max(0, i + 1 - rollingN);
    const window = gameLogs.slice(windowStart, i + 1);
    const wH = window.reduce((s, w) => s + w.h, 0);
    const wAB = window.reduce((s, w) => s + w.ab, 0);
    const rba = wAB > 0 ? wH / wAB : null;
    rollingBa.push(rba != null ? parseFloat(rba.toFixed(3)) : null);
  });

  return {
    labels,
    ba: rollingBa,
    game: perGameBa,
    ops: perGameOps,
    hr: perGameHr,
  };
}

function buildWindowStats(gameLogs, savantData, windowSize) {
  const games = windowSize ? gameLogs.slice(-windowSize) : gameLogs;
  if (games.length === 0) return null;

  const totals = games.reduce((acc, g) => {
    acc.h += g.h; acc.ab += g.ab;
    acc.doubles += g.doubles || 0; acc.triples += g.triples || 0;
    acc.hr += g.hr; acc.bb += g.bb || 0;
    acc.hbp += g.hbp || 0; acc.sf += g.sf || 0; acc.pa += g.pa;
    return acc;
  }, { h: 0, ab: 0, doubles: 0, triples: 0, hr: 0, bb: 0, hbp: 0, sf: 0, pa: 0 });

  const ba = totals.ab > 0 ? parseFloat((totals.h / totals.ab).toFixed(3)) : null;
  const singles = Math.max(0, totals.h - totals.doubles - totals.triples - totals.hr);
  const totalBases = singles + 2 * totals.doubles + 3 * totals.triples + 4 * totals.hr;
  const slg = totals.ab > 0 ? parseFloat((totalBases / totals.ab).toFixed(3)) : null;
  const obpD = totals.ab + totals.bb + totals.hbp + totals.sf;
  const obp = obpD > 0 ? parseFloat(((totals.h + totals.bb + totals.hbp) / obpD).toFixed(3)) : null;
  const ops = obp != null && slg != null ? parseFloat((obp + slg).toFixed(3)) : null;

  const rolling = computeRolling(games);
  const xba = savantData?.xba != null ? parseFloat(savantData.xba.toFixed(3)) : null;

  return {
    ba, xba, ops, slg, obp,
    hr: totals.hr, pa: totals.pa, games: games.length,
    rolling, // { labels, ba (5-game rolling), game (per-game) }
  };
}

/* ── MLB league-wide batting averages for the current season ── */
async function getLeagueAverages() {
  // This endpoint returns aggregate MLB hitting stats for the season
  const data = await fetchJson(
    `https://statsapi.mlb.com/api/v1/teams/stats?stats=season&season=${SEASON}&group=hitting&sportIds=1`
  );
  const splits = data?.stats?.[0]?.splits;
  if (!Array.isArray(splits) || !splits.length) {
    console.warn("[trends] Could not fetch league averages, using fallbacks");
    return { ba: 0.243, obp: 0.310, slg: 0.389, ops: 0.699 };
  }

  // Average across all 30 teams
  let totalAB = 0, totalH = 0, totalBB = 0, totalHBP = 0, totalSF = 0, totalPA = 0;
  let totalTB = 0;
  const opsValues = [];
  const obpValues = [];

  for (const s of splits) {
    const stat = s.stat || {};
    const ab = stat.atBats || 0;
    const h = stat.hits || 0;
    totalAB += ab;
    totalH += h;
    totalBB += stat.baseOnBalls || 0;
    totalHBP += stat.hitByPitch || 0;
    totalSF += stat.sacFlies || 0;
    totalPA += stat.plateAppearances || 0;
    if (stat.ops) opsValues.push(parseFloat(stat.ops));
    if (stat.obp) obpValues.push(parseFloat(stat.obp));
    if (stat.slg) {
      totalTB += parseFloat(stat.slg) * ab;
    }
  }

  const ba = totalAB > 0 ? parseFloat((totalH / totalAB).toFixed(3)) : 0.243;
  const obp = obpValues.length > 0
    ? parseFloat((obpValues.reduce((a, b) => a + b, 0) / obpValues.length).toFixed(3))
    : 0.310;
  const slg = totalAB > 0
    ? parseFloat((totalTB / totalAB).toFixed(3))
    : 0.389;
  const ops = opsValues.length > 0
    ? parseFloat((opsValues.reduce((a, b) => a + b, 0) / opsValues.length).toFixed(3))
    : 0.699;

  console.log(`[trends] League averages: BA=${ba}, OBP=${obp}, SLG=${slg}, OPS=${ops}`);
  return { ba, obp, slg, ops };
}

async function main() {
  console.log("[trends] Starting build...");

  const [hitters, savantMap, leagueAvg] = await Promise.all([
    getActiveHitters(),
    getSavantExpectedStats(),
    getLeagueAverages(),
  ]);

  console.log(`[trends] Found ${hitters.length} active hitters, ${Object.keys(savantMap).length} savant entries`);

  const playerResults = [];
  const playerLogs = [];
  for (const hitter of hitters) {
    const logs = await getPlayerGameLog(hitter.mlbId);
    playerLogs.push(logs);
    if (logs.length < 3) continue;
    const savant = savantMap[hitter.mlbId] || {};

    playerResults.push({
      name: hitter.name,
      mlbId: hitter.mlbId,
      position: hitter.position,
      season: buildWindowStats(logs, savant, null),
      last20: buildWindowStats(logs, savant, 20),
      last10: buildWindowStats(logs, savant, 10),
    });
  }

  // Team-level aggregation
  const allLogs = playerLogs.flat();
  const byDate = {};
  allLogs.forEach(g => {
    if (!byDate[g.date]) {
      byDate[g.date] = {
        date: g.date,
        h: 0,
        ab: 0,
        doubles: 0,
        triples: 0,
        hr: 0,
        bb: 0,
        hbp: 0,
        sf: 0,
        pa: 0,
        ops: null,
      };
    }
    const d = byDate[g.date];
    d.h += g.h; d.ab += g.ab; d.doubles += g.doubles || 0;
    d.triples += g.triples || 0; d.hr += g.hr; d.bb += g.bb || 0;
    d.hbp += g.hbp || 0; d.sf += g.sf || 0; d.pa += g.pa;
  });
  Object.values(byDate).forEach(d => {
    const singles = Math.max(0, d.h - d.doubles - d.triples - d.hr);
    const totalBases = singles + 2 * d.doubles + 3 * d.triples + 4 * d.hr;
    const slg = d.ab > 0 ? totalBases / d.ab : null;
    const obpDen = d.ab + d.bb + d.hbp + d.sf;
    const obp = obpDen > 0 ? (d.h + d.bb + d.hbp) / obpDen : null;
    d.ops = obp != null && slg != null ? parseFloat((obp + slg).toFixed(3)) : null;
  });
  const teamLogs = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

  // Team xBA: PA-weighted average from Savant
  const savantEntries = Object.values(savantMap).filter(v => v.xba != null && v.pa > 0);
  const totalPA = savantEntries.reduce((s, v) => s + v.pa, 0);
  const teamXba = totalPA > 0
    ? savantEntries.reduce((s, v) => s + v.xba * v.pa, 0) / totalPA
    : null;
  const teamSavant = { xba: teamXba };

  const output = {
    generatedAt: new Date().toISOString(),
    season: SEASON,
    rollingWindow: ROLLING_WINDOW,
    leagueAvg,
    team: {
      season: buildWindowStats(teamLogs, teamSavant, null),
      last20: buildWindowStats(teamLogs, teamSavant, 20),
      last10: buildWindowStats(teamLogs, teamSavant, 10),
    },
    players: playerResults.sort((a, b) => (b.season?.pa || 0) - (a.season?.pa || 0)),
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`[trends] Wrote ${OUTPUT_PATH} (${playerResults.length} players)`);
}

main().catch(e => {
  console.error("[trends] Fatal error:", e);
  process.exit(1);
});
