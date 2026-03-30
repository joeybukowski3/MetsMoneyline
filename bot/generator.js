/*
Inputs:
- MLB Stats API schedule, feed, player stats, injuries, and game content endpoints.
- Baseball Savant pitcher/team leaderboards for lightweight advanced context.
- OpenAI for a single JSON-only writeup generation call.

Output:
- Writes public/data/sample-game.json in the shape consumed by the static frontend.
- Optionally creates a Buttondown draft from the same generated sections.
*/

const path = require("path");
const fs = require("fs");
const axios = require("axios");
const OpenAI = require("openai");
const { parse } = require("csv-parse/sync");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const TEAM_ID = 121;
const TEAM_NAME = "New York Mets";
const TIME_ZONE = "America/New_York";
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const ODDS_API_KEY = process.env.ODDS_API_KEY || process.env.THE_ODDS_API_KEY || process.env.ODDSAPI || null;
const SAMPLE_JSON_PATH = path.join(__dirname, "../public/data/sample-game.json");
const PICK_HISTORY_PATH = path.join(__dirname, "../public/data/pick-history.json");

const TEAM_IDS = {
  "Arizona Diamondbacks": 109,
  "Atlanta Braves": 144,
  "Baltimore Orioles": 110,
  "Boston Red Sox": 111,
  "Chicago Cubs": 112,
  "Chicago White Sox": 145,
  "Cincinnati Reds": 113,
  "Cleveland Guardians": 114,
  "Colorado Rockies": 115,
  "Detroit Tigers": 116,
  "Houston Astros": 117,
  "Kansas City Royals": 118,
  "Los Angeles Angels": 108,
  "Los Angeles Dodgers": 119,
  "Miami Marlins": 146,
  "Milwaukee Brewers": 158,
  "Minnesota Twins": 142,
  "New York Mets": 121,
  "New York Yankees": 147,
  "Oakland Athletics": 133,
  "Philadelphia Phillies": 143,
  "Pittsburgh Pirates": 134,
  "San Diego Padres": 135,
  "San Francisco Giants": 137,
  "Seattle Mariners": 136,
  "St. Louis Cardinals": 138,
  "Tampa Bay Rays": 139,
  "Texas Rangers": 140,
  "Toronto Blue Jays": 141,
  "Washington Nationals": 120
};

const FANGRAPHS_TEAM_SLUGS = {
  "Arizona Diamondbacks": "diamondbacks",
  "Atlanta Braves": "braves",
  "Baltimore Orioles": "orioles",
  "Boston Red Sox": "red-sox",
  "Chicago Cubs": "cubs",
  "Chicago White Sox": "white-sox",
  "Cincinnati Reds": "reds",
  "Cleveland Guardians": "guardians",
  "Colorado Rockies": "rockies",
  "Detroit Tigers": "tigers",
  "Houston Astros": "astros",
  "Kansas City Royals": "royals",
  "Los Angeles Angels": "angels",
  "Los Angeles Dodgers": "dodgers",
  "Miami Marlins": "marlins",
  "Milwaukee Brewers": "brewers",
  "Minnesota Twins": "twins",
  "New York Mets": "mets",
  "New York Yankees": "yankees",
  "Oakland Athletics": "athletics",
  "Philadelphia Phillies": "phillies",
  "Pittsburgh Pirates": "pirates",
  "San Diego Padres": "padres",
  "San Francisco Giants": "giants",
  "Seattle Mariners": "mariners",
  "St. Louis Cardinals": "cardinals",
  "Tampa Bay Rays": "rays",
  "Texas Rangers": "rangers",
  "Toronto Blue Jays": "blue-jays",
  "Washington Nationals": "nationals"
};

const DEFAULT_METS_LINEUP = [
  { order: 1, playerId: 596019, name: "Francisco Lindor", pos: "SS", hand: "S" },
  { order: 2, playerId: 665742, name: "Juan Soto", pos: "LF", hand: "L" },
  { order: 3, playerId: 624413, name: "Pete Alonso", pos: "1B", hand: "R" },
  { order: 4, playerId: 543760, name: "Marcus Semien", pos: "2B", hand: "R" },
  { order: 5, playerId: 666182, name: "Bo Bichette", pos: "3B", hand: "R" },
  { order: 6, playerId: 682626, name: "Francisco Alvarez", pos: "C", hand: "R" },
  { order: 7, playerId: 672724, name: "Mark Vientos", pos: "DH", hand: "R" },
  { order: 8, playerId: 607043, name: "Brandon Nimmo", pos: "CF", hand: "L" },
  { order: 9, playerId: 673357, name: "Luis Robert Jr.", pos: "RF", hand: "R" }
];

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

let cachedSavantPitchers = null;
let cachedSavantBatters = null;
let cachedSavantExpectedBatters = null;
let cachedSavantExpectedPitchers = null;
const cachedFangraphsTeams = new Map();

function getTodayEasternISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
}

function parseArgs(argv) {
  const args = { date: getTodayEasternISO(), dryRun: false };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--date") {
      args.date = argv[i + 1];
      i += 1;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    throw new Error(`Invalid --date value: ${args.date}`);
  }

  return args;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatTimeET(dateTime) {
  if (!dateTime) return "TBD";
  return new Date(dateTime).toLocaleTimeString("en-US", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  }).replace(/^0/, "") + " ET";
}

function isValidRecordString(value) {
  return /^\d+-\d+$/.test(String(value || "").trim());
}

function sanitizeRecord(value, fallback = "0-0") {
  return isValidRecordString(value) ? String(value) : fallback;
}

function parseRecord(record) {
  if (!isValidRecordString(record)) return null;
  const [wins, losses] = record.split("-").map(Number);
  return { wins, losses };
}

function compareRecords(metsRecord, oppRecord) {
  const mets = parseRecord(metsRecord);
  const opp = parseRecord(oppRecord);
  if (!mets || !opp) return "Neutral";

  const metsPct = mets.wins + mets.losses > 0 ? mets.wins / (mets.wins + mets.losses) : 0;
  const oppPct = opp.wins + opp.losses > 0 ? opp.wins / (opp.wins + opp.losses) : 0;

  if (Math.abs(metsPct - oppPct) < 0.01) return "Neutral";
  return metsPct > oppPct ? "Mets" : "Opp";
}

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeForModel(value) {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.map(sanitizeForModel);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, sanitizeForModel(child)])
    );
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed.toLowerCase() === "undefined") return null;
    return value;
  }
  return value;
}

function ensureNoUndefinedStrings(value) {
  if (Array.isArray(value)) {
    value.forEach(ensureNoUndefinedStrings);
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach(ensureNoUndefinedStrings);
    return;
  }
  if (typeof value === "string" && value.includes("undefined")) {
    throw new Error(`Refusing to continue with string containing "undefined": ${value}`);
  }
}

async function safeGetJson(url, label, options = {}) {
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      ...options
    });
    return response.data;
  } catch (error) {
    console.warn(`[warn] ${label} failed: ${error.message}`);
    return null;
  }
}

async function safeGetText(url, label) {
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      responseType: "text"
    });
    return response.data;
  } catch (error) {
    console.warn(`[warn] ${label} failed: ${error.message}`);
    return null;
  }
}

function loadPreviousOutput() {
  try {
    return JSON.parse(fs.readFileSync(SAMPLE_JSON_PATH, "utf8"));
  } catch {
    return null;
  }
}

function loadPickHistory() {
  try {
    return JSON.parse(fs.readFileSync(PICK_HISTORY_PATH, "utf8"));
  } catch {
    return { updatedAt: null, record: { wins: 0, losses: 0, profit: 0 }, entries: [] };
  }
}

function writePickHistory(entries = []) {
  const summary = entries.reduce((acc, entry) => {
    if (entry?.result === "W") acc.wins += 1;
    if (entry?.result === "L") acc.losses += 1;
    if (typeof entry?.profit === "number") acc.profit += entry.profit;
    return acc;
  }, { wins: 0, losses: 0, profit: 0 });

  const output = {
    updatedAt: new Date().toISOString(),
    record: {
      wins: summary.wins,
      losses: summary.losses,
      profit: Number(summary.profit.toFixed(2))
    },
    entries
  };

  fs.writeFileSync(PICK_HISTORY_PATH, JSON.stringify(output, null, 2));
  return output;
}

