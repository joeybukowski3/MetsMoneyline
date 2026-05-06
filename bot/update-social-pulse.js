const fs = require("fs");
const path = require("path");
const { TwitterApi } = require("twitter-api-v2");

const OUTPUT_PATH = path.join(__dirname, "..", "public", "data", "social-pulse.json");
const BLUESKY_API_BASE = "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts";
const MAX_STORED_POSTS = 40;
const BLUESKY_QUERY_LIMIT = 12;
const DEFAULT_X_LIMIT = 10;
const HARD_X_LIMIT = 10;

const BLUESKY_SEARCH_TERMS = [
  { label: "Mets", query: "Mets" },
  { label: "#LGM", query: "#LGM" },
  { label: "New York Mets", query: "\"New York Mets\"" },
  { label: "Mets bullpen", query: "\"Mets bullpen\"" },
  { label: "Pete Alonso", query: "\"Pete Alonso\"" },
  { label: "Francisco Lindor", query: "\"Francisco Lindor\"" },
  { label: "Brandon Nimmo", query: "\"Brandon Nimmo\"" },
  { label: "Edwin Diaz", query: "\"Edwin Diaz\"" },
  { label: "Kodai Senga", query: "\"Kodai Senga\"" }
];

const X_QUERY = [
  "(Mets OR \"New York Mets\" OR #LGM OR \"Mets bullpen\" OR \"Pete Alonso\" OR \"Francisco Lindor\" OR \"Carlos Mendoza\")",
  "-is:retweet",
  "-is:reply",
  "-has:links"
].join(" ");

const MATCHED_TOPIC_MAP = {
  Mets: "Mets",
  "#LGM": "vibes",
  "New York Mets": "Mets",
  "Mets bullpen": "bullpen",
  "Pete Alonso": "Alonso",
  "Francisco Lindor": "Lindor",
  "Brandon Nimmo": "Nimmo",
  "Edwin Diaz": "Díaz",
  "Kodai Senga": "Senga",
  X: "Mets"
};

const PLAYER_DEFS = [
  { name: "Pete Alonso", label: "Alonso", aliases: ["pete alonso", "alonso", "polar bear"] },
  { name: "Francisco Lindor", label: "Lindor", aliases: ["francisco lindor", "lindor"] },
  { name: "Brandon Nimmo", label: "Nimmo", aliases: ["brandon nimmo", "nimmo"] },
  { name: "Edwin Díaz", label: "Díaz", aliases: ["edwin diaz", "edwin díaz", "diaz", "díaz", "sugar"] },
  { name: "Kodai Senga", label: "Senga", aliases: ["kodai senga", "senga", "ghost fork"] },
  { name: "Juan Soto", label: "Soto", aliases: ["juan soto", "soto"] },
  { name: "Mark Vientos", label: "Vientos", aliases: ["mark vientos", "vientos"] },
  { name: "Jeff McNeil", label: "McNeil", aliases: ["jeff mcneil", "mcneil"] },
  { name: "Francisco Alvarez", label: "Álvarez", aliases: ["francisco alvarez", "francisco álvarez", "alvarez", "álvarez"] },
  { name: "Brett Baty", label: "Baty", aliases: ["brett baty", "baty"] },
  { name: "Luisangel Acuña", label: "Acuña", aliases: ["luisangel acuna", "luisangel acuña", "acuna", "acuña"] },
  { name: "Carlos Mendoza", label: "Mendoza", aliases: ["carlos mendoza", "mendoza"] }
];

