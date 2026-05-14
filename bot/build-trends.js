/**
 * build-trends.js
 * Generates public/data/trends.json for the trends page.
 *
 * Data sources:
 *   - MLB Stats API: player game logs, league averages, team benchmarks
 *   - Baseball Savant: expected batting average leaderboard and statcast event data
 *
 * Usage: node bot/build-trends.js
 */

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { parse } = require("csv-parse/sync");
const replaceHtmlBlock = require("./lib/replace-html-block");

const TEAM_ID = 121;
const TEAM_ABBR = "NYM";
const SEASON = new Date().getFullYear();
const ROLLING_WINDOW = 5;
const OUTPUT_PATH = path.join(__dirname, "../public/data/trends.json");
const TRENDS_HTML_PATH = path.join(__dirname, "../public/trends.html");

async function fetchJson(url) {
  try {
    const { data } = await axios.get(url, { timeout: 20000 });
    return data;
  } catch (e) {
    console.warn(`[trends] fetch failed: ${url}`, e.message);
    return null;
  }
}

async function fetchText(url) {
  try {
    const { data } = await axios.get(url, { timeout: 60000, responseType: "text" });
    return data;
  } catch (e) {
    console.warn(`[trends] text fetch failed: ${url}`, e.message);
    return null;
  }
}

function parseRate(value) {
  if (value == null || value === "") return null;
  const num = parseFloat(String(value).replace(/^0(?=\.)/, "0"));
  return Number.isFinite(num) ? num : null;
}

function toDateKey(value) {
  return value ? String(value).slice(0, 10) : "";
}

function ensureDateMapValue(map, dateKey) {
  if (!map[dateKey]) map[dateKey] = 0;
  return map[dateKey];
}

function upsertNestedDateValue(container, id, dateKey, amount) {
  if (!container[id]) container[id] = {};
  if (!container[id][dateKey]) container[id][dateKey] = 0;
  container[id][dateKey] += amount;
}

function weightedAverage(entries, valueKey, weightKey) {
  let weighted = 0;
  let weight = 0;
  entries.forEach((entry) => {
    const value = entry[valueKey];
    const w = entry[weightKey];
    if (Number.isFinite(value) && Number.isFinite(w) && w > 0) {
      weighted += value * w;
      weight += w;
    }
  });
  return weight > 0 ? parseFloat((weighted / weight).toFixed(3)) : null;
}

function summarizeExpectedStats(entries = []) {
  const valid = entries.filter((entry) => Number.isFinite(entry?.xba) && Number.isFinite(entry?.pa) && entry.pa > 0);
  const pa = valid.reduce((sum, entry) => sum + entry.pa, 0);
  const xba = weightedAverage(valid, "xba", "pa");
  return { pa, xba };
}

