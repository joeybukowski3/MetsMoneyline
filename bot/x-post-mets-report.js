const fs = require("fs");
const path = require("path");
const { TwitterApi } = require("twitter-api-v2");

const SAMPLE_GAME_PATH = path.join(__dirname, "..", "public", "data", "sample-game.json");
const PICK_HISTORY_PATH = path.join(__dirname, "..", "public", "data", "pick-history.json");
const ODDS_CACHE_PATH = path.join(__dirname, "..", "public", "api", "mlb", "mets", "odds.json");
const STATE_PATH = path.join(__dirname, "x-post-state.json");
const SITE_URL = "https://www.metsmoneyline.com";
const HISTORY_URL = "https://www.metsmoneyline.com/pick-history";
const MAX_TWEET_LENGTH = 280;
const DEFAULT_STAKE = 100;

function parseArgs(argv) {
  const args = { mode: null, type: "pregame", date: null };
  for (const token of argv) {
    if (token === "--dry-run") args.mode = "dry-run";
    else if (token === "--post") args.mode = "post";
    else if (token.startsWith("--type=")) args.type = cleanText(token.split("=")[1]).toLowerCase();
    else if (token.startsWith("--date=")) args.date = cleanText(token.split("=")[1]);
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!args.mode) {
    throw new Error("Usage: node bot/x-post-mets-report.js --dry-run|--post [--type=pregame|postgame] [--date=yesterday|YYYY-MM-DD]");
  }
  if (!["pregame", "postgame"].includes(args.type)) {
    throw new Error(`Unsupported type: ${args.type}`);
  }
  return args;
}

function getTodayEasternISO() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function getYesterdayEasternISO() {
  return shiftDateIso(getTodayEasternISO(), -1);
}

