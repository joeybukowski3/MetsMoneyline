const fs = require("fs");
const path = require("path");
const { buildStandingsPayload, buildOverviewPayload } = require("../api/_lib/mlb-data");
const { getApiSportsConfig } = require("../api/_lib/api-sports");

const OUTPUT_DIR = path.join(__dirname, "../public/api/mlb/mets");
const STANDINGS_PATH = path.join(OUTPUT_DIR, "standings.json");
const OVERVIEW_PATH = path.join(OUTPUT_DIR, "overview.json");

// 2025 Mets final standings — used when the API cannot return live data (e.g. free plan, off-season)
const METS_2025_FALLBACK = {
  division: "NL East",
  season: 2025,
  wins: 89,
  losses: 73,
  home: "46-35",
  road: "43-38"
};

async function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`Wrote ${filePath}`);
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const config = getApiSportsConfig();
  console.log(`[debug] API-Sports config: ${JSON.stringify(config)}`);

  let standings = await buildStandingsPayload();
  if (!standings || !Array.isArray(standings.teams) || standings.teams.length === 0) {
    console.warn("[warn] Standings unavailable — using 2025 fallback values");
    const pct = (METS_2025_FALLBACK.wins / (METS_2025_FALLBACK.wins + METS_2025_FALLBACK.losses)).toFixed(3).replace("0.", ".");
    standings = {
      division: METS_2025_FALLBACK.division,
      season: METS_2025_FALLBACK.season,
      teams: [{
        teamId: config.metsTeamId,
        team: "New York Mets",
        wins: METS_2025_FALLBACK.wins,
        losses: METS_2025_FALLBACK.losses,
        pct,
        gamesBack: "0",
        home: METS_2025_FALLBACK.home,
        road: METS_2025_FALLBACK.road,
        last10: "0-0",
        streak: "-"
      }],
      meta: {
        provider: "fallback-2025",
        generatedAt: new Date().toISOString(),
        cacheHint: "standings: fallback"
      }
    };
  }
  await writeJson(STANDINGS_PATH, standings);

  const overview = await buildOverviewPayload();
  if (!overview || !Array.isArray(overview.teamStats) || overview.teamStats.length === 0) {
    throw new Error("Overview payload is empty or missing teamStats");
  }
  await writeJson(OVERVIEW_PATH, overview);
}

main().catch((error) => {
  console.error("Failed to build advanced stats JSON:", error);
  process.exit(1);
});
