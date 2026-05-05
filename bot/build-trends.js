/**
 * build-trends.js
 * Generates public/data/trends.json with BA vs xBA trend data
 * for the Mets team and individual hitters.
 *
 * Data sources:
 *   - MLB Stats API: game logs for BA/OPS/SLG per game
 *   - Baseball Savant: expected stats (xBA) from CSV leaderboards
 *
 * Usage: node bot/build-trends.js
 * Add to a GitHub Actions workflow to run daily.
 */

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { parse } = require("csv-parse/sync");

const TEAM_ID = 121;
const SEASON = new Date().getFullYear();
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

/* ── MLB Stats API: Mets active roster hitters ── */
async function getActiveHitters() {
  const data = await fetchJson(
    `https://statsapi.mlb.com/api/v1/teams/${TEAM_ID}/roster/active?season=${SEASON}`
  );
  if (!data || !data.roster) return [];
  return data.roster
    .filter(p => {
      const type = p.position?.type;
      return type !== "Pitcher";
    })
    .map(p => ({
      mlbId: p.person.id,
      name: p.person.fullName,
      position: p.position?.abbreviation || "",
    }));
}

/* ── MLB Stats API: player game log for the season ── */
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

/* ── Baseball Savant: expected stats for team hitters ── */
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

/* ── Compute rolling averages from game logs ── */
function computeRolling(gameLogs, windowSize) {
  const labels = [];
  const baValues = [];
  let totalH = 0, totalAB = 0;

  const games = windowSize ? gameLogs.slice(-windowSize) : gameLogs;

  games.forEach((g, i) => {
    totalH += g.h;
    totalAB += g.ab;
    const rollingBA = totalAB > 0 ? totalH / totalAB : 0;
    labels.push(g.date ? g.date.slice(5) : `G${i + 1}`);
    baValues.push(parseFloat(rollingBA.toFixed(3)));
  });

  return { labels, ba: baValues };
}

/* ── Build window stats (season / last20 / last10) ── */
function buildWindowStats(gameLogs, savantData, windowSize) {
  const games = windowSize ? gameLogs.slice(-windowSize) : gameLogs;
  if (games.length === 0) return null;

  const totals = games.reduce((acc, g) => {
    acc.h += g.h;
    acc.ab += g.ab;
    acc.doubles += g.doubles || 0;
    acc.triples += g.triples || 0;
    acc.hr += g.hr;
    acc.bb += g.bb || 0;
    acc.hbp += g.hbp || 0;
    acc.sf += g.sf || 0;
    acc.pa += g.pa;
    return acc;
  }, { h: 0, ab: 0, doubles: 0, triples: 0, hr: 0, bb: 0, hbp: 0, sf: 0, pa: 0 });

  const ba = totals.ab > 0 ? totals.h / totals.ab : null;
  const singles = Math.max(0, totals.h - totals.doubles - totals.triples - totals.hr);
  const totalBases = singles + (2 * totals.doubles) + (3 * totals.triples) + (4 * totals.hr);
  const slg = totals.ab > 0 ? totalBases / totals.ab : null;
  const obpDenominator = totals.ab + totals.bb + totals.hbp + totals.sf;
  const obp = obpDenominator > 0 ? (totals.h + totals.bb + totals.hbp) / obpDenominator : null;
  const ops = obp != null && slg != null ? obp + slg : null;
  const rolling = computeRolling(games);
  // xBA is only available as a season-level stat from Savant
  const xba = savantData?.xba ?? null;

  // For the rolling xBA line, use a flat line at the season xBA
  // (Savant doesn't provide per-game xBA)
  const xbaLine = rolling.labels.map(() => xba);

  return {
    ba, xba,
    ops,
    slg,
    hr: totals.hr,
    pa: totals.pa,
    games: games.length,
    rolling: { labels: rolling.labels, ba: rolling.ba, xba: xbaLine },
  };
}

/* ── Main ── */
async function main() {
  console.log("[trends] Starting build...");

  const [hitters, savantMap] = await Promise.all([
    getActiveHitters(),
    getSavantExpectedStats(),
  ]);

  console.log(`[trends] Found ${hitters.length} active hitters, ${Object.keys(savantMap).length} savant entries`);

  // Fetch game logs for each hitter
  const playerResults = [];
  const playerLogs = [];
  for (const hitter of hitters) {
    const logs = await getPlayerGameLog(hitter.mlbId);
    playerLogs.push(logs);
    if (logs.length < 3) continue; // skip players with very few games
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

  // Build team-level aggregation
  const allLogs = playerLogs.flat();
  // Group by date for team-level rolling
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
      };
    }
    byDate[g.date].h += g.h;
    byDate[g.date].ab += g.ab;
    byDate[g.date].doubles += g.doubles || 0;
    byDate[g.date].triples += g.triples || 0;
    byDate[g.date].hr += g.hr;
    byDate[g.date].bb += g.bb || 0;
    byDate[g.date].hbp += g.hbp || 0;
    byDate[g.date].sf += g.sf || 0;
    byDate[g.date].pa += g.pa;
  });
  const teamLogs = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

  // Team-level Savant: average xBA across all hitters
  const savantValues = Object.values(savantMap).filter(v => v.xba != null);
  const teamXba = savantValues.length > 0
    ? savantValues.reduce((s, v) => s + v.xba, 0) / savantValues.length
    : null;
  const teamSavant = { xba: teamXba };

  const output = {
    generatedAt: new Date().toISOString(),
    season: SEASON,
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