function shiftDateIso(dateIso, days) {
  const base = new Date(`${dateIso}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function dayDiffIso(laterDateIso, earlierDateIso) {
  const later = new Date(`${laterDateIso}T12:00:00Z`);
  const earlier = new Date(`${earlierDateIso}T12:00:00Z`);
  const ms = later.getTime() - earlier.getTime();
  return Math.round(ms / 86400000);
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(cleanText(value));
}

function resolveTargetDate(args) {
  const rawDate = cleanText(args.date);
  if (!rawDate) {
    return args.type === "postgame" ? getYesterdayEasternISO() : getTodayEasternISO();
  }
  if (rawDate.toLowerCase() === "yesterday") {
    return getYesterdayEasternISO();
  }
  if (!isIsoDate(rawDate)) {
    throw new Error(`Unsupported date value: ${rawDate}. Use yesterday or YYYY-MM-DD.`);
  }
  return rawDate;
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function maybeLoadJson(filePath) {
  try {
    return loadJson(filePath);
  } catch {
    return null;
  }
}

function loadState() {
  try {
    const parsed = loadJson(STATE_PATH);
    if (parsed && typeof parsed === "object" && parsed.posts && typeof parsed.posts === "object") {
      return parsed;
    }
  } catch {}
  return { version: 1, posts: {} };
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function logSkip(reason) {
  console.log(`SKIP: ${reason}`);
}

function cleanText(value) {
  return String(value || "")
    .replace(/%%/g, "%")
    .replace(/[Ã¢â‚¬â€œÃ¢â‚¬â€]/g, "-")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clip(value, maxLength) {
  if (!value || value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function looksPlaceholder(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return true;
  return [
    "tbd",
    "n/a",
    "sample",
    "opponent",
    "unknown",
    "null",
    "undefined",
    "nan",
    "mock"
  ].some((needle) => text === needle || text.includes(needle));
}

function parseNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = cleanText(value).replace(/[$,%]/g, "");
  if (!text) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

function selectTodayGame(data, targetDate) {
  const games = Array.isArray(data?.games) ? data.games : [];
  return games.find((game) => game?.date === targetDate) || null;
}

function opponentShortName(opponent) {
  const cleaned = cleanText(opponent);
  if (!cleaned) return null;
  const words = cleaned.split(" ");
  const lastTwo = words.slice(-2).join(" ");
  if (["Red Sox", "White Sox", "Blue Jays"].includes(lastTwo)) return lastTwo;
  return words[words.length - 1];
}

function normalizePick(game) {
  const writeup = game?.writeup || {};
  const report = writeup?.report || {};
  const candidates = [
    report?.quickRead?.officialPick,
    writeup?.quickRead?.officialPick,
    writeup?.pick,
    writeup?.officialPick,
    writeup?.analyticalLean
  ];
  const selected = candidates.find((value) => cleanText(value));
  if (!selected) return null;
  return cleanText(selected)
    .replace(/^Official Pick:\s*/i, "")
    .replace(/^Today's Pick:\s*/i, "");
}

function normalizeKeyEdge(game) {
  const writeup = game?.writeup || {};
  const report = writeup?.report || {};
  const candidates = [
    report?.quickRead?.bestEdge,
    writeup?.quickRead?.bestEdge,
    report?.analysis?.bottomLine,
    writeup?.analysis?.bottomLine,
    writeup?.pickSummary,
    report?.officialPick?.explanation
  ];
  const selected = candidates.find((value) => cleanText(value));
  if (!selected) return null;
  return clip(
    cleanText(selected)
      .replace(/^Primary edge:\s*/i, "")
      .replace(/^Main case:\s*/i, ""),
    70
  );
}

function formatOdds(value) {
  if (value == null) return null;
  if (typeof value === "number") return value > 0 ? `+${value}` : `${value}`;
  const text = cleanText(value);
  if (!text || looksPlaceholder(text)) return null;
  if (/^[+-]?\d+$/.test(text)) {
    const num = Number(text);
    return num > 0 ? `+${num}` : `${num}`;
  }
  return text;
}

function extractMetsOddsFromCache() {
  const oddsData = maybeLoadJson(ODDS_CACHE_PATH);
  const markets = oddsData?.consensus?.markets || oddsData?.markets || [];
  const h2h = markets.find((market) => market?.key === "h2h");
  const metsOutcome = h2h?.outcomes?.find((outcome) => cleanText(outcome?.name) === "New York Mets");
  return formatOdds(metsOutcome?.price ?? null);
}

function getMetsOdds(game) {
  const reportOdds = [
    game?.moneyline?.mets,
    game?.writeup?.analysisObject?.gameInfo?.metsMoneyline,
    game?.writeup?.gameDetails?.moneyline,
    game?.writeup?.report?.gameDetails?.moneyline,
    game?.writeup?.report?.teamComparison?.rows?.find((row) => row?.label === "Odds")?.mets
  ].map((value) => formatOdds(value)).find(Boolean);

  return reportOdds || extractMetsOddsFromCache();
}

function formatStatNumber(value, digits = 2) {
  if (value == null) return null;
  if (typeof value === "number") return value.toFixed(digits);
  const text = cleanText(value).replace(/%/g, "");
  if (!text) return null;
  const num = Number(text);
  if (Number.isNaN(num)) return null;
  return num.toFixed(digits);
}

function formatPercent(value, digits = 1) {
  if (value == null) return null;
  const text = cleanText(value).replace(/%/g, "");
  const num = Number(text);
  if (Number.isNaN(num)) return null;
  return num.toFixed(digits);
}

function lastName(fullName) {
  const cleaned = cleanText(fullName);
  if (!cleaned) return null;
  const parts = cleaned.split(" ");
  return parts[parts.length - 1];
}

function buildPregameParts(game) {
  const opponent = cleanText(game?.opponent);
  const opponentShort = opponentShortName(opponent);
  const pick = normalizePick(game);
  const keyEdge = normalizeKeyEdge(game);
  const time = cleanText(game?.time || game?.writeup?.gameDetails?.time);
  const venue = cleanText(game?.ballpark || game?.writeup?.gameDetails?.ballpark);
  const odds = getMetsOdds(game);

  const metsPitcher = game?.pitching?.mets || {};
  const oppPitcher = game?.pitching?.opp || {};
  const metsBullpen = game?.pitching?.metsBullpen || {};
  const oppBullpen = game?.pitching?.oppBullpen || {};

  return {
    opponent,
    opponentShort,
    pick,
    keyEdge,
    time,
    venue,
    odds,
    metsPitcherLastName: lastName(metsPitcher.name),
    oppPitcherLastName: lastName(oppPitcher.name),
    metsPitcherEra: formatStatNumber(metsPitcher.seasonERA ?? metsPitcher.era),
    metsPitcherKRate: formatPercent(metsPitcher.savant?.kPct ?? metsPitcher.kPct),
    metsPitcherFip: formatStatNumber(metsPitcher.seasonFIP ?? metsPitcher.fip),
    oppPitcherEra: formatStatNumber(oppPitcher.seasonERA ?? oppPitcher.era),
    oppPitcherFip: formatStatNumber(oppPitcher.seasonFIP ?? oppPitcher.fip),
    metsBullpenEra: formatStatNumber(metsBullpen.seasonERA),
    metsBullpenXFip: formatStatNumber(metsBullpen.seasonXFIP),
    oppBullpenEra: formatStatNumber(oppBullpen.seasonERA),
    oppBullpenXFip: formatStatNumber(oppBullpen.seasonXFIP)
  };
}

function buildPregameStateKey(targetDate, opponent) {
  return `${targetDate}-pregame-${slugify(opponent)}`;
}

function validatePregameGame(game, targetDate, state) {
  if (!game) return { ok: false, reason: `no Mets report data found for ${targetDate}` };
  if (game.date !== targetDate) return { ok: false, reason: `report date ${game.date} does not match today ${targetDate}` };
  if (cleanText(game.status).toLowerCase() !== "upcoming") {
    return { ok: false, reason: `game is not pregame (status=${game.status || "unknown"})` };
  }

  const parts = buildPregameParts(game);
  if (looksPlaceholder(parts.opponent)) return { ok: false, reason: "opponent is placeholder or missing" };
  if (!parts.pick || looksPlaceholder(parts.pick)) return { ok: false, reason: "pick is missing or placeholder" };
  if (!parts.keyEdge || looksPlaceholder(parts.keyEdge)) return { ok: false, reason: "key edge is missing or placeholder" };
  if (!parts.time || looksPlaceholder(parts.time)) return { ok: false, reason: "game time is missing" };
  if (!parts.venue || looksPlaceholder(parts.venue)) return { ok: false, reason: "venue is missing" };
  if (!parts.odds || looksPlaceholder(parts.odds)) return { ok: false, reason: "Mets moneyline odds are missing" };
  if (looksPlaceholder(game?.writeup?.headline) || looksPlaceholder(game?.writeup?.synopsis)) {
    return { ok: false, reason: "report text looks like placeholder/sample content" };
  }

  const requiredTweet2 = [
    ["Mets starter last name", parts.metsPitcherLastName],
    ["Mets starter ERA", parts.metsPitcherEra],
    ["Mets starter K rate", parts.metsPitcherKRate],
    ["Mets starter FIP", parts.metsPitcherFip],
    ["Opponent starter last name", parts.oppPitcherLastName],
    ["Opponent starter ERA", parts.oppPitcherEra],
    ["Opponent starter FIP", parts.oppPitcherFip],
    ["Mets bullpen ERA", parts.metsBullpenEra],
    ["Mets bullpen xFIP", parts.metsBullpenXFip],
    ["Opponent bullpen ERA", parts.oppBullpenEra],
    ["Opponent bullpen xFIP", parts.oppBullpenXFip]
  ];
  const missingTweet2 = requiredTweet2.find(([, value]) => !value || looksPlaceholder(value));
  if (missingTweet2) return { ok: false, reason: `${missingTweet2[0]} is missing for tweet 2` };

  const postKey = buildPregameStateKey(targetDate, parts.opponent);
  const existing = state.posts?.[postKey];
  if (existing?.postedAt || (Array.isArray(existing?.tweetIds) && existing.tweetIds.length)) {
    return { ok: false, reason: `pregame post already sent for ${targetDate} vs ${parts.opponent}` };
  }

  return { ok: true, postKey, parts };
}

function buildTweet2Variants(parts) {
  const signoff = `Official Pick: Mets Moneyline ${parts.odds}`;
  return [
    cleanText([
      "Why the Mets can win:",
      "",
      `${parts.metsPitcherLastName}: ${parts.metsPitcherEra} ERA, ${parts.metsPitcherKRate}% K, ${parts.metsPitcherFip} FIP`,
      `${parts.oppPitcherLastName}: ${parts.oppPitcherEra} ERA, ${parts.oppPitcherFip} FIP`,
      "",
      "Bullpen:",
      `Mets BP: ${parts.metsBullpenEra} ERA, ${parts.metsBullpenXFip} xFIP`,
      `${parts.opponentShort} BP: ${parts.oppBullpenEra} ERA, ${parts.oppBullpenXFip} xFIP`,
      "",
      signoff
    ].join("\n")),
    cleanText([
      "Why the Mets can win:",
      "",
      `${parts.metsPitcherLastName}: ${parts.metsPitcherEra} ERA, ${parts.metsPitcherKRate}% K, ${parts.metsPitcherFip} FIP`,
      `${parts.oppPitcherLastName}: ${parts.oppPitcherEra} ERA, ${parts.oppPitcherFip} FIP`,
      "",
      `Bullpen: Mets ${parts.metsBullpenEra}/${parts.metsBullpenXFip} xFIP | ${parts.opponentShort} ${parts.oppBullpenEra}/${parts.oppBullpenXFip}`,
      "",
      signoff
    ].join("\n")),
    cleanText([
      "Why the Mets can win:",
      "",
      `${parts.metsPitcherLastName}: ${parts.metsPitcherEra} ERA, ${parts.metsPitcherKRate}% K, ${parts.metsPitcherFip} FIP`,
      `${parts.oppPitcherLastName}: ${parts.oppPitcherEra} ERA, ${parts.oppPitcherFip} FIP`,
      "",
      `Bullpen: Mets ${parts.metsBullpenEra}/${parts.metsBullpenXFip} | ${parts.opponentShort} ${parts.oppBullpenEra}/${parts.oppBullpenXFip}`,
      "",
      signoff
    ].join("\n"))
  ];
}

function buildPregameThread(parts) {
  const tweet1 = cleanText([
    "MetsMoneyline Pregame Report",
    "",
    `Mets vs ${parts.opponentShort}`,
    parts.time,
    parts.venue,
    "",
    `Key edge: ${parts.keyEdge}`,
    "",
    "Full breakdown:",
    `${SITE_URL} #LGM`
  ].join("\n"));

  const tweet2 = buildTweet2Variants(parts).find((candidate) => candidate.length <= MAX_TWEET_LENGTH);
  if (!tweet2) {
    throw new Error("tweet 2 exceeds character limit even after bullpen shortening");
  }

  return [tweet1, tweet2];
}

