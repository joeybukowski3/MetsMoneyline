const fs = require("fs");
const path = require("path");
const { TwitterApi } = require("twitter-api-v2");

const SAMPLE_GAME_PATH = path.join(__dirname, "..", "public", "data", "sample-game.json");
const STATE_PATH = path.join(__dirname, "x-post-state.json");
const SITE_URL = "https://www.metsmoneyline.com";
const MAX_TWEET_LENGTH = 280;

function parseArgs(argv) {
  const args = { mode: null };
  for (const token of argv) {
    if (token === "--dry-run") args.mode = "dry-run";
    else if (token === "--post") args.mode = "post";
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!args.mode) {
    throw new Error("Usage: node bot/x-post-mets-report.js --dry-run | --post");
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

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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
    .replace(/[–—]/g, "-")
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
    "nan"
  ].some((needle) => text === needle || text.includes(needle));
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

function normalizeConfidence(game) {
  const writeup = game?.writeup || {};
  const report = writeup?.report || {};
  const raw = report?.officialPick?.confidence ?? writeup?.confidence ?? report?.meta?.confidence ?? null;
  if (raw == null) return null;
  if (typeof raw === "number") return String(raw);
  const text = cleanText(raw);
  if (!text) return null;
  return text.charAt(0).toUpperCase() + text.slice(1);
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
  return clip(cleanText(selected)
    .replace(/^Primary edge:\s*/i, "")
    .replace(/^Main case:\s*/i, ""), 70);
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

function getPickWithOdds(game, pick) {
  const odds = formatOdds(game?.moneyline?.mets ?? game?.writeup?.gameDetails?.moneyline ?? null);
  return odds ? `${pick} ${odds}` : pick;
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

function formatDotStat(value, digits = 3) {
  if (value == null) return null;
  const text = cleanText(value);
  const num = Number(text);
  if (Number.isNaN(num)) return null;
  return `.${num.toFixed(digits).split(".")[1]}`;
}

function lastName(fullName) {
  const cleaned = cleanText(fullName);
  if (!cleaned) return null;
  const parts = cleaned.split(" ");
  return parts[parts.length - 1];
}

function normalizeRiskSummary(game) {
  const mets = game?.writeup?.analysisObject?.offense?.mets || {};
  const opp = game?.writeup?.analysisObject?.offense?.opp || {};
  const metsWar = formatStatNumber(mets.projectedLineupWAR, 1);
  const oppWar = formatStatNumber(opp.projectedLineupWAR, 1);
  const metsWrcPlus = formatStatNumber(mets.projectedLineupWRCPlus, 1);
  const oppWrcPlus = formatStatNumber(opp.projectedLineupWRCPlus, 1);
  const metsXwoba = formatDotStat(mets.xwOBA, 3);
  const oppXwoba = formatDotStat(opp.xwOBA, 3);

  if (metsWar && oppWar && metsWrcPlus && oppWrcPlus && metsXwoba && oppXwoba) {
    return `Lineup edge favors COL: WAR ${metsWar} vs ${oppWar}, wRC+ ${metsWrcPlus} vs ${oppWrcPlus}, xwOBA ${metsXwoba} vs ${oppXwoba}.`;
  }

  const fallback = game?.writeup?.quickRead?.biggestRisk || game?.writeup?.report?.quickRead?.biggestRisk || null;
  if (!fallback) return null;
  return `${cleanText(fallback)}.`;
}

function buildThreadParts(game) {
  const opponent = cleanText(game?.opponent);
  const opponentShort = opponentShortName(opponent);
  const pick = normalizePick(game);
  const confidence = normalizeConfidence(game);
  const keyEdge = normalizeKeyEdge(game);
  const riskSummary = normalizeRiskSummary(game);
  const time = cleanText(game?.time || game?.writeup?.gameDetails?.time);
  const venue = cleanText(game?.ballpark || game?.writeup?.gameDetails?.ballpark);

  const metsPitcher = game?.pitching?.mets || {};
  const oppPitcher = game?.pitching?.opp || {};
  const metsOffense = game?.writeup?.analysisObject?.offense?.mets || {};
  const metsBullpen = game?.pitching?.metsBullpen || {};
  const oppBullpen = game?.pitching?.oppBullpen || {};

  const metsPitcherLastName = lastName(metsPitcher.name);
  const oppPitcherLastName = lastName(oppPitcher.name);
  const metsPitcherEra = formatStatNumber(metsPitcher.seasonERA ?? metsPitcher.era);
  const metsPitcherKRate = formatPercent(metsPitcher.savant?.kPct ?? metsPitcher.kPct);
  const metsPitcherFip = formatStatNumber(metsPitcher.seasonFIP ?? metsPitcher.fip);
  const oppPitcherEra = formatStatNumber(oppPitcher.seasonERA ?? oppPitcher.era);
  const oppPitcherFip = formatStatNumber(oppPitcher.seasonFIP ?? oppPitcher.fip);
  const metsXwoba = formatStatNumber(metsOffense.xwOBA, 3);
  const metsActualWoba = formatStatNumber(metsOffense.wOBA, 3);
  const metsBullpenEra = formatStatNumber(metsBullpen.seasonERA);
  const metsBullpenXFip = formatStatNumber(metsBullpen.seasonXFIP);
  const oppBullpenEra = formatStatNumber(oppBullpen.seasonERA);
  const oppBullpenXFip = formatStatNumber(oppBullpen.seasonXFIP);

  return {
    opponent,
    opponentShort,
    pick,
    confidence,
    keyEdge,
    riskSummary,
    time,
    venue,
    pickWithOdds: getPickWithOdds(game, pick),
    metsPitcherLastName,
    oppPitcherLastName,
    metsPitcherEra,
    metsPitcherKRate,
    metsPitcherFip,
    oppPitcherEra,
    oppPitcherFip,
    metsXwoba,
    metsActualWoba,
    metsBullpenEra,
    metsBullpenXFip,
    oppBullpenEra,
    oppBullpenXFip
  };
}

function validateGame(game, targetDate, state) {
  if (!game) return { ok: false, reason: `no Mets report data found for ${targetDate}` };
  if (game.date !== targetDate) return { ok: false, reason: `report date ${game.date} does not match today ${targetDate}` };
  if (cleanText(game.status).toLowerCase() !== "upcoming") {
    return { ok: false, reason: `game is not pregame (status=${game.status || "unknown"})` };
  }

  const parts = buildThreadParts(game);
  if (looksPlaceholder(parts.opponent)) return { ok: false, reason: "opponent is placeholder or missing" };
  if (!parts.pick || looksPlaceholder(parts.pick)) return { ok: false, reason: "pick is missing or placeholder" };
  if (!parts.confidence || looksPlaceholder(parts.confidence)) return { ok: false, reason: "confidence is missing or placeholder" };
  if (!parts.keyEdge || looksPlaceholder(parts.keyEdge)) return { ok: false, reason: "key edge is missing or placeholder" };
  if (!parts.time || looksPlaceholder(parts.time)) return { ok: false, reason: "game time is missing" };
  if (!parts.venue || looksPlaceholder(parts.venue)) return { ok: false, reason: "venue is missing" };
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
    ["Mets xwOBA", parts.metsXwoba],
    ["Mets actual wOBA", parts.metsActualWoba]
  ];
  const missingTweet2 = requiredTweet2.find(([, value]) => !value || looksPlaceholder(value));
  if (missingTweet2) return { ok: false, reason: `${missingTweet2[0]} is missing for tweet 2` };

  const requiredTweet3 = [
    ["Mets bullpen ERA", parts.metsBullpenEra],
    ["Mets bullpen xFIP", parts.metsBullpenXFip],
    ["Opponent bullpen ERA", parts.oppBullpenEra],
    ["Opponent bullpen xFIP", parts.oppBullpenXFip],
    ["Risk summary", parts.riskSummary]
  ];
  const missingTweet3 = requiredTweet3.find(([, value]) => !value || looksPlaceholder(value));
  if (missingTweet3) return { ok: false, reason: `${missingTweet3[0]} is missing for tweet 3` };

  const postKey = `${targetDate}-mets-vs-${slugify(parts.opponent)}`;
  const existing = state.posts?.[postKey];
  if (existing?.postedAt || (Array.isArray(existing?.tweetIds) && existing.tweetIds.length)) {
    return { ok: false, reason: `post already sent for ${targetDate} vs ${parts.opponent}` };
  }

  return { ok: true, postKey, parts };
}

function buildThread(parts) {
  const tweet1Lines = [
    "MetsMoneyline Pregame Report",
    "",
    `Mets vs ${parts.opponentShort}`,
    parts.time,
    parts.venue,
    "",
    `Pick: ${parts.pickWithOdds}`,
    `Key edge: ${parts.keyEdge}`,
    "",
    "Full breakdown:",
    `${SITE_URL} #LGM`
  ];

  const tweet2Lines = [
    "Why the Mets can win:",
    "",
    `${parts.metsPitcherLastName}: ${parts.metsPitcherEra} ERA, ${parts.metsPitcherKRate}% K, ${parts.metsPitcherFip} FIP`,
    `${parts.oppPitcherLastName}: ${parts.oppPitcherEra} ERA, ${parts.oppPitcherFip} FIP`,
    "",
    "Regression:",
    `xwOBA ${parts.metsXwoba} vs actual wOBA ${parts.metsActualWoba} - expected stats above actual production.`
  ];

  const tweet3Lines = [
    "Bullpen:",
    "",
    `Mets BP: ${parts.metsBullpenEra} ERA, ${parts.metsBullpenXFip} xFIP`,
    `${parts.opponentShort} BP: ${parts.oppBullpenEra} ERA, ${parts.oppBullpenXFip} xFIP`,
    "",
    "Where the risk is:",
    parts.riskSummary
  ];

  return [tweet1Lines, tweet2Lines, tweet3Lines].map((lines) => cleanText(lines.join("\n").replace(/\n /g, "\n")));
}

function validateThreadTexts(texts) {
  for (let i = 0; i < texts.length; i += 1) {
    const text = texts[i];
    if (looksPlaceholder(text)) {
      return { ok: false, reason: `tweet ${i + 1} contains placeholder text` };
    }
    if (text.length > MAX_TWEET_LENGTH) {
      return { ok: false, reason: `tweet ${i + 1} exceeds ${MAX_TWEET_LENGTH} characters (${text.length})` };
    }
  }
  return { ok: true };
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetDate = getTodayEasternISO();
  const sampleData = loadJson(SAMPLE_GAME_PATH);
  const state = loadState();
  const game = selectTodayGame(sampleData, targetDate);
  const validation = validateGame(game, targetDate, state);

  if (!validation.ok) {
    logSkip(validation.reason);
    return;
  }

  const tweetTexts = buildThread(validation.parts);
  const threadValidation = validateThreadTexts(tweetTexts);
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

main().catch((error) => {
  console.error("X post script failed:", error.message);
  process.exit(1);
});
