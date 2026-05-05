/**
 * build-prospects.js
 * Generates public/data/prospects.json with top 15 Mets prospect
 * rankings, live MiLB stats, and recent news.
 *
 * Rankings are hardcoded based on MLB Pipeline's preseason list.
 * Stats are pulled live from the MLB Stats API.
 *
 * Usage: node bot/build-prospects.js
 */

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const SEASON = new Date().getFullYear();
const SOURCE_OUTPUT_PATH = path.join(__dirname, "../data/prospects.json");
const PUBLIC_OUTPUT_PATH = path.join(__dirname, "../public/data/prospects.json");

function writeOutputFile(payload) {
  const text = JSON.stringify(payload, null, 2);
  [SOURCE_OUTPUT_PATH, PUBLIC_OUTPUT_PATH].forEach((targetPath) => {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, text);
  });
}

/* ── Top 15 Mets prospects (MLB Pipeline 2026 preseason) ── */
const PROSPECT_LIST = [
  { mlbId: 702043, name: "Nolan McLean", position: "RHP", type: "Pitcher", age: 23, bats: "R", throws: "R", level: "MLB", eta: "2025" },
  { mlbId: 700363, name: "Carson Benge", position: "OF", type: "Hitter", age: 23, bats: "L", throws: "R", level: "MLB", eta: "2026" },
  { mlbId: 694497, name: "Jonah Tong", position: "RHP", type: "Pitcher", age: 22, bats: "R", throws: "R", level: "AAA", eta: "2026" },
  { mlbId: 701807, name: "A.J. Ewing", position: "OF/2B", type: "Hitter", age: 23, bats: "L", throws: "R", level: "AAA", eta: "2026" },
  { mlbId: 694290, name: "Ryan Clifford", position: "1B/OF", type: "Hitter", age: 22, bats: "L", throws: "R", level: "AAA", eta: "2026" },
  { mlbId: 700792, name: "Jacob Reimer", position: "3B", type: "Hitter", age: 22, bats: "R", throws: "R", level: "AAA", eta: "2026" },
  { mlbId: 700365, name: "Jack Wenninger", position: "RHP", type: "Pitcher", age: 24, bats: "R", throws: "R", level: "AAA", eta: "2026" },
  { mlbId: 698917, name: "Jonathan Santucci", position: "LHP", type: "Pitcher", age: 24, bats: "L", throws: "L", level: "AA", eta: "2027" },
  { mlbId: 698201, name: "Elian Peña", position: "SS", type: "Hitter", age: 18, bats: "R", throws: "R", level: "A", eta: "2028" },
  { mlbId: 700120, name: "Nick Morabito", position: "OF", type: "Hitter", age: 22, bats: "R", throws: "R", level: "AA", eta: "2027" },
  { mlbId: null, name: "Chris Suero", position: "C", type: "Hitter", age: 20, bats: "R", throws: "R", level: "A", eta: "2028" },
  { mlbId: null, name: "Wandy Asigen", position: "SS", type: "Hitter", age: 17, bats: "L", throws: "R", level: "Rookie", eta: "2029" },
  { mlbId: 700998, name: "Dylan Ross", position: "RHP", type: "Pitcher", age: 22, bats: "R", throws: "R", level: "AA", eta: "2027" },
  { mlbId: 695764, name: "Mitch Voit", position: "C/1B", type: "Hitter", age: 22, bats: "R", throws: "R", level: "High-A", eta: "2027" },
  { mlbId: 700710, name: "Ryan Lambert", position: "RHP", type: "Pitcher", age: 21, bats: "R", throws: "R", level: "A", eta: "2028" },
];

async function fetchJson(url) {
  try {
    const { data } = await axios.get(url, { timeout: 15000 });
    return data;
  } catch (e) {
    console.warn(`[prospects] fetch failed: ${url}`, e.message);
    return null;
  }
}

