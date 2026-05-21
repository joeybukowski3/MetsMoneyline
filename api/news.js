/**
 * /api/news — server-side RSS news proxy
 * Fetches Mets RSS feeds, parses XML natively, filters for Mets articles,
 * and returns newest-first Mets items, with a configurable limit.
 * No third-party proxy or npm packages needed — pure Node built-ins.
 */

"use strict";

const FEEDS = [
  { name: "MLB.com",       url: "https://www.mlb.com/feeds/news/rss.xml?teamId=121" },
  { name: "Amazin' Ave",   url: "https://www.amazinavenue.com/rss/current" },
  { name: "NY Post Mets",  url: "https://nypost.com/tag/new-york-mets/feed/" },
  { name: "ESPN MLB",      url: "https://www.espn.com/espn/rss/mlb/news" },
  { name: "SNY",           url: "https://sny.tv/rss/mets" },
];

const METS_TERMS = ["mets", "new york mets", "nym", "citi field"];
const CACHE_SECONDS = 300; // 5-minute CDN cache
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 24;

// ── XML helpers ──────────────────────────────────────────────────────────────

function extractTag(xml, tag) {
  // Handles <tag>…</tag> and <tag><![CDATA[…]]></tag>
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : "";
}

function extractAttr(xml, attr) {
  const re = new RegExp(`${attr}=["']([^"']+)["']`, "i");
  const m = xml.match(re);
  return m ? m[1] : "";
}

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#?\w+;/g, " ")
            .replace(/\s+/g, " ").trim();
}

function getThumbnail(itemXml) {
  // media:thumbnail, media:content, enclosure
  let m = itemXml.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i)
       || itemXml.match(/<media:content[^>]+url=["']([^"']+)["']/i)
       || itemXml.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]+type=["']image/i)
       || itemXml.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : "";
}

function parseItems(feedXml, feedName) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRe.exec(feedXml)) !== null) {
    const xml  = match[1];
    const title = stripHtml(extractTag(xml, "title"));
    const link  = extractTag(xml, "link") || extractAttr(xml, "href");
    const pubDate = extractTag(xml, "pubDate") || extractTag(xml, "dc:date") || extractTag(xml, "published");
    const description = stripHtml(extractTag(xml, "description") || extractTag(xml, "content:encoded") || "");
    const thumbnail = getThumbnail(xml);
    if (title) {
      items.push({ source: feedName, title, link, pubDate, description, thumbnail });
    }
  }
  return items;
}

// ── Fetch one feed ────────────────────────────────────────────────────────────

async function fetchFeed(feed) {
  try {
    const res = await fetch(feed.url, {
      headers: { "User-Agent": "MetsMoneyline/1.0 (news aggregator; contact@metsmoneyline.com)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseItems(xml, feed.name);
  } catch {
    return [];
  }
}

// ── Filter for Mets relevance ─────────────────────────────────────────────────

function isMetsRelated(article) {
  const text = `${article.title} ${article.description}`.toLowerCase();
  return METS_TERMS.some(t => text.includes(t));
}

function dedupeArticles(articles) {
  const seen = new Set();

  return articles.filter((article) => {
    const key = (article.link || article.title || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getRequestedLimit(req) {
  const rawLimit = req && req.query && req.query.limit;
  const parsed = Number.parseInt(Array.isArray(rawLimit) ? rawLimit[0] : rawLimit, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.min(parsed, MAX_LIMIT);
}

// ── Handler ──────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const limit = getRequestedLimit(req);
    const results = await Promise.all(FEEDS.map(fetchFeed));
    const articles = dedupeArticles(results
      .flat()
      .filter(isMetsRelated)
      .filter((article) => article.title && article.link)
      .map((article) => ({
        ...article,
        source: article.source || "Mets News"
      }))
      .sort((a, b) => {
        const ta = new Date(a.pubDate).getTime() || 0;
        const tb = new Date(b.pubDate).getTime() || 0;
        return tb - ta;
      }));
    const limitedArticles = articles
      .slice(0, limit);

    res.setHeader("Cache-Control", `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=60`);
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json({ articles: limitedArticles });
  } catch (err) {
    console.error("[news] Error:", err.message);
    return res.status(500).json({ error: "Failed to load news" });
  }
};
