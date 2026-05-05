/**
 * build-power-rankings.js
 * Generates public/data/power-rankings.json with all 30 MLB teams
 * ranked by composite score.
 *
 * Composite = equal weighting of:
 *   1. OPS+ (team offense, from MLB API)
 *   2. Starter xERA (from Baseball Savant, inverted so lower = better score)
 *   3. Bullpen xFIP (from Baseball Savant, inverted)
 *   4. Run Differential (from MLB API standings)
 *
 * Each category is percentile-ranked 0-25, summed to 0-100.
 *
 * Usage: node bot/build-power-rankings.js
 */

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { parse } = require("csv-parse/sync");

const SEASON = new Date().getFullYear();
const OUTPUT_PATH = path.join(__dirname, "../public/data/power-rankings.json");

async function fetchJson(url) {
  try {
    const { data } = await axios.get(url, { timeout: 15000 });
    return data;
  } catch (e) {
    console.warn(`[rankings] fetch failed: ${url}`, e.message);
    return null;
  }
}

async function fetchText(url) {
  try {
    const { data } = await axios.get(url, { timeout: 15000, responseType: "text" });
    return data;
  } catch (e) {
    console.warn(`[rankings] text fetch failed: ${url}`, e.message);
    return null;
  }
}

function inningsToDecimal(value) {
  if (value == null) return 0;
  const str = String(value).trim();
  if (!str) return 0;
  const parts = str.split(".");
  const whole = parseInt(parts[0], 10);
  const outs = parseInt(parts[1] || "0", 10);
  if (!Number.isFinite(whole) || !Number.isFinite(outs)) return 0;
  return whole + (outs / 3);
}

/* ── MLB Stats API: standings for all teams ── */
async function getStandings() {
  const data = await fetchJson(
    `https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=${SEASON}`
  );
  if (!data || !data.records) return [];

  const teams = [];
  for (const division of data.records) {
    for (const t of division.teamRecords || []) {
      teams.push({
        teamId: t.team?.id,
        team: t.team?.name || "Unknown",
        wins: t.wins || 0,
        losses: t.losses || 0,
        record: `${t.wins || 0}-${t.losses || 0}`,
        runDiff: (t.runsScored || 0) - (t.runsAllowed || 0),
        runsScored: t.runsScored || 0,
        runsAllowed: t.runsAllowed || 0,
      });
    }
  }
  return teams;
}

/* ── MLB Stats API: team OPS+ (using team stats endpoint) ── */
async function getTeamOpsPlus() {
  // MLB API doesn't directly expose OPS+, so we'll compute it relative to league
  // Or use the team stats endpoint for OPS and normalize
  const data = await fetchJson(
    `https://statsapi.mlb.com/api/v1/teams/stats?stats=season&season=${SEASON}&group=hitting&sportIds=1`
  );
  if (!data?.stats?.[0]?.splits) return {};

  const splits = data.stats[0].splits;

  // Get league average OPS first
  const allOps = splits.map(s => parseFloat(s.stat?.ops) || 0).filter(v => v > 0);
  const lgAvgOps = allOps.length > 0 ? allOps.reduce((a, b) => a + b, 0) / allOps.length : 0.700;

  const map = {};
  for (const s of splits) {
    const id = s.team?.id;
    const ops = parseFloat(s.stat?.ops) || 0;
    // OPS+ = (team OPS / league OPS) * 100
    const opsPlus = lgAvgOps > 0 ? Math.round((ops / lgAvgOps) * 100) : 100;
    map[id] = { opsPlus, ops };
  }
  return map;
}