/* ── Fetch season stats for a player from MLB Stats API ── */
async function getPlayerStats(mlbId, type) {
  if (!mlbId) return null;
  const group = type === "Pitcher" ? "pitching" : "hitting";
  const data = await fetchJson(
    `https://statsapi.mlb.com/api/v1/people/${mlbId}/stats?stats=season&season=${SEASON}&group=${group}`
  );
  const stat = data?.stats?.[0]?.splits?.[0]?.stat;
  if (!stat) return null;

  if (type === "Pitcher") {
    return {
      era: stat.era || "—",
      ip: stat.inningsPitched || "0",
      k: stat.strikeOuts ?? 0,
      bb: stat.baseOnBalls ?? 0,
      whip: stat.whip || "—",
      w: stat.wins ?? 0,
      l: stat.losses ?? 0,
      kPer9: stat.strikeoutsPer9Inn || "—",
      games: stat.gamesPlayed ?? 0,
    };
  }
  return {
    avg: stat.avg || "—",
    ops: stat.ops || "—",
    hr: stat.homeRuns ?? 0,
    rbi: stat.rbi ?? 0,
    sb: stat.stolenBases ?? 0,
    pa: stat.plateAppearances ?? 0,
    h: stat.hits ?? 0,
    games: stat.gamesPlayed ?? 0,
  };
}

/* ── Fetch game log for sparkline trend data ── */
async function getGameLogTrend(mlbId, type) {
  if (!mlbId) return null;
  const group = type === "Pitcher" ? "pitching" : "hitting";
  const data = await fetchJson(
    `https://statsapi.mlb.com/api/v1/people/${mlbId}/stats?stats=gameLog&season=${SEASON}&group=${group}`
  );
  const splits = data?.stats?.[0]?.splits;
  if (!Array.isArray(splits) || splits.length < 3) return null;

  // For hitters: rolling OPS; for pitchers: rolling ERA
  const labels = [];
  const values = [];

  if (type === "Pitcher") {
    let totalER = 0, totalIP = 0;
    splits.forEach(s => {
      const ip = parseFloat(s.stat?.inningsPitched) || 0;
      const er = s.stat?.earnedRuns ?? 0;
      totalER += er;
      totalIP += ip;
      const era = totalIP > 0 ? (totalER / totalIP) * 9 : 0;
      labels.push(s.date ? s.date.slice(5) : "");
      values.push(parseFloat(era.toFixed(2)));
    });
  } else {
    let totalH = 0, totalAB = 0;
    splits.forEach(s => {
      totalH += s.stat?.hits ?? 0;
      totalAB += s.stat?.atBats ?? 0;
      const avg = totalAB > 0 ? totalH / totalAB : 0;
      labels.push(s.date ? s.date.slice(5) : "");
      values.push(parseFloat(avg.toFixed(3)));
    });
  }

  return { labels, values };
}

/* ── Fetch recent news for a prospect name ── */
async function getProspectNews(name) {
  // Uses the RSS proxy that the site already uses for the news page
  const RSS_PROXY = "https://api.rss2json.com/v1/api.json?rss_url=";
  const feeds = [
    "https://www.mlb.com/feeds/news/rss.xml?teamId=121",
    "https://sny.tv/rss/mets",
  ];

  const lastName = name.split(" ").pop();

  for (const feedUrl of feeds) {
    try {
      const { data } = await axios.get(RSS_PROXY + encodeURIComponent(feedUrl), { timeout: 8000 });
      if (data.status !== "ok") continue;
      const match = (data.items || []).find(item => {
        const text = `${item.title || ""} ${item.description || ""}`;
        return text.includes(lastName) || text.includes(name);
      });
      if (match) {
        return {
          title: (match.title || "").replace(/<[^>]*>/g, "").trim().slice(0, 120),
          url: match.link || "#",
          date: match.pubDate ? new Date(match.pubDate).toLocaleDateString() : "",
        };
      }
    } catch { /* skip */ }
  }
  return null;
}

/* ── Main ── */
async function main() {
  console.log("[prospects] Starting build...");
  const prospects = [];

  for (const prospect of PROSPECT_LIST) {
    console.log(`  Fetching ${prospect.name}...`);
    const [stats, trendData, news] = await Promise.all([
      getPlayerStats(prospect.mlbId, prospect.type),
      getGameLogTrend(prospect.mlbId, prospect.type),
      getProspectNews(prospect.name),
    ]);

    prospects.push({
      ...prospect,
      stats: stats || null,
      trendData: trendData || null,
      news: news || null,
    });
  }

  const output = {
    generatedAt: new Date().toISOString(),
    season: SEASON,
    source: "MLB Pipeline 2026 preseason rankings",
    prospects,
  };

  writeOutputFile(output);
  console.log(`[prospects] Wrote ${SOURCE_OUTPUT_PATH} and ${PUBLIC_OUTPUT_PATH} (${prospects.length} prospects)`);
}

main().catch(e => {
  console.error("[prospects] Fatal error:", e);
  process.exit(1);
});
