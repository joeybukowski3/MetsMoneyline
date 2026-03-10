require("dotenv").config({ path: "../.env" });
const axios = require("axios");
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TEAM_ID = 121;

async function getMetsSchedule() {
  const today = new Date().toISOString().split("T")[0];
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${TEAM_ID}&startDate=${today}&endDate=${today}&hydrate=team,linescore,probablePitcher`;
  const res = await axios.get(url);
  const dates = res.data.dates;
  if (!dates || dates.length === 0) return null;
  return dates[0].games[0];
}

async function getPitcherStats(pitcherId) {
  if (!pitcherId) return null;
  try {
    const url = `https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats?stats=gameLog,season&group=pitching&season=2026`;
    const res = await axios.get(url);
    return res.data.stats || [];
  } catch { return []; }
}

async function getStandings() {
  try {
    const url = `https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=2026`;
    const res = await axios.get(url);
    return res.data.records || [];
  } catch { return []; }
}

function extractTeamRecord(standings, teamId) {
  for (const division of standings) {
    const team = division.teamRecords?.find(t => t.team.id === teamId);
    if (team) return `${team.wins}-${team.losses}`;
  }
  return "0-0";
}

function extractPitcherSummary(statsData) {
  const season = statsData.find(s => s.type?.displayName === "season");
  const gamelog = statsData.find(s => s.type?.displayName === "gameLog");
  const s = season?.splits?.[0]?.stat || {};
  const last3 = gamelog?.splits?.slice(-3) || [];
  const last3ERA = last3.length > 0
    ? (last3.reduce((a, g) => a + parseFloat(g.stat.era || 0), 0) / last3.length).toFixed(2)
    : "N/A";
  return {
    seasonERA: s.era || "N/A",
    seasonFIP: s.era || "N/A",
    seasonWHIP: s.whip || "N/A",
    seasonKBB: s.strikeoutWalkRatio || "N/A",
    last3ERA
  };
}

function parseWriteup(rawText) {
  const sections = [];
  const lines = rawText.split("\n");
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isHeading =
      /^#{1,3}\s+/.test(trimmed) ||
      /^\*\*[^*]+\*\*$/.test(trimmed) ||
      (trimmed.endsWith(":") && trimmed.length < 60 && !trimmed.includes("."));

    if (isHeading) {
      if (current) sections.push(current);
      const heading = trimmed.replace(/^#+\s*/, "").replace(/\*\*/g, "").replace(/:$/, "").trim();
      current = { heading, body: "" };
    } else if (trimmed.startsWith("PICK_SUMMARY:") || trimmed.startsWith("OFFICIAL_PICK:")) {
      if (current) sections.push(current);
      current = null;
    } else if (current) {
      current.body += (current.body ? " " : "") + trimmed;
    }
  }
  if (current && current.body) sections.push(current);

  const summaryLine = rawText.match(/PICK_SUMMARY:\s*(.+)/);
  return {
    sections: sections.length > 0 ? sections : [{ heading: "Analysis", body: rawText.replace(/OFFICIAL_PICK:.+/, "").trim() }],
    pickSummary: summaryLine ? summaryLine[1].trim() : "",
    officialPick: "Today's Pick: New York Mets Moneyline"
  };
}

async function generateAnalysis(gameData) {
  const prompt = `You are writing a daily Mets game breakdown for a baseball analysis website. Your tone is front-office analytical, serious, and mostly dry.

STRICT RULES:
- Never use betting language (no "bet", "wager", "units", "edge", "lock", "fade")
- Never mention the site name
- Always conclude the Mets will win — no hedging
- Acknowledge any negative Mets facts briefly, then immediately reframe using regression to the mean, underlying metrics, or offsetting strengths
- Use advanced stats naturally: wRC+, xwOBA, FIP, xFIP, xERA, barrel%, hard-hit%, WHIP, K%, BB%
- Output exactly one "Game Analysis" section made of 3 or 4 short named markdown sub-sections.
- Use these sub-section headings:
  ## Offensive Matchup
  ## Pitching Matchup
  ## Key Edge
  ## Final Read
- Each sub-section must be 2 or 3 sentences max.
- Keep the tone tight, direct, and confident.
- After the sub-sections, output one line beginning with: PICK_SUMMARY:
- The PICK_SUMMARY line must be exactly 2 or 3 sentences summarizing the strongest factors above.
- No hedging language in the PICK_SUMMARY line. No disclaimer language.
- End with exactly this on its own line: OFFICIAL_PICK: Today's Pick: New York Mets Moneyline

GAME DATA:
${JSON.stringify(gameData, null, 2)}

Write the 150-300 word breakdown now.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 700,
    temperature: 0.7
  });

  return response.choices[0].message.content;
}