function validatePregameThreadTexts(texts, parts) {
  if (texts.length !== 2) {
    return { ok: false, reason: `expected 2 tweets, got ${texts.length}` };
  }

  const expectedEnding = `Official Pick: Mets Moneyline ${parts.odds}`;
  for (let i = 0; i < texts.length; i += 1) {
    const text = texts[i];
    if (looksPlaceholder(text)) {
      return { ok: false, reason: `tweet ${i + 1} contains placeholder text` };
    }
    if (text.length > MAX_TWEET_LENGTH) {
      return { ok: false, reason: `tweet ${i + 1} exceeds ${MAX_TWEET_LENGTH} characters (${text.length})` };
    }
  }

  if (!texts[0].includes(SITE_URL)) {
    return { ok: false, reason: "tweet 1 is missing the website link" };
  }
  if (!texts[1].endsWith(expectedEnding)) {
    return { ok: false, reason: "tweet 2 does not end with the required official pick sign-off" };
  }

  return { ok: true };
}

function isMetsMoneylineEntry(entry) {
  const market = cleanText(entry?.market).toLowerCase();
  const pick = cleanText(entry?.officialPick).toLowerCase();
  return market === "mets moneyline" || pick.includes("mets ml") || pick.includes("mets moneyline");
}

function isKnownResult(entry) {
  const result = cleanText(entry?.result).toUpperCase();
  return result === "W" || result === "L" || result === "P";
}