const TOPIC_DEFS = [
  { label: "bullpen", aliases: ["bullpen", "reliever", "closer", "meltdown", "save situation"] },
  { label: "starting pitching", aliases: ["starting pitching", "starter", "rotation", "ace", "senga", "pitching matchup"] },
  { label: "lineup", aliases: ["lineup", "order", "batting order", "top of the order"] },
  { label: "offense", aliases: ["offense", "bats", "batting", "homer", "home run", "rbi", "slugging"] },
  { label: "defense", aliases: ["defense", "glove", "fielding", "error"] },
  { label: "injuries", aliases: ["injury", "injured", "il", "hurt", "day-to-day", "calf issue"] },
  { label: "manager", aliases: ["manager", "mendoza", "lineup card"] },
  { label: "vibes", aliases: ["lgm", "#lgm", "let's go mets", "lets go mets"] }
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

function sanitizeText(value) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value) {
  return sanitizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function excerpt(text, maxLength) {
  const clean = sanitizeText(text);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function isLikelySpam(text, author) {
  const clean = `${sanitizeText(text)} ${sanitizeText(author)}`;
  if (!clean) return true;
  if (clean.length < 12) return true;
  return SPAM_PATTERNS.some((pattern) => pattern.test(clean));
}

function isMetsRelevant(text, queryLabel) {
  const lower = sanitizeText(text).toLowerCase();
  if (!lower) return false;

  if (
    lower.includes("mets") ||
    lower.includes("#lgm") ||
    lower.includes("new york mets") ||
    lower.includes("lets go mets") ||
    lower.includes("let's go mets")
  ) {
    return true;
  }

  if (PLAYER_DEFS.some((player) => player.aliases.some((alias) => lower.includes(alias)))) {
    return true;
  }

  return lower.includes(sanitizeText(queryLabel).toLowerCase());
}

function detectPlayers(text) {
  const lower = sanitizeText(text).toLowerCase();
  return PLAYER_DEFS
    .filter((player) => player.aliases.some((alias) => lower.includes(alias)))
    .map((player) => player.name);
}

function detectTopics(text, matchedLabel, detectedPlayers) {
  const lower = sanitizeText(text).toLowerCase();
  const found = new Set();

  TOPIC_DEFS.forEach((topic) => {
    if (topic.aliases.some((alias) => lower.includes(alias))) found.add(topic.label);
  });

  detectedPlayers.forEach((name) => {
    const player = PLAYER_DEFS.find((entry) => entry.name === name);
    found.add(player ? player.label : name);
  });

  if (matchedLabel && MATCHED_TOPIC_MAP[matchedLabel]) found.add(MATCHED_TOPIC_MAP[matchedLabel]);
  return Array.from(found);
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

function recencyWeight(createdAt) {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return 1;
  const ageHours = Math.max(0, (Date.now() - timestamp) / 3600000);
  return Number((Math.exp(-ageHours / 36) + 0.15).toFixed(3));
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

function buildSummary(overallScore, mood, trendingTopics, trendingPlayers) {
  const topTopic = trendingTopics[0]?.label;
  const topPlayer = trendingPlayers[0]?.name;
  if (!topTopic && !topPlayer) {
    return "Mets discussion is limited right now, with no strong topic dominating the public conversation.";
  }

  const topicPhrase = topTopic ? `around ${topTopic}` : "around the Mets";
  const playerPhrase = topPlayer ? ` Mentions of ${topPlayer} are among the most active.` : "";

  if (mood === "Very Positive" || mood === "Positive") {
    return `Mets discussion is leaning positive, with the strongest conversation ${topicPhrase}.${playerPhrase}`.trim();
  }
  if (mood === "Very Negative" || mood === "Negative") {
    return `Mets discussion is leaning negative, with the sharpest reactions ${topicPhrase}.${playerPhrase}`.trim();
  }
  return `Mets discussion is mixed, with the busiest conversation ${topicPhrase}.${playerPhrase}`.trim();
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

function aggregatePlayerStats(posts) {
  const map = new Map();
  posts.forEach((post) => {
    (post.detectedPlayers || []).forEach((name) => {
      const current = map.get(name) || { name, mentions: 0, sentimentTotal: 0 };
      current.mentions += 1;
      current.sentimentTotal += Number(post.sentiment) || 0;
      map.set(name, current);
    });
  });

  return Array.from(map.values())
    .map((item) => ({
      name: item.name,
      mentions: item.mentions,
      sentiment: round(item.sentimentTotal / item.mentions)
    }))
    .sort((a, b) => b.mentions - a.mentions || b.sentiment - a.sentiment || a.name.localeCompare(b.name))
    .slice(0, 8);
}

function buildEmptyPayload(message) {
  return {
    generatedAt: new Date().toISOString(),
    overallScore: 50,
    mood: "Mixed",
    summary: message || "Social pulse data is not available yet.",
    sources: {
      bluesky: {
        postCount: 0,
        averageSentiment: 0
      }
    },
    trendingTopics: [],
    trendingPlayers: [],
    posts: []
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

function normalizeBlueskyPost(view, matchedLabel) {
  const text = sanitizeText(view?.record?.text || view?.text || "");
  if (!text) return null;
  if (isLikelySpam(text, view?.author?.handle)) return null;
  if (!isMetsRelevant(text, matchedLabel)) return null;

  const detectedPlayers = detectPlayers(text);
  const matchedTopics = detectTopics(text, matchedLabel, detectedPlayers);
  const sentiment = scoreSentiment(text);
  const createdAt = view?.record?.createdAt || view?.indexedAt || new Date().toISOString();

  return {
    id: sanitizeText(view?.uri || view?.cid || `${matchedLabel}-${slugify(text).slice(0, 24)}`),
    platform: "bluesky",
    author: sanitizeText(view?.author?.handle),
    displayName: sanitizeText(view?.author?.displayName || view?.author?.handle || "Unknown"),
    text: excerpt(text, 220),
    url: postUrlFromBlueskyView(view),
    createdAt,
    sentiment,
    sentimentLabel: sentimentLabel(sentiment),
    popularityScore: Number(view?.likeCount || 0) + Number(view?.repostCount || 0),
    matchedTopics,
    detectedPlayers
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

function normalizeXPost(tweet, usersById) {
  const text = sanitizeText(tweet?.text || "");
  if (!text) return null;
  const authorProfile = usersById.get(tweet?.author_id) || {};
  const author = sanitizeText(authorProfile.username || authorProfile.handle || "");
  if (isLikelySpam(text, author)) return null;
  if (!isMetsRelevant(text, "X")) return null;

  const detectedPlayers = detectPlayers(text);
  const matchedTopics = detectTopics(text, "X", detectedPlayers);
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
    matchedTopics,
    detectedPlayers
  };
}

async function fetchXPosts() {
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
      .map((tweet) => normalizeXPost(tweet, usersById))
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
    const mergedPlayers = Array.from(new Set([...(existing.detectedPlayers || []), ...(post.detectedPlayers || [])]));
    deduped.set(key, Object.assign({}, existing, {
      matchedTopics: mergedTopics,
      detectedPlayers: mergedPlayers,
      popularityScore: Math.max(Number(existing.popularityScore || 0), Number(post.popularityScore || 0))
    }));
  });
}

async function buildSocialPulse() {
  const deduped = new Map();
  const sourceFailures = [];

  for (const term of BLUESKY_SEARCH_TERMS) {
    try {
      const posts = await fetchBlueskySearchResults(term.label, term.query);
      const normalized = posts
        .map((view) => normalizeBlueskyPost(view, term.label))
        .filter(Boolean);
      collectPosts(deduped, normalized);
    } catch (error) {
      sourceFailures.push(`${term.label}: ${error.message}`);
    }
  }

  const xPosts = await fetchXPosts();
  collectPosts(deduped, xPosts);

  const storedPosts = Array.from(deduped.values())
    .sort((a, b) => {
      const dateDiff = Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0);
      if (dateDiff !== 0) return dateDiff;
      return Number(b.popularityScore || 0) - Number(a.popularityScore || 0);
    })
    .slice(0, MAX_STORED_POSTS)
    .map((post) => ({
      platform: post.platform,
      author: post.author,
      displayName: post.displayName,
      text: post.text,
      url: post.url,
      createdAt: post.createdAt,
      sentiment: post.sentiment,
      sentimentLabel: post.sentimentLabel,
      popularityScore: Number(post.popularityScore || 0),
      matchedTopics: post.matchedTopics
    }));

  if (!storedPosts.length) {
    sourceFailures.forEach((entry) => console.warn(entry));
    if (fs.existsSync(OUTPUT_PATH)) {
      console.warn("No fresh social pulse data was collected. Keeping the existing social-pulse.json artifact.");
      return null;
    }
    return buildEmptyPayload("Social pulse data is not available yet.");
  }

  const weightedSum = storedPosts.reduce((sum, post) => {
    const sourceFactor = post.platform === "x" ? 0.45 : 1;
    return sum + (Number(post.sentiment) || 0) * recencyWeight(post.createdAt) * sourceFactor;
  }, 0);

  const totalWeight = storedPosts.reduce((sum, post) => {
    const sourceFactor = post.platform === "x" ? 0.45 : 1;
    return sum + recencyWeight(post.createdAt) * sourceFactor;
  }, 0) || 1;

  const averageSentiment = weightedSum / totalWeight;
  const overallScore = Math.max(0, Math.min(100, Math.round(50 + (averageSentiment * 50))));
  const mood = buildMood(overallScore);

  const fullPosts = Array.from(deduped.values());
  const trendingTopics = aggregateTopicStats(fullPosts);
  const trendingPlayers = aggregatePlayerStats(fullPosts);

  const sourceMap = {};
  ["bluesky", "x"].forEach((platform) => {
    const platformPosts = storedPosts.filter((post) => post.platform === platform);
    if (!platformPosts.length) return;
    const avg = platformPosts.reduce((sum, post) => sum + (Number(post.sentiment) || 0), 0) / platformPosts.length;
    sourceMap[platform] = {
      postCount: platformPosts.length,
      averageSentiment: round(avg)
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    overallScore,
    mood,
    summary: buildSummary(overallScore, mood, trendingTopics, trendingPlayers),
    sources: sourceMap,
    trendingTopics,
    trendingPlayers,
    posts: storedPosts
  };
}

async function main() {
  const data = await buildSocialPulse();
  if (!data) return;
  writeJson(OUTPUT_PATH, data);
  console.log(`Wrote social pulse snapshot with ${data.posts.length} posts to ${OUTPUT_PATH}`);
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
