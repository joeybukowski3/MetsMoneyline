/*
Inputs:
- MLB Stats API schedule, feed, player stats, injuries, and game content endpoints.
- Baseball Savant pitcher/team leaderboards for lightweight advanced context.
- Optional xAI Grok call for the Today's Pick section, using only local structured game context.

Output:
- Writes public/data/sample-game.json in the shape consumed by the static frontend.
- Optionally creates a Buttondown draft from the same generated sections.
*/

const path = require("path");
const fs = require("fs");
const axios = require("axios");
const { parse } = require("csv-parse/sync");
const generateSitemap = require("./generate-sitemap");
const generateRss = require("./generate-rss");
const {
  addDaysToDateISO,
  buildDateScopedCacheKey,
  getEasternDateISO,
  getEasternYear,
  resolveFeaturedGameState
} = require("../public/js/featured-game-state.js");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const TEAM_ID = 121;
const TEAM_NAME = "New York Mets";
const TIME_ZONE = "America/New_York";
const DEFAULT_GROK_MODEL = process.env.GROK_MODEL || "grok-4.3";
const SAMPLE_JSON_PATH = path.join(__dirname, "../public/data/sample-game.json");
const PICK_HISTORY_PATH = path.join(__dirname, "../public/data/pick-history.json");
const API_ODDS_PATH = path.join(__dirname, "../public/api/mlb/mets/odds.json");
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

const TEAM_PRIMARY_COLORS = {
  "Arizona Diamondbacks": "#A71930",
  "Atlanta Braves": "#CE1141",
  "Baltimore Orioles": "#DF4601",
  "Boston Red Sox": "#BD3039",
  "Chicago Cubs": "#0E3386",
  "Chicago White Sox": "#27251F",
  "Cincinnati Reds": "#C6011F",
  "Cleveland Guardians": "#0C2340",
  "Colorado Rockies": "#333366",
  "Detroit Tigers": "#0C2340",
  "Houston Astros": "#002D62",
  "Kansas City Royals": "#004687",
  "Los Angeles Angels": "#BA0021",
  "Los Angeles Dodgers": "#005A9C",
  "Miami Marlins": "#00A3E0",
  "Milwaukee Brewers": "#12284B",
  "Minnesota Twins": "#002B5C",
  "New York Mets": "#002D72",
  "New York Yankees": "#132448",
  "Oakland Athletics": "#003831",
  "Philadelphia Phillies": "#E81828",
  "Pittsburgh Pirates": "#FDB827",
  "San Diego Padres": "#2F241D",
  "San Francisco Giants": "#FD5A1E",
  "Seattle Mariners": "#005C5C",
  "St. Louis Cardinals": "#C41E3A",
  "Tampa Bay Rays": "#092C5C",
  "Texas Rangers": "#003278",
  "Toronto Blue Jays": "#134A8E",
  "Washington Nationals": "#AB0003"
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

const grokApiKey = process.env.GROK_API_KEY || "";

const TODAY_PICK_CONFIDENCE_SCORE = {
  Low: 4,
  Lean: 5,
  Standard: 6,
  Strong: 8
};

const GROK_TODAY_PICK_SYSTEM_PROMPT = "You are a technical MLB analyst writing a pre-game breakdown for MetsMoneyline.com. Write like ESPN Stats & Info — direct, number-first, no narrative filler. Use only the structured game data provided. Never invent or imply stats not in the context. officialPick must always be \"Mets ML\". The bettingAngle must be 2-3 sentences of pure technical analysis: start with the most significant quantified edge (xERA, K%, OPS L20, bullpen xERA), add a secondary data point that either supports or complicates it, and end with the honest bottom line on what the numbers say. Every sentence must contain at least one specific number. BANNED WORDS AND PHRASES — never use these: workable, random draw, cleaner spot, process is pointing, the stage is set, analytically unambiguous, backs into, deep end of the staff, lean toward, the price is, price is workable, right direction, free money, lock, can't lose, sure thing, enters this one, mixed run, worth noting, shapes up, live secondary, real margin. If data is thin or conflicting, state that plainly with the specific numbers that conflict. Return valid JSON only.";

const GROK_TODAY_PICK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string" },
    summary: { type: "string" },
    metsEdges: {
      type: "array",
      items: { type: "string" }
    },
    risks: {
      type: "array",
      items: { type: "string" }
    },
    bettingAngle: { type: "string" },
    officialPick: { type: "string", const: "Mets ML" },
    confidenceLabel: { type: "string", enum: ["Low", "Lean", "Standard", "Strong"] },
    confidenceScore: { type: "number" }
  },
  required: [
    "headline",
    "summary",
    "metsEdges",
    "risks",
    "bettingAngle",
    "officialPick",
    "confidenceLabel",
    "confidenceScore"
  ]
};

const GROK_JSON_REPAIR_PROMPT = "The previous response was invalid. Return only valid JSON matching the required schema. Do not add markdown, commentary, or extra keys.";
const UNSUPPORTED_PICK_LANGUAGE = /\b(lock|guaranteed|guarantee|free money|can't lose|cant lose|sure thing|slam dunk)\b/gi;
const TODAY_PICK_SCORE_MIN = 1;
const TODAY_PICK_SCORE_MAX = 10;

let cachedSavantPitchers = null;
let cachedSavantBatters = null;
let cachedSavantExpectedBatters = null;
let cachedSavantExpectedPitchers = null;
let cachedPitcherPercentileMaps = null;
const cachedFangraphsTeams = new Map();
const cachedFangraphsLeaderboards = new Map();
const cachedGameFeeds = new Map();
const cachedTeamScheduleGames = new Map();
const cachedRecentTeamHittingStats = new Map();
const cachedRecentPlayerHittingStats = new Map();

function getTodayEasternISO() {
  return getEasternDateISO();
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeTrimmedString(value, fallback = "") {
  if (value == null) return fallback;
  const normalized = String(value)
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .trim();
  return normalized || fallback;
}

function stripUnsupportedPickLanguage(value) {
  return safeTrimmedString(value).replace(UNSUPPORTED_PICK_LANGUAGE, "high-variance");
}

function mapDeterministicConfidenceToTodayPick(analyticalLean, confidence) {
  if (confidence === "high" && (analyticalLean === "Mets" || analyticalLean === "Slight Mets edge")) return "Strong";
  if (confidence === "medium" || analyticalLean === "Mets") return "Standard";
  if (analyticalLean === "Opponent" || analyticalLean === "Slight opponent edge" || analyticalLean === "Mixed") return "Low";
  return "Lean";
}

function normalizeTodayPickConfidence(label, score, fallbackLabel = "Lean") {
  const validLabel = ["Low", "Lean", "Standard", "Strong"].includes(label) ? label : fallbackLabel;
  const fallbackScore = TODAY_PICK_CONFIDENCE_SCORE[validLabel] || TODAY_PICK_CONFIDENCE_SCORE.Lean;
  const numericScore = Number.isFinite(Number(score))
    ? clampNumber(Math.round(Number(score)), TODAY_PICK_SCORE_MIN, TODAY_PICK_SCORE_MAX)
    : fallbackScore;
  return { confidenceLabel: validLabel, confidenceScore: numericScore };
}

function normalizeTodayPickList(items, limit, fallbackItems = []) {
  const source = Array.isArray(items) ? items : fallbackItems;
  const cleaned = source
    .map((item) => stripUnsupportedPickLanguage(item))
    .filter(Boolean)
    .slice(0, limit);
  return cleaned.length ? cleaned : fallbackItems.slice(0, limit);
}

function formatBattingRate(value, digits = 3) {
  if (!Number.isFinite(value)) return "N/A";
  const fixed = Number(value).toFixed(digits);
  return fixed.startsWith("0") ? fixed.slice(1) : fixed;
}

function formatSignedPercent(value, digits = 1) {
  if (!Number.isFinite(value)) return "N/A";
  const normalized = Number(value).toFixed(digits);
  return `${value > 0 ? "+" : ""}${normalized}%`;
}

function getTeamPrimaryColor(teamName) {
  return TEAM_PRIMARY_COLORS[teamName] || "#6b7280";
}

function buildDeterministicTodayPick(gameFacts, writeup, analysisObject, edgeScoring) {
  const pickSummary = stripUnsupportedPickLanguage(writeup?.pickSummary || "");
  const pickNarrative = stripUnsupportedPickLanguage(writeup?.pickNarrative || "");
  const metsEdges = (edgeScoring?.categories || [])
    .filter((edge) => edge.edge === "Mets edge")
    .sort((a, b) => Math.abs(b.weightedImpact) - Math.abs(a.weightedImpact))
    .slice(0, 3)
    .map((edge) => stripUnsupportedPickLanguage(edge.explanation));
  const risks = (edgeScoring?.categories || [])
    .filter((edge) => edge.edge === "Opponent edge")
    .sort((a, b) => Math.abs(b.weightedImpact) - Math.abs(a.weightedImpact))
    .slice(0, 2)
    .map((edge) => stripUnsupportedPickLanguage(edge.explanation));
  const confidenceLabel = mapDeterministicConfidenceToTodayPick(writeup?.analyticalLean, writeup?.confidence);
  const confidenceScore = TODAY_PICK_CONFIDENCE_SCORE[confidenceLabel] || TODAY_PICK_CONFIDENCE_SCORE.Lean;
  const summary = safeTrimmedString(
    pickNarrative || pickSummary || `${TEAM_NAME} still has the cleaner moneyline path in the current matchup data.`
  );
  const bettingAngle = safeTrimmedString(
    pickSummary || "The official side stays Mets ML because the best supported matchup angle still points to New York."
  );

  return {
    headline: "Mets ML Pick",
    summary,
    metsEdges: metsEdges.length ? metsEdges : [
      stripUnsupportedPickLanguage("The Mets still show the best available offensive or run-prevention edge in the local matchup data."),
      stripUnsupportedPickLanguage("The bullpen and lineup context give New York a realistic path to control the late innings."),
      stripUnsupportedPickLanguage("The current price keeps the Mets moneyline playable relative to the in-house model read.")
    ],
    risks: risks.length ? risks : [
      stripUnsupportedPickLanguage("The overall board is not clean enough to remove volatility from the Mets side."),
      stripUnsupportedPickLanguage("If the top Mets edge does not show up early, the game can flip into a coin-flip script.")
    ],
    bettingAngle,
    officialPick: "Mets ML",
    confidenceLabel,
    confidenceScore
  };
}

function buildGrokTodayPickContext(gameFacts, analysisObject, edgeScoring, deterministicTodayPick) {
  const topMetsEdges = (edgeScoring?.categories || [])
    .filter((edge) => edge.edge === "Mets edge")
    .sort((a, b) => Math.abs(b.weightedImpact) - Math.abs(a.weightedImpact))
    .slice(0, 4)
    .map((edge) => ({
      category: edge.category,
      strength: edge.strength,
      explanation: edge.explanation,
      dataMode: edge.dataMode || null
    }));
  const topRisks = (edgeScoring?.categories || [])
    .filter((edge) => edge.edge === "Opponent edge")
    .sort((a, b) => Math.abs(b.weightedImpact) - Math.abs(a.weightedImpact))
    .slice(0, 3)
    .map((edge) => ({
      category: edge.category,
      strength: edge.strength,
      explanation: edge.explanation,
      dataMode: edge.dataMode || null
    }));

  const keyEdgesTable = (edgeScoring?.categories || []).map((edge) => ({
    category: edge.category,
    winner: edge.edge === "Mets edge" ? "Mets" : edge.edge === "Opponent edge" ? "Opponent" : "Even",
    strength: edge.strength,
    explanation: edge.explanation
  }));

  const mfRows = gameFacts?.recentForm?.mets?.rows || [];
  const ofRows = gameFacts?.recentForm?.opp?.rows || [];
  const mOpsRow = mfRows.find((r) => r.statKey === "ops") || null;
  const oOpsRow = ofRows.find((r) => r.statKey === "ops") || null;

  const ha = gameFacts?.emailData?.homeAwayEdge || null;

  return {
    sourcePolicy: "Use only the fields in this JSON context. Do not browse or add missing facts.",
    game: {
      date: gameFacts?.meta?.date || null,
      time: gameFacts?.meta?.time || null,
      opponent: gameFacts?.game?.opponent || null,
      homeAway: gameFacts?.meta?.homeAway || null,
      ballpark: gameFacts?.meta?.ballpark || null,
      weather: gameFacts?.weather || null
    },
    market: {
      metsMoneyline: gameFacts?.money?.metsMoneyline ?? null,
      opponentMoneyline: gameFacts?.money?.oppMoneyline ?? null,
      total: gameFacts?.money?.total ?? null,
      runLine: gameFacts?.money?.runLine ?? null
    },
    startingPitchers: {
      mets: {
        name: gameFacts?.pitching?.mets?.name || null,
        hand: gameFacts?.pitching?.mets?.hand || null,
        seasonERA: gameFacts?.pitching?.mets?.seasonERA || null,
        seasonXERA: gameFacts?.pitching?.mets?.seasonXERA || null,
        seasonWHIP: gameFacts?.pitching?.mets?.seasonWHIP || null,
        xERAPercentile: gameFacts?.pitching?.mets?.savant?.percentiles?.xERA ?? null,
        kPct: gameFacts?.pitching?.mets?.savant?.kPct || null,
        kPctPercentile: gameFacts?.pitching?.mets?.savant?.percentiles?.kPct ?? null,
        bbPct: gameFacts?.pitching?.mets?.savant?.bbPct || null,
        note: gameFacts?.pitching?.mets?.note || null,
        recentStarts: gameFacts?.pitching?.mets?.recentStarts || []
      },
      opponent: {
        name: gameFacts?.pitching?.opp?.name || null,
        hand: gameFacts?.pitching?.opp?.hand || null,
        seasonERA: gameFacts?.pitching?.opp?.seasonERA || null,
        seasonXERA: gameFacts?.pitching?.opp?.seasonXERA || null,
        seasonWHIP: gameFacts?.pitching?.opp?.seasonWHIP || null,
        xERAPercentile: gameFacts?.pitching?.opp?.savant?.percentiles?.xERA ?? null,
        kPct: gameFacts?.pitching?.opp?.savant?.kPct || null,
        kPctPercentile: gameFacts?.pitching?.opp?.savant?.percentiles?.kPct ?? null,
        bbPct: gameFacts?.pitching?.opp?.savant?.bbPct || null,
        note: gameFacts?.pitching?.opp?.note || null,
        recentStarts: gameFacts?.pitching?.opp?.recentStarts || []
      }
    },
    bullpen: {
      mets: {
        seasonXERA: gameFacts?.pitching?.metsBullpen?.seasonXERAAverage ?? null,
        seasonERA: gameFacts?.pitching?.metsBullpen?.seasonERA ?? null,
        last20ERA: gameFacts?.pitching?.metsBullpen?.last20ERA ?? null,
        usage: gameFacts?.pitching?.metsBullpen?.usage ?? null
      },
      opponent: {
        seasonXERA: gameFacts?.pitching?.oppBullpen?.seasonXERAAverage ?? null,
        seasonERA: gameFacts?.pitching?.oppBullpen?.seasonERA ?? null,
        last20ERA: gameFacts?.pitching?.oppBullpen?.last20ERA ?? null,
        usage: gameFacts?.pitching?.oppBullpen?.usage ?? null
      }
    },
    recentForm: {
      mets: {
        last20OPS: mOpsRow?.recentValue ?? null,
        last20OPSRank: mOpsRow?.recentRank ?? null,
        seasonOPS: mOpsRow?.seasonValue ?? null,
        seasonOPSRank: mOpsRow?.seasonRank ?? null,
        opsChangePct: mOpsRow?.differencePct ?? null,
        improving: mOpsRow?.improving ?? null
      },
      opponent: {
        last20OPS: oOpsRow?.recentValue ?? null,
        last20OPSRank: oOpsRow?.recentRank ?? null,
        seasonOPS: oOpsRow?.seasonValue ?? null,
        seasonOPSRank: oOpsRow?.seasonRank ?? null,
        opsChangePct: oOpsRow?.differencePct ?? null,
        improving: oOpsRow?.improving ?? null
      }
    },
    homeAwayEdge: ha ? {
      metsHome: ha.metsHome
        ? { games: ha.metsHome.games, differential: ha.metsHome.differential }
        : null,
      oppRoad: ha.oppRoad
        ? { games: ha.oppRoad.games, differential: ha.oppRoad.differential }
        : null
    } : null,
    keyEdgesTable,
    lineups: {
      status: gameFacts?.lineups?.status || null,
      mets: (gameFacts?.lineups?.mets || []).map((player) => ({
        order: player.order,
        name: player.name,
        pos: player.pos,
        hand: player.hand,
        savant: player.savant ? {
          ba: player.savant.ba ?? null,
          xba: player.savant.xba ?? null,
          xslg: player.savant.xslg ?? null,
          xwoba: player.savant.xwoba ?? null,
          pa: player.savant.pa ?? null
        } : null
      })),
      opponent: (gameFacts?.lineups?.opp || []).map((player) => ({
        order: player.order,
        name: player.name,
        pos: player.pos,
        hand: player.hand,
        savant: player.savant ? {
          ba: player.savant.ba ?? null,
          xba: player.savant.xba ?? null,
          xslg: player.savant.xslg ?? null,
          xwoba: player.savant.xwoba ?? null,
          pa: player.savant.pa ?? null
        } : null
      }))
    },
    records: gameFacts?.records || null,
    teamAdvanced: gameFacts?.advanced?.teamAdvanced || null,
    model: {
      analyticalLean: deterministicTodayPick?.confidenceLabel === "Strong"
        ? "Mets"
        : (analysisObject?.context?.analyticalLean || null),
      projectedWinProbability: edgeScoring?.projectedWinProbability ?? null,
      confidence: edgeScoring?.confidence || null,
      topMetsEdges,
      topRisks
    },
    deterministicFallback: deterministicTodayPick,
    trendsContext: (function() {
      try {
        const trendsPath = path.join(__dirname, "..", "public", "data", "trends.json");
        if (!fs.existsSync(trendsPath)) return null;
        const trends = JSON.parse(fs.readFileSync(trendsPath, "utf8"));
        const players = (trends.players || []).slice(0, 20);
        // Pull players with meaningful xBA vs AVG divergence (regression signals)
        const signals = players
          .map(p => {
            const avg = parseFloat(p.seasonAVG || p.avg || 0);
            const xba = parseFloat(p.xBA || p.xba || 0);
            const diff = xba - avg;
            return { name: p.name, team: p.team || "NYM", avg, xba, diff };
          })
          .filter(p => p.team === "NYM" && Math.abs(p.diff) >= 0.025 && p.avg > 0 && p.xba > 0)
          .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
          .slice(0, 4)
          .map(p => ({
            player: p.name,
            metric: "xBA vs AVG",
            avg: p.avg.toFixed(3),
            xBA: p.xba.toFixed(3),
            gap: (p.diff >= 0 ? "+" : "") + p.diff.toFixed(3),
            signal: p.diff > 0 ? "positive regression candidate" : "negative regression risk"
          }));
        return signals.length ? signals : null;
      } catch(e) { return null; }
    })()
  };
}

function extractJsonObject(text) {
  const raw = safeTrimmedString(text);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch (_) {
        return null;
      }
    }
  }
  return null;
}

function normalizeTodayPickPayload(payload, fallbackTodayPick) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Today pick payload must be an object.");
  }

  const headline = stripUnsupportedPickLanguage(payload.headline || fallbackTodayPick.headline);
  const summary = stripUnsupportedPickLanguage(payload.summary || fallbackTodayPick.summary);
  const bettingAngle = stripUnsupportedPickLanguage(payload.bettingAngle || fallbackTodayPick.bettingAngle);
  const metsEdges = normalizeTodayPickList(payload.metsEdges, 3, fallbackTodayPick.metsEdges);
  const risks = normalizeTodayPickList(payload.risks, 2, fallbackTodayPick.risks);
  const normalizedConfidence = normalizeTodayPickConfidence(
    payload.confidenceLabel,
    payload.confidenceScore,
    fallbackTodayPick.confidenceLabel
  );

  return {
    headline: headline || fallbackTodayPick.headline,
    summary: summary || fallbackTodayPick.summary,
    metsEdges,
    risks,
    bettingAngle: bettingAngle || fallbackTodayPick.bettingAngle,
    officialPick: "Mets ML",
    confidenceLabel: normalizedConfidence.confidenceLabel,
    confidenceScore: normalizedConfidence.confidenceScore
  };
}

function applyTodayPickToWriteup(writeup, todayPick) {
  const normalized = normalizeTodayPickPayload(todayPick, todayPick);
  const narrative = normalized.summary === normalized.bettingAngle
    ? normalized.summary
    : [normalized.summary, normalized.bettingAngle].filter(Boolean).join(" ");
  return {
    ...writeup,
    todayPick: normalized,
    pickSummary: normalized.bettingAngle,
    pickNarrative: narrative,
    confidence: normalized.confidenceLabel.toLowerCase()
  };
}

async function requestGrokTodayPick(gameContext, fallbackTodayPick) {
  if (!grokApiKey) {
    return fallbackTodayPick;
  }

  const userPrompt = [
    "Write the Today's Pick section using ONLY the provided game context. Do not invent or imply any stat not present in the data.",
    "",
    "Required output format:",
    "- Valid JSON only — no markdown, no commentary outside JSON",
    "- officialPick must be exactly \"Mets ML\"",
    "",
    "bettingAngle — 2-3 sentences of technical analysis only:",
    "  1st sentence: The biggest SP or bullpen edge with exact numbers. Example: \"Brazobán 2.73 xERA (92nd pct) vs Rodón 4.50 xERA — 1.77-run gap in expected quality.\"",
    "  2nd sentence: Secondary data point — offensive OPS differential, bullpen xERA gap, home/road run differential, or a conflicting factor if the data is mixed.",
    "  3rd sentence (optional): What the numbers say plainly — do they support the line, beat it, or conflict? No verdict language, just the honest read.",
    "  RULES: Every sentence must contain at least one number. No sentences that work for any game.",
    "  If trendsContext is provided and a trend is relevant to today's matchup, cite it briefly with the player and stat.",
    "",
    "summary field: 1-2 sentences summarizing the key matchup factors. No pick language — just the data summary.",
    "headline field: 6-8 words describing the matchup technically. No hype.",
    "metsEdges: 2-3 bullet points, each starting with a specific number from the context.",
    "risks: 1-2 specific risks with numbers. Honest even if data is thin.",
    "",
    `JSON schema:\n${JSON.stringify(GROK_TODAY_PICK_SCHEMA, null, 2)}`,
    "",
    `Game context:\n${JSON.stringify(gameContext, null, 2)}`
  ].join("\n");

  const requestMessages = [
    { role: "system", content: GROK_TODAY_PICK_SYSTEM_PROMPT },
    { role: "user", content: userPrompt }
  ];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const messages = attempt === 0
      ? requestMessages
      : [...requestMessages, { role: "user", content: GROK_JSON_REPAIR_PROMPT }];
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${grokApiKey}`
      },
      body: JSON.stringify({
        model: DEFAULT_GROK_MODEL,
        response_format: { type: "json_object" },
        temperature: 0.35,
        messages
      })
    });
    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Grok API request failed (${response.status}): ${details}`);
    }
    const completion = await response.json();
    const text = completion?.choices?.[0]?.message?.content || "";
    const parsed = extractJsonObject(text);
    if (!parsed) {
      if (attempt === 0) continue;
      throw new Error("Grok returned invalid JSON.");
    }
    return normalizeTodayPickPayload(parsed, fallbackTodayPick);
  }

  return fallbackTodayPick;
}

function selectFeaturedGame(games, referenceDate = getTodayEasternISO()) {
  if (!Array.isArray(games) || games.length === 0) return null;
  return resolveFeaturedGameState(games, {
    referenceDate,
    lookaheadDays: 14
  }).featuredGame || null;
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
  const report = game?.writeup?.report || buildPresentationReport(game);
  const pickLabel = String(report?.officialPick?.label || report?.officialPick?.headline || "Mets ML")
    .replace(/^Official Pick:\s*/i, "")
    .trim();
  const opponentWords = String(game?.opponent || "Opponent").trim().split(/\s+/).filter(Boolean);
  const opponent = ["Red Sox", "White Sox", "Blue Jays"].includes(opponentWords.slice(-2).join(" "))
    ? opponentWords.slice(-2).join(" ")
    : opponentWords.slice(-1).join(" ") || "Opponent";
  const confidenceLabel = String(report?.officialPick?.confidenceLabel || "Lean").trim();
  return `MetsMoneyline: ${pickLabel} vs ${opponent} — ${confidenceLabel} Confidence Matchup Snapshot`;
}

function formatPreliminaryButtondownSubject(game, lineupSourceLabel = "projected lineups") {
  if (!game) return "[TEST] MetsMoneyline";
  return `[TEST] ${formatButtondownSubject(game)} (${lineupSourceLabel})`;
}

const DAILY_REPORT_EMAIL_PREHEADER = "Bullpen edge, last-20 trend lines, starter matchup, and model read for today's Mets game.";

