import { getTeamLogoUrl } from "./team-logo-helper.js";

const TEAM_ID = 121;
const LEAGUE_ID = 104;
const NL_EAST_DIVISION_ID = 204;
const EASTERN_TIME_ZONE = "America/New_York";

const TEAM_NAME_BY_ID = {
  109: "Arizona Diamondbacks",
  120: "Washington Nationals",
  121: "New York Mets",
  138: "St. Louis Cardinals",
  143: "Philadelphia Phillies",
  144: "Atlanta Braves",
  146: "Miami Marlins",
  158: "Milwaukee Brewers"
};

function getCurrentSeason() {
  const etDate = new Date().toLocaleDateString("en-CA", { timeZone: EASTERN_TIME_ZONE });
  return Number(etDate.slice(0, 4));
}

function headshotUrl(id) {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_56,q_auto:best/v1/people/${id || 0}/headshot/67/current`;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${url}`);
  }
  console.info(`[advanced-stats] fetched ${url} (${response.status})`);
  return response.json();
}

async function fetchJsonWithFallback(primary, fallback) {
  try {
    return await fetchJson(primary);
  } catch (primaryError) {
    console.warn(`[advanced-stats] primary source failed (${primary}): ${primaryError.message}`);
    if (!fallback) throw primaryError;
    try {
      console.info(`[advanced-stats] falling back to ${fallback}`);
      return await fetchJson(fallback);
    } catch (fallbackError) {
      throw primaryError;
    }
  }
}

function splitRecord(teamRecord, type) {
  const record = teamRecord?.records?.splitRecords?.find(entry => entry.type === type);
  if (!record) return "0-0";
  return `${record.wins}-${record.losses}`;
}

function normalizeGamesBack(value) {
  if (value == null || value === "" || value === "0" || value === "0.0" || value === "-") return "-";
  return String(value);
}

function normalizeTeamName(team) {
  return TEAM_NAME_BY_ID[team?.id] || team?.name || "Unknown Team";
}

function formatPct(value, digits = 3) {
  if (value == null || value === "" || value === ".---") return "N/A";
  const raw = String(value);
  if (/^\.\d+$/.test(raw)) return raw;
  const numeric = Number(raw);
  if (Number.isNaN(numeric)) return raw;
  return numeric.toFixed(digits).replace(/^0/, "");
}

function formatDecimal(value, digits = 2) {
  if (value == null || value === "" || value === ".---" || value === "-.--") return "N/A";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return numeric.toFixed(digits);
}

function formatRate(numerator, denominator, digits = 1) {
  const num = Number(numerator);
  const den = Number(denominator);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return "N/A";
  return `${((num / den) * 100).toFixed(digits)}%`;
}

function formatPerGame(value, games, digits = 2) {
  const num = Number(value);
  const gp = Number(games);
  if (!Number.isFinite(num) || !Number.isFinite(gp) || gp <= 0) return "N/A";
  return (num / gp).toFixed(digits);
}

function renderRows(targetId, rows) {
  const target = document.getElementById(targetId);
  if (!target) return;
  target.innerHTML = rows.join("");
}

function setText(targetId, value) {
  const element = document.getElementById(targetId);
  if (element) element.textContent = value;
}

async function loadStandings(season) {
  const data = await fetchJsonWithFallback(
    "api/mlb/mets/standings",
    "api/mlb/mets/standings.json"
  );
  const teams = Array.isArray(data?.teams) ? data.teams : [];
  const mets = teams.find(entry => String(entry.teamId) === String(TEAM_ID)) || null;
  return {
    mets: mets
      ? {
          wins: mets.wins,
          losses: mets.losses,
          runDifferential: 0,
          streak: { streakCode: mets.streak || "-" },
          records: {
            splitRecords: [
              { type: "home", wins: Number(String(mets.home || "0-0").split("-")[0]), losses: Number(String(mets.home || "0-0").split("-")[1]) },
              { type: "away", wins: Number(String(mets.road || "0-0").split("-")[0]), losses: Number(String(mets.road || "0-0").split("-")[1]) },
              { type: "lastTen", wins: Number(String(mets.last10 || "0-0").split("-")[0]), losses: Number(String(mets.last10 || "0-0").split("-")[1]) }
            ]
          }
        }
      : null,
    nlEast: teams.map(team => ({
      id: team.teamId,
      team: team.team,
      wins: team.wins,
      losses: team.losses,
      pct: team.pct,
      gamesBack: team.gamesBack,
      home: team.home,
      road: team.road,
      last10: team.last10,
      streak: team.streak
    })),
    nlFull: [{
      divisionName: data?.division || "NL East",
      teams: teams.map(team => ({
        id: team.teamId,
        team: team.team,
        wins: team.wins,
        losses: team.losses,
        pct: team.pct,
        gamesBack: team.gamesBack
      }))
    }]
  };
}