function escapeHtml(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatRate(value) {
  return Number.isFinite(value) ? value.toFixed(3).replace(/^0/, "") : "—";
}

function buildTrendsSeoSummary(output) {
  const team = output.team?.season || {};
  const teamRank = team.ranks?.ba ? `${team.ranks.ba}th` : "unranked";
  const eligiblePlayers = (output.players || []).filter((player) => (player.season?.pa || 0) >= 20);
  const playerPool = eligiblePlayers.length ? eligiblePlayers : (output.players || []);
  const topPerformer = playerPool
    .slice()
    .sort((a, b) => (b.season?.ops || 0) - (a.season?.ops || 0))[0];
  const coldBat = playerPool
    .slice()
    .sort((a, b) => (a.season?.ba || 1) - (b.season?.ba || 1))[0];

  return [
    `<p>The 2026 New York Mets are batting ${formatRate(team.ba)} as a team, ranking ${escapeHtml(teamRank)} in MLB, with a ${formatRate(team.ops)} OPS. ` +
      `Top performer: ${escapeHtml(topPerformer?.name || "N/A")} (${formatRate(topPerformer?.season?.ba)} BA, ${formatRate(topPerformer?.season?.ops)} OPS). ` +
      `Running cold: ${escapeHtml(coldBat?.name || "N/A")} (${formatRate(coldBat?.season?.ba)} BA). ` +
      `Individual hitter trends, xBA analysis, and team-vs-MLB comparisons update daily.</p>`,
  ].join("");
}

async function getActiveHitters() {
  const data = await fetchJson(
    `https://statsapi.mlb.com/api/v1/teams/${TEAM_ID}/roster/active?season=${SEASON}`
  );
  if (!data || !data.roster) return [];
  return data.roster
    .filter((p) => p.position?.type !== "Pitcher")
    .map((p) => ({
      mlbId: p.person.id,
      name: p.person.fullName,
      position: p.position?.abbreviation || "",
    }));
}

async function getLeagueTeams() {
  const data = await fetchJson(`https://statsapi.mlb.com/api/v1/teams?sportId=1&season=${SEASON}`);
  if (!Array.isArray(data?.teams)) return [];
  return data.teams.map((team) => ({
    id: team.id,
    abbr: team.abbreviation || team.fileCode?.toUpperCase() || "",
    name: team.teamName || team.name || "",
  }));
}

async function getPlayerGameLog(playerId) {
  const data = await fetchJson(
    `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=gameLog&season=${SEASON}&group=hitting`
  );
  const splits = data?.stats?.[0]?.splits;
  if (!Array.isArray(splits)) return [];
  return splits.map((s) => ({
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
    avg: parseRate(s.stat?.avg) || 0,
    obp: parseRate(s.stat?.obp) || 0,
    ops: parseRate(s.stat?.ops) || 0,
    slg: parseRate(s.stat?.slg) || 0,
  }));
}

async function getTeamGameLog(teamId) {
  const data = await fetchJson(
    `https://statsapi.mlb.com/api/v1/teams/${teamId}/stats?stats=gameLog&season=${SEASON}&group=hitting`
  );
  const splits = data?.stats?.[0]?.splits;
  if (!Array.isArray(splits)) return [];
  return splits.map((s) => ({
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
    avg: parseRate(s.stat?.avg) || 0,
    obp: parseRate(s.stat?.obp) || 0,
    ops: parseRate(s.stat?.ops) || 0,
    slg: parseRate(s.stat?.slg) || 0,
  }));
}

async function getExpectedStatsLeaderboard(teamId = null) {
  const teamParam = teamId ? `&team=${teamId}` : "";
  const url =
    `https://baseballsavant.mlb.com/leaderboard/expected_statistics` +
    `?type=batter&year=${SEASON}&position=${teamParam ? "" : ""}${teamParam}` +
    `&min=1&csv=true`;
  const csv = await fetchText(url);
  if (!csv) return { entries: [], byPlayerId: {} };

  try {
    const rows = parse(csv, { columns: true, skip_empty_lines: true, bom: true });
    const entries = [];
    const byPlayerId = {};
    rows.forEach((row) => {
      const playerId = parseInt(row.player_id, 10);
      if (!playerId) return;
      const entry = {
        playerId,
        pa: parseInt(row.pa, 10) || 0,
        xba: parseRate(row.est_ba),
      };
      entries.push(entry);
      byPlayerId[playerId] = entry;
    });
    return { entries, byPlayerId };
  } catch (e) {
    console.warn("[trends] expected stats CSV parse failed:", e.message);
    return { entries: [], byPlayerId: {} };
  }
}

async function getTeamExpectedStatSummaries(teams, seededLeaderboards = {}) {
  const summaries = {};
  await Promise.all(teams.map(async (team) => {
    const seeded = seededLeaderboards[String(team.id)];
    const leaderboard = seeded || await getExpectedStatsLeaderboard(team.id);
    const summary = summarizeExpectedStats(leaderboard.entries);
    summaries[String(team.id)] = {
      teamId: team.id,
      abbr: team.abbr,
      name: team.name,
      pa: summary.pa,
      xba: summary.xba,
    };
  }));
  return summaries;
}

function buildStatcastSearchUrl(startDate, endDate, teamAbbr = "") {
  const params = new URLSearchParams();
  [
    ["all", "true"],
    ["hfPT", ""],
    ["hfAB", ""],
    ["hfBBT", ""],
    ["hfPR", ""],
    ["hfZ", ""],
    ["stadium", ""],
    ["hfBBL", ""],
    ["hfNewZones", ""],
    ["hfGT", "R|PO|S|"],
    ["hfC", ""],
    ["hfSea", `${SEASON}|`],
    ["hfSit", ""],
    ["hfOuts", ""],
    ["opponent", ""],
    ["pitcher_throws", ""],
    ["batter_stands", ""],
    ["hfSA", ""],
    ["player_type", "batter"],
    ["hfInfield", ""],
    ["team", teamAbbr],
    ["position", ""],
    ["hfOutfield", ""],
    ["hfRO", ""],
    ["home_road", ""],
    ["game_date_gt", startDate],
    ["game_date_lt", endDate],
    ["hfFlag", ""],
    ["hfPull", ""],
    ["metric_1", ""],
    ["hfInn", ""],
    ["min_pitches", "0"],
    ["min_results", "0"],
    ["group_by", "name"],
    ["sort_col", "pitches"],
    ["player_event_sort", "h_launch_speed"],
    ["sort_order", "desc"],
    ["min_abs", "0"],
    ["type", "details"],
  ].forEach(([key, value]) => params.append(key, value));

  return `https://baseballsavant.mlb.com/statcast_search/csv?${params.toString()}`;
}

async function getMetsStatcastExpectedHits(activeHitters) {
  const activeIds = new Set(activeHitters.map((h) => String(h.mlbId)));
  const seasonStart = `${SEASON}-03-01`;
  const seasonEnd = new Date().toISOString().slice(0, 10);
  const csv = await fetchText(buildStatcastSearchUrl(seasonStart, seasonEnd, TEAM_ABBR));
  const byPlayerDate = {};
  const teamByDate = {};
  if (!csv) return { byPlayerDate, teamByDate };

  try {
    const rows = parse(csv, { columns: true, skip_empty_lines: true, bom: true });
    const seen = new Set();
    const hitEvents = new Set(["single", "double", "triple", "home_run"]);

    rows.forEach((row) => {
      if (!row.events) return;
      const batterId = String(row.batter || "");
      if (!activeIds.has(batterId)) return;
      const dateKey = toDateKey(row.game_date);
      if (!dateKey) return;

      const eventKey = [batterId, row.game_pk || "", row.at_bat_number || "", row.events].join("|");
      if (seen.has(eventKey)) return;
      seen.add(eventKey);

      const estimated = parseRate(row.estimated_ba_using_speedangle);
      const expectedHit = estimated != null
        ? estimated
        : hitEvents.has(row.events) ? 1 : 0;

      upsertNestedDateValue(byPlayerDate, batterId, dateKey, expectedHit);
      ensureDateMapValue(teamByDate, dateKey);
      teamByDate[dateKey] += expectedHit;
    });
  } catch (e) {
    console.warn("[trends] statcast CSV parse failed:", e.message);
  }

  return { byPlayerDate, teamByDate };
}

async function getLeagueStatcastExpectedHits(teamsByAbbr) {
  const seasonStart = `${SEASON}-03-01`;
  const seasonEnd = new Date().toISOString().slice(0, 10);
  const csv = await fetchText(buildStatcastSearchUrl(seasonStart, seasonEnd, ""));
  const byTeamIdDate = {};
  if (!csv) return byTeamIdDate;

  try {
    const rows = parse(csv, { columns: true, skip_empty_lines: true, bom: true });
    const seen = new Set();
    const hitEvents = new Set(["single", "double", "triple", "home_run"]);

    rows.forEach((row) => {
      if (!row.events) return;
      const dateKey = toDateKey(row.game_date);
      if (!dateKey) return;

      const battingAbbr = row.inning_topbot === "Top" ? row.away_team : row.home_team;
      const team = teamsByAbbr[battingAbbr];
      if (!team) return;

      const eventKey = [team.id, row.game_pk || "", row.at_bat_number || "", row.batter || "", row.events].join("|");
      if (seen.has(eventKey)) return;
      seen.add(eventKey);

      const estimated = parseRate(row.estimated_ba_using_speedangle);
      const expectedHit = estimated != null ? estimated : hitEvents.has(row.events) ? 1 : 0;
      upsertNestedDateValue(byTeamIdDate, String(team.id), dateKey, expectedHit);
    });
  } catch (e) {
    console.warn("[trends] league statcast CSV parse failed:", e.message);
  }

  return byTeamIdDate;
}

function getExpectedHitsForGame(gameLog, expectedHitsByDate, xbaFallback) {
  const dateKey = toDateKey(gameLog.date);
  const actual = expectedHitsByDate && Number.isFinite(expectedHitsByDate[dateKey])
    ? expectedHitsByDate[dateKey]
    : null;
  if (actual != null) return actual;
  if (Number.isFinite(xbaFallback) && gameLog.ab > 0) {
    return xbaFallback * gameLog.ab;
  }
  return 0;
}

function computeRolling(gameLogs, options = {}) {
  const {
    rollingN = ROLLING_WINDOW,
    expectedHitsByDate = {},
    xbaFallback = null,
  } = options;

  const labels = [];
  const rollingBa = [];
  const perGameBa = [];
  const perGameOps = [];
  const perGameHr = [];
  const cumulativeBa = [];
  const cumulativeXba = [];
  const cumulativeOps = [];
  const cumulativeHr = [];
  let totalH = 0;
  let totalAB = 0;
  let total2B = 0;
  let total3B = 0;
  let totalHR = 0;
  let totalBB = 0;
  let totalHBP = 0;
  let totalSF = 0;
  let totalExpectedHits = 0;

  gameLogs.forEach((g, i) => {
    labels.push(g.date ? g.date.slice(5) : `G${i + 1}`);

    const gameBa = g.ab > 0 ? g.h / g.ab : null;
    perGameBa.push(gameBa != null ? parseFloat(gameBa.toFixed(3)) : null);
    perGameOps.push(Number.isFinite(g.ops) ? parseFloat(g.ops.toFixed(3)) : null);
    perGameHr.push(Number.isFinite(g.hr) ? g.hr : 0);

    totalH += g.h || 0;
    totalAB += g.ab || 0;
    total2B += g.doubles || 0;
    total3B += g.triples || 0;
    totalHR += g.hr || 0;
    totalBB += g.bb || 0;
    totalHBP += g.hbp || 0;
    totalSF += g.sf || 0;
    totalExpectedHits += getExpectedHitsForGame(g, expectedHitsByDate, xbaFallback);

    const cumBa = totalAB > 0 ? totalH / totalAB : null;
    const cumXba = totalAB > 0 ? totalExpectedHits / totalAB : null;
    const cumSingles = Math.max(0, totalH - total2B - total3B - totalHR);
    const cumTotalBases = cumSingles + 2 * total2B + 3 * total3B + 4 * totalHR;
    const cumSlg = totalAB > 0 ? cumTotalBases / totalAB : null;
    const cumObpDen = totalAB + totalBB + totalHBP + totalSF;
    const cumObp = cumObpDen > 0 ? (totalH + totalBB + totalHBP) / cumObpDen : null;
    const cumOps = cumObp != null && cumSlg != null ? cumObp + cumSlg : null;

    cumulativeBa.push(cumBa != null ? parseFloat(cumBa.toFixed(3)) : null);
    cumulativeXba.push(cumXba != null ? parseFloat(cumXba.toFixed(3)) : null);
    cumulativeOps.push(cumOps != null ? parseFloat(cumOps.toFixed(3)) : null);
    cumulativeHr.push(totalHR);

    const windowStart = Math.max(0, i + 1 - rollingN);
    const window = gameLogs.slice(windowStart, i + 1);
    const wH = window.reduce((sum, item) => sum + item.h, 0);
    const wAB = window.reduce((sum, item) => sum + item.ab, 0);
    const rba = wAB > 0 ? wH / wAB : null;
    rollingBa.push(rba != null ? parseFloat(rba.toFixed(3)) : null);
  });

  return {
    labels,
    ba: rollingBa,
    game: perGameBa,
    ops: perGameOps,
    hr: perGameHr,
    cumulativeBa,
    cumulativeXba,
    cumulativeOps,
    cumulativeHr,
  };
}

function buildWindowStats(gameLogs, options = {}) {
  const {
    windowSize = null,
    chartSourceLogs = null,
    expectedHitsByDate = {},
    xbaFallback = null,
  } = options;

  const games = windowSize ? gameLogs.slice(-windowSize) : gameLogs;
  if (!games.length) return null;

  const totals = games.reduce((acc, g) => {
    acc.h += g.h;
    acc.ab += g.ab;
    acc.doubles += g.doubles || 0;
    acc.triples += g.triples || 0;
    acc.hr += g.hr || 0;
    acc.bb += g.bb || 0;
    acc.hbp += g.hbp || 0;
    acc.sf += g.sf || 0;
    acc.pa += g.pa || 0;
    acc.expectedHits += getExpectedHitsForGame(g, expectedHitsByDate, xbaFallback);
    return acc;
  }, {
    h: 0,
    ab: 0,
    doubles: 0,
    triples: 0,
    hr: 0,
    bb: 0,
    hbp: 0,
    sf: 0,
    pa: 0,
    expectedHits: 0,
  });

  const ba = totals.ab > 0 ? parseFloat((totals.h / totals.ab).toFixed(3)) : null;
  const xba = totals.ab > 0 ? parseFloat((totals.expectedHits / totals.ab).toFixed(3)) : xbaFallback;
  const singles = Math.max(0, totals.h - totals.doubles - totals.triples - totals.hr);
  const totalBases = singles + 2 * totals.doubles + 3 * totals.triples + 4 * totals.hr;
  const slg = totals.ab > 0 ? parseFloat((totalBases / totals.ab).toFixed(3)) : null;
  const obpDen = totals.ab + totals.bb + totals.hbp + totals.sf;
  const obp = obpDen > 0
    ? parseFloat(((totals.h + totals.bb + totals.hbp) / obpDen).toFixed(3))
    : null;
  const ops = obp != null && slg != null ? parseFloat((obp + slg).toFixed(3)) : null;

  const rolling = computeRolling(chartSourceLogs || games, {
    rollingN: ROLLING_WINDOW,
    expectedHitsByDate,
    xbaFallback,
  });

  return {
    ba,
    xba: Number.isFinite(xba) ? xba : null,
    ops,
    slg,
    obp,
    hr: totals.hr,
    pa: totals.pa,
    games: games.length,
    rolling,
  };
}

function formatBenchmarkTeam(row, statKey) {
  if (!row) return null;
  return {
    teamId: row.teamId,
    abbr: row.abbr,
    name: row.name,
    value: statKey === "hr" ? row[statKey] : parseFloat(row[statKey].toFixed(3)),
  };
}

function rankTeamsByStat(rows, statKey) {
  const valid = rows
    .filter((row) => row.stats && Number.isFinite(row.stats[statKey]))
    .sort((a, b) => {
      if (b.stats[statKey] !== a.stats[statKey]) return b.stats[statKey] - a.stats[statKey];
      return a.teamId - b.teamId;
    });

  return valid.map((row, index) => ({
    teamId: row.teamId,
    rank: index + 1,
    value: row.stats[statKey],
  }));
}

function buildExpectedStatBenchmark(rows, statKey) {
  const valid = rows
    .filter((row) => Number.isFinite(row?.[statKey]))
    .sort((a, b) => {
      if (a[statKey] !== b[statKey]) return a[statKey] - b[statKey];
      return a.teamId - b.teamId;
    });

  const avg = valid.length
    ? parseFloat((valid.reduce((sum, row) => sum + row[statKey], 0) / valid.length).toFixed(3))
    : null;

  return {
    avg,
    worst: valid.length ? formatBenchmarkTeam({
      teamId: valid[0].teamId,
      abbr: valid[0].abbr,
      name: valid[0].name,
      [statKey]: valid[0][statKey],
    }, statKey) : null,
    best: valid.length ? formatBenchmarkTeam({
      teamId: valid[valid.length - 1].teamId,
      abbr: valid[valid.length - 1].abbr,
      name: valid[valid.length - 1].name,
      [statKey]: valid[valid.length - 1][statKey],
    }, statKey) : null,
  };
}

function computeTeamComparisons(teams, logsByTeamId, expectedHitsByTeamId, leagueAvg) {
  const windows = [
    { key: "season", windowSize: null },
    { key: "last20", windowSize: 20 },
    { key: "last10", windowSize: 10 },
  ];
  const statsByWindow = {};

  windows.forEach((window) => {
    statsByWindow[window.key] = teams.map((team) => {
      const logs = logsByTeamId[String(team.id)] || [];
      const stats = logs.length
        ? buildWindowStats(logs, {
            windowSize: window.windowSize,
            chartSourceLogs: logs,
            expectedHitsByDate: expectedHitsByTeamId[String(team.id)] || {},
            xbaFallback: leagueAvg.xba,
          })
        : null;
      return {
        teamId: team.id,
        abbr: team.abbr,
        name: team.name,
        stats,
      };
    }).filter((row) => row.stats);
  });

  function benchmarkForRows(rows, statKey) {
    const valid = rows
      .filter((row) => Number.isFinite(row.stats[statKey]))
      .sort((a, b) => {
        if (a.stats[statKey] !== b.stats[statKey]) return a.stats[statKey] - b.stats[statKey];
        return a.teamId - b.teamId;
      });
    const avg = valid.length
      ? (statKey === "hr"
        ? parseFloat((valid.reduce((sum, row) => sum + row.stats[statKey], 0) / valid.length).toFixed(1))
        : parseFloat((valid.reduce((sum, row) => sum + row.stats[statKey], 0) / valid.length).toFixed(3)))
      : statKey === "hr" ? 0 : null;
    return {
      avg,
      worst: valid.length ? formatBenchmarkTeam({
        teamId: valid[0].teamId,
        abbr: valid[0].abbr,
        name: valid[0].name,
        [statKey]: valid[0].stats[statKey],
      }, statKey) : null,
      best: valid.length ? formatBenchmarkTeam({
        teamId: valid[valid.length - 1].teamId,
        abbr: valid[valid.length - 1].abbr,
        name: valid[valid.length - 1].name,
        [statKey]: valid[valid.length - 1].stats[statKey],
      }, statKey) : null,
    };
  }

  const metsRanks = {};
  const teamBenchmarks = {};
  windows.forEach((window) => {
    const rows = statsByWindow[window.key];
    metsRanks[window.key] = {};
    teamBenchmarks[window.key] = {};
    ["ba", "xba", "ops", "hr"].forEach((statKey) => {
      const ranked = rankTeamsByStat(rows, statKey);
      const metsRank = ranked.find((row) => row.teamId === TEAM_ID);
      metsRanks[window.key][statKey] = metsRank ? metsRank.rank : null;
      teamBenchmarks[window.key][statKey] = benchmarkForRows(rows, statKey);
    });
  });

  return {
    teamBenchmarks,
    metsRanks,
  };
}

async function getLeagueAverages(leagueExpectedStats) {
  const data = await fetchJson(
    `https://statsapi.mlb.com/api/v1/teams/stats?stats=season&season=${SEASON}&group=hitting&sportIds=1`
  );
  const splits = data?.stats?.[0]?.splits;
  if (!Array.isArray(splits) || !splits.length) {
    console.warn("[trends] Could not fetch league averages, using fallbacks");
    return { ba: 0.243, obp: 0.310, slg: 0.389, ops: 0.699, xba: 0.243 };
  }

  let totalAB = 0;
  let totalH = 0;
  let totalTB = 0;
  const opsValues = [];
  const obpValues = [];

  splits.forEach((split) => {
    const stat = split.stat || {};
    const ab = stat.atBats || 0;
    totalAB += ab;
    totalH += stat.hits || 0;
    if (stat.ops) opsValues.push(parseFloat(stat.ops));
    if (stat.obp) obpValues.push(parseFloat(stat.obp));
    if (stat.slg) totalTB += parseFloat(stat.slg) * ab;
  });

  const ba = totalAB > 0 ? parseFloat((totalH / totalAB).toFixed(3)) : 0.243;
  const obp = obpValues.length
    ? parseFloat((obpValues.reduce((sum, value) => sum + value, 0) / obpValues.length).toFixed(3))
    : 0.310;
  const slg = totalAB > 0 ? parseFloat((totalTB / totalAB).toFixed(3)) : 0.389;
  const ops = opsValues.length
    ? parseFloat((opsValues.reduce((sum, value) => sum + value, 0) / opsValues.length).toFixed(3))
    : 0.699;
  const xba = weightedAverage(leagueExpectedStats.entries, "xba", "pa") || ba;

  console.log(`[trends] League averages: BA=${ba}, xBA=${xba}, OBP=${obp}, SLG=${slg}, OPS=${ops}`);
  return { ba, xba, obp, slg, ops };
}

async function main() {
  console.log("[trends] Starting build...");

  const [hitters, teams] = await Promise.all([
    getActiveHitters(),
    getLeagueTeams(),
  ]);
  const teamsByAbbr = teams.reduce((acc, team) => {
    acc[team.abbr] = team;
    return acc;
  }, {});

  const [metsExpectedStats, leagueExpectedStats, statcastExpected, leagueTeamExpectedHits, leagueTeamLogs] = await Promise.all([
    getExpectedStatsLeaderboard(TEAM_ID),
    getExpectedStatsLeaderboard(null),
    getMetsStatcastExpectedHits(hitters),
    getLeagueStatcastExpectedHits(teamsByAbbr),
    Promise.all(teams.map(async (team) => ({
      teamId: team.id,
      logs: await getTeamGameLog(team.id),
    }))),
  ]);
  const leagueAvg = await getLeagueAverages(leagueExpectedStats);
  const teamExpectedSummaries = await getTeamExpectedStatSummaries(teams, {
    [String(TEAM_ID)]: metsExpectedStats,
  });
  const logsByTeamId = leagueTeamLogs.reduce((acc, row) => {
    acc[String(row.teamId)] = row.logs.sort((a, b) => a.date.localeCompare(b.date));
    return acc;
  }, {});
  const { teamBenchmarks, metsRanks } = computeTeamComparisons(
    teams,
    logsByTeamId,
    leagueTeamExpectedHits,
    leagueAvg
  );
  const seasonExpectedRows = Object.values(teamExpectedSummaries).filter((row) => Number.isFinite(row.xba));
  seasonExpectedRows.sort((a, b) => {
    if (b.xba !== a.xba) return b.xba - a.xba;
    return a.teamId - b.teamId;
  });
  const metsSeasonExpectedRank = seasonExpectedRows.findIndex((row) => row.teamId === TEAM_ID) + 1;
  if (metsSeasonExpectedRank > 0) {
    metsRanks.season.xba = metsSeasonExpectedRank;
  }
  teamBenchmarks.season.xba = buildExpectedStatBenchmark(seasonExpectedRows, "xba");

  console.log(
    `[trends] Found ${hitters.length} active hitters, ` +
    `${Object.keys(metsExpectedStats.byPlayerId).length} expected-stat entries`
  );

  const playerResults = [];
  const playerLogs = [];

  for (const hitter of hitters) {
    const logs = await getPlayerGameLog(hitter.mlbId);
    playerLogs.push(logs);
    if (logs.length < 3) continue;

    const fallbackXba = metsExpectedStats.byPlayerId[hitter.mlbId]?.xba ?? null;
    const expectedHitsByDate = statcastExpected.byPlayerDate[String(hitter.mlbId)] || {};

    playerResults.push({
      name: hitter.name,
      mlbId: hitter.mlbId,
      position: hitter.position,
      season: buildWindowStats(logs, {
        chartSourceLogs: logs,
        expectedHitsByDate,
        xbaFallback: fallbackXba,
      }),
      last20: buildWindowStats(logs, {
        windowSize: 20,
        chartSourceLogs: logs,
        expectedHitsByDate,
        xbaFallback: fallbackXba,
      }),
      last10: buildWindowStats(logs, {
        windowSize: 10,
        chartSourceLogs: logs,
        expectedHitsByDate,
        xbaFallback: fallbackXba,
      }),
    });
  }

  const teamLogs = logsByTeamId[String(TEAM_ID)] || [];
  const teamFallbackXba = teamExpectedSummaries[String(TEAM_ID)]?.xba || leagueAvg.xba;
  const teamExpectedHitsByDate = leagueTeamExpectedHits[String(TEAM_ID)] || statcastExpected.teamByDate;
  const teamSeasonStats = buildWindowStats(teamLogs, {
    chartSourceLogs: teamLogs,
    expectedHitsByDate: teamExpectedHitsByDate,
    xbaFallback: teamFallbackXba,
  });
  if (teamSeasonStats && Number.isFinite(teamExpectedSummaries[String(TEAM_ID)]?.xba)) {
    teamSeasonStats.xba = teamExpectedSummaries[String(TEAM_ID)].xba;
  }

  const output = {
    generatedAt: new Date().toISOString(),
    season: SEASON,
    rollingWindow: ROLLING_WINDOW,
    leagueAvg,
    teamBenchmarks,
    team: {
      season: {
        ...teamSeasonStats,
        ranks: metsRanks.season,
      },
      last20: {
        ...buildWindowStats(teamLogs, {
          windowSize: 20,
          chartSourceLogs: teamLogs,
          expectedHitsByDate: teamExpectedHitsByDate,
          xbaFallback: teamFallbackXba,
        }),
        ranks: metsRanks.last20,
      },
      last10: {
        ...buildWindowStats(teamLogs, {
          windowSize: 10,
          chartSourceLogs: teamLogs,
          expectedHitsByDate: teamExpectedHitsByDate,
          xbaFallback: teamFallbackXba,
        }),
        ranks: metsRanks.last10,
      },
    },
    players: playerResults.sort((a, b) => (b.season?.pa || 0) - (a.season?.pa || 0)),
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  replaceHtmlBlock(TRENDS_HTML_PATH, "SEO_TRENDS_SUMMARY", buildTrendsSeoSummary(output));
  console.log(`[trends] Wrote ${OUTPUT_PATH} (${playerResults.length} players)`);
}

main().catch((e) => {
  console.error("[trends] Fatal error:", e);
  process.exit(1);
});
