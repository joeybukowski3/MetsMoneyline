/**
 * build-game-log.js
 * Fetches ALL 2026 Mets completed games with full box score data,
 * opponent season records, home/road splits, team batting AVG, and team ERA.
 * Writes: public/data/game-log.json
 *
 * Runs daily at 3 AM ET via .github/workflows/game-log-update.yml
 * Every field regenerated from scratch each run — no stale data.
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const axios = require("axios");

const METS_TEAM_ID = 121;
const SEASON       = new Date().getFullYear();
const OUTPUT       = path.join(__dirname, "..", "public", "data", "game-log.json");

async function fetchJson(url) {
  const res = await axios.get(url, { timeout: 20000 });
  return res.data;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function timeOfDay(utc) {
  if (!utc) return "night";
  const d   = new Date(utc);
  const etH = (d.getUTCHours() - 4 + 24) % 24; // EDT (Apr–Oct)
  return etH < 17 ? "day" : "night";
}

function etLabel(utc) {
  if (!utc) return "";
  const d    = new Date(utc);
  const etH  = (d.getUTCHours() - 4 + 24) % 24;
  const etM  = d.getUTCMinutes();
  const ampm = etH >= 12 ? "PM" : "AM";
  return `${etH % 12 || 12}:${String(etM).padStart(2,"0")} ${ampm} ET`;
}

function dayOfWeek(dateStr) {
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  return days[new Date(`${dateStr}T12:00:00`).getDay()];
}

function winPct(w, l) {
  const total = w + l;
  return total > 0 ? +(w / total).toFixed(3) : null;
}

const TEAM_ABBR = {
  108:"LAA",109:"ARI",110:"BAL",111:"BOS",112:"CHC",113:"CIN",114:"CLE",
  115:"COL",116:"DET",117:"HOU",118:"KC", 119:"LAD",120:"WSH",121:"NYM",
  133:"OAK",134:"PIT",135:"SD", 136:"SEA",137:"SF", 138:"STL",139:"TB",
  140:"TEX",141:"TOR",142:"MIN",143:"PHI",144:"ATL",145:"CWS",146:"MIA",
  147:"NYY",158:"MIL"
};

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const today     = new Date().toISOString().slice(0, 10);
  const startDate = `${SEASON}-03-01`;

  // ── 1. Schedule + linescore (runs, hits) ─────────────────────────────────────
  console.log("[game-log] Fetching schedule + linescore…");
  const schedData = await fetchJson(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${METS_TEAM_ID}` +
    `&startDate=${startDate}&endDate=${today}&gameType=R&hydrate=linescore,team`
  );

  const games  = [];
  const oppIds = new Set();
  let mW=0, mL=0, mHW=0, mHL=0, mRW=0, mRL=0;

  for (const dateEntry of schedData?.dates || []) {
    for (const game of dateEntry.games || []) {
      const state   = game?.status?.detailedState || "";
      const isFinal = ["Final","Completed Early","Game Over"].includes(state);
      if (!isFinal) continue;

      const isHome  = game?.teams?.home?.team?.id === METS_TEAM_ID;
      const oppTeam = isHome ? game.teams.away : game.teams.home;
      const oppId   = oppTeam?.team?.id;
      if (oppId) oppIds.add(oppId);

      const ls       = game.linescore || {};
      const metsRuns = Number(isHome ? ls.teams?.home?.runs : ls.teams?.away?.runs) || 0;
      const metsHits = Number(isHome ? ls.teams?.home?.hits : ls.teams?.away?.hits) || 0;
      const oppRuns  = Number(isHome ? ls.teams?.away?.runs : ls.teams?.home?.runs) || 0;
      const oppHits  = Number(isHome ? ls.teams?.away?.hits : ls.teams?.home?.hits) || 0;
      const didWin   = metsRuns > oppRuns;
      const ha       = isHome ? "home" : "away";

      if (didWin) { mW++; if (isHome) mHW++; else mRW++; }
      else        { mL++; if (isHome) mHL++; else mRL++; }

      games.push({
        date:           dateEntry.date,
        dayOfWeek:      dayOfWeek(dateEntry.date),
        timeOfDay:      timeOfDay(game.gameDate),
        startTime:      etLabel(game.gameDate),
        homeAway:       ha,
        opponent:       oppTeam?.team?.name || "Unknown",
        oppAbbr:        TEAM_ABBR[oppId] || (oppTeam?.team?.abbreviation || "???"),
        oppTeamId:      oppId || null,
        metsRuns,
        metsHits,
        oppRuns,
        oppHits,
        result:         didWin ? "W" : "L",
        finalScore:     `${metsRuns}-${oppRuns}`,
        metsRecord:     `${mW}-${mL}`,
        metsHomeRecord: `${mHW}-${mHL}`,
        metsRoadRecord: `${mRW}-${mRL}`,
        // filled below
        oppRecord:      null,
        oppHomeRecord:  null,
        oppRoadRecord:  null,
        oppWins:        null,
        oppLosses:      null,
        oppWinPct:      null,
        oppSeasonAvg:   null,
        oppSeasonEra:   null,
      });
    }
  }

  games.sort((a,b) => a.date.localeCompare(b.date));
  console.log(`[game-log] ${games.length} completed games found`);
  console.log(`[game-log] ${oppIds.size} unique opponents: ${[...oppIds].join(",")}`);

  // ── 2. Standings → records + home/road splits ─────────────────────────────────
  console.log("[game-log] Fetching standings…");
  const oppMap = {}; // teamId → { overall, home, road, wins, losses, winPct }
  try {
    const sData = await fetchJson(
      `https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=${SEASON}` +
      `&standingsTypes=regularSeason&hydrate=team,record`
    );
    for (const div of sData?.records || []) {
      for (const tr of div?.teamRecords || []) {
        const tid = tr?.team?.id;
        if (!tid) continue;
        const splits  = tr?.records?.splitRecords || [];
        const findSp  = (t) => splits.find(s => s.type === t);
        const home    = findSp("home");
        const road    = findSp("road");
        const w       = tr.wins ?? 0;
        const l       = tr.losses ?? 0;
        oppMap[tid]   = {
          overall:    `${w}-${l}`,
          home:       home ? `${home.wins}-${home.losses}` : null,
          road:       road ? `${road.wins}-${road.losses}` : null,
          wins:       w,
          losses:     l,
          winPct:     winPct(w, l),
        };
      }
    }
    console.log(`[game-log] Standings loaded for ${Object.keys(oppMap).length} teams`);
  } catch (e) {
    console.warn("[game-log] Standings fetch failed:", e.message);
  }

  // ── 3. Team batting stats (season AVG) ────────────────────────────────────────
  console.log("[game-log] Fetching team batting stats…");
  const avgMap = {}; // teamId → batting avg string e.g. ".247"
  try {
    const bData = await fetchJson(
      `https://statsapi.mlb.com/api/v1/teams/stats?season=${SEASON}&sportId=1` +
      `&stats=season&group=hitting&gameType=R`
    );
    for (const split of bData?.stats?.[0]?.splits || []) {
      const tid = split?.team?.id;
      const avg = split?.stat?.avg;
      if (tid && avg != null) avgMap[tid] = avg; // already a string like ".247"
    }
    console.log(`[game-log] Batting AVG loaded for ${Object.keys(avgMap).length} teams`);
  } catch (e) {
    console.warn("[game-log] Batting stats fetch failed:", e.message);
  }

  // ── 4. Team pitching stats (season ERA) ───────────────────────────────────────
  console.log("[game-log] Fetching team pitching stats…");
  const eraMap = {}; // teamId → ERA string e.g. "3.89"
  try {
    const pData = await fetchJson(
      `https://statsapi.mlb.com/api/v1/teams/stats?season=${SEASON}&sportId=1` +
      `&stats=season&group=pitching&gameType=R`
    );
    for (const split of pData?.stats?.[0]?.splits || []) {
      const tid = split?.team?.id;
      const era = split?.stat?.era;
      if (tid && era != null) eraMap[tid] = era; // already a string like "3.89"
    }
    console.log(`[game-log] ERA loaded for ${Object.keys(eraMap).length} teams`);
  } catch (e) {
    console.warn("[game-log] Pitching stats fetch failed:", e.message);
  }

  // ── 5. Attach all opponent data to every game ─────────────────────────────────
  for (const g of games) {
    const tid = g.oppTeamId;
    if (!tid) continue;

    const rec = oppMap[tid];
    if (rec) {
      // When Mets are home, opp is the away team → use opp's road record
      // When Mets are away, opp is the home team → use opp's home record
      g.oppRecord      = rec.overall;
      g.oppHomeRecord  = rec.home;
      g.oppRoadRecord  = rec.road;
      g.oppWins        = rec.wins;
      g.oppLosses      = rec.losses;
      g.oppWinPct      = rec.winPct;
    }

    if (avgMap[tid]) g.oppSeasonAvg = avgMap[tid];
    if (eraMap[tid]) g.oppSeasonEra = eraMap[tid];
  }

  // ── 6. Fetch full-season schedule (past + future) to correctly detect series ───
  // We already have completed games through today. Now get the ENTIRE schedule
  // so series boundaries are computed from the real schedule, not just results.
  // This prevents the last completed game of an ongoing series being mislabeled
  // as the series finale.
  console.log("[game-log] Fetching full season schedule for series context…");
  const endDate = `${SEASON}-11-30`;
  let fullSched;
  try {
    fullSched = await fetchJson(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${METS_TEAM_ID}` +
      `&startDate=${startDate}&endDate=${endDate}&gameType=R&hydrate=team`
    );
  } catch (e) {
    console.warn("[game-log] Full schedule fetch failed — falling back to completed-only series detection:", e.message);
    fullSched = null;
  }

  // Build an ordered list of ALL scheduled regular-season games (date + oppTeamId)
  // This includes rainouts/postponements as "Postponed" which we track separately.
  const fullSchedule = []; // { date, oppTeamId, oppAbbr, homeAway, status }
  if (fullSched) {
    for (const dateEntry of fullSched?.dates || []) {
      for (const game of dateEntry.games || []) {
        const isHome  = game?.teams?.home?.team?.id === METS_TEAM_ID;
        const oppTeam = isHome ? game.teams.away : game.teams.home;
        const oppId   = oppTeam?.team?.id;
        const state   = game?.status?.detailedState || "";
        const isPostponed = state.toLowerCase().includes("postponed") ||
                            state.toLowerCase().includes("cancelled");
        if (oppId) {
          fullSchedule.push({
            date:      dateEntry.date,
            oppTeamId: oppId,
            oppAbbr:   TEAM_ABBR[oppId] || oppTeam?.team?.abbreviation || "???",
            opponent:  oppTeam?.team?.name || null,
            homeAway:  isHome ? "home" : "away",
            status:    isPostponed ? "postponed" : state,
            gamePk:    game.gamePk,
          });
        }
      }
    }
    fullSchedule.sort((a, b) => a.date.localeCompare(b.date));
    console.log(`[game-log] Full schedule: ${fullSchedule.length} games`);
  }

  // ── Compute series boundaries from the FULL schedule ─────────────────────────
  // Group consecutive games vs same opponent (allowing ≤1 day travel gap).
  // Each group knows its true length so we never falsely flag series finale.
  const seriesGroupByDate = {}; // date → { gameNum, seriesLength, isSeriesLast, seriesOppId }

  if (fullSchedule.length > 0) {
    let sStart = 0;
    for (let i = 1; i <= fullSchedule.length; i++) {
      const curr = fullSchedule[i] || null;
      const prev = fullSchedule[i - 1];
      const daysDiff = curr
        ? (new Date(curr.date) - new Date(prev.date)) / 86400000
        : 999;
      const newSeries = !curr
        || curr.oppTeamId !== prev.oppTeamId
        || daysDiff > 2;

      if (newSeries) {
        const len = i - sStart;
        for (let k = sStart; k < i; k++) {
          const g = fullSchedule[k];
          seriesGroupByDate[g.date + "_" + g.oppTeamId] = {
            gameNum:      k - sStart + 1,
            seriesLength: len,
            isSeriesLast: k === i - 1,
          };
        }
        sStart = i;
      }
    }
  }

  // Apply series info to completed games using the full-schedule groups.
  // Fall back to completed-only logic if full schedule wasn't available.
  if (fullSchedule.length > 0) {
    for (const g of games) {
      const key = g.date + "_" + g.oppTeamId;
      const sg  = seriesGroupByDate[key];
      if (sg) {
        g.seriesGameNum  = sg.gameNum;
        g.seriesLength   = sg.seriesLength;
        g.isSeriesLast   = sg.isSeriesLast;
      } else {
        // Game not found in full schedule (rare edge case — doubleheader, etc.)
        g.seriesGameNum  = 1;
        g.seriesLength   = 1;
        g.isSeriesLast   = false;
      }
    }
  } else {
    // Fallback: compute from completed games only (original logic)
    let seriesStart = 0;
    for (let i = 1; i <= games.length; i++) {
      const daysDiff = i < games.length
        ? (new Date(games[i].date) - new Date(games[i-1].date)) / 86400000
        : 999;
      const newSeries = i === games.length
        || games[i].oppTeamId !== games[i-1].oppTeamId
        || daysDiff > 2;

      if (newSeries) {
        const len = i - seriesStart;
        for (let k = seriesStart; k < i; k++) {
          games[k].seriesGameNum = k - seriesStart + 1;
          games[k].seriesLength  = len;
          // Only mark finale if this is truly the last game in the full schedule too
          games[k].isSeriesLast  = k === i - 1;
        }
        seriesStart = i;
      }
    }
  }

  // ── Build upcoming scheduled games (same structure, no scores) ────────────────
  // Include future games so the frontend can show the rest of an ongoing series.
  const today2 = new Date().toISOString().slice(0, 10);
  const upcomingGames = fullSchedule
    .filter(g => g.date > today2 && g.status !== "postponed")
    // no slice — include all remaining games through end of season
    .map(g => {
      const sg = seriesGroupByDate[g.date + "_" + g.oppTeamId] || {};
      const tid2 = g.oppTeamId;
      const rec2  = oppMap[tid2] || {};
      return {
        date:          g.date,
        dayOfWeek:     dayOfWeek(g.date),
        homeAway:      g.homeAway,
        opponent:      g.opponent || null,
        oppAbbr:       g.oppAbbr,
        oppTeamId:     tid2,
        status:        g.status || "Scheduled",
        seriesGameNum: sg.gameNum     || null,
        seriesLength:  sg.seriesLength || null,
        isSeriesLast:  sg.isSeriesLast || false,
        // Strength-of-schedule stats for upcoming opponents
        oppRecord:    rec2.overall || null,
        oppWins:      rec2.wins    ?? null,
        oppLosses:    rec2.losses  ?? null,
        oppWinPct:    rec2.winPct  ?? null,
        oppSeasonAvg: avgMap[tid2] || null,
        oppSeasonEra: eraMap[tid2] || null,
      };
    });

  // ── 7. Season summary ─────────────────────────────────────────────────────────
  const avg = (arr, fn) => {
    const vals = arr.map(fn).filter(v => v != null && !isNaN(v));
    return vals.length ? +(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2) : null;
  };

  // Strength-of-schedule aggregates
  const parseEra = s => { const n = parseFloat(s); return isNaN(n) ? null : n; };
  const parseAvg = s => { if (!s) return null; const n = parseFloat(String(s).replace(/^\./,"0.")); return isNaN(n) ? null : n; };

  const sosPlayed = {
    avgOppWinPct: avg(games, g => g.oppWinPct),
    avgOppEra:    avg(games, g => parseEra(g.oppSeasonEra)),
    avgOppAvg:    avg(games, g => parseAvg(g.oppSeasonAvg)),
  };
  const sosUpcoming = upcomingGames.length ? {
    avgOppWinPct: avg(upcomingGames, g => g.oppWinPct),
    avgOppEra:    avg(upcomingGames, g => parseEra(g.oppSeasonEra)),
    avgOppAvg:    avg(upcomingGames, g => parseAvg(g.oppSeasonAvg)),
  } : null;

  // ── Compute SOS rank (1-30) using all 30 teams from fullSchedule + oppMap ─────
  // For each team, average the win pct of their completed opponents (same method
  // we use for the Mets). This gives a fair apples-to-apples league-wide ranking.
  let sosPlayedRank = null;
  let sosUpcomingRank = null;
  try {
    const allTeamIds = [...new Set(fullSchedule.map(g => g.oppTeamId))].filter(Boolean);
    // Add Mets itself
    allTeamIds.push(METS_TEAM_ID);

    // Build per-team SOS: for each team, collect opponent win pcts from their schedule
    const teamSosPlayed   = {};
    const teamSosUpcoming = {};

    for (const tid of allTeamIds) {
      const played   = [];
      const upcoming2 = [];
      for (const g of fullSchedule) {
        // The "opponent" of this team in each game
        let oppId = null;
        if (tid === METS_TEAM_ID) {
          oppId = g.oppTeamId; // fullSchedule is already Mets-centric
        } else {
          // For other teams: use the oppMap of the opposing team in Mets schedule
          // We approximate by treating every game as the non-Mets team facing someone
          // This is only possible for teams in fullSchedule (Mets' opponents)
          // Skip — we only have the Mets' full schedule, not every team's
          continue;
        }
        if (!oppId) continue;
        const wp = oppMap[oppId]?.winPct;
        if (wp == null) continue;
        if (g.date <= today2) played.push(wp);
        else upcoming2.push(wp);
      }
      if (played.length)    teamSosPlayed[tid]   = played.reduce((a,b)=>a+b,0)/played.length;
      if (upcoming2.length) teamSosUpcoming[tid] = upcoming2.reduce((a,b)=>a+b,0)/upcoming2.length;
    }

    // Since we only have the Mets' own schedule, we compute rank against the
    // league-wide distribution using oppMap win pcts as a proxy:
    // All 30 teams' average opponent win pct approximated as:
    //   each team's SOS ≈ average win pct of opponents in oppMap weighted by games played
    // Better proxy: use oppMap to simulate — for each team T in oppMap,
    // their opponents' avg win pct ≈ avg of all other teams' win pcts (schedule-independent baseline)
    // Then rank Mets against that distribution.

    const allWinPcts = Object.values(oppMap).map(r => r.winPct).filter(v => v != null);
    if (allWinPcts.length >= 10) {
      // League avg win pct of opponents ≈ 0.500 by definition
      // Std dev of team win pcts drives SOS spread
      const leagueAvg = allWinPcts.reduce((a,b)=>a+b,0) / allWinPcts.length;
      const leagueStd = Math.sqrt(allWinPcts.map(v=>(v-leagueAvg)**2).reduce((a,b)=>a+b,0)/allWinPcts.length);

      // Estimate rank using normal distribution: z-score → percentile → rank out of 30
      // Higher avg opp win pct = harder schedule = better (lower) rank number
      const zToRank = (val) => {
        if (val == null || leagueStd === 0) return 15;
        const z = (val - leagueAvg) / leagueStd;
        // Percentile (higher val = harder schedule = lower rank number)
        // rank 1 = hardest, rank 30 = easiest
        // P(Z > z) * 30 rounded
        const p = 0.5 * (1 + Math.sign(z) * (1 - Math.exp(-0.7 * z * z)));
        return Math.max(1, Math.min(30, Math.round((1 - p) * 30) + 1));
      };

      sosPlayedRank   = zToRank(sosPlayed.avgOppWinPct);
      sosUpcomingRank = sosUpcoming ? zToRank(sosUpcoming.avgOppWinPct) : null;
    }
  } catch (e) {
    console.warn('[game-log] SOS rank computation failed:', e.message);
  }

  const summary = {
    generatedAt:  new Date().toISOString(),
    totalGames:   games.length,
    record:       `${mW}-${mL}`,
    homeRecord:   `${mHW}-${mHL}`,
    roadRecord:   `${mRW}-${mRL}`,
    winPct:       winPct(mW, mL),
    avgMetsRuns:  avg(games, g => g.metsRuns),
    avgOppRuns:   avg(games, g => g.oppRuns),
    avgMetsHits:  avg(games, g => g.metsHits),
    avgOppHits:   avg(games, g => g.oppHits),
    sosPlayed,
    sosUpcoming,
    sosPlayedRank,
    sosUpcomingRank,
  };

  // ── 8. Write output ───────────────────────────────────────────────────────────
  const output = {
    generatedAt: new Date().toISOString(),
    season:      SEASON,
    summary,
    games,
    upcomingGames,
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + "\n");
  console.log(`[game-log] ✓ Wrote ${games.length} games to ${OUTPUT}`);
  console.log(`[game-log] Summary:`, summary);
}

main().catch(err => {
  console.error("[game-log] Fatal:", err);
  process.exit(1);
});