function isFinalEntry(entry) {
  const status = cleanText(entry?.status).toLowerCase();
  const gradingStatus = cleanText(entry?.gradingStatus).toLowerCase();
  return (status === "final" || gradingStatus === "graded") && isKnownResult(entry);
}

function normalizeHistoryEntries(historyData) {
  const entries = Array.isArray(historyData?.entries) ? historyData.entries : [];
  const deduped = new Map();

  for (const entry of entries) {
    const key = entry?.sourceGamePk
      ? `gamepk:${entry.sourceGamePk}`
      : `${entry?.gameId || ""}|${entry?.startTime || ""}|${cleanText(entry?.market)}`;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, entry);
      continue;
    }
    const existingUpdated = cleanText(existing?.updatedAt || existing?.generatedAt || "");
    const currentUpdated = cleanText(entry?.updatedAt || entry?.generatedAt || "");
    if (currentUpdated > existingUpdated) deduped.set(key, entry);
  }

  return Array.from(deduped.values()).sort((a, b) => {
    const aTime = cleanText(a?.startTime || `${a?.date || ""}T00:00:00Z`);
    const bTime = cleanText(b?.startTime || `${b?.date || ""}T00:00:00Z`);
    return bTime.localeCompare(aTime);
  });
}

function toPostgameStateKey(entry) {
  const base = cleanText(entry?.date);
  const suffix = entry?.sourceGamePk || slugify(entry?.opponent || "mets");
  return `${base}-postgame-${suffix}`;
}