async function loadSavantPitcherLeaderboard() {
  if (cachedSavantPitchers) return cachedSavantPitchers;

  const season = new Date().getFullYear();
  const seasonsToTry = [season, season - 1];
  const merged = [];
  const seen = new Set();

  for (const year of seasonsToTry) {
    const url =
      "https://baseballsavant.mlb.com/leaderboard/custom" +
      `?type=pitcher&year=${year}` +
      "&selections=player_name,player_id,hard_hit_percent,barrel_batted_rate,whiff_percent,oz_swing_percent,k_percent,bb_percent,gb_percent" +
      "&sort=player_name&sortDir=asc&min=0&csv=true";
    const csv = await safeGetText(url, `Savant pitcher leaderboard ${year}`);
    const rows = csv ? parse(csv, { columns: true, skip_empty_lines: true, relax_quotes: true }) : [];
    for (const row of rows) {
      const id = String(row.player_id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(row);
    }
  }

  cachedSavantPitchers = merged;
  return cachedSavantPitchers;
}

async function loadSavantExpectedPitchers() {
  if (cachedSavantExpectedPitchers) return cachedSavantExpectedPitchers;
  const season = new Date().getFullYear();
  const seasonsToTry = [season, season - 1];
  const merged = [];
  const seen = new Set();

  for (const year of seasonsToTry) {
    const url =
      "https://baseballsavant.mlb.com/leaderboard/expected_statistics" +
      `?type=pitcher&year=${year}&position=&team=&min=0&csv=true`;
    const csv = await safeGetText(url, `Savant expected pitcher leaderboard ${year}`);
    const rows = csv ? parse(csv, { columns: true, skip_empty_lines: true, relax_quotes: true }) : [];
    for (const row of rows) {
      const id = String(row.player_id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(row);
    }
  }

  cachedSavantExpectedPitchers = merged;
  return cachedSavantExpectedPitchers;
}

async function loadSavantBatterLeaderboard() {
  if (cachedSavantBatters) return cachedSavantBatters;
  const season = new Date().getFullYear();
  const url =
    "https://baseballsavant.mlb.com/leaderboard/custom" +
    `?type=batter&year=${season}` +
    "&selections=player_name,player_id,pa,hard_hit_percent,barrel_batted_rate,whiff_percent,k_percent,bb_percent" +
    "&sort=player_name&sortDir=asc&min=0&csv=true";
  const csv = await safeGetText(url, `Savant batter leaderboard ${season}`);
  cachedSavantBatters = csv ? parse(csv, { columns: true, skip_empty_lines: true, relax_quotes: true }) : [];
  return cachedSavantBatters;
}

async function loadSavantExpectedBatters() {
  if (cachedSavantExpectedBatters) return cachedSavantExpectedBatters;
  const season = new Date().getFullYear();
  const url =
    "https://baseballsavant.mlb.com/leaderboard/expected_statistics" +
    `?type=batter&year=${season}&position=&team=&min=q&csv=true`;
  const csv = await safeGetText(url, `Savant expected batter leaderboard ${season}`);
  cachedSavantExpectedBatters = csv ? parse(csv, { columns: true, skip_empty_lines: true, relax_quotes: true }) : [];
  return cachedSavantExpectedBatters;
}

function getSavantRow(rows, playerId) {
  return rows.find((row) => Number(row.player_id) === Number(playerId)) || null;
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function normalizePersonName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseFangraphsTableSection(html, headerText) {
  const start = html.indexOf(headerText);
  if (start === -1) return null;
  const slice = html.slice(start);
  const end = slice.indexOf('</table>');
  if (end === -1) return null;
  return slice.slice(0, end + 8);
}

function parseFangraphsHeaders(sectionHtml) {
  return [...sectionHtml.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => stripTags(m[1]));
}

function parseFangraphsRows(sectionHtml, headers) {
  return [...sectionHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((rowMatch) => {
    const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]));
    if (!cells.length) return null;
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
    row.Name = row.Name || cells[0] || "";
    row._isTeamTotal = /team total/i.test(cells[0] || "");
    return row;
  }).filter(Boolean);
}

async function loadFangraphsTeamData(teamName) {
  const slug = FANGRAPHS_TEAM_SLUGS[teamName];
  if (!slug) return null;
  if (cachedFangraphsTeams.has(slug)) return cachedFangraphsTeams.get(slug);

  const html = await safeGetText(`https://www.fangraphs.com/teams/${slug}`, `fangraphs team ${teamName}`);
  if (!html) {
    cachedFangraphsTeams.set(slug, null);
    return null;
  }

  const battingSection = parseFangraphsTableSection(html, 'Batting Stats Leaders');
  const pitchingSection = parseFangraphsTableSection(html, 'Pitching Stats Leaders');
  const battingHeaders = battingSection ? parseFangraphsHeaders(battingSection) : [];
  const pitchingHeaders = pitchingSection ? parseFangraphsHeaders(pitchingSection) : [];
  const battingRows = battingSection ? parseFangraphsRows(battingSection, battingHeaders) : [];
  const pitchingRows = pitchingSection ? parseFangraphsRows(pitchingSection, pitchingHeaders) : [];

  const data = {
    battingHeaders,
    pitchingHeaders,
    battingRows,
    pitchingRows,
    battingTeamTotal: battingRows.find((row) => row._isTeamTotal) || null,
    pitchingTeamTotal: pitchingRows.find((row) => row._isTeamTotal) || null,
    battingByName: Object.fromEntries(battingRows.filter((row) => row.Name && !row._isTeamTotal).map((row) => [normalizePersonName(row.Name), row])),
    pitchingByName: Object.fromEntries(pitchingRows.filter((row) => row.Name && !row._isTeamTotal).map((row) => [normalizePersonName(row.Name), row]))
  };

  cachedFangraphsTeams.set(slug, data);
  return data;
}

function formatPitcherSeasonLine(stat) {
  if (!stat) return null;
  const pieces = [];
  if (stat.wins != null && stat.losses != null) pieces.push(`${stat.wins}-${stat.losses}`);
  if (stat.era) pieces.push(`${stat.era} ERA`);
  if (stat.whip) pieces.push(`${stat.whip} WHIP`);
  if (stat.inningsPitched) pieces.push(`${stat.inningsPitched} IP`);
  return pieces.length ? pieces.join(", ") : null;
}

function inningsPitchedToOuts(inningsPitched) {
  if (inningsPitched == null) return null;
  const [whole, partial = "0"] = String(inningsPitched).split(".");
  return (Number(whole) * 3) + Number(partial);
}

function computeApproxFip(stat, constant = 3.214) {
  if (!stat) return null;
  const hr = Number(stat.homeRuns ?? 0);
  const bb = Number(stat.baseOnBalls ?? 0);
  const hbp = Number(stat.hitByPitch ?? 0);
  const so = Number(stat.strikeOuts ?? 0);
  const outs = inningsPitchedToOuts(stat.inningsPitched);
  if (!outs) return null;
  const ip = outs / 3;
  if (!ip) return null;
  const fip = ((13 * hr) + (3 * (bb + hbp)) - (2 * so)) / ip + constant;
  if (!Number.isFinite(fip)) return null;
  return fip.toFixed(2);
}

async function getPersonInfo(personId) {
  if (!personId) return null;
  const data = await safeGetJson(`https://statsapi.mlb.com/api/v1/people/${personId}`, `person ${personId}`);
  return data?.people?.[0] || null;
}

async function getPlayerSeasonStats(personId, group, season) {
  if (!personId) return null;
  const url =
    `https://statsapi.mlb.com/api/v1/people/${personId}/stats` +
    `?stats=season&group=${group}&season=${season}`;
  const data = await safeGetJson(url, `${group} season stats ${personId} ${season}`);
  return data?.stats?.[0]?.splits?.[0]?.stat || null;
}

async function getPitcherFacts(personId, fallbackName, teamName = null) {
  if (!personId) {
    return {
      name: fallbackName || "TBD",
      mlbId: null,
      announced: false,
      hand: null,
      seasonLine: null,
      seasonRecord: null,
      seasonERA: null,
      seasonFIP: null,
      seasonXERA: null,
      seasonWHIP: null,
      seasonHR9: null,
      last3KBB: null,
      note: null,
      savant: null
    };
  }

  const season = String(new Date().getFullYear());
  const previousSeason = String(Number(season) - 1);
  const [person, currentStats, previousStats, savantRows, expectedRows, fangraphsTeam] = await Promise.all([
    getPersonInfo(personId),
    getPlayerSeasonStats(personId, "pitching", season),
    getPlayerSeasonStats(personId, "pitching", previousSeason),
    loadSavantPitcherLeaderboard(),
    loadSavantExpectedPitchers(),
    teamName ? loadFangraphsTeamData(teamName) : null
  ]);

  const stat = currentStats || previousStats;
  const statSeason = currentStats ? season : previousStats ? previousSeason : null;
  const savant = getSavantRow(savantRows, personId);
  const expected = getSavantRow(expectedRows, personId);
  const pitcherName = person?.fullName || fallbackName || "TBD";
  const fangraphsPitcher = fangraphsTeam?.pitchingByName?.[normalizePersonName(pitcherName)] || null;

  return {
    name: pitcherName,
    mlbId: personId,
    announced: true,
    hand: person?.pitchHand?.code || null,
    seasonLine: formatPitcherSeasonLine(stat),
    seasonRecord: stat?.wins != null && stat?.losses != null ? `${stat.wins}-${stat.losses}` : null,
    seasonERA: stat?.era || fangraphsPitcher?.ERA || null,
    seasonFIP: stat?.fip || fangraphsPitcher?.FIP || computeApproxFip(stat) || fangraphsPitcher?.xFIP || null,
    seasonXERA: expected?.xera || null,
    seasonWHIP: stat?.whip || null,
    seasonHR9: stat?.homeRunsPer9 || fangraphsPitcher?.['HR/9'] || null,
    last3KBB: stat?.strikeoutWalkRatio || null,
    note: stat?.inningsPitched && statSeason ? `${statSeason} - ${stat.inningsPitched} IP` : null,
    savant: savant ? {
      xERA: expected?.xera || null,
      barrelPct: savant.barrel_batted_rate ? `${savant.barrel_batted_rate}%` : null,
      hardHitPct: savant.hard_hit_percent ? `${savant.hard_hit_percent}%` : null,
      whiffPct: savant.whiff_percent ? `${savant.whiff_percent}%` : null,
      chasePct: savant.oz_swing_percent ? `${savant.oz_swing_percent}%` : null,
      kPct: savant.k_percent ? `${savant.k_percent}%` : null,
      bbPct: savant.bb_percent ? `${savant.bb_percent}%` : null,
      gbPct: savant.gb_percent ? `${savant.gb_percent}%` : null
    } : null
  };
}

async function getTeamSeasonRecordFacts(teamId, targetDate, includeTargetDateFinal = false) {
  const season = targetDate.slice(0, 4);
  const startDate = `${season}-03-01`;
  const url =
    "https://statsapi.mlb.com/api/v1/schedule" +
    `?sportId=1&teamId=${teamId}&startDate=${startDate}&endDate=${targetDate}` +
    "&gameType=R&hydrate=linescore,team";

  const data = await safeGetJson(url, `season schedule ${teamId} ${targetDate}`);
  const completedGames = [];

  for (const dateEntry of data?.dates || []) {
    for (const game of dateEntry.games || []) {
      const isTargetDate = dateEntry.date === targetDate;
      const state = game?.status?.detailedState || "";
      const isFinal = ["Final", "Completed Early", "Game Over"].includes(state);
      if (!isFinal) continue;
      if (!includeTargetDateFinal && isTargetDate) continue;

      const isHome = game?.teams?.home?.team?.id === teamId;
      const teamScore = isHome ? game?.teams?.home?.score : game?.teams?.away?.score;
      const oppScore = isHome ? game?.teams?.away?.score : game?.teams?.home?.score;
      const didWin = Number(teamScore) > Number(oppScore);
      completedGames.push({
        date: dateEntry.date,
        homeAway: isHome ? "home" : "road",
        result: didWin ? "W" : "L"
      });
    }
  }

  completedGames.sort((a, b) => a.date.localeCompare(b.date));

  const totals = completedGames.reduce((acc, game) => {
    acc.wins += game.result === "W" ? 1 : 0;
    acc.losses += game.result === "L" ? 1 : 0;
    acc[game.homeAway].wins += game.result === "W" ? 1 : 0;
    acc[game.homeAway].losses += game.result === "L" ? 1 : 0;
    return acc;
  }, {
    wins: 0,
    losses: 0,
    home: { wins: 0, losses: 0 },
    road: { wins: 0, losses: 0 }
  });

  const last10Games = completedGames.slice(-10);
  const last10Wins = last10Games.filter((game) => game.result === "W").length;
  const last10Losses = last10Games.filter((game) => game.result === "L").length;

  return {
    overall: completedGames.length ? `${totals.wins}-${totals.losses}` : null,
    last10: last10Games.length ? `${last10Wins}-${last10Losses}` : null,
    home: completedGames.length ? `${totals.home.wins}-${totals.home.losses}` : null,
    road: completedGames.length ? `${totals.road.wins}-${totals.road.losses}` : null
  };
}

function transactionImpliesInjury(transaction) {
  const haystack = `${transaction?.typeDesc || ""} ${transaction?.description || ""}`.toLowerCase();
  return /(injured list|il-|15-day il|10-day il|7-day il|60-day il|day-to-day|out for season|bereavement|concussion)/i.test(haystack);
}

function transactionClearsInjury(transaction) {
  const haystack = `${transaction?.typeDesc || ""} ${transaction?.description || ""}`.toLowerCase();
  return /(reinstated|returned|activated|recalled|selected the contract|added to active roster|returned from rehab)/i.test(haystack);
}

function normalizeInjuryStatus(transaction) {
  const haystack = `${transaction?.typeDesc || ""} ${transaction?.description || ""}`;
  const match = haystack.match(/(60-day il|15-day il|10-day il|7-day il|day-to-day|bereavement list|paternity list|concussion il)/i);
  return match ? match[1].toUpperCase().replace(/\bIl\b/g, "IL") : "IL";
}

async function getTeamInjuries(teamId) {
  const season = String(new Date().getFullYear());
  const startDate = `${season}-02-15`;
  const today = getTodayEasternISO();
  const data = await safeGetJson(
    `https://statsapi.mlb.com/api/v1/transactions?teamId=${teamId}&startDate=${startDate}&endDate=${today}`,
    `transactions ${teamId}`
  );

  const latestByPlayer = new Map();
  for (const transaction of data?.transactions || []) {
    const playerId = transaction?.person?.id;
    if (!playerId) continue;
    const effectiveDate = transaction?.effectiveDate || transaction?.date || "";
    const previous = latestByPlayer.get(playerId);
    if (!previous || effectiveDate >= (previous.effectiveDate || previous.date || "")) {
      latestByPlayer.set(playerId, transaction);
    }
  }

  return [...latestByPlayer.values()]
    .filter((transaction) => transactionImpliesInjury(transaction) && !transactionClearsInjury(transaction))
    .sort((a, b) => String(b.effectiveDate || b.date || "").localeCompare(String(a.effectiveDate || a.date || "")))
    .slice(0, 5)
    .map((transaction) => {
      const name = transaction?.person?.fullName || "Unknown";
      const status = normalizeInjuryStatus(transaction);
      const detail = cleanText(transaction?.description || transaction?.typeDesc || "");
      return `${name} (${status})${detail ? ` - ${detail}` : ""}`;
    });
}

async function getGameForDate(targetDate) {
  const url =
    "https://statsapi.mlb.com/api/v1/schedule" +
    `?sportId=1&teamId=${TEAM_ID}&date=${targetDate}` +
    "&hydrate=team,venue,linescore,probablePitcher,seriesStatus";
  const data = await safeGetJson(url, `schedule ${targetDate}`);
  return data?.dates?.[0]?.games?.[0] || null;
}

async function resolveTargetGame(targetDate) {
  const exactGame = await getGameForDate(targetDate);
  if (exactGame) {
    return { requestedDate: targetDate, resolvedDate: targetDate, game: exactGame };
  }

  const startDate = targetDate;
  const endDateObj = new Date(`${targetDate}T12:00:00Z`);
  endDateObj.setUTCDate(endDateObj.getUTCDate() + 14);
  const endDate = endDateObj.toISOString().slice(0, 10);

  const url =
    "https://statsapi.mlb.com/api/v1/schedule" +
    `?sportId=1&teamId=${TEAM_ID}&startDate=${startDate}&endDate=${endDate}` +
    "&hydrate=team,venue,linescore,probablePitcher,seriesStatus";
  const data = await safeGetJson(url, `schedule window ${startDate} ${endDate}`);
  const nextGame = (data?.dates || [])
    .flatMap((dateEntry) => dateEntry.games || [])
    .sort((a, b) => new Date(a.gameDate) - new Date(b.gameDate))[0] || null;

  if (!nextGame) {
    throw new Error(`No Mets game found on or after ${targetDate}`);
  }

  return {
    requestedDate: targetDate,
    resolvedDate: nextGame.officialDate || targetDate,
    game: nextGame
  };
}

async function getGameFeed(gamePk) {
  if (!gamePk) return null;
  return safeGetJson(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`, `live feed ${gamePk}`);
}

async function getGameContent(gamePk) {
  if (!gamePk) return null;
  return safeGetJson(`https://statsapi.mlb.com/api/v1/game/${gamePk}/content`, `game content ${gamePk}`);
}

function buildLineupFromBoxscore(boxscoreTeam) {
  const battingOrder = boxscoreTeam?.battingOrder || [];
  const players = boxscoreTeam?.players || {};

  return battingOrder.slice(0, 9).map((playerId, index) => {
    const player = players[`ID${playerId}`];
    const stat = player?.seasonStats?.batting || {};
    return {
      order: index + 1,
      playerId: Number(playerId),
      name: player?.person?.fullName || "TBD",
      pos: player?.position?.abbreviation || "?",
      hand: player?.batSide?.code || null,
      seasonAVG: stat.avg || null,
      seasonOPS: stat.ops || null,
      seasonHR: stat.homeRuns != null ? Number(stat.homeRuns) : null,
      statsSeason: stat.gamesPlayed != null ? String(new Date().getFullYear()) : null
    };
  });
}

function buildLineupFromRoster(roster = [], seasonStatsByPlayer = {}, savantBattersByPlayer = {}, savantExpectedBattersByPlayer = {}, fangraphsBattingByName = {}) {
  return roster
    .filter((player) => player.primaryPosition?.abbreviation !== "P")
    .map((player, index) => {
      const liveStats = seasonStatsByPlayer[player.id] || {};
      const savant = savantBattersByPlayer[player.id] || {};
      const expected = savantExpectedBattersByPlayer[player.id] || {};
      const fangraphs = fangraphsBattingByName[normalizePersonName(player.fullName)] || {};
      const ops = liveStats.ops ?? null;
      const avg = liveStats.avg ?? null;
      const homeRuns = liveStats.homeRuns ?? null;
      const gamesPlayed = Number(liveStats.gamesPlayed || 0);

      return {
        order: index + 1,
        playerId: player.id,
        name: player.fullName,
        pos: player.primaryPosition?.abbreviation || "?",
        hand: player.batSide?.code || null,
        seasonAVG: avg,
        seasonOPS: ops,
        seasonHR: homeRuns != null ? Number(homeRuns) : null,
        statsSeason: gamesPlayed > 0 ? String(new Date().getFullYear()) : null,
        savant: {
          xBA: expected.est_ba || null,
          xSLG: expected.est_slg || null,
          xwOBA: expected.est_woba || null,
          hardHitPct: savant.hard_hit_percent ? `${savant.hard_hit_percent}%` : null,
          barrelPct: savant.barrel_batted_rate ? `${savant.barrel_batted_rate}%` : null,
          whiffPct: savant.whiff_percent ? `${savant.whiff_percent}%` : null,
          pa: savant.pa != null ? Number(savant.pa) : Number(expected.pa || 0)
        },
        fangraphs: {
          wRCPlus: fangraphs['wRC+'] || null,
          wOBA: fangraphs['wOBA'] || null,
          ISO: fangraphs['ISO'] || null,
          bbPct: fangraphs['BB%'] || null,
          kPct: fangraphs['K%'] || null,
          war: fangraphs['WAR'] || null
        },
        _sortOps: parseFloat(String(ops ?? "").replace(/[^\d.-]/g, "")) || -1,
        _sortHr: Number(homeRuns || 0),
        _sortAvg: parseFloat(String(avg ?? "").replace(/[^\d.-]/g, "")) || 0
      };
    })
    .sort((a, b) => (b._sortOps - a._sortOps) || (b._sortHr - a._sortHr) || (b._sortAvg - a._sortAvg))
    .slice(0, 9)
    .map((player, index) => ({
      order: index + 1,
      playerId: player.playerId,
      name: player.name,
      pos: player.pos,
      hand: player.hand,
      seasonAVG: player.seasonAVG,
      seasonOPS: player.seasonOPS,
      seasonHR: player.seasonHR,
      statsSeason: player.statsSeason,
      savant: player.savant
    }));
}

async function getTeamRoster(teamId, season) {
  const data = await safeGetJson(
    `https://statsapi.mlb.com/api/v1/teams/${teamId}/roster?rosterType=active&season=${season}&hydrate=person(stats(type=[season],group=[hitting],season=${season}))`,
    `roster ${teamId} ${season}`
  );
  return (data?.roster || []).map((entry) => ({
    id: entry?.person?.id,
    fullName: entry?.person?.fullName,
    primaryPosition: entry?.position || entry?.person?.primaryPosition || null,
    batSide: entry?.person?.batSide || null,
    stats: entry?.person?.stats?.[0]?.splits?.[0]?.stat || null
  }));
}

async function getMostRecentConfirmedLineup(teamId, beforeDate) {
  const season = beforeDate.slice(0, 4);
  const schedule = await safeGetJson(
    `https://statsapi.mlb.com/api/v1/schedule?teamId=${teamId}&sportId=1&gameType=R&startDate=${season}-03-01&endDate=${beforeDate}&hydrate=team,linescore`,
    `recent lineup schedule ${teamId} ${beforeDate}`
  );

  const recentGame = (schedule?.dates || [])
    .flatMap((dateEntry) => (dateEntry.games || []).map((game) => ({ ...game, _date: dateEntry.date })))
    .filter((game) => ["Final", "Completed Early", "Game Over"].includes(game?.status?.detailedState || ""))
    .sort((a, b) => new Date(`${b._date}T12:00:00Z`) - new Date(`${a._date}T12:00:00Z`))[0];

  if (!recentGame?.gamePk) return [];
  const [feed, savantBatters, savantExpectedBatters] = await Promise.all([
    getGameFeed(recentGame.gamePk),
    loadSavantBatterLeaderboard(),
    loadSavantExpectedBatters()
  ]);
  const teamName = Object.keys(TEAM_IDS).find((name) => TEAM_IDS[name] === teamId) || null;
  const fangraphsTeam = teamName ? await loadFangraphsTeamData(teamName) : null;
  const awayTeam = feed?.liveData?.boxscore?.teams?.away;
  const homeTeam = feed?.liveData?.boxscore?.teams?.home;
  const lineupTeam = awayTeam?.team?.id === teamId ? awayTeam : homeTeam?.team?.id === teamId ? homeTeam : null;
  const savantBattersByPlayer = Object.fromEntries(savantBatters.map((row) => [Number(row.player_id), row]));
  const savantExpectedBattersByPlayer = Object.fromEntries(savantExpectedBatters.map((row) => [Number(row.player_id), row]));
  return enrichLineupWithSavant(buildLineupFromBoxscore(lineupTeam), savantBattersByPlayer, savantExpectedBattersByPlayer, fangraphsTeam?.battingByName || {});
}

async function buildProjectedTeamLineup(teamId, isMets, beforeDate) {
  const recentLineup = await getMostRecentConfirmedLineup(teamId, beforeDate);
  if (recentLineup.length) return recentLineup;

  const season = String(new Date().getFullYear());
  const teamName = Object.keys(TEAM_IDS).find((name) => TEAM_IDS[name] === teamId) || null;
  const [roster, savantBatters, savantExpectedBatters, fangraphsTeam] = await Promise.all([
    getTeamRoster(teamId, season),
    loadSavantBatterLeaderboard(),
    loadSavantExpectedBatters(),
    teamName ? loadFangraphsTeamData(teamName) : null
  ]);
  const seasonStatsByPlayer = Object.fromEntries(
    roster.map((player) => [player.id, player.stats || {}])
  );
  const savantBattersByPlayer = Object.fromEntries(
    savantBatters.map((row) => [Number(row.player_id), row])
  );
  const savantExpectedBattersByPlayer = Object.fromEntries(
    savantExpectedBatters.map((row) => [Number(row.player_id), row])
  );

  const projected = buildLineupFromRoster(roster, seasonStatsByPlayer, savantBattersByPlayer, savantExpectedBattersByPlayer, fangraphsTeam?.battingByName || {});
  return projected;
}

function enrichLineupWithSavant(lineup = [], savantBattersByPlayer = {}, savantExpectedBattersByPlayer = {}, fangraphsBattingByName = {}) {
  return lineup.map((player) => {
    const savant = savantBattersByPlayer[player.playerId] || {};
    const expected = savantExpectedBattersByPlayer[player.playerId] || {};
    const fangraphs = fangraphsBattingByName[normalizePersonName(player.name)] || {};
    return {
      ...player,
      savant: {
        xBA: expected.est_ba || null,
        xSLG: expected.est_slg || null,
        xwOBA: expected.est_woba || null,
        hardHitPct: savant.hard_hit_percent ? `${savant.hard_hit_percent}%` : null,
        barrelPct: savant.barrel_batted_rate ? `${savant.barrel_batted_rate}%` : null,
        whiffPct: savant.whiff_percent ? `${savant.whiff_percent}%` : null,
        kPct: savant.k_percent ? `${savant.k_percent}%` : null,
        bbPct: savant.bb_percent ? `${savant.bb_percent}%` : null,
        pa: savant.pa != null ? Number(savant.pa) : Number(expected.pa || 0)
      },
      fangraphs: {
        wRCPlus: fangraphs['wRC+'] || null,
        wOBA: fangraphs['wOBA'] || null,
        ISO: fangraphs['ISO'] || null,
        bbPct: fangraphs['BB%'] || null,
        kPct: fangraphs['K%'] || null,
        war: fangraphs['WAR'] || null
      }
    };
  });
}

async function buildLineupFacts(feed, oppTeamId, targetDate) {
  const awayTeam = feed?.liveData?.boxscore?.teams?.away;
  const homeTeam = feed?.liveData?.boxscore?.teams?.home;
  const metsTeam = awayTeam?.team?.id === TEAM_ID ? awayTeam : homeTeam;
  const oppTeam = awayTeam?.team?.id === TEAM_ID ? homeTeam : awayTeam;

  const oppTeamName = Object.keys(TEAM_IDS).find((name) => TEAM_IDS[name] === oppTeamId) || null;
  const [savantBatters, savantExpectedBatters, metsFg, oppFg] = await Promise.all([
    loadSavantBatterLeaderboard(),
    loadSavantExpectedBatters(),
    loadFangraphsTeamData(TEAM_NAME),
    oppTeamName ? loadFangraphsTeamData(oppTeamName) : null
  ]);
  const savantBattersByPlayer = Object.fromEntries(savantBatters.map((row) => [Number(row.player_id), row]));
  const savantExpectedBattersByPlayer = Object.fromEntries(savantExpectedBatters.map((row) => [Number(row.player_id), row]));

  const metsConfirmed = enrichLineupWithSavant(buildLineupFromBoxscore(metsTeam), savantBattersByPlayer, savantExpectedBattersByPlayer, metsFg?.battingByName || {});
  const oppConfirmed = enrichLineupWithSavant(buildLineupFromBoxscore(oppTeam), savantBattersByPlayer, savantExpectedBattersByPlayer, oppFg?.battingByName || {});

  if (metsConfirmed.length && oppConfirmed.length) {
    return {
      mets: metsConfirmed,
      opp: oppConfirmed,
      status: "confirmed"
    };
  }

  return {
    mets: metsConfirmed.length ? metsConfirmed : await buildProjectedTeamLineup(TEAM_ID, true, targetDate),
    opp: oppConfirmed.length ? oppConfirmed : await buildProjectedTeamLineup(oppTeamId, false, targetDate),
    status: "projected"
  };
}

async function buildBullpenFacts(teamId, teamName, isMets) {
  const season = String(new Date().getFullYear());
  const today = getTodayEasternISO();
  const last14Start = new Date(`${today}T12:00:00Z`);
  last14Start.setUTCDate(last14Start.getUTCDate() - 14);
  const last3Start = new Date(`${today}T12:00:00Z`);
  last3Start.setUTCDate(last3Start.getUTCDate() - 3);

  const [current, fangraphsTeam, last14, last3] = await Promise.all([
    safeGetJson(
      `https://statsapi.mlb.com/api/v1/teams/${teamId}/stats?stats=season&group=pitching&season=${season}`,
      `team pitching ${teamId} ${season}`
    ),
    loadFangraphsTeamData(teamName),
    safeGetJson(
      `https://statsapi.mlb.com/api/v1/teams/${teamId}/stats?stats=byDateRange&group=pitching&gameType=R&startDate=${last14Start.toISOString().slice(0, 10)}&endDate=${today}`,
      `team pitching last14 ${teamId} ${season}`
    ),
    safeGetJson(
      `https://statsapi.mlb.com/api/v1/teams/${teamId}/stats?stats=byDateRange&group=pitching&gameType=R&startDate=${last3Start.toISOString().slice(0, 10)}&endDate=${today}`,
      `team pitching last3 ${teamId} ${season}`
    )
  ]);

  const stat = current?.stats?.[0]?.splits?.[0]?.stat || null;
  const last14Stat = last14?.stats?.[0]?.splits?.[0]?.stat || null;
  const last3Stat = last3?.stats?.[0]?.splits?.[0]?.stat || null;
  const pitchingTotal = fangraphsTeam?.pitchingTeamTotal || {};
  const seasonEra = pitchingTotal['ERA'] || stat?.era || null;
  const seasonWhip = stat?.whip || null;
  const seasonFip = pitchingTotal['xFIP'] || pitchingTotal['FIP'] || stat?.fip || null;
  const rating = seasonEra
    ? Math.max(40, Math.min(85, Math.round(100 - (parseFloat(seasonEra) - 2.5) * 12)))
    : (isMets ? 70 : 65);

  return {
    seasonERA: seasonEra,
    seasonXFIP: seasonFip,
    last14ERA: last14Stat?.era || null,
    last3DaysIP: last3Stat?.inningsPitched || null,
    seasonWHIP: seasonWhip,
    seasonKPct: pitchingTotal['K%'] || null,
    seasonBBPct: pitchingTotal['BB%'] || null,
    rating,
    team: teamName
  };
}

function parseNumber(value) {
  const num = parseFloat(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(num) ? num : null;
}

function deriveAdvancedCards(_metsTeamRow, _oppTeamRow, metsLast10, oppLast10, teamAdvanced = null) {
  const metsHardHit = parseNumber(teamAdvanced?.mets?.hardHit);
  const oppHardHit = parseNumber(teamAdvanced?.opp?.hardHit);
  const metsBarrel = parseNumber(teamAdvanced?.mets?.barrelPct);
  const oppBarrel = parseNumber(teamAdvanced?.opp?.barrelPct);
  const metsWalk = parseNumber(teamAdvanced?.mets?.bbPct);
  const oppWalk = parseNumber(teamAdvanced?.opp?.bbPct);
  const metsK = parseNumber(teamAdvanced?.mets?.kPct);
  const oppK = parseNumber(teamAdvanced?.opp?.kPct);
  const metsWrc = parseNumber(teamAdvanced?.mets?.wrcPlus);
  const oppWrc = parseNumber(teamAdvanced?.opp?.wrcPlus);
  const metsIso = parseNumber(teamAdvanced?.mets?.iso);
  const oppIso = parseNumber(teamAdvanced?.opp?.iso);
  const metsXwoba = parseNumber(teamAdvanced?.mets?.xwoba);
  const oppXwoba = parseNumber(teamAdvanced?.opp?.xwoba);
  const edgeForHigher = (left, right) => left == null || right == null ? "Neutral" : left > right ? "Mets" : right > left ? "Opp" : "Neutral";
  const edgeForLower = (left, right) => left == null || right == null ? "Neutral" : left < right ? "Mets" : right < left ? "Opp" : "Neutral";

  const qualityOfContactCard = metsHardHit != null && oppHardHit != null
    ? {
        category: "Hard-Hit %",
        mets: `${metsHardHit.toFixed(1)}%`,
        opp: `${oppHardHit.toFixed(1)}%`,
        edge: edgeForHigher(metsHardHit, oppHardHit)
      }
    : {
        category: "ISO",
        mets: metsIso == null ? "N/A" : (metsIso < 1 ? metsIso.toFixed(3).replace(/^0/, "") : metsIso.toFixed(3)),
        opp: oppIso == null ? "N/A" : (oppIso < 1 ? oppIso.toFixed(3).replace(/^0/, "") : oppIso.toFixed(3)),
        edge: edgeForHigher(metsIso, oppIso)
      };

  const impactContactCard = metsBarrel != null && oppBarrel != null
    ? {
        category: "Barrel %",
        mets: `${metsBarrel.toFixed(1)}%`,
        opp: `${oppBarrel.toFixed(1)}%`,
        edge: edgeForHigher(metsBarrel, oppBarrel)
      }
    : {
        category: "xwOBA",
        mets: metsXwoba == null ? "N/A" : (metsXwoba < 1 ? metsXwoba.toFixed(3).replace(/^0/, "") : metsXwoba.toFixed(3)),
        opp: oppXwoba == null ? "N/A" : (oppXwoba < 1 ? oppXwoba.toFixed(3).replace(/^0/, "") : oppXwoba.toFixed(3)),
        edge: edgeForHigher(metsXwoba, oppXwoba)
      };

  return [
    {
      category: "Offense vs SP Hand - wRC+",
      mets: metsWrc == null ? "N/A" : String(metsWrc),
      opp: oppWrc == null ? "N/A" : String(oppWrc),
      edge: edgeForHigher(metsWrc, oppWrc)
    },
    qualityOfContactCard,
    impactContactCard,
    {
      category: "Walk Rate (BB%)",
      mets: metsWalk == null ? "N/A" : `${metsWalk.toFixed(1)}%`,
      opp: oppWalk == null ? "N/A" : `${oppWalk.toFixed(1)}%`,
      edge: edgeForHigher(metsWalk, oppWalk)
    },
    {
      category: "Strikeout Rate (K%)",
      mets: metsK == null ? sanitizeRecord(metsLast10, "N/A") : `${metsK.toFixed(1)}%`,
      opp: oppK == null ? sanitizeRecord(oppLast10, "N/A") : `${oppK.toFixed(1)}%`,
      edge: metsK == null || oppK == null ? compareRecords(metsLast10, oppLast10) : edgeForLower(metsK, oppK)
    }
  ];
}

async function getTeamSeasonStats(teamId, group, season) {
  const data = await safeGetJson(
    `https://statsapi.mlb.com/api/v1/teams/${teamId}/stats?stats=season&group=${group}&season=${season}`,
    `team ${group} ${teamId} ${season}`
  );
  return data?.stats?.[0]?.splits?.[0]?.stat || null;
}

function pctFromCounts(numerator, denominator) {
  const num = Number(numerator || 0);
  const den = Number(denominator || 0);
  if (!den) return null;
  return ((num / den) * 100).toFixed(1);
}

function deriveApproxWrcPlus(hittingStat) {
  const ops = parseFloat(String(hittingStat?.ops || ""));
  if (!Number.isFinite(ops)) return null;
  return Math.round(((ops / 0.720) * 100));
}

function weightedAverage(items, getter, weightGetter) {
  let weightTotal = 0;
  let weightedTotal = 0;
  for (const item of items || []) {
    const value = parseNumber(getter(item));
    const weight = Number(weightGetter(item) || 0);
    if (value == null || weight <= 0) continue;
    weightedTotal += value * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? (weightedTotal / weightTotal).toFixed(3).replace(/0+$/,'').replace(/\.$/,'') : null;
}

function weightedAveragePct(items, getter, weightGetter) {
  const avg = weightedAverage(items, getter, weightGetter);
  if (avg == null) return null;
  return Number(avg).toFixed(1);
}

function buildSingleTeamAdvanced(hittingStat, pitchingStat, roster = [], savantBattersByPlayer = {}, savantExpectedBattersByPlayer = {}, fangraphsTeam = null) {
  const hitters = roster.filter((player) => player.primaryPosition?.abbreviation !== "P");
  const paFor = (player) => Number(player?.stats?.plateAppearances || savantBattersByPlayer[player.id]?.pa || savantExpectedBattersByPlayer[player.id]?.pa || (savantBattersByPlayer[player.id] || savantExpectedBattersByPlayer[player.id] ? 1 : 0));

  const battingTotal = fangraphsTeam?.battingTeamTotal || {};
  const pitchingTotal = fangraphsTeam?.pitchingTeamTotal || {};
  return {
    wrcPlus: battingTotal['wRC+'] || deriveApproxWrcPlus(hittingStat),
    woba: battingTotal['wOBA'] || null,
    iso: battingTotal['ISO'] || null,
    xba: weightedAverage(hitters, (player) => savantExpectedBattersByPlayer[player.id]?.est_ba, paFor) || hittingStat?.avg || null,
    xslg: weightedAverage(hitters, (player) => savantExpectedBattersByPlayer[player.id]?.est_slg, paFor),
    xwoba: weightedAverage(hitters, (player) => savantExpectedBattersByPlayer[player.id]?.est_woba, paFor),
    ops: battingTotal['OPS'] || hittingStat?.ops || null,
    hardHit: weightedAveragePct(hitters, (player) => savantBattersByPlayer[player.id]?.hard_hit_percent, paFor),
    barrelPct: weightedAveragePct(hitters, (player) => savantBattersByPlayer[player.id]?.barrel_batted_rate, paFor),
    bbPct: battingTotal['BB%'] || pctFromCounts(hittingStat?.baseOnBalls, hittingStat?.plateAppearances),
    kPct: battingTotal['K%'] || pctFromCounts(hittingStat?.strikeOuts, hittingStat?.plateAppearances),
    rotFip: pitchingTotal['FIP'] || pitchingStat?.fip || null,
    rotXfip: pitchingTotal['xFIP'] || null,
    rotEra: pitchingTotal['ERA'] || pitchingStat?.era || null,
    rotWhip: pitchingStat?.whip || null,
    pitchKPct: pitchingTotal['K%'] || null,
    pitchBBPct: pitchingTotal['BB%'] || null
  };
}

async function buildTeamAdvancedFacts(metsTeamId, oppTeamId) {
  const season = String(new Date().getFullYear());
  const metsName = Object.keys(TEAM_IDS).find((name) => TEAM_IDS[name] === metsTeamId) || TEAM_NAME;
  const oppName = Object.keys(TEAM_IDS).find((name) => TEAM_IDS[name] === oppTeamId) || null;
  const [metsHitting, oppHitting, metsPitching, oppPitching, metsRoster, oppRoster, savantBatters, savantExpectedBatters, metsFg, oppFg] = await Promise.all([
    getTeamSeasonStats(metsTeamId, "hitting", season),
    getTeamSeasonStats(oppTeamId, "hitting", season),
    getTeamSeasonStats(metsTeamId, "pitching", season),
    getTeamSeasonStats(oppTeamId, "pitching", season),
    getTeamRoster(metsTeamId, season),
    getTeamRoster(oppTeamId, season),
    loadSavantBatterLeaderboard(),
    loadSavantExpectedBatters(),
    loadFangraphsTeamData(metsName),
    oppName ? loadFangraphsTeamData(oppName) : null
  ]);

  const savantBattersByPlayer = Object.fromEntries(savantBatters.map((row) => [Number(row.player_id), row]));
  const savantExpectedBattersByPlayer = Object.fromEntries(savantExpectedBatters.map((row) => [Number(row.player_id), row]));

  return {
    mets: buildSingleTeamAdvanced(metsHitting, metsPitching, metsRoster, savantBattersByPlayer, savantExpectedBattersByPlayer, metsFg),
    opp: buildSingleTeamAdvanced(oppHitting, oppPitching, oppRoster, savantBattersByPlayer, savantExpectedBattersByPlayer, oppFg)
  };
}

async function getTeamRecentGames(teamId, beforeDate, n = 5) {
  const season = beforeDate.slice(0, 4);
  const data = await safeGetJson(
    `https://statsapi.mlb.com/api/v1/schedule?teamId=${teamId}&sportId=1&gameType=R&startDate=${season}-03-01&endDate=${beforeDate}&hydrate=linescore,team`,
    `recent games ${teamId} ${beforeDate}`
  );

  const games = [];
  for (const dateEntry of data?.dates || []) {
    for (const game of dateEntry.games || []) {
      const state = game?.status?.detailedState || "";
      if (!["Final", "Completed Early", "Game Over"].includes(state)) continue;
      const isHome = game?.teams?.home?.team?.id === teamId;
      const oppTeam = isHome ? game?.teams?.away?.team : game?.teams?.home?.team;
      const teamScore = isHome ? game?.teams?.home?.score : game?.teams?.away?.score;
      const oppScore = isHome ? game?.teams?.away?.score : game?.teams?.home?.score;
      games.push({
        date: dateEntry.date,
        opponent: oppTeam?.name || "Opponent TBD",
        homeAway: isHome ? "home" : "road",
        result: Number(teamScore) > Number(oppScore) ? "W" : "L",
        score: `${teamScore}-${oppScore}`
      });
    }
  }

  return games.sort((a, b) => b.date.localeCompare(a.date)).slice(0, n);
}

async function getHeadToHead(teamId, oppTeamId, season) {
  const data = await safeGetJson(
    `https://statsapi.mlb.com/api/v1/schedule?teamId=${teamId}&opponentId=${oppTeamId}&sportId=1&gameType=R&startDate=${season}-03-01&endDate=${season}-11-30&hydrate=linescore,team`,
    `head to head ${teamId} ${oppTeamId} ${season}`
  );

  let wins = 0;
  let losses = 0;
  for (const dateEntry of data?.dates || []) {
    for (const game of dateEntry.games || []) {
      const state = game?.status?.detailedState || "";
      if (!["Final", "Completed Early", "Game Over"].includes(state)) continue;
      const isHome = game?.teams?.home?.team?.id === teamId;
      const teamScore = isHome ? game?.teams?.home?.score : game?.teams?.away?.score;
      const oppScore = isHome ? game?.teams?.away?.score : game?.teams?.home?.score;
      if (Number(teamScore) > Number(oppScore)) wins += 1;
      else losses += 1;
    }
  }

  return { wins, losses };
}

async function getPitcherRecentStarts(mlbId, beforeDate, n = 4) {
  if (!mlbId) return [];
  const season = Number(beforeDate.slice(0, 4));
  const seasonsToTry = [season, season - 1];

  for (const year of seasonsToTry) {
    const data = await safeGetJson(
      `https://statsapi.mlb.com/api/v1/people/${mlbId}/stats?stats=gameLog&group=pitching&season=${year}`,
      `pitcher game log ${mlbId} ${year}`
    );

    const starts = (data?.stats?.[0]?.splits || [])
      .filter((split) => split?.date && (year < season || split.date < beforeDate))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, n)
      .map((split) => ({
        date: split.date,
        opponent: split?.opponent?.name || split?.team?.name || "Opponent TBD",
        ip: split?.stat?.inningsPitched || "0.0",
        er: split?.stat?.earnedRuns != null ? String(split.stat.earnedRuns) : "0",
        k: split?.stat?.strikeOuts != null ? String(split.stat.strikeOuts) : "0",
        result: split?.isWin ? "W" : split?.isLoss ? "L" : split?.stat?.wins ? "W" : split?.stat?.losses ? "L" : "-"
      }));

    if (starts.length) return starts;
  }

  return [];
}

function splitIntoSentences(value, limit = 2) {
  return cleanText(value)
    .replace(/^[A-Z\s.-]{2,}\s+--\s+/, "")
    .split(/(?<=[.?!])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && sentence.length >= 24)
    .slice(0, limit);
}

function buildEditorialSource(entry, defaultLabel) {
  if (!entry) return null;
  const headline = cleanText(entry.headline || entry.seoTitle || entry.subhead || defaultLabel || "");
  const url = entry.url || null;
  const source = cleanText(entry.source || "MLB.com");
  if (!headline && !url) return null;
  return {
    source,
    label: defaultLabel || "Editorial",
    headline: headline || defaultLabel || "Editorial",
    url
  };
}

function extractPreviewBundle(content) {
  const previewEntry = content?.editorial?.preview?.mlb || content?.editorial?.preview?.article || null;
  const wrapEntry = content?.editorial?.wrap?.mlb || content?.editorial?.wrap?.article || null;
  const sourceEntry = previewEntry || wrapEntry || null;
  const source = buildEditorialSource(sourceEntry, sourceEntry ? "Game preview" : "Preview context");
  const rawPreview =
    previewEntry?.body ||
    previewEntry?.headline ||
    wrapEntry?.body ||
    wrapEntry?.headline ||
    "";

  return {
    facts: splitIntoSentences(rawPreview, 2),
    source
  };
}

async function getMostRecentHeadToHeadGame(teamId, oppTeamId, beforeDate) {
  const season = beforeDate.slice(0, 4);
  const data = await safeGetJson(
    `https://statsapi.mlb.com/api/v1/schedule?teamId=${teamId}&opponentId=${oppTeamId}&sportId=1&gameType=R&startDate=${season}-03-01&endDate=${beforeDate}&hydrate=linescore,team,venue`,
    `last h2h game ${teamId} ${oppTeamId} ${beforeDate}`
  );

  const games = (data?.dates || [])
    .flatMap((dateEntry) => dateEntry.games || [])
    .filter((game) => {
      const state = game?.status?.detailedState || "";
      return ["Final", "Completed Early", "Game Over"].includes(state) && game?.officialDate < beforeDate;
    })
    .sort((a, b) => new Date(b.gameDate) - new Date(a.gameDate));

  return games[0] || null;
}

async function buildLastMeetingSummary(teamId, oppTeamId, beforeDate) {
  const game = await getMostRecentHeadToHeadGame(teamId, oppTeamId, beforeDate);
  if (!game?.gamePk) return null;

  const metsAreHome = game?.teams?.home?.team?.id === teamId;
  const metsSide = metsAreHome ? game?.teams?.home : game?.teams?.away;
  const oppSide = metsAreHome ? game?.teams?.away : game?.teams?.home;
  const recapContent = await getGameContent(game.gamePk);
  const recapEntry = recapContent?.editorial?.recap?.mlb || recapContent?.editorial?.recap?.article || null;
  const recapSentences = splitIntoSentences(recapEntry?.body || recapEntry?.headline || recapEntry?.blurb || "", 2);
  const headline = cleanText(recapEntry?.headline || recapEntry?.seoTitle || recapEntry?.blurb || "");

  return {
    gamePk: game.gamePk,
    date: game.officialDate,
    ballpark: game?.venue?.name || "Venue TBD",
    metsScore: metsSide?.score ?? null,
    oppScore: oppSide?.score ?? null,
    result: Number(metsSide?.score) > Number(oppSide?.score) ? "win" : "loss",
    summary: `On ${game.officialDate}, the Mets ${Number(metsSide?.score) > Number(oppSide?.score) ? "beat" : "lost to"} the ${oppSide?.team?.name || "opponent"} ${metsSide?.score ?? "?"}-${oppSide?.score ?? "?"} at ${game?.venue?.name || "the ballpark"}.`,
    recapHeadline: headline || null,
    recapNotes: recapSentences,
    source: buildEditorialSource(recapEntry, "Last meeting recap")
  };
}

async function getOddsFacts(game) {
  if (!ODDS_API_KEY) {
    console.log("No ODDS_API_KEY set; skipping live odds fetch.");
    return {
      metsMoneyline: null,
      oppMoneyline: null,
      runLine: null,
      total: null
    };
  }

  const commenceTime = game?.gameDate;
  const homeTeam = game?.teams?.home?.team?.name;
  const awayTeam = game?.teams?.away?.team?.name;
  if (!commenceTime || !homeTeam || !awayTeam) {
    return {
      metsMoneyline: null,
      oppMoneyline: null,
      runLine: null,
      total: null
    };
  }

  const oddsUrl = "https://api.the-odds-api.com/v4/sports/baseball_mlb/odds";
  const params = {
    apiKey: ODDS_API_KEY,
    regions: "us",
    markets: "h2h,spreads,totals",
    bookmakers: "draftkings,fanduel,betmgm,caesars",
    dateFormat: "iso",
    commenceTimeFrom: new Date(new Date(commenceTime).getTime() - 12 * 60 * 60 * 1000).toISOString(),
    commenceTimeTo: new Date(new Date(commenceTime).getTime() + 12 * 60 * 60 * 1000).toISOString()
  };

  try {
    const response = await axios.get(oddsUrl, { params, timeout: 15000 });
    const events = Array.isArray(response.data) ? response.data : [];
    const event = events.find((candidate) =>
      candidate?.home_team === homeTeam && candidate?.away_team === awayTeam
    );

    if (!event) {
      console.warn(`[warn] No matching odds event found for ${awayTeam} at ${homeTeam}`);
      return {
        metsMoneyline: null,
        oppMoneyline: null,
        runLine: null,
        total: null
      };
    }

    const bookmaker = (event.bookmakers || [])[0];
    const h2h = bookmaker?.markets?.find((market) => market.key === "h2h");
    const spreads = bookmaker?.markets?.find((market) => market.key === "spreads");
    const totals = bookmaker?.markets?.find((market) => market.key === "totals");

    const getOutcome = (market, teamName) =>
      market?.outcomes?.find((outcome) => outcome.name === teamName) || null;

    const metsOutcome = getOutcome(h2h, TEAM_NAME);
    const oppTeamName = homeTeam === TEAM_NAME ? awayTeam : homeTeam;
    const oppOutcome = getOutcome(h2h, oppTeamName);
    const metsSpreadOutcome = getOutcome(spreads, TEAM_NAME);
    const overOutcome = totals?.outcomes?.find((outcome) => /over/i.test(outcome.name || "")) || null;

    return {
      metsMoneyline: typeof metsOutcome?.price === "number" ? metsOutcome.price : null,
      oppMoneyline: typeof oppOutcome?.price === "number" ? oppOutcome.price : null,
      runLine: metsSpreadOutcome && typeof metsSpreadOutcome.point === "number" && typeof metsSpreadOutcome.price === "number"
        ? {
            side: "mets",
            spread: metsSpreadOutcome.point,
            price: metsSpreadOutcome.price
          }
        : null,
      total: typeof overOutcome?.point === "number" ? overOutcome.point : null
    };
  } catch (error) {
    console.warn(`[warn] Odds API fetch failed: ${error.response?.data?.message || error.message}`);
    return {
      metsMoneyline: null,
      oppMoneyline: null,
      runLine: null,
      total: null
    };
  }
}

async function buildGameFacts(targetDate) {
  const { requestedDate, resolvedDate, game } = await resolveTargetGame(targetDate);
  const isHome = game?.teams?.home?.team?.id === TEAM_ID;
  const oppTeam = isHome ? game?.teams?.away?.team : game?.teams?.home?.team;
  const previousOutput = loadPreviousOutput();
  const previousGame = previousOutput?.games?.[0];

  const [feed, content, metsRecords, oppRecords, metsInjuries, oppInjuries] = await Promise.all([
    getGameFeed(game.gamePk),
    getGameContent(game.gamePk),
    getTeamSeasonRecordFacts(TEAM_ID, resolvedDate, false),
    getTeamSeasonRecordFacts(oppTeam.id, resolvedDate, false),
    getTeamInjuries(TEAM_ID),
    getTeamInjuries(oppTeam.id)
  ]);

  const probablePitchers = {
    mets: isHome ? game?.teams?.home?.probablePitcher : game?.teams?.away?.probablePitcher,
    opp: isHome ? game?.teams?.away?.probablePitcher : game?.teams?.home?.probablePitcher
  };

  const [pitching, lineups, metsBullpen, oppBullpen, teamAdvanced, metsRecentGames, oppRecentGames, headToHead, metsPitcherLog, oppPitcherLog, money, lastMeeting] = await Promise.all([
    Promise.all([
      getPitcherFacts(probablePitchers.mets?.id, probablePitchers.mets?.fullName, TEAM_NAME),
      getPitcherFacts(probablePitchers.opp?.id, probablePitchers.opp?.fullName, oppTeam.name)
    ]).then(([metsPitcher, oppPitcher]) => ({ mets: metsPitcher, opp: oppPitcher })),
    buildLineupFacts(feed, oppTeam.id, resolvedDate),
    buildBullpenFacts(TEAM_ID, TEAM_NAME, true),
    buildBullpenFacts(oppTeam.id, oppTeam.name, false),
    buildTeamAdvancedFacts(TEAM_ID, oppTeam.id),
    getTeamRecentGames(TEAM_ID, resolvedDate, 5),
    getTeamRecentGames(oppTeam.id, resolvedDate, 5),
    getHeadToHead(TEAM_ID, oppTeam.id, resolvedDate.slice(0, 4)),
    getPitcherRecentStarts(probablePitchers.mets?.id, resolvedDate, 4),
    getPitcherRecentStarts(probablePitchers.opp?.id, resolvedDate, 4),
    getOddsFacts(game),
    buildLastMeetingSummary(TEAM_ID, oppTeam.id, resolvedDate)
  ]);

  const metsTeamRow = null;
  const oppTeamRow = null;
  const previewBundle = extractPreviewBundle(content);

  const finalState = game?.status?.detailedState || "";
  const isFinal = ["Final", "Completed Early", "Game Over"].includes(finalState);
  const metsScore = isHome ? game?.teams?.home?.score : game?.teams?.away?.score;
  const oppScore = isHome ? game?.teams?.away?.score : game?.teams?.home?.score;

  const facts = {
    meta: {
      requestedDate,
      date: resolvedDate,
      time: formatTimeET(game?.gameDate),
      ballpark: game?.venue?.name || "Venue TBD",
      homeTeam: game?.teams?.home?.team?.name || TEAM_NAME,
      awayTeam: game?.teams?.away?.team?.name || oppTeam?.name || "Opponent TBD",
      homeAway: isHome ? "home" : "road"
    },
    records: {
      metsRecord: metsRecords.overall,
      oppRecord: oppRecords.overall,
      metsLast10: metsRecords.last10,
      oppLast10: oppRecords.last10,
      metsHome: metsRecords.home,
      metsRoad: metsRecords.road,
      oppHome: oppRecords.home,
      oppRoad: oppRecords.road
    },
    money,
    pitching: {
      mets: pitching.mets,
      opp: pitching.opp,
      metsBullpen,
      oppBullpen
    },
    lineups,
    trends: previewBundle.facts,
    editorial: {
      previewSource: previewBundle.source,
      recentSources: [previewBundle.source, lastMeeting?.source].filter(Boolean)
    },
    injuries: [
      ...metsInjuries.map((injury) => `Mets: ${injury}`),
      ...oppInjuries.map((injury) => `${oppTeam.name}: ${injury}`)
    ],
    gameContext: {
      metsRecentGames,
      oppRecentGames,
      metsInjuries: metsInjuries.map((injury) => ({ name: injury.split(" (")[0], status: injury.match(/\(([^)]+)\)/)?.[1] || "IL", description: injury })),
      oppInjuries: oppInjuries.map((injury) => ({ name: injury.split(" (")[0], status: injury.match(/\(([^)]+)\)/)?.[1] || "IL", description: injury })),
      headToHead,
      lastMeeting,
      metsPitcherLog,
      oppPitcherLog
    },
    advanced: {
      cards: deriveAdvancedCards(metsTeamRow, oppTeamRow, metsRecords.last10, oppRecords.last10, teamAdvanced),
      savantTeam: {
        mets: metsTeamRow || null,
        opp: oppTeamRow || null
      },
      teamAdvanced
    },
    game: {
      gamePk: game.gamePk,
      opponent: oppTeam?.name || "Opponent TBD",
      oppTeamId: oppTeam?.id || TEAM_IDS[oppTeam?.name] || null,
      status: isFinal ? "final" : "upcoming",
      finalScore: isFinal ? { mets: metsScore ?? 0, opp: oppScore ?? 0 } : null,
      result: isFinal ? (Number(metsScore) > Number(oppScore) ? "win" : "loss") : null,
      seriesGameNumber: game?.seriesGameNumber || 1
    }
  };

  ensureNoUndefinedStrings(sanitizeForModel(facts));
  return facts;
}

function buildFallbackWriteup(gameFacts) {
  const opponent = gameFacts.game.opponent;
  const metsRecord = sanitizeRecord(gameFacts.records.metsRecord);
  const oppRecord = sanitizeRecord(gameFacts.records.oppRecord);
  const metsPitcher = gameFacts.pitching.mets.name || "TBD";
  const oppPitcher = gameFacts.pitching.opp.name || "TBD";
  const lineupStatus = gameFacts.lineups.status === "confirmed" ? "confirmed" : "projected";
  const ballpark = gameFacts.meta.ballpark || "Venue TBD";
  const lastMeeting = gameFacts.gameContext?.lastMeeting;
  const previewSource = gameFacts.editorial?.previewSource;
  const recapClause = lastMeeting?.recapHeadline
    ? `Recap source: ${lastMeeting.recapHeadline}. `
    : "";
  const previewClause = previewSource?.headline
    ? `Preview source: ${previewSource.headline}. `
    : "";

  const metsBp = gameFacts.pitching.metsBullpen || {};
  const oppBp = gameFacts.pitching.oppBullpen || {};
  const ta = gameFacts.advanced?.teamAdvanced || {};
  const lastMeetingLine = lastMeeting?.summary ? `Last meeting: ${lastMeeting.summary}` : null;
  const sourceLine = previewSource?.headline ? `Source: ${previewSource.headline}.` : null;
  const shortRecapBody = [
    `Mets ${metsRecord}, ${opponent} ${oppRecord}, ${ballpark}.`,
    lastMeetingLine,
    recapClause ? recapClause.trim() : null,
    sourceLine
  ].filter(Boolean).join(" ");

  return {
    raw: JSON.stringify({ fallback: true, generatedAt: new Date().toISOString() }),
    sections: [
      {
        heading: "1. Short Recap",
        body: shortRecapBody
      },
      {
        heading: "2. Pitching Matchup",
        body: `${metsPitcher}${gameFacts.pitching.mets.seasonERA ? ` (${gameFacts.pitching.mets.seasonERA} ERA` : ""}${gameFacts.pitching.mets.seasonWHIP ? `, ${gameFacts.pitching.mets.seasonWHIP} WHIP` : ""}${gameFacts.pitching.mets.note ? `, ${gameFacts.pitching.mets.note}` : ""}${gameFacts.pitching.mets.seasonERA ? ")" : ""} vs ${oppPitcher}${gameFacts.pitching.opp.seasonERA ? ` (${gameFacts.pitching.opp.seasonERA} ERA` : ""}${gameFacts.pitching.opp.seasonWHIP ? `, ${gameFacts.pitching.opp.seasonWHIP} WHIP` : ""}${gameFacts.pitching.opp.note ? `, ${gameFacts.pitching.opp.note}` : ""}${gameFacts.pitching.opp.seasonERA ? ")" : ""}.`
      },
      {
        heading: "3. Lineup Comparison",
        body: `Lineups are ${lineupStatus}. Team offense: NYM wRC+ ${ta.mets?.wrcPlus || "N/A"}, xwOBA ${ta.mets?.xwoba || "N/A"}, K% ${ta.mets?.kPct || "N/A"}. ${opponent} wRC+ ${ta.opp?.wrcPlus || "N/A"}, xwOBA ${ta.opp?.xwoba || "N/A"}, K% ${ta.opp?.kPct || "N/A"}.`
      },
      {
        heading: "4. Bullpen",
        body: `Bullpen check: Mets ERA ${metsBp.seasonERA || "N/A"}, xFIP ${metsBp.seasonXFIP || "N/A"}, WHIP ${metsBp.seasonWHIP || "N/A"}. ${opponent} ERA ${oppBp.seasonERA || "N/A"}, xFIP ${oppBp.seasonXFIP || "N/A"}, WHIP ${oppBp.seasonWHIP || "N/A"}.`
      },
      {
        heading: "5. Key Edges",
        body: `Main numbers: NYM wRC+ ${ta.mets?.wrcPlus || "N/A"} vs ${ta.opp?.wrcPlus || "N/A"}, NYM xwOBA ${ta.mets?.xwoba || "N/A"} vs ${ta.opp?.xwoba || "N/A"}, NYM bullpen rating ${metsBp.rating || "N/A"} vs ${oppBp.rating || "N/A"}.`
      },
      {
        heading: "6. Today's Pick",
        body: `Today's Pick: New York Mets Moneyline. Reason: better lineup quality and the stronger bullpen numbers.`
      }
    ],
    pickSummary: `Play the Mets moneyline. The case is simple: better team offense, cleaner bullpen profile, and a favorable recent series result.`,
    officialPick: "Today's Pick: New York Mets Moneyline"
  };
}

async function generateWriteupFromFacts(gameFacts) {
  const factsForModel = sanitizeForModel(gameFacts);
  ensureNoUndefinedStrings(factsForModel);

  if (!openai) {
    console.warn("[warn] OPENAI_API_KEY is not set. Falling back to deterministic writeup.");
    return buildFallbackWriteup(gameFacts);
  }

  const system = [
    "You write MetsMoneyline game previews.",
    "Return JSON only.",
    "You may only use facts present in the provided gameFacts object.",
    "Do not invent records, standings, injuries, lineups, or recap details.",
    "If a fact is null or missing, say it is not yet announced or omit it.",
    "When gameFacts.gameContext.lastMeeting exists, explicitly reference the most recent game these teams played and include concrete details from that game.",
    "When gameFacts.editorial.recentSources exists, use that sourced preview/recap context as support for the analysis and mention the specific sourced detail rather than speaking generically.",
    "Write in a technical, stat-driven, concise style.",
    "Use a betting-note structure: split -> edge -> implication.",
    "Prioritize matchup mechanics, underlying metrics, handedness splits, contact quality, strikeout/walk profile, and bullpen indicators.",
    "Keep every section tight and analytical. No filler, no scene-setting, no generic newsletter language.",
    "Avoid phrases like by design, keeps it factual, remains not yet announced, or references to scripts/templates/automation.",
    "Always pick the Mets.",
    "There must be exactly 6 sections with these headings:",
    "1. Short Recap",
    "2. Pitching Matchup",
    "3. Lineup Comparison",
    "4. Bullpen",
    "5. Key Edges",
    "6. Today's Pick"
  ].join(" ");

  const user = JSON.stringify({
    instructions: {
      outputShape: {
        sections: [
          { heading: "1. Short Recap", body: "..." },
          { heading: "2. Pitching Matchup", body: "..." },
          { heading: "3. Lineup Comparison", body: "..." },
          { heading: "4. Bullpen", body: "..." },
          { heading: "5. Key Edges", body: "..." },
          { heading: "6. Today's Pick", body: "..." }
        ],
        pickSummary: "one sharp, human-sounding paragraph",
        officialPick: "Today's Pick: New York Mets Moneyline"
      }
    },
    gameFacts: factsForModel
  });

  const completion = await openai.chat.completions.create({
    model: DEFAULT_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  });

  const raw = completion?.choices?.[0]?.message?.content || "";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`OpenAI returned invalid JSON: ${error.message}`);
  }

  if (!Array.isArray(parsed.sections) || parsed.sections.length !== 6) {
    throw new Error("OpenAI writeup must contain exactly 6 sections.");
  }

  return {
    raw,
    sections: parsed.sections.map((section) => ({
      heading: String(section.heading || ""),
      body: cleanText(section.body || "")
    })),
    pickSummary: cleanText(parsed.pickSummary || ""),
    officialPick: parsed.officialPick || "Today's Pick: New York Mets Moneyline"
  };
}

function buildTrendArray(gameFacts) {
  const metsLast10 = sanitizeRecord(gameFacts.records.metsLast10);
  const oppLast10 = sanitizeRecord(gameFacts.records.oppLast10);
  const metsHomeRoad = gameFacts.meta.homeAway === "home"
    ? `Home ${sanitizeRecord(gameFacts.records.metsHome)}`
    : `Road ${sanitizeRecord(gameFacts.records.metsRoad)}`;
  const oppHomeRoad = gameFacts.meta.homeAway === "home"
    ? `Road ${sanitizeRecord(gameFacts.records.oppRoad)}`
    : `Home ${sanitizeRecord(gameFacts.records.oppHome)}`;

  return [
    {
      category: "Last 10 Games",
      mets: metsLast10,
      opp: oppLast10,
      edge: compareRecords(metsLast10, oppLast10)
    },
    {
      category: "Home/Road",
      mets: metsHomeRoad,
      opp: oppHomeRoad,
      edge: compareRecords(
        gameFacts.meta.homeAway === "home" ? gameFacts.records.metsHome : gameFacts.records.metsRoad,
        gameFacts.meta.homeAway === "home" ? gameFacts.records.oppRoad : gameFacts.records.oppHome
      )
    },
    {
      category: "Series Context",
      mets: `Game ${gameFacts.game.seriesGameNumber || 1}`,
      opp: `Game ${gameFacts.game.seriesGameNumber || 1}`,
      edge: "Neutral"
    }
  ];
}

function calculateMoneylineProfit(odds, stake = 100) {
  if (typeof odds !== "number") return null;
  if (odds < 0) return Number(((stake / Math.abs(odds)) * 100).toFixed(2));
  return Number(((odds / 100) * stake).toFixed(2));
}

function toHistoryEntry(game, existingEntry = null) {
  if (!game?.date || !game?.opponent || !game?.result) return null;
  const finalScore = game.finalScore
    ? `${game.finalScore.mets}-${game.finalScore.opp}`
    : game.gameContext?.lastMeeting?.metsScore != null && game.gameContext?.lastMeeting?.oppScore != null
      ? `${game.gameContext.lastMeeting.metsScore}-${game.gameContext.lastMeeting.oppScore}`
      : existingEntry?.finalScore || null;
  const metsWon = game.result === "win";
  const moneyline = game.moneyline?.mets ?? game.bettingHistory?.odds ?? existingEntry?.odds ?? null;
  const profit = typeof moneyline === "number"
    ? (metsWon ? calculateMoneylineProfit(moneyline) : -100)
    : existingEntry?.profit ?? null;
  return {
    date: game.date,
    opponent: game.opponent,
    finalScore,
    officialPick: game.writeup?.officialPick || existingEntry?.officialPick || "Today's Pick: New York Mets Moneyline",
    market: existingEntry?.market || "Mets Moneyline",
    odds: moneyline,
    result: metsWon ? "W" : "L",
    profit
  };
}

function mergeRecentBreakdowns(previousOutput, currentGame, persistentHistoryEntries = []) {
  const prior = Array.isArray(previousOutput?.recentBreakdowns) ? previousOutput.recentBreakdowns : [];
  const entries = [...persistentHistoryEntries, ...prior];
  const previousGame = previousOutput?.games?.[0] || null;
  const previousEntry = toHistoryEntry(previousGame);

  if (previousGame?.status === "final") {
    const index = entries.findIndex((entry) => entry.date === previousGame.date && entry.opponent === previousGame.opponent);
    const existingEntry = index >= 0 ? entries[index] : null;
    const mergedPreviousEntry = toHistoryEntry(previousGame, existingEntry);
    if (mergedPreviousEntry) {
      if (index >= 0) entries[index] = mergedPreviousEntry;
      else entries.push(mergedPreviousEntry);
    }
  }

  if (currentGame?.status === "final") {
    const index = entries.findIndex((entry) => entry.date === currentGame.date && entry.opponent === currentGame.opponent);
    const existingEntry = index >= 0 ? entries[index] : null;
    const mergedCurrentEntry = toHistoryEntry(currentGame, existingEntry);
    if (mergedCurrentEntry) {
      if (index >= 0) entries[index] = mergedCurrentEntry;
      else entries.push(mergedCurrentEntry);
    }
  }

  return entries
    .filter((entry) => entry?.date && entry?.opponent)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 30);
}