async function loadOverview() {
  return fetchJsonWithFallback(
    "api/mlb/mets/overview",
    "api/mlb/mets/overview.json"
  );
}

function loadTeamStats(overview) {
  const stats = overview?.teamStats || [];
  return {
    hitting: stats.find(entry => entry.group?.displayName === "hitting")?.splits?.[0]?.stat || {},
    pitching: stats.find(entry => entry.group?.displayName === "pitching")?.splits?.[0]?.stat || {},
    fielding: stats.find(entry => entry.group?.displayName === "fielding")?.splits?.[0]?.stat || {}
  };
}

function loadRosterStats(overview, group) {
  const source = group === "hitting" ? overview?.hitters : overview?.pitchers;
  return (source || []).map(entry => {
    const person = entry.person || {};
    const stat = person.stats?.[0]?.splits?.[0]?.stat || null;
    return {
      id: person.id,
      name: person.fullName,
      position: entry.position?.abbreviation || person.primaryPosition?.abbreviation || "",
      stats: stat
    };
  });
}

function renderAtAGlance(metsStanding) {
  if (!metsStanding) return;

  const glanceItems = [
    { label: "Record", value: `${metsStanding.wins}-${metsStanding.losses}`, highlight: true },
    { label: "Run Diff", value: metsStanding.runDifferential > 0 ? `+${metsStanding.runDifferential}` : String(metsStanding.runDifferential || 0) },
    { label: "Home", value: splitRecord(metsStanding, "home") },
    { label: "Road", value: splitRecord(metsStanding, "away") },
    { label: "Last 10", value: splitRecord(metsStanding, "lastTen") },
    { label: "Streak", value: metsStanding.streak?.streakCode || "-" }
  ];

  const target = document.getElementById("at-a-glance");
  if (!target) return;

  target.innerHTML = glanceItems.map(item => `
    <div class="glance-item">
      <div class="glance-label">${item.label}</div>
      <div class="glance-value${item.highlight ? " highlight" : ""}">${item.value}</div>
    </div>
  `).join("");
}

function renderTeamStats(teamStats, season) {
  const { hitting, pitching, fielding } = teamStats;

  renderRows("offense-body", [
    ["AVG", formatPct(hitting.avg)],
    ["OBP", formatPct(hitting.obp)],
    ["SLG", formatPct(hitting.slg)],
    ["OPS", formatPct(hitting.ops)],
    ["Runs / G", formatPerGame(hitting.runs, hitting.gamesPlayed)],
    ["HR", hitting.homeRuns ?? "0"],
    ["SB", hitting.stolenBases ?? "0"],
    ["BB%", formatRate(hitting.baseOnBalls, hitting.plateAppearances)],
    ["K%", formatRate(hitting.strikeOuts, hitting.plateAppearances)]
  ].map(([label, value]) => `<tr><td>${label}</td><td><strong>${value}</strong></td><td>${season}</td></tr>`));

  renderRows("pitching-body", [
    ["ERA", formatDecimal(pitching.era)],
    ["WHIP", formatDecimal(pitching.whip)],
    ["K / 9", formatDecimal(pitching.strikeoutsPer9Inn)],
    ["BB / 9", formatDecimal(pitching.walksPer9Inn)],
    ["H / 9", formatDecimal(pitching.hitsPer9Inn)],
    ["HR / 9", formatDecimal(pitching.homeRunsPer9)],
    ["Saves", pitching.saves ?? "0"],
    ["Holds", pitching.holds ?? "0"],
    ["IP", pitching.inningsPitched || "0.0"]
  ].map(([label, value]) => `<tr><td>${label}</td><td><strong>${value}</strong></td><td>${season}</td></tr>`));

  renderRows("defense-body", [
    ["Fielding %", formatPct(fielding.fielding)],
    ["Errors", fielding.errors ?? "0"],
    ["Double Plays", fielding.doublePlays ?? "0"],
    ["Assists", fielding.assists ?? "0"],
    ["Putouts", fielding.putOuts ?? "0"],
    ["SB Allowed", fielding.stolenBases ?? "0"],
    ["CS", fielding.caughtStealing ?? "0"]
  ].map(([label, value]) => `<tr><td>${label}</td><td><strong>${value}</strong></td><td>${season}</td></tr>`));
}