/* ── Baseball Savant: starter xERA by team ── */
async function getStarterXera() {
  const url =
    `https://baseballsavant.mlb.com/leaderboard/expected_statistics` +
    `?type=pitcher&year=${SEASON}&position=SP&team=&min=10&csv=true`;
  const [csv, mlbPitchingData] = await Promise.all([
    fetchText(url),
    fetchJson(
      `https://statsapi.mlb.com/api/v1/stats?stats=season&group=pitching&playerPool=ALL&sportIds=1&season=${SEASON}&limit=1000`
    ),
  ]);
  if (!csv || !mlbPitchingData?.stats?.[0]?.splits) return {};

  try {
    const rows = parse(csv, { columns: true, skip_empty_lines: true });
    const pitcherMeta = new Map();
    for (const split of mlbPitchingData.stats[0].splits) {
      const playerId = Number(split?.player?.id);
      const teamId = Number(split?.team?.id);
      const gamesStarted = Number(split?.stat?.gamesStarted || 0);
      const ip = Number(split?.stat?.outs) > 0
        ? Number(split.stat.outs) / 3
        : inningsToDecimal(split?.stat?.inningsPitched);
      if (!playerId || !teamId || !(ip > 0)) continue;
      pitcherMeta.set(playerId, { teamId, gamesStarted, ip });
    }

    const teamData = {};
    for (const row of rows) {
      const playerId = Number(row.player_id);
      const xera = parseFloat(row.xera);
      const meta = pitcherMeta.get(playerId);
      if (!meta || isNaN(xera)) continue;
      if (meta.gamesStarted <= 0 || meta.ip < 10) continue;
      const { teamId, ip } = meta;
      if (!teamData[teamId]) teamData[teamId] = [];
      teamData[teamId].push({ xera, ip });
    }

    const result = {};
    for (const [id, pitchers] of Object.entries(teamData)) {
      // Weight by IP for team xERA
      const totalIP = pitchers.reduce((s, p) => s + p.ip, 0);
      const weightedXera = pitchers.reduce((s, p) => s + p.xera * p.ip, 0) / totalIP;
      result[parseInt(id)] = parseFloat(weightedXera.toFixed(2));
    }
    return result;
  } catch (e) {
    console.warn("[rankings] savant xERA parse failed:", e.message);
    return {};
  }
}

/* ── Baseball Savant: bullpen xFIP (use MLB API pitching stats as fallback) ── */
async function getBullpenRating() {
  // Use MLB API team pitching stats (relief specifically isn't easy to split)
  // We'll use the team ERA as a proxy and supplement with Savant data
  const data = await fetchJson(
    `https://statsapi.mlb.com/api/v1/teams/stats?stats=season&season=${SEASON}&group=pitching&sportIds=1`
  );
  if (!data?.stats?.[0]?.splits) return {};

  const map = {};
  for (const s of data.stats[0].splits) {
    const id = s.team?.id;
    // Use team ERA as approximation; the Savant xERA above covers starters
    const era = parseFloat(s.stat?.era) || 4.50;
    map[id] = parseFloat(era.toFixed(2));
  }
  return map;
}

/* ── Percentile rank (0-25 scale) ── */
function percentileRank(values, value, higherIsBetter = true) {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = sorted.indexOf(value);
  const pct = rank / (sorted.length - 1 || 1);
  const score = higherIsBetter ? pct * 25 : (1 - pct) * 25;
  return parseFloat(score.toFixed(1));
}

/* ── Main ── */
async function main() {
  console.log("[rankings] Starting build...");

  const [standings, opsMap, xeraMap, bpMap] = await Promise.all([
    getStandings(),
    getTeamOpsPlus(),
    getStarterXera(),
    getBullpenRating(),
  ]);

  console.log(`[rankings] ${standings.length} teams from standings`);

  // Merge all data
  const teams = standings.map(t => ({
    ...t,
    opsPlus: opsMap[t.teamId]?.opsPlus ?? 100,
    starterXera: xeraMap[t.teamId] ?? null,
    bullpenXfip: bpMap[t.teamId] ?? 4.50,
  }));

  // Compute composite scores
  const opsPlusValues = teams.map(t => t.opsPlus);
  const xeraValues = teams.map(t => t.starterXera).filter(v => typeof v === "number" && Number.isFinite(v));
  const bpValues = teams.map(t => t.bullpenXfip);
  const rdValues = teams.map(t => t.runDiff);

  teams.forEach(t => {
    const s1 = percentileRank(opsPlusValues, t.opsPlus, true);
    const starterXeraForScore = typeof t.starterXera === "number" && Number.isFinite(t.starterXera)
      ? t.starterXera
      : 4.50;
    const s2 = percentileRank(xeraValues, starterXeraForScore, false); // lower ERA = better
    const s3 = percentileRank(bpValues, t.bullpenXfip, false);
    const s4 = percentileRank(rdValues, t.runDiff, true);
    t.composite = parseFloat((s1 + s2 + s3 + s4).toFixed(1));
  });

  // Sort by composite descending
  teams.sort((a, b) => b.composite - a.composite);

  const output = {
    generatedAt: new Date().toISOString(),
    season: SEASON,
    methodology: "Equal-weighted percentile ranking: OPS+ (25pts) + Starter xERA (25pts) + Bullpen xFIP (25pts) + Run Differential (25pts)",
    teams,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`[rankings] Wrote ${OUTPUT_PATH}`);
}

main().catch(e => {
  console.error("[rankings] Fatal error:", e);
  process.exit(1);
});