function buildGameJson(gameFacts, writeup, previousOutput = null, pickHistory = null) {
  const opponentSlug = slugify(gameFacts.game.opponent);
  const id = `${gameFacts.meta.date}-mets-vs-${opponentSlug}`;
  const officialPick = writeup.officialPick || "Today's Pick: New York Mets Moneyline";
  const sections = writeup.sections;

  const currentGame = {
    id,
    date: gameFacts.meta.date,
    time: gameFacts.meta.time,
    ballpark: gameFacts.meta.ballpark,
    opponent: gameFacts.game.opponent,
    oppTeamId: gameFacts.game.oppTeamId,
    homeAway: gameFacts.meta.homeAway,
    metsRecord: sanitizeRecord(gameFacts.records.metsRecord),
    oppRecord: sanitizeRecord(gameFacts.records.oppRecord),
    moneyline: {
      mets: gameFacts.money.metsMoneyline,
      opp: gameFacts.money.oppMoneyline
    },
    runLine: gameFacts.money.runLine
      ? {
          mets: gameFacts.money.runLine.side === "mets" ? gameFacts.money.runLine.spread : null,
          price: gameFacts.money.runLine.price
        }
      : null,
    total: gameFacts.money.total,
    overUnder: gameFacts.money.total,
    status: gameFacts.game.status,
    finalScore: gameFacts.game.finalScore,
    result: gameFacts.game.result,
    pitching: {
      mets: gameFacts.pitching.mets,
      opp: gameFacts.pitching.opp,
      metsBullpen: gameFacts.pitching.metsBullpen,
      oppBullpen: gameFacts.pitching.oppBullpen
    },
    lineups: {
      mets: gameFacts.lineups.mets,
      opp: gameFacts.lineups.opp,
      lineupStatus: gameFacts.lineups.status
    },
    advancedMatchup: gameFacts.advanced.cards,
    teamAdvanced: gameFacts.advanced.teamAdvanced,
    gameContext: gameFacts.gameContext,
    editorial: gameFacts.editorial,
    trends: buildTrendArray(gameFacts),
    writeup: {
      raw: writeup.raw,
      sections,
      pickSummary: writeup.pickSummary,
      officialPick
    },
    bettingHistory: null,
    weather: null
  };

  const priorSettledEntry = Array.isArray(previousOutput?.recentBreakdowns)
    ? previousOutput.recentBreakdowns.find((entry) => entry.date === currentGame.date && entry.opponent === currentGame.opponent)
    : null;

  currentGame.bettingHistory = currentGame.status === "final"
    ? {
        market: "Mets Moneyline",
        odds: currentGame.moneyline?.mets ?? priorSettledEntry?.odds ?? null,
        result: currentGame.result === "win" ? "W" : "L",
        profit: typeof (currentGame.moneyline?.mets ?? priorSettledEntry?.odds) === "number"
          ? (currentGame.result === "win"
              ? calculateMoneylineProfit(currentGame.moneyline?.mets ?? priorSettledEntry?.odds)
              : -100)
          : priorSettledEntry?.profit ?? null
      }
    : null;

  const output = {
    generatedAt: new Date().toISOString(),
    games: [currentGame],
    recentBreakdowns: mergeRecentBreakdowns(previousOutput, currentGame, Array.isArray(pickHistory?.entries) ? pickHistory.entries : [])
  };

  ensureNoUndefinedStrings(output);
  return output;
}

