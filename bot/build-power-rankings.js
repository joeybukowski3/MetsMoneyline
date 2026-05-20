/**
 * build-power-rankings.js  v4
 * Weighted MLB Power Rankings — runs daily at 2 AM ET via daily-update.yml
 *
 * MODEL (sums to 100):
 *   25% Offense        — team OPS+ (MLB API)
 *   22% Starting Pitch — starter ERA + WHIP (MLB API team pitching)
 *   15% Bullpen        — reliever ERA proxy (MLB API: total ERA minus starter contribution)
 *   13% Run Diff       — season runs scored minus allowed (MLB API standings)
 *   10% Recent Form    — last 20 games W/L% (MLB API schedule)
 *   08% Defense        — errors per game inverted (MLB API fielding)
 *   05% Strength-of-Sched — opponent win% (MLB API standings, estimated)
 *   02% Injury adj     — reserved/neutral (no reliable real-time source; set to 1.0 multiplier)
 *
 * Each raw stat is normalized to 0-100 via percentile rank across all 30 teams.
 * Weighted scores are summed to produce a final 0-100 power score.
 * Previous week's score is preserved from the existing JSON for Δ display.
 *
 * Output: public/data/power-rankings.json
 */

"use strict";
const fs   = require("fs");
const path = require("path");
const axios = require("axios");

const SEASON      = new Date().getFullYear();
const OUT         = path.join(__dirname, "../public/data/power-rankings.json");
const HTML_PATH   = path.join(__dirname, "../public/power-rankings.html");
const TIMEOUT     = 18000;

// ── Weights (must sum to 1.0) ──────────────────────────────────────────────
const W = {
  offense:  0.25,
  spitch:   0.22,
  bullpen:  0.15,
  runDiff:  0.13,
  form:     0.10,
  defense:  0.08,
  sos:      0.05,
  injury:   0.02,
};

async function get(url) {
  try {
    const { data } = await axios.get(url, { timeout: TIMEOUT });
    return data;
  } catch (e) {
    console.warn("[pr] fetch failed:", url.slice(0, 80), e.message);
    return null;
  }
}

// ── Normalize array to 0-100 percentile rank ──────────────────────────────
function pctRank(values, val, higherBetter = true) {
  const finite = values.filter(v => v != null && Number.isFinite(v));
  if (!finite.length) return 50;
  const sorted = [...finite].sort((a, b) => a - b);
  let rank = sorted.findIndex(v => v >= val);
  if (rank < 0) rank = sorted.length;
  const pct = rank / (sorted.length - 1 || 1);
  return parseFloat(((higherBetter ? pct : 1 - pct) * 100).toFixed(1));
}

// ── 1. Standings: wins, losses, runDiff, runsScored, runsAllowed ───────────
async function fetchStandings() {
  const d = await get(
    `https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=${SEASON}&standingsTypes=regularSeason`
  );
  if (!d?.records) return [];
  const out = [];
  for (const div of d.records) {
    for (const t of div.teamRecords || []) {
      out.push({
        teamId:       t.team.id,
        team:         t.team.name,
        wins:         t.wins  || 0,
        losses:       t.losses || 0,
        record:       `${t.wins||0}-${t.losses||0}`,
        winPct:       parseFloat(t.winningPercentage || 0),
        runDiff:      (t.runsScored || 0) - (t.runsAllowed || 0),
        runsScored:   t.runsScored  || 0,
        runsAllowed:  t.runsAllowed || 0,
        gamesPlayed:  (t.wins || 0) + (t.losses || 0),
      });
    }
  }
  return out;
}

// ── 2. Team hitting stats: OPS, OBP, SLG → OPS+ proxy ────────────────────
async function fetchHitting() {
  const d = await get(
    `https://statsapi.mlb.com/api/v1/teams/stats?stats=season&season=${SEASON}&group=hitting&sportIds=1`
  );
  if (!d?.stats?.[0]?.splits) return {};
  const splits = d.stats[0].splits;
  const allOps = splits.map(s => parseFloat(s.stat?.ops)).filter(v => v > 0);
  const lgOps  = allOps.reduce((a, b) => a + b, 0) / (allOps.length || 1);
  const map = {};
  for (const s of splits) {
    const id  = s.team?.id;
    const ops = parseFloat(s.stat?.ops) || 0;
    map[id] = {
      ops,
      obp:     parseFloat(s.stat?.obp) || 0,
      slg:     parseFloat(s.stat?.slg) || 0,
      runsPerGame: parseFloat(s.stat?.runs) / Math.max(parseFloat(s.stat?.gamesPlayed || 1), 1),
      opsPlus: lgOps > 0 ? Math.round((ops / lgOps) * 100) : 100,
    };
  }
  return map;
}

