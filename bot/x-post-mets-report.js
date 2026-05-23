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
const METS_TEAM_ID = 121;
const X_PHOTOS_DIR = path.join(__dirname, "..", "public", "images", "Xphotos");
const PREGAME_PITCHER_IMAGE_DIR = path.join(X_PHOTOS_DIR, "pregame", "pitchers");
const POSTGAME_IMAGE_DIR = path.join(X_PHOTOS_DIR, "postgame");
const POSTGAME_WIN_FALLBACK = "defaultpostgamewin.jpg";
const POSTGAME_LOSS_FALLBACK = "metslose.jpg";

function parseArgs(argv) {
  const args = { mode: null, type: "pregame", date: null };
  for (const token of argv) {
    if (token === "--dry-run") args.mode = "dry-run";
    else if (token === "--post") args.mode = "post";
    else if (token === "--test-image-selection") args.mode = "test-image-selection";
    else if (token.startsWith("--type=")) args.type = cleanText(token.split("=")[1]).toLowerCase();
    else if (token.startsWith("--date=")) args.date = cleanText(token.split("=")[1]);
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!args.mode) {
    throw new Error("Usage: node bot/x-post-mets-report.js --dry-run|--post|--test-image-selection [--type=pregame|postgame] [--date=yesterday|YYYY-MM-DD]");
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
    // No date passed: use today (scheduled runs now pass the game date explicitly)
    return getTodayEasternISO();
  }
  if (rawDate.toLowerCase() === "today") {
    return getTodayEasternISO();
  }
  if (rawDate.toLowerCase() === "yesterday") {
    return getYesterdayEasternISO();
  }
  if (!isIsoDate(rawDate)) {
    throw new Error(`Unsupported date value: ${rawDate}. Use today, yesterday, or YYYY-MM-DD.`);
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

function normalizeImageName(value) {
  return slugify(
    String(value || "")
      .replace(/\b(jr|sr|ii|iii|iv|v)\.?$/i, "")
      .replace(/[’']/g, "")
  );
}

function imagePathFromName(baseDir, name) {
  const slug = normalizeImageName(name);
  return slug ? path.join(baseDir, `${slug}.jpg`) : null;
}

function relativeImagePath(imagePath) {
  if (!imagePath) return null;
  return path.relative(path.join(__dirname, ".."), imagePath).replace(/\\/g, "/");
}

function fileExists(filePath) {
  return Boolean(filePath) && fs.existsSync(filePath);
}

function resolveImageWithFallback({ label, candidatePath, fallbackPath }) {
  if (fileExists(candidatePath)) {
    console.log(`[image] ${label}: ${relativeImagePath(candidatePath)}`);
    return candidatePath;
  }
  if (candidatePath) {
    console.warn(`[image] Missing selected image: ${relativeImagePath(candidatePath)}`);
  }
  if (fileExists(fallbackPath)) {
    console.log(`[image] ${label} fallback: ${relativeImagePath(fallbackPath)}`);
    return fallbackPath;
  }
  if (fallbackPath) {
    console.warn(`[image] Missing fallback image: ${relativeImagePath(fallbackPath)}. Continuing without image.`);
  }
  return null;
}

function selectPregameImage(game) {
  const pitcherName = cleanText(game?.pitching?.mets?.name);
  const candidatePath = imagePathFromName(PREGAME_PITCHER_IMAGE_DIR, pitcherName);
  const fallbackPath = path.join(PREGAME_PITCHER_IMAGE_DIR, "default.jpg");
  return resolveImageWithFallback({
    label: pitcherName ? `pregame pitcher ${pitcherName}` : "pregame pitcher",
    candidatePath,
    fallbackPath
  });
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

function buildPregameAngles(game) {
  // Pull 1-3 short, data-backed key angles from the report.
  // Priority: keyAngles (top edge explanations) → metsEdges from pick → pickSummary.
  const report  = game?.writeup?.report || {};
  const raw = [
    ...(Array.isArray(game?.writeup?.keyAngles) ? game.writeup.keyAngles : []),
    ...(Array.isArray(report?.officialPick?.metsEdges) ? report.officialPick.metsEdges : []),
    ...(Array.isArray(game?.writeup?.todayPick?.metsEdges) ? game.writeup.todayPick.metsEdges : []),
    cleanText(game?.writeup?.pickSummary || ""),
    cleanText(report?.officialPick?.bettingAngle || ""),
  ]
    .map(a => cleanText(String(a || "")))
    .filter(a => a && !looksPlaceholder(a) && a.length >= 15);

  // Deduplicate by first 30 chars
  const seen = new Set();
  return raw.filter(a => {
    const key = a.slice(0, 30);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildPregameSingleTweet(game) {
  const opponent    = cleanText(game?.opponent);
  const oppShort    = opponentShortName(opponent) || opponent;
  const report      = game?.writeup?.report || {};
  const pick        = normalizePick(game);
  const ta          = game?.teamAdvanced || {};
  const splits      = game?.situationalSplits || {};

  // Header: matchup + game time
  const gameTime    = cleanText(game?.time || game?.writeup?.gameDetails?.time || "");
  const metsPitcher = game?.pitching?.mets || {};
  const oppPitcher  = game?.pitching?.opp  || {};
  const metsName    = lastName(metsPitcher.name || report?.startingPitchersComparison?.metsCard?.name || "");
  const oppName     = lastName(oppPitcher.name  || report?.startingPitchersComparison?.oppCard?.name  || "");
  const header      = `\u{1F535} Mets vs ${oppShort}${gameTime ? " | " + gameTime : ""}`;
  const spLine      = (metsName && oppName) ? `${metsName} vs ${oppName}` : null;

  // Collect angles — always find at least one
  const angles = [];
  const add = (s) => { if (s && angles.length < 3) angles.push(`\u2705 ${clip(cleanText(s), 70)}`); };

  // 1. Model metsEdges (best quality, use first)
  for (const edge of (Array.isArray(pick?.metsEdges) ? pick.metsEdges : [])) {
    if (angles.length >= 3) break;
    const c = clip(cleanText(String(edge)), 60);
    if (c && !looksPlaceholder(c)) angles.push(`\u2705 ${c}`);
  }

  // 2. SP xERA edge
  if (angles.length < 3) {
    const mx = parseFloat(metsPitcher.savant?.xERA ?? metsPitcher.seasonXERA ?? metsPitcher.seasonERA);
    const ox = parseFloat(oppPitcher.savant?.xERA  ?? oppPitcher.seasonXERA  ?? oppPitcher.seasonERA);
    if (!isNaN(mx) && !isNaN(ox) && mx < ox)
      add(`SP edge: ${metsName || "NYM"} ${mx.toFixed(2)} xERA vs ${oppName || oppShort} ${ox.toFixed(2)}`);
  }

  // 3. Bullpen xERA edge
  if (angles.length < 3) {
    const mb = parseFloat(game?.pitching?.metsBullpen?.seasonXERAAverage);
    const ob = parseFloat(game?.pitching?.oppBullpen?.seasonXERAAverage);
    if (!isNaN(mb) && !isNaN(ob) && mb < ob)
      add(`Bullpen edge: NYM ${mb.toFixed(2)} vs ${oppShort} ${ob.toFixed(2)} xERA`);
  }

  // 4. Season xBA edge
  if (angles.length < 3) {
    const mx = parseFloat(ta?.mets?.xba);
    const ox = parseFloat(ta?.opp?.xba);
    if (!isNaN(mx) && !isNaN(ox) && mx < ox)
      add(`Season xBA: NYM .${String(Math.round(mx*1000)).padStart(3,"0")} vs ${oppShort} .${String(Math.round(ox*1000)).padStart(3,"0")}`);
  }

  // 5. L20 OPS — Mets higher or Mets trending up while opp trending down
  if (angles.length < 3) {
    const mRow = report?.recentForm?.mets?.rows?.find(r => r.statKey === "ops")
               || game?.recentForm?.mets?.rows?.find(r => r.statKey === "ops");
    const oRow = report?.recentForm?.opp?.rows?.find(r => r.statKey === "ops")
               || game?.recentForm?.opp?.rows?.find(r => r.statKey === "ops");
    const mo   = parseFloat(mRow?.recentValue);
    const oo   = parseFloat(oRow?.recentValue);
    if (!isNaN(mo) && !isNaN(oo) && mo > oo)
      add(`L20 OPS: NYM ${mo.toFixed(3)} vs ${oppShort} ${oo.toFixed(3)}`);
    else if (!isNaN(mo) && mRow?.improving && oRow && !oRow?.improving)
      add(`L20 trend: NYM OPS up ${mRow.differencePct > 0 ? "+" : ""}${parseFloat(mRow.differencePct).toFixed(1)}%, ${oppShort} cooling off`);
  }

  // 6. Situational record — pick whichest split has better win % (≥50%)
  if (angles.length < 3) {
    const candidates = [splits.timeOfDay, splits.dayOfWeek, splits.homeAway]
      .filter(s => s?.label && typeof s.pct === "number" && s.pct >= 50 && (s.w + s.l) >= 5);
    const best = candidates.sort((a, b) => b.pct - a.pct)[0];
    if (best) add(`${best.label}: ${best.w}-${best.l} (${best.pct}% W)`);
  }

  // 7. L20 xBA or opponent cooling on AVG
  if (angles.length < 3) {
    const oAvgRow = game?.recentForm?.opp?.rows?.find(r => r.statKey === "avg");
    if (oAvgRow && !oAvgRow.improving && oAvgRow.differencePct < -3)
      add(`${oppShort} batting avg down ${Math.abs(parseFloat(oAvgRow.differencePct)).toFixed(1)}% last 20 games`);
  }

  // 8. Due for a win — last resort, always fires
  if (angles.length === 0) {
    const rec = cleanText(game?.metsRecord || "");
    const [w, l] = rec.split("-").map(Number);
    const streak = game?.recentForm?.mets?.streak || game?.gameContext?.metsStreak;
    if (!isNaN(w) && !isNaN(l) && l > w) {
      add(`Mets on a tough stretch (${rec}) — regression to the mean due`);
    } else if (streak && String(streak).startsWith("L")) {
      add(`Mets in a losing streak — statistically due for a bounce back`);
    } else {
      add(`Mets looking to build on their ${rec || "season"} record tonight`);
    }
  }

  // Assemble under 280 chars
  const LIMIT = MAX_TWEET_LENGTH;
  const CTA   = "metsmoneyline.com #LGM #Mets";
  const parts = [header, spLine, "Why the Mets win tonight:", ...angles.slice(0, 3), CTA].filter(Boolean);

  function join(p) { return p.join("\n"); }
  let out = [...parts];
  while (join(out).length > LIMIT && out.length > 4) {
    const dropIdx = out.length - 2; // drop last angle before CTA
    if (dropIdx >= 3) out.splice(dropIdx, 1);
    else break;
  }

  return join(out);
}

function validatePregameGame(game, targetDate, state) {
  if (!game) return { ok: false, reason: `no Mets report data found for ${targetDate}` };
  if (game.date !== targetDate) return { ok: false, reason: `report date ${game.date} does not match today ${targetDate}` };
  if (cleanText(game.status).toLowerCase() !== "upcoming") {
    return { ok: false, reason: `game is not pregame (status=${game.status || "unknown"})` };
  }
  if (looksPlaceholder(cleanText(game?.opponent))) {
    return { ok: false, reason: "opponent is placeholder or missing" };
  }
  if (looksPlaceholder(game?.writeup?.headline) || looksPlaceholder(game?.writeup?.synopsis)) {
    return { ok: false, reason: "report text looks like placeholder or sample content" };
  }
  const postKey = buildPregameStateKey(targetDate, cleanText(game.opponent));
  const existing = state.posts?.[postKey];
  if (existing?.postedAt || existing?.tweetId) {
    return { ok: false, reason: `pregame post already sent for ${targetDate} vs ${game.opponent}` };
  }
  return { ok: true, postKey };
}

// buildTweet2Variants, buildPregameThread, validatePregameThreadTexts removed
// — replaced by buildPregameSingleTweet above

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

function readBoxscoreTeam(boxscoreData, teamId = METS_TEAM_ID) {
  const teams = boxscoreData?.teams || {};
  const candidates = [teams.home, teams.away].filter(Boolean);
  return candidates.find((team) => Number(team?.team?.id) === Number(teamId)) || null;
}

function boxscorePlayersForTeam(boxscoreData, teamId = METS_TEAM_ID) {
  const team = readBoxscoreTeam(boxscoreData, teamId);
  const players = team?.players && typeof team.players === "object" ? Object.values(team.players) : [];
  return players.map((player, index) => {
    const batting = player?.stats?.batting || {};
    const pitching = player?.stats?.pitching || {};
    return {
      name: cleanText(player?.person?.fullName),
      order: Number(player?.battingOrder || index + 1),
      batting: {
        homeRuns: parseNumber(batting.homeRuns) || 0,
        hits: parseNumber(batting.hits) || 0,
        runs: parseNumber(batting.runs) || 0,
        rbi: parseNumber(batting.rbi) || 0
      },
      pitching: {
        wins: parseNumber(pitching.wins) || 0,
        saves: parseNumber(pitching.saves) || 0
      }
    };
  }).filter((player) => player.name);
}

async function fetchMlbBoxscore(gamePk) {
  if (!gamePk) return null;
  const url = `https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[image] MLB boxscore fetch failed for gamePk ${gamePk}: HTTP ${response.status}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.warn(`[image] MLB boxscore fetch failed for gamePk ${gamePk}: ${error.message}`);
    return null;
  }
}

function chooseTopHomeRunPlayer(players) {
  return players
    .filter((player) => player.batting.homeRuns > 0)
    .sort((a, b) => (
      (b.batting.homeRuns - a.batting.homeRuns)
      || (b.batting.rbi - a.batting.rbi)
      || (a.order - b.order)
      || a.name.localeCompare(b.name)
    ))[0] || null;
}

function chooseTopBigStatPlayer(players) {
  return players
    .filter((player) => player.batting.hits >= 3 || player.batting.runs >= 3 || player.batting.rbi >= 3)
    .sort((a, b) => (
      (b.batting.rbi - a.batting.rbi)
      || (b.batting.hits - a.batting.hits)
      || (b.batting.runs - a.batting.runs)
      || (a.order - b.order)
      || a.name.localeCompare(b.name)
    ))[0] || null;
}

function choosePostgameImageCandidate(entry, boxscoreData = null) {
  const result = cleanText(entry?.result).toUpperCase();
  if (result === "L") {
    return {
      reason: "Mets loss",
      candidatePath: path.join(POSTGAME_IMAGE_DIR, POSTGAME_LOSS_FALLBACK),
      fallbackPath: path.join(POSTGAME_IMAGE_DIR, POSTGAME_LOSS_FALLBACK)
    };
  }

  const winFallback = path.join(POSTGAME_IMAGE_DIR, POSTGAME_WIN_FALLBACK);
  if (result !== "W") {
    return { reason: "No final Mets win/loss image rule matched", candidatePath: null, fallbackPath: null };
  }

  const players = boxscorePlayersForTeam(boxscoreData);
  const devinSave = players.find((player) => player.name === "Devin Williams" && player.pitching.saves > 0);
  if (devinSave) {
    return {
      reason: "Devin Williams save",
      candidatePath: imagePathFromName(POSTGAME_IMAGE_DIR, devinSave.name),
      fallbackPath: winFallback
    };
  }

  const homerPlayer = chooseTopHomeRunPlayer(players);
  if (homerPlayer) {
    return {
      reason: `Mets home run: ${homerPlayer.name}`,
      candidatePath: imagePathFromName(POSTGAME_IMAGE_DIR, homerPlayer.name),
      fallbackPath: winFallback
    };
  }

  const bigStatPlayer = chooseTopBigStatPlayer(players);
  if (bigStatPlayer) {
    return {
      reason: `Mets 3+ stat line: ${bigStatPlayer.name}`,
      candidatePath: imagePathFromName(POSTGAME_IMAGE_DIR, bigStatPlayer.name),
      fallbackPath: winFallback
    };
  }

  const winningPitcher = players
    .filter((player) => player.pitching.wins > 0)
    .sort((a, b) => a.name.localeCompare(b.name))[0] || null;
  if (winningPitcher) {
    return {
      reason: `Mets winning pitcher: ${winningPitcher.name}`,
      candidatePath: imagePathFromName(POSTGAME_IMAGE_DIR, winningPitcher.name),
      fallbackPath: winFallback
    };
  }

  return {
    reason: "Mets win default",
    candidatePath: winFallback,
    fallbackPath: winFallback
  };
}

async function selectPostgameImage(entry) {
  const needsBoxscore = cleanText(entry?.result).toUpperCase() === "W";
  const boxscoreData = needsBoxscore ? await fetchMlbBoxscore(entry?.sourceGamePk) : null;
  if (needsBoxscore && !boxscoreData) {
    console.warn("[image] No boxscore data available for postgame image priority checks; using win fallback.");
  }
  const choice = choosePostgameImageCandidate(entry, boxscoreData);
  return resolveImageWithFallback({
    label: `postgame ${choice.reason}`,
    candidatePath: choice.candidatePath,
    fallbackPath: choice.fallbackPath
  });
}

function buildImageTestBoxscore(players) {
  const mappedPlayers = {};
  players.forEach((player, index) => {
    mappedPlayers[`ID${index + 1}`] = {
      person: { fullName: player.name },
      battingOrder: player.order == null ? String((index + 1) * 100) : String(player.order),
      stats: {
        batting: {
          homeRuns: player.homeRuns || 0,
          hits: player.hits || 0,
          runs: player.runs || 0,
          rbi: player.rbi || 0
        },
        pitching: {
          wins: player.wins || 0,
          saves: player.saves || 0
        }
      }
    };
  });
  return {
    teams: {
      home: {
        team: { id: METS_TEAM_ID },
        players: mappedPlayers
      }
    }
  };
}

function assertImageChoice(label, entry, boxscoreData, expectedRelativePath) {
  const choice = choosePostgameImageCandidate(entry, boxscoreData);
  const actual = relativeImagePath(choice.candidatePath);
  if (actual !== expectedRelativePath) {
    throw new Error(`${label}: expected ${expectedRelativePath}, got ${actual || "(none)"}`);
  }
  console.log(`ok - ${label}: ${actual}`);
}

function runImageSelectionSelfTest() {
  assertImageChoice(
    "Mets loss",
    { result: "L" },
    null,
    "public/images/Xphotos/postgame/metslose.jpg"
  );
  assertImageChoice(
    "Devin Williams save",
    { result: "W" },
    buildImageTestBoxscore([{ name: "Devin Williams", saves: 1 }]),
    "public/images/Xphotos/postgame/devin-williams.jpg"
  );
  assertImageChoice(
    "Mets HR player",
    { result: "W" },
    buildImageTestBoxscore([
      { name: "Juan Soto", homeRuns: 1, rbi: 1, order: 300 },
      { name: "Francisco Lindor", homeRuns: 1, rbi: 3, order: 100 }
    ]),
    "public/images/Xphotos/postgame/francisco-lindor.jpg"
  );
  assertImageChoice(
    "Mets 3+ hits/runs/RBI player",
    { result: "W" },
    buildImageTestBoxscore([
      { name: "Juan Soto", hits: 3, runs: 1, rbi: 1, order: 300 },
      { name: "Francisco Lindor", hits: 1, runs: 1, rbi: 3, order: 100 }
    ]),
    "public/images/Xphotos/postgame/francisco-lindor.jpg"
  );
  assertImageChoice(
    "Mets winning pitcher",
    { result: "W" },
    buildImageTestBoxscore([{ name: "Kodai Senga", wins: 1 }]),
    "public/images/Xphotos/postgame/kodai-senga.jpg"
  );
  assertImageChoice(
    "Mets win default",
    { result: "W" },
    buildImageTestBoxscore([{ name: "Juan Soto" }]),
    "public/images/Xphotos/postgame/defaultpostgamewin.jpg"
  );

  const missingPlayerChoice = choosePostgameImageCandidate(
    { result: "W" },
    buildImageTestBoxscore([{ name: "Missing Player", homeRuns: 1 }])
  );
  const resolvedMissing = resolveImageWithFallback({
    label: "postgame missing player test",
    candidatePath: missingPlayerChoice.candidatePath,
    fallbackPath: missingPlayerChoice.fallbackPath
  });
  console.log(`ok - Missing player image fallback path attempted: ${relativeImagePath(missingPlayerChoice.fallbackPath)}`);
  console.log(`ok - Missing player image resolved media: ${relativeImagePath(resolvedMissing) || "(none)"}`);
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

async function uploadTweetImage(client, imagePath) {
  if (!imagePath) return null;
  try {
    const mediaId = await client.v1.uploadMedia(imagePath);
    console.log(`[image] Uploaded ${relativeImagePath(imagePath)} as media ${mediaId}`);
    return mediaId;
  } catch (error) {
    console.warn(`[image] Failed to upload ${relativeImagePath(imagePath)}: ${error.message}. Continuing without image.`);
    return null;
  }
}

async function postSingle(text, imagePath = null) {
  const env = getRequiredEnv();
  validateEnv(env);
  const client = new TwitterApi(env);
  const mediaId = await uploadTweetImage(client, imagePath);
  const response = mediaId
    ? await client.v2.tweet(text, { media: { media_ids: [mediaId] } })
    : await client.v2.tweet(text);
  const tweetData = response?.data || response;
  if (!tweetData?.id) {
    throw new Error("X API did not return a tweet id");
  }
  return tweetData.id;
}

async function runPregame(args, targetDate) {
  const sampleData = loadJson(SAMPLE_GAME_PATH);
  const state      = loadState();
  const game       = selectTodayGame(sampleData, targetDate);
  const validation = validatePregameGame(game, targetDate, state);

  if (!validation.ok) {
    logSkip(validation.reason);
    return;
  }

  // Build single pregame tweet
  let tweetText;
  try {
    tweetText = buildPregameSingleTweet(game);
  } catch (err) {
    logSkip(`buildPregameSingleTweet failed: ${err.message}`);
    return;
  }

  if (!tweetText || looksPlaceholder(tweetText)) {
    logSkip("pregame tweet resolved to empty or placeholder content");
    return;
  }
  if (tweetText.length > MAX_TWEET_LENGTH) {
    logSkip(`pregame tweet too long (${tweetText.length} chars)`);
    return;
  }

  const imagePath = selectPregameImage(game);

  if (args.mode === "dry-run") {
    console.log(`Pregame tweet (${tweetText.length}/${MAX_TWEET_LENGTH}):`);
    console.log(tweetText);
    console.log(`[image] Dry run media: ${relativeImagePath(imagePath) || "(none)"}`);
    return;
  }

  const tweetId = await postSingle(tweetText, imagePath);
  const postedAt = new Date().toISOString();
  state.posts[validation.postKey] = {
    date: targetDate,
    opponent: cleanText(game.opponent),
    postType: "pregame",
    tweetText,
    tweetId,
    postedAt
  };
  saveState(state);

  console.log(`POSTED PREGAME TWEET: ${tweetId}`);
  console.log(tweetText);
}

async function runPostgame(args, targetDate) {
  const historyData = loadJson(PICK_HISTORY_PATH);
  const state = loadState();
  const context = buildPostgameContext(historyData, state, targetDate);

  if (!context.ok) {
    logSkip(context.reason);
    return;
  }

  const imagePath = await selectPostgameImage(context.entry);

  if (args.mode === "dry-run") {
    console.log(`Postgame tweet (${context.postText.length}/${MAX_TWEET_LENGTH})`);
    console.log(context.postText);
    console.log(`[image] Dry run media: ${relativeImagePath(imagePath) || "(none)"}`);
    return;
  }

  const tweetId = await postSingle(context.postText, imagePath);
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
  if (args.mode === "test-image-selection") {
    runImageSelectionSelfTest();
    return;
  }

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