function parseScore(finalScore) {
  const cleaned = cleanText(finalScore);
  const match = cleaned.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) return null;
  return { mets: Number(match[1]), opp: Number(match[2]) };
}

function calculateMoneylineProfit(oddsValue, stakeValue, result) {
  const odds = parseNumber(oddsValue);
  const stake = parseNumber(stakeValue) ?? DEFAULT_STAKE;
  const normalizedResult = cleanText(result).toUpperCase();
  if (!Number.isFinite(odds) || !Number.isFinite(stake)) return null;
  if (normalizedResult === "L") return -stake;
  if (normalizedResult === "P") return 0;
  if (normalizedResult !== "W") return null;
  if (odds > 0) return stake * (odds / 100);
  return stake * (100 / Math.abs(odds));
}

function resolveEntryProfit(entry) {
  const profit = parseNumber(entry?.profit);
  if (profit != null) return profit;
  return calculateMoneylineProfit(entry?.odds, entry?.stake, entry?.result);
}

function formatCurrencyWhole(value) {
  const rounded = Math.round(value || 0);
  const absFormatted = Math.abs(rounded).toLocaleString("en-US");
  if (rounded > 0) return `+$${absFormatted}`;
  if (rounded < 0) return `-$${absFormatted}`;
  return "$0";
}

function buildSeasonSummary(historyData, filteredEntries) {
  const record = historyData?.record || {};
  const useStored =
    parseNumber(record?.wins) != null &&
    parseNumber(record?.losses) != null &&
    parseNumber(record?.profit) != null &&
    filteredEntries.every((entry) => isMetsMoneylineEntry(entry));

  if (useStored) {
    return {
      wins: parseNumber(record.wins),
      losses: parseNumber(record.losses),
      profit: parseNumber(record.profit)
    };
  }

  const completed = filteredEntries.filter((entry) => isFinalEntry(entry));
  return completed.reduce((summary, entry) => {
    const result = cleanText(entry?.result).toUpperCase();
    if (result === "W") summary.wins += 1;
    if (result === "L") summary.losses += 1;
    const profit = resolveEntryProfit(entry);
    if (profit != null) summary.profit += profit;
    return summary;
  }, { wins: 0, losses: 0, profit: 0 });
}

function buildLast7Summary(entries, referenceDate) {
  const sevenDayStart = shiftDateIso(referenceDate, -7);
  const last7Entries = entries.filter((entry) => cleanText(entry?.date) >= sevenDayStart);
  const profit = last7Entries.reduce((sum, entry) => {
    const entryProfit = resolveEntryProfit(entry);
    return entryProfit == null ? sum : sum + entryProfit;
  }, 0);
  return {
    startDate: sevenDayStart,
    profit
  };
}

