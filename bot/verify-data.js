const fs = require("fs");
const path = require("path");
const axios = require("axios");

const TEAM_ID = 121;
const TEAM_NAME = "New York Mets";
const SAMPLE_JSON_PATH = path.join(__dirname, "../public/data/sample-game.json");

function loadSample() {
  return JSON.parse(fs.readFileSync(SAMPLE_JSON_PATH, "utf8"));
}

function normalizeDateForEspn(date) {
  return String(date || "").replace(/-/g, "");
}

function formatLeagueRecord(record) {
  if (!record) return null;
  const wins = record.wins ?? record.w;
  const losses = record.losses ?? record.l;
  if (wins == null || losses == null) return null;
  return `${wins}-${losses}`;
}

function getEspnRecord(team, type = "total") {
  const row = (team?.records || []).find((record) => record.type === type);
  return row?.summary || null;
}

function compareField(label, actual, expected, mismatches) {
  if (actual == null || expected == null) return;
  if (String(actual).trim() !== String(expected).trim()) {
    mismatches.push(`${label}: site=${actual} source=${expected}`);
  }
}

async function fetchMlbSchedule(date) {
  const url = `https://statsapi.mlb.com/api/v1/schedule/games/?sportId=1&teamId=${TEAM_ID}&startDate=${date}&endDate=${date}&hydrate=team,venue,probablePitcher`;
  const response = await axios.get(url, { timeout: 15000 });
  return response.data?.dates?.[0]?.games?.[0] || null;
}

async function fetchMlbStandings(season) {
  const url = `https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason`;
  const response = await axios.get(url, { timeout: 15000 });
  const teamRecords = (response.data?.records || []).flatMap((division) => division?.teamRecords || []);
  const byId = new Map();
  for (const teamRecord of teamRecords) {
    if (teamRecord?.team?.id) byId.set(teamRecord.team.id, teamRecord);
  }
  return byId;
}

async function fetchEspnGame(date) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${normalizeDateForEspn(date)}`;
  const response = await axios.get(url, { timeout: 15000 });
  const event = (response.data?.events || []).find((entry) =>
    (entry.competitions || []).some((competition) =>
      (competition.competitors || []).some((competitor) => Number(competitor?.team?.id) === 21)
    )
  );
  return event || null;
}

async function main() {
  const sample = loadSample();
  const game = sample?.games?.[0];
  if (!game) throw new Error("No game found in sample-game.json");

  const date = game.date;
  const season = Number(String(date).slice(0, 4));
  const mismatches = [];

  const [mlbGame, standingsMap, espnEvent] = await Promise.all([
    fetchMlbSchedule(date),
    fetchMlbStandings(season),
    fetchEspnGame(date)
  ]);

  if (!mlbGame) throw new Error(`No MLB game found for ${date}`);

  const isMetsAway = Number(mlbGame?.teams?.away?.team?.id) === TEAM_ID;
  const mlbOpponent = isMetsAway ? mlbGame?.teams?.home?.team : mlbGame?.teams?.away?.team;
  const mlbMetsRecord = formatLeagueRecord(isMetsAway ? mlbGame?.teams?.away?.leagueRecord : mlbGame?.teams?.home?.leagueRecord)
    || formatLeagueRecord(standingsMap.get(TEAM_ID));
  const mlbOppRecord = formatLeagueRecord(isMetsAway ? mlbGame?.teams?.home?.leagueRecord : mlbGame?.teams?.away?.leagueRecord)
    || formatLeagueRecord(standingsMap.get(mlbOpponent?.id));

  compareField("opponent", game.opponent, mlbOpponent?.name, mismatches);
  compareField("ballpark", game.ballpark, mlbGame?.venue?.name, mismatches);
  compareField("metsRecord (MLB)", game.metsRecord, mlbMetsRecord, mismatches);
  compareField("oppRecord (MLB)", game.oppRecord, mlbOppRecord, mismatches);

  if (espnEvent) {
    const competition = espnEvent.competitions?.[0];
    const competitors = competition?.competitors || [];
    const espnMets = competitors.find((competitor) => Number(competitor?.team?.id) === 21);
    const espnOpp = competitors.find((competitor) => Number(competitor?.team?.id) !== 21);

    compareField("opponent (ESPN)", game.opponent, espnOpp?.team?.displayName, mismatches);
    compareField("metsRecord (ESPN)", game.metsRecord, getEspnRecord(espnMets, "total"), mismatches);
    compareField("oppRecord (ESPN)", game.oppRecord, getEspnRecord(espnOpp, "total"), mismatches);
  }

  if (mismatches.length) {
    console.error("Verification failed. Mismatches found:");
    mismatches.forEach((item) => console.error(`- ${item}`));
    process.exit(1);
  }

  console.log(`Verification passed for ${TEAM_NAME} on ${date}.`);
}

main().catch((error) => {
  console.error("Verification failed:", error.message);
  process.exit(1);
});
