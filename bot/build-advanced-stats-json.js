const fs = require("fs");
const path = require("path");
const { buildStandingsPayload, buildOverviewPayload } = require("../api/_lib/mlb-data");

const OUTPUT_DIR = path.join(__dirname, "../public/api/mlb/mets");
const STANDINGS_PATH = path.join(OUTPUT_DIR, "standings.json");
const OVERVIEW_PATH = path.join(OUTPUT_DIR, "overview.json");

async function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`Wrote ${filePath}`);
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const standings = await buildStandingsPayload();
  await writeJson(STANDINGS_PATH, standings);

  const overview = await buildOverviewPayload();
  await writeJson(OVERVIEW_PATH, overview);
}

main().catch((error) => {
  console.error("Failed to build advanced stats JSON:", error);
  process.exit(1);
});