function buildPlainTextEmail(game) {
  const report = game?.writeup?.report;
  const date = report?.header?.metadataLine || game?.date || "";
  const opponent = game?.opponent || "Opponent";
  const oppAbbr = TEAM_NAME_TO_ABBR[opponent] || opponent.split(" ").pop().toUpperCase().slice(0, 3);
  const matchup = `New York Mets vs ${opponent}`;
  const pick = report?.officialPick?.label || "See full report";
  const pickSummary = report?.officialPick?.summary || report?.officialPick?.explanation || "";
  const isPreliminary = report?.preliminary?.enabled;

  const metsCard = report?.startingPitchersComparison?.metsCard;
  const oppCard  = report?.startingPitchersComparison?.oppCard;
  const fmt = (v, d=2) => { const n = parseFloat(String(v??"")); return Number.isFinite(n) ? n.toFixed(d) : "N/A"; };
  const fmtPct = (v) => { const n = parseFloat(String(v??"")); return Number.isFinite(n) ? `${n.toFixed(1)}%` : "N/A"; };

  const metsXERA = parseFloat(String(game?.pitching?.mets?.savant?.xERA ?? ""));
  const oppXERA  = parseFloat(String(game?.pitching?.opp?.savant?.xERA ?? ""));
  const metsSpStr = (metsCard?.name || "TBD") + " (ERA " + fmt(metsCard?.stats?.era) + (Number.isFinite(metsXERA) ? ", xERA " + fmt(metsXERA) : "") + ")";
  const oppSpStr  = (oppCard?.name  || "TBD") + " (ERA " + fmt(oppCard?.stats?.era)  + (Number.isFinite(oppXERA)  ? ", xERA " + fmt(oppXERA)  : "") + ")";
  const spLine = (Number.isFinite(metsXERA) || metsCard?.name)
    ? "SP: " + metsSpStr + " vs " + oppSpStr
    : "";

  const metsRecentForm = report?.recentFormReport?.mets;
  const oppRecentForm  = report?.recentFormReport?.opp;
  const metsOpsRow = metsRecentForm?.rows?.find(r => r.statKey === "ops");
  const oppOpsRow  = oppRecentForm?.rows?.find(r => r.statKey === "ops");
  const opsLine = (metsOpsRow || oppOpsRow)
    ? `Offense L20: NYM ${metsOpsRow?.recentValue != null ? fmt(metsOpsRow.recentValue,3) : "N/A"} OPS vs ${oppAbbr} ${oppOpsRow?.recentValue != null ? fmt(oppOpsRow.recentValue,3) : "N/A"} OPS`
    : "";

  const lines = [
    `MetsMoneyline${isPreliminary ? " (Preliminary Report)" : ""} — Game Report`,
    `${matchup}${date ? " | " + date : ""}`,
    "",
    `TONIGHT'S PICK: ${pick}`,
    pickSummary,
    "",
    spLine,
    opsLine,
    "",
    "Full breakdown, lineups, advanced stats and betting odds:",
    "https://www.metsmoneyline.com/report",
    "",
    "To unsubscribe, click the link in the footer of this email."
  ].filter(l => l !== null && l !== undefined);

  return lines.join("\n");
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

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function parseCachedEtTimeToIso(date, timeLabel) {
  const match = String(timeLabel || "").match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!date || !match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3].toUpperCase();
  if (meridiem === "PM" && hour !== 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return `${date}T${hh}:${mm}:00-04:00`;
}

function buildLocalGameLabel(gameLike = {}) {
  if (!gameLike?.opponent) return "Unknown Mets game";
  return gameLike.homeAway === "road"
    ? `Mets @ ${gameLike.opponent}`
    : `${gameLike.opponent} @ Mets`;
}

function adaptCachedGameForTargetDate(cachedGame, targetDate, reason = "local/public-data") {
  const cloned = deepClone(cachedGame);
  if (!cloned) return null;
  cloned.id = `${targetDate}-mets-vs-${slugify(cloned.opponent)}`;
  cloned.date = targetDate;
  cloned.status = "upcoming";
  cloned.result = null;
  cloned.finalScore = null;
  if (cloned.writeup?.report?.header) {
    cloned.writeup.report.header.date = targetDate;
  }
  return {
    source: reason,
    type: "cached-game",
    requestedDate: targetDate,
    resolvedDate: targetDate,
    stale: true,
    game: cloned
  };
}

function isExactLocalGameReusable(cachedGame, targetDate) {
  if (!cachedGame || cachedGame.date !== targetDate) return false;
  const sourceMeta = cachedGame.canonicalGameSource || null;
  if (!sourceMeta?.source) return false;
  if (sourceMeta.stale) return false;
  const sourceName = String(sourceMeta.source);
  if (/series-continuation/i.test(sourceName)) return false;
  if (!/^external\//i.test(sourceName)) return false;
  return true;
}

function loadLocalResolvedGameForDate(targetDate, { allowSeriesContinuation = true } = {}) {
  const previousOutput = loadPreviousOutput();
  const games = Array.isArray(previousOutput?.games) ? previousOutput.games : [];
  const exactMatch = games.find((game) => isExactLocalGameReusable(game, targetDate));
  if (exactMatch) {
    return {
      source: "local/public-data",
      type: "cached-game",
      requestedDate: targetDate,
      resolvedDate: targetDate,
      stale: false,
      game: deepClone(exactMatch)
    };
  }

  if (!allowSeriesContinuation) return null;
  const featured = selectFeaturedGame(games, targetDate);
  const primary = games[0] || featured || null;
  if (!primary?.date || !primary?.opponent) return null;
  const dayGap = diffDays(targetDate, primary.date);
  const inferredSeriesGameNumber = Number(primary?.gameContext?.seriesGameNumber || primary?.game?.seriesGameNumber || primary?.writeup?.analysisObject?.context?.seriesGameNumber || 0);
  const sameBallpark = Boolean(primary.ballpark);
  if (dayGap === 1 && primary.status === "upcoming" && inferredSeriesGameNumber > 0 && inferredSeriesGameNumber < 4 && sameBallpark) {
    const adapted = adaptCachedGameForTargetDate(primary, targetDate, "local/public-data-series-continuation");
    if (adapted?.game?.gameContext) {
      adapted.game.gameContext.seriesGameNumber = inferredSeriesGameNumber + 1;
    }
    return adapted;
  }

  return null;
}

function loadExactLocalResolvedGameForDate(targetDate) {
  return loadLocalResolvedGameForDate(targetDate, { allowSeriesContinuation: false });
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

  return [...map.values()].sort((a, b) => {
    const dateCmp = String(b.date).localeCompare(String(a.date));
    if (dateCmp !== 0) return dateCmp;
    return (Number(b.sourceGamePk) || 0) - (Number(a.sourceGamePk) || 0);
  });
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

async function loadSavantPitcherLeaderboard() {
  if (cachedSavantPitchers) return cachedSavantPitchers;

  const season = getEasternYear();
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
  const season = getEasternYear();
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

async function fetchPitcherContactAllowed(mlbId, season) {
  if (!mlbId) return { exitVelo: null, launchAngle: null };
  // leaderboard/statcast has avg_hit_speed and avg_hit_angle
  // leaderboard/custom does NOT return those columns regardless of &selections=
  const seasonsToTry = [season, season - 1];
  for (const year of seasonsToTry) {
    const url =
      `https://baseballsavant.mlb.com/leaderboard/statcast?type=pitcher&year=${year}` +
      `&position=&team=&min=0&csv=true`;
    const csv = await safeGetText(url, `savant statcast leaderboard pitcher ${year}`);
    if (!csv) continue;
    try {
      const rows = parse(csv, { columns: true, skip_empty_lines: true, relax_quotes: true });
      const row = rows.find((r) => String(r.player_id) === String(mlbId));
      if (!row) continue;
      const exitVelo = parseFloat(row.avg_hit_speed || "") || null;
      const launchAngle = parseFloat(row.avg_hit_angle || "") || null;
      if (exitVelo !== null || launchAngle !== null) {
        console.log(`[savant] pitcher ${mlbId} contact (${year}): exitVelo=${exitVelo}, launchAngle=${launchAngle}`);
        return { exitVelo, launchAngle };
      }
    } catch (e) {
      console.warn(`[savant] pitcher contact fetch failed for ${mlbId} ${year}:`, e.message);
    }
  }
  return { exitVelo: null, launchAngle: null };
}

async function fetchPitcherVsRoster(pitcherMlbId, batterMlbIds = []) {
  if (!pitcherMlbId || !batterMlbIds.length) return null;
  // Savant statcast_search with pitchers_lookup filter returns empty results for
  // programmatic requests — MLB Stats API vsPlayerTotal is reliable
  const results = await Promise.all(
    batterMlbIds.map((batterId) =>
      safeGetJson(
        `https://statsapi.mlb.com/api/v1/people/${pitcherMlbId}/stats` +
          `?stats=vsPlayerTotal&group=pitching&opposingPlayerId=${batterId}`,
        `vsPlayer ${pitcherMlbId} vs ${batterId}`
      )
    )
  );

  let totalPA = 0, totalHits = 0, totalK = 0, totalBB = 0, totalHR = 0, totalAB = 0;
  for (const data of results) {
    const stat = data?.stats?.[0]?.splits?.[0]?.stat;
    if (!stat || !Number(stat.battersFaced)) continue;
    totalPA += Number(stat.battersFaced || 0);
    totalHits += Number(stat.hits || 0);
    totalK += Number(stat.strikeOuts || 0);
    totalBB += Number(stat.baseOnBalls || 0);
    totalHR += Number(stat.homeRuns || 0);
    totalAB += Number(stat.atBats || 0);
  }

  if (!totalPA) {
    console.log(`[mlb] pitcher ${pitcherMlbId} vs roster: no career matchup data found`);
    return null;
  }

  const avg = totalAB > 0 ? (totalHits / totalAB).toFixed(3) : null;
  const kPct = totalPA > 0 ? totalK / totalPA : null;
  const bbPct = totalPA > 0 ? totalBB / totalPA : null;

  console.log(
    `[mlb] pitcher ${pitcherMlbId} vs ${batterMlbIds.length} roster batters: ` +
    `${totalPA} PA, AVG ${avg}, K% ${kPct?.toFixed(3)}`
  );

  return { PA: totalPA, kPct, bbPct, AVG: avg, HR: totalHR };
}

function toNumericOrNull(value) {
  if (value == null || value === "") return null;
  const parsed = Number.parseFloat(String(value).replace(/%/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function buildPitcherVsRosterSnapshot(lineup = [], pitcherSavant = {}) {
  const hitters = Array.isArray(lineup)
    ? lineup.filter((player) => player && player.primaryPosition?.abbreviation !== "P")
    : [];
  if (!hitters.length) return null;

  let weightedPa = 0;
  let weightedK = 0;
  let weightedBB = 0;
  let weightedAvgTotal = 0;
  let weightedWobaTotal = 0;
  let weightedXwobaTotal = 0;
  let weightedXbaTotal = 0;
  let weightedXslgTotal = 0;
  let avgWeight = 0;
  let wobaWeight = 0;
  let xwobaWeight = 0;
  let xbaWeight = 0;
  let xslgWeight = 0;

  for (const player of hitters) {
    const rawPa = Number(player?.savant?.pa ?? player?.stats?.plateAppearances ?? 0);
    const pa = Number.isFinite(rawPa) && rawPa > 0 ? rawPa : 1;
    weightedPa += pa;

    const kPct = toNumericOrNull(player?.savant?.kPct);
    if (kPct != null) weightedK += (kPct / 100) * pa;

    const bbPct = toNumericOrNull(player?.savant?.bbPct);
    if (bbPct != null) weightedBB += (bbPct / 100) * pa;

    const avg = toNumericOrNull(player?.seasonAVG);
    if (avg != null) {
      weightedAvgTotal += avg * pa;
      avgWeight += pa;
    }

    const woba = toNumericOrNull(player?.fangraphs?.wOBA);
    if (woba != null) {
      weightedWobaTotal += woba * pa;
      wobaWeight += pa;
    }

    const xwoba = toNumericOrNull(player?.savant?.xwOBA);
    if (xwoba != null) {
      weightedXwobaTotal += xwoba * pa;
      xwobaWeight += pa;
    }

    const xba = toNumericOrNull(player?.savant?.xBA);
    if (xba != null) {
      weightedXbaTotal += xba * pa;
      xbaWeight += pa;
    }

    const xslg = toNumericOrNull(player?.savant?.xSLG);
    if (xslg != null) {
      weightedXslgTotal += xslg * pa;
      xslgWeight += pa;
    }
  }

  const formatWeightedRate = (total, weight) => (weight > 0 ? (total / weight).toFixed(3) : null);

  return {
    PA: weightedPa || hitters.length,
    kPct: weightedPa > 0 ? weightedK / weightedPa : null,
    bbPct: weightedPa > 0 ? weightedBB / weightedPa : null,
    AVG: formatWeightedRate(weightedAvgTotal, avgWeight),
    wOBA: formatWeightedRate(weightedWobaTotal, wobaWeight),
    xwOBA: formatWeightedRate(weightedXwobaTotal, xwobaWeight),
    exitVelo: toNumericOrNull(pitcherSavant?.exitVeloAllowed),
    launchAngle: toNumericOrNull(pitcherSavant?.launchAngleAllowed),
    xBA: formatWeightedRate(weightedXbaTotal, xbaWeight),
    xSLG: formatWeightedRate(weightedXslgTotal, xslgWeight)
  };
}

function mergeNonNullRosterMetrics(fallbackSnapshot, preferredSnapshot) {
  if (!fallbackSnapshot && !preferredSnapshot) return null;
  const merged = { ...(fallbackSnapshot || {}) };
  for (const [key, value] of Object.entries(preferredSnapshot || {})) {
    if (value != null) merged[key] = value;
  }
  return merged;
}

async function loadSavantBatterLeaderboard() {
  if (cachedSavantBatters) return cachedSavantBatters;
  const season = getEasternYear();
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
  const season = getEasternYear();
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

async function loadFangraphsLeaderboard(stats, type, season = getEasternYear()) {
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
    xERA: computePercentileMap(expectedRows, "xera", { descending: false }),
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

function formatPitcherSeasonDecisionRecord(stat = null) {
  const wins = Number(stat?.wins);
  const losses = Number(stat?.losses);
  if (!Number.isFinite(wins) || !Number.isFinite(losses)) return null;
  return `${wins}-${losses}`;
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

  const season = String(getEasternYear());
  const previousSeason = String(Number(season) - 1);
  const [person, currentStats, previousStats, savantRows, expectedRows, fangraphsTeam, contactAllowed] = await Promise.all([
    getPersonInfo(personId),
    getPlayerSeasonStats(personId, "pitching", season),
    getPlayerSeasonStats(personId, "pitching", previousSeason),
    loadSavantPitcherLeaderboard(),
    loadSavantExpectedPitchers(),
    teamName ? loadFangraphsTeamData(teamName) : null,
    fetchPitcherContactAllowed(personId, Number(season))
  ]);
  const percentileMaps = await loadPitcherPercentileMaps();

  const stat = currentStats || previousStats;
  const statSeason = currentStats ? season : previousStats ? previousSeason : null;
  const currentSeasonRecord = formatPitcherSeasonDecisionRecord(currentStats);
  const savant = getSavantRow(savantRows, personId);
  const expected = getSavantRow(expectedRows, personId);
  const pitcherName = person?.fullName || fallbackName || "TBD";
  const fangraphsPitcher = fangraphsTeam?.pitchingByName?.[normalizePersonName(pitcherName)] || null;
  const exitVeloAllowed = contactAllowed?.exitVelo ?? (savant?.avg_hit_speed ? Number(savant.avg_hit_speed) : null);
  const launchAngleAllowed = contactAllowed?.launchAngle ?? (savant?.avg_hit_angle ? Number(savant.avg_hit_angle) : null);
  console.log(`[savant] ${pitcherName} exitVelo: ${exitVeloAllowed}, launchAngle: ${launchAngleAllowed}`);

  const pitcherGeneratedAt = new Date().toISOString();
  const statsSources = {
    era: stat?.era ? "mlb" : fangraphsPitcher?.ERA ? "fangraphs" : null,
    fip: stat?.fip ? "mlb" : fangraphsPitcher?.FIP ? "fangraphs" : computeApproxFip(stat) ? "computed" : null,
    savant: savant ? "savant" : null,
    statSeason: statSeason || null
  };
  console.log(`[pitcher] ${pitcherName}: era=${stat?.era ?? null} fip=${stat?.fip ?? null} savant=${Boolean(savant)} statSeason=${statSeason} generatedAt=${pitcherGeneratedAt}`);

  return {
    name: pitcherName,
    mlbId: personId,
    announced: true,
    hand: person?.pitchHand?.code || null,
    generatedAt: pitcherGeneratedAt,
    statsSources,
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
      exitVeloAllowed,
      launchAngleAllowed,
      percentiles: {
        barrelPct: percentileMaps?.barrelPct?.[personId] ?? null,
        hardHitPct: percentileMaps?.hardHitPct?.[personId] ?? null,
        kPct: percentileMaps?.kPct?.[personId] ?? null,
        bbPct: percentileMaps?.bbPct?.[personId] ?? null,
        xERA: percentileMaps?.xERA?.[personId] ?? null,
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
  const season = String(getEasternYear());
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
    "&hydrate=team,venue,linescore,probablePitcher,lineups,seriesStatus";
  const data = await safeGetJson(url, `schedule ${targetDate}`);
  return data?.dates?.[0]?.games?.[0] || null;
}

function resolveExternalGameDate(game) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(game?.officialDate || ""))) {
    return game.officialDate;
  }
  if (!game?.gameDate) return null;
  const parsed = new Date(game.gameDate);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
}

function isExternalGameExactMatch(game, targetDate) {
  if (!game || !targetDate) return false;
  return resolveExternalGameDate(game) === targetDate;
}

async function fetchExactExternalGameForDate(targetDate) {
  const url =
    "https://statsapi.mlb.com/api/v1/schedule" +
    `?sportId=1&teamId=${TEAM_ID}&date=${targetDate}` +
    "&hydrate=team,venue,linescore,probablePitcher,lineups,seriesStatus";
  const data = await safeGetJson(url, `schedule ${targetDate}`);
  if (data == null) {
    return { status: "unavailable", game: null };
  }
  const rawGame = data?.dates?.[0]?.games?.[0] || null;
  const game = isExternalGameExactMatch(rawGame, targetDate) ? rawGame : null;
  return { status: game ? "found" : "empty", game };
}

function isPlayableExternalScheduleGame(game) {
  const statusText = String(game?.status?.abstractGameState || game?.status?.detailedState || "").toLowerCase();
  if (!game?.gamePk) return false;
  if (/postponed|suspended|cancelled|canceled/.test(statusText)) return false;
  if (/live|in progress|manager challenge|warmup|delayed/.test(statusText)) return true;
  if (/preview|scheduled|pre-game/.test(statusText)) return true;
  return !/final|completed|game over/.test(statusText);
}

function isExternalFinalScheduleGame(game) {
  const statusText = String(game?.status?.abstractGameState || game?.status?.detailedState || "").toLowerCase();
  return /final|completed|game over/.test(statusText);
}

async function resolveMetsGameForDate(targetDate, { allowSeriesContinuation = true, allowFutureFallback = false, log = false } = {}) {
  const messages = [];
  const pushLog = (message) => {
    messages.push(message);
    if (log) console.log(message);
  };

  pushLog(`Resolving Mets game for ${targetDate}`);
  const exactExternal = await fetchExactExternalGameForDate(targetDate);
  if (exactExternal.status === "found" && exactExternal.game) {
    const game = exactExternal.game;
    if (allowFutureFallback && isExternalFinalScheduleGame(game)) {
      pushLog(`Exact-date game for ${targetDate} is already final; advancing to next playable Mets game.`);
    } else {
      const isHome = game?.teams?.home?.team?.id === TEAM_ID;
      const oppTeam = isHome ? game?.teams?.away?.team : game?.teams?.home?.team;
      pushLog(`External schedule found: ${isHome ? `${oppTeam?.name || "Opponent"} @ Mets` : `Mets @ ${oppTeam?.name || "Opponent"}`}`);
      pushLog("Resolved game source: external/mlb-stats");
      return {
        source: "external/mlb-stats",
        type: "mlb-schedule-game",
        requestedDate: targetDate,
        resolvedDate: targetDate,
        stale: false,
        game,
        logs: messages
      };
    }
  }

  if (exactExternal.status === "unavailable") {
    pushLog("External schedule fetch failed: unavailable; continuing with local data if present");
    const localResolution = loadExactLocalResolvedGameForDate(targetDate);
    if (localResolution) {
      pushLog(`Local site schedule found: ${buildLocalGameLabel(localResolution.game)}`);
      pushLog(`Resolved game source: ${localResolution.source}`);
      return { ...localResolution, logs: messages };
    }
    const staleLocal = loadLocalResolvedGameForDate(targetDate, { allowSeriesContinuation });
    if (staleLocal) {
      pushLog(`Local cached game found after external failure: ${buildLocalGameLabel(staleLocal.game)}`);
      pushLog(`Resolved game source: ${staleLocal.source}`);
      return { ...staleLocal, logs: messages };
    }
  }

  if (!allowFutureFallback) {
    const localResolution = loadExactLocalResolvedGameForDate(targetDate);
    if (localResolution) {
      pushLog(`Local site schedule found after external miss: ${buildLocalGameLabel(localResolution.game)}`);
      pushLog(`Resolved game source: ${localResolution.source}`);
      return { ...localResolution, logs: messages };
    }
    pushLog(`No Mets game found for ${targetDate} after checking local and external sources.`);
    return null;
  }

  const startDate = targetDate;
  const endDate = addDaysToDateISO(targetDate, 7);

  const url =
    "https://statsapi.mlb.com/api/v1/schedule" +
    `?sportId=1&teamId=${TEAM_ID}&startDate=${startDate}&endDate=${endDate}` +
    "&hydrate=team,venue,linescore,probablePitcher,lineups,seriesStatus";
  const data = await safeGetJson(url, `schedule window ${startDate} ${endDate}`);
  const nextGame = (data?.dates || [])
    .flatMap((dateEntry) => dateEntry.games || [])
    .filter((game) => isPlayableExternalScheduleGame(game))
    .sort((a, b) => new Date(a.gameDate) - new Date(b.gameDate))[0] || null;

  if (!nextGame) {
    if (data == null) {
      const staleLocal = loadLocalResolvedGameForDate(targetDate, { allowSeriesContinuation: true });
      if (staleLocal) {
        pushLog(`External schedule fetch failed: unavailable; continuing with local data`);
        pushLog(`Resolved game source: ${staleLocal.source}`);
        return { ...staleLocal, logs: messages };
      }
    }
    throw new Error(`No Mets game found on or after ${targetDate}`);
  }

  pushLog("Resolved game source: external/mlb-stats-window");
  return {
    source: "external/mlb-stats-window",
    type: "mlb-schedule-game",
    requestedDate: targetDate,
    resolvedDate: nextGame.officialDate || targetDate,
    stale: false,
    game: nextGame,
    logs: messages
  };
}

async function resolveTargetGame(targetDate) {
  const resolution = await resolveMetsGameForDate(targetDate, {
    allowSeriesContinuation: false,
    allowFutureFallback: true,
    log: false
  });
  if (!resolution) {
    throw new Error(`No Mets game found on or after ${targetDate}`);
  }
  return {
    requestedDate: resolution.requestedDate,
    resolvedDate: resolution.resolvedDate,
    game: resolution.game,
    source: resolution.source,
    type: resolution.type,
    stale: resolution.stale
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
      statsSeason: stat.gamesPlayed != null ? String(getEasternYear()) : null
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
        statsSeason: gamesPlayed > 0 ? String(getEasternYear()) : null,
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

  const season = String(getEasternYear());
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
  const recentEndDate = addDaysToDateISO(targetDate, -1);
  const [savantBatters, savantExpectedBatters, metsFg, oppFg, metsRecentStatsByPlayer, oppRecentStatsByPlayer] = await Promise.all([
    loadSavantBatterLeaderboard(),
    loadSavantExpectedBatters(),
    loadFangraphsTeamData(TEAM_NAME),
    oppTeamName ? loadFangraphsTeamData(oppTeamName) : null,
    getTeamRecentHittingStatsByPlayer(TEAM_ID, recentEndDate, 20),
    getTeamRecentHittingStatsByPlayer(oppTeamId, recentEndDate, 20)
  ]);
  const savantBattersByPlayer = Object.fromEntries(savantBatters.map((row) => [Number(row.player_id), row]));
  const savantExpectedBattersByPlayer = Object.fromEntries(savantExpectedBatters.map((row) => [Number(row.player_id), row]));

  const metsConfirmed = enrichLineupWithRecentStats(
    enrichLineupWithSavant(buildLineupFromBoxscore(metsTeam), savantBattersByPlayer, savantExpectedBattersByPlayer, metsFg?.battingByName || {}),
    metsRecentStatsByPlayer
  );
  const oppConfirmed = enrichLineupWithRecentStats(
    enrichLineupWithSavant(buildLineupFromBoxscore(oppTeam), savantBattersByPlayer, savantExpectedBattersByPlayer, oppFg?.battingByName || {}),
    oppRecentStatsByPlayer
  );

  if (metsConfirmed.length && oppConfirmed.length) {
    return {
      mets: metsConfirmed,
      opp: oppConfirmed,
      status: "confirmed"
    };
  }

  return {
    mets: metsConfirmed.length
      ? metsConfirmed
      : enrichLineupWithRecentStats(await buildProjectedTeamLineup(TEAM_ID, true, targetDate), metsRecentStatsByPlayer),
    opp: oppConfirmed.length
      ? oppConfirmed
      : enrichLineupWithRecentStats(await buildProjectedTeamLineup(oppTeamId, false, targetDate), oppRecentStatsByPlayer),
    status: "projected"
  };
}

async function buildBullpenFacts(teamId, teamName, isMets) {
  const season = String(getEasternYear());
  const today = getTodayEasternISO();
  const last20Start = addDaysToDateISO(today, -20);
  const last7Start = addDaysToDateISO(today, -7);

  const [current, fangraphsTeam, seasonRoster, last20Roster, gameLogRoster, savantExpectedPitchers] = await Promise.all([
    safeGetJson(
      `https://statsapi.mlb.com/api/v1/teams/${teamId}/stats?stats=season&group=pitching&season=${season}`,
      `team pitching ${teamId} ${season}`
    ),
    loadFangraphsTeamData(teamName),
    safeGetJson(
      `https://statsapi.mlb.com/api/v1/teams/${teamId}/roster?rosterType=active&season=${season}&hydrate=person(stats(type=[season],group=[pitching],season=${season}))`,
      `pitching roster season ${teamId} ${season}`
    ),
    safeGetJson(
      `https://statsapi.mlb.com/api/v1/teams/${teamId}/roster?rosterType=active&season=${season}&hydrate=person(stats(type=[byDateRange],group=[pitching],startDate=${last20Start},endDate=${today}))`,
      `pitching roster last20 ${teamId} ${season}`
    ),
    safeGetJson(
      `https://statsapi.mlb.com/api/v1/teams/${teamId}/roster?rosterType=active&season=${season}&hydrate=person(stats(type=[gameLog],group=[pitching],season=${season}))`,
      `pitching roster game log ${teamId} ${season}`
    ),
    loadSavantExpectedPitchers()
  ]);

  const stat = current?.stats?.[0]?.splits?.[0]?.stat || null;
  const pitchingTotal = fangraphsTeam?.pitchingTeamTotal || {};
  const seasonEra = pitchingTotal['ERA'] || stat?.era || null;
  const seasonWhip = stat?.whip || null;
  const seasonFip = pitchingTotal['xFIP'] || pitchingTotal['FIP'] || stat?.fip || null;
  const rating = seasonEra
    ? Math.max(40, Math.min(85, Math.round(100 - (parseFloat(seasonEra) - 2.5) * 12)))
    : (isMets ? 70 : 65);
  const relieverSeasonRows = extractPitchingRosterRows(seasonRoster);
  const relieverLast20Rows = extractPitchingRosterRows(last20Roster);
  const relieverGameLogRows = extractPitchingGameLogs(gameLogRoster);
  const relieverIds = new Set(relieverSeasonRows.map((row) => row.playerId));
  const seasonAggregate = aggregateBullpenRows(relieverSeasonRows);
  const last20Aggregate = aggregateBullpenRows(relieverLast20Rows.filter((row) => relieverIds.has(row.playerId)));
  const last7Games = relieverGameLogRows.filter((row) => relieverIds.has(row.playerId) && row.date >= last7Start && row.date < today);
  const closer = buildCloserSnapshot(relieverSeasonRows, last7Games);
  const usage = buildBullpenUsage(last7Games, relieverIds.size);
  const seasonXERAAverage = buildBullpenXeraAverage(relieverSeasonRows, savantExpectedPitchers);

  return {
    seasonERA: seasonAggregate.era ?? seasonEra,
    seasonXERAAverage,
    seasonXFIP: seasonFip,
    last14ERA: null,
    last20ERA: last20Aggregate.era,
    last20WHIP: last20Aggregate.whip,
    last3DaysIP: null,
    seasonWHIP: seasonAggregate.whip ?? seasonWhip,
    seasonKPct: pitchingTotal['K%'] || null,
    seasonBBPct: pitchingTotal['BB%'] || null,
    rating,
    team: teamName,
    usage,
    closer,
    relieverCount: relieverIds.size
  };
}

function extractPitchingRosterRows(data) {
  return (data?.roster || [])
    .map((entry) => {
      const stat = entry?.person?.stats?.[0]?.splits?.find((split) => split?.sport?.id !== 0)?.stat
        || entry?.person?.stats?.[0]?.splits?.[0]?.stat
        || null;
      return {
        playerId: entry?.person?.id || null,
        name: entry?.person?.fullName || entry?.person?.nameFirstLast || "Pitcher",
        stats: stat
      };
    })
    .filter((row) => row.playerId && row.stats && Number(row.stats.gamesPlayed || 0) > 0);
}

function extractPitchingGameLogs(data) {
  return (data?.roster || []).flatMap((entry) => {
    const splits = entry?.person?.stats?.[0]?.splits || [];
    return splits
      .filter((split) => split?.date && split?.stat)
      .map((split) => ({
        playerId: entry?.person?.id || null,
        name: entry?.person?.fullName || entry?.person?.nameFirstLast || "Pitcher",
        date: split.date,
        stat: split.stat
      }));
  });
}

function isRelieverStatLine(stat = {}) {
  const gamesPlayed = Number(stat.gamesPlayed || stat.gamesPitched || 0);
  const gamesStarted = Number(stat.gamesStarted || 0);
  return gamesPlayed > 0 && gamesStarted === 0;
}

function formatOutsToIp(outs) {
  const wholeOuts = Number(outs);
  if (!Number.isFinite(wholeOuts)) return null;
  const whole = Math.floor(wholeOuts / 3);
  const remainder = wholeOuts % 3;
  return `${whole}.${remainder}`;
}

function aggregateBullpenRows(rows = []) {
  let outs = 0;
  let earnedRuns = 0;
  let walks = 0;
  let hits = 0;

  for (const row of rows) {
    const stat = row?.stats || row?.stat || null;
    if (!isRelieverStatLine(stat)) continue;
    const rowOuts = inningsPitchedToOuts(stat.inningsPitched);
    if (!Number.isFinite(rowOuts) || rowOuts <= 0) continue;
    outs += rowOuts;
    earnedRuns += Number(stat.earnedRuns || 0);
    walks += Number(stat.baseOnBalls || 0);
    hits += Number(stat.hits || 0);
  }

  if (!outs) {
    return {
      outs: 0,
      inningsPitched: null,
      era: null,
      whip: null
    };
  }

  const innings = outs / 3;
  return {
    outs,
    inningsPitched: formatOutsToIp(outs),
    era: Number(((earnedRuns * 9) / innings).toFixed(2)),
    whip: Number(((hits + walks) / innings).toFixed(2))
  };
}

function buildBullpenXeraAverage(seasonRows = [], expectedRows = []) {
  const expectedByPlayer = Object.fromEntries((expectedRows || []).map((row) => [String(row.player_id || ""), parseNumber(row.xera)]));
  const values = seasonRows
    .filter((row) => isRelieverStatLine(row?.stats))
    .map((row) => expectedByPlayer[String(row.playerId || "")])
    .filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function buildBullpenUsage(gameLogs = [], relieverCount = 0) {
  const appearances = gameLogs.filter((row) => isRelieverStatLine(row?.stat)).length;
  const appearancesPerPitcherPerDay = relieverCount > 0
    ? appearances / relieverCount / 7
    : null;
  let label = "Low";
  let tone = "green";
  if (appearancesPerPitcherPerDay != null && appearancesPerPitcherPerDay >= 0.6) {
    label = "High";
    tone = "red";
  } else if (appearancesPerPitcherPerDay != null && appearancesPerPitcherPerDay >= 0.3) {
    label = "Medium";
    tone = "yellow";
  }
  return {
    appearances,
    appearancesPerPitcherPerDay: appearancesPerPitcherPerDay == null
      ? null
      : Number(appearancesPerPitcherPerDay.toFixed(2)),
    label,
    tone
  };
}

function buildCloserSnapshot(seasonRows = [], recentGameLogs = []) {
  const relievers = seasonRows
    .filter((row) => isRelieverStatLine(row?.stats))
    .map((row) => {
      const stat = row.stats;
      return {
        playerId: row.playerId,
        name: row.name,
        saves: Number(stat.saves || 0),
        saveOpportunities: Number(stat.saveOpportunities || 0),
        era: parseNumber(stat.era),
        whip: parseNumber(stat.whip)
      };
    });
  const closer = relievers
    .sort((a, b) => (b.saves - a.saves) || (b.saveOpportunities - a.saveOpportunities) || a.name.localeCompare(b.name))[0];
  if (!closer) return null;

  const closerLogs = recentGameLogs.filter((row) => row.playerId === closer.playerId && isRelieverStatLine(row?.stat));
  const usageOuts = closerLogs.reduce((sum, row) => sum + (inningsPitchedToOuts(row?.stat?.inningsPitched) || 0), 0);
  return {
    ...closer,
    saveConversionPct: closer.saveOpportunities > 0
      ? Number(((closer.saves / closer.saveOpportunities) * 100).toFixed(1))
      : null,
    last7DaysAppearances: closerLogs.length,
    last7DaysInningsPitched: usageOuts ? formatOutsToIp(usageOuts) : "0.0"
  };
}

function parseNumber(value) {
  const num = parseFloat(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(num) ? num : null;
}

function normalizePercentLikeValue(value, digits = 1) {
  const parsed = parseNumber(value);
  if (parsed == null) return null;
  const raw = String(value ?? "").trim();
  // Some sources emit rates as decimals (0.080) while others already use
  // percent-like values (8.0 or "8.0%"). Normalize once here so downstream
  // renderers never have to guess or apply a second multiplication.
  const normalized = raw.includes("%") || Math.abs(parsed) >= 1 ? parsed : parsed * 100;
  return Number(normalized.toFixed(digits));
}

function deriveAdvancedCards(_metsTeamRow, _oppTeamRow, metsLast10, oppLast10, teamAdvanced = null) {
  const metsHardHit = parseNumber(teamAdvanced?.mets?.hardHit);
  const oppHardHit = parseNumber(teamAdvanced?.opp?.hardHit);
  const metsBarrel = parseNumber(teamAdvanced?.mets?.barrelPct);
  const oppBarrel = parseNumber(teamAdvanced?.opp?.barrelPct);
  const metsWalk = normalizePercentLikeValue(teamAdvanced?.mets?.bbPct);
  const oppWalk = normalizePercentLikeValue(teamAdvanced?.opp?.bbPct);
  const metsK = normalizePercentLikeValue(teamAdvanced?.mets?.kPct);
  const oppK = normalizePercentLikeValue(teamAdvanced?.opp?.kPct);
  const metsWrc = parseNumber(teamAdvanced?.mets?.wrcPlus);
  const oppWrc = parseNumber(teamAdvanced?.opp?.wrcPlus);
  const metsIso = parseNumber(teamAdvanced?.mets?.iso);
  const oppIso = parseNumber(teamAdvanced?.opp?.iso);
  const metsXwoba = parseNumber(teamAdvanced?.mets?.xwoba);
  const oppXwoba = parseNumber(teamAdvanced?.opp?.xwoba);
  const edgeForHigher = (left, right) => left == null || right == null ? "Neutral" : left > right ? "Mets" : right > left ? "Opp" : "Neutral";
  const edgeForLower = (left, right) => left == null || right == null ? "Neutral" : left < right ? "Mets" : right < left ? "Opp" : "Neutral";

  // Build split-aware label for wRC+ card
  const metsVsHand  = teamAdvanced?.mets?.vsHand;
  const oppVsHand   = teamAdvanced?.opp?.vsHand;
  const metsSplitNote = metsVsHand ? `NYM vs ${metsVsHand}HP` : (teamAdvanced?.mets?.fallbackNote ? "NYM (season)" : "NYM");
  const oppSplitNote  = oppVsHand  ? `OPP vs ${oppVsHand}HP`  : (teamAdvanced?.opp?.fallbackNote  ? "OPP (season)" : "OPP");
  const wrcCardLabel = `Offense vs SP Hand - wRC+`;
  const wrcCardNote  = `${metsSplitNote} · ${oppSplitNote}`;

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
      category: wrcCardLabel,
      note: wrcCardNote,
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

/**
 * Fetch team batting splits vs a specific pitcher hand (L or R).
 * MLB Stats API: statSplits=vsl (vs left-handed pitchers) or vsr (vs right-handed).
 * Returns the stat object or null if unavailable.
 */
async function getTeamHandednessSplit(teamId, pitcherHand, season) {
  if (!teamId || !pitcherHand) return null;
  const splitCode = pitcherHand.toUpperCase() === "L" ? "vsl" : "vsr";
  const data = await safeGetJson(
    `https://statsapi.mlb.com/api/v1/teams/${teamId}/stats?stats=statSplits&group=hitting&season=${season}&sitCodes=${splitCode}`,
    `team hitting split ${splitCode} ${teamId} ${season}`
  );
  // statSplits returns an array of split objects; find the correct sitCode match
  const splits = data?.stats?.[0]?.splits || [];
  const match = splits.find((s) =>
    String(s?.split?.code || s?.sitCode || "").toLowerCase() === splitCode
  ) || splits[0];
  if (!match?.stat) {
    console.warn(`[advanced] No ${splitCode} batting split found for teamId ${teamId}`);
    return null;
  }
  console.log(`[advanced] ${splitCode} split for team ${teamId}: PA=${match.stat.plateAppearances} wRC+≈ (from PA/BB/K counts)`);
  return match.stat;
}

function pctFromCounts(numerator, denominator) {
  const num = Number(numerator || 0);
  const den = Number(denominator || 0);
  if (!den) return null;
  return ((num / den) * 100).toFixed(1);
}

function computeRatePct(numerator, denominator, digits = 1) {
  const num = Number(numerator || 0);
  const den = Number(denominator || 0);
  if (!den) return null;
  return Number(((num / den) * 100).toFixed(digits));
}

function normalizeTeamHittingSnapshot(stat = null) {
  if (!stat) {
    return {
      ops: null,
      avg: null,
      kPct: null,
      bbPct: null
    };
  }
  return {
    ops: parseNumber(stat.ops),
    avg: parseNumber(stat.avg),
    kPct: computeRatePct(stat.strikeOuts, stat.plateAppearances),
    bbPct: computeRatePct(stat.baseOnBalls, stat.plateAppearances)
  };
}

async function getTeamRecentHittingStats(teamId, endDate, days = 20) {
  const season = String(endDate).slice(0, 4);
  const startDate = addDaysToDateISO(endDate, -days);
  const cacheKey = `${teamId}:${startDate}:${endDate}`;
  if (cachedRecentTeamHittingStats.has(cacheKey)) return cachedRecentTeamHittingStats.get(cacheKey);
  const promise = safeGetJson(
    `https://statsapi.mlb.com/api/v1/teams/${teamId}/stats?stats=byDateRange&group=hitting&gameType=R&startDate=${startDate}&endDate=${endDate}`,
    `team hitting byDateRange ${teamId} ${startDate} ${endDate}`
  ).then((data) => data?.stats?.[0]?.splits?.[0]?.stat || null);
  cachedRecentTeamHittingStats.set(cacheKey, promise);
  return promise;
}

async function getTeamRecentHittingStatsByPlayer(teamId, endDate, days = 20) {
  const season = String(endDate).slice(0, 4);
  const startDate = addDaysToDateISO(endDate, -days);
  const cacheKey = `${teamId}:${startDate}:${endDate}:players`;
  if (cachedRecentPlayerHittingStats.has(cacheKey)) return cachedRecentPlayerHittingStats.get(cacheKey);
  const promise = safeGetJson(
    `https://statsapi.mlb.com/api/v1/teams/${teamId}/roster?rosterType=active&season=${season}&hydrate=person(stats(type=[byDateRange],group=[hitting],startDate=${startDate},endDate=${endDate}))`,
    `team hitting byDateRange roster ${teamId} ${startDate} ${endDate}`
  ).then((data) => Object.fromEntries((data?.roster || []).map((entry) => {
    const stat = entry?.person?.stats?.[0]?.splits?.find((split) => split?.sport?.id !== 0)?.stat
      || entry?.person?.stats?.[0]?.splits?.[0]?.stat
      || null;
    return [
      entry?.person?.id,
      {
        avg: parseNumber(stat?.avg),
        ops: parseNumber(stat?.ops),
        plateAppearances: Number(stat?.plateAppearances || 0),
        atBats: Number(stat?.atBats || 0),
        hits: Number(stat?.hits || 0)
      }
    ];
  }).filter(([playerId]) => playerId)));
  cachedRecentPlayerHittingStats.set(cacheKey, promise);
  return promise;
}

function enrichLineupWithRecentStats(lineup = [], recentStatsByPlayer = {}) {
  return (lineup || []).map((player) => {
    const recent = recentStatsByPlayer?.[player.playerId] || null;
    return {
      ...player,
      recent20: recent ? {
        avg: recent.avg,
        ops: recent.ops,
        plateAppearances: recent.plateAppearances,
        atBats: recent.atBats,
        hits: recent.hits
      } : null
    };
  });
}

function assignStatRanks(teamRows, statKey, { descending = true } = {}) {
  const ranked = teamRows
    .filter((row) => Number.isFinite(row?.stats?.[statKey]))
    .sort((left, right) => descending
      ? right.stats[statKey] - left.stats[statKey]
      : left.stats[statKey] - right.stats[statKey]);
  ranked.forEach((row, index) => {
    row.ranks ||= {};
    row.ranks[statKey] = index + 1;
  });
}

function computeTrendDifference(seasonValue, recentValue, invert = false) {
  if (!Number.isFinite(seasonValue) || !Number.isFinite(recentValue) || seasonValue === 0) return null;
  const raw = invert
    ? ((seasonValue - recentValue) / seasonValue) * 100
    : ((recentValue - seasonValue) / seasonValue) * 100;
  return Number(raw.toFixed(1));
}

function buildRecentFormRow(statKey, seasonRow, recentRow) {
  const invert = statKey === "kPct";
  return {
    statKey,
    seasonRank: seasonRow?.ranks?.[statKey] || null,
    seasonValue: seasonRow?.stats?.[statKey] ?? null,
    recentRank: recentRow?.ranks?.[statKey] || null,
    recentValue: recentRow?.stats?.[statKey] ?? null,
    differencePct: computeTrendDifference(seasonRow?.stats?.[statKey], recentRow?.stats?.[statKey], invert),
    improving: invert
      ? Number.isFinite(seasonRow?.stats?.[statKey]) && Number.isFinite(recentRow?.stats?.[statKey]) && recentRow.stats[statKey] < seasonRow.stats[statKey]
      : Number.isFinite(seasonRow?.stats?.[statKey]) && Number.isFinite(recentRow?.stats?.[statKey]) && recentRow.stats[statKey] > seasonRow.stats[statKey]
  };
}

async function buildRecentFormFacts(targetDate, oppTeamId) {
  const endDate = addDaysToDateISO(targetDate, -1);
  const season = String(targetDate).slice(0, 4);
  const teamEntries = Object.entries(TEAM_IDS);
  const snapshots = await Promise.all(teamEntries.map(async ([name, id]) => {
    const [seasonStat, recentStat] = await Promise.all([
      getTeamSeasonStats(id, "hitting", season),
      getTeamRecentHittingStats(id, endDate, 20)
    ]);
    return {
      teamId: id,
      teamName: name,
      season: { stats: normalizeTeamHittingSnapshot(seasonStat), ranks: {} },
      recent: { stats: normalizeTeamHittingSnapshot(recentStat), ranks: {} }
    };
  }));

  for (const statKey of ["ops", "avg", "bbPct"]) {
    assignStatRanks(snapshots.map((row) => row.season), statKey, { descending: true });
    assignStatRanks(snapshots.map((row) => row.recent), statKey, { descending: true });
  }
  assignStatRanks(snapshots.map((row) => row.season), "kPct", { descending: false });
  assignStatRanks(snapshots.map((row) => row.recent), "kPct", { descending: false });

  const buildTeamForm = (teamId) => {
    const team = snapshots.find((entry) => entry.teamId === teamId);
    if (!team) return null;
    return {
      teamId,
      teamName: team.teamName,
      rows: [
        buildRecentFormRow("ops", team.season, team.recent),
        buildRecentFormRow("avg", team.season, team.recent),
        buildRecentFormRow("kPct", team.season, team.recent),
        buildRecentFormRow("bbPct", team.season, team.recent)
      ]
    };
  };

  return {
    mets: buildTeamForm(TEAM_ID),
    opp: buildTeamForm(oppTeamId)
  };
}

function computeBattingAverageTrend(seasonAvg, recentAvg) {
  if (!Number.isFinite(seasonAvg) || !Number.isFinite(recentAvg) || seasonAvg === 0) return null;
  return Number((((recentAvg - seasonAvg) / seasonAvg) * 100).toFixed(1));
}

function buildHotColdAlert(lineup = []) {
  const candidates = (lineup || [])
    .map((player) => {
      const seasonAvg = parseNumber(player?.seasonAVG);
      const recentAvg = parseNumber(player?.recent20?.avg);
      return {
        playerId: player?.playerId || null,
        name: player?.name || "Player",
        seasonAvg,
        recentAvg,
        differencePct: computeBattingAverageTrend(seasonAvg, recentAvg)
      };
    })
    .filter((player) => Number.isFinite(player.seasonAvg) && Number.isFinite(player.recentAvg) && Number.isFinite(player.differencePct));
  if (!candidates.length) return { hot: null, cold: null };
  const sorted = [...candidates].sort((left, right) => right.differencePct - left.differencePct);
  const hot = sorted[0] || null;
  const cold = [...sorted].reverse()[0] || null;
  return { hot, cold };
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

function buildSingleTeamAdvanced(hittingStat, pitchingStat, roster = [], savantBattersByPlayer = {}, savantExpectedBattersByPlayer = {}, fangraphsTeam = null, leagueRanks = null, handednessSplit = null, vsHand = null) {
  const hitters = roster.filter((player) => player.primaryPosition?.abbreviation !== "P");
  const paFor = (player) => Number(player?.stats?.plateAppearances || savantBattersByPlayer[player.id]?.pa || savantExpectedBattersByPlayer[player.id]?.pa || (savantBattersByPlayer[player.id] || savantExpectedBattersByPlayer[player.id] ? 1 : 0));

  const battingTotal = fangraphsTeam?.battingTeamTotal || {};
  const pitchingTotal = fangraphsTeam?.pitchingTeamTotal || {};

  // Keep BB% and K% on a consistent percent scale here. Split stats arrive
  // as decimals, while season-total fallbacks are usually already percent-like.
  const splitBbPct = handednessSplit?.baseOnBalls != null && handednessSplit?.plateAppearances > 0
    ? computeRatePct(handednessSplit.baseOnBalls, handednessSplit.plateAppearances)
    : null;
  const splitKPct = handednessSplit?.strikeOuts != null && handednessSplit?.plateAppearances > 0
    ? computeRatePct(handednessSplit.strikeOuts, handednessSplit.plateAppearances)
    : null;
  const splitOps = handednessSplit?.ops != null ? parseFloat(handednessSplit.ops) : null;
  const splitAvg = handednessSplit?.avg != null ? parseFloat(handednessSplit.avg) : null;

  // Approximate wRC+ from split: MLB API doesn't return wRC+ directly in split endpoint.
  // Use OPS as proxy scaled to wRC+ range: league avg OPS ~.710 = wRC+ 100.
  // Formula: wRC+ ≈ (splitOPS / lgOPS) * 100, where lgOPS = 0.710.
  const LG_OPS = 0.710;
  const splitWrcPlusProxy = splitOps != null
    ? Math.round((splitOps / LG_OPS) * 100)
    : null;

  const usingSplit = handednessSplit != null;
  const fallbackNote = usingSplit ? null : (vsHand ? `season total (no ${vsHand}HP split available)` : "season total");

  if (usingSplit) {
    console.log(`[advanced] Using ${vsHand}HP split: PA=${handednessSplit.plateAppearances} OPS=${splitOps} K%=${splitKPct?.toFixed(1)} BB%=${splitBbPct?.toFixed(1)} wRC+~${splitWrcPlusProxy}`);
  } else {
    console.log(`[advanced] ${fallbackNote} — no split data`);
  }

  return {
    wrcPlus: splitWrcPlusProxy ?? (battingTotal['wRC+'] || deriveApproxWrcPlus(hittingStat)),
    woba: battingTotal['wOBA'] || null,
    iso: battingTotal['ISO'] || null,
    xba: weightedAverage(hitters, (player) => savantExpectedBattersByPlayer[player.id]?.est_ba, paFor) || hittingStat?.avg || null,
    xslg: weightedAverage(hitters, (player) => savantExpectedBattersByPlayer[player.id]?.est_slg, paFor),
    xwoba: weightedAverage(hitters, (player) => savantExpectedBattersByPlayer[player.id]?.est_woba, paFor),
    ops: splitOps ?? (battingTotal['OPS'] || hittingStat?.ops || null),
    avg: splitAvg ?? (battingTotal['AVG'] || hittingStat?.avg || null),
    hardHit: weightedAveragePct(hitters, (player) => savantBattersByPlayer[player.id]?.hard_hit_percent, paFor),
    barrelPct: weightedAveragePct(hitters, (player) => savantBattersByPlayer[player.id]?.barrel_batted_rate, paFor),
    bbPct: normalizePercentLikeValue(splitBbPct ?? battingTotal['BB%'] ?? pctFromCounts(hittingStat?.baseOnBalls, hittingStat?.plateAppearances)),
    kPct: normalizePercentLikeValue(splitKPct ?? battingTotal['K%'] ?? pctFromCounts(hittingStat?.strikeOuts, hittingStat?.plateAppearances)),
    rotFip: pitchingTotal['FIP'] || pitchingStat?.fip || null,
    rotXfip: pitchingTotal['xFIP'] || null,
    rotEra: pitchingTotal['ERA'] || pitchingStat?.era || null,
    rotWhip: pitchingStat?.whip || null,
    pitchKPct: pitchingTotal['K%'] || null,
    pitchBBPct: pitchingTotal['BB%'] || null,
    leagueRanks: leagueRanks || null,
    rankScope: leagueRanks ? 'MLB' : null,
    rankTotal: leagueRanks ? 30 : null,
    vsHand: vsHand || null,
    usingSplit,
    fallbackNote,
  };
}

async function buildTeamAdvancedFacts(metsTeamId, oppTeamId, metsPitcherHand = null, oppPitcherHand = null) {
  const season = String(getEasternYear());
  const metsName = Object.keys(TEAM_IDS).find((name) => TEAM_IDS[name] === metsTeamId) || TEAM_NAME;
  const oppName = Object.keys(TEAM_IDS).find((name) => TEAM_IDS[name] === oppTeamId) || null;

  // Mets offense faces OPP pitcher; OPP offense faces Mets pitcher
  const metsVsHand = oppPitcherHand || null;
  const oppVsHand  = metsPitcherHand || null;

  console.log(`[advanced] Pitcher hands — Mets SP: ${metsPitcherHand || "unknown"}, Opp SP: ${oppPitcherHand || "unknown"}`);
  console.log(`[advanced] Split context — Mets offense vs ${metsVsHand || "?"}HP, Opp offense vs ${oppVsHand || "?"}HP`);

  const [metsHitting, oppHitting, metsPitching, oppPitching, metsRoster, oppRoster,
         savantBatters, savantExpectedBatters, metsFg, oppFg, battingLeaderboard, pitchingLeaderboard,
         metsHittingSplit, oppHittingSplit] = await Promise.all([
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
    loadFangraphsLeaderboard('pit', 1, Number(season)),
    getTeamHandednessSplit(metsTeamId, metsVsHand, season),
    getTeamHandednessSplit(oppTeamId, oppVsHand, season),
  ]);

  const savantBattersByPlayer = Object.fromEntries(savantBatters.map((row) => [Number(row.player_id), row]));
  const savantExpectedBattersByPlayer = Object.fromEntries(savantExpectedBatters.map((row) => [Number(row.player_id), row]));
  const leagueRankMap = buildLeagueRankMap(battingLeaderboard, pitchingLeaderboard);

  return {
    mets: buildSingleTeamAdvanced(metsHitting, metsPitching, metsRoster, savantBattersByPlayer, savantExpectedBattersByPlayer, metsFg, leagueRankMap.NYM || null, metsHittingSplit, metsVsHand),
    opp: buildSingleTeamAdvanced(oppHitting, oppPitching, oppRoster, savantBattersByPlayer, savantExpectedBattersByPlayer, oppFg, leagueRankMap[normalizeTeamAbbr(TEAM_NAME_TO_ABBR[oppName] || oppName)] || null, oppHittingSplit, oppVsHand),
  };
}

async function getCompletedTeamScheduleGames(teamId, endDate) {
  const season = String(endDate).slice(0, 4);
  const startDate = `${season}-03-01`;
  const cacheKey = `${teamId}:${startDate}:${endDate}`;
  if (cachedTeamScheduleGames.has(cacheKey)) return cachedTeamScheduleGames.get(cacheKey);
  const promise = safeGetJson(
    `https://statsapi.mlb.com/api/v1/schedule?teamId=${teamId}&sportId=1&gameType=R&startDate=${startDate}&endDate=${endDate}&hydrate=linescore,team`,
    `schedule games ${teamId} ${startDate} ${endDate}`
  ).then((data) => {
    const games = [];
    for (const dateEntry of data?.dates || []) {
      for (const game of dateEntry.games || []) {
        const state = game?.status?.detailedState || "";
        if (!["Final", "Completed Early", "Game Over"].includes(state)) continue;
        const isHome = game?.teams?.home?.team?.id === teamId;
        const teamScore = Number(isHome ? game?.teams?.home?.score : game?.teams?.away?.score);
        const oppScore = Number(isHome ? game?.teams?.away?.score : game?.teams?.home?.score);
        games.push({
          date: dateEntry.date,
          homeAway: isHome ? "home" : "road",
          teamScore,
          oppScore
        });
      }
    }
    return games;
  });
  cachedTeamScheduleGames.set(cacheKey, promise);
  return promise;
}

async function getTeamRunDifferential(teamId, endDate, homeAway) {
  const games = await getCompletedTeamScheduleGames(teamId, endDate);
  const filtered = (games || []).filter((game) => game.homeAway === homeAway);
  if (!filtered.length) return null;
  const runsFor = filtered.reduce((sum, game) => sum + Number(game.teamScore || 0), 0);
  const runsAgainst = filtered.reduce((sum, game) => sum + Number(game.oppScore || 0), 0);
  return {
    homeAway,
    games: filtered.length,
    runsFor,
    runsAgainst,
    differential: runsFor - runsAgainst
  };
}

async function buildHomeAwayEdgeFacts(targetDate, oppTeamId) {
  const endDate = addDaysToDateISO(targetDate, -1);
  const [metsHome, oppRoad] = await Promise.all([
    getTeamRunDifferential(TEAM_ID, endDate, "home"),
    getTeamRunDifferential(oppTeamId, endDate, "road")
  ]);
  if (!metsHome || !oppRoad) return null;
  return { metsHome, oppRoad };
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
  const recentGames = [];
  for (const dateEntry of data?.dates || []) {
    for (const game of dateEntry.games || []) {
      const state = game?.status?.detailedState || "";
      if (!["Final", "Completed Early", "Game Over"].includes(state)) continue;
      const isHome = game?.teams?.home?.team?.id === teamId;
      const teamScore = isHome ? game?.teams?.home?.score : game?.teams?.away?.score;
      const oppScore = isHome ? game?.teams?.away?.score : game?.teams?.home?.score;
      const oppTeam = isHome ? game?.teams?.away?.team : game?.teams?.home?.team;
      const result = Number(teamScore) > Number(oppScore) ? "W" : "L";
      if (Number(teamScore) > Number(oppScore)) wins += 1;
      else losses += 1;
      recentGames.push({
        date: dateEntry.date,
        opponent: oppTeam?.name || "Opponent TBD",
        homeAway: isHome ? "home" : "road",
        result,
        score: `${teamScore}-${oppScore}`
      });
    }
  }

  return {
    wins,
    losses,
    recentGames: recentGames.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5)
  };
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
        h: split?.stat?.hits != null ? String(split.stat.hits) : "0",
        bb: split?.stat?.baseOnBalls != null ? String(split.stat.baseOnBalls) : "0",
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
    homeAway: metsAreHome ? "home" : "road",
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
    if (!fs.existsSync(API_ODDS_PATH)) {
      console.warn(`[odds] Cache file not found at ${API_ODDS_PATH} — odds will be null`);
      return { metsMoneyline: null, oppMoneyline: null, runLine: null, total: null };
    }
    const raw = fs.readFileSync(API_ODDS_PATH, "utf8");
    const cachedOdds = JSON.parse(raw);
    console.log(`[odds] Cache loaded — provider: ${cachedOdds?.provider || "unknown"}, markets: ${Array.isArray(cachedOdds?.markets) ? cachedOdds.markets.length : 0}`);
    if (!cachedOdds || (!Array.isArray(cachedOdds.markets) && !Array.isArray(cachedOdds?.consensus?.markets))) {
      console.warn(`[odds] Cache file exists but has no markets — odds will be null`);
      return { metsMoneyline: null, oppMoneyline: null, runLine: null, total: null };
    }

    const targetHomeTeam = game?.teams?.home?.team?.name || "";
    const targetAwayTeam = game?.teams?.away?.team?.name || "";
    const cachedHomeTeam = cachedOdds?.raw?.home_team || "";
    const cachedAwayTeam = cachedOdds?.raw?.away_team || "";
    const cachedGameDateEt = cachedOdds?.raw?.commence_time
      ? new Date(cachedOdds.raw.commence_time).toLocaleDateString("en-CA", { timeZone: TIME_ZONE })
      : null;
    const targetGameDate = game?.officialDate || null;
    const teamsMatch = cachedHomeTeam === targetHomeTeam && cachedAwayTeam === targetAwayTeam;
    const dateMatches = cachedGameDateEt === targetGameDate;

    if (cachedHomeTeam && cachedAwayTeam && (!teamsMatch || !dateMatches)) {
      console.warn(
        `[odds] Cache mismatch — cached ${cachedAwayTeam} @ ${cachedHomeTeam} on ${cachedGameDateEt || "unknown-date"}, `
        + `target ${targetAwayTeam} @ ${targetHomeTeam} on ${targetGameDate || "unknown-date"}`
      );
      return { metsMoneyline: null, oppMoneyline: null, runLine: null, total: null };
    }

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

    if (!moneylineMarket) {
      console.warn(`[odds] No moneyline market found in cache`);
    } else if (!metsOutcome) {
      console.warn(`[odds] Moneyline market found but no Mets outcome (team name: "${TEAM_NAME}")`);
    } else {
      console.log(`[odds] Mets ML: ${metsOutcome.price}, Opp ML: ${oppOutcome?.price ?? "null"}`);
    }

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
    console.warn(`[odds] Cache read failed: ${error.message}`);
    return {
      metsMoneyline: null,
      oppMoneyline: null,
      runLine: null,
      total: null
    };
  }
}

function isCompletedRegularSeasonGame(game) {
  const state = game?.status?.detailedState || "";
  return ["Final", "Completed Early", "Game Over"].includes(state);
}

async function getCachedGameFeed(gamePk) {
  if (!gamePk) return null;
  if (cachedGameFeeds.has(gamePk)) return cachedGameFeeds.get(gamePk);
  const promise = getGameFeed(gamePk);
  cachedGameFeeds.set(gamePk, promise);
  return promise;
}

function extractStartingPitcherFromFeed(feed, teamId) {
  if (!feed || !teamId) return null;
  const awayTeam = feed?.liveData?.boxscore?.teams?.away;
  const homeTeam = feed?.liveData?.boxscore?.teams?.home;
  const boxscoreTeam = awayTeam?.team?.id === teamId ? awayTeam : homeTeam?.team?.id === teamId ? homeTeam : null;
  const probable = feed?.gameData?.teams?.away?.id === teamId
    ? feed?.gameData?.probablePitchers?.away
    : feed?.gameData?.teams?.home?.id === teamId
      ? feed?.gameData?.probablePitchers?.home
      : null;
  const players = boxscoreTeam?.players || {};
  const starters = Object.values(players)
    .filter((player) => Number(player?.stats?.pitching?.gamesStarted || 0) > 0)
    .sort((left, right) => Number(right?.stats?.pitching?.inningsPitched || 0) - Number(left?.stats?.pitching?.inningsPitched || 0));
  const starter = starters[0]
    || (Array.isArray(boxscoreTeam?.pitchers) && boxscoreTeam.pitchers.length
      ? players[`ID${boxscoreTeam.pitchers[0]}`]
      : null);
  if (starter?.person?.id) {
    return {
      id: starter.person.id,
      name: starter.person.fullName || probable?.fullName || "Starting Pitcher"
    };
  }
  if (probable?.id) {
    return { id: probable.id, name: probable.fullName || "Starting Pitcher" };
  }
  return null;
}

async function buildGameFacts(targetDate) {
  const { requestedDate, resolvedDate, game, source, type, stale } = await resolveTargetGame(targetDate);
  if (type === "cached-game" && game?.opponent) {
    const fallbackFacts = {
      meta: {
        requestedDate,
        date: resolvedDate || targetDate,
        gameDateTime: parseCachedEtTimeToIso(resolvedDate || targetDate, game.time),
        time: game.time || "TBD",
        ballpark: game.ballpark || "Venue TBD",
        homeTeam: game.homeAway === "home" ? TEAM_NAME : game.opponent,
        awayTeam: game.homeAway === "road" ? TEAM_NAME : game.opponent,
        homeAway: game.homeAway === "away" ? "road" : (game.homeAway || "road")
      },
      records: {
        metsRecord: game.metsRecord || null,
        oppRecord: game.oppRecord || null,
        metsLast10: game.trends?.find((trend) => trend.category === "Last 10 Games")?.mets?.replace(/^Last 10\s*/i, "") || null,
        oppLast10: game.trends?.find((trend) => trend.category === "Last 10 Games")?.opp?.replace(/^Last 10\s*/i, "") || null,
        metsHome: game.recordSplits?.metsHome || null,
        metsRoad: game.recordSplits?.metsRoad || null,
        oppHome: game.recordSplits?.oppHome || null,
        oppRoad: game.recordSplits?.oppRoad || null
      },
      money: {
        metsMoneyline: game.moneyline?.mets ?? null,
        oppMoneyline: game.moneyline?.opp ?? null,
        total: game.total ?? game.overUnder ?? null,
        runLine: game.runLine
          ? {
              side: "mets",
              spread: game.runLine.mets ?? null,
              price: game.runLine.price ?? null
            }
          : null
      },
      pitching: {
        mets: game.pitching?.mets || {},
        opp: game.pitching?.opp || {},
        metsBullpen: game.pitching?.metsBullpen || {},
        oppBullpen: game.pitching?.oppBullpen || {}
      },
      lineups: {
        mets: game.lineups?.mets || [],
        opp: game.lineups?.opp || [],
        status: game.lineups?.lineupStatus || "projected"
      },
      trends: game.trends || [],
      editorial: game.editorial || {},
      injuries: [
        ...((game.gameContext?.metsInjuries || []).map((injury) => `Mets: ${injury.description || injury.name || injury}`)),
        ...((game.gameContext?.oppInjuries || []).map((injury) => `${game.opponent}: ${injury.description || injury.name || injury}`))
      ],
      gameContext: game.gameContext || {},
      advanced: {
        cards: game.advancedMatchup || [],
        savantTeam: { mets: null, opp: null },
        teamAdvanced: game.teamAdvanced || {}
      },
      recentForm: game.recentForm || null,
      emailData: game.emailData || null,
      weather: game.weather || null,
      game: {
        gamePk: game.gamePk || game.sourceGamePk || null,
        opponent: game.opponent,
        oppTeamId: game.oppTeamId || TEAM_IDS[game.opponent] || null,
        status: game.status || "upcoming",
        finalScore: game.finalScore || null,
        result: game.result || null,
        seriesGameNumber: game.gameContext?.seriesGameNumber || game.writeup?.analysisObject?.context?.seriesGameNumber || 1
      },
      canonicalGameSource: {
        source,
        stale: Boolean(stale),
        note: stale ? "Using local/cached game context because live schedule data was unavailable." : "Using local/cached game context."
      }
    };
    ensureNoUndefinedStrings(sanitizeForModel(fallbackFacts));
    return fallbackFacts;
  }
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

  // Resolve pitchers first so we can pass their hands into buildTeamAdvancedFacts
  const [metsPitcher, oppPitcher] = await Promise.all([
    getPitcherFacts(probablePitchers.mets?.id, probablePitchers.mets?.fullName, TEAM_NAME, resolvedDate),
    getPitcherFacts(probablePitchers.opp?.id, probablePitchers.opp?.fullName, oppTeam.name, resolvedDate)
  ]);
  const pitching = { mets: metsPitcher, opp: oppPitcher };

  const metsPitcherHand = metsPitcher?.hand || null;
  const oppPitcherHand  = oppPitcher?.hand  || null;
  console.log(`[gameFacts] Pitcher hands resolved — Mets: ${metsPitcherHand || "unknown"}, Opp: ${oppPitcherHand || "unknown"}`);

  const [lineups, metsBullpen, oppBullpen, teamAdvanced, recentForm, homeAwayEdge, metsRecentGames, oppRecentGames, headToHead, metsPitcherLog, oppPitcherLog, money, lastMeeting] = await Promise.all([
    buildLineupFacts(feed, oppTeam.id, resolvedDate),
    buildBullpenFacts(TEAM_ID, TEAM_NAME, true),
    buildBullpenFacts(oppTeam.id, oppTeam.name, false),
    buildTeamAdvancedFacts(TEAM_ID, oppTeam.id, metsPitcherHand, oppPitcherHand),
    buildRecentFormFacts(resolvedDate, oppTeam.id),
    buildHomeAwayEdgeFacts(resolvedDate, oppTeam.id),
    getTeamRecentGames(TEAM_ID, resolvedDate, 5),
    getTeamRecentGames(oppTeam.id, resolvedDate, 5),
    getHeadToHead(TEAM_ID, oppTeam.id, resolvedDate.slice(0, 4)),
    getPitcherRecentStarts(probablePitchers.mets?.id, resolvedDate, 4),
    getPitcherRecentStarts(probablePitchers.opp?.id, resolvedDate, 4),
    getOddsFacts(game),
    buildLastMeetingSummary(TEAM_ID, oppTeam.id, resolvedDate)
  ]);

  // Fetch career pitcher vs current roster matchup data (Savant statcast search)
  // Must run after both pitching and lineups are resolved so we have pitcher IDs + batter IDs
  const metsBatterIds = (lineups.mets || []).map((p) => p.playerId).filter(Boolean);
  const oppBatterIds = (lineups.opp || []).map((p) => p.playerId).filter(Boolean);
  const [metsVsRoster, oppVsRoster] = await Promise.all([
    fetchPitcherVsRoster(pitching.mets.mlbId, oppBatterIds),
    fetchPitcherVsRoster(pitching.opp.mlbId, metsBatterIds)
  ]);
  pitching.mets.vsRoster = mergeNonNullRosterMetrics(
    buildPitcherVsRosterSnapshot(lineups.opp, pitching.mets.savant),
    metsVsRoster
  );
  pitching.opp.vsRoster = mergeNonNullRosterMetrics(
    buildPitcherVsRosterSnapshot(lineups.mets, pitching.opp.savant),
    oppVsRoster
  );

  const metsTeamRow = null;
  const oppTeamRow = null;
  const previewBundle = extractPreviewBundle(content);

  const finalState = game?.status?.detailedState || "";
  const isFinal = ["Final", "Completed Early", "Game Over"].includes(finalState);
  const metsScore = isHome ? game?.teams?.home?.score : game?.teams?.away?.score;
  const oppScore = isHome ? game?.teams?.away?.score : game?.teams?.home?.score;
  const isOffDayPreview = requestedDate !== resolvedDate;

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
      recentSources: [previewBundle.source, lastMeeting?.source].filter(Boolean),
      previewMode: {
        isOffDayPreview,
        requestedDate,
        resolvedDate,
        bannerText: isOffDayPreview ? `OFF DAY — Previewing next game: ${oppTeam?.name || "Opponent TBD"} on ${resolvedDate}` : null
      }
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
    recentForm,
    emailData: {
      homeAwayEdge: homeAwayEdge || null
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
    },
    canonicalGameSource: {
      source: source || "external/mlb-stats",
      stale: Boolean(stale),
      note: source ? `Resolved via ${source}.` : "Resolved via external/mlb-stats."
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
    h: parseNumber(start.h),
    bb: parseNumber(start.bb),
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
  const mp = gameFacts.pitching?.mets || {};
  const op = gameFacts.pitching?.opp || {};
  const ta = gameFacts.advanced?.teamAdvanced || {};
  const metsTA = ta.mets || {};
  const oppTA = ta.opp || {};
  const metsBp = gameFacts.pitching?.metsBullpen || {};
  const oppBp = gameFacts.pitching?.oppBullpen || {};

  for (const edge of metsAngles.slice(0, 3)) {
    if (/overall lineup quality|lineup vs handedness/i.test(edge.category)) {
      const parts = [];
      if (metsTA.wrcPlus) parts.push(`wRC+ ${metsTA.wrcPlus} vs ${oppTA.wrcPlus || "N/A"}`);
      if (metsTA.xwoba) parts.push(`xwOBA ${metsTA.xwoba} vs ${oppTA.xwoba || "N/A"}`);
      whyMetsHaveCase.push(`Lineup: ${parts.length ? parts.join(", ") : "Mets grade higher in overall offensive quality"}.`);
    } else if (edge.category === "Starting Pitching") {
      const parts = [];
      if (mp.seasonERA) parts.push(`${mp.name}: ${mp.seasonERA} ERA`);
      if (mp.savant?.kPct) parts.push(`${mp.savant.kPct}% K rate`);
      if (mp.seasonFIP) parts.push(`${mp.seasonFIP} FIP`);
      if (op.seasonERA) parts.push(`vs ${op.name}: ${op.seasonERA} ERA`);
      if (op.seasonFIP) parts.push(`${op.seasonFIP} FIP`);
      whyMetsHaveCase.push(parts.length ? parts.join(", ") + "." : `${mp.name || "Mets SP"} has the better underlying pitching profile.`);
    } else if (edge.category === "Bullpen") {
      const parts = [];
      if (metsBp.seasonERA) parts.push(`Mets BP: ${metsBp.seasonERA} ERA`);
      if (metsBp.seasonXFIP) parts.push(`${metsBp.seasonXFIP} xFIP`);
      if (oppBp.seasonERA) parts.push(`Opp BP: ${oppBp.seasonERA} ERA`);
      if (oppBp.seasonXFIP) parts.push(`${oppBp.seasonXFIP} xFIP`);
      whyMetsHaveCase.push(parts.length ? `Bullpen: ${parts.join(", ")}.` : "Mets bullpen holds a seasonal edge in ERA and xFIP.");
    } else if (edge.category === "Regression Signals") {
      const parts = [];
      if (metsTA.xwoba && metsTA.woba) parts.push(`xwOBA ${metsTA.xwoba} vs actual wOBA ${metsTA.woba}`);
      whyMetsHaveCase.push(parts.length
        ? `Regression: ${parts.join(", ")} — expected stats above actual production.`
        : "Mets contact-quality metrics (xBA, xwOBA) are running ahead of actual results.");
    }
  }

  if (!whyMetsHaveCase.length) {
    whyMetsHaveCase.push("No single dominant Mets edge. Lineup quality is the primary case.");
  }

  for (const edge of riskAngles.slice(0, 2)) {
    if (edge.category === "Regression Signals") {
      whereRiskIs.push("Expected stats haven't converted to runs yet — production lags contact quality.");
    } else if (edge.category === "Starting Pitching") {
      const parts = [];
      if (op.savant?.kPct && mp.savant?.kPct) parts.push(`K% ${op.savant.kPct} vs ${mp.savant.kPct}`);
      if (op.seasonFIP && mp.seasonFIP) parts.push(`FIP ${op.seasonFIP} vs ${mp.seasonFIP}`);
      whereRiskIs.push(parts.length
        ? `${op.name || "Opp SP"} has the better pitching profile: ${parts.join(", ")}.`
        : `${op.name || "Opponent starter"} owns the better underlying pitching numbers.`);
    } else if (edge.category === "Bullpen") {
      whereRiskIs.push(`Bullpen edge is not clear-cut. Both sides carrying recent workload (Mets tax: ${metsBp.taxLevel || "N/A"}, Opp: ${oppBp.taxLevel || "N/A"}).`);
    } else if (edge.category === "Home/Away Split" || edge.category === "Context") {
      whereRiskIs.push(`Road/context splits lean against Mets. ${gameFacts.meta.homeAway === "away" ? "Away game." : ""}`);
    } else {
      whereRiskIs.push(edge.explanation || "Contextual factors slightly favor the opponent.");
    }
  }

  if (!whereRiskIs.length) {
    whereRiskIs.push("No standout risk factor. Missing-data load is the main concern.");
  }

  const ml = gameFacts.money?.metsMoneyline;
  const mlStr = ml != null ? (ml > 0 ? `+${ml}` : `${ml}`) : null;
  const leanStr = pick.analyticalLean || "Mixed";

  let bottomLine;
  if (leanStr === "Mets" || leanStr === "Slight Mets edge") {
    const topEdge = metsAngles[0]?.category || "lineup quality";
    bottomLine = `Model leans Mets${mlStr ? ` at ${mlStr}` : ""}. Primary edge: ${topEdge.toLowerCase()}.`;
  } else if (leanStr === "Opponent" || leanStr === "Slight opponent edge") {
    bottomLine = `Model leans opponent, but Mets ML is still the play based on the best available angle${mlStr ? ` at ${mlStr}` : ""}.`;
  } else {
    bottomLine = `Mixed board${mlStr ? `, Mets at ${mlStr}` : ""}. Pick based on strongest individual matchup edge.`;
  }

  return { whyMetsHaveCase, whereRiskIs, bottomLine };
}

function buildPickNarrative(gameFacts, edgeScoring, pick, analysisObject) {
  const metsPitcher  = gameFacts.pitching?.mets?.name  || "the Mets starter";
  const oppPitcher   = gameFacts.pitching?.opp?.name   || "the opposing starter";
  const opponent     = gameFacts.game?.opponent         || "the opponent";
  const ml           = gameFacts.money?.metsMoneyline;
  const mlStr        = ml != null ? (ml > 0 ? `+${ml}` : `${ml}`) : null;

  // Deterministic variation seed (prevents same opener every day)
  function hashPick(salt) {
    const key = `${gameFacts.meta?.date || ""}${metsPitcher}${salt}`;
    let h = 5381;
    for (let i = 0; i < key.length; i++) h = ((h << 5) + h) ^ key.charCodeAt(i);
    return Math.abs(h);
  }

  // --- PART 1: HOOK (recent streak context) ---
  const recentGames = gameFacts.gameContext?.metsRecentGames || [];
  const lastFive    = recentGames.slice(0, 5);
  const wins        = lastFive.filter(g => g.result === "W").length;
  const losses      = lastFive.filter(g => g.result === "L").length;

  let hook = "";
  if (lastFive.length >= 4 && wins >= 4) {
    const hookOpts = [
      `The Mets have won ${wins} of their last ${lastFive.length}, carrying some genuine momentum into today.`,
      `New York has been playing its best ball lately — ${wins}-${losses} over the last ${lastFive.length} games.`,
      `On a ${wins}-${losses} run over the last ${lastFive.length}, the Mets are in a good spot heading into this one.`
    ];
    hook = hookOpts[hashPick("hook") % hookOpts.length];
  } else if (lastFive.length >= 4 && losses >= 4) {
    const hookOpts = [
      `Mets are ${wins}-${losses} in their last ${lastFive.length} games.`,
      `New York has been grinding through a tough stretch — ${wins}-${losses} in the last ${lastFive.length} — which makes the price more interesting than the record suggests.`,
      `Coming in at ${wins}-${losses} over the last ${lastFive.length}, the Mets haven't found a rhythm lately, but the underlying case here isn't built on results.`
    ];
    hook = hookOpts[hashPick("hook") % hookOpts.length];
  } else if (lastFive.length >= 3) {
    const hookOpts = [
      `The Mets enter this one at ${wins}-${losses} over their last ${lastFive.length}, a mixed run that makes today more about the matchup than the streak.`,
      `New York is ${wins}-${losses} in their last ${lastFive.length}, which is about as split as it gets — so this one comes down to the specific read.`,
      `At ${wins}-${losses} over their last ${lastFive.length} games, the Mets are neither riding momentum nor running from a slump.`
    ];
    hook = hookOpts[hashPick("hook") % hookOpts.length];
  }

  // --- PART 2: PITCHER CASE (most specific stat available) ---
  const mp    = gameFacts.pitching?.mets || {};
  const op    = gameFacts.pitching?.opp  || {};
  const mFIP  = mp.seasonFIP  != null ? parseFloat(mp.seasonFIP)  : null;
  const oFIP  = op.seasonFIP  != null ? parseFloat(op.seasonFIP)  : null;
  const mXERA = mp.savant?.xERA != null ? parseFloat(mp.savant.xERA) : (mp.seasonXERA != null ? parseFloat(mp.seasonXERA) : null);
  const oXERA = op.savant?.xERA != null ? parseFloat(op.savant.xERA) : (op.seasonXERA != null ? parseFloat(op.seasonXERA) : null);
  const mWHIP = mp.seasonWHIP != null ? parseFloat(mp.seasonWHIP) : null;
  const oWHIP = op.seasonWHIP != null ? parseFloat(op.seasonWHIP) : null;
  const mKPct = mp.savant?.kPct != null ? parseFloat(mp.savant.kPct) : null;
  const oKPct = op.savant?.kPct != null ? parseFloat(op.savant.kPct) : null;
  const vsRoster = mp.vsRoster || {};

  let pitcherCase = "";

  if (mFIP != null && oFIP != null && (oFIP - mFIP) >= 1.0) {
    // Large FIP gap favoring Mets
    const gap = (oFIP - mFIP).toFixed(2);
    const opts = [
      `${metsPitcher} comes in with a ${mFIP.toFixed(2)} FIP against ${oppPitcher}'s ${oFIP.toFixed(2)} — a ${gap}-run gap that's the clearest edge on this board today.`,
      `The starting pitching split is hard to ignore: ${metsPitcher} at ${mFIP.toFixed(2)} FIP, ${oppPitcher} at ${oFIP.toFixed(2)}, a ${gap}-point advantage that anchors the Mets case.`,
      `On pure process numbers, ${metsPitcher} (${mFIP.toFixed(2)} FIP) has a ${gap}-run edge over ${oppPitcher} (${oFIP.toFixed(2)} FIP) — the kind of gap that shows up in outcomes over time.`
    ];
    pitcherCase = opts[hashPick("fip") % opts.length];
  } else if (mXERA != null && oXERA != null && (oXERA - mXERA) >= 0.4) {
    // xERA gap favoring Mets
    const gap = (oXERA - mXERA).toFixed(2);
    const opts = [
      `The xERA read splits in New York's favor: ${metsPitcher} at ${mXERA.toFixed(2)} versus ${oppPitcher}'s ${oXERA.toFixed(2)}, a ${gap}-run edge on contact-quality projection.`,
      `Statcast's expected ERA gives ${metsPitcher} (${mXERA.toFixed(2)}) a ${gap}-point edge over ${oppPitcher} (${oXERA.toFixed(2)}), which is real separation at the contact quality level.`,
      `${metsPitcher}'s ${mXERA.toFixed(2)} xERA stacks up favorably against ${oppPitcher}'s ${oXERA.toFixed(2)} — a ${gap}-run Statcast gap that's more signal than surface stat.`
    ];
    pitcherCase = opts[hashPick("xera") % opts.length];
  } else if (mWHIP != null && oWHIP != null && (oWHIP - mWHIP) >= 0.15) {
    // WHIP gap favoring Mets
    const opts = [
      `${metsPitcher} (${mWHIP.toFixed(2)} WHIP) has been cleaner than ${oppPitcher} (${oWHIP.toFixed(2)}) in terms of base traffic — fewer threats, fewer leverage situations for New York's opponents.`,
      `The WHIP gap — ${metsPitcher} at ${mWHIP.toFixed(2)}, ${oppPitcher} at ${oWHIP.toFixed(2)} — tells you who's been limiting baserunners, and that edge sits with the Mets.`
    ];
    pitcherCase = opts[hashPick("whip") % opts.length];
  } else if (mKPct != null && oKPct != null && (mKPct - oKPct) >= 3.0) {
    // K% gap favoring Mets pitcher
    const opts = [
      `${metsPitcher} owns a ${mKPct.toFixed(1)}% strikeout rate versus ${oppPitcher}'s ${oKPct.toFixed(1)}% — a real swing-and-miss gap that limits the damage any single hit can do.`,
      `The whiff profile favors New York: ${metsPitcher} at ${mKPct.toFixed(1)}% K-rate compared to ${oppPitcher}'s ${oKPct.toFixed(1)}% gives the Mets a legitimate strikeout edge today.`
    ];
    pitcherCase = opts[hashPick("kpct") % opts.length];
  } else if (vsRoster?.PA >= 30 && vsRoster?.AVG != null) {
    // Career vs roster data
    const avg = parseFloat(vsRoster.AVG).toFixed(3);
    const kRate = vsRoster.kPct != null ? ` with a ${parseFloat(vsRoster.kPct).toFixed(1)}% K-rate` : "";
    const opts = [
      `${metsPitcher} has a real track record against this ${opponent} roster — holding them to a ${avg} average${kRate} across ${vsRoster.PA} plate appearances — which adds some substance beyond the seasonal line.`,
      `The history matters here: ${metsPitcher} against the active ${opponent} roster is a ${avg} average${kRate} over ${vsRoster.PA} PAs, a sample large enough to say something real.`
    ];
    pitcherCase = opts[hashPick("vs") % opts.length];
  } else if (mFIP != null && oFIP != null) {
    // Small FIP gap or either direction — generic
    const metsAdv = mFIP < oFIP;
    if (metsAdv) {
      const opts = [
        `${metsPitcher} (${mFIP.toFixed(2)} FIP) edges out ${oppPitcher} (${oFIP.toFixed(2)}) on process numbers — not a massive split, but the advantage is real.`,
        `On underlying pitching metrics, ${metsPitcher}'s ${mFIP.toFixed(2)} FIP gives New York the marginal edge over ${oppPitcher} at ${oFIP.toFixed(2)}.`
      ];
      pitcherCase = opts[hashPick("fipsmall") % opts.length];
    } else {
      const opts = [
        `The pitching numbers actually lean toward ${oppPitcher} (${oFIP.toFixed(2)} FIP vs ${metsPitcher}'s ${mFIP.toFixed(2)}), which is the honest read — the Mets case has to come from elsewhere today.`,
        `${oppPitcher} holds the underlying pitching edge at ${oFIP.toFixed(2)} FIP compared to ${metsPitcher}'s ${mFIP.toFixed(2)}, so New York needs the offense to carry this one.`
      ];
      pitcherCase = opts[hashPick("fipbad") % opts.length];
    }
  } else {
    pitcherCase = `${metsPitcher} vs ${oppPitcher}. SP underlying splits unavailable — ERA comparison only.`;
  }

  // --- PART 3: SUPPORT ANGLE ---
  const ta        = gameFacts.advanced?.teamAdvanced || {};
  const metsTA    = ta.mets || {};
  const rotRank   = metsTA.leagueRanks?.rotFip;
  const wrcRank   = metsTA.leagueRanks?.wrcPlus;
  const wrcPlus   = metsTA.wrcPlus;

  // Check regression signals from edgeScoring
  const hasRegressionEdge = edgeScoring.categories
    .some(e => e.category === "Regression Signals" && e.edge === "Mets edge");
  const hasBullpenEdge = edgeScoring.categories
    .some(e => e.category === "Bullpen" && e.edge === "Mets edge");

  let supportAngle = "";
  if (rotRank != null && rotRank <= 12) {
    const opts = [
      `Mets rotation ranks ${rotRank}${ordinalSuffix(rotRank).slice(-2)} in MLB by FIP this season.`,
      `Mets rotation is ${rotRank}${ordinalSuffix(rotRank).slice(-2)} in MLB by FIP.`
    ];
    supportAngle = opts[hashPick("rotrank") % opts.length];
  } else if (hasRegressionEdge && wrcPlus != null && wrcRank != null) {
    const opts = [
      `The supporting angle is offense: New York's ${wrcPlus} wRC+ ranks ${ordinalSuffix(wrcRank)} in MLB, and the underlying contact quality suggests the production hasn't fully caught up to the expected output yet.`,
      `On the offensive side, the Mets are ${ordinalSuffix(wrcRank)} in wRC+ at ${wrcPlus}, and Statcast-based metrics show a team that should be generating more damage than the results have shown — a positive-regression setup.`
    ];
    supportAngle = opts[hashPick("wrc") % opts.length];
  } else if (hasBullpenEdge) {
    const opts = [
      `Mets bullpen xERA advantage is the secondary edge if the game is close in the middle innings.`,
      `Mets bullpen xERA holds a seasonal edge over the opponent's relief corps.`
    ];
    supportAngle = opts[hashPick("bp") % opts.length];
  } else if (wrcPlus != null && wrcRank != null && wrcRank <= 15) {
    const opts = [
      `The offensive support is real: a ${wrcPlus} wRC+ ranking ${ordinalSuffix(wrcRank)} in MLB means the Mets lineup is genuinely above average at generating expected run value.`,
      `New York's offense ranks ${ordinalSuffix(wrcRank)} in wRC+ at ${wrcPlus} — a legitimate offensive group that gives today's starter a real margin to work with.`
    ];
    supportAngle = opts[hashPick("wrcgood") % opts.length];
  } else {
    supportAngle = "No dominant secondary edge found in the data — SP matchup is the primary factor.";
  }

  // --- PART 4: CLOSE (calibrated to analyticalLean) ---
  const lean = pick?.analyticalLean || "Mixed";
  let close = "";

  if (lean === "Mets") {
    const opts = [
      mlStr
        ? `New York at ${mlStr} is the play — the board has the cleaner shape on the Mets side and the price still offers value for the matchup.`
        : `The board has the cleaner shape on the Mets side, and that's the play.`,
      mlStr ? `Mets ML ${mlStr}. SP and offense edges align.` : `SP and offense edges align.`,
      mlStr ? `Mets ML ${mlStr}. Both SP edge and offense lean in the same direction.` : `SP edge and offense lean align.`
    ];
    close = opts[hashPick("close") % opts.length];
  } else if (lean === "Slight Mets edge") {
    const opts = [
      mlStr
        ? `The board gives New York a slim edge, and ${mlStr} is where the value is — tight, but still the right side.`
        : `The board gives New York a slim edge — the pick is Mets ML, though with measured conviction.`,
      `This isn't a slam-dunk spot, but the Mets have the marginal lean and the matchup supports taking it at this price.`,
      `Mets ML, but held loosely — the edge is real, just not overwhelming.`
    ];
    close = opts[hashPick("close") % opts.length];
  } else if (lean === "Opponent" || lean === "Slight opponent edge") {
    const opts = [
      `The honest read is that today's case is thinner than a full-model endorsement, but the clearest Mets path is still playable${mlStr ? ` at ${mlStr}` : ""} — this is a lean, not a conviction bet.`,
      `The model doesn't love this spot, but the Mets' best-case path is real enough to back at this price — just not with heavy confidence.`,
      `Taking the Mets here as the best available path, not a strong analytical endorsement — the board leans the other way, but the price and the case hold up.`
    ];
    close = opts[hashPick("close") % opts.length];
  } else {
    // Mixed
    const opts = [
      `The board is split, so today's pick leans on the clearest specific angle rather than overall model conviction${mlStr ? ` — Mets ML at ${mlStr}` : ""}.`,
      `Mixed board, but the Mets still get the pick — the strongest individual angle tips it in New York's direction even without a clean all-green read.`,
      `On a board this balanced, the bet comes down to which specific edge you trust most${mlStr ? `, and at ${mlStr}` : ""} the Mets case is the one worth backing.`
    ];
    close = opts[hashPick("close") % opts.length];
  }

  // Assemble paragraph — filter empty parts
  const parts = [hook, pitcherCase, supportAngle, close].filter(s => s && s.trim().length > 0);
  return parts.join(" ");
}

function ordinalSuffix(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
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
          return `Lineup: Mets project higher in offensive quality (WAR, xwOBA) against ${gameFacts.pitching.opp.name || "this opponent"}.`;
        }
        if (edge.category === "Starting Pitching") {
          return `${gameFacts.pitching.mets.name}: better run-prevention profile in ERA, FIP, and/or xERA.`;
        }
        if (edge.category === "Bullpen") {
          return `Bullpen: Mets hold a seasonal ERA/xFIP edge in relief.`;
        }
        return edge.explanation;
      }).join(" ")
    : "Primary case: Mets lineup quality edge. No other dominant angle.";
  const whereRisk = riskAngles.length
    ? riskAngles.slice(0, 2).map((edge) => {
        if (edge.category === "Regression Signals") {
          return `Regression risk: expected offensive stats (xBA, xwOBA) running ahead of actual production.`;
        }
        if (edge.category === "Starting Pitching") {
          return `${gameFacts.pitching.opp.name} has the better K-BB% profile.`;
        }
        if (edge.category === "Bullpen") {
          return `Bullpen edge is unclear — both sides carrying recent workload.`;
        }
        if (edge.category === "Home/Away Split" || edge.category === "Context") {
          return `Road/context splits lean slightly against Mets.`;
        }
        return edge.explanation;
      }).join(" ")
    : "No standout risk. Limited data keeps conviction measured.";
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
      officialPickSummaryParts.push("Main case: projected lineup grades higher in xwOBA and WAR.");
    } else if (proMetsOfficialAngles[0].category === "Starting Pitching") {
      officialPickSummaryParts.push(`Primary edge: ${gameFacts.pitching.mets.name}'s run-prevention metrics.`);
    } else if (proMetsOfficialAngles[0].category === "Bullpen") {
      officialPickSummaryParts.push("Secondary edge: Mets bullpen holds a seasonal metrics advantage.");
    } else {
      officialPickSummaryParts.push(proMetsOfficialAngles[0].explanation);
    }
  }
  if (proMetsOfficialAngles[1]) {
    if (proMetsOfficialAngles[1].category === "Regression Signals") {
      officialPickSummaryParts.push("Supporting factor: contact quality metrics suggest positive regression ahead.");
    } else {
      officialPickSummaryParts.push(proMetsOfficialAngles[1].explanation);
    }
  }
  if (pick.analyticalLean === "Opponent" || pick.analyticalLean === "Slight opponent edge" || pick.analyticalLean === "Mixed") {
    officialPickSummaryParts.push("Note: model does not fully favor Mets. Pick is based on the best supported individual angle.");
  }
  const pickSummary = officialPickSummaryParts.filter(Boolean).slice(0, 3).join(" ");
  const pickNarrative = buildPickNarrative(gameFacts, edgeScoring, pick, analysisObject);
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
    pickNarrative,
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

  const fallbackWriteup = {
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
    pitchingEdgeSummary: `${metsPitcher} vs ${oppPitcher} — underlying splits unavailable.`,
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
      { heading: "9. Official MetsMoneyline Pick", body: `SP and bullpen underlying data unavailable for this fallback — analysis based on surface stats only.` }
    ],
    pickSummary: `SP and bullpen underlying data unavailable for this fallback — analysis based on surface stats only.`,
    officialPick: "Official Pick: Mets ML",
    analyticalLean: "Mets"
  };
  return applyTodayPickToWriteup(
    fallbackWriteup,
    buildDeterministicTodayPick(gameFacts, fallbackWriteup, null, null)
  );
}

async function generateWriteupFromFacts(gameFacts) {
  const analysisObject = buildGameAnalysisObject(gameFacts);
  const missingMetrics = buildMissingMetricsList(analysisObject);
  const edgeScoring = buildEdgeScoring(analysisObject);
  const baseWriteup = buildAdvancedWriteup(gameFacts, analysisObject, edgeScoring, missingMetrics);
  const fallbackTodayPick = buildDeterministicTodayPick(gameFacts, baseWriteup, analysisObject, edgeScoring);
  const gameContext = buildGrokTodayPickContext(gameFacts, analysisObject, edgeScoring, fallbackTodayPick);

  try {
    console.log(grokApiKey ? "Generating Today's Pick with Grok" : "Using deterministic fallback for Today's Pick (missing GROK_API_KEY)");
    const todayPick = await requestGrokTodayPick(gameContext, fallbackTodayPick);
    return applyTodayPickToWriteup(baseWriteup, todayPick);
  } catch (error) {
    console.warn(`[warn] Grok Today's Pick failed: ${error.message}`);
    console.log("Using deterministic fallback for Today's Pick");
    return applyTodayPickToWriteup(baseWriteup, fallbackTodayPick);
  }
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

function formatReportAverage(value) {
  if (!Number.isFinite(value)) return "N/A";
  const fixed = Number(value).toFixed(3);
  return fixed.startsWith("0") ? fixed.slice(1) : fixed;
}

function formatReportPct(value, digits = 1) {
  if (!Number.isFinite(value)) return "N/A";
  return `${Number(value).toFixed(digits)}%`;
}

function formatRecentFormDiff(value) {
  if (!Number.isFinite(value)) return "N/A";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function buildBullpenPresentationCard(teamName, teamId, bullpen = {}) {
  const closer = bullpen?.closer || null;
  return {
    teamName,
    teamId,
    usage: bullpen?.usage || { label: "Low", tone: "green" },
    statsRow: {
      seasonEra: parseNumber(bullpen?.seasonERA),
      seasonWhip: parseNumber(bullpen?.seasonWHIP),
      last20Era: parseNumber(bullpen?.last20ERA)
    },
    closer: closer ? {
      name: closer.name,
      playerId: closer.playerId,
      saves: closer.saves,
      saveOpportunities: closer.saveOpportunities,
      saveConversionPct: closer.saveConversionPct,
      era: closer.era,
      whip: closer.whip,
      last7DaysAppearances: closer.last7DaysAppearances,
      last7DaysInningsPitched: closer.last7DaysInningsPitched
    } : null
  };
}

function buildRecentFormPresentationReport(game) {
  const recentForm = game?.recentForm || null;
  if (!recentForm) return null;
  return {
    mets: recentForm.mets || null,
    opp: recentForm.opp || null
  };
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
  const seasonLabel = String(game?.date || writeup.gameDetails?.date || "").slice(0, 4) || String(getEasternYear());
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
  const todayPickFallback = {
    headline: "Mets ML Pick",
    summary: stripUnsupportedPickLanguage(writeup.pickNarrative || writeup.pickSummary || "The official Mets side stays on the moneyline based on the current in-house matchup read."),
    metsEdges: normalizeTodayPickList(writeup.analysis?.whyMetsHaveACase, 3, ["The current matchup data still leaves New York with a viable offensive or run-prevention edge."]),
    risks: normalizeTodayPickList(writeup.analysis?.whereTheRiskIs, 2, ["The game script still carries enough volatility to keep confidence measured."]),
    bettingAngle: stripUnsupportedPickLanguage(writeup.pickSummary || "The best supported path still points to Mets ML."),
    officialPick: "Mets ML",
    confidenceLabel: mapDeterministicConfidenceToTodayPick(writeup.analyticalLean, writeup.confidence),
    confidenceScore: TODAY_PICK_CONFIDENCE_SCORE[mapDeterministicConfidenceToTodayPick(writeup.analyticalLean, writeup.confidence)] || TODAY_PICK_CONFIDENCE_SCORE.Lean
  };
  const todayPick = normalizeTodayPickPayload(writeup.todayPick || todayPickFallback, todayPickFallback);
  const preliminaryTitle = preliminaryMeta?.enabled
    ? `${preliminaryMeta.titlePrefix || "PRELIMINARY REPORT"} - ${headline}`
    : headline;
  const bullpenReport = {
    mets: buildBullpenPresentationCard("New York Mets", TEAM_ID, pitching.metsBullpen),
    opp: buildBullpenPresentationCard(game?.opponent || "Opponent", game?.oppTeamId || null, pitching.oppBullpen)
  };
  const recentFormReport = buildRecentFormPresentationReport(game);
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
    _situationalSplits: game?.situationalSplits || null,
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
            { label: "Barrel %", left: pitching.mets?.savant?.barrelPct || null, leftPercentile: pitching.mets?.savant?.percentiles?.barrelPct ?? null, leftMetricLabel: "Pitcher Barrel %", right: analysisObject?.offense?.opp?.barrelPct || null, rightMetricLabel: "Batter Barrel %", rightRankKey: "barrelPct" },
            { label: "xBA", left: pitching.mets?.savant?.xBAAllowed || null, leftPercentile: pitching.mets?.savant?.percentiles?.xBAAllowed ?? null, leftMetricLabel: "Pitcher xBA", right: analysisObject?.offense?.opp?.xBA || null, rightMetricLabel: "Batter xBA", rightRankKey: "xba" },
            { label: "Hard Hit %", left: pitching.mets?.savant?.hardHitPct || null, leftPercentile: pitching.mets?.savant?.percentiles?.hardHitPct ?? null, leftMetricLabel: "Pitcher Hard Hit %", right: analysisObject?.offense?.opp?.hardHitPct || null, rightMetricLabel: "Batter Hard Hit %", rightRankKey: "hardHit" },
            { label: "xSLG %", left: pitching.mets?.savant?.xSLGAllowed || null, leftPercentile: pitching.mets?.savant?.percentiles?.xSLGAllowed ?? null, leftMetricLabel: "Pitcher xSLG %", right: analysisObject?.offense?.opp?.xSLG || null, rightMetricLabel: "Batter xSLG %", rightRankKey: "xslg" }
          ]
        },
        {
          title: "Opponent Advanced Stats vs Mets",
          leftHeader: `${oppAbbr} ${pitching.opp?.name || "Opponent SP"}`,
          rightHeader: "NYM Offense",
          rightTeamKey: "mets",
          rows: [
            { label: "Barrel %", left: pitching.opp?.savant?.barrelPct || null, leftPercentile: pitching.opp?.savant?.percentiles?.barrelPct ?? null, leftMetricLabel: "Pitcher Barrel %", right: analysisObject?.offense?.mets?.barrelPct || null, rightMetricLabel: "Batter Barrel %", rightRankKey: "barrelPct" },
            { label: "xBA", left: pitching.opp?.savant?.xBAAllowed || null, leftPercentile: pitching.opp?.savant?.percentiles?.xBAAllowed ?? null, leftMetricLabel: "Pitcher xBA", right: analysisObject?.offense?.mets?.xBA || null, rightMetricLabel: "Batter xBA", rightRankKey: "xba" },
            { label: "Hard Hit %", left: pitching.opp?.savant?.hardHitPct || null, leftPercentile: pitching.opp?.savant?.percentiles?.hardHitPct ?? null, leftMetricLabel: "Pitcher Hard Hit %", right: analysisObject?.offense?.mets?.hardHitPct || null, rightMetricLabel: "Batter Hard Hit %", rightRankKey: "hardHit" },
            { label: "xSLG %", left: pitching.opp?.savant?.xSLGAllowed || null, leftPercentile: pitching.opp?.savant?.percentiles?.xSLGAllowed ?? null, leftMetricLabel: "Pitcher xSLG %", right: analysisObject?.offense?.mets?.xSLG || null, rightMetricLabel: "Batter xSLG %", rightRankKey: "xslg" }
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
            { label: "K%", left: pitching.mets?.savant?.kPct || null, leftPercentile: pitching.mets?.savant?.percentiles?.kPct ?? null, leftMetricLabel: "Pitcher K%", right: analysisObject?.offense?.opp?.kPct || null, rightMetricLabel: "Batter K%", rightRankKey: "kPct" },
            { label: "BB%", left: pitching.mets?.savant?.bbPct || null, leftPercentile: pitching.mets?.savant?.percentiles?.bbPct ?? null, leftMetricLabel: "Pitcher BB%", right: analysisObject?.offense?.opp?.bbPct || null, rightMetricLabel: "Batter BB%", rightRankKey: "bbPct" }
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
            { label: "K%", left: pitching.opp?.savant?.kPct || null, leftPercentile: pitching.opp?.savant?.percentiles?.kPct ?? null, leftMetricLabel: "Pitcher K%", right: analysisObject?.offense?.mets?.kPct || null, rightMetricLabel: "Batter K%", rightRankKey: "kPct" },
            { label: "BB%", left: pitching.opp?.savant?.bbPct || null, leftPercentile: pitching.opp?.savant?.percentiles?.bbPct ?? null, leftMetricLabel: "Pitcher BB%", right: analysisObject?.offense?.mets?.bbPct || null, rightMetricLabel: "Batter BB%", rightRankKey: "bbPct" }
          ]
        }
      ],
      summary: writeup.pitchingEdgeSummary || null
    },
    bullpenReport,
    recentFormReport,
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
        { label: "Hard-Hit%", metricLabel: "Batter Hard-Hit%", mets: analysisObject?.offense?.opp?.hardHitPct || null, opp: analysisObject?.offense?.mets?.hardHitPct || null },
        { label: "Barrel%", metricLabel: "Batter Barrel%", mets: analysisObject?.offense?.opp?.barrelPct || null, opp: analysisObject?.offense?.mets?.barrelPct || null },
        { label: "K%", metricLabel: "Batter K%", mets: analysisObject?.offense?.opp?.kPct || null, opp: analysisObject?.offense?.mets?.kPct || null },
        { label: "BB%", metricLabel: "Batter BB%", mets: analysisObject?.offense?.opp?.bbPct || null, opp: analysisObject?.offense?.mets?.bbPct || null }
      ]
    },
    pitcherSplitMatchup: {
      metsPitcher: pitching.mets?.name || "TBD",
      oppPitcher: pitching.opp?.name || "TBD",
      pitcherRows: [
        { label: "Pitcher Hand", mets: pitching.mets?.hand || null, opp: pitching.opp?.hand || null },
        { label: "Opponent Lineup wRC+", mets: analysisObject?.offense?.opp?.projectedLineupWRCPlus || null, opp: analysisObject?.offense?.mets?.projectedLineupWRCPlus || null },
        { label: "Opponent xwOBA", mets: analysisObject?.offense?.opp?.xwOBA || null, opp: analysisObject?.offense?.mets?.xwOBA || null },
        { label: "Opponent K%", metricLabel: "Opponent K%", mets: analysisObject?.offense?.opp?.kPct || null, opp: analysisObject?.offense?.mets?.kPct || null },
        { label: "Opponent BB%", metricLabel: "Opponent BB%", mets: analysisObject?.offense?.opp?.bbPct || null, opp: analysisObject?.offense?.mets?.bbPct || null }
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
    todayPick,
    officialPick: {
      label: writeup.officialPick || "Official Pick: Mets ML",
      explanation: todayPick.bettingAngle || writeup.pickSummary || null,
      headline: todayPick.headline,
      summary: todayPick.summary,
      metsEdges: todayPick.metsEdges,
      risks: todayPick.risks,
      bettingAngle: todayPick.bettingAngle,
      confidenceLabel: todayPick.confidenceLabel,
      confidence: todayPick.confidenceScore
    },
    meta: {
      homeAwayLabel,
      moneylineValue,
      schedulingSpot,
      weatherSummary
    }
  };
}

function stripLegacySosPayload(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripLegacySosPayload(item))
      .filter((item) => item !== null);
  }
  if (value && typeof value === "object") {
    if (value.category === "SoS Analytics") return null;
    const cleaned = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "sos" || key === "sosAnalytics" || key === "sosInsights") continue;
      const sanitized = stripLegacySosPayload(entry);
      if (sanitized !== null) cleaned[key] = sanitized;
    }
    return cleaned;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        return JSON.stringify(stripLegacySosPayload(JSON.parse(value)));
      } catch {
        return value
          .replace(/\bSoS Analytics\b/g, "")
          .replace(/\s*\|\s*SoS Analytics:[^|]*/g, "")
          .replace(/Schedule-adjusted lens:[^.]*\./g, "")
          .replace(/\s{2,}/g, " ")
          .trim();
      }
    }
    return value
      .replace(/\bSoS Analytics\b/g, "")
      .replace(/\s*\|\s*SoS Analytics:[^|]*/g, "")
      .replace(/Schedule-adjusted lens:[^.]*\./g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  return value;
}


