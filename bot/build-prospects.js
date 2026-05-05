/**
 * build-prospects.js
 * Generates public/data/prospects.json with top 15 Mets prospect
 * rankings, live MiLB stats, and recent news.
 *
 * Rankings are hardcoded based on MLB Pipeline's preseason list.
 * Stats are pulled from the MLB Stats API using affiliate sportIds.
 *
 * Usage: node bot/build-prospects.js
 */

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const ORG_ID = 121;
const SEASON = new Date().getFullYear();
const OUTPUT_PATH = path.join(__dirname, "../public/data/prospects.json");
const SPORT_LEVELS = {
  11: "AAA",
  12: "AA",
  13: "High-A",
  14: "A",
};
const LEVEL_SPORT_IDS = {
  "MLB": 1,
  "AAA": 11,
  "AA": 12,
  "High-A": 13,
  "A+": 13,
  "A": 14,
  "Low-A": 14,
};

const PROSPECT_LIST = [
  { mlbId: 702043, name: "Nolan McLean", position: "RHP", type: "Pitcher", age: 23, bats: "R", throws: "R", level: "MLB", eta: "2025" },
  { mlbId: 700363, name: "Carson Benge", position: "OF", type: "Hitter", age: 23, bats: "L", throws: "R", level: "MLB", eta: "2026" },
  { mlbId: 694497, name: "Jonah Tong", position: "RHP", type: "Pitcher", age: 22, bats: "R", throws: "R", level: "AAA", eta: "2026" },
  { mlbId: 701807, name: "A.J. Ewing", position: "OF/2B", type: "Hitter", age: 23, bats: "L", throws: "R", level: "AAA", eta: "2026" },
  { mlbId: 694290, name: "Ryan Clifford", position: "1B/OF", type: "Hitter", age: 22, bats: "L", throws: "R", level: "AAA", eta: "2026" },
  { mlbId: 700792, name: "Jacob Reimer", position: "3B", type: "Hitter", age: 22, bats: "R", throws: "R", level: "AAA", eta: "2026" },
  { mlbId: 700365, name: "Jack Wenninger", position: "RHP", type: "Pitcher", age: 24, bats: "R", throws: "R", level: "AAA", eta: "2026" },
  { mlbId: 698917, name: "Jonathan Santucci", position: "LHP", type: "Pitcher", age: 24, bats: "L", throws: "L", level: "AA", eta: "2027" },
  { mlbId: 698201, name: "Elian Pena", position: "SS", type: "Hitter", age: 18, bats: "R", throws: "R", level: "A", eta: "2028" },
  { mlbId: 700120, name: "Nick Morabito", position: "OF", type: "Hitter", age: 22, bats: "R", throws: "R", level: "AA", eta: "2027" },
  { mlbId: null, name: "Chris Suero", position: "C", type: "Hitter", age: 20, bats: "R", throws: "R", level: "A", eta: "2028" },
  { mlbId: null, name: "Wandy Asigen", position: "SS", type: "Hitter", age: 17, bats: "L", throws: "R", level: "Rookie", eta: "2029" },
  { mlbId: 700998, name: "Dylan Ross", position: "RHP", type: "Pitcher", age: 22, bats: "R", throws: "R", level: "AA", eta: "2027" },
  { mlbId: 695764, name: "Mitch Voit", position: "C/1B", type: "Hitter", age: 22, bats: "R", throws: "R", level: "High-A", eta: "2027" },
  { mlbId: 700710, name: "Ryan Lambert", position: "RHP", type: "Pitcher", age: 21, bats: "R", throws: "R", level: "A", eta: "2028" },
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function fetchJson(url) {
  try {
    const { data } = await axios.get(url, { timeout: 20000 });
    return data;
  } catch (e) {
    console.warn(`[prospects] fetch failed: ${url}`, e.message);
    return null;
  }
}

async function getAffiliateTeams() {
  const data = await fetchJson(
    `https://statsapi.mlb.com/api/v1/teams?sportIds=11,12,13,14&season=${SEASON}&parentOrgIds=${ORG_ID}`
  );
  return (data?.teams || []).map(team => ({
    teamId: team.id,
    teamName: team.name,
    sportId: team.sport?.id,
    level: SPORT_LEVELS[team.sport?.id] || null,
  }));
}

async function getAffiliateRosters() {
  const affiliates = await getAffiliateTeams();
  const byId = new Map();
  const byName = new Map();

  for (const affiliate of affiliates) {
    const data = await fetchJson(
      `https://statsapi.mlb.com/api/v1/teams/${affiliate.teamId}/roster/active?season=${SEASON}`
    );
    const roster = data?.roster || [];
    for (const player of roster) {
      const entry = {
        mlbId: player.person?.id || null,
        name: player.person?.fullName || "",
        position: player.position?.abbreviation || "",
        jerseyNumber: player.jerseyNumber || "",
        teamId: affiliate.teamId,
        teamName: affiliate.teamName,
        sportId: affiliate.sportId,
        level: affiliate.level,
      };
      if (entry.mlbId) {
        byId.set(entry.mlbId, entry);
      }
      const key = normalizeName(entry.name);
      if (key && !byName.has(key)) {
        byName.set(key, entry);
      }
    }
  }

  return { byId, byName };
}

function resolveProspectContext(prospect, rosterMaps) {
  const byIdMatch = prospect.mlbId ? rosterMaps.byId.get(prospect.mlbId) : null;
  const byNameMatch = rosterMaps.byName.get(normalizeName(prospect.name)) || null;
  const match = byIdMatch || byNameMatch;
  const fallbackSportId = LEVEL_SPORT_IDS[prospect.level] || null;

  return {
    ...prospect,
    mlbId: prospect.mlbId || match?.mlbId || null,
    position: match?.position || prospect.position,
    level: match?.level || prospect.level,
    sportId: match?.sportId || fallbackSportId,
    affiliateTeamId: match?.teamId || null,
    affiliateTeamName: match?.teamName || null,
  };
}

async function fetchSeasonSplit(mlbId, group, sportId) {
  if (!mlbId) return null;
  const urls = [];
  if (sportId != null) {
    urls.push(
      `https://statsapi.mlb.com/api/v1/people/${mlbId}/stats?stats=season&season=${SEASON}&group=${group}&sportId=${sportId}`
    );
  }
  urls.push(
    `https://statsapi.mlb.com/api/v1/people/${mlbId}/stats?stats=season&season=${SEASON}&group=${group}`
  );

  for (const url of urls) {
    const data = await fetchJson(url);
    const split = data?.stats?.[0]?.splits?.[0];
    if (split?.stat) {
      return split.stat;
    }
  }
  return null;
}

async function fetchGameLogSplits(mlbId, group, sportId) {
  if (!mlbId) return null;
  const urls = [];
  if (sportId != null) {
    urls.push(
      `https://statsapi.mlb.com/api/v1/people/${mlbId}/stats?stats=gameLog&season=${SEASON}&group=${group}&sportId=${sportId}`
    );
  }
  urls.push(
    `https://statsapi.mlb.com/api/v1/people/${mlbId}/stats?stats=gameLog&season=${SEASON}&group=${group}`
  );

  for (const url of urls) {
    const data = await fetchJson(url);
    const splits = data?.stats?.[0]?.splits;
    if (Array.isArray(splits) && splits.length) {
      return splits;
    }
  }
  return null;
}

async function getPlayerStats(prospect) {
  const group = prospect.type === "Pitcher" ? "pitching" : "hitting";
  const stat = await fetchSeasonSplit(prospect.mlbId, group, prospect.sportId);
  if (!stat) {
    return null;
  }

  if (prospect.type === "Pitcher") {
    return {
      era: stat.era || null,
      ip: stat.inningsPitched || null,
      k: stat.strikeOuts ?? null,
      bb: stat.baseOnBalls ?? null,
      whip: stat.whip || null,
      kPer9: stat.strikeoutsPer9Inn || null,
    };
  }

  return {
    avg: stat.avg || null,
    ops: stat.ops || null,
    hr: stat.homeRuns ?? null,
    rbi: stat.rbi ?? null,
    sb: stat.stolenBases ?? null,
    pa: stat.plateAppearances ?? null,
    obp: stat.obp || null,
    slg: stat.slg || null,
    h: stat.hits ?? null,
    ab: stat.atBats ?? null,
    k: stat.strikeOuts ?? null,
    bb: stat.baseOnBalls ?? null,
  };
}

async function getTrendData(prospect) {
  const group = prospect.type === "Pitcher" ? "pitching" : "hitting";
  const splits = await fetchGameLogSplits(prospect.mlbId, group, prospect.sportId);
  if (!Array.isArray(splits) || splits.length < 2) {
    return null;
  }

  const labels = [];
  const values = [];

  if (prospect.type === "Pitcher") {
    let totalEarnedRuns = 0;
    let totalOuts = 0;

    for (const split of splits) {
      const ipString = split.stat?.inningsPitched || "0";
      const parts = String(ipString).split(".");
      const wholeInnings = parseInt(parts[0] || "0", 10) || 0;
      const partialOuts = parseInt(parts[1] || "0", 10) || 0;
      totalOuts += (wholeInnings * 3) + partialOuts;
      totalEarnedRuns += split.stat?.earnedRuns ?? 0;

      const innings = totalOuts / 3;
      const era = innings > 0 ? (totalEarnedRuns / innings) * 9 : null;
      labels.push(split.date ? split.date.slice(5) : "");
      values.push(era != null ? parseFloat(era.toFixed(2)) : null);
    }
  } else {
    let totalHits = 0;
    let totalAtBats = 0;

    for (const split of splits) {
      totalHits += split.stat?.hits ?? 0;
      totalAtBats += split.stat?.atBats ?? 0;
      const avg = totalAtBats > 0 ? totalHits / totalAtBats : null;
      labels.push(split.date ? split.date.slice(5) : "");
      values.push(avg != null ? parseFloat(avg.toFixed(3)) : null);
    }
  }

  return { labels, values };
}

async function getProspectNews(name) {
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
    } catch {
      // ignore RSS errors
    }
  }

  return null;
}

async function main() {
  console.log("[prospects] Starting build...");
  const rosterMaps = await getAffiliateRosters();
  const prospects = [];

  for (const rawProspect of PROSPECT_LIST) {
    const prospect = resolveProspectContext(rawProspect, rosterMaps);
    console.log(`  Fetching ${prospect.name} (${prospect.sportId || "n/a"})...`);

    const [stats, trendData, news] = await Promise.all([
      getPlayerStats(prospect),
      getTrendData(prospect),
      getProspectNews(prospect.name),
    ]);

    prospects.push({
      mlbId: prospect.mlbId,
      name: prospect.name,
      position: prospect.position,
      type: prospect.type,
      age: prospect.age,
      bats: prospect.bats,
      throws: prospect.throws,
      level: prospect.level,
      eta: prospect.eta,
      stats: stats || null,
      trendData: trendData || null,
      news: news || null,
    });

    await sleep(150);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    season: SEASON,
    source: "MLB Pipeline 2026 preseason rankings",
    prospects,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`[prospects] Wrote ${OUTPUT_PATH} (${prospects.length} prospects)`);
}

main().catch(e => {
  console.error("[prospects] Fatal error:", e);
  process.exit(1);
});