function buildGameResultLine(entry) {
  const score = parseScore(entry?.finalScore);
  const opponent = opponentShortName(entry?.opponent) || cleanText(entry?.opponent) || "Opponent";
  if (!score) return `Game result: Mets vs ${opponent} final`;
  return `Game result: Mets ${score.mets}, ${opponent} ${score.opp}`;
}

function buildPostgameText(context) {
  const resultWord = context.entry.result === "W" ? "Win" : "Loss";
  const emoji = context.entry.result === "W" ? "\u2705" : "\u274c";
  return cleanText([
    "MetsMoneyline Postgame Result",
    "",
    buildGameResultLine(context.entry),
    `Mets ML: ${resultWord} ${emoji}`,
    `Season record: ${context.season.wins}-${context.season.losses}`,
    `Season P/L: ${formatCurrencyWhole(context.season.profit)}`,
    `Last 7 days: ${formatCurrencyWhole(context.last7.profit)}`,
    "",
    "Full pick history:",
    `${HISTORY_URL} #LGM`
  ].join("\n"));
}

function validatePostgameEntry(entry, state, targetDate) {
  if (!entry) return { ok: false, reason: `no graded Mets ML result found for ${targetDate}` };
  if (cleanText(entry?.date) !== targetDate) {
    return { ok: false, reason: `selected result date ${entry?.date || "unknown"} does not match target date ${targetDate}` };
  }
  if (!isFinalEntry(entry)) return { ok: false, reason: `latest candidate is not final/graded (status=${entry?.status || "unknown"})` };
  if (!isMetsMoneylineEntry(entry)) return { ok: false, reason: "latest candidate is not a Mets moneyline pick" };
  if (parseNumber(entry?.odds) == null) return { ok: false, reason: "pick odds are missing for latest completed Mets ML entry" };
  if (cleanText(entry?.gradingStatus).toLowerCase() !== "graded") return { ok: false, reason: "pick result is not graded yet" };
  if (!cleanText(entry?.finalScore)) return { ok: false, reason: "final score is missing for latest completed Mets ML entry" };
  if (entry?.estimated === true) return { ok: false, reason: "latest completed pick uses estimated data" };
  if (looksPlaceholder(entry?.officialPick) || looksPlaceholder(entry?.opponent)) {
    return { ok: false, reason: "latest completed pick contains placeholder data" };
  }
  const postKey = toPostgameStateKey(entry);
  const existing = state.posts?.[postKey];
  if (existing?.postedAt || existing?.tweetId) {
    return { ok: false, reason: `postgame result already sent for ${entry.date} vs ${entry.opponent}` };
  }
  return { ok: true, postKey };
}

function buildPostgameContext(historyData, state, targetDate) {
  const dedupedEntries = normalizeHistoryEntries(historyData);
  const allMlEntries = dedupedEntries.filter((entry) => isMetsMoneylineEntry(entry));
  const datedEntries = allMlEntries.filter((entry) => cleanText(entry?.date) === targetDate);
  if (!datedEntries.length) {
    return { ok: false, reason: `no Mets ML history entry found for ${targetDate}` };
  }
  const gradedEntries = datedEntries.filter((entry) => isFinalEntry(entry));
  if (!gradedEntries.length) {
    return { ok: false, reason: `Mets ML result for ${targetDate} is not final/graded yet` };
  }
  const latestEntry = gradedEntries[0] || null;
  const validation = validatePostgameEntry(latestEntry, state, targetDate);
  if (!validation.ok) return validation;

  const season = buildSeasonSummary(historyData, allMlEntries);
  const last7 = buildLast7Summary(allMlEntries.filter((entry) => isFinalEntry(entry)), targetDate);
  const postText = buildPostgameText({ entry: latestEntry, season, last7 });

  if (!postText || looksPlaceholder(postText)) {
    return { ok: false, reason: "postgame text resolved to placeholder content" };
  }
  if (postText.length > MAX_TWEET_LENGTH) {
    return { ok: false, reason: `postgame text exceeds ${MAX_TWEET_LENGTH} characters (${postText.length})` };
  }

  return {
    ok: true,
    postKey: validation.postKey,
    entry: latestEntry,
    season,
    last7,
    postText
  };
}