/* ── Situational splits from game-log.json ─────────────────────────────────────
   Reads the pre-built game log and returns compact W-L stats for the current
   game's matchup (opponent, H/A, day/night, day of week, combined H/A+day/night).
   Returns null on any failure so callers can degrade gracefully.                */
function loadSituationalSplits(gameFacts) {
  try {
    const logPath = path.join(__dirname, "..", "public", "data", "game-log.json");
    if (!fs.existsSync(logPath)) return null;
    const raw  = fs.readFileSync(logPath, "utf8");
    const data = JSON.parse(raw);
    const games = (data.games || []).filter(g => g.result === "W" || g.result === "L");
    if (!games.length) return null;

    const oppAbbr = TEAM_NAME_TO_ABBR[gameFacts.game.opponent]
      || gameFacts.game.opponent.split(" ").pop().toUpperCase().slice(0, 3);
    const ha      = gameFacts.meta.homeAway === "home" ? "home" : "away";
    const tod     = gameFacts.meta.time
      ? (/^(1[0-9]|2[0-3]):[0-5][0-9]/.test(gameFacts.meta.time) ? "night" : "day")
      : "night";
    // Derive day of week from the game date
    const gameDate   = gameFacts.meta.date || getTodayEasternISO();
    const dowIndex   = new Date(gameDate + "T12:00:00").getDay();
    const dowName    = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][dowIndex];
    const haLabel    = ha === "home" ? "Home" : "Away";
    const todLabel   = tod === "day"  ? "Day"  : "Night";
    const haFull     = ha === "home" ? "home" : "road";

    function buildRow(label, filterFn) {
      const g = games.filter(filterFn);
      if (!g.length) return null;
      const w = g.filter(x => x.result === "W").length;
      const l = g.length - w;
      const withRuns = g.filter(x => x.metsRuns != null);
      const avgR = withRuns.length
        ? +(withRuns.reduce((s,x)=>s+(x.metsRuns||0),0)/withRuns.length).toFixed(1) : null;
      const avgA = withRuns.length
        ? +(withRuns.reduce((s,x)=>s+(x.oppRuns||0),0)/withRuns.length).toFixed(1) : null;
      const pct  = Math.round(w/g.length*100);
      return { label, w, l, pct, avgR, avgA, games: g.length };
    }

    return {
      vsOpponent:   buildRow(`vs ${oppAbbr}`, g => g.oppAbbr === oppAbbr),
      homeAway:     buildRow(`${haLabel} games`, g => g.homeAway === haFull),
      timeOfDay:    buildRow(`${todLabel} games`, g => g.timeOfDay === tod),
      dayOfWeek:    buildRow(`${dowName}s`, g => g.dayOfWeek === dowName),
      combined:     buildRow(`${haLabel} ${todLabel.toLowerCase()}s`, g => g.homeAway === haFull && g.timeOfDay === tod),
      meta: { oppAbbr, ha, tod, dow: dowName }
    };
  } catch (e) {
    console.warn("[situational-splits] Failed to load:", e.message);
    return null;
  }
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
    recentForm: gameFacts.recentForm || null,
    emailData: gameFacts.emailData || null,
    gameContext: gameFacts.gameContext,
    canonicalGameSource: gameFacts.canonicalGameSource || null,
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
      pickNarrative: writeup.pickNarrative || null,
      todayPick: writeup.todayPick || null,
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
    weather: gameFacts.weather || null,
    situationalSplits: loadSituationalSplits(gameFacts)
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

  const output = stripLegacySosPayload({
    generatedAt: new Date().toISOString(),
    referenceDate: gameFacts.meta.requestedDate || gameFacts.meta.date,
    cacheKey: buildDateScopedCacheKey("sample-game", gameFacts.meta.requestedDate || gameFacts.meta.date),
    games,
    recentBreakdowns: mergeRecentBreakdowns(previousOutput, currentGame, Array.isArray(pickHistory?.entries) ? pickHistory.entries : [])
  });

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
  const heatCell = (label, value, percentileOverride = null, metricLabel = null) => {
    const resolvedLabel = metricLabel || label;
    const style = label === "WAR" || resolvedLabel === "WAR" || resolvedLabel === "Lineup WAR"
      ? reportWarCellStyle(value)
      : (() => {
        if (percentileOverride != null) return reportCellToneStyle(percentileOverride);
        const pct = reportMetricPct(resolvedLabel, value);
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
            <td style="padding:9px 8px;border-bottom:1px solid #f0f2f5;text-align:center;color:#111827;">${heatCell(row.label, row.mets, null, row.metricLabel)}</td>
            <td style="padding:9px 8px;border-bottom:1px solid #f0f2f5;text-align:center;color:#111827;">${heatCell(row.label, row.opp, null, row.metricLabel)}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
  const renderContextNote = (value, kind = "rank") => {
    if (!value) return ``;
    const label = kind === "percentile" ? `${ordinalSuffix(value)} %ile` : `#${value} MLB`;
    return `<span style="display:block;font-size:11px;line-height:1.15;color:#6b7280;font-weight:700;white-space:nowrap;">${label}</span>`;
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
                      <div>${heatCell(row.label, row.left, row.leftPercentile ?? null, row.leftMetricLabel)}</div>
                      ${row.leftPercentile != null ? `<div style="margin-top:4px;font-size:11px;line-height:1.2;color:#6b7280;font-weight:700;white-space:normal;">${ordinalSuffix(row.leftPercentile)} %ile</div>` : ""}
                    </div>
                  </td>
                  <td valign="top" style="width:50%;padding:10px;background:#fff7ef;">
                    <div style="font-size:11px;line-height:1.2;color:#7c2d12;font-weight:800;margin-bottom:6px;text-align:right;">${valueCell(table.rightHeader)}</div>
                    <div style="padding:8px 0 8px 8px;vertical-align:top;">
                      <div style="${smallLabel}margin-bottom:4px;color:#6b7280;">${valueCell(row.label)}</div>
                      <div>${heatCell(row.label, row.right, null, row.rightMetricLabel)}</div>
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
      ? `<img src="${pitcherImageSrc}" alt="${valueCell(card.name)} headshot for Mets betting report" width="96" height="96" loading="lazy" decoding="async" style="display:block;width:96px;height:96px;border-radius:16px;object-fit:cover;border:1px solid #d6dde8;background:#ffffff;margin:0 auto;">`
      : `<div style="width:96px;height:96px;border-radius:16px;border:1px solid #d6dde8;background:#f3f4f6;color:#94a3b8;text-align:center;line-height:96px;font-size:32px;margin:0 auto;">&#9918;</div>`;
    const emailStatBar = (label, value) => {
      const pct = reportMetricPct(label, value);
      const shown = valueCell(value);
      if (pct == null) return `
        <tr>
          <td style="width:40px;font-size:11px;font-weight:600;color:#6b7280;padding:4px 6px 4px 0;white-space:nowrap;vertical-align:middle;">${label}</td>
          <td style="padding:4px 0;vertical-align:middle;"><span style="font-size:12px;font-weight:700;color:#111827;">${shown}</span></td>
        </tr>`;

      const color = reportPctlColor(pct);
      const avg = ADVCELL_MLB_AVG[label];
      const barTotalPx = 120;
      const fillPx = Math.round((pct / 100) * barTotalPx);
      const emptyPx = barTotalPx - fillPx;

      return `
        <tr>
          <td style="width:40px;font-size:11px;font-weight:600;color:#6b7280;padding:4px 6px 8px 0;white-space:nowrap;vertical-align:top;">${label}</td>
          <td style="padding:4px 0 8px 0;vertical-align:top;">
            <div style="font-size:13px;font-weight:800;color:#111827;margin-bottom:3px;">${shown}</div>
            <table role="presentation" style="border-collapse:collapse;border-spacing:0;height:10px;">
              <tr>
                <td style="width:${fillPx}px;height:10px;background:${color};border-radius:3px 0 0 3px;font-size:0;line-height:0;">&nbsp;</td>
                ${avg ? `
                  <td style="width:2px;height:10px;background:#374151;font-size:0;line-height:0;">&nbsp;</td>
                  <td style="width:${Math.max(0, barTotalPx - fillPx - 2)}px;height:10px;background:#e9ecf3;border-radius:0 3px 3px 0;font-size:0;line-height:0;">&nbsp;</td>
                ` : `
                  <td style="width:${emptyPx}px;height:10px;background:#e9ecf3;border-radius:0 3px 3px 0;font-size:0;line-height:0;">&nbsp;</td>
                `}
              </tr>
            </table>
            ${avg ? `<div style="font-size:9px;color:#9099b0;font-weight:600;margin-top:1px;">Avg: ${avg.label}</div>` : ''}
            <div style="font-size:10px;color:#9099b0;font-weight:600;">${pct}th %ile</div>
          </td>
        </tr>`;
    };
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
          <table role="presentation" style="width:100%;border-collapse:collapse;border-spacing:0;margin-top:10px;">
            <tbody>
              ${emailStatBar("ERA",  card.stats?.era)}
              ${emailStatBar("WHIP", card.stats?.whip)}
              ${emailStatBar("K%",   card.stats?.kPct)}
              ${emailStatBar("BB%",  card.stats?.bbPct)}
            </tbody>
          </table>
        </div>
        ${tables.map((table) => renderEmailAdvancedBlock(table)).join("")}
        ${renderEmailRecentStarts(card.recentStarts)}
      </div>`;
  };
  const ADVCELL_MLB_AVG = {
    'ERA':        { pctPos: 54, label: '4.20' },
    'FIP':        { pctPos: 53, label: '4.10' },
    'xERA':       { pctPos: 52, label: '4.05' },
    'WHIP':       { pctPos: 51, label: '1.28' },
    'K%':         { pctPos: 47, label: '22.5%' },
    'Pitcher K%': { pctPos: 47, label: '22.5%' },
    'Batter K%':  { pctPos: 47, label: '22.5%' },
    'Opponent K%': { pctPos: 47, label: '22.5%' },
    'BB%':        { pctPos: 51, label: '8.2%' },
    'Pitcher BB%': { pctPos: 51, label: '8.2%' },
    'Batter BB%': { pctPos: 51, label: '8.2%' },
    'Opponent BB%': { pctPos: 51, label: '8.2%' },
    'Barrel %':   { pctPos: 50, label: '7.5%' },
    'Pitcher Barrel %': { pctPos: 50, label: '7.5%' },
    'Batter Barrel %': { pctPos: 50, label: '7.5%' },
    'Barrel%':    { pctPos: 50, label: '7.5%' },
    'Batter Barrel%': { pctPos: 50, label: '7.5%' },
    'xBA':        { pctPos: 48, label: '0.248' },
    'Pitcher xBA': { pctPos: 48, label: '0.248' },
    'Batter xBA': { pctPos: 48, label: '0.248' },
    'Hard Hit %': { pctPos: 50, label: '37%' },
    'Pitcher Hard Hit %': { pctPos: 50, label: '37%' },
    'Batter Hard Hit %': { pctPos: 50, label: '37%' },
    'Hard-Hit%':  { pctPos: 50, label: '37%' },
    'Pitcher Hard-Hit%': { pctPos: 50, label: '37%' },
    'Batter Hard-Hit%': { pctPos: 50, label: '37%' },
    'xSLG %':     { pctPos: 49, label: '0.400' },
    'Pitcher xSLG %': { pctPos: 49, label: '0.400' },
    'Batter xSLG %': { pctPos: 49, label: '0.400' },
    'xSLG':       { pctPos: 49, label: '0.400' },
    'Pitcher xSLG': { pctPos: 49, label: '0.400' },
    'Batter xSLG': { pctPos: 49, label: '0.400' },
    'xwOBA':      { pctPos: 48, label: '0.310' },
    'wRC+':       { pctPos: 47, label: '100' },
    'WAR':        { pctPos: 43, label: '0.5' },
  };
  const renderAdvancedBar = (label, value, contextValue = null, contextKind = 'rank', align = 'left', metricLabel = null) => {
    const resolvedLabel = metricLabel || label;
    const pct = contextKind === 'percentile' && contextValue != null
      ? contextValue
      : reportMetricPct(resolvedLabel, value);
    const shown = valueCell(value);
    const textAlign = align === 'right' ? 'right' : 'left';
    const ctxText = contextValue != null
      ? (contextKind === 'percentile' ? `${ordinalSuffix(contextValue)} %ile` : `#${contextValue} MLB`)
      : '';
    if (pct == null) {
      return `<div style="min-height:72px;display:flex;flex-direction:column;justify-content:center;padding:4px 0;">
        <span style="font-weight:700;font-size:13px;color:#111827;text-align:${textAlign};display:block;">${shown}</span>
        ${ctxText ? `<span style="font-size:12px;color:#6b7280;font-weight:600;display:block;margin-top:3px;text-align:${textAlign};">${ctxText}</span>` : ''}
      </div>`;
    }
    const color = reportPctlColor(pct);
    const avg = ADVCELL_MLB_AVG[resolvedLabel] || ADVCELL_MLB_AVG[label];
    const avgMarker = avg
      ? `<div style="position:absolute;top:0;left:${avg.pctPos}%;height:100%;width:2px;background:#374151;transform:translateX(-50%);z-index:2;border-radius:1px;"></div>`
      : '';
    const avgLabel = avg
      ? `<span style="position:absolute;top:100%;left:${avg.pctPos}%;transform:translateX(-50%);font-size:10px;color:#6b7280;font-weight:700;white-space:nowrap;margin-top:2px;">${avg.label}</span>`
      : '';
    return `<div style="min-height:72px;display:flex;flex-direction:column;justify-content:center;padding:4px 0 20px 0;">
      <div style="font-size:14px;font-weight:800;color:#111827;margin-bottom:5px;text-align:${textAlign};">${shown}</div>
      <div style="position:relative;height:12px;background:#e9ecf3;border-radius:3px;overflow:visible;">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:3px;position:relative;"></div>
        ${avgMarker}
        ${avgLabel}
      </div>
      ${ctxText ? `<span style="font-size:12px;color:#6b7280;font-weight:700;display:block;margin-top:14px;text-align:${textAlign};">${ctxText}</span>` : ''}
    </div>`;
  };
  const renderEmailAdvBar = (label, value, contextValue = null, contextKind = 'rank', metricLabel = null) => {
    const resolvedLabel = metricLabel || label;
    const pct = contextKind === 'percentile' && contextValue != null
      ? contextValue
      : reportMetricPct(resolvedLabel, value);
    const shown = valueCell(value);

    if (pct == null) {
      const ctx = contextValue != null
        ? (contextKind === 'percentile' ? `${ordinalSuffix(contextValue)} %ile` : `#${contextValue} MLB`)
        : '';
      return `<div style="padding:4px 0;">
        <span style="font-size:13px;font-weight:700;color:#111827;">${shown}</span>
        ${ctx ? `<div style="font-size:10px;color:#9099b0;font-weight:600;margin-top:2px;">${ctx}</div>` : ''}
      </div>`;
    }

    const color = reportPctlColor(pct);
    const avg = ADVCELL_MLB_AVG[resolvedLabel] || ADVCELL_MLB_AVG[label];
    const barTotalPx = 100;
    const fillPx = Math.round((pct / 100) * barTotalPx);
    const ctx = contextValue != null
      ? (contextKind === 'percentile' ? `${ordinalSuffix(contextValue)} %ile` : `#${contextValue} MLB`)
      : '';

    return `<div style="padding:4px 0 12px 0;">
      <div style="font-size:13px;font-weight:800;color:#111827;margin-bottom:4px;">${shown}</div>
      <table role="presentation" style="border-collapse:collapse;border-spacing:0;height:10px;">
        <tr>
          <td style="width:${fillPx}px;height:10px;background:${color};border-radius:3px 0 0 3px;font-size:0;">&nbsp;</td>
          ${avg ? `<td style="width:2px;height:10px;background:#374151;font-size:0;">&nbsp;</td>
                   <td style="width:${Math.max(0, barTotalPx - fillPx - 2)}px;height:10px;background:#e9ecf3;border-radius:0 3px 3px 0;font-size:0;">&nbsp;</td>`
                 : `<td style="width:${barTotalPx - fillPx}px;height:10px;background:#e9ecf3;border-radius:0 3px 3px 0;font-size:0;">&nbsp;</td>`}
        </tr>
      </table>
      ${avg ? `<div style="font-size:9px;color:#9099b0;font-weight:600;margin-top:1px;">Avg: ${avg.label}</div>` : ''}
      ${ctx ? `<div style="font-size:11px;color:#6b7280;font-weight:700;margin-top:2px;">${ctx}</div>` : ''}
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
                    <td class="email-adv-side" valign="top" style="width:50%;padding:9px 8px;border-right:1px solid #e5e7eb;background:#f4f9ff;text-align:left;vertical-align:middle;">${renderEmailAdvBar(row.label, row.left, row.leftPercentile ?? null, "percentile", row.leftMetricLabel)}</td>
                    <td class="email-adv-side" valign="top" style="width:50%;padding:9px 8px;background:#fff7ef;text-align:right;vertical-align:middle;">${renderEmailAdvBar(row.label, row.right, resolvedRank, "rank", row.rightMetricLabel)}</td>
                  </tr>
                </table>
              </div>
            `;
          }).join("")}
        </div>`;
    }
    return `
      <div class="report-sheet-table-wrap" style="width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;">
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
              <td style="width:33%;padding:8px 10px;border-bottom:1px solid #d6dde8;background:#f4f9ff;text-align:left;vertical-align:top;overflow:visible;">${renderAdvancedBar(row.label, row.left, row.leftPercentile ?? null, 'percentile', 'left', row.leftMetricLabel)}</td>
              <td style="width:34%;padding:6px 10px;border-bottom:1px solid #d6dde8;background:#ffffff;color:#475569;text-align:center;font-weight:700;vertical-align:middle;height:88px;">${valueCell(row.label)}</td>
              <td style="width:33%;padding:8px 10px;border-bottom:1px solid #d6dde8;background:#fff7ef;text-align:right;vertical-align:top;overflow:visible;">${renderAdvancedBar(row.label, row.right, resolvedRank, 'rank', 'right', row.rightMetricLabel)}</td>
            </tr>
          `;}).join("")}
        </tbody>
      </table>
      </div>`;
  };
  const renderSummarySheetTable = (rows, headers = null) => `
    <div class="report-sheet-table-wrap" style="width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;">
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
                  <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f9fafb'};">
                    <td style="padding:7px 6px;border-bottom:1px solid #d6dde8;text-align:center;color:#6b7280;font-weight:700;">${valueCell(p.order ?? i + 1)}</td>
                    <td style="padding:7px 6px;border-bottom:1px solid #d6dde8;font-weight:700;color:#111827;">${valueCell(p.name)}</td>
                    <td style="padding:7px 6px;border-bottom:1px solid #d6dde8;text-align:center;">${heatCell("xBA", p.savant?.xBA || null, null, "Batter xBA")}</td>
                    <td style="padding:7px 6px;border-bottom:1px solid #d6dde8;text-align:center;">${heatCell("K%", p.savant?.kPct || p.fangraphs?.kPct || null, null, "Batter K%")}</td>
                    <td style="padding:7px 6px;border-bottom:1px solid #d6dde8;text-align:center;">${heatCell("Hard Hit %", p.savant?.hardHitPct || null, null, "Batter Hard Hit %")}</td>
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
      return `<img src="https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_60,q_auto:best/v1/people/${pid}/headshot/67/current" alt="${valueCell(player?.name)} headshot for ${valueCell(report?.header?.oppTeamLabel || "Mets report")} lineup analysis" width="${photoSize}" height="${photoSize}" loading="lazy" decoding="async" style="width:${photoSize}px;height:${photoSize}px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1px solid #d6dde8;background:#ffffff;">`;
    };
    const lineupNameCell = (player, side) => {
      if (mode === "email") return `<span style="font-weight:700;">${valueCell(player?.name)}</span>`;
      return `<div style="display:flex;align-items:center;gap:8px;min-width:0;">
        ${lineupHeadshot(player)}
        <span style="font-weight:700;white-space:normal;line-height:1.25;">${valueCell(player?.name)}</span>
      </div>`;
    };
    const maxRows = Math.max(mets.length, opp.length, 9);
    const rows = [];
    for (let i = 0; i < maxRows; i += 1) {
      const m = mets[i] || {};
      const o = opp[i] || {};
      rows.push(`
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#f4f9ff;color:#111827;text-align:left;">${lineupNameCell(m, "mets")}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#f4f9ff;text-align:center;">${heatCell("xBA", m.savant?.xBA || null, null, "Batter xBA")}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#f4f9ff;text-align:center;">${heatCell("K%", m.savant?.kPct || m.fangraphs?.kPct || null, null, "Batter K%")}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#f4f9ff;text-align:center;">${heatCell("Hard Hit %", m.savant?.hardHitPct || null, null, "Batter Hard Hit %")}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#f4f9ff;text-align:center;">${heatCell("WAR", m.fangraphs?.war || null)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#ffffff;color:#475569;text-align:center;font-weight:800;">${valueCell(m.order ?? o.order ?? i + 1)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#fff7ef;color:#111827;text-align:left;">${lineupNameCell(o, "opp")}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#fff7ef;text-align:center;">${heatCell("xBA", o.savant?.xBA || null, null, "Batter xBA")}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#fff7ef;text-align:center;">${heatCell("K%", o.savant?.kPct || o.fangraphs?.kPct || null, null, "Batter K%")}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #d6dde8;background:#fff7ef;text-align:center;">${heatCell("Hard Hit %", o.savant?.hardHitPct || null, null, "Batter Hard Hit %")}</td>
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
            <div><div style="${smallLabel}margin-bottom:4px;">xBA</div>${heatCell("xBA", player.savant?.xBA || null, null, "Batter xBA")}</div>
            <div><div style="${smallLabel}margin-bottom:4px;">K%</div>${heatCell("K%", player.savant?.kPct || player.fangraphs?.kPct || null, null, "Batter K%")}</div>
            <div><div style="${smallLabel}margin-bottom:4px;">Hard Hit</div>${heatCell("Hard Hit %", player.savant?.hardHitPct || null, null, "Batter Hard Hit %")}</div>
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
              <th style="width:18%;padding:8px 10px;border-bottom:1px solid #d6dde8;background:#f4f9ff;${smallLabel}text-align:left;">Mets Player</th>
              <th style="width:7%;padding:8px 10px;border-bottom:1px solid #d6dde8;background:#f4f9ff;${smallLabel}text-align:center;">xBA</th>
              <th style="width:7%;padding:8px 10px;border-bottom:1px solid #d6dde8;background:#f4f9ff;${smallLabel}text-align:center;">K%</th>
              <th style="width:9%;padding:8px 10px;border-bottom:1px solid #d6dde8;background:#f4f9ff;${smallLabel}text-align:center;">Hard Hit %</th>
              <th style="width:6%;padding:8px 10px;border-bottom:1px solid #d6dde8;background:#f4f9ff;${smallLabel}text-align:center;">WAR</th>
              <th style="width:5%;padding:8px 10px;border-bottom:1px solid #d6dde8;background:#ffffff;${smallLabel}text-align:center;">Order</th>
              <th style="width:18%;padding:8px 10px;border-bottom:1px solid #d6dde8;background:#fff7ef;${smallLabel}text-align:left;">Opponent Player</th>
              <th style="width:7%;padding:8px 10px;border-bottom:1px solid #d6dde8;background:#fff7ef;${smallLabel}text-align:center;">xBA</th>
              <th style="width:7%;padding:8px 10px;border-bottom:1px solid #d6dde8;background:#fff7ef;${smallLabel}text-align:center;">K%</th>
              <th style="width:9%;padding:8px 10px;border-bottom:1px solid #d6dde8;background:#fff7ef;${smallLabel}text-align:center;">Hard Hit %</th>
              <th style="width:6%;padding:8px 10px;border-bottom:1px solid #d6dde8;background:#fff7ef;${smallLabel}text-align:center;">WAR</th>
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
      ? `<img class="pitcher-photo-sm" src="${pitcherImageSrc}" alt="${card.name} pitching matchup photo" width="360" height="360" loading="lazy" decoding="async">`
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
  const renderUsageBadge = (usage) => {
    const tone = usage?.tone || "green";
    const palette = tone === "red"
      ? { bg: "#e8effa", fg: "#002d72" }
      : tone === "yellow"
        ? { bg: "#fef3c7", fg: "#a16207" }
        : { bg: "#fff0e8", fg: "#cc4500" };
    return `<span style="display:inline-block;padding:6px 10px;border-radius:999px;background:${palette.bg};color:${palette.fg};font-size:12px;font-weight:900;letter-spacing:0.06em;text-transform:uppercase;">${valueCell(usage?.label || "Low")}</span>`;
  };
  const renderBullpenCard = (card) => {
    if (!card) return "";
    const closer = card.closer || null;
    const closerHeadshot = closer?.playerId
      ? `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_120,q_auto:best/v1/people/${closer.playerId}/headshot/67/current`
      : null;
    return `
      <div style="border:1px solid #d9e1ee;border-radius:16px;background:#ffffff;padding:${mode === "site" ? "18px" : "16px"};box-shadow:${mode === "site" ? "0 8px 20px rgba(15,23,42,0.05)" : "none"};">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px;">
          <div>
            <div style="margin:0 0 6px 0;font-size:${mode === "site" ? "17px" : "16px"};line-height:1.3;color:#002d72;font-weight:800;">${valueCell(card.teamName)} Bullpen</div>
            ${renderUsageBadge(card.usage)}
          </div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:10px 14px;margin-bottom:14px;color:#374151;font-size:13px;font-weight:700;">
          <span>Season ERA ${valueCell(card.statsRow?.seasonEra)}</span>
          <span>Season WHIP ${valueCell(card.statsRow?.seasonWhip)}</span>
          <span>Last 20 Days ERA ${valueCell(card.statsRow?.last20Era)}</span>
        </div>
        <div style="margin:0 0 12px 0;padding-top:10px;border-top:1px solid #d6dde8;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;font-weight:800;">Closer</div>
        ${closer ? `
          <div style="display:flex;align-items:center;gap:12px;">
            ${closerHeadshot
              ? `<img src="${closerHeadshot}" alt="${valueCell(closer.name)} headshot" width="56" height="56" loading="lazy" decoding="async" style="display:block;width:56px;height:56px;border-radius:50%;object-fit:cover;border:1px solid #d6dde8;background:#ffffff;">`
              : ""}
            <div style="min-width:0;">
              <div style="font-size:16px;color:#111827;font-weight:800;line-height:1.25;">${valueCell(closer.name)}</div>
              <div style="margin-top:4px;color:#374151;font-size:13px;font-weight:700;">${valueCell(closer.saves)} SV / ${valueCell(closer.saveOpportunities)} SVO &middot; ${valueCell(Number.isFinite(closer.saveConversionPct) ? `${closer.saveConversionPct}%` : "N/A")} conversion &middot; ERA ${valueCell(closer.era)}</div>
              <div style="margin-top:4px;color:#64748b;font-size:12px;font-weight:700;">Last 7 days: ${valueCell(closer.last7DaysAppearances)} appearances, ${valueCell(closer.last7DaysInningsPitched)} IP</div>
            </div>
          </div>`
        : `<p style="margin:0;color:#64748b;">Closer data unavailable.</p>`}
      </div>`;
  };
  const renderRecentFormValue = (statKey, value) => {
    if (!Number.isFinite(value)) return "N/A";
    if (statKey === "ops" || statKey === "avg") return formatReportAverage(value);
    return formatReportPct(value);
  };
  const renderRecentFormTable = (team) => {
    if (!team?.rows?.length) return "";
    const logoUrl = team.teamId ? `https://www.mlbstatic.com/team-logos/${team.teamId}.svg` : "";
    const rows = team.rows.map((row) => {
      const diffColor = !Number.isFinite(row?.differencePct)
        ? "#64748b"
        : row.improving
          ? "#ff5910"
          : "#002d72";
      const statLabel = row.statKey === "ops"
        ? "OPS Rank"
        : row.statKey === "avg"
          ? "BA Rank"
          : row.statKey === "kPct"
            ? "K% Rank"
            : "BB% Rank";
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #d6dde8;color:#111827;font-weight:800;">${statLabel}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #d6dde8;color:#111827;text-align:center;">
            <div style="font-weight:800;">${row.seasonRank ? `#${row.seasonRank}` : "N/A"}</div>
            <div style="margin-top:4px;font-size:12px;color:#64748b;font-weight:700;">${renderRecentFormValue(row.statKey, row.seasonValue)}</div>
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #d6dde8;color:#111827;text-align:center;">
            <div style="font-weight:800;">${row.recentRank ? `#${row.recentRank}` : "N/A"}</div>
            <div style="margin-top:4px;font-size:12px;color:#64748b;font-weight:700;">${renderRecentFormValue(row.statKey, row.recentValue)}</div>
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #d6dde8;color:${diffColor};text-align:center;font-weight:900;">${formatRecentFormDiff(row.differencePct)}</td>
        </tr>`;
    }).join("");
    return `
      <div style="border:1px solid #d9e1ee;border-radius:16px;background:#ffffff;overflow:hidden;box-shadow:${mode === "site" ? "0 8px 20px rgba(15,23,42,0.05)" : "none"};">
        <div style="display:flex;align-items:center;gap:10px;padding:14px 16px;background:#002d72;color:#ffffff;">
          ${logoUrl ? `<img src="${logoUrl}" alt="${valueCell(team.teamName)} logo" width="28" height="28" decoding="async" style="width:28px;height:28px;object-fit:contain;background:#ffffff;border-radius:50%;padding:2px;">` : ""}
          <div style="font-size:16px;font-weight:800;line-height:1.25;">${valueCell(team.teamName)}</div>
        </div>
        <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
          <table style="width:100%;border-collapse:collapse;min-width:${mode === "site" ? "100%" : "420px"};">
            <thead>
              <tr>
                <th style="padding:10px 12px;border-bottom:1px solid #d6dde8;background:#f8fafc;color:#475569;text-align:left;${smallLabel}">Stat</th>
                <th style="padding:10px 12px;border-bottom:1px solid #d6dde8;background:#f8fafc;color:#475569;text-align:center;${smallLabel}">Season</th>
                <th style="padding:10px 12px;border-bottom:1px solid #d6dde8;background:#f8fafc;color:#475569;text-align:center;${smallLabel}">Last 20 Days</th>
                <th style="padding:10px 12px;border-bottom:1px solid #d6dde8;background:#f8fafc;color:#475569;text-align:center;${smallLabel}">% Difference</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  };
  const bullpenSection = report?.bullpenReport
    ? `<div class="report-two-col" style="${twoColStyle}">
        ${renderBullpenCard(report.bullpenReport.mets)}
        ${renderBullpenCard(report.bullpenReport.opp)}
      </div>`
    : "";
  const recentFormSection = report?.recentFormReport
    ? `<div class="report-two-col" style="${twoColStyle}">
        ${renderRecentFormTable(report.recentFormReport.mets)}
        ${renderRecentFormTable(report.recentFormReport.opp)}
      </div>`
    : "";

  // Build situational splits card (site mode) — wrapped in try-catch, never throws
  let sitSplitsCard = "";
  try {
    const sitGame = { situationalSplits: report._situationalSplits };
    sitSplitsCard = buildSituationalSplitsHtml(sitGame, { mode: "site" });
  } catch (_) {}

  return `
    ${sitSplitsCard ? `<section style="background:#ffffff;border:1px solid #d9e1ee;border-radius:18px;padding:18px 20px;margin:0 0 18px 0;box-shadow:0 10px 24px rgba(15,23,42,0.06);">${sitSplitsCard}</section>` : ""}

    ${wrapSection("Matchup Details", renderSummarySheetTable(matchupRows, matchupHeaders))}

    ${wrapSection("Starting Pitchers Comparison", pitcherComparisonMarkup)}

    ${bullpenSection ? wrapSection("Bullpen Report", bullpenSection) : ""}

    ${recentFormSection ? wrapSection("Recent Form &mdash; Last 20 Games vs Season", recentFormSection) : ""}

    ${wrapSection("Projected Lineup Comparison", renderLineupTable(report.projectedLineupComparison?.mets || [], report.projectedLineupComparison?.opp || []))}

    ${wrapSection("How This Analysis Is Built", `
      <p style="margin:0 0 10px 0;color:#374151;">MetsMoneyline builds each report from the game context already stored by the site: projected or confirmed lineups, starting pitcher indicators, bullpen form, recent team performance, and the available Mets market price. The goal is to show where the Mets may have a real edge, where the matchup is fragile, and why the official pick is framed the way it is.</p>
      <p style="margin:0;color:#374151;">This analysis is informational and entertainment-focused only. It is not a guarantee of results, and it should be read as a transparent game breakdown rather than a promise of profit.</p>
    `)}

    ${wrapSection("Game Analysis", `
      <div style="${smallLabel}margin-bottom:6px;">Why the Mets have a case</div>
      ${renderBulletList(report.analysis?.whyMetsHaveACase || [])}
      <div style="${smallLabel}margin:12px 0 6px 0;">Where the risk is</div>
      ${renderBulletList(report.analysis?.whereTheRiskIs || [])}
      <div style="${smallLabel}margin:12px 0 6px 0;">Bottom line</div>
      <p style="margin:0;color:#374151;">${valueCell(report.analysis?.bottomLine)}</p>
    `)}

    ${wrapSection("Official MetsMoneyline Pick", `
      <p style="margin:0 0 8px 0;font-size:20px;font-weight:800;color:#f97316;">${valueCell(report.officialPick?.headline || report.officialPick?.label)}</p>
      <p style="margin:0 0 12px 0;color:#374151;">${valueCell(report.officialPick?.summary || report.officialPick?.explanation)}</p>
      <div style="${smallLabel}margin-bottom:6px;">Mets Edges</div>
      ${renderBulletList(report.officialPick?.metsEdges || [])}
      <div style="${smallLabel}margin:12px 0 6px 0;">Risks / What Could Go Wrong</div>
      ${renderBulletList(report.officialPick?.risks || [])}
      <div style="${smallLabel}margin:12px 0 6px 0;">Betting Angle</div>
      <p style="margin:0 0 12px 0;color:#374151;">${valueCell(report.officialPick?.bettingAngle || report.officialPick?.explanation)}</p>
      <p style="margin:0 0 6px 0;font-weight:800;color:#111827;">Official Pick: Mets ML</p>
      <p style="margin:0;color:#5b6477;">Confidence: ${valueCell(report.officialPick?.confidenceLabel)}${report.officialPick?.confidence != null ? ` (${valueCell(report.officialPick?.confidence)}/10)` : ""}</p>
    `)}`;
}

function buildCompactDailyReportEmailHtml(game) {
  const report = game?.writeup?.report || buildPresentationReport(game);
  const header = report?.header || {};
  const pick = report?.officialPick || {};
  const opponent = game?.opponent || "Opponent";
  const opponentShort = opponent.split(" ").pop();
  const oppAbbr = TEAM_NAME_TO_ABBR[opponent] || opponentShort.toUpperCase().slice(0, 3);
  const metsLogo = header?.metsLogoUrl || "https://www.mlbstatic.com/team-logos/121.svg";
  const oppLogo = header?.oppLogoUrl || "";
  const metsRecord = sanitizeRecord(game?.metsRecord || game?.standings?.metsRecord, "N/A");
  const oppRecord = sanitizeRecord(game?.oppRecord || game?.standings?.oppRecord, "N/A");
  const heroMetaLine = [header?.date || game?.date, header?.time || game?.time, header?.ballpark || game?.ballpark].filter(Boolean).join(" | ");
  const rs = game?.recordSplits || {};
  const isHome = (game?.homeAway || "").toLowerCase() === "home";
  const metsHARecord = isHome ? (rs.metsHome ? `${rs.metsHome} home` : "N/A") : (rs.metsRoad ? `${rs.metsRoad} away` : "N/A");
  const oppHARecord = isHome ? (rs.oppRoad ? `${rs.oppRoad} away` : "N/A") : (rs.oppHome ? `${rs.oppHome} home` : "N/A");
  const metsCard = report?.startingPitchersComparison?.metsCard;
  const oppCard = report?.startingPitchersComparison?.oppCard;
  const metsBullpen = report?.bullpenReport?.mets;
  const oppBullpen = report?.bullpenReport?.opp;
  const metsRecentForm = report?.recentFormReport?.mets;
  const oppRecentForm = report?.recentFormReport?.opp;
  const splits = game?.situationalSplits || null;

  const D = (v) => (v == null || v === "") ? "N/A" : String(v);
  const fmt = (v, d = 2) => {
    const n = parseFloat(String(v ?? ""));
    return Number.isFinite(n) ? n.toFixed(d) : "N/A";
  };
  const fmtPct = (v) => {
    const n = parseFloat(String(v ?? ""));
    return Number.isFinite(n) ? `${n.toFixed(1)}%` : "N/A";
  };
  const fmtAvg = (v) => {
    const n = parseFloat(String(v ?? ""));
    return Number.isFinite(n) ? `.${String(Math.round(n * 1000)).padStart(3, "0")}` : "N/A";
  };
  const fmtOps = (v) => {
    const n = parseFloat(String(v ?? ""));
    return Number.isFinite(n) ? n.toFixed(3) : "N/A";
  };
  const fmtSplitNum = (v) => {
    const n = parseFloat(String(v ?? ""));
    return Number.isFinite(n) ? n.toFixed(1) : "N/A";
  };
  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const edgeLower = (a, b, tol = 0.01) => !Number.isFinite(a) || !Number.isFinite(b) ? "N/A" : a < b - tol ? "Mets" : b < a - tol ? opponentShort : "Even";
  const edgeHigher = (a, b, tol = 0.005) => !Number.isFinite(a) || !Number.isFinite(b) ? "N/A" : a > b + tol ? "Mets" : b > a + tol ? opponentShort : "Even";
  const formatTrendDelta = (row, { inverse = false } = {}) => {
    if (!row) return "N/A";
    if (inverse) {
      if (row.recentValue == null || row.seasonValue == null) return "N/A";
      if (row.recentValue < row.seasonValue - 0.05) return "Better";
      if (row.recentValue > row.seasonValue + 0.05) return "Worse";
      return "Flat";
    }
    const pct = parseFloat(String(row.differencePct ?? ""));
    if (!Number.isFinite(pct)) return "N/A";
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  };
  const compareEdgeText = (value) => {
    if (!value || value === "N/A") return `<span style="color:#94a3b8;font-weight:700;">N/A</span>`;
    if (value === "Mets") return `<span style="color:#002d72;font-weight:800;">Mets</span>`;
    if (value === opponentShort) return `<span style="color:#9a3412;font-weight:800;">${escapeHtml(opponentShort)}</span>`;
    return `<span style="color:#475569;font-weight:700;">${escapeHtml(value)}</span>`;
  };
  const compactRow = (left, label, right, { leftTone = "#111827", rightTone = "#111827" } = {}) => `
    <tr>
      <td style="padding:7px 8px;background:#f8fbff;border-bottom:1px solid #e5e7eb;color:${leftTone};font-size:12px;font-weight:800;">${escapeHtml(left)}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;color:#475569;font-size:11px;font-weight:700;text-align:center;">${escapeHtml(label)}</td>
      <td style="padding:7px 8px;background:#fff8f2;border-bottom:1px solid #e5e7eb;color:${rightTone};font-size:12px;font-weight:800;text-align:right;">${escapeHtml(right)}</td>
    </tr>`;
  const recordFromGames = (games) => {
    if (!Array.isArray(games) || !games.length) return "N/A";
    const lastFive = games.slice(-5);
    let wins = 0;
    let losses = 0;
    lastFive.forEach((gameRow) => {
      const result = String(gameRow?.result || "").toUpperCase();
      if (result === "W") wins += 1;
      if (result === "L") losses += 1;
    });
    return `${wins}-${losses}`;
  };

  const wx = game?.weather || {};
  const wxStr = [wx.temp ? `${Math.round(wx.temp)}°` : null, wx.condition || null, wx.windSpeed ? `Wind ${Math.round(wx.windSpeed)} mph ${wx.windDir || ""}`.trim() : null].filter(Boolean).join(" · ");
  const metsXERA = parseFloat(String(game?.pitching?.mets?.savant?.xERA ?? ""));
  const oppXERA = parseFloat(String(game?.pitching?.opp?.savant?.xERA ?? ""));
  const metsERA = parseFloat(String(metsCard?.stats?.era ?? ""));
  const oppERA = parseFloat(String(oppCard?.stats?.era ?? ""));
  const metsWHIP = parseFloat(String(metsCard?.stats?.whip ?? ""));
  const oppWHIP = parseFloat(String(oppCard?.stats?.whip ?? ""));
  const metsKPct = parseFloat(String(metsCard?.stats?.kPct ?? ""));
  const oppKPct = parseFloat(String(oppCard?.stats?.kPct ?? ""));
  const metsBpXERA = parseFloat(String(game?.pitching?.metsBullpen?.seasonXERAAverage ?? ""));
  const oppBpXERA = parseFloat(String(game?.pitching?.oppBullpen?.seasonXERAAverage ?? ""));
  const metsBpERA = parseFloat(String(metsBullpen?.statsRow?.seasonEra ?? ""));
  const oppBpERA = parseFloat(String(oppBullpen?.statsRow?.seasonEra ?? ""));
  const metsBpFinal = Number.isFinite(metsBpXERA) ? metsBpXERA : metsBpERA;
  const oppBpFinal = Number.isFinite(oppBpXERA) ? oppBpXERA : oppBpERA;
  const metsOpsRow = metsRecentForm?.rows?.find((row) => row.statKey === "ops");
  const oppOpsRow = oppRecentForm?.rows?.find((row) => row.statKey === "ops");
  const metsAvgRow = metsRecentForm?.rows?.find((row) => row.statKey === "avg");
  const oppAvgRow = oppRecentForm?.rows?.find((row) => row.statKey === "avg");
  const metsKRow = metsRecentForm?.rows?.find((row) => row.statKey === "kPct");
  const oppKRow = oppRecentForm?.rows?.find((row) => row.statKey === "kPct");
  const metsBBRow = metsRecentForm?.rows?.find((row) => row.statKey === "bbPct");
  const oppBBRow = oppRecentForm?.rows?.find((row) => row.statKey === "bbPct");
  const metsOpsL20 = metsOpsRow?.recentValue ?? null;
  const oppOpsL20 = oppOpsRow?.recentValue ?? null;
  const metsAvgL20 = metsAvgRow?.recentValue ?? null;
  const oppAvgL20 = oppAvgRow?.recentValue ?? null;
  const metsKL20 = metsKRow?.recentValue ?? null;
  const oppKL20 = oppKRow?.recentValue ?? null;
  const metsBBL20 = metsBBRow?.recentValue ?? null;
  const oppBBL20 = oppBBRow?.recentValue ?? null;
  const metsFormGames = metsRecentForm?.games || game?.gameContext?.metsRecentGames || [];
  const oppFormGames = oppRecentForm?.games || game?.gameContext?.oppRecentGames || [];
  const metsL5 = recordFromGames(metsFormGames);
  const oppL5 = recordFromGames(oppFormGames);
  const h2h = game?.gameContext?.headToHead || null;
  const metsSeriesW = h2h?.wins ?? null;
  const oppSeriesW = h2h?.losses ?? null;
  const seriesStr = (metsSeriesW != null && oppSeriesW != null) ? `${metsSeriesW}-${oppSeriesW}` : "N/A";
  const oppSeriesStr = (metsSeriesW != null && oppSeriesW != null) ? `${oppSeriesW}-${metsSeriesW}` : "N/A";
  const pickLabel = pick?.label || pick?.headline || "Mets ML";
  const displayPickLabel = pickLabel.replace(/^Official Pick:\s*/i, "");
  const confidenceLabel = pick?.confidenceLabel || "N/A";
  const oddsEdge = /mets/i.test(pickLabel) ? "Mets" : new RegExp(opponentShort, "i").test(pickLabel) ? opponentShort : "N/A";

  // Moneyline odds for display
  const metsMLRaw = game?.moneyline?.mets ?? game?.emailData?.moneylineMets ?? null;
  const oppMLRaw  = game?.moneyline?.opp  ?? game?.emailData?.moneylineOpp  ?? null;
  const fmtML = (v) => { const n = parseInt(v); return isNaN(n) ? "N/A" : (n > 0 ? `+${n}` : String(n)); };
  const metsMLStr = fmtML(metsMLRaw);
  const oppMLStr  = fmtML(oppMLRaw);
  const splitRows = [splits?.timeOfDay, splits?.dayOfWeek, splits?.homeAway, splits?.vsOpponent, splits?.combined]
    .filter((row) => row && row.label)
    .slice(0, 2)
    .map((row) => `
      <tr>
        <td style="padding:5px 7px;border-bottom:1px solid #224381;color:#ffffff;font-size:11px;font-weight:700;">${escapeHtml(row.label)}</td>
        <td style="padding:5px 7px;border-bottom:1px solid #224381;color:#ffffff;font-size:11px;text-align:center;">${escapeHtml(`${row.w ?? 0}-${row.l ?? 0}`)}</td>
        <td style="padding:5px 7px;border-bottom:1px solid #224381;color:#ffffff;font-size:11px;text-align:center;">${escapeHtml(`${row.pct ?? "N/A"}%`)}</td>
        <td style="padding:5px 7px;border-bottom:1px solid #224381;color:#ffffff;font-size:11px;text-align:center;">${escapeHtml(fmtSplitNum(row.avgR))}</td>
        <td style="padding:5px 7px;border-bottom:1px solid #224381;color:#ffffff;font-size:11px;text-align:center;">${escapeHtml(fmtSplitNum(row.avgA))}</td>
      </tr>`)
    .join("");
  const offenseFormEdge = edgeHigher(metsOpsL20, oppOpsL20);
  const bullpenEdge = edgeLower(metsBpFinal, oppBpFinal);
  const spEdgeStr = edgeLower(Number.isFinite(metsXERA) ? metsXERA : metsERA, Number.isFinite(oppXERA) ? oppXERA : oppERA);

  // Pitcher Breakdown card
  const pbMp = game?.pitching?.mets || {};
  const pbOp = game?.pitching?.opp || {};
  const pbMLog = (game?.gameContext?.metsPitcherLog || []).slice(0, 3);
  const pbOLog = (game?.gameContext?.oppPitcherLog || []).slice(0, 3);
  const pbMName = pbMp.name || 'TBD';
  const pbOName = pbOp.name || 'TBD';
  const pbStatRow = (label, mVal, oVal) =>
    `<tr>
      <td style="padding:6px 8px;background:#f0f6ff;border-bottom:1px solid #e5e7eb;color:#002d72;font-size:12px;font-weight:800;width:33%;">${escapeHtml(String(mVal ?? 'N/A'))}</td>
      <td style="padding:6px 8px;background:#f8fafc;border-bottom:1px solid #e5e7eb;color:#475569;font-size:11px;font-weight:700;text-align:center;width:34%;">${escapeHtml(label)}</td>
      <td style="padding:6px 8px;background:#fff5f0;border-bottom:1px solid #e5e7eb;color:#9a3412;font-size:12px;font-weight:800;text-align:right;width:33%;">${escapeHtml(String(oVal ?? 'N/A'))}</td>
    </tr>`;
  const pbLogRows = (log) => {
    if (!log.length) return `<tr><td colspan="4" style="padding:6px 8px;font-size:11px;color:#94a3b8;text-align:center;">No recent starts</td></tr>`;
    return log.map(s => {
      const dateStr = s.date ? (() => { const d = new Date(`${s.date}T12:00:00`); return `${d.getMonth()+1}/${d.getDate()}`; })() : '--';
      const er = parseInt(s.er);
      const erColor = isNaN(er) ? '#111827' : er <= 2 ? '#15803d' : er <= 4 ? '#b45309' : '#dc2626';
      const decColor = s.result === 'W' ? '#15803d' : s.result === 'L' ? '#dc2626' : '#64748b';
      const decLabel = s.result === 'W' ? 'W' : s.result === 'L' ? 'L' : 'ND';
      return `<tr>
        <td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;font-size:11px;color:#475569;">${dateStr}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;font-size:11px;color:#111827;text-align:center;">${escapeHtml(String(s.ip ?? '--'))} IP</td>
        <td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;font-size:11px;color:${erColor};font-weight:800;text-align:center;">${escapeHtml(String(s.er ?? '--'))} ER · ${escapeHtml(String(s.k ?? '--'))} K</td>
        <td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;font-size:11px;color:${decColor};font-weight:800;text-align:right;">${decLabel}</td>
      </tr>`;
    }).join('');
  };
  const pitcherBreakdownHtml = `
    <div style="margin:0 0 12px 0;">
      <div style="font-size:15px;font-weight:900;color:#111827;margin:0 0 8px 0;">Pitcher Breakdown</div>
      <table role="presentation" width="100%" class="compact-table" style="width:100%;border-collapse:collapse;border:1px solid #d9e1ee;table-layout:fixed;margin-bottom:10px;">
        <thead>
          <tr>
            <th style="padding:7px 8px;background:#eaf2ff;color:#002d72;font-size:11px;text-align:left;width:33%;">${escapeHtml(pbMName)}</th>
            <th style="padding:7px 8px;background:#f8fafc;color:#475569;font-size:11px;text-align:center;width:34%;">Season Stats</th>
            <th style="padding:7px 8px;background:#fff3e8;color:#9a3412;font-size:11px;text-align:right;width:33%;">${escapeHtml(pbOName)}</th>
          </tr>
        </thead>
        <tbody>
          ${pbStatRow('ERA', fmt(pbMp.seasonERA), fmt(pbOp.seasonERA))}
          ${pbStatRow('FIP', fmt(pbMp.seasonFIP), fmt(pbOp.seasonFIP))}
          ${pbStatRow('WHIP', fmt(pbMp.seasonWHIP), fmt(pbOp.seasonWHIP))}
          ${pbStatRow('K%', pbMp.savant?.kPct ?? 'N/A', pbOp.savant?.kPct ?? 'N/A')}
          ${pbStatRow('BB%', pbMp.savant?.bbPct ?? 'N/A', pbOp.savant?.bbPct ?? 'N/A')}
          ${pbStatRow('xERA', fmt(pbMp.seasonXERA), fmt(pbOp.seasonXERA))}
          ${pbStatRow('xBA Allowed', pbMp.savant?.xBAAllowed ?? 'N/A', pbOp.savant?.xBAAllowed ?? 'N/A')}
        </tbody>
      </table>
      <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;">
        <tr>
          <td valign="top" class="stack-col" style="width:50%;padding:0 5px 0 0;">
            <div style="font-size:11px;font-weight:800;color:#002d72;margin-bottom:4px;">${escapeHtml(pbMName)} — Recent Starts</div>
            <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;border:1px solid #d9e1ee;">
              <tbody>${pbLogRows(pbMLog)}</tbody>
            </table>
          </td>
          <td valign="top" class="stack-col" style="width:50%;padding:0 0 0 5px;">
            <div style="font-size:11px;font-weight:800;color:#9a3412;margin-bottom:4px;">${escapeHtml(pbOName)} — Recent Starts</div>
            <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;border:1px solid #d9e1ee;">
              <tbody>${pbLogRows(pbOLog)}</tbody>
            </table>
          </td>
        </tr>
      </table>
    </div>`;
  let regressionRead = "Mixed";
  const metsEraXeraGap = (Number.isFinite(metsERA) && Number.isFinite(metsXERA)) ? metsXERA - metsERA : null;
  const oppEraXeraGap = (Number.isFinite(oppERA) && Number.isFinite(oppXERA)) ? oppXERA - oppERA : null;
  if (metsEraXeraGap != null && oppEraXeraGap != null) {
    regressionRead = (metsEraXeraGap < oppEraXeraGap - 0.2) ? "Mets" : (oppEraXeraGap < metsEraXeraGap - 0.2) ? opponentShort : "Neutral";
  }
  const bullpenRead = (teamKey) => {
    if (teamKey === "mets") {
      if (bullpenEdge === "Mets") return "Read: Better current form";
      if (bullpenEdge === opponentShort) return "Read: Chasing opponent edge";
      return "Read: Mixed profile";
    }
    if (bullpenEdge === opponentShort) return "Read: Better current form";
    if (bullpenEdge === "Mets") return "Read: Chasing opponent edge";
    return "Read: Mixed profile";
  };
  const renderBullpenPanel = (card, teamKey) => {
    if (!card) return "";
    const teamColor = teamKey === "mets" ? "#002d72" : "#9a3412";
    const basePitching = teamKey === "mets" ? game?.pitching?.metsBullpen : game?.pitching?.oppBullpen;
    const closer = card.closer || null;
    const closerHeadshot = closer?.playerId
      ? `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_80,q_auto:best/v1/people/${closer.playerId}/headshot/67/current`
      : null;
    const closerSummary = closer
      ? `${closer.saves ?? "N/A"}/${closer.saveOpportunities ?? "N/A"}, ${Number.isFinite(closer.saveConversionPct) ? `${closer.saveConversionPct.toFixed(1)}%` : "N/A"}`
      : "N/A";
    const usageSummary = closer
      ? `${closer.last7DaysAppearances ?? "N/A"} app, ${closer.last7DaysInningsPitched ?? "N/A"} IP`
      : "N/A";
    return `
      <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;border:1px solid #d9e1ee;border-radius:14px;overflow:hidden;background:#ffffff;">
        <tr>
          <td style="padding:10px 12px;background:${teamKey === "mets" ? "#eff6ff" : "#fff7ed"};border-bottom:1px solid #d9e1ee;">
            <div style="font-size:14px;font-weight:900;color:${teamColor};">${escapeHtml(card.teamName || (teamKey === "mets" ? "Mets Bullpen" : `${opponentShort} Bullpen`))}</div>
            <div style="font-size:11px;color:#475569;margin-top:2px;font-weight:700;">${bullpenRead(teamKey)}</div>
          </td>
        </tr>
        ${closer ? `<tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">
            <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;">
              <tr>
                ${closerHeadshot ? `<td style="width:42px;padding:0 10px 0 0;vertical-align:middle;"><img src="${closerHeadshot}" alt="${escapeHtml(closer.name)}" width="36" height="36" style="display:block;width:36px;height:36px;border-radius:50%;border:1px solid #d6dde8;object-fit:cover;"></td>` : ""}
                <td style="vertical-align:middle;">
                  <div style="font-size:12px;color:#111827;font-weight:800;">Closer: ${escapeHtml(closer.name)}</div>
                  <div style="font-size:11px;color:#64748b;">SV: ${escapeHtml(closerSummary)} | ERA: ${escapeHtml(fmt(closer.era))}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>` : ""}
        <tr><td style="padding:0;">
          <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:7px 12px;border-bottom:1px solid #eef2f7;color:#475569;font-size:11px;font-weight:700;">Season ERA</td><td style="padding:7px 12px;border-bottom:1px solid #eef2f7;color:#111827;font-size:12px;font-weight:800;text-align:right;">${escapeHtml(fmt(card?.statsRow?.seasonEra))}</td></tr>
            <tr><td style="padding:7px 12px;border-bottom:1px solid #eef2f7;color:#475569;font-size:11px;font-weight:700;">Season WHIP</td><td style="padding:7px 12px;border-bottom:1px solid #eef2f7;color:#111827;font-size:12px;font-weight:800;text-align:right;">${escapeHtml(fmt(card?.statsRow?.seasonWhip))}</td></tr>
            <tr><td style="padding:7px 12px;border-bottom:1px solid #eef2f7;color:#475569;font-size:11px;font-weight:700;">Last 20 Days ERA</td><td style="padding:7px 12px;border-bottom:1px solid #eef2f7;color:#111827;font-size:12px;font-weight:800;text-align:right;">${escapeHtml(fmt(card?.statsRow?.last20Era))}</td></tr>
            <tr><td style="padding:7px 12px;border-bottom:1px solid #eef2f7;color:#475569;font-size:11px;font-weight:700;">Bullpen xERA</td><td style="padding:7px 12px;border-bottom:1px solid #eef2f7;color:#111827;font-size:12px;font-weight:800;text-align:right;">${escapeHtml(fmt(basePitching?.seasonXERAAverage))}</td></tr>
            <tr><td style="padding:7px 12px;border-bottom:1px solid #eef2f7;color:#475569;font-size:11px;font-weight:700;">Closer SV</td><td style="padding:7px 12px;border-bottom:1px solid #eef2f7;color:#111827;font-size:12px;font-weight:800;text-align:right;">${escapeHtml(closerSummary)}</td></tr>
            <tr><td style="padding:7px 12px;color:#475569;font-size:11px;font-weight:700;">Last 7 Usage</td><td style="padding:7px 12px;color:#111827;font-size:12px;font-weight:800;text-align:right;">${escapeHtml(usageSummary)}</td></tr>
          </table>
        </td></tr>
      </table>`;
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${formatButtondownSubject(game)}</title>
<style>
  body,table,td{font-family:Arial,Helvetica,sans-serif;}
  @media(max-width:640px){
    .em-shell{width:100%!important;}
    .em-pad{padding:14px!important;}
    .stack-col{display:block!important;width:100%!important;padding:0 0 12px 0!important;}
    .hero-col{display:block!important;width:100%!important;text-align:center!important;padding:0 0 10px 0!important;}
    .compact-table th,.compact-table td{padding:6px 5px!important;font-size:10px!important;line-height:1.25!important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:#eef2f7;color:#111827;line-height:1.5;">
<div style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;">
  ${DAILY_REPORT_EMAIL_PREHEADER}
</div>
<table role="presentation" width="100%" style="width:100%;border-collapse:collapse;background:#eef2f7;">
<tr><td align="center" style="padding:12px 8px;">
<table role="presentation" class="em-shell" style="width:100%;max-width:640px;border-collapse:collapse;background:#fff;border:1px solid #dde4ef;border-radius:16px;overflow:hidden;">
  <tr>
    <td style="background:linear-gradient(135deg,#001e5a 0%,#002d72 100%);padding:14px 14px 10px;">
      <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#9fb5dd;font-weight:700;margin:0 0 8px 0;text-align:center;">MetsMoneyline</div>
      <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;">
        <tr>
          <td class="hero-col" align="center" style="width:28%;padding:0 6px 0 0;">
            <img src="${metsLogo}" alt="Mets logo" width="54" height="54" style="display:block;border:0;width:54px;height:54px;object-fit:contain;margin:0 auto;">
            <div style="color:#d7e6ff;font-size:11px;font-weight:700;margin-top:4px;">New York Mets</div>
            <div style="color:#9fb5dd;font-size:10px;font-weight:600;margin-top:2px;">${escapeHtml(metsRecord)}</div>
          </td>
          <td class="hero-col" align="center" style="width:44%;padding:0 6px;">
            <div style="color:#ff5910;font-size:20px;font-weight:900;letter-spacing:0.06em;">METS VS ${escapeHtml(oppAbbr)}</div>
            <div style="color:#d7e6ff;font-size:13px;font-weight:800;margin-top:4px;">${escapeHtml(heroMetaLine)}</div>
            ${wxStr ? `<div style="color:#b8c9e8;font-size:11px;margin-top:3px;">${escapeHtml(wxStr)}</div>` : ""}
            <div style="margin-top:8px;background:#ff5910;border-radius:999px;padding:8px 12px;display:inline-block;">
              <span style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.82);">Official Pick</span>
              <span style="display:block;font-size:18px;font-weight:900;color:#ffffff;line-height:1.2;margin-top:2px;">${escapeHtml(displayPickLabel)}</span>
              <span style="display:block;font-size:10px;color:rgba(255,255,255,0.82);margin-top:2px;">${escapeHtml(confidenceLabel)} Matchup Snapshot</span>
            </div>
          </td>
          <td class="hero-col" align="center" style="width:28%;padding:0 0 0 6px;">
            ${oppLogo ? `<img src="${oppLogo}" alt="${escapeHtml(opponent)} logo" width="54" height="54" style="display:block;border:0;width:54px;height:54px;object-fit:contain;margin:0 auto;">` : `<div style="width:54px;height:54px;background:#1a4a9e;border-radius:50%;text-align:center;line-height:54px;font-size:12px;font-weight:700;color:#fff;margin:0 auto;">${escapeHtml(oppAbbr)}</div>`}
            <div style="color:#d7e6ff;font-size:11px;font-weight:700;margin-top:4px;">${escapeHtml(opponent)}</div>
            <div style="color:#9fb5dd;font-size:10px;font-weight:600;margin-top:2px;">${escapeHtml(oppRecord)}</div>
          </td>
        </tr>
      </table>
      ${splitRows ? `<table role="presentation" width="100%" class="compact-table" style="width:100%;border-collapse:collapse;margin-top:10px;border:1px solid #315491;background:rgba(255,255,255,0.05);">
        <thead>
          <tr>
            <th style="padding:5px 7px;border-bottom:1px solid #315491;color:#ffffff;font-size:10px;text-align:left;letter-spacing:0.04em;text-transform:uppercase;">Situation</th>
            <th style="padding:5px 7px;border-bottom:1px solid #315491;color:#ffffff;font-size:10px;text-align:center;letter-spacing:0.04em;text-transform:uppercase;">Record</th>
            <th style="padding:5px 7px;border-bottom:1px solid #315491;color:#ffffff;font-size:10px;text-align:center;letter-spacing:0.04em;text-transform:uppercase;">Win %</th>
            <th style="padding:5px 7px;border-bottom:1px solid #315491;color:#ffffff;font-size:10px;text-align:center;letter-spacing:0.04em;text-transform:uppercase;">Runs Scored</th>
            <th style="padding:5px 7px;border-bottom:1px solid #315491;color:#ffffff;font-size:10px;text-align:center;letter-spacing:0.04em;text-transform:uppercase;">Runs Against</th>
          </tr>
        </thead>
        <tbody>${splitRows}</tbody>
      </table>` : ""}
    </td>
  </tr>
  <tr><td class="em-pad" style="padding:14px 14px 8px;">
    <div style="margin:0 0 12px 0;">
      <div style="font-size:15px;font-weight:900;color:#111827;margin:0 0 8px 0;">Matchup Snapshot</div>
      <table role="presentation" width="100%" class="compact-table" style="width:100%;border-collapse:collapse;border:1px solid #d9e1ee;table-layout:fixed;">
        <thead>
          <tr>
            <th style="padding:7px 8px;background:#eaf2ff;color:#002d72;font-size:11px;text-align:left;">Mets</th>
            <th style="padding:7px 8px;background:#f8fafc;color:#475569;font-size:11px;text-align:center;">Category</th>
            <th style="padding:7px 8px;background:#fff3e8;color:#9a3412;font-size:11px;text-align:right;">${escapeHtml(opponentShort)}</th>
          </tr>
        </thead>
        <tbody>
          ${compactRow(metsRecord, "Season Record", oppRecord)}
          ${compactRow(metsL5, "Last 5 Record", oppL5)}
          ${compactRow(metsHARecord, "Home/Away Record", oppHARecord)}
          ${compactRow(seriesStr, "Season Series", oppSeriesStr)}
          ${compactRow(metsMLStr, "Odds", oppMLStr, { leftTone: oddsEdge === "Mets" ? "#002d72" : "#111827", rightTone: oddsEdge === opponentShort ? "#9a3412" : "#111827" })}
        </tbody>
      </table>
    </div>
    <div style="margin:0 0 12px 0;">
      <div style="font-size:15px;font-weight:900;color:#111827;margin:0 0 8px 0;">Last 20 Game Trend</div>
      <table role="presentation" width="100%" class="compact-table" style="width:100%;border-collapse:collapse;border:1px solid #d9e1ee;table-layout:fixed;">
        <thead>
          <tr>
            <th style="padding:7px 6px;background:#f8fafc;color:#475569;font-size:10px;text-align:left;width:18%;">Stat</th>
            <th style="padding:7px 6px;background:#eaf2ff;color:#002d72;font-size:10px;text-align:center;width:18%;">NYM Szn</th>
            <th style="padding:7px 6px;background:#eaf2ff;color:#002d72;font-size:10px;text-align:center;width:18%;">NYM L20</th>
            <th style="padding:7px 6px;background:#fff3e8;color:#9a3412;font-size:10px;text-align:center;width:18%;">${escapeHtml(opponentShort)} L20</th>
            <th style="padding:7px 6px;background:#f8fafc;color:#475569;font-size:10px;text-align:center;width:28%;">Edge</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:7px 6px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:11px;font-weight:800;">OPS</td>
            <td style="padding:7px 6px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:11px;color:#374151;">${escapeHtml(fmtOps(metsOpsRow?.seasonValue))}</td>
            <td style="padding:7px 6px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:11px;font-weight:800;">${escapeHtml(fmtOps(metsOpsL20))}</td>
            <td style="padding:7px 6px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:11px;font-weight:800;">${escapeHtml(fmtOps(oppOpsL20))}</td>
            <td style="padding:7px 6px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:11px;">${compareEdgeText(edgeHigher(metsOpsL20, oppOpsL20))}</td>
          </tr>
          <tr>
            <td style="padding:7px 6px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:11px;font-weight:800;">AVG</td>
            <td style="padding:7px 6px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:11px;color:#374151;">${escapeHtml(fmtAvg(metsAvgRow?.seasonValue))}</td>
            <td style="padding:7px 6px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:11px;font-weight:800;">${escapeHtml(fmtAvg(metsAvgL20))}</td>
            <td style="padding:7px 6px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:11px;font-weight:800;">${escapeHtml(fmtAvg(oppAvgL20))}</td>
            <td style="padding:7px 6px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:11px;">${compareEdgeText(edgeHigher(metsAvgL20, oppAvgL20, 0.003))}</td>
          </tr>
          <tr>
            <td style="padding:7px 6px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:11px;font-weight:800;">K%</td>
            <td style="padding:7px 6px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:11px;color:#374151;">${escapeHtml(fmtPct(metsKRow?.seasonValue))}</td>
            <td style="padding:7px 6px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:11px;font-weight:800;">${escapeHtml(fmtPct(metsKL20))}</td>
            <td style="padding:7px 6px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:11px;font-weight:800;">${escapeHtml(fmtPct(oppKL20))}</td>
            <td style="padding:7px 6px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:11px;">${compareEdgeText(edgeLower(metsKL20, oppKL20, 0.005))}</td>
          </tr>
          <tr>
            <td style="padding:7px 6px;color:#111827;font-size:11px;font-weight:800;">BB%</td>
            <td style="padding:7px 6px;text-align:center;font-size:11px;color:#374151;">${escapeHtml(fmtPct(metsBBRow?.seasonValue))}</td>
            <td style="padding:7px 6px;text-align:center;font-size:11px;font-weight:800;">${escapeHtml(fmtPct(metsBBL20))}</td>
            <td style="padding:7px 6px;text-align:center;font-size:11px;font-weight:800;">${escapeHtml(fmtPct(oppBBL20))}</td>
            <td style="padding:7px 6px;text-align:center;font-size:11px;">${compareEdgeText(edgeHigher(metsBBL20, oppBBL20, 0.005))}</td>
          </tr>
        </tbody>
      </table>
    </div>
    ${pitcherBreakdownHtml}
    <div style="margin:0 0 12px 0;">
      <div style="font-size:15px;font-weight:900;color:#111827;margin:0 0 8px 0;">Bullpen Trend</div>
      <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;">
        <tr>
          <td class="stack-col" valign="top" style="width:50%;padding:0 6px 0 0;">${renderBullpenPanel(metsBullpen, "mets")}</td>
          <td class="stack-col" valign="top" style="width:50%;padding:0 0 0 6px;">${renderBullpenPanel(oppBullpen, "opp")}</td>
        </tr>
      </table>
    </div>
    <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;margin:0 0 12px 0;">
      <tr>
        <td class="stack-col" valign="top" style="width:60%;padding:0 6px 0 0;">
          <div style="font-size:15px;font-weight:900;color:#111827;margin:0 0 8px 0;">Starting Pitcher Matchup</div>
          <table role="presentation" width="100%" class="compact-table" style="width:100%;border-collapse:collapse;border:1px solid #d9e1ee;table-layout:fixed;">
            <thead>
              <tr>
                <th style="padding:7px 8px;background:#eaf2ff;color:#002d72;font-size:11px;text-align:left;">Mets Starter</th>
                <th style="padding:7px 8px;background:#f8fafc;color:#475569;font-size:11px;text-align:center;">Category</th>
                <th style="padding:7px 8px;background:#fff3e8;color:#9a3412;font-size:11px;text-align:right;">${escapeHtml(opponentShort)} Starter</th>
              </tr>
            </thead>
            <tbody>
              ${compactRow(D(metsCard?.name), "Starter", D(oppCard?.name))}
              ${compactRow(metsCard?.hand ? `${metsCard.hand}HP` : "N/A", "Hand", oppCard?.hand ? `${oppCard.hand}HP` : "N/A")}
              ${compactRow(fmt(metsERA), "ERA", fmt(oppERA))}
              ${compactRow(fmt(metsXERA), "xERA", fmt(oppXERA))}
              ${compactRow(fmt(metsWHIP), "WHIP", fmt(oppWHIP))}
              ${compactRow(fmtPct(metsKPct), "K%", fmtPct(oppKPct))}
            </tbody>
          </table>
        </td>
        <td class="stack-col" valign="top" style="width:40%;padding:0 0 0 6px;">
          <div style="font-size:15px;font-weight:900;color:#111827;margin:0 0 8px 0;">Model Read</div>
          <table role="presentation" width="100%" class="compact-table" style="width:100%;border-collapse:collapse;border:1px solid #d9e1ee;table-layout:fixed;">
            <thead>
              <tr>
                <th style="padding:7px 8px;background:#f8fafc;color:#475569;font-size:11px;text-align:left;">Factor</th>
                <th style="padding:7px 8px;background:#f8fafc;color:#475569;font-size:11px;text-align:center;">Edge</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:11px;font-weight:800;">Offense Form</td><td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:11px;">${compareEdgeText(offenseFormEdge)}</td></tr>
              <tr><td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:11px;font-weight:800;">Bullpen Edge</td><td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:11px;">${compareEdgeText(bullpenEdge)}</td></tr>
              <tr><td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:11px;font-weight:800;">Starter Certainty</td><td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:11px;">${compareEdgeText(spEdgeStr)}</td></tr>
              <tr><td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:11px;font-weight:800;">Regression Signal</td><td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:11px;">${compareEdgeText(regressionRead)}</td></tr>
              <tr><td style="padding:7px 8px;color:#111827;font-size:11px;font-weight:800;">Overall Confidence</td><td style="padding:7px 8px;text-align:center;font-size:11px;font-weight:800;color:#111827;">${escapeHtml(confidenceLabel)}</td></tr>
            </tbody>
          </table>
        </td>
      </tr>
    </table>
    <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;margin:0 0 14px 0;">
      <div style="font-size:12px;font-weight:800;color:#111827;margin-bottom:4px;">Pick Summary</div>
      <div style="font-size:11px;color:#475569;">${escapeHtml(pick?.summary || pick?.explanation || "See the full breakdown at MetsMoneyline.com")}</div>
    </div>
    <div style="text-align:center;padding:0 0 10px;">
      <a href="https://www.metsmoneyline.com/report" style="display:inline-block;background:#f97316;color:#fff;font-size:13px;font-weight:800;padding:10px 22px;border-radius:8px;text-decoration:none;">Read Full Report</a>
    </div>
  </td></tr>
  <tr>
    <td style="background:#f8fafc;border-top:1px solid #e5e7eb;padding:10px 14px;text-align:center;font-size:10px;color:#9099b0;line-height:1.5;">
      For entertainment purposes only. Always gamble responsibly.<br>
      © 2026 MetsMoneyline · Not affiliated with the New York Mets or MLB
    </td>
  </tr>
</table>
</td></tr></table>
</body>
</html>`;
}

function buildDailyReportEmailHtml(game) {
  return buildCompactDailyReportEmailHtml(game);
  const report = game?.writeup?.report || buildPresentationReport(game);
  if (!report) throw new Error("[buildDailyReportEmailHtml] report is null — buildPresentationReport returned nothing");
  if (!report.header) console.warn("[buildDailyReportEmailHtml] WARNING: report.header is missing — email banner will be blank");
  if (!report.startingPitchersComparison) console.warn("[buildDailyReportEmailHtml] WARNING: report.startingPitchersComparison is missing");
  if (!report.projectedLineupComparison) console.warn("[buildDailyReportEmailHtml] WARNING: report.projectedLineupComparison is missing");

  const reportMarkup = buildReportMarkup(report, { mode: "email" })
    .replace(">Matchup Details</h2>", ">Matchup Snapshot</h2>")
    .replace(">Starting Pitchers Comparison</h2>", ">Starting Pitcher Matchup</h2>")
    .replace(">Bullpen Report</h2>", ">Bullpen Trend</h2>")
    .replace(">Recent Form &mdash; Last 20 Games vs Season</h2>", ">Last 20 Game Trend</h2>")
    .replace(">Game Analysis</h2>", ">Model Read</h2>");
  if (!reportMarkup || reportMarkup.trim().length < 500) {
    throw new Error(`[buildDailyReportEmailHtml] reportMarkup is too short (${reportMarkup?.length ?? 0} chars) — buildReportMarkup produced nothing`);
  }

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${formatButtondownSubject(game)}</title>
  </head>
  <body style="margin:0;padding:0;background:#eef2f7;">
    <div style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;">
      ${DAILY_REPORT_EMAIL_PREHEADER}
    </div>
    <style>
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
                <div style="margin-top:20px;padding:14px 16px;background:#f4f9ff;border-radius:12px;text-align:center;border:1px solid #d9e1ee;">
                  <p style="margin:0 0 8px 0;font-size:13px;color:#475569;">See the full interactive breakdown with charts and lineup stats</p>
                  <a href="https://www.metsmoneyline.com/report" style="display:inline-block;background:#f97316;color:#ffffff;font-size:14px;font-weight:800;padding:10px 24px;border-radius:8px;text-decoration:none;letter-spacing:0.02em;">Read Full Report →</a>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildEmailHtml(game) {
  return buildDailyReportEmailHtml(game);
}

function buildSiteReportHtml(game) {
  const report = game?.writeup?.report || buildPresentationReport(game);
  const reportMarkup = buildReportMarkup(report, { mode: "site" });
  const seoOpponent = game?.opponent || "Opponent";
  const seoDate = report.header?.date || game?.date || "today";
  const offDayPreview = Boolean(game?.editorial?.previewMode?.isOffDayPreview);
  const previewBannerText = game?.editorial?.previewMode?.bannerText
    || (offDayPreview ? `OFF DAY — Previewing next game: ${seoOpponent} on ${seoDate}` : "");
  const seoTitle = offDayPreview
    ? `Mets vs ${seoOpponent} Preview - ${seoDate} | MetsMoneyline`
    : `Mets vs ${seoOpponent} Picks - ${seoDate} | MetsMoneyline`;
  const seoDescription = offDayPreview
    ? `Next game preview for Mets vs ${seoOpponent} on ${seoDate}: probable pitchers, lineup status, advanced matchup context, and betting analysis.`
    : `Full breakdown of Mets vs ${seoOpponent} on ${seoDate}: starting pitchers, lineup splits, advanced Statcast stats, and today's official moneyline pick.`;
  const seoSummary = offDayPreview
    ? `This MetsMoneyline preview covers the next Mets game against ${seoOpponent} on ${seoDate}, including probable pitchers, lineup status, bullpen form, weather context, and matchup analysis.`
    : `This MetsMoneyline report covers Mets vs ${seoOpponent} on ${seoDate}, including starting pitcher matchups, lineup splits, bullpen form, weather context, and the site's official Mets moneyline pick.`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="impact-site-verification" value="e6068632-7155-4486-9cae-080414cd8d3b">
    <title>${seoTitle}</title>
    <meta name="description" content="${seoDescription}">
    <meta name="keywords" content="Mets moneyline, Mets game prediction, Mets betting picks, MLB moneyline picks, Mets starting pitcher odds">
    <link rel="canonical" href="https://www.metsmoneyline.com/report">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="dns-prefetch" href="https://statsapi.mlb.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
    <link rel="icon" type="image/jpeg" href="favicon.jpg">
    <link rel="stylesheet" href="css/styles.css">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://www.metsmoneyline.com/report">
    <meta property="og:title" content="${seoTitle}">
    <meta property="og:description" content="${seoDescription}">
    <meta property="og:image" content="https://www.mlbstatic.com/team-logos/121.svg">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${seoTitle}">
    <meta name="twitter:description" content="${seoDescription}">
    <meta name="twitter:image" content="https://www.mlbstatic.com/team-logos/121.svg">
    <link rel="alternate" type="application/rss+xml" title="Mets Moneyline" href="https://www.metsmoneyline.com/rss.xml">
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "WebPage",
        "name": "${seoTitle}",
        "url": "https://www.metsmoneyline.com/report",
        "description": "${seoDescription}",
        "isPartOf": { "@type": "WebSite", "name": "Mets Moneyline", "url": "https://www.metsmoneyline.com" }
      }
    </script>
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
        .report-sheet-table-wrap { margin:0; width:100%; overflow-x:auto !important; -webkit-overflow-scrolling:touch !important; }
        .report-lineup-wrap { margin:0; width:100%; overflow:hidden !important; }
        .report-sheet-table { width:100% !important; }
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
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-VV13077MN0"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-VV13077MN0');</script>
    <script>
      (function () {
        try {
          var etDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
          var url = new URL(window.location.href);
          if (url.searchParams.get('date') === etDate) return;
          url.searchParams.set('date', etDate);
          window.location.replace(url.toString());
        } catch (_error) {}
      })();
    </script>
  </head>
  <body>
    <div class="alert-banner">Live 2026 season mode &mdash; stats and records are current-season only</div>
    <header></header>
    <noscript>
      <section style="max-width:1100px;margin:1rem auto;padding:0.9rem 1rem;background:#f8fafc;border:1px solid #d6dde8;border-radius:12px;color:#475569;font-size:0.85rem;line-height:1.65;">
        ${seoSummary} JavaScript is required for the live odds and interactive matchup tables.
      </section>
    </noscript>
    <main class="report-main" style="width:min(96vw,1440px);max-width:1440px;margin:0 auto;padding:2.5rem 1.25rem 0;">
      ${offDayPreview ? `<section style="margin:0 0 1rem;background:#fff7ed;border:1px solid #fdba74;border-radius:14px;padding:0.95rem 1rem;color:#9a3412;font-size:0.95rem;line-height:1.6;font-weight:800;">${previewBannerText}</section>` : ""}
      <section id="seo-content" style="margin:0 0 1rem;background:#f8fafc;border:1px solid #d9e1ee;border-radius:14px;padding:0.95rem 1rem;color:#475569;font-size:0.9rem;line-height:1.65;">
        <p style="margin:0;">${seoSummary}</p>
      </section>
      <section class="report-banner" style="margin-bottom:1.75rem;background:linear-gradient(180deg,#ffffff 0%,#f7faff 100%);border:1px solid #d9e1ee;border-radius:22px;padding:1.6rem 1.25rem;box-shadow:0 10px 24px rgba(15,23,42,0.06);text-align:center;">
        <div style="display:flex;align-items:center;justify-content:center;gap:1.1rem;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;justify-content:center;min-width:140px;">
            <img class="report-banner-logo" src="${report.header?.metsLogoUrl || "https://www.mlbstatic.com/team-logos/121.svg"}" alt="New York Mets team logo" width="112" height="112" decoding="async" style="width:112px;height:112px;object-fit:contain;">
          </div>
          <div style="font-size:1.45rem;font-weight:900;letter-spacing:0.08em;text-transform:uppercase;color:#a9b4c7;">vs</div>
          <div style="display:flex;align-items:center;justify-content:center;min-width:140px;">
            <img class="report-banner-logo" src="${report.header?.oppLogoUrl || ""}" alt="${game.opponent || "Opponent"} team logo" width="112" height="112" decoding="async" style="width:112px;height:112px;object-fit:contain;">
          </div>
        </div>
        <h1 style="margin:0.9rem 0 0.35rem;color:#111827;font-size:1.9rem;line-height:1.2;">${game.homeAway === "away" ? `Mets at ${game.opponent}` : `${game.opponent} at Mets`}</h1>
        <p style="margin:0;color:#5b6477;font-size:0.96rem;line-height:1.5;">${report.header?.metadataLine || [report.header?.date || game.date, report.header?.time || game.time, report.header?.ballpark || game.ballpark, report.meta?.weatherSummary].filter(Boolean).join(" | ")}</p>
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
    <script defer src="js/site-header.js"></script>
    <script defer src="js/report-live-odds.js"></script>
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
  BatterBBPct: (v) => clampReport(Math.round(((parseFloat(v) - 4) / (14 - 4)) * 95), 5, 99),
  KBB: (v) => clampReport(Math.round(((parseFloat(v) - 1.2) / (6.0 - 1.2)) * 95), 5, 99),
  BatterKPct: (v) => clampReport(Math.round(100 - ((parseFloat(v) - 12) / (33 - 12)) * 90), 5, 99),
  HardHit: (v) => clampReport(Math.round(100 - ((parseFloat(v) - 26) / (47 - 26)) * 90), 5, 99),
  HardHitBat: (v) => clampReport(Math.round(((parseFloat(v) - 25) / (55 - 25)) * 95), 5, 99),
  Barrel: (v) => clampReport(Math.round(100 - ((parseFloat(v) - 2.5) / (16 - 2.5)) * 90), 5, 99),
  BarrelBat: (v) => clampReport(Math.round(((parseFloat(v) - 2) / (18 - 2)) * 95), 5, 99),
  Chase: (v) => clampReport(Math.round(((parseFloat(v) - 18) / (38 - 18)) * 95), 5, 99),
  PitcherXBA: (v) => clampReport(Math.round(100 - ((parseFloat(v) - 0.190) / (0.320 - 0.190)) * 95), 5, 99),
  PitcherXSLG: (v) => clampReport(Math.round(100 - ((parseFloat(v) - 0.280) / (0.560 - 0.280)) * 95), 5, 99),
  xwOBA: (v) => clampReport(Math.round(((parseFloat(v) - 0.260) / (0.380 - 0.260)) * 95), 5, 99),
  xSLG: (v) => clampReport(Math.round(((parseFloat(v) - 0.280) / (0.560 - 0.280)) * 95), 5, 99),
  xBA: (v) => clampReport(Math.round(((parseFloat(v) - 0.190) / (0.320 - 0.190)) * 95), 5, 99),
  WRCPlus: (v) => clampReport(Math.round(((parseFloat(v) - 70) / (140 - 70)) * 95), 5, 99),
  WAR: (v) => clampReport(Math.round(((parseFloat(v) + 1) / (4 + 1)) * 95), 5, 99)
};

function reportPctlColor(pct) {
  if (pct >= 70) return "#ff5910";
  if (pct >= 40) return "#9ca3af";
  return "#002d72";
}

function reportCellToneStyle(pct) {
  const bg = reportPctlColor(pct);
  const darkText = pct >= 40 && pct < 70;
  return `background:${bg};color:${darkText ? "#10213a" : "#ffffff"};font-weight:700;border-radius:8px;`;
}

function reportWarCellStyle(value) {
  const parsed = parseReportNumber(value);
  if (parsed == null) return "background:#f3f4f6;color:#374151;font-weight:700;border-radius:8px;";
  if (parsed === 0) return "background:transparent;color:#374151;font-weight:700;border-radius:8px;border:1px solid #d6dde8;";
  const magnitude = Math.min(Math.abs(parsed), 4);
  const alpha = 0.34 + ((magnitude / 4) * 0.54);
  if (parsed > 0) {
    return `background:rgba(255,89,16,${alpha.toFixed(3)});color:#ffffff;font-weight:800;border-radius:8px;box-shadow:inset 0 0 0 1px rgba(200,60,0,0.22);`;
  }
  return `background:rgba(0,45,114,${alpha.toFixed(3)});color:#ffffff;font-weight:800;border-radius:8px;box-shadow:inset 0 0 0 1px rgba(0,30,80,0.22);`;
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
    case "K%":
    case "Pitcher K%": return REPORT_PCTL.KPct(parsed);
    case "BB%":
    case "Pitcher BB%": return REPORT_PCTL.BBPct(parsed);
    case "K-BB%":
    case "K/BB": return REPORT_PCTL.KBB(parsed);
    case "Hard-Hit%":
    case "Pitcher Hard-Hit%": return REPORT_PCTL.HardHit(parsed);
    case "Hard Hit %":
    case "Pitcher Hard Hit %": return REPORT_PCTL.HardHit(parsed);
    case "Barrel%":
    case "Pitcher Barrel%": return REPORT_PCTL.Barrel(parsed);
    case "Barrel %":
    case "Pitcher Barrel %": return REPORT_PCTL.Barrel(parsed);
    case "Whiff%": return REPORT_PCTL.KPct(parsed);
    case "Chase%": return REPORT_PCTL.Chase(parsed);
    case "Projected wRC+":
    case "Opponent Lineup wRC+": return REPORT_PCTL.WRCPlus(parsed);
    case "xwOBA":
    case "Opponent xwOBA":
    case "Lineup xwOBA": return REPORT_PCTL.xwOBA(parsed);
    case "Pitcher xSLG":
    case "Pitcher xSLG %": return REPORT_PCTL.PitcherXSLG(parsed);
    case "xSLG":
    case "Batter xSLG":
    case "xSLG %":
    case "Batter xSLG %":
    case "Lineup xSLG": return REPORT_PCTL.xSLG(parsed);
    case "Pitcher xBA": return REPORT_PCTL.PitcherXBA(parsed);
    case "xBA":
    case "Batter xBA":
    case "Lineup xBA": return REPORT_PCTL.xBA(parsed);
    case "Batter Hard-Hit%": return REPORT_PCTL.HardHitBat(parsed);
    case "Batter Hard Hit %": return REPORT_PCTL.HardHitBat(parsed);
    case "Batter Barrel%": return REPORT_PCTL.BarrelBat(parsed);
    case "Batter Barrel %": return REPORT_PCTL.BarrelBat(parsed);
    case "Batter K%":
    case "Opponent K%": return REPORT_PCTL.BatterKPct(parsed);
    case "Batter BB%":
    case "Opponent BB%": return REPORT_PCTL.BatterBBPct(parsed);
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
  if (!/^\s*(<!doctype html>|<html|<(style|table|div))/i.test(bodyHtml)) {
    throw new Error(`[buttondown] bodyHtml does not start with <!doctype html>, <html, <style>, <table>, or <div> — first 80 chars: ${bodyHtml.slice(0, 80)}`);
  }

  const plainText = String(bodyText || "").trim();
  const richBody = `<!-- buttondown-editor-mode: fancy -->\n${bodyHtml}`;

  if (condensedMode) {
    return {
      subject,
      status,
      body: richBody,
      email_type: "public"
    };
  }

  return {
    subject,
    status,
    body: richBody,
    email_type: "public"
  };
}


/* ── Situational splits renderer ───────────────────────────────────────────────
   Returns a compact HTML card for use in site report and email.
   Returns "" on any failure — never throws.                                     */
function buildSituationalSplitsHtml(game, { mode = "site" } = {}) {
  try {
    const splits = game?.situationalSplits;
    if (!splits) return "";

    const rows = [
      splits.vsOpponent,
      splits.homeAway,
      splits.timeOfDay,
      splits.dayOfWeek,
      splits.combined,
    ].filter(Boolean);
    if (!rows.length) return "";

    // Compact row: Label | W-L (%) | Avg R | Avg RA
    const isEmail = mode === "email";
    const NAV   = "#002d72";
    const ORG   = "#ff5910";

    const rowHtml = rows.map(r => {
      const isGood = r.pct >= 55;
      const isBad  = r.pct <= 42;
      const recColor = isGood ? "#15803d" : isBad ? "#b91c1c" : "#374151";
      const rec = `${r.w}-${r.l}`;

      if (isEmail) {
        return `<tr>
          <td style="padding:5px 8px;font-size:11px;color:#374151;font-weight:600;border-bottom:1px solid #f0f4f8;">${r.label}</td>
          <td style="padding:5px 8px;font-size:12px;font-weight:800;color:${recColor};border-bottom:1px solid #f0f4f8;text-align:center;">${rec}</td>
          <td style="padding:5px 8px;font-size:11px;color:#6b7280;border-bottom:1px solid #f0f4f8;text-align:center;">${r.pct}%</td>
          <td style="padding:5px 8px;font-size:11px;color:#374151;border-bottom:1px solid #f0f4f8;text-align:center;">${r.avgR ?? "—"}</td>
          <td style="padding:5px 8px;font-size:11px;color:#374151;border-bottom:1px solid #f0f4f8;text-align:center;">${r.avgA ?? "—"}</td>
        </tr>`;
      }

      // site mode
      const pctBadge = isGood
        ? `<span class="sit-pct sit-pct--good">${r.pct}%</span>`
        : isBad
          ? `<span class="sit-pct sit-pct--bad">${r.pct}%</span>`
          : `<span class="sit-pct">${r.pct}%</span>`;

      return `<tr class="sit-row">
        <td class="sit-label">${r.label}</td>
        <td class="sit-rec" style="color:${recColor};">${rec} ${pctBadge}</td>
        <td class="sit-stat">${r.avgR ?? "—"}</td>
        <td class="sit-stat">${r.avgA ?? "—"}</td>
      </tr>`;
    }).join("");

    if (isEmail) {
      return `<table role="presentation" width="100%" style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;font-size:12px;margin-bottom:16px;">
        <thead>
          <tr style="background:#002d72;">
            <th style="padding:6px 8px;text-align:left;color:#fff;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;">Situation</th>
            <th style="padding:6px 8px;text-align:center;color:#fff;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;">Record</th>
            <th style="padding:6px 8px;text-align:center;color:#fff;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;">Win%</th>
            <th style="padding:6px 8px;text-align:center;color:#fff;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;">Avg R</th>
            <th style="padding:6px 8px;text-align:center;color:#fff;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;">Avg RA</th>
          </tr>
        </thead>
        <tbody>${rowHtml}</tbody>
      </table>`;
    }

    // site mode — uses CSS classes from styles.css
    return `<div class="sit-wrap">
      <div class="sit-title">Mets Situational Record</div>
      <table class="sit-table">
        <thead><tr>
          <th class="sit-th">Situation</th>
          <th class="sit-th sit-th--center">Record</th>
          <th class="sit-th sit-th--center">Avg R</th>
          <th class="sit-th sit-th--center">Avg RA</th>
        </tr></thead>
        <tbody>${rowHtml}</tbody>
      </table>
      <div class="sit-foot">Source: 2026 season game log &bull; <a href="/game-log" class="sit-link">Full trend finder →</a></div>
    </div>`;
  } catch (e) {
    console.warn("[situational-splits] Render failed:", e.message);
    return "";
  }
}

function buildCondensedEmailHtml(game) {
  /* ── Email data extraction ── */
  const report       = game?.writeup?.report || buildPresentationReport(game);
  const header       = report?.header;
  const pick         = report?.officialPick;
  const meta         = header?.metadataLine || "";
  const opponent     = game?.opponent || "Opponent";
  const oppAbbr      = TEAM_NAME_TO_ABBR[opponent] || opponent.split(" ").pop().toUpperCase().slice(0, 3);
  const metsLogo     = header?.metsLogoUrl || "https://www.mlbstatic.com/team-logos/121.svg";
  const oppLogo      = header?.oppLogoUrl  || "";
  const metsRecord   = sanitizeRecord(game?.metsRecord || game?.standings?.metsRecord, "");
  const oppRecord    = sanitizeRecord(game?.oppRecord  || game?.standings?.oppRecord,  "");

  // Home/away split records
  const rs = game?.recordSplits || {};
  const isHome = (game?.homeAway || "").toLowerCase() === "home";
  const metsHARecord = isHome
    ? (rs.metsHome ? `${rs.metsHome} home` : "")
    : (rs.metsRoad ? `${rs.metsRoad} away` : "");
  const oppHARecord  = isHome
    ? (rs.oppRoad  ? `${rs.oppRoad}  away` : "")
    : (rs.oppHome  ? `${rs.oppHome}  home` : "");

  const metsCard      = report?.startingPitchersComparison?.metsCard;
  const oppCard       = report?.startingPitchersComparison?.oppCard;
  const metsBullpen   = report?.bullpenReport?.mets;
  const oppBullpen    = report?.bullpenReport?.opp;
  const metsRecentForm = report?.recentFormReport?.mets;
  const oppRecentForm  = report?.recentFormReport?.opp;
  const metsLineup    = report?.projectedLineupComparison?.mets || [];
  const oppLineup     = report?.projectedLineupComparison?.opp  || [];
  const homeAwayEdge  = game?.emailData?.homeAwayEdge || null;

  /* ── Helpers ── */
  const D    = (v) => (v == null || v === "") ? "N/A" : v;
  const fmt  = (v, d = 2) => { const n = parseFloat(String(v ?? "")); return Number.isFinite(n) ? n.toFixed(d) : "N/A"; };
  const fmtPct = (v) => { const n = parseFloat(String(v ?? "")); return Number.isFinite(n) ? `${n.toFixed(1)}%` : "N/A"; };
  const fmtAvg = (v) => { const n = parseFloat(String(v ?? "")); return Number.isFinite(n) ? `.${String(Math.round(n*1000)).padStart(3,"0")}` : "N/A"; };
  const fmtOps = (v) => { const n = parseFloat(String(v ?? "")); return Number.isFinite(n) ? n.toFixed(3) : "N/A"; };

  /* ── Edge logic (lower ERA/WHIP = better; higher OPS/BA = better) ── */
  const edgeLower  = (a, b, tol = 0.01) => !Number.isFinite(a) || !Number.isFinite(b) ? "—" : a < b - tol ? "Mets" : b < a - tol ? opponent.split(" ").pop() : "Even";
  const edgeHigher = (a, b, tol = 0.005) => !Number.isFinite(a) || !Number.isFinite(b) ? "—" : a > b + tol ? "Mets" : b > a + tol ? opponent.split(" ").pop() : "Even";
  const edgeRank   = (a, b) => (a == null || b == null) ? "—" : a < b ? "Mets" : b < a ? opponent.split(" ").pop() : "Even";

  /* ── Weather ── */
  const wx = game?.weather || {};
  const wxStr = [wx.temp ? `${Math.round(wx.temp)}°` : null, wx.condition || null, wx.windSpeed ? `Wind ${Math.round(wx.windSpeed)} mph ${wx.windDir || ""}`.trim() : null].filter(Boolean).join(" · ");

  /* ── Pitching values ── */
  const metsXERA  = parseFloat(String(game?.pitching?.mets?.savant?.xERA ?? ""));
  const oppXERA   = parseFloat(String(game?.pitching?.opp?.savant?.xERA  ?? ""));
  const metsERA   = parseFloat(String(metsCard?.stats?.era  ?? ""));
  const oppERA    = parseFloat(String(oppCard?.stats?.era   ?? ""));
  const metsWHIP  = parseFloat(String(metsCard?.stats?.whip ?? ""));
  const oppWHIP   = parseFloat(String(oppCard?.stats?.whip  ?? ""));
  const metsKPct  = parseFloat(String(metsCard?.stats?.kPct ?? ""));
  const oppKPct   = parseFloat(String(oppCard?.stats?.kPct  ?? ""));

  /* ── Bullpen values ── */
  const metsBpXERA    = parseFloat(String(game?.pitching?.metsBullpen?.seasonXERAAverage ?? ""));
  const oppBpXERA     = parseFloat(String(game?.pitching?.oppBullpen?.seasonXERAAverage  ?? ""));
  const metsBpERA     = parseFloat(String(metsBullpen?.statsRow?.seasonEra  ?? ""));
  const oppBpERA      = parseFloat(String(oppBullpen?.statsRow?.seasonEra   ?? ""));
  const metsBpWHIP    = parseFloat(String(metsBullpen?.statsRow?.seasonWhip ?? ""));
  const oppBpWHIP     = parseFloat(String(oppBullpen?.statsRow?.seasonWhip  ?? ""));
  const metsBpL20ERA  = parseFloat(String(metsBullpen?.statsRow?.last20Era  ?? ""));
  const oppBpL20ERA   = parseFloat(String(oppBullpen?.statsRow?.last20Era   ?? ""));
  const metsBpFinal   = Number.isFinite(metsBpXERA) ? metsBpXERA : metsBpERA;
  const oppBpFinal    = Number.isFinite(oppBpXERA)  ? oppBpXERA  : oppBpERA;

  /* ── Offense / form values ── */
  const metsOpsRow  = metsRecentForm?.rows?.find(r => r.statKey === "ops");
  const oppOpsRow   = oppRecentForm?.rows?.find(r  => r.statKey === "ops");
  const metsAvgRow  = metsRecentForm?.rows?.find(r => r.statKey === "avg");
  const oppAvgRow   = oppRecentForm?.rows?.find(r  => r.statKey === "avg");
  const metsKRow    = metsRecentForm?.rows?.find(r => r.statKey === "kPct");
  const oppKRow     = oppRecentForm?.rows?.find(r  => r.statKey === "kPct");
  const metsBBRow   = metsRecentForm?.rows?.find(r => r.statKey === "bbPct");
  const oppBBRow    = oppRecentForm?.rows?.find(r  => r.statKey === "bbPct");

  const metsOpsL20  = metsOpsRow?.recentValue  ?? null;
  const oppOpsL20   = oppOpsRow?.recentValue   ?? null;
  const metsAvgL20  = metsAvgRow?.recentValue  ?? null;
  const oppAvgL20   = oppAvgRow?.recentValue   ?? null;
  const metsKL20    = metsKRow?.recentValue    ?? null;
  const oppKL20     = oppKRow?.recentValue     ?? null;
  const metsBBL20   = metsBBRow?.recentValue   ?? null;
  const oppBBL20    = oppBBRow?.recentValue    ?? null;
  const metsOpsRank = metsOpsRow?.recentRank   ?? null;
  const oppOpsRank  = oppOpsRow?.recentRank    ?? null;
  const metsAvgRank = metsAvgRow?.recentRank   ?? null;
  const oppAvgRank  = oppAvgRow?.recentRank    ?? null;

  /* ── Situational splits (Mets) ── */
  const splits = game?.situationalSplits || null;

  /* ── W/L dots last 5 ── */
  const wlDots = (games) => {
    if (!Array.isArray(games) || !games.length) return "";
    return games.slice(-5).map(g => {
      const w = (g.result||"").toUpperCase() === "W";
      const l = (g.result||"").toUpperCase() === "L";
      const bg = w ? "#16a34a" : l ? "#dc2626" : "#9ca3af";
      return `<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:${bg};color:#fff;font-size:9px;font-weight:900;margin-right:2px;">${w?"W":l?"L":"?"}</span>`;
    }).join("");
  };
  const metsFormGames = (metsRecentForm?.games || game?.gameContext?.metsRecentGames || []);
  const oppFormGames  = (oppRecentForm?.games  || game?.gameContext?.oppRecentGames  || []);
  const metsL5  = wlDots(metsFormGames);
  const oppL5   = wlDots(oppFormGames);

  /* ── Season series (from headToHead) ── */
  const h2h = game?.gameContext?.headToHead || null;
  const metsSeriesW = h2h?.wins   ?? null;
  const oppSeriesW  = h2h?.losses ?? null;
  const seriesStr    = (metsSeriesW != null && oppSeriesW != null) ? `${metsSeriesW}-${oppSeriesW}` : null;
  const oppSeriesStr = (metsSeriesW != null && oppSeriesW != null) ? `${oppSeriesW}-${metsSeriesW}` : null;

  /* ── Pick ── */
  const pickLabel = pick?.label || pick?.headline || "Mets ML";

  /* ── Shared table cell styles ── */
  const TH  = `padding:9px 10px;font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#6b7280;border-bottom:2px solid #e5e7eb;`;
  const TD  = `padding:9px 10px;font-size:13px;color:#111827;border-bottom:1px solid #f0f4f8;`;
  const TDB = `${TD}font-weight:700;`;
  const SEC = `margin:0 0 24px 0;`;
  const SH  = `font-size:15px;font-weight:800;color:#111827;margin:0 0 10px 0;padding-bottom:8px;border-bottom:2px solid #e5e7eb;`;

  /* ── Edge cell helper ── */
  const edgeCell = (val) => {
    if (!val || val === "—") return `<td style="${TD}color:#9ca3af;">—</td>`;
    const isMets = /mets/i.test(val);
    const isOpp  = !isMets && !/even/i.test(val);
    const color  = isMets ? "#002d72" : isOpp ? "#991b1b" : "#374151";
    const weight = (isMets || isOpp) ? "800" : "600";
    return `<td style="${TD}color:${color};font-weight:${weight};">${val}</td>`;
  };

  /* ── Rank cell helper ── */
  const rankCell = (r) => {
    if (r == null) return `<td style="${TD}color:#9ca3af;">—</td>`;
    const color = r <= 5 ? "#15803d" : r <= 15 ? "#374151" : "#b91c1c";
    return `<td style="${TD}font-weight:700;color:${color};">#${r}</td>`;
  };

  /* ── Section header ── */
  const sectionHead = (title) => `<h2 style="${SH}">${title}</h2>`;

  /* ── Table wrapper ── */
  const tableWrap = (content) => `<table role="presentation" width="100%" style="width:100%;border-collapse:collapse;">${content}</table>`;

  /* ── Model read rows ── */
  const metsOpsSeasonVal = parseFloat(String(metsOpsRow?.seasonValue ?? ""));
  const oppOpsSeasonVal  = parseFloat(String(oppOpsRow?.seasonValue  ?? ""));
  const offenseFormEdge  = edgeHigher(metsOpsL20, oppOpsL20);
  const bullpenEdge      = edgeLower(metsBpFinal, oppBpFinal);
  const spEdgeStr        = edgeLower(Number.isFinite(metsXERA) ? metsXERA : metsERA, Number.isFinite(oppXERA) ? oppXERA : oppERA);
  // Regression: if team is outperforming xERA vs ERA, regress toward opp
  let regressionRead = "Mixed";
  const metsEraXeraGap = (Number.isFinite(metsERA) && Number.isFinite(metsXERA)) ? metsXERA - metsERA : null;
  const oppEraXeraGap  = (Number.isFinite(oppERA)  && Number.isFinite(oppXERA))  ? oppXERA  - oppERA  : null;
  if (metsEraXeraGap != null && oppEraXeraGap != null) {
    regressionRead = (metsEraXeraGap < oppEraXeraGap - 0.2) ? "Mets" : (oppEraXeraGap < metsEraXeraGap - 0.2) ? opponent.split(" ").pop() : "Neutral";
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MetsMoneyline Daily Report</title>
<style>
  body,table,td{font-family:Arial,Helvetica,sans-serif;}
  @media(max-width:600px){.em-shell{width:100%!important;}.em-pad{padding:14px!important;}}
</style>
</head>
<body style="margin:0;padding:0;background:#eef2f7;color:#111827;line-height:1.5;">
<table role="presentation" width="100%" style="width:100%;border-collapse:collapse;background:#eef2f7;">
<tr><td align="center" style="padding:14px 8px;">
<table role="presentation" class="em-shell" style="width:100%;max-width:580px;border-collapse:collapse;background:#fff;border:1px solid #dde4ef;border-radius:14px;overflow:hidden;">

  <!-- HEADER -->
  <tr>
    <td style="background:linear-gradient(135deg,#001e5a 0%,#002d72 100%);padding:20px 18px 14px;">
      <table role="presentation" width="100%" style="width:100%;border-collapse:collapse;">
        <tr>
          <td align="right" style="width:36%;">
            <img src="${metsLogo}" alt="NYM" width="64" height="64" style="display:block;margin-left:auto;">
            <div style="text-align:center;color:#a0bde8;font-size:10px;font-weight:600;margin-top:3px;">${metsRecord}</div>
          </td>
          <td align="center" style="width:28%;">
            <div style="color:#ff5910;font-size:22px;font-weight:900;letter-spacing:0.04em;">VS</div>
            <div style="color:#a0bde8;font-size:10px;font-weight:600;margin-top:2px;">${game?.startTime ? formatTimeET(game.startTime) : ""}</div>
            ${wxStr ? `<div style="color:#7a9fd4;font-size:10px;margin-top:3px;">${wxStr}</div>` : ""}
          </td>
          <td align="left" style="width:36%;">
            ${oppLogo ? `<img src="${oppLogo}" alt="${oppAbbr}" width="64" height="64" style="display:block;">` : `<div style="width:64px;height:64px;background:#1a4a9e;border-radius:50%;text-align:center;line-height:64px;font-size:13px;font-weight:700;color:#fff;">${oppAbbr}</div>`}
            <div style="text-align:center;color:#a0bde8;font-size:10px;font-weight:600;margin-top:3px;">${oppRecord}</div>
          </td>
        </tr>
      </table>
      <div style="margin-top:6px;text-align:center;color:#a0bde8;font-size:10px;">${meta}</div>
    </td>
  </tr>

  <!-- PICK HERO -->
  <tr>
    <td style="background:#ff5910;padding:14px 18px;text-align:center;">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:rgba(255,255,255,0.8);margin-bottom:3px;">Tonight's Pick</div>
      <div style="font-size:22px;font-weight:900;color:#fff;">${pickLabel}</div>
      ${pick?.confidenceLabel ? `<div style="font-size:11px;color:rgba(255,255,255,0.8);margin-top:4px;">Confidence: ${pick.confidenceLabel}</div>` : ""}
    </td>
  </tr>

  <tr><td class="em-pad" style="padding:18px 18px 0;">

    <!-- ══ 1. MATCHUP SNAPSHOT ══ -->
    <div style="${SEC}">
      ${sectionHead("Matchup Snapshot")}
      ${tableWrap(`
        <thead><tr>
          <th style="${TH}text-align:left;">Category</th>
          <th style="${TH}text-align:center;">Mets</th>
          <th style="${TH}text-align:center;">${opponent.split(" ").pop()}</th>
          <th style="${TH}text-align:center;">Edge</th>
        </tr></thead>
        <tbody>
          <tr>
            <td style="${TDB}">Record</td>
            <td style="${TD}text-align:center;">${metsRecord || "—"}</td>
            <td style="${TD}text-align:center;">${oppRecord  || "—"}</td>
            ${edgeCell((() => { const mW=parseInt(metsRecord),oW=parseInt(oppRecord); return !isNaN(mW)&&!isNaN(oW)? (mW>oW?"Mets":oW>mW?opponent.split(" ").pop():"Even"):"—"; })())}
          </tr>
          <tr>
            <td style="${TDB}">Last 5</td>
            <td style="${TD}text-align:center;">${metsL5 || "—"}</td>
            <td style="${TD}text-align:center;">${oppL5  || "—"}</td>
            ${edgeCell("—")}
          </tr>
          ${metsHARecord ? `<tr>
            <td style="${TDB}">Home/Away</td>
            <td style="${TD}text-align:center;">${metsHARecord}</td>
            <td style="${TD}text-align:center;">${oppHARecord}</td>
            ${edgeCell("—")}
          </tr>` : ""}
          ${seriesStr ? `<tr>
            <td style="${TDB}">Season Series</td>
            <td style="${TD}text-align:center;">${seriesStr}</td>
            <td style="${TD}text-align:center;">${oppSeriesStr}</td>
            ${edgeCell(metsSeriesW > oppSeriesW ? "Mets" : oppSeriesW > metsSeriesW ? opponent.split(" ").pop() : "Even")}
          </tr>` : ""}
        </tbody>
      `)}
    </div>

    <!-- ══ 2. LAST 20 GAME TREND ══ -->
    <div style="${SEC}">
      ${sectionHead("Last 20 Game Trend")}
      ${tableWrap(`
        <thead><tr>
          <th style="${TH}text-align:left;">Stat</th>
          <th style="${TH}text-align:center;">Mets L20</th>
          <th style="${TH}text-align:center;">${opponent.split(" ").pop()} L20</th>
          <th style="${TH}text-align:center;">Edge</th>
        </tr></thead>
        <tbody>
          <tr>
            <td style="${TDB}">OPS</td>
            <td style="${TD}text-align:center;">${fmtOps(metsOpsL20)}</td>
            <td style="${TD}text-align:center;">${fmtOps(oppOpsL20)}</td>
            ${edgeCell(edgeHigher(metsOpsL20, oppOpsL20))}
          </tr>
          <tr>
            <td style="${TDB}">OPS Rank</td>
            ${rankCell(metsOpsRank)}
            ${rankCell(oppOpsRank)}
            ${edgeCell(edgeRank(metsOpsRank, oppOpsRank))}
          </tr>
          <tr>
            <td style="${TDB}">Batting Avg</td>
            <td style="${TD}text-align:center;">${fmtAvg(metsAvgL20)}</td>
            <td style="${TD}text-align:center;">${fmtAvg(oppAvgL20)}</td>
            ${edgeCell(edgeHigher(metsAvgL20, oppAvgL20, 0.003))}
          </tr>
          <tr>
            <td style="${TDB}">BA Rank</td>
            ${rankCell(metsAvgRank)}
            ${rankCell(oppAvgRank)}
            ${edgeCell(edgeRank(metsAvgRank, oppAvgRank))}
          </tr>
          <tr>
            <td style="${TDB}">K%</td>
            <td style="${TD}text-align:center;">${fmtPct(metsKL20)}</td>
            <td style="${TD}text-align:center;">${fmtPct(oppKL20)}</td>
            ${edgeCell(edgeLower(metsKL20, oppKL20, 0.005))}
          </tr>
          <tr>
            <td style="${TDB}">BB%</td>
            <td style="${TD}text-align:center;">${fmtPct(metsBBL20)}</td>
            <td style="${TD}text-align:center;">${fmtPct(oppBBL20)}</td>
            ${edgeCell(edgeHigher(metsBBL20, oppBBL20, 0.005))}
          </tr>
        </tbody>
      `)}
      ${(metsOpsL20 != null || oppOpsL20 != null) ? `<div style="font-size:12px;color:#374151;margin-top:8px;"><strong>Trend read:</strong> ${offenseFormEdge === "Mets" ? "Mets have the hotter offense over the last 20 games." : offenseFormEdge === "—" ? "Offense trend data unavailable." : `${opponent.split(" ").pop()} have the hotter offense. Mets ${(metsOpsRow?.improving) ? "have improved from their season baseline" : "are below season average"}, but ${opponent.split(" ").pop()} owns the stronger current-form lineup.`}</div>` : ""}
    </div>

    <!-- ══ 3. BULLPEN TREND ══ -->
    <div style="${SEC}">
      ${sectionHead("Bullpen Trend")}
      ${tableWrap(`
        <thead><tr>
          <th style="${TH}text-align:left;">Bullpen Stat</th>
          <th style="${TH}text-align:center;">Mets</th>
          <th style="${TH}text-align:center;">${opponent.split(" ").pop()}</th>
          <th style="${TH}text-align:center;">Edge</th>
        </tr></thead>
        <tbody>
          <tr>
            <td style="${TDB}">Season ERA</td>
            <td style="${TD}text-align:center;">${fmt(metsBpERA)}</td>
            <td style="${TD}text-align:center;">${fmt(oppBpERA)}</td>
            ${edgeCell(edgeLower(metsBpERA, oppBpERA))}
          </tr>
          <tr>
            <td style="${TDB}">Season WHIP</td>
            <td style="${TD}text-align:center;">${fmt(metsBpWHIP)}</td>
            <td style="${TD}text-align:center;">${fmt(oppBpWHIP)}</td>
            ${edgeCell(edgeLower(metsBpWHIP, oppBpWHIP))}
          </tr>
          ${(Number.isFinite(metsBpL20ERA) || Number.isFinite(oppBpL20ERA)) ? `<tr>
            <td style="${TDB}">Last 20 Days ERA</td>
            <td style="${TD}text-align:center;">${fmt(metsBpL20ERA)}</td>
            <td style="${TD}text-align:center;">${fmt(oppBpL20ERA)}</td>
            ${edgeCell(edgeLower(metsBpL20ERA, oppBpL20ERA))}
          </tr>` : ""}
          ${(Number.isFinite(metsBpXERA) || Number.isFinite(oppBpXERA)) ? `<tr>
            <td style="${TDB}">Bullpen xERA</td>
            <td style="${TD}text-align:center;">${fmt(metsBpXERA)}</td>
            <td style="${TD}text-align:center;">${fmt(oppBpXERA)}</td>
            ${edgeCell(edgeLower(metsBpXERA, oppBpXERA))}
          </tr>` : ""}
        </tbody>
      `)}
      <div style="font-size:12px;color:#374151;margin-top:8px;"><strong>Trend read:</strong> ${bullpenEdge === "Mets" ? "This is the clearest Mets advantage. The pick is partly built on New York having the stronger late-game profile." : bullpenEdge === "—" ? "Bullpen data unavailable." : `${opponent.split(" ").pop()} hold the bullpen edge tonight.`}</div>
    </div>

    <!-- ══ 4. STARTING PITCHER / MATCHUP ══ -->
    <div style="${SEC}">
      ${sectionHead("Starting Pitcher / Matchup Notes")}
      ${tableWrap(`
        <thead><tr>
          <th style="${TH}text-align:left;">Category</th>
          <th style="${TH}text-align:center;">Mets Starter</th>
          <th style="${TH}text-align:center;">${opponent.split(" ").pop()} Starter</th>
        </tr></thead>
        <tbody>
          <tr>
            <td style="${TDB}">Starter</td>
            <td style="${TD}text-align:center;font-weight:700;">${D(metsCard?.name)}</td>
            <td style="${TD}text-align:center;font-weight:700;">${D(oppCard?.name)}</td>
          </tr>
          <tr>
            <td style="${TDB}">Hand</td>
            <td style="${TD}text-align:center;">${metsCard?.hand ? metsCard.hand+"HP" : "N/A"}</td>
            <td style="${TD}text-align:center;">${oppCard?.hand  ? oppCard.hand+"HP"  : "N/A"}</td>
          </tr>
          <tr>
            <td style="${TDB}">ERA</td>
            <td style="${TD}text-align:center;">${fmt(metsERA)}</td>
            <td style="${TD}text-align:center;">${fmt(oppERA)}</td>
          </tr>
          ${(Number.isFinite(metsXERA) || Number.isFinite(oppXERA)) ? `<tr>
            <td style="${TDB}">xERA</td>
            <td style="${TD}text-align:center;font-weight:800;color:#002d72;">${fmt(metsXERA)}</td>
            <td style="${TD}text-align:center;font-weight:800;color:#7c2d12;">${fmt(oppXERA)}</td>
          </tr>` : ""}
          <tr>
            <td style="${TDB}">WHIP</td>
            <td style="${TD}text-align:center;">${fmt(metsWHIP)}</td>
            <td style="${TD}text-align:center;">${fmt(oppWHIP)}</td>
          </tr>
          <tr>
            <td style="${TDB}">K%</td>
            <td style="${TD}text-align:center;">${fmtPct(metsKPct)}</td>
            <td style="${TD}text-align:center;">${fmtPct(oppKPct)}</td>
          </tr>
        </tbody>
      `)}
      ${pick?.bettingAngle ? `<div style="font-size:12px;color:#374151;margin-top:8px;"><strong>Pitching angle:</strong> ${pick.bettingAngle}</div>` : ""}
    </div>

    <!-- ══ 5. SITUATIONAL SPLITS (METS) ══ -->
    ${splits ? (() => {
      const rows = [splits.vsOpponent, splits.homeAway, splits.timeOfDay, splits.dayOfWeek, splits.combined].filter(Boolean);
      if (!rows.length) return "";
      const rowsHtml = rows.map(r => {
        const pct = r.pct ?? 0;
        const color = pct >= 55 ? "#15803d" : pct <= 42 ? "#b91c1c" : "#374151";
        return `<tr>
          <td style="${TD}">${r.label || "—"}</td>
          <td style="${TD}text-align:center;font-weight:700;color:${color};">${r.w ?? 0}-${r.l ?? 0}</td>
          <td style="${TD}text-align:center;color:#6b7280;">${pct}%</td>
        </tr>`;
      }).join("");
      return `<div style="${SEC}">
        ${sectionHead("Mets Situational Record")}
        ${tableWrap(`
          <thead><tr>
            <th style="${TH}text-align:left;">Situation</th>
            <th style="${TH}text-align:center;">W-L</th>
            <th style="${TH}text-align:center;">Win%</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        `)}
      </div>`;
    })() : ""}

    <!-- ══ 6. MODEL READ ══ -->
    <div style="${SEC}">
      ${sectionHead("Model Read")}
      ${tableWrap(`
        <thead><tr>
          <th style="${TH}text-align:left;">Model Factor</th>
          <th style="${TH}text-align:center;">Read</th>
        </tr></thead>
        <tbody>
          <tr><td style="${TDB}">Offense Form</td>${edgeCell(offenseFormEdge)}</tr>
          <tr><td style="${TDB}">Bullpen Edge</td>${edgeCell(bullpenEdge)}</tr>
          <tr><td style="${TDB}">Starting Pitcher</td>${edgeCell(spEdgeStr)}</tr>
          <tr><td style="${TDB}">Regression Signal</td>${edgeCell(regressionRead)}</tr>
          <tr><td style="${TDB}">Game Context</td><td style="${TD}color:#374151;">${pick?.confidenceLabel || "Mixed"}</td></tr>
        </tbody>
      `)}
    </div>

    <!-- ══ 7. BOTTOM LINE ══ -->
    <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin-bottom:20px;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;margin-bottom:6px;">Bottom Line</div>
      <div style="font-size:13px;font-weight:900;color:#ff5910;margin-bottom:6px;">${pickLabel}</div>
      <div style="font-size:12px;color:#374151;">${pick?.summary || pick?.explanation || "See the full breakdown at MetsMoneyline.com"}</div>
    </div>

    <!-- CTA -->
    <div style="text-align:center;padding:0 0 20px;">
      <a href="https://www.metsmoneyline.com/report" style="display:inline-block;background:#002d72;color:#fff;font-size:13px;font-weight:800;padding:11px 28px;border-radius:8px;text-decoration:none;">Full Breakdown + Stats →</a>
      <div style="margin-top:8px;font-size:10px;color:#9ca3af;">Power Rankings · Trends · Analytics · Betting Odds</div>
    </div>

  </td></tr>

  <!-- FOOTER -->
  <tr>
    <td style="background:#f8fafc;border-top:1px solid #e5e7eb;padding:12px 18px;text-align:center;font-size:10px;color:#9099b0;line-height:1.6;">
      For entertainment purposes only. Always gamble responsibly.<br>
      © 2026 MetsMoneyline · Not affiliated with the New York Mets or MLB
    </td>
  </tr>

</table>
</td></tr></table>
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

  const subject = formatButtondownSubject(game);
  const bodyHtml = buildDailyReportEmailHtml(game);
  const bodyText = buildPlainTextEmail(game);
  const payload = buildButtondownPayload(bodyHtml, { subject, status: "draft", bodyText, condensedMode: true });

  console.log(`[buttondown] createButtondownDraft POST — subject: ${payload.subject}`);
  console.log(`[buttondown] createButtondownDraft POST — status: ${payload.status}, publish_date: ${payload.publish_date || "(none)"}, metadata: ${payload.metadata ? "present" : "(none)"}`);
  console.log(`[buttondown] createButtondownDraft POST — body length: ${payload.body?.length ?? 0}, starts fancy: ${payload.body?.startsWith("<!-- buttondown-editor-mode: fancy -->") ? "yes" : "no"}`);
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
  const bodyHtml = bodyOverride || buildDailyReportEmailHtml(game);
  const bodyText = buildPlainTextEmail(game);
  const payload = buildButtondownPayload(bodyHtml, { subject, status, bodyText, condensedMode: true });

  console.log(`[buttondown] createButtondownEmail POST — subject: ${payload.subject}`);
  console.log(`[buttondown] createButtondownEmail POST — status: ${payload.status}, publish_date: ${payload.publish_date || "(none)"}, metadata: ${payload.metadata ? "present" : "(none)"}`);
  console.log(`[buttondown] createButtondownEmail POST — body length: ${payload.body?.length ?? 0}, starts fancy: ${payload.body?.startsWith("<!-- buttondown-editor-mode: fancy -->") ? "yes" : "no"}`);
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
    const finalPayload = { ...payload, ...extraFields };
    console.log(`[buttondown] PATCH ${emailId} request — subject: ${finalPayload.subject || "(unchanged)"}`);
    console.log(`[buttondown] PATCH ${emailId} request — status: ${finalPayload.status || "(unchanged)"}, publish_date: ${finalPayload.publish_date || "(none)"}, metadata: ${finalPayload.metadata ? "present" : "(none)"}`);
    console.log(`[buttondown] PATCH ${emailId} request — body length: ${finalPayload.body?.length ?? 0}, starts fancy: ${finalPayload.body?.startsWith("<!-- buttondown-editor-mode: fancy -->") ? "yes" : "no"}`);
    const response = await axios.patch(
      `https://api.buttondown.com/v1/emails/${emailId}`,
      finalPayload,
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
      pickNarrative: writeup.pickNarrative || null,
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
  generateSitemap();
  generateRss();
  return { sampleJsonPath: SAMPLE_JSON_PATH, reportHtmlPath: featuredGame ? REPORT_HTML_PATH : null };
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
  isExactLocalGameReusable,
  selectFeaturedGame,
  getGameForDate,
  resolveExternalGameDate,
  isExternalGameExactMatch,
  resolveMetsGameForDate,
  buildGameFacts,
  generateWriteupFromFacts,
  buildFallbackWriteup,
  buildPresentationReport,
  buildGameJson,
  buildDeterministicTodayPick,
  normalizeTodayPickPayload,
  applyTodayPickToWriteup,
  buildDailyReportEmailHtml,
  buildEmailHtml,
  buildSiteReportHtml,
  loadPreviousOutput,
  loadPickHistory,
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
