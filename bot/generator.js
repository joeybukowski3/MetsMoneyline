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

async function safeGet(url, label) {
  try {
    const res = await axios.get(url, { timeout: 10000 });
    return res.data;
  } catch (err) {
    console.warn(`  [warn] ${label} fetch failed: ${err.message}`);
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
  return "R"; // safe default
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
  if (last3.length > 0) {
    const totalERA = last3.reduce((sum, g) => sum + parseFloat(g.stat.era || 0), 0);
    last3ERA = (totalERA / last3.length).toFixed(2);
  }

  // Last 3 FIP-adjacent: K/BB over last 3 starts
  let last3KBB = "N/A";
  if (last3.length > 0) {
    const totalK  = last3.reduce((sum, g) => sum + (g.stat.strikeOuts || 0), 0);
    const totalBB = last3.reduce((sum, g) => sum + (g.stat.baseOnBalls || 0), 0);
    last3KBB = totalBB > 0 ? (totalK / totalBB).toFixed(2) : "N/A";
  }

  return {
    seasonERA:  s.era  || "N/A",
    seasonFIP:  "N/A", // Not available from MLB Stats API; GPT may supplement
    seasonWHIP: s.whip || "N/A",
    seasonKBB:  kbb,
    last3ERA,
    last3KBB
  };
}

// ─────────────────────────────────────────────
// STEP 3b — Baseball Savant stats via CSV
// ─────────────────────────────────────────────

async function getSavantStats(mlbId, name) {
  if (!mlbId) return null;
  const url =
    `https://baseballsavant.mlb.com/statcast_search/csv` +
    `?player_type=pitcher&player_id=${mlbId}&season=2025&type=details&group_by=name`;
  try {
    const res = await axios.get(url, { timeout: 15000, responseType: "text" });
    const text = res.data;
    if (!text || text.trim().length < 20) return null;

    const rows = parse(text, { columns: true, skip_empty_lines: true, relax_quotes: true });
    if (!rows || rows.length === 0) return null;

    // Aggregate numeric columns across all rows for this pitcher
    const toNum = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
    const avg = (col) => {
      const vals = rows.map(r => toNum(r[col])).filter(v => v !== null);
      if (!vals.length) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };

    // Attempt known Savant column names
    const xERA      = avg("estimated_era_using_speedangle") ?? avg("xera") ?? avg("x_era");
    const barrelPct = avg("barrel_batted_rate") ?? avg("barrel_per_pa") ?? avg("barrel");
    const hardHit   = avg("hard_hit_percent") ?? avg("launch_speed_90th") ?? null;
    const whiffPct  = avg("whiff_percent") ?? avg("swinging_strike_percent") ?? null;
    const chasePct  = avg("out_zone_swing_percent") ?? avg("o_swing_percent") ?? null;
    const kPct      = avg("k_percent") ?? avg("strikeout_percent") ?? null;
    const bbPct     = avg("bb_percent") ?? avg("walk_percent") ?? null;

    const fmt = (v, decimals = 1) => v !== null ? v.toFixed(decimals) : "N/A";

    console.log(`  Savant stats fetched for ${name || mlbId}`);
    return {
      xERA:      fmt(xERA, 2),
      barrelPct: fmt(barrelPct),
      hardHitPct: fmt(hardHit),
      whiffPct:  fmt(whiffPct),
      chasePct:  fmt(chasePct),
      kPct:      fmt(kPct),
      bbPct:     fmt(bbPct)
    };
  } catch (err) {
    console.warn(`  [warn] Savant stats for ${name || mlbId} failed: ${err.message}`);
    return null;
  }
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
    sections: sections.length > 0
      ? sections
      : [{ heading: "Analysis", body: rawText.replace(/OFFICIAL_PICK:.+/, "").trim() }],
    pickSummary:  summaryLine ? summaryLine[1].trim() : "",
    officialPick: "Today's Pick: New York Mets Moneyline"
  };
}

// ─────────────────────────────────────────────
// OpenAI call — grounded by verified context
// ─────────────────────────────────────────────

