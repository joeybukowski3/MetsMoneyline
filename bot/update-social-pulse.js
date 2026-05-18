const fs = require("fs");
const path = require("path");
const { TwitterApi } = require("twitter-api-v2");
const {
  CURRENT_PLAYER_ALIAS_OVERRIDES,
  FORMER_PLAYER_DEFS
} = require("./social-player-config");

const OUTPUT_PATH = path.join(__dirname, "..", "public", "data", "social-pulse.json");
const BLUESKY_API_BASE = "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts";
const MLB_ROSTER_URL = "https://statsapi.mlb.com/api/v1/teams/121/roster?rosterType=active";
const MAX_STORED_POSTS = 100;
const MAX_PLAYER_POSTS = 6;
const BLUESKY_QUERY_LIMIT = 15;
const DEFAULT_X_LIMIT = 30;
const HARD_X_LIMIT = 50;

// Tier 1: broad Mets/game-day queries.
const BLUESKY_PRIORITY_TERMS = [
  { label: "New York Mets", query: "\"New York Mets\"" },
  { label: "#LGM", query: "#LGM" },
  { label: "#NYMets", query: "#NYMets" },
  { label: "Mets baseball", query: "\"Mets\" baseball" },
  { label: "Citi Field", query: "\"Citi Field\"" },
  { label: "Subway Series", query: "\"Subway Series\"" },
  { label: "Carlos Mendoza", query: "\"Carlos Mendoza\" Mets" },
  { label: "Mets bullpen", query: "\"Mets bullpen\"" },
  { label: "Mets rotation", query: "\"Mets rotation\" OR \"Mets pitching\"" },
  { label: "Mets lineup", query: "\"Mets lineup\"" },
  { label: "Mets trade", query: "\"Mets\" trade" }
];

// Tier 2: known authoritative Bluesky accounts
const BLUESKY_ACCOUNT_TERMS = [
  { label: "craigcalcaterra", query: "from:craigcalcaterra.com Mets" },
  { label: "jessespector", query: "from:jessespector.com Mets" },
  { label: "jomboymedia", query: "from:jomboymedia.bsky.social Mets" },
  { label: "talkinbaseball", query: "from:talkinbaseballbot.bsky.social Mets" },
  { label: "umpscorecard", query: "from:umpscorecard.bsky.social Mets" },
  { label: "rawmlb", query: "from:rawmlb.bsky.social Mets" },
  { label: "grandcentralmets", query: "from:grandcentralmets.com" },
  { label: "metsmysterymanager", query: "from:metsmysterymanager.bsky.social" },
  { label: "juansotostats", query: "from:juan-soto-stats.bsky.social" },
  { label: "fptrack", query: "from:fptrack.com Mets" },
];

const BLUESKY_SEARCH_TERMS = [...BLUESKY_PRIORITY_TERMS, ...BLUESKY_ACCOUNT_TERMS];

const X_QUERY = [
  '("New York Mets" OR #LGM OR #NYMets OR "Mets bullpen" OR "Mets rotation" OR "Subway Series" OR "Citi Field" OR "Juan Soto" Mets OR "Francisco Lindor" OR "Mark Vientos" OR "Bo Bichette" Mets OR "Carlos Mendoza" Mets)',
  "lang:en",
  "-is:retweet",
  "-is:reply",
].join(" ");