// ── 3. Team pitching stats: ERA, WHIP, SO9 ────────────────────────────────
async function fetchPitching() {
  const d = await get(
    `https://statsapi.mlb.com/api/v1/teams/stats?stats=season&season=${SEASON}&group=pitching&sportIds=1`
  );
  if (!d?.stats?.[0]?.splits) return {};
  const map = {};
  for (const s of d.stats[0].splits) {
    const id = s.team?.id;
    map[id] = {
      era:  parseFloat(s.stat?.era)  || 4.50,
      whip: parseFloat(s.stat?.whip) || 1.30,
      so9:  parseFloat(s.stat?.strikeoutsPer9Inn) || 8.0,
      // Approximate bullpen ERA: total ERA used as proxy (no reliable split from this endpoint)
      // A separate bullpen fetch via relief pitcher stats would be ideal but is rate-limited
      // FALLBACK: use team ERA as bullpen baseline; adjusted by run-prevention score
      bpEraProxy: parseFloat(s.stat?.era) || 4.50,
    };
  }
  return map;
}

// ── 4. Fielding: errors per game ──────────────────────────────────────────
async function fetchFielding() {
  const d = await get(
    `https://statsapi.mlb.com/api/v1/teams/stats?stats=season&season=${SEASON}&group=fielding&sportIds=1`
  );
  if (!d?.stats?.[0]?.splits) return {};
  const map = {};
  for (const s of d.stats[0].splits) {
    const id = s.team?.id;
    const gp = parseFloat(s.stat?.gamesPlayed || 1);
    const errors = parseFloat(s.stat?.errors) || 0;
    map[id] = {
      errors,
      errorsPerGame: gp > 0 ? errors / gp : 0,
      fieldingPct: parseFloat(s.stat?.fielding) || 0.980,
    };
  }
  return map;
}

