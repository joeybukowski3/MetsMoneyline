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
const SAMPLE_JSON_PATH = path.join(__dirname, "../public/data/sample-game.json");
const PICK_HISTORY_PATH = path.join(__dirname, "../public/data/pick-history.json");
const PICK_HISTORY_SEED_PATH = path.join(__dirname, "../public/data/pick-history-seed.json");
const API_ODDS_PATH = path.join(__dirname, "../public/api/mlb/mets/odds");
const REPORT_HTML_PATH = path.join(__dirname, "../public/report.html");

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

const TEAM_NAME_TO_ABBR = {
  "Arizona Diamondbacks": "ARI",
  "Atlanta Braves": "ATL",
  "Baltimore Orioles": "BAL",
  "Boston Red Sox": "BOS",
  "Chicago Cubs": "CHC",
  "Chicago White Sox": "CHW",
  "Cincinnati Reds": "CIN",
  "Cleveland Guardians": "CLE",
  "Colorado Rockies": "COL",
  "Detroit Tigers": "DET",
  "Houston Astros": "HOU",
  "Kansas City Royals": "KCR",
  "Los Angeles Angels": "LAA",
  "Los Angeles Dodgers": "LAD",
  "Miami Marlins": "MIA",
  "Milwaukee Brewers": "MIL",
  "Minnesota Twins": "MIN",
  "New York Mets": "NYM",
  "New York Yankees": "NYY",
  "Oakland Athletics": "ATH",
  "Philadelphia Phillies": "PHI",
  "Pittsburgh Pirates": "PIT",
  "San Diego Padres": "SDP",
  "San Francisco Giants": "SFG",
  "Seattle Mariners": "SEA",
  "St. Louis Cardinals": "STL",
  "Tampa Bay Rays": "TBR",
  "Texas Rangers": "TEX",
  "Toronto Blue Jays": "TOR",
  "Washington Nationals": "WSN"
};

const BALLPARK_WEATHER_LOOKUP = {
  "Angel Stadium": { lat: 33.8003, lon: -117.8827 },
  "Busch Stadium": { lat: 38.6226, lon: -90.1928 },
  "Chase Field": { lat: 33.4453, lon: -112.0667 },
  "Citi Field": { lat: 40.7571, lon: -73.8458 },
  "Citizens Bank Park": { lat: 39.9061, lon: -75.1665 },
  "Comerica Park": { lat: 42.339, lon: -83.0485 },
  "Coors Field": { lat: 39.7559, lon: -104.9942 },
  "Daikin Park": { lat: 29.7573, lon: -95.3555 },
  "Dodger Stadium": { lat: 34.0739, lon: -118.24 },
  "Fenway Park": { lat: 42.3467, lon: -71.0972 },
  "George M. Steinbrenner Field": { lat: 27.9804, lon: -82.5076 },
  "Globe Life Field": { lat: 32.7473, lon: -97.0847, retractable: true },
  "Great American Ball Park": { lat: 39.0979, lon: -84.5081 },
  "Guaranteed Rate Field": { lat: 41.83, lon: -87.6338 },
  "Kauffman Stadium": { lat: 39.0517, lon: -94.4803 },
  "loanDepot park": { lat: 25.7781, lon: -80.2197, retractable: true },
  "Nationals Park": { lat: 38.873, lon: -77.0074 },
  "Oracle Park": { lat: 37.7786, lon: -122.3893 },
  "Oriole Park at Camden Yards": { lat: 39.284, lon: -76.6217 },
  "Petco Park": { lat: 32.7073, lon: -117.1573 },
  "PNC Park": { lat: 40.4469, lon: -80.0057 },
  "Progressive Field": { lat: 41.4962, lon: -81.6852 },
  "Rogers Centre": { lat: 43.6414, lon: -79.3894, retractable: true },
  "Sutter Health Park": { lat: 38.5806, lon: -121.5136 },
  "Target Field": { lat: 44.9817, lon: -93.2776 },
  "T-Mobile Park": { lat: 47.5914, lon: -122.3325, retractable: true },
  "Truist Park": { lat: 33.89, lon: -84.4677 },
  "Wrigley Field": { lat: 41.9484, lon: -87.6553 },
  "Yankee Stadium": { lat: 40.8296, lon: -73.9262 }
};

const WEATHER_CODE_LABELS = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Cloudy",
  45: "Fog",
  48: "Fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Rain showers",
  81: "Rain showers",
  82: "Heavy showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorms",
  96: "Thunderstorms",
  99: "Thunderstorms"
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
let cachedPitcherPercentileMaps = null;
const cachedFangraphsTeams = new Map();
const cachedFangraphsLeaderboards = new Map();

function getTodayEasternISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
}

function selectFeaturedGame(games, referenceDate = getTodayEasternISO()) {
  if (!Array.isArray(games) || games.length === 0) return null;
  return games.find((game) => game?.date === referenceDate)
    || games.find((game) => game?.date > referenceDate)
    || games[0]
    || null;
}

function parseArgs(argv) {
  const args = { date: getTodayEasternISO(), dryRun: false, debugAnalysis: false, buttondownDraft: false };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--date") {
      args.date = argv[i + 1];
      i += 1;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--debug-analysis") {
      args.debugAnalysis = true;
    } else if (token === "--buttondown-draft") {
      args.buttondownDraft = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    throw new Error(`Invalid --date value: ${args.date}`);
  }

  return args;
}

function formatButtondownSubject(game) {
  if (!game) return "MetsMoneyline";
  return `MetsMoneyline - ${game.date}: New York Mets vs ${game.opponent}`;
}

function formatPreliminaryButtondownSubject(game, lineupSourceLabel = "projected lineups") {
  if (!game) return "[TEST] MetsMoneyline";
  return `[TEST] MetsMoneyline - ${lineupSourceLabel} - New York Mets vs ${game.opponent}`;
}

function buildPlainTextEmail(game) {
  const report = game?.writeup?.report;
  const date = report?.header?.metadataLine || game?.date || "";
  const matchup = `New York Mets vs ${game?.opponent || "Opponent"}`;
  const pick = report?.officialPick?.label || "See full report";
  const isPreliminary = report?.preliminary?.enabled;
  return [
    `MetsMoneyline${isPreliminary ? " (Preliminary Report)" : ""}`,
    `${matchup}${date ? " | " + date : ""}`,
    "",
    `Today's Pick: ${pick}`,
    "",
    "Read the full breakdown at metsmoneyline.com",
    "",
    "To unsubscribe, click the link in the footer of this email."
  ].join("\n");
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

function formatOrdinalDay(day) {
  const value = Number(day);
  if (!Number.isFinite(value)) return String(day || "");
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  const mod10 = value % 10;
  if (mod10 === 1) return `${value}st`;
  if (mod10 === 2) return `${value}nd`;
  if (mod10 === 3) return `${value}rd`;
  return `${value}th`;
}

function formatGameSheetDateTime(dateValue, timeValue) {
  if (!dateValue && !timeValue) return "N/A";
  const parsed = dateValue ? new Date(`${dateValue}T12:00:00Z`) : null;
  const dateLabel = parsed && !Number.isNaN(parsed.getTime())
    ? parsed.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).replace(/\d+/, (match) => formatOrdinalDay(match))
    : String(dateValue || "TBD");
  const timeLabel = String(timeValue || "TBD")
    .replace(/\s*(AM|PM)\s*ET$/i, (_, meridiem) => `${String(meridiem).toLowerCase()} ET`)
    .replace(/\s+/g, " ")
    .trim();
  return `${dateLabel}, ${timeLabel}`;
}

function formatGameSheetDate(dateValue) {
  if (!dateValue) return "N/A";
  const parsed = new Date(`${dateValue}T12:00:00Z`);
  return parsed && !Number.isNaN(parsed.getTime())
    ? parsed.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).replace(/\d+/, (match) => formatOrdinalDay(match))
    : String(dateValue || "TBD");
}

function expandPitchingHandLabel(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "R") return "Right";
  if (normalized === "L") return "Left";
  return value || null;
}

function formatVsSplitLabel(hand) {
  const expanded = expandPitchingHandLabel(hand);
  return expanded ? `vs ${expanded}-handed pitching` : null;
}

function teamCityLabel(teamName) {
  const explicit = {
    "Arizona Diamondbacks": "Phoenix",
    "Boston Red Sox": "Boston",
    "Chicago Cubs": "Chicago",
    "Chicago White Sox": "Chicago",
    "Kansas City Royals": "Kansas City",
    "Los Angeles Angels": "Anaheim",
    "Los Angeles Dodgers": "Los Angeles",
    "Miami Marlins": "Miami",
    "New York Mets": "New York",
    "New York Yankees": "New York",
    "Oakland Athletics": "Oakland",
    "San Diego Padres": "San Diego",
    "San Francisco Giants": "San Francisco",
    "St. Louis Cardinals": "St. Louis",
    "Tampa Bay Rays": "St. Petersburg",
    "Toronto Blue Jays": "Toronto",
    "Washington Nationals": "Washington"
  };
  if (explicit[teamName]) return explicit[teamName];
  const value = String(teamName || "").trim();
  if (!value) return "TBD";
  const parts = value.split(" ");
  return parts.length > 1 ? parts.slice(0, -1).join(" ") : value;
}

function formatWeatherTemperature(value) {
  const temp = Number(value);
  if (!Number.isFinite(temp)) return null;
  return `${Math.round(temp)}°`;
}

function compassDirection(degrees) {
  const value = Number(degrees);
  if (!Number.isFinite(value)) return null;
  const points = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const index = Math.round(((value % 360) / 22.5)) % 16;
  return points[index];
}

function formatWeatherWind(speed, directionDegrees) {
  const mph = Number(speed);
  if (!Number.isFinite(mph) || mph < 1) return null;
  const dir = compassDirection(directionDegrees);
  return `Wind ${Math.round(mph)} mph${dir ? ` ${dir}` : ""}`;
}

function getWeatherConditionLabel(code) {
  if (code == null || code === "") return null;
  return WEATHER_CODE_LABELS[Number(code)] || "Forecast";
}

function findNearestHourlyIndex(times = [], targetIso) {
  const targetTime = Date.parse(targetIso);
  if (!Number.isFinite(targetTime) || !Array.isArray(times) || !times.length) return -1;
  let bestIndex = -1;
  let bestDiff = Number.POSITIVE_INFINITY;
  times.forEach((timeValue, index) => {
    const parsed = Date.parse(`${timeValue}Z`);
    if (!Number.isFinite(parsed)) return;
    const diff = Math.abs(parsed - targetTime);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = index;
    }
  });
  return bestDiff <= 6 * 60 * 60 * 1000 ? bestIndex : -1;
}

async function getGameWeather(ballpark, gameDateTime) {
  if (!ballpark || !gameDateTime) return null;
  const venue = BALLPARK_WEATHER_LOOKUP[ballpark];
  if (!venue) return null;
  if (venue.indoor) {
    return {
      condition: "Indoor stadium",
      compact: "Indoor stadium",
      source: "venue-map"
    };
  }

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${venue.lat}&longitude=${venue.lon}&hourly=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=UTC&forecast_days=7`;
  const forecast = await safeGetJson(url, `weather forecast for ${ballpark}`);
  const hourly = forecast?.hourly;
  const index = findNearestHourlyIndex(hourly?.time || [], gameDateTime);
  if (!hourly || index < 0) return null;

  const temperature = hourly.temperature_2m?.[index];
  const weatherCode = hourly.weather_code?.[index];
  const windSpeed = hourly.wind_speed_10m?.[index];
  const windDirection = hourly.wind_direction_10m?.[index];
  const temperatureDisplay = formatWeatherTemperature(temperature);
  const condition = getWeatherConditionLabel(weatherCode);
  const wind = formatWeatherWind(windSpeed, windDirection);
  const compact = [temperatureDisplay, condition, wind].filter(Boolean).join(" | ");

  if (!compact) return null;

  return {
    temperature,
    temperatureDisplay,
    condition,
    wind,
    compact,
    source: "open-meteo",
    forecastTimeUtc: hourly.time?.[index] ? `${hourly.time[index]}Z` : null
  };
}

function formatWeatherForecast(value) {
  if (!value || value === "N/A") return "Weather unavailable";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return String(value);
  if (value.compact) return value.compact;
  const parts = [
    value.temperatureDisplay || formatWeatherTemperature(value.temperature),
    value.condition || value.forecast || null,
    value.wind ? `${value.wind}` : null
  ].filter(Boolean);
  return parts.length ? [...new Set(parts)].join(" | ") : "Weather unavailable";
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

function buildHistoryKey(entry = {}) {
  return entry.gameId || `${entry.date || ""}::${entry.opponent || ""}::${entry.homeAway || ""}`;
}

function isSettledHistoryEntry(entry = {}) {
  return entry?.status === "final" && (entry?.result === "W" || entry?.result === "L");
}

function dedupeHistoryEntries(entries = []) {
  const map = new Map();
  for (const entry of entries) {
    if (!entry?.date || !entry?.opponent) continue;
    const key = buildHistoryKey(entry);
    const previous = map.get(key) || {};
    const incomingSettled = isSettledHistoryEntry(entry);
    const previousSettled = isSettledHistoryEntry(previous);
    const settledSource = incomingSettled ? entry : previousSettled ? previous : null;
    map.set(key, {
      ...previous,
      ...entry,
      gameId: entry.gameId ?? previous.gameId ?? null,
      date: entry.date,
      opponent: entry.opponent,
      homeAway: entry.homeAway ?? previous.homeAway ?? null,
      estimated: Boolean(entry.estimated ?? previous.estimated ?? false),
      status: settledSource ? "final" : (entry.status ?? previous.status ?? "pending"),
      stake: typeof entry.stake === "number" ? entry.stake : (typeof previous.stake === "number" ? previous.stake : 100),
      finalScore: settledSource
        ? (settledSource.finalScore ?? previous.finalScore ?? entry.finalScore ?? null)
        : null,
      officialPick: entry.officialPick ?? previous.officialPick ?? "Official Pick: Mets ML",
      market: entry.market ?? previous.market ?? "Mets Moneyline",
      odds: typeof entry.odds === "number" ? entry.odds : (typeof previous.odds === "number" ? previous.odds : null),
      result: settledSource ? settledSource.result ?? null : null,
      profit: settledSource
        ? (typeof settledSource.profit === "number" ? settledSource.profit : null)
        : null
    });
  }

  return [...map.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function loadPickHistory() {
  try {
    const parsed = JSON.parse(fs.readFileSync(PICK_HISTORY_PATH, "utf8"));
    const entries = Array.isArray(parsed?.entries)
      ? parsed.entries
      : Array.isArray(parsed?.recentBreakdowns)
        ? parsed.recentBreakdowns
        : [];
    return {
      updatedAt: parsed?.updatedAt || null,
      generatedAt: parsed?.generatedAt || null,
      record: parsed?.record || { wins: 0, losses: 0, profit: 0 },
      entries: dedupeHistoryEntries(entries)
    };
  } catch {
    return { updatedAt: null, generatedAt: null, record: { wins: 0, losses: 0, profit: 0 }, entries: [] };
  }
}

function loadPickHistorySeed() {
  try {
    const parsed = JSON.parse(fs.readFileSync(PICK_HISTORY_SEED_PATH, "utf8"));
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    return {
      updatedAt: parsed?.updatedAt || null,
      generatedAt: parsed?.generatedAt || null,
      record: parsed?.record || { wins: 0, losses: 0, profit: 0 },
      entries: dedupeHistoryEntries(entries)
    };
  } catch {
    return { updatedAt: null, generatedAt: null, record: { wins: 0, losses: 0, profit: 0 }, entries: [] };
  }
}

function writePickHistory(entries = []) {
  const existingHistory = loadPickHistory();
  const seededHistory = loadPickHistorySeed();
  const normalizedEntries = dedupeHistoryEntries([
    ...seededHistory.entries,
    ...existingHistory.entries,
    ...entries
  ]);
  const normalizedSummary = normalizedEntries.reduce((acc, entry) => {
    if (entry?.status === "final") {
      if (entry?.result === "W") acc.wins += 1;
      if (entry?.result === "L") acc.losses += 1;
      if (typeof entry?.profit === "number") acc.profit += entry.profit;
    }
    if (typeof entry?.stake === "number") acc.totalWagered += entry.stake;
    acc.totalBets += 1;
    return acc;
  }, { wins: 0, losses: 0, profit: 0, totalBets: 0, totalWagered: 0 });

  const output = {
    updatedAt: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    record: {
      wins: normalizedSummary.wins,
      losses: normalizedSummary.losses,
      profit: Number(normalizedSummary.profit.toFixed(2)),
      totalBets: normalizedSummary.totalBets,
      totalWagered: Number(normalizedSummary.totalWagered.toFixed(2)),
      roi: normalizedSummary.totalWagered > 0
        ? Number(((normalizedSummary.profit / normalizedSummary.totalWagered) * 100).toFixed(2))
        : 0
    },
    entries: normalizedEntries,
    recentBreakdowns: normalizedEntries
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
      "&selections=player_name,player_id,hard_hit_percent,barrel_batted_rate,whiff_percent,oz_swing_percent,k_percent,bb_percent,gb_percent,avg_hit_speed,avg_hit_angle" +
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
    `?type=batter&year=${season}&position=&team=&min=0&csv=true`;
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

function extractFangraphsNextData(html) {
  const match = html?.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

async function loadFangraphsLeaderboard(stats, type, season = new Date().getFullYear()) {
  const key = `${stats}:${type}:${season}`;
  if (cachedFangraphsLeaderboards.has(key)) return cachedFangraphsLeaderboards.get(key);

  const url = `https://www.fangraphs.com/leaders/major-league?pos=all&stats=${stats}&lg=all&qual=0&type=${type}&season=${season}&month=0&season1=${season}&ind=0&team=0,ts&rost=0&age=0&filter=&players=0`;
  const html = await safeGetText(url, `fangraphs leaderboard ${key}`);
  const nextData = extractFangraphsNextData(html || "");
  const queries = nextData?.props?.pageProps?.dehydratedState?.queries || [];
  const leaderboardQuery = queries.find((query) => Array.isArray(query?.queryKey) && query.queryKey[0] === "leaders/major-league/data");
  const rows = leaderboardQuery?.state?.data?.data || [];
  cachedFangraphsLeaderboards.set(key, rows);
  return rows;
}

function normalizeTeamAbbr(value) {
  return String(value || "").trim().toUpperCase();
}

