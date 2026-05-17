/**
 * build-game-log.js
 * Fetches all 2026 Mets completed games with full box score data
 * and writes public/data/game-log.json
 */

const fs   = require("fs");
const path = require("path");
const axios = require("axios");

const METS_TEAM_ID = 121;
const SEASON       = new Date().getFullYear();
const OUTPUT       = path.join(__dirname, "..", "public", "data", "game-log.json");

async function fetchJson(url) {
  const res = await axios.get(url, { timeout: 15000 });
  return res.data;
}

// Day or Night — ET cutoff: games starting at or before 4:30 PM ET are day games
function timeOfDay(startTimeUtc) {
  if (!startTimeUtc) return "night";
  const d = new Date(startTimeUtc);
  // ET offset: -4 (EDT) / -5 (EST). Use simple -4 for season (Apr-Oct)
  const etHour = (d.getUTCHours() - 4 + 24) % 24;
  return etHour < 17 ? "day" : "night"; // before 5 PM ET = day game
}

function etTimeLabel(startTimeUtc) {
  if (!startTimeUtc) return "";
  const d = new Date(startTimeUtc);
  const etH = (d.getUTCHours() - 4 + 24) % 24;
  const etM = d.getUTCMinutes();
  const ampm = etH >= 12 ? "PM" : "AM";
  const h12 = etH % 12 || 12;
  return `${h12}:${String(etM).padStart(2, "0")} ${ampm} ET`;
}

function dayOfWeek(dateStr) {
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  return days[new Date(`${dateStr}T12:00:00`).getDay()];
}

const TEAM_ABBR = {
  108:"LAA",109:"ARI",110:"BAL",111:"BOS",112:"CHC",113:"CIN",114:"CLE",
  115:"COL",116:"DET",117:"HOU",118:"KC", 119:"LAD",120:"WSH",121:"NYM",
  133:"OAK",134:"PIT",135:"SD", 136:"SEA",137:"SF", 138:"STL",139:"TB",
  140:"TEX",141:"TOR",142:"MIN",143:"PHI",144:"ATL",145:"CWS",146:"MIA",
  147:"NYY",158:"MIL"
};