function buildEmailHtml(game) {
  const sectionsHtml = (game.writeup?.sections || [])
    .filter((section) => section.body || /^today's pick/i.test(section.heading))
    .map((section) => {
      if (!section.body) return `<h2>${section.heading}</h2>`;
      return `<h2>${section.heading}</h2><p>${section.body}</p>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>MetsMoneyline</title>
  </head>
  <body style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6; max-width: 680px; margin: 0 auto; padding: 24px;">
    <p style="font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #6b7280;">MetsMoneyline</p>
    <h1 style="margin-bottom: 8px;">New York Mets vs ${game.opponent}</h1>
    <p style="margin-top: 0; color: #4b5563;">${game.date} | ${game.time} | ${game.ballpark}</p>
    ${sectionsHtml}
    <p><strong>${game.writeup?.officialPick || "Today's Pick: New York Mets Moneyline"}</strong></p>
  </body>
</html>`;
}

async function createButtondownDraft(output) {
  const apiKey = process.env.BUTTONDOWN_API_KEY;
  if (!apiKey) {
    console.log("No BUTTONDOWN_API_KEY set; skipping Buttondown draft.");
    return;
  }

  const game = output?.games?.[0];
  if (!game) return;

  const subject = `MetsMoneyline - ${game.date}: New York Mets vs ${game.opponent}`;
  const body = buildEmailHtml(game);

  try {
    const response = await axios.post(
      "https://api.buttondown.com/v1/emails",
      {
        subject,
        body,
        status: "draft"
      },
      {
        timeout: 15000,
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "application/json"
        }
      }
    );
    console.log(`Buttondown draft created: ${response.data?.id || "unknown id"}`);
  } catch (error) {
    console.error("Failed to create Buttondown draft:", error.response?.data || error.message);
  }
}

async function run() {
  const { date, dryRun } = parseArgs(process.argv.slice(2));
  console.log(`Building Mets game package for ${date}${dryRun ? " (dry run)" : ""}...`);

  let gameFacts;
  try {
    gameFacts = await buildGameFacts(date);
  } catch (error) {
    const previousOutput = loadPreviousOutput();
    if (!dryRun && previousOutput) {
      console.warn(`[warn] Unable to build fresh game data for ${date}: ${error.message}`);
      console.warn("[warn] Keeping existing public/data/sample-game.json so deploy can continue.");
      return;
    }
    throw error;
  }

  let writeup;
  try {
    writeup = await generateWriteupFromFacts(gameFacts);
  } catch (error) {
    console.warn(`[warn] Writeup generation failed: ${error.message}`);
    console.warn("[warn] Falling back to deterministic writeup.");
    writeup = buildFallbackWriteup(gameFacts);
  }

  const previousOutput = loadPreviousOutput();
  const pickHistory = loadPickHistory();
  const output = buildGameJson(gameFacts, writeup, previousOutput, pickHistory);

  if (dryRun) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  fs.writeFileSync(SAMPLE_JSON_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${SAMPLE_JSON_PATH}`);
  const pickHistoryOutput = writePickHistory(Array.isArray(output.recentBreakdowns) ? output.recentBreakdowns : []);
  console.log(`Wrote ${PICK_HISTORY_PATH} with ${pickHistoryOutput.entries.length} entr${pickHistoryOutput.entries.length === 1 ? "y" : "ies"}`);
  await createButtondownDraft(output);
}

run().catch((error) => {
  console.error("Generator failed:", error.message);
  process.exit(1);
});

/*
How to run:
- node bot/generator.js
- node bot/generator.js --date 2026-03-16 --dry-run
*/