async function buildGameObject(game, standings) {
  const isHome = game.teams.home.team.id === TEAM_ID;
  const metsTeam = isHome ? game.teams.home : game.teams.away;
  const oppTeam = isHome ? game.teams.away : game.teams.home;

  const metsPitcher = metsTeam.probablePitcher || null;
  const oppPitcher = oppTeam.probablePitcher || null;

  const metsPitcherStats = metsPitcher ? await getPitcherStats(metsPitcher.id) : [];
  const oppPitcherStats = oppPitcher ? await getPitcherStats(oppPitcher.id) : [];

  const metsRecord = extractTeamRecord(standings, TEAM_ID);
  const oppRecord = extractTeamRecord(standings, oppTeam.team.id);
  const metsPStats = extractPitcherSummary(metsPitcherStats);
  const oppPStats = extractPitcherSummary(oppPitcherStats);

  const dateStr = game.gameDate.split("T")[0];
  const oppSlug = oppTeam.team.name.toLowerCase().replace(/\s+/g, "-");

  const gameObject = {
    id: `${dateStr}-mets-vs-${oppSlug}`,
    date: dateStr,
    time: new Date(game.gameDate).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" }) + " ET",
    ballpark: `${game.venue?.name || "TBD"}${isHome ? ", Queens NY" : ""}`,
    opponent: oppTeam.team.name,
    homeAway: isHome ? "home" : "road",
    metsRecord,
    oppRecord,
    moneyline: { mets: -115, opp: -105 },
    runLine: { mets: -1.5, price: 160 },
    status: "upcoming",
    finalScore: null,
    result: null,
    pitching: {
      mets: {
        name: metsPitcher?.fullName || "TBD",
        hand: "R",
        seasonERA: metsPStats.seasonERA,
        seasonFIP: metsPStats.seasonFIP,
        seasonXERA: "N/A",
        seasonWHIP: metsPStats.seasonWHIP,
        seasonHR9: "N/A",
        last3ERA: metsPStats.last3ERA,
        last3FIP: "N/A",
        last3WHIP: "N/A",
        last3KBB: metsPStats.seasonKBB,
        last3IP: "N/A",
        note: ""
      },
      opp: {
        name: oppPitcher?.fullName || "TBD",
        hand: "R",
        seasonERA: oppPStats.seasonERA,
        seasonFIP: oppPStats.seasonFIP,
        seasonXERA: "N/A",
        seasonWHIP: oppPStats.seasonWHIP,
        seasonHR9: "N/A",
        last3ERA: oppPStats.last3ERA,
        last3FIP: "N/A",
        last3WHIP: "N/A",
        last3KBB: oppPStats.seasonKBB,
        last3IP: "N/A",
        note: ""
      },
      metsBullpen: { seasonERA: "N/A", seasonXFIP: "N/A", last14ERA: "N/A", last3DaysIP: "N/A", rating: 70 },
      oppBullpen: { seasonERA: "N/A", seasonXFIP: "N/A", last14ERA: "N/A", last3DaysIP: "N/A", rating: 65 }
    },
    lineups: { status: "projected", mets: [], opp: [] },
    advancedMatchup: [
      { category: "Offense vs SP Hand - wRC+", mets: "N/A", opp: "N/A", edge: "Neutral" },
      { category: "Hard-Hit %", mets: "N/A", opp: "N/A", edge: "Neutral" },
      { category: "Barrel %", mets: "N/A", opp: "N/A", edge: "Neutral" },
      { category: "Walk Rate (BB%)", mets: "N/A", opp: "N/A", edge: "Neutral" },
      { category: "Strikeout Rate (K%)", mets: "N/A", opp: "N/A", edge: "Neutral" }
    ],
    trends: [
      { category: "Last 10 Games", mets: metsRecord, opp: oppRecord, edge: "Neutral" },
      { category: "Home/Road", mets: isHome ? "Home" : "Road", opp: isHome ? "Road" : "Home", edge: "Neutral" },
      { category: "Series Context", mets: "Game 1", opp: "Game 1", edge: "Neutral" }
    ],
    writeup: { sections: [], pickSummary: "", officialPick: "Today's Pick: New York Mets Moneyline" },
    bettingHistory: null
  };

  console.log("Generating AI analysis...");
  const rawWriteup = await generateAnalysis(gameObject);
  gameObject.writeup = parseWriteup(rawWriteup);

  return gameObject;
}

async function run() {
  console.log("Fetching today's Mets game...");
  const game = await getMetsSchedule();

  if (!game) {
    console.log("No Mets game today. Exiting.");
    process.exit(0);
  }

  const isHome = game.teams.home.team.id === TEAM_ID;
  const oppName = isHome ? game.teams.away.team.name : game.teams.home.team.name;
  console.log(`Game found: Mets vs ${oppName}`);

  const standings = await getStandings();
  const gameObject = await buildGameObject(game, standings);

  const jsonPath = path.join(__dirname, "../public/data/sample-game.json");

  // Only keep real generated games — wipe placeholder/sample data
  let existing = { games: [] };
  if (fs.existsSync(jsonPath)) {
    const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    // Keep only games with a real id (not the placeholder Phillies sample or clones)
    existing.games = raw.games.filter(g =>
      g.id && !g.id.includes("phillies") && g.date !== "2026-04-10"
    );
  }

  const idx = existing.games.findIndex(g => g.date === gameObject.date);
  if (idx >= 0) {
    existing.games[idx] = gameObject;
    console.log("Updated existing entry for today.");
  } else {
    existing.games.push(gameObject);
    console.log("Added new entry for today.");
  }

  fs.writeFileSync(jsonPath, JSON.stringify(existing, null, 2));
  console.log("sample-game.json updated. Review before pushing.");
}

run().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