async function main() {
  const today     = new Date().toISOString().slice(0, 10);
  const startDate = `${SEASON}-03-01`;

  console.log(`[game-log] Fetching Mets ${SEASON} schedule with linescore…`);

  // Fetch full schedule with linescore (gives runs + hits + errors per team)
  const schedUrl =
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${METS_TEAM_ID}` +
    `&startDate=${startDate}&endDate=${today}&gameType=R&hydrate=linescore,team`;

  const schedData = await fetchJson(schedUrl);
  const games     = [];

  // Running record trackers
  let mW=0,mL=0,mHW=0,mHL=0,mRW=0,mRL=0;

  // Collect opponent team IDs for record lookup
  const oppIds = new Set();

  for (const dateEntry of schedData?.dates || []) {
    for (const game of dateEntry.games || []) {
      const state = game?.status?.detailedState || "";
      const isFinal = ["Final","Completed Early","Game Over"].includes(state);
      if (!isFinal) continue;

      const isHome  = game?.teams?.home?.team?.id === METS_TEAM_ID;
      const metsTeam = isHome ? game.teams.home : game.teams.away;
      const oppTeam  = isHome ? game.teams.away : game.teams.home;
      const oppId    = oppTeam?.team?.id;
      if (oppId) oppIds.add(oppId);

      // Linescore gives us runs + hits
      const ls = game.linescore || {};
      const metsRuns = Number(isHome ? ls.teams?.home?.runs  : ls.teams?.away?.runs)  || 0;
      const metsHits = Number(isHome ? ls.teams?.home?.hits  : ls.teams?.away?.hits)  || 0;
      const oppRuns  = Number(isHome ? ls.teams?.away?.runs  : ls.teams?.home?.runs)  || 0;
      const oppHits  = Number(isHome ? ls.teams?.away?.hits  : ls.teams?.home?.hits)  || 0;

      const didWin   = metsRuns > oppRuns;
      const ha       = isHome ? "home" : "away";

      // Update running record BEFORE adding this game
      const recBefore = `${mW}-${mL}`;
      const hRecBefore = `${mHW}-${mHL}`;
      const rRecBefore = `${mRW}-${mRL}`;

      // Now update
      if (didWin) { mW++; if (isHome) mHW++; else mRW++; }
      else        { mL++; if (isHome) mHL++; else mRL++; }

      games.push({
        date:        dateEntry.date,
        dayOfWeek:   dayOfWeek(dateEntry.date),
        timeOfDay:   timeOfDay(game.gameDate),
        startTime:   etTimeLabel(game.gameDate),
        homeAway:    ha,
        opponent:    oppTeam?.team?.name || "Unknown",
        oppAbbr:     TEAM_ABBR[oppId] || (oppTeam?.team?.abbreviation || "???"),
        oppTeamId:   oppId || null,
        metsRuns,
        metsHits,
        oppRuns,
        oppHits,
        result:      didWin ? "W" : "L",
        finalScore:  `${metsRuns}-${oppRuns}`,
        // Record AFTER this game
        metsRecord:  `${mW}-${mL}`,
        metsHomeRecord: `${mHW}-${mHL}`,
        metsRoadRecord: `${mRW}-${mRL}`,
        // Opponent season record filled in below
        oppRecord:       null,
        oppHomeRecord:   null,
        oppRoadRecord:   null,
      });
    }
  }

  games.sort((a,b) => a.date.localeCompare(b.date));
  console.log(`[game-log] ${games.length} completed games found`);

  // ── Fetch opponent season records (current standings) ───────────────────────
  console.log(`[game-log] Fetching opponent records for ${oppIds.size} teams…`);
  const oppRecordMap = {};
  try {
    const standingsUrl =
      `https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=${SEASON}&standingsTypes=regularSeason&hydrate=team,record`;
    const sData = await fetchJson(standingsUrl);

    for (const record of sData?.records || []) {
      for (const tr of record?.teamRecords || []) {
        const tid = tr?.team?.id;
        if (!tid || !oppIds.has(tid)) continue;
        const splits = tr?.records?.splitRecords || [];
        const findSplit = (t) => splits.find(s => s.type === t);
        const home  = findSplit("home");
        const road  = findSplit("road");
        oppRecordMap[tid] = {
          overall: `${tr.wins}-${tr.losses}`,
          home:    home  ? `${home.wins}-${home.losses}` : null,
          road:    road  ? `${road.wins}-${road.losses}` : null,
        };
      }
    }
  } catch (e) {
    console.warn("[game-log] Standings fetch failed:", e.message);
  }

  // Attach opponent records to each game
  for (const g of games) {
    const rec = oppRecordMap[g.oppTeamId];
    if (rec) {
      g.oppRecord     = rec.overall;
      g.oppHomeRecord = g.homeAway === "home" ? rec.road : rec.home; // opp is visitor when Mets are home
      g.oppRoadRecord = g.homeAway === "away" ? rec.home : rec.road;
    }
  }

  // ── Season-level summary stats ───────────────────────────────────────────────
  const completed = games.filter(g => g.result);
  const avg = (arr, fn) => arr.length ? (arr.reduce((s,g)=>s+fn(g),0)/arr.length) : 0;
  const summary = {
    totalGames:   completed.length,
    record:       `${mW}-${mL}`,
    homeRecord:   `${mHW}-${mHL}`,
    roadRecord:   `${mRW}-${mRL}`,
    avgMetsRuns:  +avg(completed, g=>g.metsRuns).toFixed(2),
    avgOppRuns:   +avg(completed, g=>g.oppRuns).toFixed(2),
    avgMetsHits:  +avg(completed, g=>g.metsHits).toFixed(2),
    avgOppHits:   +avg(completed, g=>g.oppHits).toFixed(2),
  };

  const output = {
    generatedAt: new Date().toISOString(),
    season: SEASON,
    summary,
    games,
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + "\n");
  console.log(`[game-log] Wrote ${games.length} games to ${OUTPUT}`);
  console.log(`[game-log] Season summary:`, summary);
}

main().catch(err => { console.error("[game-log] Fatal:", err); process.exit(1); });