function renderHitters(players, season) {
  const hitters = players
    .filter(player => player.position !== "P")
    .sort((a, b) => (Number(b.stats?.plateAppearances || 0) - Number(a.stats?.plateAppearances || 0)) || a.name.localeCompare(b.name));

  renderRows("hitters-body", hitters.map(player => {
    const stats = player.stats || {};
    return `
      <tr>
        <td><div class="player-name-td"><img src="${headshotUrl(player.id)}" class="player-row-headshot" alt="${player.name}" onerror="this.style.display='none'"><strong>${player.name}</strong></div></td>
        <td>${player.position || "-"}</td>
        <td>${formatPct(stats.avg)}</td>
        <td>${formatPct(stats.obp)}</td>
        <td>${formatPct(stats.ops)}</td>
        <td>${stats.homeRuns ?? 0}</td>
        <td>${stats.rbi ?? 0}</td>
        <td>${formatRate(stats.baseOnBalls, stats.plateAppearances)}</td>
        <td>${formatRate(stats.strikeOuts, stats.plateAppearances)}</td>
      </tr>
    `;
  }));

  setText("hitters-card-title", `Hitters - ${season} Active Roster`);
}

function renderPitchers(players, season) {
  const pitchers = players
    .filter(player => player.position === "P")
    .sort((a, b) => (Number(b.stats?.gamesStarted || 0) - Number(a.stats?.gamesStarted || 0)) ||
      (Number(b.stats?.inningsPitched || 0) - Number(a.stats?.inningsPitched || 0)) ||
      a.name.localeCompare(b.name));

  const starters = pitchers.filter(player => Number(player.stats?.gamesStarted || 0) > 0);
  const relievers = pitchers.filter(player => Number(player.stats?.gamesStarted || 0) === 0);

  renderRows("rotation-body", starters.length ? starters.map(player => {
    const stats = player.stats || {};
    return `
      <tr>
        <td><div class="player-name-td"><img src="${headshotUrl(player.id)}" class="player-row-headshot" alt="${player.name}" onerror="this.style.display='none'"><strong>${player.name}</strong></div></td>
        <td>${stats.gamesStarted ?? 0}</td>
        <td>${stats.inningsPitched || "0.0"}</td>
        <td>${formatDecimal(stats.era)}</td>
        <td>${formatDecimal(stats.whip)}</td>
        <td>${formatDecimal(stats.strikeoutWalkRatio)}</td>
        <td>${formatDecimal(stats.strikeoutsPer9Inn)}</td>
        <td>${formatDecimal(stats.walksPer9Inn)}</td>
      </tr>
    `;
  }) : [`<tr><td colspan="8" style="color:#9099b0;padding:1rem;text-align:center">No starter stats available yet.</td></tr>`]);

  renderRows("bullpen-body", relievers.length ? relievers.map(player => {
    const stats = player.stats || {};
    return `
      <tr>
        <td><div class="player-name-td"><img src="${headshotUrl(player.id)}" class="player-row-headshot" alt="${player.name}" onerror="this.style.display='none'"><strong>${player.name}</strong></div></td>
        <td>${stats.gamesPitched ?? 0}</td>
        <td>${stats.inningsPitched || "0.0"}</td>
        <td>${formatDecimal(stats.era)}</td>
        <td>${formatDecimal(stats.whip)}</td>
        <td>${stats.holds ?? 0}</td>
        <td>${stats.saves ?? 0}</td>
        <td>${formatDecimal(stats.strikeoutsPer9Inn)}</td>
      </tr>
    `;
  }) : [`<tr><td colspan="8" style="color:#9099b0;padding:1rem;text-align:center">No bullpen stats available yet.</td></tr>`]);

  setText("rotation-card-title", `Starting Rotation - ${season} Live Stats`);
  setText("bullpen-card-title", `Bullpen - ${season} Live Stats`);
}