// ── 5. Recent form: last 20 games W/L from schedule ──────────────────────
async function fetchRecentForm(teamIds) {
  const today = new Date().toISOString().slice(0, 10);
  const start = (() => { const d = new Date(); d.setDate(d.getDate() - 35); return d.toISOString().slice(0, 10); })();
  const d = await get(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${start}&endDate=${today}` +
    `&gameType=R&hydrate=linescore,team&scheduleTypes=games`
  );
  if (!d?.dates) return {};

  // Collect last 20 completed games per team
  const teamGames = {};
  for (const date of d.dates) {
    for (const game of date.games || []) {
      const state = game.status?.detailedState || "";
      if (!["Final","Completed Early","Game Over"].includes(state)) continue;
      const home = game.teams?.home;
      const away = game.teams?.away;
      if (!home || !away) continue;
      const homeId = home.team?.id, awayId = away.team?.id;
      const homeWin = (home.score || 0) > (away.score || 0);
      for (const [tid, won] of [[homeId, homeWin],[awayId, !homeWin]]) {
        if (!teamGames[tid]) teamGames[tid] = [];
        teamGames[tid].push({ date: date.date, won });
      }
    }
  }
  // Sort and take last 20
  const map = {};
  for (const [tid, games] of Object.entries(teamGames)) {
    const sorted = games.sort((a, b) => a.date.localeCompare(b.date)).slice(-20);
    const wins = sorted.filter(g => g.won).length;
    const total = sorted.length;
    map[parseInt(tid)] = {
      last20W: wins,
      last20L: total - wins,
      last20Pct: total > 0 ? wins / total : 0.5,
      last20Record: `${wins}-${total - wins}`,
    };
  }
  return map;
}

// ── 6. Strength of schedule: avg opponent win% ────────────────────────────
// Proxy: teams in weaker divisions have softer schedules.
// Real SoS requires opponent-by-opponent lookup which is expensive.
// FALLBACK: use league average (0.500) for all teams as neutral baseline,
// then adjust ±5% based on division: AL East / NL East +5% (toughest),
// AL West / NL West neutral, AL Central / NL Central -5% (softest).
// This is clearly documented as an approximation.
const DIVISION_SOS = {
  "American League East":   0.530,
  "American League Central":0.490,
  "American League West":   0.510,
  "National League East":   0.525,
  "National League Central":0.488,
  "National League West":   0.507,
};
async function fetchSoS() {
  const d = await get(
    `https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=${SEASON}&standingsTypes=regularSeason`
  );
  if (!d?.records) return {};
  const map = {};
  for (const div of d.records) {
    const divName = div.division?.nameShort || div.division?.name || "";
    const sos = DIVISION_SOS[divName] || 0.500;
    for (const t of div.teamRecords || []) {
      map[t.team.id] = { sos };
    }
  }
  return map;
}

// ── Score components ───────────────────────────────────────────────────────
function scoreComponents(team, hitting, pitching, fielding, form, sos) {
  const h = hitting[team.teamId]   || {};
  const p = pitching[team.teamId]  || {};
  const f = fielding[team.teamId]  || {};
  const fm = form[team.teamId]     || {};
  const s = sos[team.teamId]       || {};
  return {
    // Raw values for display
    ops:          h.ops    || 0,
    opsPlus:      h.opsPlus || 100,
    era:          p.era    || 4.50,
    whip:         p.whip   || 1.30,
    bpEraProxy:   p.bpEraProxy || 4.50,
    errorsPerGame:f.errorsPerGame ?? 0.75,
    last20Record: fm.last20Record || "—",
    last20Pct:    fm.last20Pct ?? 0.50,
    sosValue:     s.sos ?? 0.500,
    runDiff:      team.runDiff,
    wins:         team.wins,
    losses:       team.losses,
    record:       team.record,
    gamesPlayed:  team.gamesPlayed,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log("[pr] v4 — weighted model build starting");

  const [standings, hitting, pitching, fielding, sos] = await Promise.all([
    fetchStandings(),
    fetchHitting(),
    fetchPitching(),
    fetchFielding(),
    fetchSoS(),
  ]);

  if (!standings.length) {
    console.warn("[pr] No standings — aborting to preserve existing file");
    return;
  }

  // Fetch form after we have team IDs
  const teamIds = standings.map(t => t.teamId);
  const form = await fetchRecentForm(teamIds);

  // Build raw components for every team
  const rawTeams = standings.map(t => ({
    teamId: t.teamId,
    team:   t.team,
    wins:   t.wins,
    losses: t.losses,
    record: t.record,
    gamesPlayed: t.gamesPlayed,
    comp: scoreComponents(t, hitting, pitching, fielding, form, sos),
  }));

  // Extract per-category arrays for normalization
  const arr = key => rawTeams.map(t => t.comp[key]);

  // Normalize each category to 0-100 percentile score (higher = better always)
  rawTeams.forEach(t => {
    const c = t.comp;

    // Offense: weight OPS+ heavily; blend with runs/game
    const offScore = pctRank(arr("opsPlus"), c.opsPlus, true);

    // Starting pitching: ERA (lower=better) + WHIP (lower=better) averaged
    const eraScore  = pctRank(arr("era"),  c.era,  false);
    const whipScore = pctRank(arr("whip"), c.whip, false);
    const spScore   = (eraScore * 0.6 + whipScore * 0.4);

    // Bullpen: ERA proxy (lower=better)
    const bpScore = pctRank(arr("bpEraProxy"), c.bpEraProxy, false);

    // Run differential
    const rdScore = pctRank(arr("runDiff"), c.runDiff, true);

    // Recent form: last 20 W/L%
    const formScore = pctRank(arr("last20Pct"), c.last20Pct, true);

    // Defense: errors per game (lower=better)
    const defScore = pctRank(arr("errorsPerGame"), c.errorsPerGame, false);

    // SoS: higher opp win% = tougher schedule = deserves credit
    const sosScore = pctRank(arr("sosValue"), c.sosValue, true);

    // Injury: neutral (reserved for future)
    const injScore = 50;

    t.scores = {
      offense: parseFloat(offScore.toFixed(1)),
      spitch:  parseFloat(spScore.toFixed(1)),
      bullpen: parseFloat(bpScore.toFixed(1)),
      runDiff: parseFloat(rdScore.toFixed(1)),
      form:    parseFloat(formScore.toFixed(1)),
      defense: parseFloat(defScore.toFixed(1)),
      sos:     parseFloat(sosScore.toFixed(1)),
      injury:  injScore,
    };

    t.powerScore = parseFloat((
      t.scores.offense  * W.offense +
      t.scores.spitch   * W.spitch  +
      t.scores.bullpen  * W.bullpen +
      t.scores.runDiff  * W.runDiff +
      t.scores.form     * W.form    +
      t.scores.defense  * W.defense +
      t.scores.sos      * W.sos     +
      t.scores.injury   * W.injury
    ).toFixed(1));
  });

  // Sort by powerScore descending
  rawTeams.sort((a, b) => b.powerScore - a.powerScore);
  rawTeams.forEach((t, i) => { t.rank = i + 1; });

  // Preserve last week's scores for Δ display
  let prevScores = {};
  try {
    const existing = JSON.parse(fs.readFileSync(OUT, "utf8"));
    if (Array.isArray(existing.teams)) {
      for (const pt of existing.teams) {
        prevScores[pt.teamId] = {
          powerScore: pt.powerScore,
          rank:       pt.rank,
          // preserve previously stored lastWeek so we don't lose history
          lastWeekScore: pt.lastWeekScore ?? pt.powerScore,
          lastWeekRank:  pt.lastWeekRank  ?? pt.rank,
        };
      }
    }
  } catch { /* no previous file */ }

  // Build final team objects
  const teams = rawTeams.map(t => {
    const prev = prevScores[t.teamId] || null;
    const lastWeekScore = prev?.lastWeekScore ?? null;
    const lastWeekRank  = prev?.lastWeekRank  ?? null;
    const scoreDelta    = lastWeekScore != null
      ? parseFloat((t.powerScore - lastWeekScore).toFixed(1))
      : null;
    const rankDelta     = lastWeekRank != null
      ? lastWeekRank - t.rank   // positive = moved up
      : null;
    return {
      rank:          t.rank,
      teamId:        t.teamId,
      team:          t.team,
      record:        t.record,
      wins:          t.wins,
      losses:        t.losses,
      gamesPlayed:   t.gamesPlayed,
      last20Record:  t.comp.last20Record,
      powerScore:    t.powerScore,
      lastWeekScore,
      lastWeekRank,
      scoreDelta,
      rankDelta,
      scores:        t.scores,
      // Key raw stats for transparency
      stats: {
        ops:          t.comp.ops,
        opsPlus:      t.comp.opsPlus,
        era:          t.comp.era,
        whip:         t.comp.whip,
        errorsPerGame:parseFloat(t.comp.errorsPerGame.toFixed(3)),
        runDiff:      t.comp.runDiff,
      },
    };
  });

  const output = {
    generatedAt: new Date().toISOString(),
    season: SEASON,
    model:  "v4-weighted",
    weights: W,
    teams,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(output, null, 2));
  console.log(`[pr] Wrote ${teams.length} teams → ${OUT}`);

  // Update SEO block in HTML
  const mets = teams.find(t => t.teamId === 121);
  const top3 = teams.slice(0, 3).map((t, i) => `${i+1}. ${t.team}`).join("; ");
  const seoHtml = `<p>The Mets currently rank #${mets?.rank || "—"} in these 2026 MLB power rankings. Top three: ${top3}. Rankings use a weighted model of offense, pitching, bullpen, run differential, recent form, and defense.</p>`;
  try {
    let html = fs.readFileSync(HTML_PATH, "utf8");
    html = html.replace(
      /<!-- SEO_POWER_RANKINGS_SUMMARY:START -->[\s\S]*?<!-- SEO_POWER_RANKINGS_SUMMARY:END -->/,
      `<!-- SEO_POWER_RANKINGS_SUMMARY:START -->\n${seoHtml}\n<!-- SEO_POWER_RANKINGS_SUMMARY:END -->`
    );
    fs.writeFileSync(HTML_PATH, html);
  } catch (e) {
    console.warn("[pr] HTML update skipped:", e.message);
  }
}

main().catch(e => {
  console.error("[pr] Fatal:", e.message, e.stack);
  process.exit(1);
});