const MATCHED_TOPIC_MAP = {
  "New York Mets": "Mets",
  "#LGM": "vibes",
  "#NYMets": "Mets",
  "Mets baseball": "Mets",
  "Citi Field": "Mets",
  "Subway Series": "Subway Series",
  "Juan Soto Mets": "Soto",
  "Francisco Lindor": "Lindor",
  "Mark Vientos": "Vientos",
  "Bo Bichette Mets": "Bichette",
  "Marcus Semien Mets": "Semien",
  "Brett Baty": "Baty",
  "Francisco Alvarez Mets": "Álvarez",
  "Carlos Mendoza": "Mendoza",
  "Mets bullpen": "bullpen",
  "Mets rotation": "starting pitching",
  "Mets lineup": "lineup",
  "Mets trade": "roster moves",
  craigcalcaterra: "media",
  jessespector: "media",
  jomboymedia: "media",
  talkinbaseball: "media",
  umpscorecard: "umpires",
  rawmlb: "media",
  grandcentralmets: "fan media",
  metsmysterymanager: "fan media",
  juansotostats: "Soto",
  fptrack: "media",
  X: "Mets"
};
const TOPIC_DEFS = [
  { label: "bullpen", aliases: ["bullpen", "reliever", "closer", "save situation"] },
  { label: "starting pitching", aliases: ["starting pitching", "starting pitcher", "rotation", "ace", "pitching matchup"] },
  { label: "lineup", aliases: ["lineup", "batting order", "top of the order", "cleanup spot"] },
  { label: "offense", aliases: ["offense", "bats", "batting", "home run", "homer", "rbi", "slugging"] },
  { label: "defense", aliases: ["defense", "glove", "fielding", "error"] },
  { label: "injuries", aliases: ["injured list", "10-day injured list", "15-day injured list", "day-to-day", "hamstring", "oblique", "calf strain", "wrist soreness"] },
  { label: "manager", aliases: ["manager", "mendoza", "lineup card"] },
  { label: "game day", aliases: ["tonight", "first pitch", "subway series", "series opener", "citi field", "yankees", "braves", "phillies", "marlins", "nationals"] },
  { label: "vibes", aliases: ["lgm", "#lgm", "lets go mets", "let's go mets"] }
];

const POSITIVE_PATTERNS = [
  /\bwin(s|ning)?\b/gi,
  /\bgreat\b/gi,
  /\belite\b/gi,
  /\bclutch\b/gi,
  /\bbomb\b/gi,
  /\bhomer\b/gi,
  /\bdominant\b/gi,
  /\blove\b/gi,
  /\bhot\b/gi,
  /\bgood start\b/gi,
  /\blgm\b/gi,
  /\bhuge\b/gi,
  /\bdeal\b/gi,
  /\bsharp\b/gi
];

const NEGATIVE_PATTERNS = [
  /\bloss\b/gi,
  /\bawful\b/gi,
  /\bterrible\b/gi,
  /\bcollapse\b/gi,
  /\binjured\b/gi,
  /\bfire\b/gi,
  /\bbad\b/gi,
  /\bwashed\b/gi,
  /\bbullpen meltdown\b/gi,
  /\bchoke\b/gi,
  /\bbrutal\b/gi,
  /\bembarrassing\b/gi,
  /\bdisaster\b/gi,
  /\bflat\b/gi
];

const SPAM_PATTERNS = [
  /(?:buy|selling|discount|promo code|stream now|follow for follow|airdrop|crypto|bet now)/i,
  /https?:\/\/\S+.*https?:\/\/\S+/i,
  /\bebay\b/i,
  /\bunauthenticated\b/i,
  /\bsigned baseball\b/i,
  /\bjersey\b/i
];

const STRONG_METS_PATTERNS = [
  /\bnew york mets\b/i,
  /#lgm\b/i,
  /#mets\b/i,
  /\blet'?s go mets\b/i,
  /\bciti field\b/i,
  /\bmr\.?\s*met\b/i,
  /\bamazin'?s\b/i,
  /\bnym\b/i
];

const BASEBALL_CONTEXT_PATTERN = /\b(baseball|mlb|pitcher|bullpen|lineup|rotation|slugger|homer|home run|inning|innings|series|first pitch|shortstop|outfielder|catcher|citi field|mets fan|yankees|braves|phillies|marlins|nationals|dodgers)\b/i;