function renderStandings(standings) {
  renderRows("nle-body", standings.nlEast.map(team => {
    const isMets = team.id === TEAM_ID;
    const logo = getTeamLogoUrl(team.id);
    return `
      <tr class="${isMets ? "mets-row" : ""}">
        <td><div class="standings-team-cell">${logo ? `<img src="${logo}" class="standings-logo" alt="${team.team}">` : ""}<span${isMets ? ' style="font-weight:700;color:var(--navy)"' : ""}>${team.team}</span></div></td>
        <td>${team.wins}</td>
        <td>${team.losses}</td>
        <td>${formatPct(team.pct)}</td>
        <td>${team.gamesBack}</td>
        <td>${team.home}</td>
        <td>${team.road}</td>
        <td>${team.last10}</td>
        <td>${team.streak}</td>
      </tr>
    `;
  }));

  renderRows("nl-full-body", standings.nlFull.flatMap(division => {
    const divider = `<tr class="divider-row"><td colspan="5">${division.divisionName}</td></tr>`;
    const teamRows = division.teams.map(team => `
      <tr>
        <td>${team.team}</td>
        <td>${team.wins}</td>
        <td>${team.losses}</td>
        <td>${formatPct(team.pct)}</td>
        <td>${team.gamesBack}</td>
      </tr>
    `);
    return [divider, ...teamRows];
  }));
}

async function loadGeneratedTimestamp() {
  try {
    const data = await fetchJson("data/sample-game.json");
    return data.generatedAt || null;
  } catch {
    return null;
  }
}

function renderTimestamp(value) {
  const element = document.getElementById("data-timestamp");
  if (!element || !value) return;
  element.textContent = "Last updated: " + new Date(value).toLocaleString("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short"
  });
}

function showErrorState(error) {
  console.error("Failed to render live stats page", error);
  const message = "Live MLB data could not be loaded right now.";
  renderRows("offense-body", [`<tr><td colspan="3" style="color:#9099b0;padding:1rem;text-align:center">${message}</td></tr>`]);
  renderRows("pitching-body", [`<tr><td colspan="3" style="color:#9099b0;padding:1rem;text-align:center">${message}</td></tr>`]);
  renderRows("defense-body", [`<tr><td colspan="3" style="color:#9099b0;padding:1rem;text-align:center">${message}</td></tr>`]);
  renderRows("hitters-body", [`<tr><td colspan="9" style="color:#9099b0;padding:1rem;text-align:center">${message}</td></tr>`]);
  renderRows("rotation-body", [`<tr><td colspan="8" style="color:#9099b0;padding:1rem;text-align:center">${message}</td></tr>`]);
  renderRows("bullpen-body", [`<tr><td colspan="8" style="color:#9099b0;padding:1rem;text-align:center">${message}</td></tr>`]);
  renderRows("nle-body", [`<tr><td colspan="9" style="color:#9099b0;padding:1rem;text-align:center">${message}</td></tr>`]);
  renderRows("nl-full-body", [`<tr><td colspan="5" style="color:#9099b0;padding:1rem;text-align:center">${message}</td></tr>`]);
}

window.toggleFullStandings = function toggleFullStandings() {
  const el = document.getElementById("full-nl-standings");
  const btn = document.querySelector(".full-standings-toggle");
  if (!el || !btn) return;
  el.classList.toggle("open");
  btn.textContent = el.classList.contains("open")
    ? "Full NL Standings \u25B2"
    : "Full NL Standings \u25BC";
};

async function init() {
  const season = getCurrentSeason();
  setText("stats-subtitle", `${season} Mets - live team stats, active roster production, pitching staff, and NL standings.`);
  setText("page-banner", "Live MLB data synced daily from the MetsMoneyline sources.");

  try {
    const [standings, overview, generatedAt] = await Promise.all([
      loadStandings(season),
      loadOverview(),
      loadGeneratedTimestamp()
    ]);
    const teamStats = loadTeamStats(overview);
    const hitters = loadRosterStats(overview, "hitting");
    const pitchers = loadRosterStats(overview, "pitching");

    renderAtAGlance(standings.mets);
    renderTeamStats(teamStats, season);
    renderHitters(hitters, season);
    renderPitchers(pitchers, season);
    renderStandings(standings);
    renderTimestamp(generatedAt || new Date().toISOString());
  } catch (error) {
    showErrorState(error);
  }
}

init();