async function generateAnalysis(gameObject) {
  const mets2025 = await loadMets2025();

  // Build 2025 baseline lines for any Mets player/pitcher without live stats
  const baselineLines = [];
  const starterName = gameObject.pitching?.mets?.name;
  if (starterName && mets2025.starters?.[starterName]) {
    const s = mets2025.starters[starterName];
    baselineLines.push(`- ${starterName}: ERA ${s.ERA}, FIP ${s.FIP}, xFIP ${s.xFIP}, WHIP ${s.WHIP}, K/BB ${s.KBB}`);
  }
  for (const hitter of gameObject.lineups?.mets || []) {
    const stats = mets2025.hitters?.[hitter.name];
    if (stats) {
      baselineLines.push(`- ${hitter.name}: AVG ${stats.AVG}, OPS ${stats.OPS}, wRC+ ${stats.wRC_plus}, HR ${stats.HR}`);
    }
  }

  const baselineSection = baselineLines.length
    ? `2025 BASELINE STATS (use as supporting context where 2026 data is N/A):\n${baselineLines.join("\n")}\n\n`
    : "";

  // Structured verified context injected at the top
  const gameContext = buildGameContext(gameObject);

  const prompt = `Use only the following verified game data. Do not invent or substitute any player names, stats, or lineup positions:

${gameContext}

${baselineSection}WRITING INSTRUCTIONS:
You are writing a daily Mets game breakdown for a baseball analysis website. Tone: front-office analytical, serious, mostly dry.

STRICT RULES:
- Never use betting language (no "bet", "wager", "units", "edge", "lock", "fade")
- Never mention the site name
- Always conclude the Mets will win — no hedging
- Acknowledge any negative Mets facts briefly, then immediately reframe using regression to the mean, underlying metrics, or offsetting strengths
- Use advanced stats naturally: wRC+, xwOBA, FIP, xFIP, xERA, barrel%, hard-hit%, WHIP, K%, BB%
- Only reference players and stats from the VERIFIED GAME DATA block above
- Output exactly one "Game Analysis" section made of 3 or 4 short named markdown sub-sections:
  ## Offensive Matchup
  ## Pitching Matchup
  ## Key Edge
  ## Final Read
- Each sub-section must be 2 or 3 sentences max
- Keep tone tight, direct, and confident

After the sub-sections, output one line beginning with: PICK_SUMMARY:
- The PICK_SUMMARY must be exactly 2 or 3 sentences summarizing the strongest factors
- No hedging or disclaimer language

End with exactly this on its own line: OFFICIAL_PICK: Today's Pick: New York Mets Moneyline

Write the 150-300 word breakdown now.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 700,
    temperature: 0.7
  });

  return response.choices[0].message.content;
}

// ─────────────────────────────────────────────
// Assemble full game object
// ─────────────────────────────────────────────

async function buildGameObject(game, standings, isGameDay) {
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

  // STEP 3: Season stats (only for announced pitchers)
  console.log(`Fetching pitcher stats...`);
  const [metsPitcherStats, oppPitcherStats] = await Promise.all([
    metsAnnounced ? getPitcherStats(metsPitcherRaw.id, metsPitcherRaw.fullName) : Promise.resolve([]),
    oppAnnounced  ? getPitcherStats(oppPitcherRaw.id,  oppPitcherRaw.fullName)  : Promise.resolve([])
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
        hand:        metsHand,
        seasonERA:   metsPStats.seasonERA,
        seasonFIP:   metsPStats.seasonFIP,
        seasonXERA:  "N/A",
        seasonWHIP:  metsPStats.seasonWHIP,
        seasonHR9:   "N/A",
        last3ERA:    metsPStats.last3ERA,
        last3FIP:    "N/A",
        last3WHIP:   "N/A",
        last3KBB:    metsPStats.last3KBB,
        last3IP:     "N/A",
        note:        "",
        savant:      metsSavant,
        vsRoster:    metsVsRoster
      },
      opp: {
        name:        oppAnnounced ? oppPitcherRaw.fullName : "TBD",
        mlbId:       oppAnnounced ? oppPitcherRaw.id : null,
        announced:   oppAnnounced,
        hand:        oppHand,
        seasonERA:   oppPStats.seasonERA,
        seasonFIP:   oppPStats.seasonFIP,
        seasonXERA:  "N/A",
        seasonWHIP:  oppPStats.seasonWHIP,
        seasonHR9:   "N/A",
        last3ERA:    oppPStats.last3ERA,
        last3FIP:    "N/A",
        last3WHIP:   "N/A",
        last3KBB:    oppPStats.last3KBB,
        last3IP:     "N/A",
        note:        "",
        savant:      oppSavant,
        vsRoster:    oppVsRoster
      },
      metsBullpen: { seasonERA: "N/A", seasonXFIP: "N/A", last14ERA: "N/A", last3DaysIP: "N/A", rating: 70 },
      oppBullpen:  { seasonERA: "N/A", seasonXFIP: "N/A", last14ERA: "N/A", last3DaysIP: "N/A", rating: 65 }
    },
    lineups,
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

  const standings   = await getStandings();
  const gameObject  = await buildGameObject(game, standings, isGameDay);

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
}

run().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