function getRequiredEnv() {
  return {
    appKey: process.env.X_API_KEY,
    appSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET
  };
}

function validateEnv(env) {
  const missing = Object.entries(env)
    .filter(([, value]) => !cleanText(value))
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(`missing required X environment variables: ${missing.join(", ")}`);
  }
}

async function postThread(texts) {
  const env = getRequiredEnv();
  validateEnv(env);
  const client = new TwitterApi(env);
  const tweetIds = [];
  let replyToId = null;

  for (const text of texts) {
    const response = replyToId
      ? await client.v2.tweet(text, { reply: { in_reply_to_tweet_id: replyToId } })
      : await client.v2.tweet(text);
    const tweetData = response?.data || response;
    if (!tweetData?.id) {
      throw new Error("X API did not return a tweet id");
    }
    tweetIds.push(tweetData.id);
    replyToId = tweetData.id;
  }

  return tweetIds;
}

async function postSingle(text) {
  const env = getRequiredEnv();
  validateEnv(env);
  const client = new TwitterApi(env);
  const response = await client.v2.tweet(text);
  const tweetData = response?.data || response;
  if (!tweetData?.id) {
    throw new Error("X API did not return a tweet id");
  }
  return tweetData.id;
}

async function runPregame(args, targetDate) {
  const sampleData = loadJson(SAMPLE_GAME_PATH);
  const state = loadState();
  const game = selectTodayGame(sampleData, targetDate);
  const validation = validatePregameGame(game, targetDate, state);

  if (!validation.ok) {
    logSkip(validation.reason);
    return;
  }

  let tweetTexts;
  try {
    tweetTexts = buildPregameThread(validation.parts);
  } catch (error) {
    logSkip(error.message);
    return;
  }

  const threadValidation = validatePregameThreadTexts(tweetTexts, validation.parts);
  if (!threadValidation.ok) {
    logSkip(threadValidation.reason);
    return;
  }

  if (args.mode === "dry-run") {
    tweetTexts.forEach((text, index) => {
      console.log(`Tweet ${index + 1} (${text.length}/${MAX_TWEET_LENGTH})`);
      console.log(text);
      if (index < tweetTexts.length - 1) console.log("");
    });
    return;
  }

  const tweetIds = await postThread(tweetTexts);
  const postedAt = new Date().toISOString();
  state.posts[validation.postKey] = {
    date: targetDate,
    opponent: validation.parts.opponent,
    postType: "pregame-thread",
    tweetTexts,
    tweetIds,
    postedAt
  };
  saveState(state);

  console.log(`POSTED THREAD: ${tweetIds.join(", ")}`);
  tweetTexts.forEach((text, index) => {
    console.log(`Tweet ${index + 1}: ${text}`);
  });
}

async function runPostgame(args, targetDate) {
  const historyData = loadJson(PICK_HISTORY_PATH);
  const state = loadState();
  const context = buildPostgameContext(historyData, state, targetDate);

  if (!context.ok) {
    logSkip(context.reason);
    return;
  }

  if (args.mode === "dry-run") {
    console.log(`Postgame tweet (${context.postText.length}/${MAX_TWEET_LENGTH})`);
    console.log(context.postText);
    return;
  }

  const tweetId = await postSingle(context.postText);
  const postedAt = new Date().toISOString();
  state.posts[context.postKey] = {
    date: context.entry.date,
    opponent: context.entry.opponent,
    postType: "postgame",
    postText: context.postText,
    tweetId,
    postedAt,
    sourceGamePk: context.entry.sourceGamePk || null,
    market: context.entry.market,
    result: context.entry.result,
    seasonRecord: `${context.season.wins}-${context.season.losses}`,
    seasonProfit: context.season.profit,
    last7Profit: context.last7.profit
  };
  saveState(state);

  console.log(`POSTED POSTGAME TWEET: ${tweetId}`);
  console.log(context.postText);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetDate = resolveTargetDate(args);

  if (args.type === "pregame") {
    await runPregame(args, targetDate);
    return;
  }

  await runPostgame(args, targetDate);
}

main().catch((error) => {
  console.error("X post script failed:", error.message);
  process.exit(1);
});
