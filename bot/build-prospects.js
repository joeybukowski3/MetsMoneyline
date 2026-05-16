/**
 * build-prospects.js
 * Generates public/data/prospects.json with Mets top prospect rankings,
 * affiliate / MLB stats, MLB promotion flags, and placeholder-ready trend data.
 *
 * Rankings remain based on the hardcoded prospect list, but season stats are
 * fetched for every player on every affiliate roster so prospect cards can
 * resolve against live roster movement and promotions.
 *
 * Usage: node bot/build-prospects.js
 */

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const replaceHtmlBlock = require("./lib/replace-html-block");

const ORG_ID = 121;
const SEASON = new Date().getFullYear();
const OUTPUT_PATH = path.join(__dirname, "../public/data/prospects.json");
const PROSPECTS_HTML_PATH = path.join(__dirname, "../public/prospects.html");
const SPORT_LEVELS = {
  11: "AAA",
  12: "AA",
  13: "High-A",
  14: "A",
};
const LEVEL_SPORT_IDS = {
  MLB: 1,
  AAA: 11,
  AA: 12,
  "High-A": 13,
  "A+": 13,
  A: 14,
  "Low-A": 14,
  Rookie: null,
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

function escapeHtml(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildProspectsSeoSummary(prospects) {
  const topFive = prospects.slice(0, 5).map((prospect, index) => (
    `${index + 1}. ${prospect.name} (${prospect.position}, ${prospect.level || "MiLB"})`
  ));
  return `<p>The top five Mets prospects right now are ${escapeHtml(topFive.join("; "))}. The full page tracks rankings, levels, recent news, and live minor-league stats for the Mets farm system.</p>`;
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isPitcherPosition(position) {
  const pos = String(position || "").toUpperCase();
  return pos === "P" || pos === "SP" || pos === "RP" || pos.endsWith("HP");
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

async function getTeamRoster(teamId, season, meta) {
  const data = await fetchJson(
    `https://statsapi.mlb.com/api/v1/teams/${teamId}/roster/active?season=${season}`
  );
  return (data?.roster || []).map(player => ({
    mlbId: player.person?.id || null,
    name: player.person?.fullName || "",
    position: player.position?.abbreviation || "",
    jerseyNumber: player.jerseyNumber || "",
    teamId,
    teamName: meta.teamName,
    sportId: meta.sportId,
    level: meta.level,
    type: isPitcherPosition(player.position?.abbreviation) ? "Pitcher" : "Hitter",
  }));
}

function buildRosterMaps(players) {
  const byId = new Map();
  const byName = new Map();
  for (const player of players) {
    if (player.mlbId && !byId.has(player.mlbId)) byId.set(player.mlbId, player);
    const key = normalizeName(player.name);
    if (key && !byName.has(key)) byName.set(key, player);
  }
  return { byId, byName };
}

function normalizeStats(playerType, stat) {
  if (!stat) return null;

  if (playerType === "Pitcher") {
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
    obp: stat.obp || null,
    slg: stat.slg || null,
    ops: stat.ops || null,
    hr: stat.homeRuns ?? null,
    rbi: stat.rbi ?? null,
    sb: stat.stolenBases ?? null,
    pa: stat.plateAppearances ?? null,
    h: stat.hits ?? null,
    ab: stat.atBats ?? null,
    k: stat.strikeOuts ?? null,
    bb: stat.baseOnBalls ?? null,
  };
}

async function fetchBulkSeasonStats(group, sportId) {
  const url =
    `https://statsapi.mlb.com/api/v1/stats` +
    `?stats=season&season=${SEASON}&group=${group}&playerPool=ALL&sportIds=${sportId}&limit=2000`;
  const data = await fetchJson(url);
  const splits = data?.stats?.[0]?.splits;
  return Array.isArray(splits) ? splits : [];
}

async function buildBulkStatLookup(sportIds) {
  const lookup = {};
  for (const sportId of sportIds) {
    lookup[sportId] = {
      hitting: new Map(),
      pitching: new Map(),
    };

    const [hittingSplits, pitchingSplits] = await Promise.all([
      fetchBulkSeasonStats("hitting", sportId),
      fetchBulkSeasonStats("pitching", sportId),
    ]);

    for (const split of hittingSplits) {
      const playerId = Number(split?.player?.id);
      if (!playerId || !split?.stat) continue;
      lookup[sportId].hitting.set(playerId, {
        stats: normalizeStats("Hitter", split.stat),
        teamId: split?.team?.id || null,
      });
    }

    for (const split of pitchingSplits) {
      const playerId = Number(split?.player?.id);
      if (!playerId || !split?.stat) continue;
      lookup[sportId].pitching.set(playerId, {
        stats: normalizeStats("Pitcher", split.stat),
        teamId: split?.team?.id || null,
      });
    }
  }
  return lookup;
}

function resolveProspectContext(prospect, affiliateMaps, mlbMaps) {
  const nameKey = normalizeName(prospect.name);
  const mlbNameMatch = mlbMaps.byName.get(nameKey) || null;
  const affiliateNameMatch = affiliateMaps.byName.get(nameKey) || null;
  const mlbIdMatch = prospect.mlbId ? (mlbMaps.byId.get(prospect.mlbId) || null) : null;
  const affiliateIdMatch = prospect.mlbId ? (affiliateMaps.byId.get(prospect.mlbId) || null) : null;
  const idMatch = prospect.mlbId
    ? (affiliateIdMatch || mlbIdMatch || null)
    : null;
  const match = mlbNameMatch || affiliateNameMatch || idMatch;
  const mlbStatus = mlbNameMatch ? "MLB Active" : null;

  return {
    ...prospect,
    mlbId: match?.mlbId || prospect.mlbId || null,
    position: match?.position || prospect.position,
    level: mlbStatus ? "MLB" : (match?.level || prospect.level),
    sportId: mlbStatus ? 1 : (match?.sportId || LEVEL_SPORT_IDS[prospect.level] || null),
    affiliateTeamId: match?.teamId || null,
    affiliateTeamName: match?.teamName || null,
    type: match?.type || prospect.type,
    mlbStatus,
  };
}

function buildStatsLookup(allPlayers, statsCache) {
  const byId = new Map();
  const byName = new Map();
  for (const player of allPlayers) {
    const statsEntry = statsCache.get(player.mlbId);
    if (!statsEntry) continue;
    if (player.mlbId && !byId.has(player.mlbId)) byId.set(player.mlbId, statsEntry);
    const key = normalizeName(player.name);
    if (key && !byName.has(key)) byName.set(key, statsEntry);
  }
  return { byId, byName };
}

/* ── Fetch game log for trend chart + recent games table ── */
async function getGameLogTrend(mlbId, type, sportId) {
  if (!mlbId) return null;
  const group = type === "Pitcher" ? "pitching" : "hitting";
  const sids = sportId && sportId !== 1 ? [sportId, 1] : [1];

  for (const sid of sids) {
    const data = await fetchJson(
      `https://statsapi.mlb.com/api/v1/people/${mlbId}/stats?stats=gameLog&season=${SEASON}&group=${group}&sportId=${sid}`
    );
    const splits = data?.stats?.[0]?.splits;
    if (!Array.isArray(splits) || splits.length < 3) continue;

    const labels = [];
    const values = [];      // per-game individual values (not cumulative)
    const recentGames = []; // raw stats for last 5 games table

    if (type === "Pitcher") {
      for (const s of splits) {
        const ip    = parseFloat(s.stat?.inningsPitched) || 0;
        const er    = s.stat?.earnedRuns ?? 0;
        const k     = s.stat?.strikeOuts ?? 0;
        const bb    = s.stat?.baseOnBalls ?? 0;
        const h     = s.stat?.hits ?? 0;
        const gameEra = ip > 0 ? parseFloat(((er / ip) * 9).toFixed(2)) : null;
        labels.push(s.date ? s.date.slice(5) : "");
        values.push(gameEra !== null ? gameEra : 0);
        recentGames.push({
          date: s.date ? s.date.slice(5) : "",
          opp:  s.team?.name ? s.team.name.split(" ").pop() : "—",
          ip:   s.stat?.inningsPitched ?? "—",
          h, er, k, bb,
          era:  gameEra,
        });
      }
    } else {
      for (const s of splits) {
        const ab  = s.stat?.atBats ?? 0;
        const h   = s.stat?.hits ?? 0;
        const hr  = s.stat?.homeRuns ?? 0;
        const rbi = s.stat?.rbi ?? 0;
        const k   = s.stat?.strikeOuts ?? 0;
        const bb  = s.stat?.baseOnBalls ?? 0;
        const sb  = s.stat?.stolenBases ?? 0;
        const gameAvg = ab > 0 ? parseFloat((h / ab).toFixed(3)) : null;
        labels.push(s.date ? s.date.slice(5) : "");
        values.push(gameAvg !== null ? gameAvg : 0);
        recentGames.push({
          date: s.date ? s.date.slice(5) : "",
          opp:  s.team?.name ? s.team.name.split(" ").pop() : "—",
          ab, h, hr, rbi, k, bb, sb,
          avg:  gameAvg,
        });
      }
    }

    if (labels.length < 3) continue;

    // Chart: last 20 appearances; table: last 5
    const last20Start = Math.max(0, labels.length - 20);
    return {
      labels: labels.slice(last20Start),
      values: values.slice(last20Start),
      recentGames: recentGames.slice(-5),
    };
  }
  return null;
}

/* ── Fetch recent news for a prospect by name ── */
async function getProspectNews(name) {
  const RSS_PROXY = "https://api.rss2json.com/v1/api.json?rss_url=";
  const feeds = [
    "https://www.mlb.com/feeds/news/rss.xml?teamId=121",
    "https://sny.tv/rss/mets",
    "https://www.amazinavenue.com/rss/current",
  ];

  const lastName = normalizeName(name.split(" ").pop());
  const fullName = normalizeName(name);

  for (const feedUrl of feeds) {
    try {
      const { data } = await axios.get(RSS_PROXY + encodeURIComponent(feedUrl), { timeout: 8000 });
      if (data.status !== "ok" || !data.items) continue;
      const match = data.items.find(item => {
        const text = normalizeName((item.title || "") + " " + (item.description || ""));
        return text.includes(fullName) || text.includes(lastName);
      });
      if (match) {
        return {
          title: String(match.title || "").replace(/<[^>]*>/g, "").trim().slice(0, 140),
          url: match.link || "#",
          date: match.pubDate ? new Date(match.pubDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "",
        };
      }
    } catch { /* skip failed feeds */ }
  }

  const googleQuery = `https://news.google.com/rss/search?q=${encodeURIComponent('"' + name + '" Mets')}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const { data } = await axios.get(RSS_PROXY + encodeURIComponent(googleQuery), { timeout: 8000 });
    if (data.status === "ok" && Array.isArray(data.items) && data.items.length) {
      const match = data.items.find(item => {
        const text = normalizeName((item.title || "") + " " + (item.description || ""));
        return text.includes(fullName) || text.includes(lastName);
      }) || data.items[0];
      if (match) {
        return {
          title: String(match.title || "").replace(/<[^>]*>/g, "").trim().slice(0, 140),
          url: match.link || "#",
          date: match.pubDate ? new Date(match.pubDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "",
        };
      }
    }
  } catch { /* skip failed feeds */ }

  return null;
}

async function main() {
  console.log("[prospects] Starting build...");

  const affiliates = await getAffiliateTeams();
  const affiliateRosterArrays = await Promise.all(
    affiliates.map(affiliate => getTeamRoster(affiliate.teamId, SEASON, affiliate))
  );
  const affiliatePlayers = affiliateRosterArrays.flat();
  const mlbPlayers = await getTeamRoster(ORG_ID, SEASON, { teamName: "New York Mets", sportId: 1, level: "MLB" });

  const affiliateMaps = buildRosterMaps(affiliatePlayers);
  const mlbMaps = buildRosterMaps(mlbPlayers);
  const allPlayers = [...affiliatePlayers, ...mlbPlayers.filter(player => !affiliateMaps.byId.has(player.mlbId))];
  const bulkStats = await buildBulkStatLookup([1, 11, 12, 13, 14]);

  const statsCache = new Map();
  const processedByLevel = {};

  for (const player of allPlayers) {
    const level = player.level || "Unknown";
    if (!processedByLevel[level]) {
      processedByLevel[level] = { processed: 0, withStats: 0, withoutStats: 0 };
    }
    processedByLevel[level].processed += 1;
    const groupKey = player.type === "Pitcher" ? "pitching" : "hitting";
    const primarySportId = player.sportId || null;
    const primaryEntry = primarySportId != null
      ? bulkStats[primarySportId]?.[groupKey]?.get(player.mlbId) || null
      : null;
    const fallbackEntry = primarySportId !== 1
      ? bulkStats[1]?.[groupKey]?.get(player.mlbId) || null
      : null;
    const matchedEntry = primaryEntry || fallbackEntry || null;
    const normalized = matchedEntry?.stats || null;

    if (!normalized) {
      console.warn(`[prospects] no season stats found for player ${player.mlbId} (${player.name}) group=${groupKey} primarySportId=${primarySportId ?? "n/a"}`);
    }

    statsCache.set(player.mlbId, {
      stats: normalized,
      sportIdUsed: primaryEntry ? primarySportId : (fallbackEntry ? 1 : null),
      sourceLevel: player.level,
      type: player.type,
    });
    if (normalized) processedByLevel[level].withStats += 1;
    else processedByLevel[level].withoutStats += 1;
  }

  const statsLookup = buildStatsLookup(allPlayers, statsCache);
  const mlbActiveIds = new Set(mlbPlayers.map(player => player.mlbId).filter(Boolean));

  const prospects = [];
  for (const rawProspect of PROSPECT_LIST) {
    const prospect = resolveProspectContext(rawProspect, affiliateMaps, mlbMaps);
    const statsEntry = (prospect.mlbId && statsLookup.byId.get(prospect.mlbId))
      || statsLookup.byName.get(normalizeName(prospect.name))
      || null;

    // Fetch trend data and news in parallel
    const [trendData, news] = await Promise.all([
      getGameLogTrend(prospect.mlbId, prospect.type, prospect.sportId),
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
      mlbStatus: mlbActiveIds.has(prospect.mlbId) ? "MLB Active" : null,
      stats: statsEntry?.stats || null,
      trendData,
      news,
    });
  }

  const output = {
    generatedAt: new Date().toISOString(),
    season: SEASON,
    source: "MLB Pipeline 2026 preseason rankings",
    prospects,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  replaceHtmlBlock(PROSPECTS_HTML_PATH, "SEO_PROSPECTS_SUMMARY", buildProspectsSeoSummary(prospects));

  console.log("[prospects] Processed roster stats by level:");
  for (const [level, summary] of Object.entries(processedByLevel)) {
    console.log(`  ${level}: processed=${summary.processed} withStats=${summary.withStats} withoutStats=${summary.withoutStats}`);
  }
  const prospectWithStats = prospects.filter(p => p.stats != null).length;
  const prospectWithoutStats = prospects.length - prospectWithStats;
  const prospectWithTrendData = prospects.filter(p => p.trendData != null).length;
  const prospectWithNews = prospects.filter(p => p.news != null).length;
  const mlbActiveProspects = prospects.filter(p => p.mlbStatus === "MLB Active").map(p => p.name);
  console.log(`[prospects] Top-15 stats summary: withStats=${prospectWithStats} withoutStats=${prospectWithoutStats}`);
  console.log(`[prospects] Trend/news summary: trendData=${prospectWithTrendData} news=${prospectWithNews}`);
  console.log(`[prospects] MLB Active prospects: ${mlbActiveProspects.length ? mlbActiveProspects.join(", ") : "none"}`);
  console.log(`[prospects] Wrote ${OUTPUT_PATH} (${prospects.length} prospects)`);
}

main().catch(e => {
  console.error("[prospects] Fatal error:", e);
  process.exit(1);
});
