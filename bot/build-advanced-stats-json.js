const fs = require("fs");
const path = require("path");
const { buildStandingsPayload, buildOverviewPayload } = require("../api/_lib/mlb-data");
const { getApiSportsConfig } = require("../api/_lib/api-sports");

const OUTPUT_DIR = path.join(__dirname, "../public/api/mlb/mets");
const STANDINGS_PATH = path.join(OUTPUT_DIR, "standings.json");
const OVERVIEW_PATH = path.join(OUTPUT_DIR, "overview.json");

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
    console.warn("[warn] Standings unavailable for the current season; writing an empty current-season payload");
    standings = {
      division: "NL East",
      season: new Date().getFullYear(),
      teams: [],
      meta: {
        provider: "standings-unavailable",
        generatedAt: new Date().toISOString(),
        cacheHint: "standings: current-season only",
        unavailableReason: "Current-season standings were unavailable. No previous-season fallback was written."
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