function sanitizeText(value) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function stripDiacritics(value) {
  return sanitizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeKey(value) {
  return stripDiacritics(value).toLowerCase();
}

function slugify(value) {
  return normalizeKey(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildAliasPattern(alias) {
  const normalized = normalizeKey(alias);
  const source = escapeRegExp(normalized).replace(/\\ /g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${source}([^a-z0-9]|$)`, "i");
}

function excerpt(text, maxLength) {
  const clean = sanitizeText(text);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function buildMood(score) {
  if (score < 25) return "Very Negative";
  if (score < 45) return "Negative";
  if (score <= 55) return "Mixed";
  if (score <= 75) return "Positive";
  return "Very Positive";
}

function sentimentLabel(value) {
  if (value >= 0.25) return "Positive";
  if (value <= -0.25) return "Negative";
  return "Mixed";
}

function recencyWeight(createdAt) {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return 1;
  const ageHours = Math.max(0, (Date.now() - timestamp) / 3600000);
  return Number((Math.exp(-ageHours / 36) + 0.15).toFixed(3));
}

function scoreSentiment(text) {
  const clean = sanitizeText(text);
  if (!clean) return 0;

  let positiveHits = 0;
  let negativeHits = 0;

  POSITIVE_PATTERNS.forEach((pattern) => {
    const matches = clean.match(pattern);
    positiveHits += matches ? matches.length : 0;
  });

  NEGATIVE_PATTERNS.forEach((pattern) => {
    const matches = clean.match(pattern);
    negativeHits += matches ? matches.length : 0;
  });

  let score = (positiveHits * 0.18) - (negativeHits * 0.2);
  if (/!\s*!/.test(clean) || /!!/.test(clean)) score += 0.04;
  if (/\?{2,}/.test(clean)) score -= 0.03;

  return Math.max(-1, Math.min(1, Number(score.toFixed(2))));
}

function buildSummary(overallScore, mood, trendingTopics, currentPlayers) {
  const topTopic = trendingTopics[0]?.label;
  const topPlayer = currentPlayers[0]?.name;
  if (!topTopic && !topPlayer) {
    return "Current Mets conversation is limited right now, with no strong theme dominating the public discussion.";
  }

  const topicPhrase = topTopic ? `around ${topTopic}` : "around the current Mets roster";
  const playerPhrase = topPlayer ? ` Mentions of ${topPlayer} are among the most active.` : "";

  if (mood === "Very Positive" || mood === "Positive") {
    return `Current Mets discussion is leaning positive, with the strongest conversation ${topicPhrase}.${playerPhrase}`.trim();
  }
  if (mood === "Very Negative" || mood === "Negative") {
    return `Current Mets discussion is leaning negative, with the sharpest reactions ${topicPhrase}.${playerPhrase}`.trim();
  }
  return `Current Mets discussion is mixed, with the busiest conversation ${topicPhrase}.${playerPhrase}`.trim();
}

function isLikelySpam(text, author) {
  const clean = `${sanitizeText(text)} ${sanitizeText(author)}`;
  if (!clean) return true;
  if (clean.length < 12) return true;
  return SPAM_PATTERNS.some((pattern) => pattern.test(clean));
}

function hasStrongMetsSignal(text) {
  return STRONG_METS_PATTERNS.some((pattern) => pattern.test(text));
}

function hasBareMetsBaseballContext(text) {
  return /\bmets\b/i.test(text) && BASEBALL_CONTEXT_PATTERN.test(text);
}

function buildPlayerDef(name, playerId, aliasOverride, bucket) {
  const normalizedName = stripDiacritics(name);
  const aliases = Array.from(new Set(
    [normalizedName]
      .concat(aliasOverride?.aliases || [])
      .map((alias) => normalizeKey(alias))
      .filter(Boolean)
  ));

  return {
    name: sanitizeText(name),
    normalizedName,
    nameKey: normalizeKey(name),
    label: sanitizeText(name),
    playerId: Number(playerId) || null,
    bucket,
    requiresTeamContext: Boolean(aliasOverride?.requiresTeamContext),
    aliases,
    aliasPatterns: aliases.map((alias) => buildAliasPattern(alias))
  };
}

async function fetchCurrentRosterDefs() {
  const response = await fetch(MLB_ROSTER_URL, {
    headers: {
      Accept: "application/json",
      "User-Agent": "MetsMoneylineSocialPulse/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`MLB roster request failed with ${response.status}`);
  }

  const payload = await response.json();
  const roster = Array.isArray(payload?.roster) ? payload.roster : [];

  return roster
    .map((entry) => {
      const name = sanitizeText(entry?.person?.fullName || "");
      if (!name) return null;
      const override = CURRENT_PLAYER_ALIAS_OVERRIDES[stripDiacritics(name)] || null;
      return buildPlayerDef(name, entry?.person?.id, override, "current");
    })
    .filter(Boolean);
}

function buildFormerPlayerDefs(currentPlayers) {
  const currentKeys = new Set(currentPlayers.map((player) => player.nameKey));
  return FORMER_PLAYER_DEFS
    .filter((player) => !currentKeys.has(normalizeKey(player.name)))
    .map((player) => buildPlayerDef(player.name, player.playerId, player, "former"));
}

async function buildPlayerUniverse() {
  const currentPlayers = await fetchCurrentRosterDefs();
  const formerPlayers = buildFormerPlayerDefs(currentPlayers);
  const byNameKey = new Map();

  currentPlayers.concat(formerPlayers).forEach((player) => {
    byNameKey.set(player.nameKey, player);
  });

  return {
    currentPlayers,
    formerPlayers,
    byNameKey,
    allPlayers: currentPlayers.concat(formerPlayers)
  };
}

function buildBlueskySearchTerms(playerUniverse) {
  const seen = new Set();
  const terms = [];

  BLUESKY_SEARCH_TERMS.forEach((term) => {
    const key = `${term.label}:${term.query}`;
    if (seen.has(key)) return;
    seen.add(key);
    terms.push(term);
  });

  playerUniverse.currentPlayers.concat(playerUniverse.formerPlayers).forEach((player) => {
    const label = player.name;
    const query = `"${player.name}"`;
    const key = `${label}:${query}`;
    if (seen.has(key)) return;
    seen.add(key);
    terms.push({ label, query });
  });

  return terms;
}

function detectPlayerMentions(text, playerDefs) {
  const normalized = normalizeKey(text);
  return playerDefs.filter((player) => player.aliasPatterns.some((pattern) => pattern.test(normalized)));
}

function detectTopics(text, matchedLabel, detectedCurrentPlayers) {
  const normalized = normalizeKey(text);
  const found = new Set();

  TOPIC_DEFS.forEach((topic) => {
    if (topic.aliases.some((alias) => buildAliasPattern(alias).test(normalized))) {
      found.add(topic.label);
    }
  });

  detectedCurrentPlayers.forEach((player) => {
    found.add(player.name);
  });

  if (matchedLabel && MATCHED_TOPIC_MAP[matchedLabel]) found.add(MATCHED_TOPIC_MAP[matchedLabel]);
  return Array.from(found);
}

function isMetsRelevant(text, matchedLabel, currentMatches, formerMatches) {
  const clean = sanitizeText(text);
  if (!clean) return false;

  if (hasStrongMetsSignal(clean) || hasBareMetsBaseballContext(clean)) {
    return true;
  }

  if (currentMatches.length || formerMatches.length) {
    const matchedPlayers = currentMatches.concat(formerMatches);
    if (BASEBALL_CONTEXT_PATTERN.test(clean)) return true;
    return matchedPlayers.some((player) => !player.requiresTeamContext);
  }

  return false;
}

function classifyForMainScore(post) {
  return !post.detectedFormerPlayers.length || post.detectedCurrentPlayers.length > 0;
}

function toStoredPost(post) {
  return {
    platform: post.platform,
    author: post.author,
    displayName: post.displayName,
    text: post.text,
    url: post.url,
    createdAt: post.createdAt,
    sentiment: post.sentiment,
    sentimentLabel: post.sentimentLabel,
    popularityScore: Number(post.popularityScore || 0),
    sourceType: post.sourceType || "fan",
    matchedTopics: post.matchedTopics,
    detectedCurrentPlayers: post.detectedCurrentPlayers.map((player) => player.name),
    detectedFormerPlayers: post.detectedFormerPlayers.map((player) => player.name)
  };
}

function dedupeKey(post) {
  return sanitizeText(post.id || `${post.platform}:${post.author}:${slugify(post.text).slice(0, 80)}`);
}

function postUrlFromBlueskyView(view) {
  const uri = sanitizeText(view?.uri);
  const handle = sanitizeText(view?.author?.handle);
  if (!uri || !handle) return "";
  const segments = uri.split("/");
  const rkey = segments[segments.length - 1];
  if (!rkey) return "";
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

async function fetchBlueskySearchResults(label, query) {
  const url = `${BLUESKY_API_BASE}?q=${encodeURIComponent(query)}&limit=${BLUESKY_QUERY_LIMIT}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "MetsMoneylineSocialPulse/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Bluesky search failed for "${label}" with ${response.status}`);
  }

  const json = await response.json();
  return Array.isArray(json.posts) ? json.posts : [];
}

const AUTHORITATIVE_HANDLES = new Set([
  "craigcalcaterra.com", "jessespector.com", "jomboymedia.bsky.social",
  "talkinbaseballbot.bsky.social", "umpscorecard.bsky.social", "rawmlb.bsky.social",
  "grandcentralmets.com", "metsmysterymanager.bsky.social", "juan-soto-stats.bsky.social",
  "fptrack.com", "soltalks.bsky.social",
]);

function getSourceType(handle) {
  if (!handle) return "fan";
  const h = String(handle).toLowerCase().replace(/^@/, "");
  if (AUTHORITATIVE_HANDLES.has(h)) return "media";
  return "fan";
}
function normalizeBlueskyPost(view, matchedLabel, playerUniverse) {
  const text = sanitizeText(view?.record?.text || view?.text || "");
  if (!text) return null;
  if (isLikelySpam(text, view?.author?.handle)) return null;

  const currentMatches = detectPlayerMentions(text, playerUniverse.currentPlayers);
  const formerMatches = detectPlayerMentions(text, playerUniverse.formerPlayers);
  if (!isMetsRelevant(text, matchedLabel, currentMatches, formerMatches)) return null;

  const matchedTopics = detectTopics(text, matchedLabel, currentMatches);
  const sentiment = scoreSentiment(text);
  const createdAt = view?.record?.createdAt || view?.indexedAt || new Date().toISOString();

  const authorHandle = sanitizeText(view?.author?.handle);
  return {
    id: sanitizeText(view?.uri || view?.cid || `${matchedLabel}-${slugify(text).slice(0, 24)}`),
    platform: "bluesky",
    author: authorHandle,
    displayName: sanitizeText(view?.author?.displayName || view?.author?.handle || "Unknown"),
    text: excerpt(text, 280),
    url: postUrlFromBlueskyView(view),
    createdAt,
    sentiment,
    sentimentLabel: sentimentLabel(sentiment),
    popularityScore: Number(view?.likeCount || 0) + Number(view?.repostCount || 0),
    sourceType: getSourceType(authorHandle),
    matchedTopics,
    detectedCurrentPlayers: currentMatches,
    detectedFormerPlayers: formerMatches
  };
}

function getEnabledX() {
  return String(process.env.ENABLE_X_SOCIAL_PULSE || "").trim().toLowerCase() === "true";
}

function getXLimit() {
  const parsed = Number.parseInt(String(process.env.X_SOCIAL_POST_LIMIT || DEFAULT_X_LIMIT), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_X_LIMIT;
  return Math.min(parsed, HARD_X_LIMIT);
}

function getXClient() {
  const bearer = sanitizeText(process.env.X_BEARER_TOKEN);
  if (bearer) {
    return new TwitterApi(bearer).readOnly;
  }

  const appKey = sanitizeText(process.env.X_API_KEY);
  const appSecret = sanitizeText(process.env.X_API_SECRET);
  const accessToken = sanitizeText(process.env.X_ACCESS_TOKEN);
  const accessSecret = sanitizeText(process.env.X_ACCESS_TOKEN_SECRET);

  if (appKey && appSecret && accessToken && accessSecret) {
    return new TwitterApi({ appKey, appSecret, accessToken, accessSecret }).readOnly;
  }

  return null;
}

function buildXPostUrl(author, id) {
  const handle = sanitizeText(author).replace(/^@/, "");
  const tweetId = sanitizeText(id);
  if (!handle || !tweetId) return "";
  return `https://x.com/${handle}/status/${tweetId}`;
}

function normalizeXPost(tweet, usersById, playerUniverse) {
  const text = sanitizeText(tweet?.text || "");
  if (!text) return null;
  const authorProfile = usersById.get(tweet?.author_id) || {};
  const author = sanitizeText(authorProfile.username || authorProfile.handle || "");
  if (isLikelySpam(text, author)) return null;

  const currentMatches = detectPlayerMentions(text, playerUniverse.currentPlayers);
  const formerMatches = detectPlayerMentions(text, playerUniverse.formerPlayers);
  if (!isMetsRelevant(text, "X", currentMatches, formerMatches)) return null;

  const matchedTopics = detectTopics(text, "X", currentMatches);
  const sentiment = scoreSentiment(text);
  const metrics = tweet?.public_metrics || {};

  return {
    id: sanitizeText(tweet?.id),
    platform: "x",
    author,
    displayName: sanitizeText(authorProfile.name || author || "Unknown"),
    text: excerpt(text, 220),
    url: buildXPostUrl(author, tweet?.id),
    createdAt: tweet?.created_at || new Date().toISOString(),
    sentiment,
    sentimentLabel: sentimentLabel(sentiment),
    popularityScore: Number(metrics.like_count || 0) + Number(metrics.retweet_count || 0) + Number(metrics.reply_count || 0),
    sourceType: "fan",
    matchedTopics,
    detectedCurrentPlayers: currentMatches,
    detectedFormerPlayers: formerMatches
  };
}

async function fetchXPosts(playerUniverse) {
  if (!getEnabledX()) {
    console.log("X social pulse skipped: ENABLE_X_SOCIAL_PULSE is not true.");
    return [];
  }

  const client = getXClient();
  if (!client) {
    console.warn("X social pulse enabled, but X credentials are missing. Continuing with Bluesky only.");
    return [];
  }

  const maxResults = getXLimit();

  try {
    const result = await client.v2.search(X_QUERY, {
      max_results: maxResults,
      "tweet.fields": ["author_id", "created_at", "public_metrics", "lang"],
      "user.fields": ["name", "username"],
      expansions: ["author_id"],
      sort_order: "recency"
    });

    const tweets = Array.isArray(result?.data?.data)
      ? result.data.data
      : Array.isArray(result?.tweets)
        ? result.tweets
        : [];
    const includes = result?.data?.includes || result?.includes || {};
    const usersById = new Map(
      (Array.isArray(includes.users) ? includes.users : []).map((user) => [user.id, user])
    );

    const normalized = tweets
      .map((tweet) => normalizeXPost(tweet, usersById, playerUniverse))
      .filter(Boolean)
      .slice(0, maxResults);

    console.log(`Fetched ${normalized.length} X posts (limit ${maxResults}).`);
    return normalized;
  } catch (error) {
    console.warn(`X social pulse failed: ${sanitizeText(error.message || error.code || "unknown error")}`);
    return [];
  }
}

function collectPosts(deduped, normalizedPosts) {
  normalizedPosts.forEach((post) => {
    const key = dedupeKey(post);
    if (!deduped.has(key)) {
      deduped.set(key, post);
      return;
    }

    const existing = deduped.get(key);
    const mergedTopics = Array.from(new Set([...(existing.matchedTopics || []), ...(post.matchedTopics || [])]));
    const mergedCurrentPlayers = Array.from(new Map(
      [...(existing.detectedCurrentPlayers || []), ...(post.detectedCurrentPlayers || [])]
        .map((player) => [player.nameKey, player])
    ).values());
    const mergedFormerPlayers = Array.from(new Map(
      [...(existing.detectedFormerPlayers || []), ...(post.detectedFormerPlayers || [])]
        .map((player) => [player.nameKey, player])
    ).values());

    deduped.set(key, Object.assign({}, existing, {
      matchedTopics: mergedTopics,
      detectedCurrentPlayers: mergedCurrentPlayers,
      detectedFormerPlayers: mergedFormerPlayers,
      popularityScore: Math.max(Number(existing.popularityScore || 0), Number(post.popularityScore || 0))
    }));
  });
}

function aggregateTopicStats(posts) {
  const map = new Map();
  posts.forEach((post) => {
    (post.matchedTopics || []).forEach((label) => {
      const current = map.get(label) || { label, count: 0, sentimentTotal: 0 };
      current.count += 1;
      current.sentimentTotal += Number(post.sentiment) || 0;
      map.set(label, current);
    });
  });

  return Array.from(map.values())
    .map((item) => ({
      label: item.label,
      count: item.count,
      sentiment: round(item.sentimentTotal / item.count)
    }))
    .sort((a, b) => b.count - a.count || b.sentiment - a.sentiment || a.label.localeCompare(b.label))
    .slice(0, 8);
}

function buildPlayerEntries(playerDefs, posts, bucket) {
  const entries = playerDefs.map((player) => {
    const matchingPosts = posts.filter((post) => {
      const detected = bucket === "current" ? post.detectedCurrentPlayers : post.detectedFormerPlayers;
      return detected.some((entry) => entry.nameKey === player.nameKey);
    });
    if (!matchingPosts.length) return null;

    const sentiment = matchingPosts.reduce((sum, post) => sum + (Number(post.sentiment) || 0), 0) / matchingPosts.length;

    return {
      name: player.name,
      playerId: player.playerId,
      mentions: matchingPosts.length,
      sentiment: round(sentiment),
      posts: matchingPosts
        .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
        .slice(0, MAX_PLAYER_POSTS)
        .map((post) => ({
          platform: post.platform,
          author: post.author,
          displayName: post.displayName,
          text: post.text,
          url: post.url,
          createdAt: post.createdAt,
          sentiment: post.sentiment,
          sentimentLabel: post.sentimentLabel,
          matchedTopics: post.matchedTopics
        }))
    };
  }).filter(Boolean);

  return entries.sort((a, b) => b.mentions - a.mentions || b.sentiment - a.sentiment || a.name.localeCompare(b.name));
}

function buildSourceMap(posts) {
  const sourceMap = {};
  ["bluesky", "x"].forEach((platform) => {
    const platformPosts = posts.filter((post) => post.platform === platform);
    if (!platformPosts.length) return;
    const avg = platformPosts.reduce((sum, post) => sum + (Number(post.sentiment) || 0), 0) / platformPosts.length;
    sourceMap[platform] = {
      postCount: platformPosts.length,
      averageSentiment: round(avg)
    };
  });
  return sourceMap;
}

function buildEmptyPayload(message) {
  return {
    generatedAt: new Date().toISOString(),
    overallScore: 50,
    mood: "Mixed",
    summary: message || "Social pulse data is not available yet.",
    rosterSource: "mlb-active-roster",
    sources: {
      bluesky: {
        postCount: 0,
        averageSentiment: 0
      }
    },
    trendingTopics: [],
    trendingPlayers: [],
    currentPlayers: [],
    formerPlayers: [],
    posts: [],
    formerPosts: []
  };
}

async function buildSocialPulse() {
  const playerUniverse = await buildPlayerUniverse();
  const searchTerms = buildBlueskySearchTerms(playerUniverse);
  const deduped = new Map();
  const sourceFailures = [];

  for (const term of searchTerms) {
    try {
      const posts = await fetchBlueskySearchResults(term.label, term.query);
      const normalized = posts
        .map((view) => normalizeBlueskyPost(view, term.label, playerUniverse))
        .filter(Boolean);
      collectPosts(deduped, normalized);
    } catch (error) {
      sourceFailures.push(`${term.label}: ${error.message}`);
    }
  }

  const xPosts = await fetchXPosts(playerUniverse);
  collectPosts(deduped, xPosts);

  const fullPosts = Array.from(deduped.values()).sort((a, b) => {
    const dateDiff = Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0);
    if (dateDiff !== 0) return dateDiff;
    return Number(b.popularityScore || 0) - Number(a.popularityScore || 0);
  });

  if (!fullPosts.length) {
    sourceFailures.forEach((entry) => console.warn(entry));
    if (fs.existsSync(OUTPUT_PATH)) {
      console.warn("No fresh social pulse data was collected. Keeping the existing social-pulse.json artifact.");
      return null;
    }
    return buildEmptyPayload("Social pulse data is not available yet.");
  }

  const scoringPosts = fullPosts.filter((post) => classifyForMainScore(post));
  const formerOnlyPosts = fullPosts.filter((post) => !classifyForMainScore(post));
  const storedPosts = scoringPosts.slice(0, MAX_STORED_POSTS).map((post) => toStoredPost(post));
  const storedFormerPosts = formerOnlyPosts.slice(0, MAX_STORED_POSTS).map((post) => toStoredPost(post));

  const weightedSum = scoringPosts.reduce((sum, post) => {
    const sourceFactor = post.platform === "x" ? 0.45 : 1;
    return sum + (Number(post.sentiment) || 0) * recencyWeight(post.createdAt) * sourceFactor;
  }, 0);

  const totalWeight = scoringPosts.reduce((sum, post) => {
    const sourceFactor = post.platform === "x" ? 0.45 : 1;
    return sum + recencyWeight(post.createdAt) * sourceFactor;
  }, 0) || 1;

  const averageSentiment = weightedSum / totalWeight;
  const overallScore = Math.max(0, Math.min(100, Math.round(50 + (averageSentiment * 50))));
  const mood = buildMood(overallScore);
  const trendingTopics = aggregateTopicStats(scoringPosts);
  const currentPlayers = buildPlayerEntries(playerUniverse.currentPlayers, fullPosts, "current").slice(0, 10);
  const formerPlayers = buildPlayerEntries(playerUniverse.formerPlayers, fullPosts, "former").slice(0, 10);

  return {
    generatedAt: new Date().toISOString(),
    overallScore,
    mood,
    summary: buildSummary(overallScore, mood, trendingTopics, currentPlayers),
    rosterSource: "mlb-active-roster",
    sources: buildSourceMap(scoringPosts),
    trendingTopics,
    trendingPlayers: currentPlayers,
    currentPlayers,
    formerPlayers,
    posts: storedPosts,
    formerPosts: storedFormerPosts
  };
}

async function main() {
  const data = await buildSocialPulse();
  if (!data) return;
  writeJson(OUTPUT_PATH, data);
  console.log(`Wrote social pulse snapshot with ${data.posts.length} current/team posts to ${OUTPUT_PATH}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Failed to update social pulse data:", error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildSocialPulse
};