function rankRows(rows, statKey, { descending = true } = {}) {
  return rows
    .map((row) => ({ row, value: parseNumber(row?.[statKey]) }))
    .filter((entry) => entry.value != null)
    .sort((a, b) => descending ? b.value - a.value : a.value - b.value)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function ordinalSuffix(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value || "");
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const mod10 = n % 10;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

function computePercentileMap(rows, statKey, { descending = true } = {}) {
  const ranked = rankRows(rows, statKey, { descending });
  const total = ranked.length;
  const map = {};
  ranked.forEach((entry, index) => {
    const playerId = Number(entry?.row?.player_id);
    if (!playerId) return;
    const percentile = total <= 1 ? 100 : Math.round(((total - (index + 1)) / (total - 1)) * 100);
    map[playerId] = Math.max(1, Math.min(100, percentile));
  });
  return map;
}

async function loadPitcherPercentileMaps() {
  if (cachedPitcherPercentileMaps) return cachedPitcherPercentileMaps;
  const [savantRows, expectedRows] = await Promise.all([
    loadSavantPitcherLeaderboard(),
    loadSavantExpectedPitchers()
  ]);
  cachedPitcherPercentileMaps = {
    barrelPct: computePercentileMap(savantRows, "barrel_batted_rate", { descending: false }),
    hardHitPct: computePercentileMap(savantRows, "hard_hit_percent", { descending: false }),
    kPct: computePercentileMap(savantRows, "k_percent", { descending: true }),
    bbPct: computePercentileMap(savantRows, "bb_percent", { descending: false }),
    xBAAllowed: computePercentileMap(expectedRows, "est_ba", { descending: false }),
    xSLGAllowed: computePercentileMap(expectedRows, "est_slg", { descending: false })
  };
  return cachedPitcherPercentileMaps;
}

function buildLeagueRankMap(battingRows = [], pitchingRows = []) {
  const teamRanks = {};
  const assignRanks = (rows, statKey, rankKey, options) => {
    rankRows(rows, statKey, options).forEach(({ row, rank }) => {
      const team = normalizeTeamAbbr(row.TeamNameAbb || row.Team || row.team);
      if (!team) return;
      teamRanks[team] ||= {};
      teamRanks[team][rankKey] = rank;
    });
  };

  assignRanks(battingRows, 'wRC+', 'wrcPlus');
  assignRanks(battingRows, 'wOBA', 'woba');
  assignRanks(battingRows, 'ISO', 'iso');
  assignRanks(battingRows, 'OPS', 'ops');
  assignRanks(battingRows, 'xAVG', 'xba');
  assignRanks(battingRows, 'xSLG', 'xslg');
  assignRanks(battingRows, 'xwOBA', 'xwoba');
  assignRanks(battingRows, 'HardHit%', 'hardHit');
  assignRanks(battingRows, 'Hard%', 'hardHit');
  assignRanks(battingRows, 'Barrel%', 'barrelPct');
  assignRanks(battingRows, 'Barrel %', 'barrelPct');
  assignRanks(battingRows, 'BB%', 'bbPct');
  assignRanks(battingRows, 'K%', 'kPct', { descending: false });
  assignRanks(pitchingRows, 'ERA', 'rotEra', { descending: false });
  assignRanks(pitchingRows, 'FIP', 'rotFip', { descending: false });
  assignRanks(pitchingRows, 'WHIP', 'rotWhip', { descending: false });

  return teamRanks;
}

function formatPitcherSeasonLine(stat, recordOverride = null) {
  if (!stat) return null;
  const pieces = [];
  if (recordOverride) pieces.push(recordOverride);
  else if (stat.wins != null && stat.losses != null) pieces.push(`${stat.wins}-${stat.losses}`);
  if (stat.era) pieces.push(`${stat.era} ERA`);
  if (stat.whip) pieces.push(`${stat.whip} WHIP`);
  if (stat.inningsPitched) pieces.push(`${stat.inningsPitched} IP`);
  return pieces.length ? pieces.join(", ") : null;
}

function formatPitcherKbb(stat) {
  const ratio = stat?.strikeoutWalkRatio;
  if (ratio != null && ratio !== "" && ratio !== "-.--" && ratio !== ".---") {
    const parsed = Number(ratio);
    return Number.isFinite(parsed) ? parsed.toFixed(2) : String(ratio);
  }

  const strikeouts = Number(stat?.strikeOuts);
  const walks = Number(stat?.baseOnBalls);
  if (!Number.isFinite(strikeouts) || !Number.isFinite(walks)) return null;
  if (walks === 0) return strikeouts.toFixed(1);
  return (strikeouts / walks).toFixed(2);
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

async function getPitcherGameLog(personId, season) {
  if (!personId) return [];
  const url =
    `https://statsapi.mlb.com/api/v1/people/${personId}/stats` +
    `?stats=gameLog&group=pitching&season=${season}`;
  const data = await safeGetJson(url, `pitching game log ${personId} ${season}`);
  return Array.isArray(data?.stats?.[0]?.splits) ? data.stats[0].splits : [];
}

function derivePitcherRecordFromGameLog(gameLogSplits = [], beforeDate) {
  const completedStarts = gameLogSplits.filter((split) => split?.date && split.date < beforeDate);
  if (!completedStarts.length) return null;

  const totals = completedStarts.reduce((acc, split) => {
    const won = split?.isWin === true || Number(split?.stat?.wins || 0) > 0;
    const lost = split?.isLoss === true || Number(split?.stat?.losses || 0) > 0;
    if (won) acc.wins += 1;
    if (lost) acc.losses += 1;
    return acc;
  }, { wins: 0, losses: 0 });

  return `${totals.wins}-${totals.losses}`;
}

async function getPitcherFacts(personId, fallbackName, teamName = null, beforeDate = getTodayEasternISO()) {
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
  const [person, currentStats, previousStats, currentGameLog, savantRows, expectedRows, fangraphsTeam] = await Promise.all([
    getPersonInfo(personId),
    getPlayerSeasonStats(personId, "pitching", season),
    getPlayerSeasonStats(personId, "pitching", previousSeason),
    getPitcherGameLog(personId, season),
    loadSavantPitcherLeaderboard(),
    loadSavantExpectedPitchers(),
    teamName ? loadFangraphsTeamData(teamName) : null
  ]);
  const percentileMaps = await loadPitcherPercentileMaps();

  const stat = currentStats || previousStats;
  const statSeason = currentStats ? season : previousStats ? previousSeason : null;
  const currentSeasonRecord = derivePitcherRecordFromGameLog(currentGameLog, beforeDate)
    || (currentStats?.wins != null && currentStats?.losses != null ? `${currentStats.wins}-${currentStats.losses}` : null);
  const savant = getSavantRow(savantRows, personId);
  const expected = getSavantRow(expectedRows, personId);
  const pitcherName = person?.fullName || fallbackName || "TBD";
  const fangraphsPitcher = fangraphsTeam?.pitchingByName?.[normalizePersonName(pitcherName)] || null;

  return {
    name: pitcherName,
    mlbId: personId,
    announced: true,
    hand: person?.pitchHand?.code || null,
    seasonLine: formatPitcherSeasonLine(stat, currentSeasonRecord),
    seasonRecord: currentSeasonRecord,
    seasonERA: stat?.era || fangraphsPitcher?.ERA || null,
    seasonFIP: stat?.fip || fangraphsPitcher?.FIP || computeApproxFip(stat) || fangraphsPitcher?.xFIP || null,
    seasonXERA: expected?.xera || null,
    seasonWHIP: stat?.whip || null,
    seasonHR9: stat?.homeRunsPer9 || fangraphsPitcher?.['HR/9'] || null,
    last3KBB: formatPitcherKbb(stat),
    kMinusBbPct: (
      savant?.k_percent != null && savant?.bb_percent != null
        ? Number((Number(savant.k_percent) - Number(savant.bb_percent)).toFixed(1))
        : null
    ),
    note: stat?.inningsPitched && statSeason ? `${statSeason} - ${stat.inningsPitched} IP` : null,
    savant: savant ? {
      xERA: expected?.xera || null,
      xBAAllowed: expected?.est_ba || null,
      xSLGAllowed: expected?.est_slg || null,
      xwOBAAllowed: expected?.est_woba || null,
      barrelPct: savant.barrel_batted_rate ? `${savant.barrel_batted_rate}%` : null,
      hardHitPct: savant.hard_hit_percent ? `${savant.hard_hit_percent}%` : null,
      whiffPct: savant.whiff_percent ? `${savant.whiff_percent}%` : null,
      chasePct: savant.oz_swing_percent ? `${savant.oz_swing_percent}%` : null,
      kPct: savant.k_percent ? `${savant.k_percent}%` : null,
      bbPct: savant.bb_percent ? `${savant.bb_percent}%` : null,
      gbPct: savant.gb_percent ? `${savant.gb_percent}%` : null,
      exitVeloAllowed: savant.avg_hit_speed || null,
      launchAngleAllowed: savant.avg_hit_angle || null,
      percentiles: {
        barrelPct: percentileMaps?.barrelPct?.[personId] ?? null,
        hardHitPct: percentileMaps?.hardHitPct?.[personId] ?? null,
        kPct: percentileMaps?.kPct?.[personId] ?? null,
        bbPct: percentileMaps?.bbPct?.[personId] ?? null,
        xBAAllowed: percentileMaps?.xBAAllowed?.[personId] ?? null,
        xSLGAllowed: percentileMaps?.xSLGAllowed?.[personId] ?? null
      }
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
          OBP: fangraphs['OBP'] || null,
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
      savant: player.savant,
      fangraphs: player.fangraphs
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
        OBP: fangraphs['OBP'] || null,
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

function buildSingleTeamAdvanced(hittingStat, pitchingStat, roster = [], savantBattersByPlayer = {}, savantExpectedBattersByPlayer = {}, fangraphsTeam = null, leagueRanks = null) {
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
    pitchBBPct: pitchingTotal['BB%'] || null,
    leagueRanks: leagueRanks || null,
    rankScope: leagueRanks ? 'MLB' : null,
    rankTotal: leagueRanks ? 30 : null
  };
}

async function buildTeamAdvancedFacts(metsTeamId, oppTeamId) {
  const season = String(new Date().getFullYear());
  const metsName = Object.keys(TEAM_IDS).find((name) => TEAM_IDS[name] === metsTeamId) || TEAM_NAME;
  const oppName = Object.keys(TEAM_IDS).find((name) => TEAM_IDS[name] === oppTeamId) || null;
  const [metsHitting, oppHitting, metsPitching, oppPitching, metsRoster, oppRoster, savantBatters, savantExpectedBatters, metsFg, oppFg, battingLeaderboard, pitchingLeaderboard] = await Promise.all([
    getTeamSeasonStats(metsTeamId, "hitting", season),
    getTeamSeasonStats(oppTeamId, "hitting", season),
    getTeamSeasonStats(metsTeamId, "pitching", season),
    getTeamSeasonStats(oppTeamId, "pitching", season),
    getTeamRoster(metsTeamId, season),
    getTeamRoster(oppTeamId, season),
    loadSavantBatterLeaderboard(),
    loadSavantExpectedBatters(),
    loadFangraphsTeamData(metsName),
    oppName ? loadFangraphsTeamData(oppName) : null,
    loadFangraphsLeaderboard('bat', 1, Number(season)),
    loadFangraphsLeaderboard('pit', 1, Number(season))
  ]);

  const savantBattersByPlayer = Object.fromEntries(savantBatters.map((row) => [Number(row.player_id), row]));
  const savantExpectedBattersByPlayer = Object.fromEntries(savantExpectedBatters.map((row) => [Number(row.player_id), row]));
  const leagueRankMap = buildLeagueRankMap(battingLeaderboard, pitchingLeaderboard);

  return {
    mets: buildSingleTeamAdvanced(metsHitting, metsPitching, metsRoster, savantBattersByPlayer, savantExpectedBattersByPlayer, metsFg, leagueRankMap.NYM || null),
    opp: buildSingleTeamAdvanced(oppHitting, oppPitching, oppRoster, savantBattersByPlayer, savantExpectedBattersByPlayer, oppFg, leagueRankMap[normalizeTeamAbbr(TEAM_NAME_TO_ABBR[oppName] || oppName)] || null)
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
  try {
    const cachedOdds = JSON.parse(fs.readFileSync(API_ODDS_PATH, "utf8"));
    const market = Array.isArray(cachedOdds?.markets)
      ? cachedOdds.markets.find((entry) => /moneyline|h2h/i.test(entry.label || entry.key || ""))
      : null;
    const consensusOutcomes = Array.isArray(cachedOdds?.consensus?.markets)
      ? cachedOdds.consensus.markets
      : [];
    const spreadMarket = consensusOutcomes.find((entry) => /spread|run/i.test(entry.label || entry.key || ""));
    const totalMarket = consensusOutcomes.find((entry) => /total|over\/under/i.test(entry.label || entry.key || ""));
    const moneylineMarket = market || consensusOutcomes.find((entry) => /moneyline|h2h/i.test(entry.label || entry.key || ""));
    const getOutcome = (entry, teamName) => Array.isArray(entry?.outcomes)
      ? entry.outcomes.find((outcome) => String(outcome.name || "").toLowerCase().includes(String(teamName).toLowerCase()))
      : null;

    const homeTeam = game?.teams?.home?.team?.name || "";
    const awayTeam = game?.teams?.away?.team?.name || "";
    const opponentName = homeTeam === TEAM_NAME ? awayTeam : homeTeam;
    const metsOutcome = getOutcome(moneylineMarket, TEAM_NAME);
    const oppOutcome = getOutcome(moneylineMarket, opponentName);
    const metsSpreadOutcome = getOutcome(spreadMarket, TEAM_NAME);
    const overOutcome = Array.isArray(totalMarket?.outcomes)
      ? totalMarket.outcomes.find((outcome) => /over/i.test(outcome.name || ""))
      : null;

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
    console.warn(`[warn] API-SPORTS odds cache read failed: ${error.message}`);
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
  const weatherPromise = getGameWeather(game?.venue?.name, game?.gameDate);

  const [feed, content, metsRecords, oppRecords, metsInjuries, oppInjuries, weather] = await Promise.all([
    getGameFeed(game.gamePk),
    getGameContent(game.gamePk),
    getTeamSeasonRecordFacts(TEAM_ID, resolvedDate, false),
    getTeamSeasonRecordFacts(oppTeam.id, resolvedDate, false),
    getTeamInjuries(TEAM_ID),
    getTeamInjuries(oppTeam.id),
    weatherPromise
  ]);

  const probablePitchers = {
    mets: isHome ? game?.teams?.home?.probablePitcher : game?.teams?.away?.probablePitcher,
    opp: isHome ? game?.teams?.away?.probablePitcher : game?.teams?.home?.probablePitcher
  };

  const [pitching, lineups, metsBullpen, oppBullpen, teamAdvanced, metsRecentGames, oppRecentGames, headToHead, metsPitcherLog, oppPitcherLog, money, lastMeeting] = await Promise.all([
    Promise.all([
      getPitcherFacts(probablePitchers.mets?.id, probablePitchers.mets?.fullName, TEAM_NAME, resolvedDate),
      getPitcherFacts(probablePitchers.opp?.id, probablePitchers.opp?.fullName, oppTeam.name, resolvedDate)
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
      gameDateTime: game?.gameDate || null,
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
    weather: weather || null,
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

function averageNumbers(values = []) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function formatMetric(value, digits = 1) {
  if (!Number.isFinite(value)) return "N/A";
  return Number(value).toFixed(digits);
}

function moneylineToImpliedProbability(odds) {
  if (!Number.isFinite(odds)) return null;
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 100 / (odds + 100);
}

function ipStringToNumber(value) {
  if (value == null) return null;
  const [whole, partial = "0"] = String(value).split(".");
  const wholeNum = Number(whole);
  const partialNum = Number(partial);
  if (!Number.isFinite(wholeNum) || !Number.isFinite(partialNum)) return null;
  return wholeNum + (partialNum / 3);
}

function normalizePctValue(value) {
  const parsed = parseNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeDiff(left, right, digits = 3) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return Number((left - right).toFixed(digits));
}

function diffDays(dateA, dateB) {
  if (!dateA || !dateB) return null;
  const a = new Date(`${dateA}T12:00:00Z`);
  const b = new Date(`${dateB}T12:00:00Z`);
  const diff = Math.round((a - b) / 86400000);
  return Number.isFinite(diff) ? diff : null;
}

function weightedAverageFromLineup(lineup = [], getter, digits = 3) {
  let weighted = 0;
  let weight = 0;
  for (const player of lineup) {
    const value = parseNumber(getter(player));
    const pa = Number(player?.savant?.pa || 0);
    const appliedWeight = pa > 0 ? pa : 1;
    if (value == null) continue;
    weighted += value * appliedWeight;
    weight += appliedWeight;
  }
  if (!weight) return null;
  return Number((weighted / weight).toFixed(digits));
}

function sumLineupMetric(lineup = [], getter, digits = 1) {
  let total = 0;
  let found = false;
  for (const player of lineup) {
    const value = parseNumber(getter(player));
    if (value == null) continue;
    total += value;
    found = true;
  }
  return found ? Number(total.toFixed(digits)) : null;
}

function buildRecentStartsSummary(starts = [], gameDate) {
  const normalized = (starts || []).slice(0, 5).map((start) => ({
    date: start.date || null,
    opponent: start.opponent || null,
    ip: start.ip || null,
    er: parseNumber(start.er),
    k: parseNumber(start.k),
    result: start.result || null
  }));
  const avgInnings = averageNumbers(normalized.map((start) => ipStringToNumber(start.ip)));
  const avgER = averageNumbers(normalized.map((start) => start.er));
  const avgK = averageNumbers(normalized.map((start) => start.k));
  const lastStart = normalized[0] || null;
  const daysSinceLastStart = diffDays(gameDate, lastStart?.date);
  return {
    starts: normalized,
    avgInnings: avgInnings == null ? null : Number(avgInnings.toFixed(2)),
    avgEarnedRuns: avgER == null ? null : Number(avgER.toFixed(2)),
    avgStrikeouts: avgK == null ? null : Number(avgK.toFixed(2)),
    daysSinceLastStart
  };
}

function buildPitcherAnalysis(pitcher = {}, recentStarts = [], opponentLineup = [], gameDate = null) {
  const kPct = normalizePctValue(pitcher?.savant?.kPct);
  const bbPct = normalizePctValue(pitcher?.savant?.bbPct);
  const hardHitPct = normalizePctValue(pitcher?.savant?.hardHitPct);
  const barrelPct = normalizePctValue(pitcher?.savant?.barrelPct);
  const xBAAllowed = parseNumber(pitcher?.savant?.xBAAllowed);
  const xSLGAllowed = parseNumber(pitcher?.savant?.xSLGAllowed);
  const xwOBAAllowed = parseNumber(pitcher?.savant?.xwOBAAllowed);
  const recent = buildRecentStartsSummary(recentStarts, gameDate);

  return {
    name: pitcher?.name || "TBD",
    handedness: pitcher?.hand || null,
    era: parseNumber(pitcher?.seasonERA),
    xERA: parseNumber(pitcher?.seasonXERA || pitcher?.savant?.xERA),
    fip: parseNumber(pitcher?.seasonFIP),
    whip: parseNumber(pitcher?.seasonWHIP),
    kPct,
    bbPct,
    kMinusBbPct: pitcher?.kMinusBbPct ?? (kPct != null && bbPct != null ? Number((kPct - bbPct).toFixed(1)) : null),
    hardHitPct,
    barrelPct,
    xBAAllowed,
    xSLGAllowed,
    xwOBAAllowed,
    splitsVsOpponentHandedness: null,
    recentStarts: recent,
    workload: {
      inningsTrend: recent.avgInnings,
      daysSinceLastStart: recent.daysSinceLastStart
    },
    opponentHandednessProfile: {
      left: opponentLineup.filter((player) => player?.hand === "L").length,
      right: opponentLineup.filter((player) => player?.hand === "R").length,
      switch: opponentLineup.filter((player) => player?.hand === "S").length
    }
  };
}

function buildLineupAggregate(lineup = []) {
  const totalWar = sumLineupMetric(lineup, (player) => player?.fangraphs?.war);
  const totalWrcPlus = weightedAverageFromLineup(lineup, (player) => player?.fangraphs?.wRCPlus, 1);
  const totalOBP = weightedAverageFromLineup(lineup, (player) => player?.fangraphs?.OBP);
  const totalISO = weightedAverageFromLineup(lineup, (player) => player?.fangraphs?.ISO);
  const totalBBPct = weightedAverageFromLineup(lineup, (player) => player?.fangraphs?.bbPct, 1);
  const totalKPct = weightedAverageFromLineup(lineup, (player) => player?.fangraphs?.kPct, 1);
  const totalXBA = weightedAverageFromLineup(lineup, (player) => player?.savant?.xBA);
  const totalXSLG = weightedAverageFromLineup(lineup, (player) => player?.savant?.xSLG);
  const totalXWOBA = weightedAverageFromLineup(lineup, (player) => player?.savant?.xwOBA);
  const totalWOBA = weightedAverageFromLineup(lineup, (player) => player?.fangraphs?.wOBA);
  const totalHardHitPct = weightedAverageFromLineup(lineup, (player) => player?.savant?.hardHitPct, 1);
  const totalBarrelPct = weightedAverageFromLineup(lineup, (player) => player?.savant?.barrelPct, 1);
  const totalAVG = weightedAverageFromLineup(lineup, (player) => player?.seasonAVG);

  return {
    totalWAR: totalWar,
    totalWRCPlus: totalWrcPlus,
    totalOBP,
    totalISO,
    totalKPct,
    totalBBPct,
    totalAVG,
    totalWOBA,
    totalXBA,
    totalXSLG,
    totalXWOBA,
    totalHardHitPct,
    totalBarrelPct,
    regressionSignals: {
      baMinusXba: safeDiff(totalAVG, totalXBA),
      wobaMinusXwoba: safeDiff(totalWOBA, totalXWOBA)
    }
  };
}

function buildTeamOffenseAnalysis(teamAdvanced = {}, lineup = [], pitcherHand = null, injuries = []) {
  const lineupAggregate = buildLineupAggregate(lineup);
  return {
    teamWrcPlusVsHandedness: null,
    projectedLineupWrcPlusVsHandedness: null,
    homeAwayWrcPlus: null,
    projectedLineupWAR: lineupAggregate.totalWAR,
    projectedLineupWRCPlus: lineupAggregate.totalWRCPlus,
    obp: lineupAggregate.totalOBP,
    iso: parseNumber(teamAdvanced?.iso),
    kPct: normalizePctValue(teamAdvanced?.kPct),
    bbPct: normalizePctValue(teamAdvanced?.bbPct),
    xBA: parseNumber(teamAdvanced?.xba),
    xSLG: parseNumber(teamAdvanced?.xslg),
    xwOBA: parseNumber(teamAdvanced?.xwoba),
    hardHitPct: normalizePctValue(teamAdvanced?.hardHit),
    barrelPct: normalizePctValue(teamAdvanced?.barrelPct),
    battingAverage: lineupAggregate.totalAVG,
    wOBA: lineupAggregate.totalWOBA,
    lineup: lineupAggregate,
    regressionSignals: {
      baMinusXba: lineupAggregate.regressionSignals.baMinusXba,
      wobaMinusXwoba: lineupAggregate.regressionSignals.wobaMinusXwoba
    },
    missingKeyHitters: null,
    splitContext: {
      pitcherHandedness: pitcherHand,
      splitDataAvailable: false
    }
  };
}

function buildBullpenAnalysis(bullpen = {}) {
  const kPct = normalizePctValue(bullpen?.seasonKPct);
  const bbPct = normalizePctValue(bullpen?.seasonBBPct);
  const last3DaysIP = parseNumber(bullpen?.last3DaysIP);
  let taxLevel = "normal";
  if (last3DaysIP != null && last3DaysIP >= 11) taxLevel = "heavy";
  else if (last3DaysIP != null && last3DaysIP >= 7) taxLevel = "moderate";

  return {
    last3DaysIP,
    availabilityTopArms: null,
    whip: parseNumber(bullpen?.seasonWHIP),
    kMinusBbPct: (kPct != null && bbPct != null) ? Number((kPct - bbPct).toFixed(1)) : null,
    xFIP: parseNumber(bullpen?.seasonXFIP),
    taxLevel
  };
}

function buildContextAnalysis(gameFacts, analysisObject) {
  const metsLastGame = gameFacts?.gameContext?.metsRecentGames?.[0] || null;
  const oppLastGame = gameFacts?.gameContext?.oppRecentGames?.[0] || null;
  const travel = {
    mets: metsLastGame ? `${metsLastGame.homeAway === "home" ? "home" : "road"} to ${gameFacts.meta.homeAway}` : null,
    opp: oppLastGame ? `${oppLastGame.homeAway === "home" ? "home" : "road"} to ${gameFacts.meta.homeAway === "home" ? "road" : "home"}` : null
  };
  return {
    travel,
    restDays: {
      mets: metsLastGame ? Math.max((diffDays(gameFacts.meta.date, metsLastGame.date) || 1) - 1, 0) : null,
      opp: oppLastGame ? Math.max((diffDays(gameFacts.meta.date, oppLastGame.date) || 1) - 1, 0) : null
    },
    seriesGameNumber: gameFacts.game.seriesGameNumber || 1,
    bullpenTax: {
      mets: analysisObject.bullpen.mets.taxLevel,
      opp: analysisObject.bullpen.opp.taxLevel
    },
    parkFactor: null,
    weather: gameFacts.weather || null
  };
}

function buildGameAnalysisObject(gameFacts) {
  const moneyline = typeof gameFacts.odds?.metsMoneyline === "number" ? gameFacts.odds.metsMoneyline : null;
  const analysisObject = {
    gameInfo: {
      date: gameFacts.meta.date,
      opponent: gameFacts.game.opponent,
      homeAway: gameFacts.meta.homeAway,
      ballpark: gameFacts.meta.ballpark,
      weather: gameFacts.weather || null,
      metsMoneyline: moneyline,
      impliedProbability: moneylineToImpliedProbability(moneyline)
    },
    pitchers: {
      mets: buildPitcherAnalysis(gameFacts.pitching.mets, gameFacts.gameContext?.metsPitcherLog || [], gameFacts.lineups.opp, gameFacts.meta.date),
      opp: buildPitcherAnalysis(gameFacts.pitching.opp, gameFacts.gameContext?.oppPitcherLog || [], gameFacts.lineups.mets, gameFacts.meta.date)
    },
    offense: {
      mets: buildTeamOffenseAnalysis(gameFacts.advanced?.teamAdvanced?.mets, gameFacts.lineups.mets, gameFacts.pitching.opp.hand, gameFacts.gameContext?.metsInjuries),
      opp: buildTeamOffenseAnalysis(gameFacts.advanced?.teamAdvanced?.opp, gameFacts.lineups.opp, gameFacts.pitching.mets.hand, gameFacts.gameContext?.oppInjuries)
    },
    projectedLineups: {
      mets: {
        status: gameFacts.lineups.status,
        totalWAR: buildLineupAggregate(gameFacts.lineups.mets).totalWAR,
        totalWRCPlus: buildLineupAggregate(gameFacts.lineups.mets).totalWRCPlus,
        missingKeyHitters: []
      },
      opp: {
        status: gameFacts.lineups.status,
        totalWAR: buildLineupAggregate(gameFacts.lineups.opp).totalWAR,
        totalWRCPlus: buildLineupAggregate(gameFacts.lineups.opp).totalWRCPlus,
        missingKeyHitters: []
      }
    },
    bullpen: {
      mets: buildBullpenAnalysis(gameFacts.pitching.metsBullpen),
      opp: buildBullpenAnalysis(gameFacts.pitching.oppBullpen)
    }
  };

  analysisObject.context = buildContextAnalysis(gameFacts, analysisObject);
  return analysisObject;
}

function buildMissingMetricsList(analysisObject) {
  const checks = [
    ["Game weather", analysisObject?.gameInfo?.weather],
    ["Park factor", analysisObject?.context?.parkFactor],
    ["Mets team wRC+ vs handedness", analysisObject?.offense?.mets?.teamWrcPlusVsHandedness],
    ["Opponent team wRC+ vs handedness", analysisObject?.offense?.opp?.teamWrcPlusVsHandedness],
    ["Mets projected lineup wRC+ vs handedness", analysisObject?.offense?.mets?.projectedLineupWrcPlusVsHandedness],
    ["Opponent projected lineup wRC+ vs handedness", analysisObject?.offense?.opp?.projectedLineupWrcPlusVsHandedness],
    ["Mets home/away split wRC+", analysisObject?.offense?.mets?.homeAwayWrcPlus],
    ["Opponent home/away split wRC+", analysisObject?.offense?.opp?.homeAwayWrcPlus],
    ["Mets missing key hitters", analysisObject?.offense?.mets?.missingKeyHitters],
    ["Opponent missing key hitters", analysisObject?.offense?.opp?.missingKeyHitters],
    ["Pitcher splits vs opponent handedness/profile", analysisObject?.pitchers?.mets?.splitsVsOpponentHandedness],
    ["Opponent pitcher splits vs opponent handedness/profile", analysisObject?.pitchers?.opp?.splitsVsOpponentHandedness],
    ["Mets bullpen leverage-arm availability", analysisObject?.bullpen?.mets?.availabilityTopArms],
    ["Opponent bullpen leverage-arm availability", analysisObject?.bullpen?.opp?.availabilityTopArms]
  ];

  return checks.filter(([, value]) => value == null).map(([label]) => label);
}

function evaluateWeightedMetric(left, right, { higherBetter = true, scale = 1 } = {}) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return 0;
  const diff = higherBetter ? (left - right) : (right - left);
  return diff * scale;
}

function classifyStrength(scoreAbs, slight = 4, moderate = 8) {
  if (scoreAbs >= moderate) return "strong";
  if (scoreAbs >= slight) return "moderate";
  if (scoreAbs > 0) return "slight";
  return "even";
}

function buildCategoryResult(category, weight, rawScore, explanation, fallback = "Even") {
  const scoreAbs = Math.abs(rawScore);
  const strength = classifyStrength(scoreAbs);
  const edge = rawScore > 0 ? "Mets edge" : rawScore < 0 ? "Opponent edge" : fallback;
  const direction = rawScore > 0 ? 1 : rawScore < 0 ? -1 : 0;
  const normalizedStrength = strength === "strong" ? 1 : strength === "moderate" ? 0.66 : strength === "slight" ? 0.33 : 0;
  return {
    category,
    weight,
    edge,
    strength,
    explanation,
    rawScore: Number(rawScore.toFixed(2)),
    weightedImpact: Number((direction * weight * normalizedStrength).toFixed(2))
  };
}

function withCategoryMeta(result, meta = {}) {
  return {
    ...result,
    dataMode: meta.dataMode || "real",
    supportedBy: meta.supportedBy || [],
    missing: meta.missing || []
  };
}

function scoreStartingPitchingEdge(analysisObject) {
  const mets = analysisObject.pitchers.mets;
  const opp = analysisObject.pitchers.opp;
  let score = 0;
  score += evaluateWeightedMetric(mets.xERA, opp.xERA, { higherBetter: false, scale: 6 });
  score += evaluateWeightedMetric(mets.fip, opp.fip, { higherBetter: false, scale: 5 });
  score += evaluateWeightedMetric(mets.whip, opp.whip, { higherBetter: false, scale: 4 });
  score += evaluateWeightedMetric(mets.kMinusBbPct, opp.kMinusBbPct, { higherBetter: true, scale: 0.8 });
  score += evaluateWeightedMetric(mets.hardHitPct, opp.hardHitPct, { higherBetter: false, scale: 0.25 });
  score += evaluateWeightedMetric(mets.barrelPct, opp.barrelPct, { higherBetter: false, scale: 0.5 });
  score += evaluateWeightedMetric(mets.xwOBAAllowed, opp.xwOBAAllowed, { higherBetter: false, scale: 25 });
  score += evaluateWeightedMetric(mets.recentStarts.avgInnings, opp.recentStarts.avgInnings, { higherBetter: true, scale: 1.5 });
  const explanation = `xERA/FIP profile: ${mets.name} ${formatMetric(mets.xERA, 2)}/${formatMetric(mets.fip, 2)} vs ${opp.name} ${formatMetric(opp.xERA, 2)}/${formatMetric(opp.fip, 2)}; K-BB% ${formatMetric(mets.kMinusBbPct, 1)} to ${formatMetric(opp.kMinusBbPct, 1)}.`;
  return withCategoryMeta(
    buildCategoryResult("Starting Pitching", 30, score, explanation),
    {
      dataMode: "real",
      supportedBy: ["ERA", "xERA", "FIP", "WHIP", "K-BB%", "hard-hit allowed", "barrel allowed", "xwOBA allowed", "recent starts"]
    }
  );
}

function scoreLineupEdge(analysisObject) {
  const mets = analysisObject.offense.mets;
  const opp = analysisObject.offense.opp;
  const hasSplitData = [
    mets.teamWrcPlusVsHandedness,
    opp.teamWrcPlusVsHandedness,
    mets.projectedLineupWrcPlusVsHandedness,
    opp.projectedLineupWrcPlusVsHandedness
  ].every(Number.isFinite);

  let score = 0;
  if (hasSplitData) {
    score += evaluateWeightedMetric(mets.teamWrcPlusVsHandedness, opp.teamWrcPlusVsHandedness, { higherBetter: true, scale: 0.5 });
    score += evaluateWeightedMetric(mets.projectedLineupWrcPlusVsHandedness, opp.projectedLineupWrcPlusVsHandedness, { higherBetter: true, scale: 0.45 });
    score += evaluateWeightedMetric(mets.projectedLineupWAR, opp.projectedLineupWAR, { higherBetter: true, scale: 2.5 });
    score += evaluateWeightedMetric(mets.xwOBA, opp.xwOBA, { higherBetter: true, scale: 15 });
    const explanation = `Handedness split edge: team wRC+ ${formatMetric(mets.teamWrcPlusVsHandedness, 1)} vs ${formatMetric(opp.teamWrcPlusVsHandedness, 1)}, projected lineup split wRC+ ${formatMetric(mets.projectedLineupWrcPlusVsHandedness, 1)} vs ${formatMetric(opp.projectedLineupWrcPlusVsHandedness, 1)}.`;
    return withCategoryMeta(
      buildCategoryResult("Lineup vs Handedness", 25, score, explanation),
      {
        dataMode: "real",
        supportedBy: ["team wRC+ vs handedness", "projected lineup wRC+ vs handedness", "projected lineup WAR"]
      }
    );
  }

  score += evaluateWeightedMetric(mets.projectedLineupWRCPlus, opp.projectedLineupWRCPlus, { higherBetter: true, scale: 0.2 });
  score += evaluateWeightedMetric(mets.projectedLineupWAR, opp.projectedLineupWAR, { higherBetter: true, scale: 2 });
  score += evaluateWeightedMetric(mets.xwOBA, opp.xwOBA, { higherBetter: true, scale: 12 });
  score += evaluateWeightedMetric(mets.hardHitPct, opp.hardHitPct, { higherBetter: true, scale: 0.12 });
  score += evaluateWeightedMetric(mets.barrelPct, opp.barrelPct, { higherBetter: true, scale: 0.18 });
  score += evaluateWeightedMetric(mets.bbPct, opp.bbPct, { higherBetter: true, scale: 0.2 });
  score += evaluateWeightedMetric(mets.kPct, opp.kPct, { higherBetter: false, scale: 0.2 });
  score = Number((score * 0.55).toFixed(2));
  const explanation = `Overall lineup quality only: projected WAR ${formatMetric(mets.projectedLineupWAR, 1)} vs ${formatMetric(opp.projectedLineupWAR, 1)}, projected lineup wRC+ ${formatMetric(mets.projectedLineupWRCPlus, 1)} vs ${formatMetric(opp.projectedLineupWRCPlus, 1)}, xwOBA ${formatMetric(mets.xwOBA, 3)} vs ${formatMetric(opp.xwOBA, 3)}.`;
  return withCategoryMeta(
    buildCategoryResult("Overall Lineup Quality", 25, score, explanation, "Limited data"),
    {
      dataMode: "fallback",
      supportedBy: ["projected lineup WAR", "projected lineup wRC+", "xwOBA", "contact quality"],
      missing: ["team wRC+ vs handedness", "projected lineup wRC+ vs handedness"]
    }
  );
}

function pitcherOverperformanceSignal(pitcher) {
  let signal = 0;
  if (pitcher?.era != null && pitcher?.xERA != null) signal += Math.max(0, pitcher.xERA - pitcher.era);
  if (pitcher?.era != null && pitcher?.fip != null) signal += Math.max(0, pitcher.fip - pitcher.era);
  if (pitcher?.hardHitPct != null && pitcher.hardHitPct >= 40) signal += 0.75;
  if (pitcher?.barrelPct != null && pitcher.barrelPct >= 9) signal += 0.75;
  if (pitcher?.kMinusBbPct != null && pitcher.kMinusBbPct < 12) signal += 0.75;
  return Number(signal.toFixed(2));
}

function scoreRegressionEdge(analysisObject) {
  const metsOff = analysisObject.offense.mets.regressionSignals;
  const oppOff = analysisObject.offense.opp.regressionSignals;
  const metsPitcherFade = pitcherOverperformanceSignal(analysisObject.pitchers.mets);
  const oppPitcherFade = pitcherOverperformanceSignal(analysisObject.pitchers.opp);
  let score = 0;
  score += evaluateWeightedMetric(metsOff?.baMinusXba, oppOff?.baMinusXba, { higherBetter: false, scale: 40 });
  score += evaluateWeightedMetric(metsOff?.wobaMinusXwoba, oppOff?.wobaMinusXwoba, { higherBetter: false, scale: 60 });
  score += evaluateWeightedMetric(oppPitcherFade, metsPitcherFade, { higherBetter: true, scale: 4 });
  const explanation = `Regression lens: Mets BA-xBA ${formatMetric(metsOff?.baMinusXba, 3)} and wOBA-xwOBA ${formatMetric(metsOff?.wobaMinusXwoba, 3)}; opponent starter overperformance signal ${formatMetric(oppPitcherFade, 2)}.`;
  return withCategoryMeta(
    buildCategoryResult("Regression Signals", 10, score, explanation),
    {
      dataMode: "real",
      supportedBy: ["BA vs xBA", "wOBA vs xwOBA", "starter surface-vs-underlying gap"]
    }
  );
}

function scoreBullpenEdge(analysisObject) {
  const mets = analysisObject.bullpen.mets;
  const opp = analysisObject.bullpen.opp;
  let score = 0;
  score += evaluateWeightedMetric(mets.xFIP, opp.xFIP, { higherBetter: false, scale: 3.5 });
  score += evaluateWeightedMetric(mets.whip, opp.whip, { higherBetter: false, scale: 3 });
  score += evaluateWeightedMetric(mets.kMinusBbPct, opp.kMinusBbPct, { higherBetter: true, scale: 0.5 });
  score += evaluateWeightedMetric(mets.last3DaysIP, opp.last3DaysIP, { higherBetter: false, scale: 0.4 });
  if (mets.availabilityTopArms == null || opp.availabilityTopArms == null) {
    score = Number((score * 0.75).toFixed(2));
  }
  const explanation = `Bullpen shape: xFIP ${formatMetric(mets.xFIP, 2)} vs ${formatMetric(opp.xFIP, 2)}, WHIP ${formatMetric(mets.whip, 2)} vs ${formatMetric(opp.whip, 2)}, last 3-day usage ${formatMetric(mets.last3DaysIP, 1)} IP vs ${formatMetric(opp.last3DaysIP, 1)} IP.`;
  return withCategoryMeta(
    buildCategoryResult("Bullpen", 15, score, explanation, "Limited data"),
    {
      dataMode: mets.availabilityTopArms == null || opp.availabilityTopArms == null ? "fallback" : "real",
      supportedBy: ["recent usage", "WHIP", "K-BB%", "xFIP"],
      missing: mets.availabilityTopArms == null || opp.availabilityTopArms == null ? ["leverage-arm availability"] : []
    }
  );
}

function scoreHomeAwayEdge(analysisObject) {
  const metsRest = analysisObject.context.restDays.mets;
  const oppRest = analysisObject.context.restDays.opp;
  const metsHomeAway = analysisObject.gameInfo.homeAway === "home" ? 1 : -1;
  let score = metsHomeAway * 3;
  score += evaluateWeightedMetric(metsRest, oppRest, { higherBetter: true, scale: 1.5 });
  score = Number((score * 0.35).toFixed(2));
  const explanation = `Split context is limited; fallback to venue and rest edge. Mets are ${analysisObject.gameInfo.homeAway} with rest ${metsRest ?? "N/A"} vs opponent ${oppRest ?? "N/A"} days.`;
  return withCategoryMeta(
    buildCategoryResult("Home/Away Split", 10, score, explanation, "Limited data"),
    {
      dataMode: "fallback",
      supportedBy: ["venue", "rest"],
      missing: ["home/away split wRC+", "park factor"]
    }
  );
}

function scoreContextEdge(analysisObject) {
  const metsTravel = analysisObject.context.travel.mets || "";
  const oppTravel = analysisObject.context.travel.opp || "";
  let score = 0;
  if (/road to home/i.test(metsTravel)) score += 1;
  if (/road to road/i.test(metsTravel)) score -= 1;
  if (/road to road/i.test(oppTravel)) score += 1;
  if (analysisObject.context.bullpenTax.opp === "heavy") score += 2;
  if (analysisObject.context.bullpenTax.mets === "heavy") score -= 2;
  score = Number((score * 0.6).toFixed(2));
  const explanation = `Schedule/context: Mets travel ${metsTravel || "N/A"}, opponent travel ${oppTravel || "N/A"}, bullpen tax ${analysisObject.context.bullpenTax.mets}/${analysisObject.context.bullpenTax.opp}.`;
  return withCategoryMeta(
    buildCategoryResult("Context", 5, score, explanation, "Limited data"),
    {
      dataMode: "fallback",
      supportedBy: ["travel", "rest", "bullpen tax"],
      missing: [
        analysisObject.context.weather == null ? "weather" : null,
        analysisObject.context.parkFactor == null ? "park factor" : null
      ].filter(Boolean)
    }
  );
}

function scoreMarketEdge(analysisObject, projectedWinProbability) {
  const implied = analysisObject.gameInfo.impliedProbability;
  const edge = projectedWinProbability != null && implied != null ? projectedWinProbability - implied : 0;
  const explanation = `Market check: Mets ML ${analysisObject.gameInfo.metsMoneyline ?? "N/A"} implies ${implied == null ? "N/A" : `${formatMetric(implied * 100, 1)}%`} vs model ${projectedWinProbability == null ? "N/A" : `${formatMetric(projectedWinProbability * 100, 1)}%`}.`;
  return withCategoryMeta(
    buildCategoryResult("Market Value", 5, edge * 100, explanation, "Limited data"),
    {
      dataMode: implied == null ? "fallback" : "real",
      supportedBy: implied == null ? [] : ["current moneyline", "implied probability"],
      missing: implied == null ? ["current moneyline / implied probability"] : []
    }
  );
}

function buildEdgeScoring(analysisObject) {
  const categories = [
    scoreStartingPitchingEdge(analysisObject),
    scoreLineupEdge(analysisObject),
    scoreBullpenEdge(analysisObject),
    scoreRegressionEdge(analysisObject),
    scoreHomeAwayEdge(analysisObject),
    scoreContextEdge(analysisObject)
  ];
  const baseImpact = categories.reduce((sum, category) => sum + category.weightedImpact, 0);
  const projectedWinProbability = Math.max(0.35, Math.min(0.7, 0.5 + (baseImpact / 100)));
  const market = scoreMarketEdge(analysisObject, projectedWinProbability);
  const allCategories = [...categories, market];
  const totalWeightedImpact = allCategories.reduce((sum, category) => sum + category.weightedImpact, 0);
  const criticalMissingCount = [
    analysisObject?.offense?.mets?.teamWrcPlusVsHandedness,
    analysisObject?.offense?.opp?.teamWrcPlusVsHandedness,
    analysisObject?.gameInfo?.impliedProbability,
    analysisObject?.context?.parkFactor,
    analysisObject?.gameInfo?.weather,
    analysisObject?.bullpen?.mets?.availabilityTopArms,
    analysisObject?.bullpen?.opp?.availabilityTopArms
  ].filter((value) => value == null).length;
  let confidence = Math.abs(totalWeightedImpact) >= 25 ? "high" : Math.abs(totalWeightedImpact) >= 12 ? "medium" : "low";
  if (criticalMissingCount >= 4) confidence = "low";
  else if (criticalMissingCount >= 2 && confidence === "high") confidence = "medium";
  return {
    categories: allCategories,
    projectedWinProbability: Number(projectedWinProbability.toFixed(3)),
    totalWeightedImpact: Number(totalWeightedImpact.toFixed(2)),
    confidence,
    criticalMissingCount
  };
}

function decidePick(edgeScoring, analysisObject) {
  const implied = analysisObject.gameInfo.impliedProbability;
  const projected = edgeScoring.projectedWinProbability;
  const majorCategories = edgeScoring.categories.filter((category) => ["Starting Pitching", "Overall Lineup Quality", "Lineup vs Handedness", "Bullpen", "Regression Signals"].includes(category.category));
  const metsMajorEdges = majorCategories.filter((category) => category.edge === "Mets edge").length;
  const oppMajorEdges = majorCategories.filter((category) => category.edge === "Opponent edge").length;
  const fallbackHeavy = edgeScoring.categories.filter((category) => category.dataMode === "fallback").length >= 3;
  let analyticalLean = "Mixed";
  let valueEdge = null;

  if (projected != null && implied != null) {
    valueEdge = Number(((projected - implied) * 100).toFixed(1));
  }

  if (edgeScoring.totalWeightedImpact >= 8 && metsMajorEdges > oppMajorEdges) analyticalLean = "Mets";
  else if (edgeScoring.totalWeightedImpact >= 2) analyticalLean = "Slight Mets edge";
  else if (edgeScoring.totalWeightedImpact <= -8 && oppMajorEdges >= metsMajorEdges) analyticalLean = "Opponent";
  else if (edgeScoring.totalWeightedImpact <= -2) analyticalLean = "Slight opponent edge";

  if (valueEdge != null) {
    if (valueEdge >= 4 && edgeScoring.totalWeightedImpact > 0) analyticalLean = "Mets";
    else if (valueEdge <= -4 && edgeScoring.totalWeightedImpact < 0) analyticalLean = "Opponent";
  }

  let confidence = edgeScoring.confidence;
  if (fallbackHeavy && confidence === "medium") confidence = "low";
  if ((analyticalLean === "Opponent" || analyticalLean === "Slight opponent edge" || analyticalLean === "Mixed") && confidence === "high") confidence = "medium";

  return {
    analyticalLean,
    officialPick: "Mets ML",
    confidence,
    valueEdge,
    metsMajorEdges,
    oppMajorEdges,
    fallbackHeavy
  };
}

function normalizeCategoryLabel(category) {
  if (category === "Overall Lineup Quality" || category === "Lineup vs Handedness") return "Lineup Quality";
  return category;
}

function buildQuickRead(edgeScoring, pick) {
  const bestEdge = edgeScoring.categories
    .filter((edge) => edge.edge === "Mets edge")
    .sort((a, b) => Math.abs(b.weightedImpact) - Math.abs(a.weightedImpact))[0] || null;
  const biggestRisk = edgeScoring.categories
    .filter((edge) => edge.edge === "Opponent edge")
    .sort((a, b) => Math.abs(b.weightedImpact) - Math.abs(a.weightedImpact))[0] || null;

  return {
    modelLean: pick.analyticalLean,
    officialPick: "Mets ML",
    bestEdge: bestEdge ? normalizeCategoryLabel(bestEdge.category) : "No clear edge",
    biggestRisk: biggestRisk ? normalizeCategoryLabel(biggestRisk.category) : "Limited data"
  };
}

function buildEdgeSummary(edgeScoring, pick) {
  const orderedCategories = [
    "Starting Pitching",
    "Overall Lineup Quality",
    "Lineup vs Handedness",
    "Bullpen",
    "Regression Signals",
    "Context",
    "Market Value"
  ];

  const rows = orderedCategories
    .map((category) => edgeScoring.categories.find((edge) => edge.category === category))
    .filter(Boolean)
    .map((edge) => ({
      category: normalizeCategoryLabel(edge.category),
      verdict: edge.edge,
      strength: edge.strength,
      dataMode: edge.dataMode
    }));

  const uniqueRows = [];
  for (const row of rows) {
    if (!uniqueRows.some((existing) => existing.category === row.category)) {
      uniqueRows.push(row);
    }
  }

  const findVerdict = (categoryLabel) => uniqueRows.find((row) => row.category === categoryLabel) || null;

  return {
    startingPitching: findVerdict("Starting Pitching"),
    lineupQuality: findVerdict("Lineup Quality"),
    bullpen: findVerdict("Bullpen"),
    regressionSignals: findVerdict("Regression Signals"),
    context: findVerdict("Context"),
    schedulingSpot: findVerdict("Context")
      ? { ...findVerdict("Context"), category: "Scheduling Spot" }
      : null,
    marketValue: findVerdict("Market Value"),
    rows: uniqueRows,
    overallModelLean: pick.analyticalLean
  };
}

function buildGameDetailsSummary(gameFacts, analysisObject) {
  return {
    date: gameFacts.meta.date,
    time: gameFacts.meta.time,
    opponent: gameFacts.game.opponent,
    homeAway: gameFacts.meta.homeAway,
    ballpark: gameFacts.meta.ballpark,
    weather: formatWeatherForecast(analysisObject.gameInfo.weather || gameFacts.weather),
    lineupStatus: gameFacts.lineups.status === "confirmed" ? "Confirmed" : "Projected",
    moneyline: gameFacts.money.metsMoneyline == null
      ? "N/A"
      : (gameFacts.money.metsMoneyline > 0 ? `+${gameFacts.money.metsMoneyline}` : String(gameFacts.money.metsMoneyline))
  };
}

function buildPitchingEdgeSummary(gameFacts, edgeScoring) {
  const edge = edgeScoring.categories.find((category) => category.category === "Starting Pitching");
  if (!edge) return "No clear starting-pitching edge.";
  if (edge.edge === "Mets edge") {
    return `${gameFacts.pitching.mets.name} gives the Mets the cleaner underlying starting-pitcher case.`;
  }
  if (edge.edge === "Opponent edge") {
    return `${gameFacts.pitching.opp.name} holds the steadier underlying pitching profile entering this matchup.`;
  }
  return "Starting pitching grades as essentially even on the current board.";
}

function buildProjectedLineupEdgeSummary(edgeScoring) {
  const edge = edgeScoring.categories.find((category) => /Lineup|Overall Lineup Quality/.test(category.category));
  if (!edge) return "No clear lineup edge.";
  if (edge.edge === "Mets edge") {
    return edge.dataMode === "real"
      ? "The Mets hold the cleaner lineup-vs-handedness case."
      : "The Mets hold the better overall lineup-quality case, even without true split support.";
  }
  if (edge.edge === "Opponent edge") {
    return edge.dataMode === "real"
      ? "The opponent carries the stronger split-driven lineup case."
      : "The opponent has the better overall lineup-quality profile on the current inputs.";
  }
  return "Lineup quality is mostly neutral on the current board.";
}

function buildGameAnalysisBullets(gameFacts, metsAngles, riskAngles, pick) {
  const whyMetsHaveCase = [];
  const whereRiskIs = [];

  for (const edge of metsAngles.slice(0, 3)) {
    if (/overall lineup quality|lineup vs handedness/i.test(edge.category)) {
      whyMetsHaveCase.push("The clearest Mets path is the projected lineup carrying the better overall offensive shape and expected contact quality.");
    } else if (edge.category === "Starting Pitching") {
      whyMetsHaveCase.push(`${gameFacts.pitching.mets.name} gives New York the cleaner run-prevention case in the underlying metrics that are actually available.`);
    } else if (edge.category === "Bullpen") {
      whyMetsHaveCase.push("There is still a workable bullpen path if the game reaches the middle innings in a tie or with a narrow Mets lead.");
    } else if (edge.category === "Regression Signals") {
      whyMetsHaveCase.push("There is at least a plausible positive-regression case if the Mets' quality of contact finally turns into actual runs.");
    }
  }

  if (!whyMetsHaveCase.length) {
    whyMetsHaveCase.push("The best Mets argument is still lineup quality, but it is narrower than a true all-green matchup.");
  }

  for (const edge of riskAngles.slice(0, 2)) {
    if (edge.category === "Regression Signals") {
      whereRiskIs.push("The offense is still asking the model to trust expected results more than actual production.");
    } else if (edge.category === "Starting Pitching") {
      whereRiskIs.push(`${gameFacts.pitching.opp.name} owns the better strike-throwing profile, so the mound edge does not sit with New York.`);
    } else if (edge.category === "Bullpen") {
      whereRiskIs.push("Bullpen support is not a clean Mets edge, especially with both relief groups carrying recent workload.");
    } else {
      whereRiskIs.push("The softer context inputs lean slightly away from New York, and several of those inputs are still incomplete.");
    }
  }

  if (!whereRiskIs.length) {
    whereRiskIs.push("The missing-data load is the biggest reason this read stays conservative.");
  }

  const bottomLine = pick.analyticalLean === "Mets"
    ? "The board still leans Mets, but the strongest case is narrow enough that the writeup should stay disciplined."
    : pick.analyticalLean === "Slight Mets edge"
      ? "New York has a live case, but the margin is thin and the read is more measured than emphatic."
      : pick.analyticalLean === "Opponent"
        ? "The honest board leans the other way, so the Mets case is more about the clearest plausible path than a full-model endorsement."
        : pick.analyticalLean === "Slight opponent edge"
          ? "The board gives the other side a small edge, which keeps the Mets case narrow and conditional."
          : "The board is mixed enough that the Mets case needs to stay focused on the cleanest supporting angles.";

  return { whyMetsHaveCase, whereRiskIs, bottomLine };
}

function buildAdvancedWriteup(gameFacts, analysisObject, edgeScoring, missingMetrics = []) {
  const topEdges = [...edgeScoring.categories]
    .sort((a, b) => Math.abs(b.weightedImpact) - Math.abs(a.weightedImpact))
    .filter((edge) => edge.strength !== "even")
    .slice(0, 4);
  const pick = decidePick(edgeScoring, analysisObject);
  const strongest = topEdges[0] || null;
  const opponent = gameFacts.game.opponent;
  const headline = strongest
    ? `Mets vs ${opponent}: ${strongest.category.toLowerCase()} is the clearest angle`
    : `Mets vs ${opponent}: mixed board, limited conviction`;
  const synopsis = [
    `${gameFacts.pitching.mets.name} vs ${gameFacts.pitching.opp.name} sets the matchup, but the strongest supported angle is ${strongest ? strongest.category.toLowerCase() : "a mixed board with limited conviction"}.`,
    strongest?.explanation || null,
    edgeScoring.confidence === "low" ? "Several key inputs are still missing, so the read should stay conservative." : null
  ].filter(Boolean).slice(0, 3).join(" ");

  const metsAngles = topEdges
    .filter((edge) => edge.edge === "Mets edge")
    .slice(0, 4)
    .map((edge) => edge);
  const riskAngles = edgeScoring.categories
    .filter((edge) => edge.edge === "Opponent edge")
    .sort((a, b) => Math.abs(b.weightedImpact) - Math.abs(a.weightedImpact))
    .slice(0, 3);
  const proMetsOfficialAngles = edgeScoring.categories
    .filter((edge) => edge.edge === "Mets edge")
    .sort((a, b) => Math.abs(b.weightedImpact) - Math.abs(a.weightedImpact))
    .slice(0, 3);

  const contextLine = `Series game ${gameFacts.game.seriesGameNumber || 1}. Rest/travel: Mets ${analysisObject.context.restDays.mets ?? "N/A"} days, opponent ${analysisObject.context.restDays.opp ?? "N/A"}; bullpen tax ${analysisObject.bullpen.mets.taxLevel}/${analysisObject.bullpen.opp.taxLevel}.`;
  const whyMets = metsAngles.length
    ? metsAngles.slice(0, 2).map((edge) => {
        if (/overall lineup quality|lineup vs handedness/i.test(edge.category)) {
          return `The best Mets case is lineup quality: the projected group carries a small WAR edge and the stronger expected contact profile, even without true handedness-split data.`;
        }
        if (edge.category === "Starting Pitching") {
          return `The pitching case is that ${gameFacts.pitching.mets.name} has the cleaner underlying run-prevention profile in the categories we can actually measure today.`;
        }
        if (edge.category === "Bullpen") {
          return `There is at least a modest bullpen path if New York can get to the middle innings without trailing, because the season-long gap is close and usage is heavy on both sides.`;
        }
        return edge.explanation;
      }).join(" ")
    : "There is no strong supported Mets angle beyond a modest overall lineup-quality edge, which is why the read stays conservative.";
  const whereRisk = riskAngles.length
    ? riskAngles.slice(0, 2).map((edge) => {
        if (edge.category === "Regression Signals") {
          return `The main concern is that the Mets' contact-quality indicators still have not converted into actual production, so the offense is more projection than payoff right now.`;
        }
        if (edge.category === "Starting Pitching") {
          return `${gameFacts.pitching.opp.name} still owns the better K-BB profile, so the strike-throwing edge is on the other side even if the surface numbers are not.`;
        }
        if (edge.category === "Bullpen") {
          return `Bullpen support is not a clean Mets advantage, especially with both clubs carrying heavy recent workloads and no verified top-arm availability feed.`;
        }
        if (edge.category === "Home/Away Split" || edge.category === "Context") {
          return `Context also leans slightly against New York because this is a road spot and the split data behind that angle is still incomplete.`;
        }
        return edge.explanation;
      }).join(" ")
    : "There is no single red-flag risk angle, but the missing data keeps the overall conviction down.";
  const analyticalLeanBody = pick.analyticalLean === "Mets"
    ? "The weighted board comes in on the Mets side."
    : pick.analyticalLean === "Slight Mets edge"
      ? "The weighted board leans slightly toward New York, but not by enough to overstate the case."
      : pick.analyticalLean === "Opponent"
        ? "The weighted board leans to the other side, largely because New York is still carrying more real risk than clean support in the current data."
        : pick.analyticalLean === "Slight opponent edge"
          ? "The weighted board gives the opponent a slight edge, even if the gap is not overwhelming."
          : "The weighted board is mixed, with too many missing inputs to treat either side as a clean analytical play.";
  const officialPickSummaryParts = [];
  if (proMetsOfficialAngles[0]) {
    if (/overall lineup quality|lineup vs handedness/i.test(proMetsOfficialAngles[0].category)) {
      officialPickSummaryParts.push("The clearest case for backing the Mets is that the projected lineup still grades better overall, especially in expected offensive quality.");
    } else if (proMetsOfficialAngles[0].category === "Starting Pitching") {
      officialPickSummaryParts.push(`The best path starts with ${gameFacts.pitching.mets.name} giving New York the steadier underlying pitching line.`);
    } else if (proMetsOfficialAngles[0].category === "Bullpen") {
      officialPickSummaryParts.push("There is still a workable bullpen path for New York if the game stays close into the middle innings.");
    } else {
      officialPickSummaryParts.push(proMetsOfficialAngles[0].explanation);
    }
  }
  if (proMetsOfficialAngles[1]) {
    if (proMetsOfficialAngles[1].category === "Regression Signals") {
      officialPickSummaryParts.push("There is also a reasonable positive-regression case if the Mets' contact quality finally cashes in.");
    } else {
      officialPickSummaryParts.push(proMetsOfficialAngles[1].explanation);
    }
  }
  if (pick.analyticalLean === "Opponent" || pick.analyticalLean === "Slight opponent edge" || pick.analyticalLean === "Mixed") {
    officialPickSummaryParts.push("That said, this is one of the more self-aware Mets ML spots: the analytical read is not fully on their side, so the brand pick is leaning on the best plausible New York path rather than a clean all-in edge.");
  }
  const pickSummary = officialPickSummaryParts.filter(Boolean).slice(0, 3).join(" ");
  const quickRead = buildQuickRead(edgeScoring, pick);
  const edgeSummary = buildEdgeSummary(edgeScoring, pick);
  const gameDetails = buildGameDetailsSummary(gameFacts, analysisObject);
  const pitchingEdgeSummary = buildPitchingEdgeSummary(gameFacts, edgeScoring);
  const projectedLineupEdgeSummary = buildProjectedLineupEdgeSummary(edgeScoring);
  const gameAnalysis = buildGameAnalysisBullets(gameFacts, metsAngles, riskAngles, pick);
  const structuredGameAnalysisBody = [
    "Why the Mets have a case",
    ...gameAnalysis.whyMetsHaveCase.slice(0, 3).map((item) => `• ${item}`),
    "",
    "Where the risk is",
    ...gameAnalysis.whereRiskIs.slice(0, 2).map((item) => `• ${item}`),
    "",
    "Bottom line",
    gameAnalysis.bottomLine
  ].join("\n");

  return {
    raw: JSON.stringify({
      generatedAt: new Date().toISOString(),
      analysisObject,
      edgeScoring,
      missingMetrics,
      pick
    }),
    headline,
    synopsis,
    quickRead,
    gameDetails,
    edgeSummary,
    pitchingEdgeSummary,
    projectedLineupEdgeSummary,
    analysis: {
      whyMetsHaveACase: gameAnalysis.whyMetsHaveCase,
      whereTheRiskIs: gameAnalysis.whereRiskIs,
      bottomLine: gameAnalysis.bottomLine
    },
    gameAnalysis,
    edgeTable: edgeScoring.categories.map((edge) => ({
      category: edge.category,
      edge: edge.edge,
      strength: edge.strength,
      reason: edge.explanation,
      dataMode: edge.dataMode
    })),
    keyAngles: topEdges.map((edge) => edge.explanation),
    pick: pick.officialPick,
    analyticalLean: pick.analyticalLean,
    confidence: pick.confidence,
    missingMetrics,
    analysisObject,
    edgeScoring,
    sections: [
      { heading: "1. Quick Read", body: `Model Lean: ${quickRead.modelLean}. Official Pick: ${quickRead.officialPick}. Best Edge: ${quickRead.bestEdge}. Biggest Risk: ${quickRead.biggestRisk}.` },
      { heading: "2. Game Details", body: `${gameFacts.meta.date} | ${gameFacts.meta.time} | ${gameFacts.meta.ballpark}. ${gameFacts.meta.homeAway === "home" ? "Mets home game." : "Mets road game."} Lineups: ${gameDetails.lineupStatus}. Mets ML: ${gameDetails.moneyline}.` },
      { heading: "3. Edge Summary", body: `${edgeSummary.rows.map((row) => `${row.category}: ${row.verdict}${row.dataMode === "fallback" ? " (fallback)" : ""}`).join(" | ")} | Overall Model Lean: ${edgeSummary.overallModelLean}.` },
      { heading: "4. Starting Pitchers Comparison", body: pitchingEdgeSummary },
      { heading: "5. Pitcher Contact Profile vs Opponent", body: edgeScoring.categories.find((edge) => edge.category === "Starting Pitching")?.explanation || "Pitcher contact profile is neutral." },
      { heading: "6. Pitcher Split Matchup vs Opponent", body: `${edgeScoring.categories.find((edge) => /Lineup|Overall Lineup Quality/.test(edge.category))?.explanation || "No clear split matchup edge."} ${contextLine}`.trim() },
      { heading: "7. Projected Lineup Comparison", body: projectedLineupEdgeSummary },
      { heading: "8. Game Analysis", body: structuredGameAnalysisBody },
      { heading: "9. Official MetsMoneyline Pick", body: pickSummary }
    ],
    pickSummary,
    officialPick: "Official Pick: Mets ML"
  };
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
    quickRead: {
      modelLean: "Mets",
      officialPick: "Mets ML",
      bestEdge: "Lineup Quality",
      biggestRisk: "Limited data"
    },
    gameDetails: {
      date: gameFacts.meta.date,
      time: gameFacts.meta.time,
      opponent,
      homeAway: gameFacts.meta.homeAway,
      ballpark,
      weather: "N/A",
      lineupStatus: lineupStatus === "confirmed" ? "Confirmed" : "Projected",
      moneyline: gameFacts.money?.metsMoneyline == null ? "N/A" : String(gameFacts.money.metsMoneyline)
    },
    edgeSummary: {
      startingPitching: { category: "Starting Pitching", verdict: "Limited data", strength: "even", dataMode: "fallback" },
      lineupQuality: { category: "Lineup Quality", verdict: "Mets edge", strength: "slight", dataMode: "fallback" },
      bullpen: { category: "Bullpen", verdict: "Mets edge", strength: "slight", dataMode: "fallback" },
      regressionSignals: { category: "Regression Signals", verdict: "Limited data", strength: "even", dataMode: "fallback" },
      context: { category: "Context", verdict: "Even", strength: "even", dataMode: "fallback" },
      schedulingSpot: { category: "Scheduling Spot", verdict: "Even", strength: "even", dataMode: "fallback" },
      marketValue: { category: "Market Value", verdict: "Limited data", strength: "even", dataMode: "fallback" },
      rows: [
        { category: "Starting Pitching", verdict: "Limited data", strength: "even", dataMode: "fallback" },
        { category: "Lineup Quality", verdict: "Mets edge", strength: "slight", dataMode: "fallback" },
        { category: "Bullpen", verdict: "Mets edge", strength: "slight", dataMode: "fallback" },
        { category: "Regression Signals", verdict: "Limited data", strength: "even", dataMode: "fallback" },
        { category: "Context", verdict: "Even", strength: "even", dataMode: "fallback" },
        { category: "Market Value", verdict: "Limited data", strength: "even", dataMode: "fallback" }
      ],
      overallModelLean: "Mets"
    },
    pitchingEdgeSummary: `${metsPitcher} vs ${oppPitcher} is workable, but this version is still running on fallback data.`,
    projectedLineupEdgeSummary: "The best Mets case is still the overall lineup shape and run-creation potential.",
    analysis: {
      whyMetsHaveACase: [
        "The lineup baseline is still good enough to give New York a plausible offensive path.",
        "The bullpen and offensive profile keep the Mets case alive even in fallback mode."
      ],
      whereTheRiskIs: [
        "This version is missing too much detail to overstate any one edge."
      ],
      bottomLine: "The fallback sheet still lands on the Mets, but with a lighter analytical touch."
    },
    gameAnalysis: {
      whyMetsHaveCase: [
        "The lineup baseline is still good enough to give New York a plausible offensive path.",
        "The bullpen and offensive profile keep the Mets case alive even in fallback mode."
      ],
      whereRiskIs: [
        "This version is missing too much detail to overstate any one edge."
      ],
      bottomLine: "The fallback sheet still lands on the Mets, but with a lighter analytical touch."
    },
    sections: [
      { heading: "1. Quick Read", body: `Model Lean: Mets. Official Pick: Mets ML. Best Edge: Lineup Quality. Biggest Risk: Limited data.` },
      { heading: "2. Game Details", body: shortRecapBody },
      { heading: "3. Edge Summary", body: `Starting Pitching: Limited data | Lineup Quality: Mets edge | Bullpen: Mets edge | Regression Signals: Limited data | Context: Even | Market Value: Limited data | Overall Model Lean: Mets.` },
      { heading: "4. Starting Pitchers Comparison", body: `${metsPitcher}${gameFacts.pitching.mets.seasonERA ? ` (${gameFacts.pitching.mets.seasonERA} ERA` : ""}${gameFacts.pitching.mets.seasonWHIP ? `, ${gameFacts.pitching.mets.seasonWHIP} WHIP` : ""}${gameFacts.pitching.mets.note ? `, ${gameFacts.pitching.mets.note}` : ""}${gameFacts.pitching.mets.seasonERA ? ")" : ""} vs ${oppPitcher}${gameFacts.pitching.opp.seasonERA ? ` (${gameFacts.pitching.opp.seasonERA} ERA` : ""}${gameFacts.pitching.opp.seasonWHIP ? `, ${gameFacts.pitching.opp.seasonWHIP} WHIP` : ""}${gameFacts.pitching.opp.note ? `, ${gameFacts.pitching.opp.note}` : ""}${gameFacts.pitching.opp.seasonERA ? ")" : ""}.` },
      { heading: "5. Pitcher Contact Profile vs Opponent", body: `Bullpen check: Mets ERA ${metsBp.seasonERA || "N/A"}, xFIP ${metsBp.seasonXFIP || "N/A"}, WHIP ${metsBp.seasonWHIP || "N/A"}. ${opponent} ERA ${oppBp.seasonERA || "N/A"}, xFIP ${oppBp.seasonXFIP || "N/A"}, WHIP ${oppBp.seasonWHIP || "N/A"}.` },
      { heading: "6. Pitcher Split Matchup vs Opponent", body: `Lineups are ${lineupStatus}. Team offense: NYM wRC+ ${ta.mets?.wrcPlus || "N/A"}, xwOBA ${ta.mets?.xwoba || "N/A"}, K% ${ta.mets?.kPct || "N/A"}. ${opponent} wRC+ ${ta.opp?.wrcPlus || "N/A"}, xwOBA ${ta.opp?.xwoba || "N/A"}, K% ${ta.opp?.kPct || "N/A"}.` },
      { heading: "7. Projected Lineup Comparison", body: `Main numbers: NYM wRC+ ${ta.mets?.wrcPlus || "N/A"} vs ${ta.opp?.wrcPlus || "N/A"}, NYM xwOBA ${ta.mets?.xwoba || "N/A"} vs ${ta.opp?.xwoba || "N/A"}, NYM bullpen rating ${metsBp.rating || "N/A"} vs ${oppBp.rating || "N/A"}.` },
      {
        heading: "8. Game Analysis",
        body: [
          "Why the Mets have a case",
          "• The lineup baseline is still good enough to give New York a plausible offensive path.",
          "• The bullpen and offensive profile keep the Mets case alive even in fallback mode.",
          "",
          "Where the risk is",
          "• This version is missing too much detail to overstate any one edge.",
          "",
          "Bottom line",
          "The fallback sheet still lands on the Mets, but with a lighter analytical touch."
        ].join("\n")
      },
      { heading: "9. Official MetsMoneyline Pick", body: `The best case for backing the Mets is the cleaner offensive path and a workable bullpen script if the game stays close early.` }
    ],
    pickSummary: `The best case for backing the Mets is the cleaner offensive path and a workable bullpen script if the game stays close early.`,
    officialPick: "Official Pick: Mets ML",
    analyticalLean: "Mets"
  };
}

async function generateWriteupFromFacts(gameFacts) {
  const analysisObject = buildGameAnalysisObject(gameFacts);
  const missingMetrics = buildMissingMetricsList(analysisObject);
  const edgeScoring = buildEdgeScoring(analysisObject);
  return buildAdvancedWriteup(gameFacts, analysisObject, edgeScoring, missingMetrics);
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

function buildPendingHistoryEntry(game, existingEntry = null) {
  if (!game?.date || !game?.opponent) return null;
  const moneyline = game.moneyline?.mets ?? game.bettingHistory?.odds ?? existingEntry?.odds ?? null;
  if (isSettledHistoryEntry(existingEntry)) {
    return {
      ...existingEntry,
      gameId: game.id || existingEntry?.gameId || null,
      officialPick: game.writeup?.officialPick || existingEntry?.officialPick || "Official Pick: Mets ML",
      odds: moneyline,
      stake: typeof existingEntry?.stake === "number" ? existingEntry.stake : 100
    };
  }
  return {
    gameId: game.id || existingEntry?.gameId || null,
    date: game.date,
    opponent: game.opponent,
    homeAway: game.homeAway || existingEntry?.homeAway || null,
    estimated: Boolean(existingEntry?.estimated ?? false),
    status: "pending",
    finalScore: null,
    officialPick: game.writeup?.officialPick || existingEntry?.officialPick || "Official Pick: Mets ML",
    market: existingEntry?.market || "Mets Moneyline",
    odds: moneyline,
    stake: typeof existingEntry?.stake === "number" ? existingEntry.stake : 100,
    result: null,
    profit: null
  };
}

function toHistoryEntry(game, existingEntry = null) {
  if (!game?.date || !game?.opponent) return null;
  if (!game?.result) return buildPendingHistoryEntry(game, existingEntry);
  const finalScore = game.finalScore
    ? `${game.finalScore.mets}-${game.finalScore.opp}`
    : game.gameContext?.lastMeeting?.metsScore != null && game.gameContext?.lastMeeting?.oppScore != null
      ? `${game.gameContext.lastMeeting.metsScore}-${game.gameContext.lastMeeting.oppScore}`
      : existingEntry?.finalScore || null;
  const metsWon = game.result === "win";
  const moneyline = game.moneyline?.mets ?? game.bettingHistory?.odds ?? existingEntry?.odds ?? null;
  const stake = typeof existingEntry?.stake === "number" ? existingEntry.stake : 100;
  const profit = typeof moneyline === "number"
    ? (metsWon ? calculateMoneylineProfit(moneyline, stake) : -stake)
    : existingEntry?.profit ?? null;
  return {
    gameId: game.id || existingEntry?.gameId || null,
    date: game.date,
    opponent: game.opponent,
    homeAway: game.homeAway || existingEntry?.homeAway || null,
    estimated: Boolean(existingEntry?.estimated ?? false),
    status: "final",
    finalScore,
    officialPick: game.writeup?.officialPick || existingEntry?.officialPick || "Official Pick: Mets ML",
    market: existingEntry?.market || "Mets Moneyline",
    odds: moneyline,
    stake,
    result: metsWon ? "W" : "L",
    profit
  };
}

function mergeRecentBreakdowns(previousOutput, currentGame, persistentHistoryEntries = []) {
  const priorRecent = Array.isArray(previousOutput?.recentBreakdowns) ? previousOutput.recentBreakdowns : [];
  const priorGames = Array.isArray(previousOutput?.games) ? previousOutput.games : [];
  const entries = dedupeHistoryEntries([...persistentHistoryEntries, ...priorRecent]);

  const upsertHistoryEntry = (gameLike) => {
    if (!gameLike) return;
    const targetKey = buildHistoryKey({
      gameId: gameLike.id || gameLike.gameId || null,
      date: gameLike.date,
      opponent: gameLike.opponent,
      homeAway: gameLike.homeAway
    });
    const index = entries.findIndex((entry) => buildHistoryKey(entry) === targetKey);
    const existingEntry = index >= 0 ? entries[index] : null;
    const mergedEntry = toHistoryEntry(gameLike, existingEntry);
    if (!mergedEntry) return;
    if (index >= 0) entries[index] = mergedEntry;
    else entries.push(mergedEntry);
  };

  for (const priorGame of priorGames) {
    upsertHistoryEntry(priorGame);
  }

  if (currentGame) {
    upsertHistoryEntry(currentGame);
  }

  return dedupeHistoryEntries(entries).slice(0, 200);
}

function buildPresentationReport(game) {
  const writeup = game?.writeup || {};
  const preliminaryMeta = writeup.preliminaryMeta || null;
  const analysisObject = writeup.analysisObject || {};
  const pitching = game?.pitching || {};
  const lineups = game?.lineups || {};
  const gameContext = game?.gameContext || {};
  const weatherSummary = formatWeatherForecast(game?.weather || writeup.gameDetails?.weather || analysisObject?.gameInfo?.weather);
  const homeAwayLabel = game?.homeAway === "home" ? "Home" : game?.homeAway === "away" || game?.homeAway === "road" ? "Away" : game?.homeAway || "N/A";
  const seasonLabel = String(game?.date || writeup.gameDetails?.date || "").slice(0, 4) || String(new Date().getFullYear());
  const moneylineValue = typeof game?.moneyline?.mets === "number"
    ? (game.moneyline.mets > 0 ? `+${game.moneyline.mets}` : String(game.moneyline.mets))
    : (writeup.gameDetails?.moneyline || "N/A");
  const oppMoneylineValue = typeof game?.moneyline?.opp === "number"
    ? (game.moneyline.opp > 0 ? `+${game.moneyline.opp}` : String(game.moneyline.opp))
    : "N/A";
  const locationCity = teamCityLabel(game?.homeAway === "home" ? TEAM_NAME : game?.opponent);
  const oppAbbr = TEAM_NAME_TO_ABBR[game?.opponent] || "OPP";
  const metsProjectedPa = sumProjectedLineupPa(lineups?.mets || []);
  const oppProjectedPa = sumProjectedLineupPa(lineups?.opp || []);
  const teamAdvanced = game?.teamAdvanced || game?.advanced?.teamAdvanced || {};
  const headline = writeup.headline || `New York Mets vs ${game?.opponent || "Opponent"}`;
  const tagline = headline.includes(":") ? cleanText(headline.split(":").slice(1).join(":")) : headline;
  const preliminaryTitle = preliminaryMeta?.enabled
    ? `${preliminaryMeta.titlePrefix || "PRELIMINARY REPORT"} - ${headline}`
    : headline;
  const teamComparison = {
    metsHeader: "New York Mets",
    oppHeader: game?.opponent === "San Francisco Giants" ? "SF Giants" : (game?.opponent || "Opponent"),
    rows: [
      { label: "Odds", mets: moneylineValue, opp: oppMoneylineValue },
      { label: "Season Record", mets: sanitizeRecord(game?.metsRecord, "N/A"), opp: sanitizeRecord(game?.oppRecord, "N/A") },
      { label: "Last 5 Record", mets: recentRecordFromGames(gameContext?.metsRecentGames, 5), opp: recentRecordFromGames(gameContext?.oppRecentGames, 5) },
      {
        label: "Home/Away Record",
        mets: `${sanitizeRecord(game?.homeAway === "home" ? game?.recordSplits?.metsHome : game?.recordSplits?.metsRoad, "N/A")} (${String(homeAwayLabel || "").toLowerCase() || "away"})`,
        opp: `${sanitizeRecord(game?.homeAway === "home" ? game?.recordSplits?.oppRoad : game?.recordSplits?.oppHome, "N/A")} (${String(game?.homeAway === "home" ? "away" : "home")})`
      },
      {
        label: "Season Series Record",
        mets: gameContext?.headToHead ? `${Number(gameContext.headToHead.wins || 0)}-${Number(gameContext.headToHead.losses || 0)}` : "N/A",
        opp: gameContext?.headToHead ? `${Number(gameContext.headToHead.losses || 0)}-${Number(gameContext.headToHead.wins || 0)}` : "N/A"
      }
    ]
  };
  const schedulingSpot = writeup.edgeSummary?.schedulingSpot || (writeup.edgeSummary?.context
    ? { ...writeup.edgeSummary.context, category: "Scheduling Spot" }
    : null);

  return {
    header: {
      title: preliminaryTitle,
      matchupTitle: `New York Mets vs ${game?.opponent || "Opponent"}`,
      tagline,
      date: game?.date || null,
      time: game?.time || null,
      ballpark: game?.ballpark || null,
      metsLogoUrl: "https://www.mlbstatic.com/team-logos/121.svg",
      oppLogoUrl: game?.oppTeamId ? `https://www.mlbstatic.com/team-logos/${game.oppTeamId}.svg` : null,
      metadataLine: [
        formatGameSheetDate(game?.date || writeup.gameDetails?.date),
        game?.time || writeup.gameDetails?.time || null,
        game?.ballpark || writeup.gameDetails?.ballpark || null,
        weatherSummary || "N/A"
      ].filter(Boolean).join(" | ")
    },
    preliminary: preliminaryMeta?.enabled
      ? {
          enabled: true,
          titlePrefix: preliminaryMeta.titlePrefix || "PRELIMINARY REPORT",
          lineupSource: preliminaryMeta.lineupSource || null,
          lineupSourceLabel: preliminaryMeta.lineupSourceLabel || null,
          note: preliminaryMeta.note || null
        }
      : null,
    quickRead: writeup.quickRead || null,
    gameDetails: writeup.gameDetails || null,
    gameDetailsTable: {
      rows: [
        { label: "Game Date / Time", value: formatGameSheetDateTime(game?.date || writeup.gameDetails?.date, game?.time || writeup.gameDetails?.time) },
        { label: "Location", value: `${game?.ballpark || writeup.gameDetails?.ballpark || "Venue TBD"} - ${locationCity}` },
        { label: "Weather Forecast", value: weatherSummary },
        { label: "Mets ML Odds", value: moneylineValue }
      ]
    },
    teamComparison,
    edgeSummary: writeup.edgeSummary || null,
    startingPitchersComparison: {
      metsPitcher: pitching.mets?.name || "TBD",
      oppPitcher: pitching.opp?.name || "TBD",
      seasonLabel,
      metsCard: {
        name: pitching.mets?.name || "TBD",
        mlbId: pitching.mets?.mlbId || null,
        record: pitching.mets?.seasonRecord || null,
        hand: pitching.mets?.hand || null,
        teamLabel: "NYM",
        recentStarts: game?.gameContext?.metsPitcherLog || [],
        stats: {
          era: pitching.mets?.seasonERA || null,
          whip: pitching.mets?.seasonWHIP || null,
          kPct: pitching.mets?.savant?.kPct || null,
          bbPct: pitching.mets?.savant?.bbPct || null
        }
      },
      oppCard: {
        name: pitching.opp?.name || "TBD",
        mlbId: pitching.opp?.mlbId || null,
        record: pitching.opp?.seasonRecord || null,
        hand: pitching.opp?.hand || null,
        teamLabel: game?.opponent || "Opponent",
        recentStarts: game?.gameContext?.oppPitcherLog || [],
        stats: {
          era: pitching.opp?.seasonERA || null,
          whip: pitching.opp?.seasonWHIP || null,
          kPct: pitching.opp?.savant?.kPct || null,
          bbPct: pitching.opp?.savant?.bbPct || null
        }
      },
      advancedMatchupTables: [
        {
          title: "Advanced Stats vs Opponent",
          leftHeader: `NYM ${pitching.mets?.name || "Mets SP"}`,
          rightHeader: `${oppAbbr} Offense`,
          rightTeamKey: "opp",
          rows: [
            { label: "Barrel %", left: pitching.mets?.savant?.barrelPct || null, leftPercentile: pitching.mets?.savant?.percentiles?.barrelPct ?? null, right: analysisObject?.offense?.opp?.barrelPct || null, rightRankKey: "barrelPct" },
            { label: "xBA", left: pitching.mets?.savant?.xBAAllowed || null, leftPercentile: pitching.mets?.savant?.percentiles?.xBAAllowed ?? null, right: analysisObject?.offense?.opp?.xBA || null, rightRankKey: "xba" },
            { label: "Hard Hit %", left: pitching.mets?.savant?.hardHitPct || null, leftPercentile: pitching.mets?.savant?.percentiles?.hardHitPct ?? null, right: analysisObject?.offense?.opp?.hardHitPct || null, rightRankKey: "hardHit" },
            { label: "xSLG %", left: pitching.mets?.savant?.xSLGAllowed || null, leftPercentile: pitching.mets?.savant?.percentiles?.xSLGAllowed ?? null, right: analysisObject?.offense?.opp?.xSLG || null, rightRankKey: "xslg" }
          ]
        },
        {
          title: "Opponent Advanced Stats vs Mets",
          leftHeader: `${oppAbbr} ${pitching.opp?.name || "Opponent SP"}`,
          rightHeader: "NYM Offense",
          rightTeamKey: "mets",
          rows: [
            { label: "Barrel %", left: pitching.opp?.savant?.barrelPct || null, leftPercentile: pitching.opp?.savant?.percentiles?.barrelPct ?? null, right: analysisObject?.offense?.mets?.barrelPct || null, rightRankKey: "barrelPct" },
            { label: "xBA", left: pitching.opp?.savant?.xBAAllowed || null, leftPercentile: pitching.opp?.savant?.percentiles?.xBAAllowed ?? null, right: analysisObject?.offense?.mets?.xBA || null, rightRankKey: "xba" },
            { label: "Hard Hit %", left: pitching.opp?.savant?.hardHitPct || null, leftPercentile: pitching.opp?.savant?.percentiles?.hardHitPct ?? null, right: analysisObject?.offense?.mets?.hardHitPct || null, rightRankKey: "hardHit" },
            { label: "xSLG %", left: pitching.opp?.savant?.xSLGAllowed || null, leftPercentile: pitching.opp?.savant?.percentiles?.xSLGAllowed ?? null, right: analysisObject?.offense?.mets?.xSLG || null, rightRankKey: "xslg" }
          ]
        },
        {
          title: "Advanced Stats vs Opponent Splits",
          leftHeader: `NYM ${pitching.mets?.name || "Mets SP"}`,
          rightHeader: `${oppAbbr} Profile`,
          rightTeamKey: "opp",
          rows: [
            { label: "Pitching Hand / vs Split", left: expandPitchingHandLabel(pitching.mets?.hand), right: formatVsSplitLabel(pitching.mets?.hand) },
            { label: "Innings Pitched / Plate Appearances", left: extractSeasonIp(pitching.mets?.seasonLine, pitching.mets?.note), right: oppProjectedPa },
            { label: "K%", left: pitching.mets?.savant?.kPct || null, leftPercentile: pitching.mets?.savant?.percentiles?.kPct ?? null, right: analysisObject?.offense?.opp?.kPct || null, rightRankKey: "kPct" },
            { label: "BB%", left: pitching.mets?.savant?.bbPct || null, leftPercentile: pitching.mets?.savant?.percentiles?.bbPct ?? null, right: analysisObject?.offense?.opp?.bbPct || null, rightRankKey: "bbPct" }
          ]
        },
        {
          title: "Opponent Advanced Stats vs Mets Splits",
          leftHeader: `${oppAbbr} ${pitching.opp?.name || "Opponent SP"}`,
          rightHeader: "NYM Profile",
          rightTeamKey: "mets",
          rows: [
            { label: "Pitching Hand / vs Split", left: expandPitchingHandLabel(pitching.opp?.hand), right: formatVsSplitLabel(pitching.opp?.hand) },
            { label: "Innings Pitched / Plate Appearances", left: extractSeasonIp(pitching.opp?.seasonLine, pitching.opp?.note), right: metsProjectedPa },
            { label: "K%", left: pitching.opp?.savant?.kPct || null, leftPercentile: pitching.opp?.savant?.percentiles?.kPct ?? null, right: analysisObject?.offense?.mets?.kPct || null, rightRankKey: "kPct" },
            { label: "BB%", left: pitching.opp?.savant?.bbPct || null, leftPercentile: pitching.opp?.savant?.percentiles?.bbPct ?? null, right: analysisObject?.offense?.mets?.bbPct || null, rightRankKey: "bbPct" }
          ]
        }
      ],
      summary: writeup.pitchingEdgeSummary || null
    },
    pitcherContactProfile: {
      metsPitcher: pitching.mets?.name || "TBD",
      oppPitcher: pitching.opp?.name || "TBD",
      pitcherRows: [
        { label: "xERA", mets: pitching.mets?.savant?.xERA || null, opp: pitching.opp?.savant?.xERA || null },
        { label: "Barrel%", mets: pitching.mets?.savant?.barrelPct || null, opp: pitching.opp?.savant?.barrelPct || null },
        { label: "Hard-Hit%", mets: pitching.mets?.savant?.hardHitPct || null, opp: pitching.opp?.savant?.hardHitPct || null },
        { label: "Whiff%", mets: pitching.mets?.savant?.whiffPct || null, opp: pitching.opp?.savant?.whiffPct || null },
        { label: "Chase%", mets: pitching.mets?.savant?.chasePct || null, opp: pitching.opp?.savant?.chasePct || null },
        { label: "K%", mets: pitching.mets?.savant?.kPct || null, opp: pitching.opp?.savant?.kPct || null },
        { label: "BB%", mets: pitching.mets?.savant?.bbPct || null, opp: pitching.opp?.savant?.bbPct || null }
      ],
      opponentRows: [
        { label: "Projected wRC+", mets: analysisObject?.offense?.opp?.projectedLineupWRCPlus || null, opp: analysisObject?.offense?.mets?.projectedLineupWRCPlus || null },
        { label: "xwOBA", mets: analysisObject?.offense?.opp?.xwOBA || null, opp: analysisObject?.offense?.mets?.xwOBA || null },
        { label: "xSLG", mets: analysisObject?.offense?.opp?.xSLG || null, opp: analysisObject?.offense?.mets?.xSLG || null },
        { label: "Hard-Hit%", mets: analysisObject?.offense?.opp?.hardHitPct || null, opp: analysisObject?.offense?.mets?.hardHitPct || null },
        { label: "Barrel%", mets: analysisObject?.offense?.opp?.barrelPct || null, opp: analysisObject?.offense?.mets?.barrelPct || null },
        { label: "K%", mets: analysisObject?.offense?.opp?.kPct || null, opp: analysisObject?.offense?.mets?.kPct || null },
        { label: "BB%", mets: analysisObject?.offense?.opp?.bbPct || null, opp: analysisObject?.offense?.mets?.bbPct || null }
      ]
    },
    pitcherSplitMatchup: {
      metsPitcher: pitching.mets?.name || "TBD",
      oppPitcher: pitching.opp?.name || "TBD",
      pitcherRows: [
        { label: "Pitcher Hand", mets: pitching.mets?.hand || null, opp: pitching.opp?.hand || null },
        { label: "Opponent Lineup wRC+", mets: analysisObject?.offense?.opp?.projectedLineupWRCPlus || null, opp: analysisObject?.offense?.mets?.projectedLineupWRCPlus || null },
        { label: "Opponent xwOBA", mets: analysisObject?.offense?.opp?.xwOBA || null, opp: analysisObject?.offense?.mets?.xwOBA || null },
        { label: "Opponent K%", mets: analysisObject?.offense?.opp?.kPct || null, opp: analysisObject?.offense?.mets?.kPct || null },
        { label: "Opponent BB%", mets: analysisObject?.offense?.opp?.bbPct || null, opp: analysisObject?.offense?.mets?.bbPct || null }
      ],
      opponentRows: [
        { label: "Pitcher Hand", mets: pitching.opp?.hand || null, opp: pitching.mets?.hand || null },
        { label: "Lineup WAR", mets: analysisObject?.offense?.opp?.projectedLineupWAR || null, opp: analysisObject?.offense?.mets?.projectedLineupWAR || null },
        { label: "Lineup xBA", mets: analysisObject?.offense?.opp?.xBA || null, opp: analysisObject?.offense?.mets?.xBA || null },
        { label: "Lineup xSLG", mets: analysisObject?.offense?.opp?.xSLG || null, opp: analysisObject?.offense?.mets?.xSLG || null },
        { label: "Lineup xwOBA", mets: analysisObject?.offense?.opp?.xwOBA || null, opp: analysisObject?.offense?.mets?.xwOBA || null }
      ]
    },
    projectedLineupComparison: {
      summary: writeup.projectedLineupEdgeSummary || null,
      mets: lineups.mets || [],
      opp: lineups.opp || [],
      lineupStatus: lineups.lineupStatus || null
    },
    analysis: writeup.analysis || null,
    teamAdvanced,
    officialPick: {
      label: writeup.officialPick || "Official Pick: Mets ML",
      explanation: writeup.pickSummary || null
    },
    meta: {
      homeAwayLabel,
      moneylineValue,
      schedulingSpot,
      weatherSummary
    }
  };
}

function buildGameJson(gameFacts, writeup, previousOutput = null, pickHistory = null) {
  const opponentSlug = slugify(gameFacts.game.opponent);
  const id = `${gameFacts.meta.date}-mets-vs-${opponentSlug}`;
  const officialPick = writeup.officialPick || "Official Pick: Mets ML";
  const sections = writeup.sections;
  const previousGames = Array.isArray(previousOutput?.games) ? previousOutput.games : [];

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
    recordSplits: {
      metsHome: sanitizeRecord(gameFacts.records.metsHome, "N/A"),
      metsRoad: sanitizeRecord(gameFacts.records.metsRoad, "N/A"),
      oppHome: sanitizeRecord(gameFacts.records.oppHome, "N/A"),
      oppRoad: sanitizeRecord(gameFacts.records.oppRoad, "N/A")
    },
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
      headline: writeup.headline || null,
      synopsis: writeup.synopsis || null,
      quickRead: writeup.quickRead || null,
      gameDetails: writeup.gameDetails || null,
      edgeSummary: writeup.edgeSummary || null,
      pitchingEdgeSummary: writeup.pitchingEdgeSummary || null,
      projectedLineupEdgeSummary: writeup.projectedLineupEdgeSummary || null,
      analysis: writeup.analysis || null,
      gameAnalysis: writeup.gameAnalysis || null,
      sections,
      pickSummary: writeup.pickSummary,
      officialPick,
      edgeTable: writeup.edgeTable || [],
      keyAngles: writeup.keyAngles || [],
      pick: writeup.pick || null,
      analyticalLean: writeup.analyticalLean || null,
      confidence: writeup.confidence || null,
      missingMetrics: writeup.missingMetrics || [],
      analysisObject: writeup.analysisObject || null,
      edgeScoring: writeup.edgeScoring || null
    },
    bettingHistory: null,
    weather: gameFacts.weather || null
  };

  currentGame.writeup.report = buildPresentationReport(currentGame);

  const knownHistoryEntries = dedupeHistoryEntries([
    ...(Array.isArray(previousOutput?.recentBreakdowns) ? previousOutput.recentBreakdowns : []),
    ...(Array.isArray(pickHistory?.entries) ? pickHistory.entries : [])
  ]);
  const priorSettledEntry = knownHistoryEntries.find((entry) => (
    buildHistoryKey(entry) === buildHistoryKey({
      gameId: currentGame.id,
      date: currentGame.date,
      opponent: currentGame.opponent,
      homeAway: currentGame.homeAway
    })
  )) || null;

  currentGame.bettingHistory = currentGame.status === "final"
    ? {
        market: "Mets Moneyline",
        odds: currentGame.moneyline?.mets ?? priorSettledEntry?.odds ?? null,
        result: currentGame.result === "win" ? "W" : "L",
        stake: 100,
        profit: typeof (currentGame.moneyline?.mets ?? priorSettledEntry?.odds) === "number"
          ? (currentGame.result === "win"
              ? calculateMoneylineProfit(currentGame.moneyline?.mets ?? priorSettledEntry?.odds)
              : -100)
          : priorSettledEntry?.profit ?? null
      }
    : {
        market: "Mets Moneyline",
        odds: currentGame.moneyline?.mets ?? priorSettledEntry?.odds ?? null,
        result: null,
        stake: 100,
        profit: null
      };

  const preservedGames = previousGames.filter((game) => game?.id !== currentGame.id && game?.date && game?.opponent);
  const games = [currentGame, ...preservedGames]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 30);

  const output = {
    generatedAt: new Date().toISOString(),
    games,
    recentBreakdowns: mergeRecentBreakdowns(previousOutput, currentGame, Array.isArray(pickHistory?.entries) ? pickHistory.entries : [])
  };

  ensureNoUndefinedStrings(output);
  return output;
}

function buildReportMarkup(report, { mode = "email" } = {}) {
  const cardStyle = mode === "site"
    ? "background:#ffffff;border:1px solid #d9e1ee;border-radius:18px;padding:18px 20px;margin:0 0 18px 0;box-shadow:0 10px 24px rgba(15,23,42,0.06);"
    : "background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:16px 18px;margin:0 0 18px 0;";
  const smallLabel = "font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;font-weight:700;";
  const sectionTitle = (title) => `<h2 style="margin:0 0 12px 0;font-size:${mode === "site" ? "18px" : "17px"};line-height:1.25;color:#111827;">${String(title || "").replace(/^#+\s*/, "")}</h2>`;
  const valueCell = (value) => value == null || value === "" ? "N/A" : value;
  const wrapSection = (title, content) => `<section style="${cardStyle}">${sectionTitle(title)}${content}</section>`;
  const twoColStyle = mode === "site"
    ? "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;align-items:start;"
    : "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start;";
  const heatCell = (label, value, percentileOverride = null) => {
    const style = label === "WAR"
      ? reportWarCellStyle(value)
      : (() => {
        if (percentileOverride != null) return reportCellToneStyle(percentileOverride);
        const pct = reportMetricPct(label, value);
        return pct == null ? "background:#f3f4f6;color:#374151;border-radius:8px;" : reportCellToneStyle(pct);
      })();
    return `<span class="report-heat-pill" style="display:inline-block;min-width:56px;max-width:100%;padding:6px 8px;text-align:center;box-sizing:border-box;white-space:normal;${style}">${valueCell(value)}</span>`;
  };
  const renderKeyValueGrid = (items) => `
    <table style="width:100%;border-collapse:collapse;">
      <tbody>
        ${items.map((item) => `
          <tr>
            <td style="padding:8px 0;border-top:1px solid #f0f2f5;${smallLabel}width:34%;">${item.label}</td>
            <td style="padding:8px 0;border-top:1px solid #f0f2f5;font-size:14px;color:#111827;font-weight:600;">${valueCell(item.value)}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
  const renderComparisonTable = (rows, leftLabel, rightLabel) => `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr>
          <th style="text-align:left;padding:10px 8px;border-bottom:1px solid #dbe2ea;color:#6b7280;${smallLabel}">Metric</th>
          <th style="text-align:center;padding:10px 8px;border-bottom:1px solid #dbe2ea;color:#f97316;${smallLabel}">${leftLabel}</th>
          <th style="text-align:center;padding:10px 8px;border-bottom:1px solid #dbe2ea;color:#1f2937;${smallLabel}">${rightLabel}</th>
        </tr>
      </thead>
      <tbody>
        ${(rows || []).map((row) => `
          <tr>
            <td style="padding:9px 8px;border-bottom:1px solid #f0f2f5;color:#4b5563;font-weight:600;">${row.label}</td>
            <td style="padding:9px 8px;border-bottom:1px solid #f0f2f5;text-align:center;color:#111827;">${heatCell(row.label, row.mets)}</td>
            <td style="padding:9px 8px;border-bottom:1px solid #f0f2f5;text-align:center;color:#111827;">${heatCell(row.label, row.opp)}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
  const renderContextNote = (value, kind = "rank") => {
    if (!value) return `<span style="display:block;min-height:14px;"></span>`;
    const label = kind === "percentile" ? `${ordinalSuffix(value)} %ile` : `#${value} MLB`;
    return `<span style="display:block;min-height:14px;font-size:11px;line-height:1.15;color:#6b7280;font-weight:700;white-space:nowrap;">${label}</span>`;
  };
  const renderMetricStack = (label, value, contextValue = null, contextKind = "rank", align = "center") => `
    <div style="text-align:${align === "flex-start" ? "left" : align === "flex-end" ? "right" : "center"};padding:4px 0;">
      ${heatCell(label, value, contextKind === "percentile" ? contextValue : null)}
      ${renderContextNote(contextValue, contextKind)}
    </div>`;
  const renderEmailRecentStarts = (starts = []) => {
    if (!Array.isArray(starts) || !starts.length) return "";
    return `
      <div style="margin-top:14px;">
        <div style="${smallLabel}margin-bottom:8px;color:#6b7280;">Recent Starts</div>
        ${(starts.slice(0, 3)).map((start) => `
          <div style="padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;margin-bottom:8px;">
            <div style="font-size:13px;font-weight:700;color:#111827;line-height:1.35;">${valueCell(String(start.date || "").slice(5))} vs ${valueCell(start.opponent || "-")}</div>
            <div style="margin-top:4px;font-size:12px;line-height:1.4;color:#4b5563;">IP ${valueCell(start.ip || "-")} | ER ${valueCell(start.er ?? "-")} | K ${valueCell(start.k ?? "-")}${start.result ? ` | ${valueCell(start.result)}` : ""}</div>
          </div>
        `).join("")}
      </div>`;
  };
  const renderEmailMetricRow = (label, value, contextValue = null, contextKind = "percentile", side = "left") => `
    <tr>
      <td style="padding:8px 0 8px ${side === "left" ? "0" : "8px"};vertical-align:top;">
        <div style="${smallLabel}margin-bottom:4px;color:#6b7280;">${valueCell(label)}</div>
        <div>${heatCell(label, value)}</div>
        ${contextValue ? `<div style="margin-top:4px;font-size:11px;line-height:1.2;color:#6b7280;font-weight:700;white-space:normal;">${contextKind === "percentile" ? `${ordinalSuffix(contextValue)} %ile` : `#${contextValue} MLB`}</div>` : ""}
      </td>
    </tr>`;
  const renderEmailAdvancedBlock = (table) => {
    if (!table) return "";
    return `
      <div style="margin-top:14px;padding:12px;border:1px solid #d6dde8;border-radius:14px;background:#ffffff;">
        <div style="margin:0 0 10px 0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;font-weight:800;">${valueCell(table.title)}</div>
        ${(table.rows || []).map((row) => {
          const resolvedRank = row.rightRank ?? (row.rightRankKey ? report?.teamAdvanced?.[table.rightTeamKey || ""]?.leagueRanks?.[row.rightRankKey] : null);
          return `
            <div style="border:1px solid #e5e7eb;border-radius:12px;background:#f8fafc;margin-bottom:10px;overflow:hidden;">
              <div style="padding:8px 10px;border-bottom:1px solid #e5e7eb;background:#f3f6fb;color:#475569;text-align:center;font-size:11px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;">${valueCell(row.label)}</div>
              <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;table-layout:fixed;">
                <tr>
                  <td valign="top" style="width:50%;padding:10px;border-right:1px solid #e5e7eb;background:#f4f9ff;">
                    <div style="font-size:11px;line-height:1.2;color:#0f172a;font-weight:800;margin-bottom:6px;">${valueCell(table.leftHeader)}</div>
                    <div style="padding:8px 0;vertical-align:top;">
                      <div style="${smallLabel}margin-bottom:4px;color:#6b7280;">${valueCell(row.label)}</div>
                      <div>${heatCell(row.label, row.left)}</div>
                      ${row.leftPercentile != null ? `<div style="margin-top:4px;font-size:11px;line-height:1.2;color:#6b7280;font-weight:700;white-space:normal;">${ordinalSuffix(row.leftPercentile)} %ile</div>` : ""}
                    </div>
                  </td>
                  <td valign="top" style="width:50%;padding:10px;background:#fff7ef;">
                    <div style="font-size:11px;line-height:1.2;color:#7c2d12;font-weight:800;margin-bottom:6px;text-align:right;">${valueCell(table.rightHeader)}</div>
                    <div style="padding:8px 0 8px 8px;vertical-align:top;">
                      <div style="${smallLabel}margin-bottom:4px;color:#6b7280;">${valueCell(row.label)}</div>
                      <div>${heatCell(row.label, row.right)}</div>
                      ${resolvedRank != null ? `<div style="margin-top:4px;font-size:11px;line-height:1.2;color:#6b7280;font-weight:700;white-space:normal;">#${resolvedRank} MLB</div>` : ""}
                    </div>
                  </td>
                </tr>
              </table>
            </div>
          `;
        }).join("")}
      </div>`;
  };
  const renderEmailPitcherCard = (card, tables = []) => {
    if (!card) return "";
    const pitcherImageSrc = card?.image || card?.photoUrl || card?.headshot
      || (card?.mlbId ? `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_200,q_auto:best/v1/people/${card.mlbId}/headshot/67/current` : null);
    const photoHtml = pitcherImageSrc
      ? `<img src="${pitcherImageSrc}" alt="${valueCell(card.name)}" style="display:block;width:96px;height:96px;border-radius:16px;object-fit:cover;border:1px solid #d6dde8;background:#ffffff;margin:0 auto;">`
      : `<div style="width:96px;height:96px;border-radius:16px;border:1px solid #d6dde8;background:#f3f4f6;color:#94a3b8;text-align:center;line-height:96px;font-size:32px;margin:0 auto;">&#9918;</div>`;
    const statTile = (label, value) => `
      <td valign="top" style="width:50%;padding:0 4px 8px 4px;">
        <div style="border:1px solid #d6dde8;border-radius:10px;background:#f8fafc;padding:8px 9px;">
          <div style="${smallLabel}margin-bottom:4px;color:#6b7280;">${label}</div>
          <div>${heatCell(label, value)}</div>
        </div>
      </td>`;
    return `
      <div class="email-pitcher-card" style="margin-bottom:18px;border:1px solid #d9e1ee;border-radius:18px;background:#ffffff;padding:16px;">
        <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;">
          <tr>
            <td align="center" style="padding:0 0 12px 0;">${photoHtml}</td>
          </tr>
          <tr>
            <td align="center" style="padding:0;">
              <div style="font-size:22px;line-height:1.2;font-weight:800;color:#111827;">${valueCell(card.name)}</div>
              <div style="margin-top:6px;font-size:13px;line-height:1.4;color:#4b5563;font-weight:700;">${valueCell(card.teamLabel)}${card.hand ? ` | ${valueCell(card.hand)}` : ""}${card.record ? ` | Record ${valueCell(card.record)}` : ""}</div>
            </td>
          </tr>
        </table>
        <div style="margin-top:14px;">
          <div style="${smallLabel}margin-bottom:8px;color:#6b7280;">Traditional Stats</div>
          <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;table-layout:fixed;">
            <tr>
              ${statTile("ERA", card.stats?.era)}
              ${statTile("WHIP", card.stats?.whip)}
            </tr>
            <tr>
              ${statTile("K%", card.stats?.kPct)}
              ${statTile("BB%", card.stats?.bbPct)}
            </tr>
          </table>
        </div>
        ${tables.map((table) => renderEmailAdvancedBlock(table)).join("")}
        ${renderEmailRecentStarts(card.recentStarts)}
      </div>`;
  };
  const renderAdvancedSheetTable = (table) => {
    if (mode === "email") {
      return `
        <div class="report-sheet-table-wrap" style="width:100%;">
          <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;border:1px solid #d6dde8;background:#ffffff;">
            <tr>
              <td style="padding:9px 10px;border-bottom:1px solid #d6dde8;background:#e9f3ff;color:#0f172a;text-align:left;font-size:12px;font-weight:800;">${valueCell(table.leftHeader)}</td>
              <td style="padding:9px 10px;border-bottom:1px solid #d6dde8;background:#fdf1e5;color:#7c2d12;text-align:right;font-size:12px;font-weight:800;">${valueCell(table.rightHeader)}</td>
            </tr>
          </table>
          ${(table.rows || []).map((row) => {
            const resolvedRank = row.rightRank ?? (row.rightRankKey ? report?.teamAdvanced?.[table.rightTeamKey || ""]?.leagueRanks?.[row.rightRankKey] : null);
            return `
              <div class="email-adv-row" style="width:100%;border:1px solid #d6dde8;border-top:none;background:#ffffff;">
                <div class="email-adv-label" style="padding:8px 10px;border-bottom:1px solid #e5e7eb;background:#f8fafc;color:#475569;text-align:center;font-size:11px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;">${valueCell(row.label)}</div>
                <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;table-layout:fixed;">
                  <tr>
                    <td class="email-adv-side" valign="top" style="width:50%;padding:9px 8px;border-right:1px solid #e5e7eb;background:#f4f9ff;text-align:left;vertical-align:middle;">${renderMetricStack(row.label, row.left, row.leftPercentile ?? null, "percentile", "flex-start")}</td>
                    <td class="email-adv-side" valign="top" style="width:50%;padding:9px 8px;background:#fff7ef;text-align:right;vertical-align:middle;">${renderMetricStack(row.label, row.right, resolvedRank, "rank", "flex-end")}</td>
                  </tr>
                </table>
              </div>
            `;
          }).join("")}
        </div>`;
    }
    return `
      <div class="report-sheet-table-wrap" style="width:100%;overflow:hidden;-webkit-overflow-scrolling:touch;">
      <table class="report-sheet-table report-advanced-table" style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #d6dde8;background:#ffffff;table-layout:fixed;">
        <thead>
          <tr>
            <th style="width:33%;padding:9px 10px;border-bottom:1px solid #d6dde8;background:#e9f3ff;color:#0f172a;text-align:left;font-weight:800;">${valueCell(table.leftHeader)}</th>
            <th style="width:34%;padding:9px 10px;border-bottom:1px solid #d6dde8;background:#f8fafc;color:#475569;text-align:center;font-weight:800;">${valueCell(table.season || report.startingPitchersComparison?.seasonLabel)}</th>
            <th style="width:33%;padding:9px 10px;border-bottom:1px solid #d6dde8;background:#fdf1e5;color:#7c2d12;text-align:right;font-weight:800;">${valueCell(table.rightHeader)}</th>
          </tr>
        </thead>
        <tbody>
          ${(table.rows || []).map((row) => {
            const resolvedRank = row.rightRank ?? (row.rightRankKey ? report?.teamAdvanced?.[table.rightTeamKey || ""]?.leagueRanks?.[row.rightRankKey] : null);
            return `
            <tr>
              <td style="width:33%;padding:8px 10px;border-bottom:1px solid #d6dde8;background:#f4f9ff;text-align:left;vertical-align:middle;">${renderMetricStack(row.label, row.left, row.leftPercentile ?? null, "percentile", "flex-start")}</td>
              <td style="width:34%;padding:8px 10px;border-bottom:1px solid #d6dde8;background:#ffffff;color:#475569;text-align:center;font-weight:700;vertical-align:middle;">${valueCell(row.label)}</td>
              <td style="width:33%;padding:8px 10px;border-bottom:1px solid #d6dde8;background:#fff7ef;text-align:right;vertical-align:middle;">${renderMetricStack(row.label, row.right, resolvedRank, "rank", "flex-end")}</td>
            </tr>
          `;}).join("")}
        </tbody>
      </table>
      </div>`;
  };
  const renderSummarySheetTable = (rows, headers = null) => `
    <div class="report-sheet-table-wrap" style="width:100%;overflow:${mode === "site" ? "hidden" : "auto"};-webkit-overflow-scrolling:touch;">
    <table class="report-sheet-table report-summary-table" style="width:100%;height:100%;border-collapse:collapse;font-size:${mode === "site" ? "14px" : "13px"};border:1px solid #d6dde8;background:#ffffff;table-layout:fixed;">
      ${headers ? `
        <thead>
          <tr>
            ${headers.map((header) => `<th style="${header.style}">${valueCell(header.label)}</th>`).join("")}
          </tr>
        </thead>` : ""}
      <tbody>
        ${(rows || []).map((row) => `
          <tr>
            ${row.map((cell) => `<td style="${cell.style}">${valueCell(cell.value)}</td>`).join("")}
          </tr>`).join("")}
      </tbody>
    </table>
    </div>`;
  const renderSingleSideTable = (rows, heading, teamColor) => `
    <div class="card full-card" style="padding:1.05rem 1.1rem;">
      <div style="${smallLabel}color:${teamColor};margin-bottom:0.65rem;">${heading}</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px 6px;border-bottom:1px solid #dbe2ea;${smallLabel}">Metric</th>
            <th style="text-align:right;padding:8px 6px;border-bottom:1px solid #dbe2ea;${smallLabel}">Value</th>
          </tr>
        </thead>
        <tbody>
          ${(rows || []).map((row) => `
            <tr>
              <td style="padding:8px 6px;border-bottom:1px solid #f0f2f5;color:#4b5563;font-weight:600;">${row.label}</td>
              <td style="padding:8px 6px;border-bottom:1px solid #f0f2f5;text-align:right;">${heatCell(row.label, row.value ?? row.mets)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  const renderLineupTable = (mets = [], opp = []) => {
    const oppLabel = report.teamComparison?.oppHeader || report.game?.opponent || "Opponent";
    if (mode === "email") {
      const simpleLineupTable = (players, label, bgHeader, bgRow) => {
        if (!players.length) return "";
        return `
          <div style="margin-bottom:16px;">
            <div style="padding:8px 10px;background:${bgHeader};color:#0f172a;font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;border-radius:8px 8px 0 0;border:1px solid #d6dde8;">${label}</div>
            <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px;border:1px solid #d6dde8;border-top:none;">
              <thead>
                <tr>
                  <th style="width:8%;padding:7px 6px;border-bottom:1px solid #d6dde8;background:#f8fafc;text-align:center;font-size:10px;font-weight:700;color:#6b7280;">#</th>
                  <th style="width:36%;padding:7px 6px;border-bottom:1px solid #d6dde8;background:#f8fafc;text-align:left;font-size:10px;font-weight:700;color:#6b7280;">Player</th>
                  <th style="width:18%;padding:7px 6px;border-bottom:1px solid #d6dde8;background:#f8fafc;text-align:center;font-size:10px;font-weight:700;color:#6b7280;">xBA</th>
                  <th style="width:18%;padding:7px 6px;border-bottom:1px solid #d6dde8;background:#f8fafc;text-align:center;font-size:10px;font-weight:700;color:#6b7280;">K%</th>
                  <th style="width:20%;padding:7px 6px;border-bottom:1px solid #d6dde8;background:#f8fafc;text-align:center;font-size:10px;font-weight:700;color:#6b7280;">Hard Hit</th>
                </tr>
              </thead>
              <tbody>
                ${players.map((p, i) => `
                  <tr>
                    <td style="padding:7px 6px;border-bottom:1px solid #d6dde8;background:${bgRow};text-align:center;color:#6b7280;font-weight:700;">${valueCell(p.order ?? i + 1)}</td>
                    <td style="padding:7px 6px;border-bottom:1px solid #d6dde8;background:${bgRow};font-weight:700;color:#111827;">${valueCell(p.name)}</td>
                    <td style="padding:7px 6px;border-bottom:1px solid #d6dde8;background:${bgRow};text-align:center;">${heatCell("xBA", p.savant?.xBA || null)}</td>
                    <td style="padding:7px 6px;border-bottom:1px solid #d6dde8;background:${bgRow};text-align:center;">${heatCell("K%", p.savant?.kPct || p.fangraphs?.kPct || null)}</td>
                    <td style="padding:7px 6px;border-bottom:1px solid #d6dde8;background:${bgRow};text-align:center;">${heatCell("Hard Hit %", p.savant?.hardHitPct || null)}</td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>`;
      };
      return simpleLineupTable(mets, "New York Mets", "#e9f3ff", "#f4f9ff")
           + simpleLineupTable(opp, oppLabel, "#fdf1e5", "#fff7ef");
    }
    const lineupHeadshot = (player) => {
      const pid = player?.playerId || player?.id || player?.mlbId || 0;
      if (!pid) return "";
      const photoSize = mode === "site" ? 30 : 24;
      return `<img src="https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_60,q_auto:best/v1/people/${pid}/headshot/67/current" alt="${valueCell(player?.name)}" style="width:${photoSize}px;height:${photoSize}px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1px solid #d6dde8;background:#ffffff;">`;
    };
    const lineupNameCell = (player, side) => {
      if (mode === "email") return `<span style="font-weight:700;">${valueCell(player?.name)}</span>`;
      return `<div style="display:flex;align-items:center;gap:8px;min-width:0;">
        ${lineupHeadshot(player)}
        <span style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${valueCell(player?.name)}</span>
      </div>`;
    };
    const maxRows = Math.max(mets.length, opp.length, 9);
    const rows = [];
    for (let i = 0; i < maxRows; i += 1) {
      const m = mets[i] || {};
      const o = opp[i] || {};
      rows.push(`
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#f4f9ff;color:#111827;text-align:left;white-space:nowrap;">${lineupNameCell(m, "mets")}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#f4f9ff;text-align:center;">${heatCell("xBA", m.savant?.xBA || null)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#f4f9ff;text-align:center;">${heatCell("K%", m.savant?.kPct || m.fangraphs?.kPct || null)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#f4f9ff;text-align:center;">${heatCell("Hard Hit %", m.savant?.hardHitPct || null)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#f4f9ff;text-align:center;">${heatCell("WAR", m.fangraphs?.war || null)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#ffffff;color:#475569;text-align:center;font-weight:800;">${valueCell(m.order ?? o.order ?? i + 1)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#fff7ef;color:#111827;text-align:left;white-space:nowrap;">${lineupNameCell(o, "opp")}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#fff7ef;text-align:center;">${heatCell("xBA", o.savant?.xBA || null)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#fff7ef;text-align:center;">${heatCell("K%", o.savant?.kPct || o.fangraphs?.kPct || null)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#fff7ef;text-align:center;">${heatCell("Hard Hit %", o.savant?.hardHitPct || null)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#fff7ef;text-align:center;">${heatCell("WAR", o.fangraphs?.war || null)}</td>
        </tr>`);
    }
    const mobileCards = Array.from({ length: maxRows }, (_, i) => {
      const m = mets[i] || {};
      const o = opp[i] || {};
      const order = valueCell(m.order ?? o.order ?? i + 1);
      const sideBlock = (title, player, sideBg) => `
        <div style="flex:1 1 0;min-width:0;padding:10px;border:1px solid #d6dde8;border-radius:12px;background:${sideBg};">
          <div style="${smallLabel}margin-bottom:8px;color:#475569;">${title}</div>
          <div style="display:flex;align-items:center;gap:8px;min-width:0;margin-bottom:10px;">
            ${lineupHeadshot(player)}
            <div style="min-width:0;">
              <div style="font-weight:800;color:#111827;white-space:normal;line-height:1.25;">${valueCell(player?.name)}</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;">
            <div><div style="${smallLabel}margin-bottom:4px;">xBA</div>${heatCell("xBA", player.savant?.xBA || null)}</div>
            <div><div style="${smallLabel}margin-bottom:4px;">K%</div>${heatCell("K%", player.savant?.kPct || player.fangraphs?.kPct || null)}</div>
            <div><div style="${smallLabel}margin-bottom:4px;">Hard Hit</div>${heatCell("Hard Hit %", player.savant?.hardHitPct || null)}</div>
            <div><div style="${smallLabel}margin-bottom:4px;">WAR</div>${heatCell("WAR", player.fangraphs?.war || null)}</div>
          </div>
        </div>`;
      return `
        <article class="report-lineup-mobile-card" style="border:1px solid #d6dde8;border-radius:14px;background:#ffffff;padding:12px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;">
            <div style="${smallLabel}color:#6b7280;">Order ${order}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            ${sideBlock("New York Mets", m, "#f4f9ff")}
            ${sideBlock(oppLabel, o, "#fff7ef")}
          </div>
        </article>`;
    }).join("");
    return `
      ${mode === "site" ? `<div class="report-lineup-mobile" style="display:none;">${mobileCards}</div>` : ""}
      <div class="report-lineup-wrap" style="overflow-x:${mode === "site" ? "hidden" : "auto"};-webkit-overflow-scrolling:touch;">
        <table class="report-lineup-table" style="width:100%;${mode === "site" ? "" : "min-width:960px;"}border-collapse:collapse;font-size:${mode === "site" ? "12px" : "11px"};border:1px solid #d6dde8;table-layout:${mode === "site" ? "fixed" : "auto"};">
          <thead>
            <tr>
              <th colspan="5" style="padding:10px 8px;text-align:left;border-bottom:1px solid #d6dde8;background:#e9f3ff;color:#0f172a;${smallLabel}">New York Mets</th>
              <th style="padding:10px 8px;text-align:center;border-bottom:1px solid #d6dde8;background:#f8fafc;color:#475569;${smallLabel}">Order</th>
              <th colspan="5" style="padding:10px 8px;text-align:left;border-bottom:1px solid #d6dde8;background:#fdf1e5;color:#7c2d12;${smallLabel}">${oppLabel}</th>
            </tr>
            <tr>
              <th style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#f4f9ff;${smallLabel}text-align:left;">Mets Player</th>
              <th style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#f4f9ff;${smallLabel}text-align:center;">xBA</th>
              <th style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#f4f9ff;${smallLabel}text-align:center;">K%</th>
              <th style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#f4f9ff;${smallLabel}text-align:center;">Hard Hit %</th>
              <th style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#f4f9ff;${smallLabel}text-align:center;">WAR</th>
              <th style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#ffffff;${smallLabel}text-align:center;">Order</th>
              <th style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#fff7ef;${smallLabel}text-align:left;">Opponent Player</th>
              <th style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#fff7ef;${smallLabel}text-align:center;">xBA</th>
              <th style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#fff7ef;${smallLabel}text-align:center;">K%</th>
              <th style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#fff7ef;${smallLabel}text-align:center;">Hard Hit %</th>
              <th style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#fff7ef;${smallLabel}text-align:center;">WAR</th>
            </tr>
          </thead>
          <tbody>${rows.join("")}</tbody>
        </table>
      </div>`;
  };
  const renderBulletList = (items = []) => `<ul style="margin:8px 0 0 18px;padding:0;color:#111827;">${items.map((item) => `<li style="margin:0 0 8px 0;">${item}</li>`).join("")}</ul>`;
  const renderPitcherCard = (card) => {
    if (!card) return "";
    const pitcherImageSrc = card.mlbId
      ? (mode === "site"
          ? `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:action:hero:current.png/w_360,q_auto:best/v1/people/${card.mlbId}/action/hero/current`
          : `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_200,q_auto:best/v1/people/${card.mlbId}/headshot/67/current`)
      : null;
    const photoHtml = pitcherImageSrc
      ? `<img class="pitcher-photo-sm" src="${pitcherImageSrc}" alt="${card.name}">`
      : `<div class="pitcher-photo-placeholder">&#9918;</div>`;
    const MLB_AVG_VALUES = {
      'ERA': 4.20, 'WHIP': 1.28, 'K%': 22.5, 'BB%': 8.2, 'FIP': 4.10, 'xERA': 4.05
    };
    const statBar = (label, value) => {
      const pct = reportMetricPct(label, value);
      const color = pct == null ? "#d1d5db" : reportPctlColor(pct);
      const shown = valueCell(value);
      const avgVal = MLB_AVG_VALUES[label];
      const pctileLabel = pct != null ? `${pct}th %ile` : '';
      const avgMarker = avgVal != null
        ? `<div class="sbar-avg-marker" style="left:50%;">
             <div class="sbar-avg-line"></div>
             <span class="sbar-avg-label">Avg: ${avgVal}</span>
           </div>`
        : '';
      return `<div class="sbar-row">
        <span class="sbar-label">${label}</span>
        <div class="sbar-track-wrap">
          <div class="sbar-track">
            <div class="sbar-fill" style="width:${pct == null ? 0 : pct}%;background:${color};"></div>
            ${avgMarker}
          </div>
          ${pctileLabel ? `<span class="sbar-pctile">${pctileLabel}</span>` : ''}
        </div>
        <span class="sbar-val">${shown}</span>
      </div>`;
    };
    return `<div class="pitcher-card-v2">
      <div class="pitcher-img-panel">${photoHtml}</div>
      <div class="pitcher-stats-panel">
        <div class="pitcher-name-row">
          <span class="pitcher-name-lg">${card.name}</span>
          ${card.record ? `<span class="pitcher-record-tag">Record ${card.record}</span>` : ""}
        </div>
        <div class="pitcher-meta-line"><span class="pitcher-team-tag">${card.teamLabel}</span>${card.hand ? ` &middot; ${card.hand}` : ""}</div>
        <div class="sbar-section-label">Traditional</div>
        ${statBar("ERA", card.stats?.era)}
        ${statBar("WHIP", card.stats?.whip)}
        ${statBar("K%", card.stats?.kPct)}
        ${statBar("BB%", card.stats?.bbPct)}
        ${formatRecentStartsCompact(card.recentStarts)}
      </div>
    </div>`;
  };
  const renderPitcherColumn = (card, tables = []) => `
    <div class="report-pitcher-col" style="display:flex;flex-direction:column;gap:${mode === "site" ? "14px" : "12px"};min-width:0;">
      ${renderPitcherCard(card)}
      ${tables.map((table) => `
        <div style="display:flex;flex-direction:column;gap:8px;min-width:0;">
          <div style="margin:0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;font-weight:800;">${valueCell(table.title)}</div>
          ${renderAdvancedSheetTable(table)}
        </div>`).join("")}
    </div>`;
  const schedulingRow = report.meta?.schedulingSpot;
  const matchupHeaders = [
    { label: report.teamComparison?.metsHeader || "New York Mets", style: "width:36%;padding:10px 12px;border-bottom:1px solid #d6dde8;background:#e9f3ff;color:#0f172a;text-align:left;font-weight:800;" },
    { label: "Category", style: "width:28%;padding:10px 12px;border-bottom:1px solid #d6dde8;background:#f8fafc;color:#475569;text-align:center;font-weight:700;" },
    { label: report.teamComparison?.oppHeader || "Opponent", style: "width:36%;padding:10px 12px;border-bottom:1px solid #d6dde8;background:#fdf1e5;color:#7c2d12;text-align:right;font-weight:800;" }
  ];
  const matchupRows = (report.teamComparison?.rows || []).map((row) => ([
    { value: row.mets, style: "padding:10px 12px;border-bottom:1px solid #d6dde8;background:#f4f9ff;color:#111827;font-weight:800;" },
    { value: row.label, style: "padding:10px 12px;border-bottom:1px solid #d6dde8;background:#ffffff;color:#475569;text-align:center;font-weight:700;" },
    { value: row.opp, style: "padding:10px 12px;border-bottom:1px solid #d6dde8;background:#fff7ef;color:#111827;text-align:right;font-weight:800;" }
  ]));
  const pitcherTables = report.startingPitchersComparison?.advancedMatchupTables || [];
  const metsPitcherTables = [pitcherTables[0], pitcherTables[2]].filter(Boolean);
  const oppPitcherTables = [pitcherTables[1], pitcherTables[3]].filter(Boolean);
  const pitcherComparisonMarkup = mode === "site"
    ? `<div class="report-two-col report-pitcher-grid" style="${twoColStyle}">
        ${renderPitcherColumn(report.startingPitchersComparison?.metsCard, metsPitcherTables)}
        ${renderPitcherColumn(report.startingPitchersComparison?.oppCard, oppPitcherTables)}
      </div>`
    : `<table role="presentation" width="100%" style="width:100%;border-collapse:separate;border-spacing:0;">
        <tr>
          <td class="email-stack-col" valign="top" style="width:100%;padding:0 0 16px 0;">${renderEmailPitcherCard(report.startingPitchersComparison?.metsCard, metsPitcherTables)}</td>
        </tr>
        <tr>
          <td class="email-stack-col" valign="top" style="width:100%;padding:0;">${renderEmailPitcherCard(report.startingPitchersComparison?.oppCard, oppPitcherTables)}</td>
        </tr>
      </table>`;

  return `
    ${wrapSection("Matchup Details", renderSummarySheetTable(matchupRows, matchupHeaders))}

    ${wrapSection("Starting Pitchers Comparison", pitcherComparisonMarkup)}

    ${wrapSection("Projected Lineup Comparison", renderLineupTable(report.projectedLineupComparison?.mets || [], report.projectedLineupComparison?.opp || []))}

    ${wrapSection("Game Analysis", `
      <div style="${smallLabel}margin-bottom:6px;">Why the Mets have a case</div>
      ${renderBulletList(report.analysis?.whyMetsHaveACase || [])}
      <div style="${smallLabel}margin:12px 0 6px 0;">Where the risk is</div>
      ${renderBulletList(report.analysis?.whereTheRiskIs || [])}
      <div style="${smallLabel}margin:12px 0 6px 0;">Bottom line</div>
      <p style="margin:0;color:#374151;">${valueCell(report.analysis?.bottomLine)}</p>
    `)}

    ${wrapSection("Official MetsMoneyline Pick", `
      <p style="margin:0 0 8px 0;font-size:20px;font-weight:800;color:#f97316;">${valueCell(report.officialPick?.label)}</p>
      <p style="margin:0;color:#374151;">${valueCell(report.officialPick?.explanation)}</p>
    `)}`;
}

function buildEmailHtml(game) {
  const report = game?.writeup?.report || buildPresentationReport(game);
  if (!report) throw new Error("[buildEmailHtml] report is null — buildPresentationReport returned nothing");
  if (!report.header) console.warn("[buildEmailHtml] WARNING: report.header is missing — email banner will be blank");
  if (!report.startingPitchersComparison) console.warn("[buildEmailHtml] WARNING: report.startingPitchersComparison is missing");
  if (!report.projectedLineupComparison) console.warn("[buildEmailHtml] WARNING: report.projectedLineupComparison is missing");

  const reportMarkup = buildReportMarkup(report, { mode: "email" });
  if (!reportMarkup || reportMarkup.trim().length < 500) {
    throw new Error(`[buildEmailHtml] reportMarkup is too short (${reportMarkup?.length ?? 0} chars) — buildReportMarkup produced nothing`);
  }

  return `<style>
      @media only screen and (max-width: 700px) {
        .email-shell { width:100% !important; }
        .email-pad { padding:16px !important; }
        .report-pitcher-col { margin-bottom:14px !important; }
        .email-stack-col { display:block !important; width:100% !important; padding:0 0 12px 0 !important; }
        .report-sheet-table { width:100% !important; table-layout:fixed !important; }
        .report-sheet-table th, .report-sheet-table td { padding:6px 5px !important; font-size:11px !important; line-height:1.25 !important; }
        .report-heat-pill { min-width:0 !important; max-width:100% !important; padding:5px 4px !important; font-size:11px !important; line-height:1.25 !important; }
        .report-banner-logo { width:72px !important; height:72px !important; }
        .report-banner-vs { font-size:18px !important; }
        .pitcher-img-panel, .pitcher-stats-panel { display:block !important; width:100% !important; }
        .pitcher-stats-panel { padding-top:12px !important; }
        .email-adv-label { padding:7px 8px !important; font-size:10px !important; line-height:1.2 !important; }
        .email-adv-side { display:block !important; width:100% !important; padding:8px 6px !important; }
      }
    </style>
    <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;border-spacing:0;background:#eef2f7;font-family:Arial,sans-serif;color:#111827;line-height:1.55;">
      <tr>
        <td align="center" style="padding:18px 10px;">
          <table role="presentation" width="100%" class="email-shell" style="width:100%;max-width:600px;border-collapse:collapse;border-spacing:0;background:#ffffff;border:1px solid #dde4ef;border-radius:20px;overflow:hidden;">
            <tr>
              <td class="email-pad" style="padding:22px 24px;">
                <p style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;margin:0 0 12px 0;">MetsMoneyline</p>
                <div style="margin:0 0 18px 0;background:linear-gradient(180deg,#ffffff 0%,#f7faff 100%);border:1px solid #d9e1ee;border-radius:20px;padding:18px 16px;text-align:center;">
                  <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;border-spacing:0;">
                    <tr>
                      <td align="center" style="width:40%;padding:0 6px;">
                        <img class="report-banner-logo" src="${report.header?.metsLogoUrl || "https://www.mlbstatic.com/team-logos/121.svg"}" alt="New York Mets" style="display:block;border:0;width:96px;height:96px;object-fit:contain;margin:0 auto;">
                      </td>
                      <td align="center" class="report-banner-vs" style="width:20%;font-size:20px;font-weight:900;letter-spacing:0.08em;text-transform:uppercase;color:#a9b4c7;">vs</td>
                      <td align="center" style="width:40%;padding:0 6px;">
                        <img class="report-banner-logo" src="${report.header?.oppLogoUrl || "https://www.mlbstatic.com/team-logos/generic.svg"}" alt="${game.opponent || "Opponent"}" style="display:block;border:0;width:96px;height:96px;object-fit:contain;margin:0 auto;">
                      </td>
                    </tr>
                  </table>
                  <p style="margin:12px 0 0 0;color:#5b6477;font-size:14px;line-height:1.5;">${report.header?.metadataLine || [report.header?.date || game.date, report.header?.time || game.time, report.header?.ballpark || game.ballpark, report.meta?.weatherSummary].filter(Boolean).join(" | ")}</p>
                </div>
                ${game.writeup?.preliminaryMeta?.enabled ? `<div style="margin:0 0 18px 0;padding:14px 16px;border:1px solid #f59e0b;background:#fff7ed;color:#7c2d12;border-radius:12px;font-size:14px;font-weight:600;">${game.writeup.preliminaryMeta.note || "This is a preliminary report. A final updated report will be sent when official lineups are confirmed."}</div>` : ""}
                ${reportMarkup}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
}

function buildSiteReportHtml(game) {
  const report = game?.writeup?.report || buildPresentationReport(game);
  const reportMarkup = buildReportMarkup(report, { mode: "site" });
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${report.header?.title || "MetsMoneyline Report"}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
    <link rel="icon" type="image/jpeg" href="favicon.jpg">
    <link rel="stylesheet" href="css/styles.css">
    <style>
      html, body { max-width:100%; overflow-x:hidden; }
      @media (max-width: 980px) {
        .report-main { width:100% !important; padding:1.25rem 0.85rem 0 !important; }
        .report-banner { padding:1.2rem 0.95rem !important; }
        .report-banner-logo { width:88px !important; height:88px !important; }
        .report-two-col { grid-template-columns:1fr !important; }
      }
      @media (max-width: 640px) {
        .report-main { padding:0.9rem 0.55rem 0 !important; }
        .report-banner { border-radius:18px !important; }
        .report-banner-logo { width:72px !important; height:72px !important; }
        .report-banner > div:first-child { gap:12px !important; }
        .report-banner > div:first-child > div { min-width:0 !important; }
        .report-banner p { font-size:0.88rem !important; line-height:1.45 !important; word-break:break-word; }
        .report-sheet-table-wrap, .report-lineup-wrap { margin:0; width:100%; overflow:hidden !important; }
        .report-sheet-table { width:100% !important; table-layout:fixed !important; }
        .report-summary-table th, .report-summary-table td { padding:8px 6px !important; font-size:12px !important; word-break:break-word; }
        .report-advanced-table th, .report-advanced-table td { padding:6px 5px !important; font-size:11px !important; word-break:break-word; }
        .report-heat-pill { min-width:0 !important; width:100%; padding:5px 4px !important; font-size:11px !important; text-align:center; }
        .report-lineup-wrap { display:none !important; }
        .report-lineup-mobile { display:grid !important; gap:12px !important; }
        .report-pitcher-col { gap:12px !important; }
        .pitcher-card-v2 { grid-template-columns:1fr !important; }
        .pitcher-img-panel { min-height:160px !important; }
        .pitcher-photo-sm { max-height:180px !important; object-fit:contain !important; }
        .pitcher-stats-panel { padding:14px !important; }
        .sbar-row { grid-template-columns:54px 1fr 44px !important; column-gap:6px !important; }
        .sbar-label, .sbar-val, .sbar-pct { font-size:11px !important; }
      }
    </style>
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5946778263750869" crossorigin="anonymous"></script>
  </head>
  <body>
    <div class="alert-banner">Live 2026 season mode &mdash; stats and records are current-season only</div>
    <header>
      <nav>
        <a href="/" class="nav-brand">
          <span class="brand-mets">METS</span><span class="brand-mono">MONEYLINE</span>
        </a>
        <button class="nav-hamburger" aria-label="Toggle menu" aria-expanded="false">
          <span></span><span></span><span></span>
        </button>
        <ul class="nav-links">
          <li><a href="/" class="nav-link">Game Day</a></li>
          <li><a href="report.html" class="nav-link active">Today's Report</a></li>
          <li><a href="advanced-stats.html" class="nav-link">Stats &amp; Standings</a></li>
          <li><a href="betting-history.html" class="nav-link">History</a></li>
          <li><a href="news.html" class="nav-link">Team News</a></li>
        </ul>
      </nav>
    </header>
    <main class="report-main" style="width:min(96vw,1440px);max-width:1440px;margin:0 auto;padding:2.5rem 1.25rem 0;">
      <section class="report-banner" style="margin-bottom:1.75rem;background:linear-gradient(180deg,#ffffff 0%,#f7faff 100%);border:1px solid #d9e1ee;border-radius:22px;padding:1.6rem 1.25rem;box-shadow:0 10px 24px rgba(15,23,42,0.06);text-align:center;">
        <div style="display:flex;align-items:center;justify-content:center;gap:1.1rem;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;justify-content:center;min-width:140px;">
            <img class="report-banner-logo" src="${report.header?.metsLogoUrl || "https://www.mlbstatic.com/team-logos/121.svg"}" alt="New York Mets" style="width:112px;height:112px;object-fit:contain;">
          </div>
          <div style="font-size:1.45rem;font-weight:900;letter-spacing:0.08em;text-transform:uppercase;color:#a9b4c7;">vs</div>
          <div style="display:flex;align-items:center;justify-content:center;min-width:140px;">
            <img class="report-banner-logo" src="${report.header?.oppLogoUrl || ""}" alt="${game.opponent || "Opponent"}" style="width:112px;height:112px;object-fit:contain;">
          </div>
        </div>
        <p style="margin:0.9rem 0 0;color:#5b6477;font-size:0.96rem;line-height:1.5;">${report.header?.metadataLine || [report.header?.date || game.date, report.header?.time || game.time, report.header?.ballpark || game.ballpark, report.meta?.weatherSummary].filter(Boolean).join(" | ")}</p>
      </section>
      ${reportMarkup}
    </main>
    <footer>
      <div class="footer-brand">
        <span class="brand-mets">METS</span><span class="brand-mono">MONEYLINE</span>
      </div>
      <p class="footer-disclaimer">For entertainment purposes only. Always gamble responsibly.</p>
      <p class="footer-copy">&copy; 2026 MetsMoneyline. Not affiliated with the New York Mets or MLB.</p>
    </footer>
    <script>
      const hamburger = document.querySelector('.nav-hamburger');
      const navLinks = document.querySelector('.nav-links');
      if (hamburger && navLinks) {
        hamburger.addEventListener('click', () => {
          const open = navLinks.classList.toggle('open');
          hamburger.classList.toggle('open', open);
          hamburger.setAttribute('aria-expanded', open);
        });
        navLinks.querySelectorAll('.nav-link').forEach((link) => {
          link.addEventListener('click', () => {
            navLinks.classList.remove('open');
            hamburger.classList.remove('open');
            hamburger.setAttribute('aria-expanded', 'false');
          });
        });
      }
    </script>
  </body>
</html>`;
}

function clampReport(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

const REPORT_PCTL = {
  ERA: (v) => clampReport(Math.round(100 - ((parseFloat(v) - 2.50) / (5.80 - 2.50)) * 90), 5, 99),
  FIP: (v) => clampReport(Math.round(100 - ((parseFloat(v) - 2.80) / (5.40 - 2.80)) * 90), 5, 99),
  xERA: (v) => clampReport(Math.round(100 - ((parseFloat(v) - 2.70) / (5.30 - 2.70)) * 90), 5, 99),
  WHIP: (v) => clampReport(Math.round(100 - ((parseFloat(v) - 0.90) / (1.70 - 0.90)) * 90), 5, 99),
  KPct: (v) => clampReport(Math.round(((parseFloat(v) - 10) / (36 - 10)) * 95), 5, 99),
  BBPct: (v) => clampReport(Math.round(100 - ((parseFloat(v) - 3.5) / (13.5 - 3.5)) * 90), 5, 99),
  KBB: (v) => clampReport(Math.round(((parseFloat(v) - 1.2) / (6.0 - 1.2)) * 95), 5, 99),
  HardHit: (v) => clampReport(Math.round(100 - ((parseFloat(v) - 26) / (47 - 26)) * 90), 5, 99),
  Barrel: (v) => clampReport(Math.round(100 - ((parseFloat(v) - 2.5) / (16 - 2.5)) * 90), 5, 99),
  Chase: (v) => clampReport(Math.round(((parseFloat(v) - 18) / (38 - 18)) * 95), 5, 99),
  xwOBA: (v) => clampReport(Math.round(((parseFloat(v) - 0.260) / (0.380 - 0.260)) * 95), 5, 99),
  xSLG: (v) => clampReport(Math.round(((parseFloat(v) - 0.280) / (0.560 - 0.280)) * 95), 5, 99),
  xBA: (v) => clampReport(Math.round(((parseFloat(v) - 0.190) / (0.320 - 0.190)) * 95), 5, 99),
  WRCPlus: (v) => clampReport(Math.round(((parseFloat(v) - 70) / (140 - 70)) * 95), 5, 99),
  WAR: (v) => clampReport(Math.round(((parseFloat(v) + 1) / (4 + 1)) * 95), 5, 99)
};

function reportPctlColor(pct) {
  if (pct >= 80) return "#c0392b";
  if (pct >= 60) return "#e08060";
  if (pct >= 45) return "#aab8c8";
  if (pct >= 25) return "#5a9fd4";
  return "#1a6bb5";
}

function reportCellToneStyle(pct) {
  const bg = reportPctlColor(pct);
  const darkText = pct >= 45 && pct < 80;
  return `background:${bg};color:${darkText ? "#10213a" : "#ffffff"};font-weight:700;border-radius:8px;`;
}

function reportWarCellStyle(value) {
  const parsed = parseReportNumber(value);
  if (parsed == null) return "background:#f3f4f6;color:#374151;font-weight:700;border-radius:8px;";
  if (parsed === 0) return "background:transparent;color:#374151;font-weight:700;border-radius:8px;border:1px solid #d6dde8;";
  const magnitude = Math.min(Math.abs(parsed), 4);
  const alpha = 0.34 + ((magnitude / 4) * 0.54);
  if (parsed > 0) {
    return `background:rgba(192,57,43,${alpha.toFixed(3)});color:#ffffff;font-weight:800;border-radius:8px;box-shadow:inset 0 0 0 1px rgba(127,29,29,0.22);`;
  }
  return `background:rgba(26,107,181,${alpha.toFixed(3)});color:#ffffff;font-weight:800;border-radius:8px;box-shadow:inset 0 0 0 1px rgba(30,64,175,0.22);`;
}

function parseReportNumber(value) {
  if (value == null) return null;
  const normalized = String(value).replace(/<[^>]*>/g, "").replace(/[^0-9.\-]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function reportMetricPct(label, value) {
  const parsed = parseReportNumber(value);
  if (parsed == null) return null;
  switch (label) {
    case "ERA": return REPORT_PCTL.ERA(parsed);
    case "xERA": return REPORT_PCTL.xERA(parsed);
    case "FIP": return REPORT_PCTL.FIP(parsed);
    case "WHIP": return REPORT_PCTL.WHIP(parsed);
    case "K%": return REPORT_PCTL.KPct(parsed);
    case "BB%": return REPORT_PCTL.BBPct(parsed);
    case "K-BB%":
    case "K/BB": return REPORT_PCTL.KBB(parsed);
    case "Hard-Hit%": return REPORT_PCTL.HardHit(parsed);
    case "Hard Hit %": return REPORT_PCTL.HardHit(parsed);
    case "Barrel%": return REPORT_PCTL.Barrel(parsed);
    case "Barrel %": return REPORT_PCTL.Barrel(parsed);
    case "Whiff%": return REPORT_PCTL.KPct(parsed);
    case "Chase%": return REPORT_PCTL.Chase(parsed);
    case "Projected wRC+":
    case "Opponent Lineup wRC+": return REPORT_PCTL.WRCPlus(parsed);
    case "xwOBA":
    case "Opponent xwOBA":
    case "Lineup xwOBA": return REPORT_PCTL.xwOBA(parsed);
    case "xSLG":
    case "xSLG %":
    case "Lineup xSLG": return REPORT_PCTL.xSLG(parsed);
    case "xBA":
    case "Lineup xBA": return REPORT_PCTL.xBA(parsed);
    case "WAR": return REPORT_PCTL.WAR(parsed);
    case "Lineup WAR": return REPORT_PCTL.WAR(parsed);
    default: return null;
  }
}

function formatRecentStartsCompact(starts = []) {
  if (!Array.isArray(starts) || !starts.length) return "";
  const rows = starts.slice(0, 3).map((start) => `
    <tr>
      <td style="padding:6px 0;color:#6b7280;">${String(start.date || "").slice(5)}</td>
      <td style="padding:6px 0;color:#111827;">${start.opponent || "-"}</td>
      <td style="padding:6px 0;color:#111827;text-align:center;">${start.ip || "-"}</td>
      <td style="padding:6px 0;color:#111827;text-align:center;">${start.er ?? "-"}</td>
      <td style="padding:6px 0;color:#111827;text-align:center;">${start.k ?? "-"}</td>
    </tr>`).join("");
  return `
    <div class="compact-log-title" style="margin-top:1rem">Recent Starts</div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead>
        <tr>
          <th style="text-align:left;padding:6px 0;border-bottom:1px solid #e6ebf2;color:#9099b0;">Date</th>
          <th style="text-align:left;padding:6px 0;border-bottom:1px solid #e6ebf2;color:#9099b0;">Opp</th>
          <th style="text-align:center;padding:6px 0;border-bottom:1px solid #e6ebf2;color:#9099b0;">IP</th>
          <th style="text-align:center;padding:6px 0;border-bottom:1px solid #e6ebf2;color:#9099b0;">ER</th>
          <th style="text-align:center;padding:6px 0;border-bottom:1px solid #e6ebf2;color:#9099b0;">K</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function recentRecordFromGames(games, limit = 5) {
  const rows = Array.isArray(games) ? games.slice(0, limit) : [];
  let wins = 0;
  let losses = 0;
  for (const game of rows) {
    if (game?.result === "W" || game?.result === "win") wins += 1;
    else if (game?.result === "L" || game?.result === "loss") losses += 1;
  }
  return rows.length ? `${wins}-${losses}` : "N/A";
}

function extractSeasonIp(seasonLine, note) {
  const haystack = `${seasonLine || ""} ${note || ""}`;
  const match = haystack.match(/(\d+\.\d+)\s*IP/i);
  return match ? match[1] : null;
}

function sumProjectedLineupPa(lineup = []) {
  const total = (Array.isArray(lineup) ? lineup : []).reduce((sum, player) => {
    const pa = Number(player?.savant?.pa || 0);
    return sum + (Number.isFinite(pa) ? pa : 0);
  }, 0);
  return total > 0 ? String(total) : null;
}

function buildButtondownPayload(bodyHtml, { subject, status, bodyText = null, condensedMode = false }) {
  if (!bodyHtml || bodyHtml.trim().length < 1000) {
    throw new Error(`[buttondown] bodyHtml too short (${bodyHtml?.length ?? 0} chars) — refusing to build payload`);
  }
  if (bodyHtml.includes("codehilite")) {
    throw new Error("[buttondown] bodyHtml contains 'codehilite' — markdown processing leaked into HTML, refusing to send");
  }
  if (bodyHtml.includes("<pre><code>")) {
    throw new Error("[buttondown] bodyHtml contains <pre><code> — code block wrapping detected, refusing to send");
  }
  if (!/^\s*<(style|table|div)/i.test(bodyHtml)) {
    throw new Error(`[buttondown] bodyHtml does not start with <style>, <table>, or <div> — first 80 chars: ${bodyHtml.slice(0, 80)}`);
  }

  const plainText = String(bodyText || "").trim();

  if (condensedMode) {
    // In condensed mode we let Buttondown treat `body` as the full HTML payload.
    // This keeps behavior closest to "what we render is what subscribers see".
    return {
      subject,
      status,
      body: bodyHtml,
      email_type: "public"
    };
  }

  return {
    subject,
    status,
    body: plainText || bodyHtml,
    email_type: "public"
  };
}

function buildCondensedEmailHtml(game) {
  const report = game?.writeup?.report;
  const header = report?.header;
  const pick = report?.officialPick;
  const meta = header?.metadataLine || "";
  const matchup = `${header?.metsTeamLabel || "New York Mets"} vs ${header?.oppTeamLabel || game?.opponent || "Opponent"}`;
  const weather = header?.weatherLine || "";
  const metsLogo = header?.metsLogoUrl || "https://www.mlbstatic.com/team-logos/121.svg";
  const oppLogo = header?.oppLogoUrl || "";
  const oddsHome = report?.header?.oddsHomeLabel || "";
  const oddsAway = report?.header?.oddsAwayLabel || "";

  return `
  <div style="max-width:640px;margin:0 auto;padding:16px 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:#0b1120;color:#e5e7eb;">
    <div style="font-size:13px;color:#9ca3af;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.08em;">Today's Report</div>

    <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:10px;">
      <tr>
        <td style="width:64px;padding:0 8px 0 0;vertical-align:middle;">
          <img src="${metsLogo}" alt="Mets" style="display:block;width:52px;height:52px;object-fit:contain;border-radius:12px;background:#020617;">
        </td>
        <td style="text-align:center;vertical-align:middle;font-size:13px;color:#9ca3af;">vs</td>
        <td style="width:64px;padding:0 0 0 8px;vertical-align:middle;text-align:right;">
          ${oppLogo ? `<img src="${oppLogo}" alt="Opponent" style="display:block;width:52px;height:52px;object-fit:contain;border-radius:12px;background:#020617;">` : ""}
        </td>
      </tr>
    </table>

    <h1 style="margin:0 0 6px 0;font-size:20px;line-height:1.25;color:#f9fafb;">${matchup}</h1>
    <div style="font-size:13px;color:#9ca3af;margin-bottom:6px;">${meta}</div>
    ${weather ? `<div style="font-size:13px;color:#9ca3af;margin-bottom:10px;">${weather}</div>` : ""}

    ${(oddsHome || oddsAway) ? `
      <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 14px 0;font-size:12px;color:#e5e7eb;">
        <tr style="background:#020617;border-radius:10px;">
          <td style="padding:8px 8px 8px 10px;border:1px solid #1f2937;border-right:none;border-radius:10px 0 0 10px;">
            <div style="font-weight:600;color:#9ca3af;font-size:11px;margin-bottom:2px;">Mets</div>
            <div style="font-weight:700;">${oddsHome || ""}</div>
          </td>
          <td style="padding:8px;border:1px solid #1f2937;border-left:none;border-radius:0 10px 10px 0;text-align:right;">
            <div style="font-weight:600;color:#9ca3af;font-size:11px;margin-bottom:2px;">Opponent</div>
            <div style="font-weight:700;">${oddsAway || ""}</div>
          </td>
        </tr>
      </table>` : ""}

    <div style="padding:12px 12px;border-radius:12px;background:linear-gradient(135deg,#0f766e,#22c55e);color:#ecfdf5;margin-bottom:14px;">
      <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;opacity:0.9;">Official Pick</div>
      <div style="margin-top:4px;font-size:18px;font-weight:800;">${pick?.label || "See full report"}</div>
      ${pick?.confidence != null ? `<div style="margin-top:4px;font-size:12px;opacity:0.9;">Confidence: ${pick.confidence}/10</div>` : ""}
      ${report?.analyticalLean ? `<div style="margin-top:6px;font-size:13px;line-height:1.5;">${report.analyticalLean}</div>` : ""}
    </div>

    ${report?.quickRead ? `
      <div style="margin-bottom:14px;padding:10px 12px;border-radius:10px;background:#020617;border:1px solid #1f2937;">
        <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;margin-bottom:4px;">Why this angle?</div>
        <div style="font-size:13px;line-height:1.6;color:#e5e7eb;">${report.quickRead}</div>
      </div>` : ""}

    <div style="margin-bottom:10px;">
      <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;margin-bottom:4px;">Edge snapshot</div>
      <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.6;color:#e5e7eb;">
        ${report?.pitchingEdgeSummary ? `<li>${report.pitchingEdgeSummary}</li>` : ""}
        ${report?.projectedLineupEdgeSummary ? `<li>${report.projectedLineupEdgeSummary}</li>` : ""}
        ${report?.edgeSummary ? `<li>${report.edgeSummary}</li>` : ""}
      </ul>
    </div>

    <div style="margin-top:18px;font-size:12px;color:#94a3b8;">
      View the full report with matchup tables and charts:
      <a href="https://metsmoneyline.com/report" style="color:#38bdf8;text-decoration:none;">Open Today&rsquo;s Report</a>
    </div>
  </div>
  `;
}

async function createButtondownDraft(output) {
  const apiKey = process.env.BUTTONDOWN_API_KEY;
  if (!apiKey) {
    console.log("No BUTTONDOWN_API_KEY set; skipping Buttondown draft.");
    return;
  }

  const game = output?.games?.[0];
  if (!game) return;

  const subject = formatButtondownSubject(game);
  const bodyHtml = buildCondensedEmailHtml(game);
  const bodyText = buildPlainTextEmail(game);
  const payload = buildButtondownPayload(bodyHtml, { subject, status: "draft", bodyText, condensedMode: true });

  console.log(`[buttondown] createButtondownDraft POST — keys: ${Object.keys(payload).join(", ")}`);
  try {
    const response = await axios.post(
      "https://api.buttondown.com/v1/emails",
      payload,
      {
        timeout: 15000,
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "application/json"
        }
      }
    );
    const d = response.data || {};
    console.log(`[buttondown] createButtondownDraft response — id: ${d.id}, editor_type: ${d.editor_type}, body_html length: ${d.body_html?.length ?? 0}`);
  } catch (error) {
    console.error("Failed to create Buttondown draft:", error.response?.data || error.message);
  }
}

async function createButtondownEmail({ game, status = "draft", subject: subjectOverride = null, body: bodyOverride = null }) {
  const apiKey = process.env.BUTTONDOWN_API_KEY;
  if (!apiKey) {
    throw new Error("BUTTONDOWN_API_KEY is required to create Buttondown emails.");
  }
  if (!game) {
    throw new Error("Game payload is required to create a Buttondown email.");
  }

  const subject = subjectOverride || formatButtondownSubject(game);
  const bodyHtml = bodyOverride || buildCondensedEmailHtml(game);
  const bodyText = buildPlainTextEmail(game);
  const payload = buildButtondownPayload(bodyHtml, { subject, status, bodyText, condensedMode: true });

  console.log(`[buttondown] createButtondownEmail POST — keys: ${Object.keys(payload).join(", ")}`);
  try {
    const response = await axios.post(
      "https://api.buttondown.com/v1/emails",
      payload,
      {
        timeout: 15000,
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "application/json"
        }
      }
    );
    const d = response.data || {};
    console.log(`[buttondown] createButtondownEmail response — id: ${d.id}, editor_type: ${d.editor_type}, body_html length: ${d.body_html?.length ?? 0}`);
    return d.id ? d : null;
  } catch (error) {
    const details = error.response?.data || error.message;
    throw new Error(`Buttondown create failed: ${JSON.stringify(details)}`);
  }
}

async function updateButtondownEmail(emailId, payload = {}) {
  const apiKey = process.env.BUTTONDOWN_API_KEY;
  if (!apiKey) {
    throw new Error("BUTTONDOWN_API_KEY is required to update Buttondown emails.");
  }
  if (!emailId) {
    throw new Error("Buttondown email id is required.");
  }

  const doRequest = async (extraFields = {}) => {
    const response = await axios.patch(
      `https://api.buttondown.com/v1/emails/${emailId}`,
      { ...payload, ...extraFields },
      {
        timeout: 15000,
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "application/json"
        }
      }
    );
    const d = response.data || {};
    console.log(`[buttondown] PATCH ${emailId} — status: ${response.status}, editor_type: ${d.editor_type}, body length: ${d.body?.length ?? 0}, body_html length: ${d.body_html?.length ?? 0}`);
    console.log(`[buttondown] PATCH body_html first 200: ${d.body_html?.slice(0, 200) ?? "(none)"}`);
    return response.data || null;
  };

  try {
    return await doRequest();
  } catch (error) {
    const details = error.response?.data || error.message;
    if (error.response?.data?.code === "email_duplicate") {
      console.warn("[buttondown] email_duplicate detected — retrying with confirmed:true");
      try {
        return await doRequest({ confirmed: true });
      } catch (retryError) {
        const retryDetails = retryError.response?.data || retryError.message;
        throw new Error(`Buttondown update failed after duplicate retry: ${JSON.stringify(retryDetails)}`);
      }
    }
    throw new Error(`Buttondown update failed: ${JSON.stringify(details)}`);
  }
}

function logDebugAnalysis(writeup) {
  console.log(JSON.stringify({
    analysisObject: writeup.analysisObject || null,
    edgeScoring: writeup.edgeScoring || null,
    finalWriteup: {
      headline: writeup.headline || null,
      synopsis: writeup.synopsis || null,
      quickRead: writeup.quickRead || null,
      gameDetails: writeup.gameDetails || null,
      edgeSummary: writeup.edgeSummary || null,
      pitchingEdgeSummary: writeup.pitchingEdgeSummary || null,
      projectedLineupEdgeSummary: writeup.projectedLineupEdgeSummary || null,
      analysis: writeup.analysis || null,
      gameAnalysis: writeup.gameAnalysis || null,
      edgeTable: writeup.edgeTable || [],
      sections: writeup.sections || [],
      analyticalLean: writeup.analyticalLean || null,
      pickSummary: writeup.pickSummary || null,
      officialPick: writeup.officialPick || null,
      confidence: writeup.confidence || null
    },
    missingMetrics: writeup.missingMetrics || []
  }, null, 2));
}

async function generateOutputPackage({ date, dryRun = false, debugAnalysis = false } = {}) {
  const targetDate = date || getTodayEasternISO();
  let gameFacts;
  try {
    gameFacts = await buildGameFacts(targetDate);
  } catch (error) {
    const previousOutput = loadPreviousOutput();
    if (!dryRun && previousOutput) {
      console.warn(`[warn] Unable to build fresh game data for ${targetDate}: ${error.message}`);
      console.warn("[warn] Keeping existing public/data/sample-game.json so deploy can continue.");
      return { skipped: true, gameFacts: null, writeup: null, output: null };
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

  if (debugAnalysis) {
    logDebugAnalysis(writeup);
  }

  return { skipped: false, gameFacts, writeup, output };
}

function persistGeneratedOutput(output, { referenceDate = getTodayEasternISO() } = {}) {
  fs.writeFileSync(SAMPLE_JSON_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${SAMPLE_JSON_PATH}`);
  const featuredGame = selectFeaturedGame(output.games, referenceDate);
  if (featuredGame) {
    fs.writeFileSync(REPORT_HTML_PATH, buildSiteReportHtml(featuredGame));
    console.log(`Wrote ${REPORT_HTML_PATH}`);
  }
  const pickHistoryOutput = writePickHistory(Array.isArray(output.recentBreakdowns) ? output.recentBreakdowns : []);
  console.log(`Wrote ${PICK_HISTORY_PATH} with ${pickHistoryOutput.entries.length} entr${pickHistoryOutput.entries.length === 1 ? "y" : "ies"}`);
  return pickHistoryOutput;
}

async function run() {
  const { date, dryRun, debugAnalysis, buttondownDraft } = parseArgs(process.argv.slice(2));
  console.log(`Building Mets game package for ${date}${dryRun ? " (dry run)" : ""}${debugAnalysis ? " (debug analysis)" : ""}${buttondownDraft ? " (buttondown draft)" : ""}...`);

  const { skipped, output } = await generateOutputPackage({ date, dryRun, debugAnalysis });
  if (skipped) return;

  if (dryRun) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  persistGeneratedOutput(output, { referenceDate: date });
  if (buttondownDraft) {
    await createButtondownDraft(output);
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error("Generator failed:", error.message);
    process.exit(1);
  });
}

/*
How to run:
- node bot/generator.js
- node bot/generator.js --date 2026-03-16 --dry-run
*/

module.exports = {
  TEAM_ID,
  TEAM_NAME,
  TIME_ZONE,
  SAMPLE_JSON_PATH,
  PICK_HISTORY_PATH,
  REPORT_HTML_PATH,
  API_ODDS_PATH,
  parseArgs,
  getTodayEasternISO,
  selectFeaturedGame,
  getGameForDate,
  buildGameFacts,
  generateWriteupFromFacts,
  buildFallbackWriteup,
  buildPresentationReport,
  buildGameJson,
  buildEmailHtml,
  buildSiteReportHtml,
  loadPreviousOutput,
  loadPickHistory,
  writePickHistory,
  generateOutputPackage,
  persistGeneratedOutput,
  formatButtondownSubject,
  formatPreliminaryButtondownSubject,
  buildPlainTextEmail,
  buildButtondownPayload,
  createButtondownDraft,
  createButtondownEmail,
  updateButtondownEmail,
  getMostRecentConfirmedLineup,
  buildCondensedEmailHtml,
  run
};
