import { getTeamLogoUrl } from "./team-logo-helper.js";

const TEAM_ID = 121;
const EASTERN_TIME_ZONE = "America/New_York";

function getCurrentSeason() {
  const etDate = new Date().toLocaleDateString("en-CA", { timeZone: EASTERN_TIME_ZONE });
  return Number(etDate.slice(0, 4));
}

function headshotUrl(id) {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_56,q_auto:best/v1/people/${id || 0}/headshot/67/current`;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed: ${response.status} ${url}`);
  console.info(`[advanced-stats] fetched ${url} (${response.status})`);
  return response.json();
}

async function fetchJsonWithFallback(primary, fallback) {
  try {
    return await fetchJson(primary);
  } catch (primaryError) {
    console.warn(`[advanced-stats] primary failed (${primary}): ${primaryError.message}`);
    if (!fallback) throw primaryError;
    try {
      console.info(`[advanced-stats] falling back to ${fallback}`);
      return await fetchJson(fallback);
    } catch {
      throw primaryError;
    }
  }
}

// ── ESPN standings ───────────────────────────────────────────────────────────

function buildMetsStanding(t) {
  function rec(str) {
    const parts = String(str || "0-0").split("-");
    return { wins: Number(parts[0]) || 0, losses: Number(parts[1]) || 0 };
  }
  return {
    wins: t.wins,
    losses: t.losses,
    runDifferential: 0,
    streak: { streakCode: t.streak || "-" },
    records: {
      splitRecords: [
        { type: "home",    ...rec(t.home)   },
        { type: "away",    ...rec(t.road)   },
        { type: "lastTen", ...rec(t.last10) }
      ]
    }
  };
}

function parseEspnStandings(data) {
  const nlLeague = (data?.children || []).find(c => /national\s+league/i.test(c.name));
  if (!nlLeague?.children?.length) throw new Error("ESPN: NL data not found");

  function getStat(stats, ...names) {
    for (const name of names) {
      const s = (stats || []).find(e => e.name === name);
      if (s != null) return s.displayValue != null ? String(s.displayValue) : String(s.value ?? "");
    }
    return "";
  }

  function parseTeam(entry) {
    const stats = entry.stats || [];
    const name = entry.team?.displayName || entry.team?.name || "Unknown";
    const w = Number(getStat(stats, "wins")) || 0;
    const l = Number(getStat(stats, "losses")) || 0;
    const pct = (w + l > 0) ? (w / (w + l)).toFixed(3).replace(/^0/, "") : ".000";
    const gb = getStat(stats, "gamesBehind");
    return {
      team: name,
      wins: w,
      losses: l,
      pct,
      gamesBack: !gb || gb === "0" || gb === "0.0" ? "-" : gb,
      home:   getStat(stats, "Home", "home") || "0-0",
      road:   getStat(stats, "Road", "road", "Away", "away") || "0-0",
      last10: getStat(stats, "Last Ten", "lastTen", "last10") || "0-0",
      streak: getStat(stats, "streak", "Streak") || "-"
    };
  }

  const divisions = nlLeague.children;
  const nlEastDiv = divisions.find(d => /east/i.test(d.name));
  const nlEast    = (nlEastDiv?.standings?.entries || []).map(parseTeam);
  const nlFull    = divisions.map(div => ({
    divisionName: div.name,
    teams: (div.standings?.entries || []).map(parseTeam)
  }));

  const metsData = nlEast.find(t => t.team === "New York Mets");
  return {
    mets: metsData ? buildMetsStanding(metsData) : null,
    nlEast,
    nlFull
  };
}

async function loadEspnStandings(season) {
  const data = await fetchJson(
    `https://site.api.espn.com/apis/v2/sports/baseball/mlb/standings?season=${season}`
  );
  return parseEspnStandings(data);
}

async function loadStandings(season) {
  try {
    return await loadEspnStandings(season);
  } catch (espnErr) {
    console.warn(`[advanced-stats] ESPN standings failed: ${espnErr.message}`);
  }

  // Fallback to existing API / static JSON
  const data = await fetchJsonWithFallback(
    "api/mlb/mets/standings",
    "api/mlb/mets/standings.json"
  );
  const teams = Array.isArray(data?.teams) ? data.teams : [];
  const metsRaw = teams.find(t => String(t.teamId) === String(TEAM_ID) || t.team === "New York Mets") || null;

  return {
    mets: metsRaw ? buildMetsStanding(metsRaw) : null,
    nlEast: teams.map(t => ({
      team:      t.team,
      wins:      t.wins,
      losses:    t.losses,
      pct:       t.pct,
      gamesBack: t.gamesBack,
      home:      t.home,
      road:      t.road,
      last10:    t.last10,
      streak:    t.streak
    })),
    nlFull: [{
      divisionName: data?.division || "NL East",
      teams: teams.map(t => ({
        team:      t.team,
        wins:      t.wins,
        losses:    t.losses,
        pct:       t.pct,
        gamesBack: t.gamesBack
      }))
    }]
  };
}

// ── League averages ──────────────────────────────────────────────────────────

async function loadLeagueAverages(season) {
  try {
    const url = `https://statsapi.mlb.com/api/v1/teams/stats?stats=season&group=hitting,pitching&season=${season}&sportId=1`;
    const data = await fetchJson(url);
    const statsArr = data?.stats || [];

    function mean(splits, field) {
      const vals = splits.map(s => parseFloat(s.stat?.[field])).filter(v => isFinite(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }

    function meanRate(splits, fn) {
      const vals = splits.map(fn).filter(v => v != null && isFinite(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }

    const hSplits = statsArr.find(s => s.group?.displayName === "hitting")?.splits || [];
    const pSplits = statsArr.find(s => s.group?.displayName === "pitching")?.splits || [];

    return {
      hitting: {
        avg:         mean(hSplits, "avg"),
        obp:         mean(hSplits, "obp"),
        slg:         mean(hSplits, "slg"),
        ops:         mean(hSplits, "ops"),
        runsPerGame: meanRate(hSplits, s => {
          const r = Number(s.stat?.runs), g = Number(s.stat?.gamesPlayed);
          return g > 0 ? r / g : null;
        }),
        bbPct: meanRate(hSplits, s => {
          const bb = Number(s.stat?.baseOnBalls), pa = Number(s.stat?.plateAppearances);
          return pa > 0 ? bb / pa : null;
        }),
        kPct: meanRate(hSplits, s => {
          const k = Number(s.stat?.strikeOuts), pa = Number(s.stat?.plateAppearances);
          return pa > 0 ? k / pa : null;
        })
      },
      pitching: {
        era:  mean(pSplits, "era"),
        whip: mean(pSplits, "whip"),
        k9:   mean(pSplits, "strikeoutsPer9Inn"),
        bb9:  mean(pSplits, "walksPer9Inn"),
        h9:   mean(pSplits, "hitsPer9Inn"),
        hr9:  mean(pSplits, "homeRunsPer9")
      }
    };
  } catch (e) {
    console.warn("[advanced-stats] league averages unavailable:", e.message);
    return null;
  }
}

// ── Overview / roster data ───────────────────────────────────────────────────

async function loadOverview() {
  return fetchJsonWithFallback(
    "api/mlb/mets/overview",
    "api/mlb/mets/overview.json"
  );
}

function loadTeamStats(overview) {
  const stats = overview?.teamStats || [];
  return {
    hitting:  stats.find(e => e.group?.displayName === "hitting")?.splits?.[0]?.stat  || {},
    pitching: stats.find(e => e.group?.displayName === "pitching")?.splits?.[0]?.stat || {},
    fielding: stats.find(e => e.group?.displayName === "fielding")?.splits?.[0]?.stat || {}
  };
}

function loadRosterStats(overview, group) {
  const source = group === "hitting" ? overview?.hitters : overview?.pitchers;
  return (source || []).map(entry => {
    const person = entry.person || {};
    return {
      id:       person.id,
      name:     person.fullName,
      position: entry.position?.abbreviation || person.primaryPosition?.abbreviation || "",
      stats:    person.stats?.[0]?.splits?.[0]?.stat || null
    };
  });
}

// ── Utilities ────────────────────────────────────────────────────────────────

function splitRecord(teamRecord, type) {
  const record = teamRecord?.records?.splitRecords?.find(e => e.type === type);
  if (!record) return "0-0";
  return `${record.wins}-${record.losses}`;
}

function normalizeGamesBack(value) {
  if (value == null || value === "" || value === "0" || value === "0.0" || value === "-") return "-";
  return String(value);
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
  const gp  = Number(games);
  if (!Number.isFinite(num) || !Number.isFinite(gp) || gp <= 0) return "N/A";
  return (num / gp).toFixed(digits);
}

// red = better, blue = worse
function statClass(metsRaw, lgRaw, higherIsBetter) {
  const m = parseFloat(metsRaw);
  const l = parseFloat(lgRaw);
  if (isNaN(m) || isNaN(l)) return "";
  return (higherIsBetter ? m > l : m < l) ? "stat-above-avg" : "stat-below-avg";
}

function renderRows(targetId, rows) {
  const target = document.getElementById(targetId);
  if (target) target.innerHTML = rows.join("");
}

function setText(targetId, value) {
  const el = document.getElementById(targetId);
  if (el) el.textContent = value;
}

// ── Render: at-a-glance ──────────────────────────────────────────────────────

function renderAtAGlance(metsStanding) {
  if (!metsStanding) return;
  const items = [
    { label: "Record",   value: `${metsStanding.wins}-${metsStanding.losses}`, highlight: true },
    { label: "Run Diff", value: metsStanding.runDifferential > 0 ? `+${metsStanding.runDifferential}` : String(metsStanding.runDifferential || 0) },
    { label: "Home",     value: splitRecord(metsStanding, "home") },
    { label: "Road",     value: splitRecord(metsStanding, "away") },
    { label: "Last 10",  value: splitRecord(metsStanding, "lastTen") },
    { label: "Streak",   value: metsStanding.streak?.streakCode || "-" }
  ];
  const target = document.getElementById("at-a-glance");
  if (!target) return;
  target.innerHTML = items.map(item => `
    <div class="glance-item">
      <div class="glance-label">${item.label}</div>
      <div class="glance-value${item.highlight ? " highlight" : ""}">${item.value}</div>
    </div>
  `).join("");
}

// ── Render: team stats ───────────────────────────────────────────────────────

function renderTeamStats(teamStats, leagueAvg, season) {
  const { hitting, pitching, fielding } = teamStats;
  const lh = leagueAvg?.hitting  || null;
  const lp = leagueAvg?.pitching || null;
  const haveAvg = leagueAvg != null;
  const noAvg   = haveAvg ? "\u2014" : season;

  function fmtLgPct(v)  { return v != null ? formatPct(v)           : noAvg; }
  function fmtLgDec(v)  { return v != null ? formatDecimal(v)        : noAvg; }
  function fmtLgRate(v) { return v != null ? `${(v * 100).toFixed(1)}%` : noAvg; }

  const metsRPG    = Number(hitting.gamesPlayed) > 0 ? Number(hitting.runs)         / Number(hitting.gamesPlayed)        : null;
  const metsBBPct  = Number(hitting.plateAppearances) > 0 ? Number(hitting.baseOnBalls) / Number(hitting.plateAppearances) : null;
  const metsKPct   = Number(hitting.plateAppearances) > 0 ? Number(hitting.strikeOuts)  / Number(hitting.plateAppearances) : null;

  function row(label, value, lgDisplay, metsRaw, lgRaw, higherBetter) {
    const cls = (metsRaw != null && lgRaw != null) ? statClass(metsRaw, lgRaw, higherBetter) : "";
    return `<tr><td>${label}</td><td class="${cls}"><strong>${value}</strong></td><td>${lgDisplay}</td></tr>`;
  }

  renderRows("offense-body", [
    row("AVG",      formatPct(hitting.avg),                                    fmtLgPct(lh?.avg),         parseFloat(hitting.avg),  lh?.avg,         true),
    row("OBP",      formatPct(hitting.obp),                                    fmtLgPct(lh?.obp),         parseFloat(hitting.obp),  lh?.obp,         true),
    row("SLG",      formatPct(hitting.slg),                                    fmtLgPct(lh?.slg),         parseFloat(hitting.slg),  lh?.slg,         true),
    row("OPS",      formatPct(hitting.ops),                                    fmtLgPct(lh?.ops),         parseFloat(hitting.ops),  lh?.ops,         true),
    row("Runs / G", formatPerGame(hitting.runs, hitting.gamesPlayed),          fmtLgDec(lh?.runsPerGame), metsRPG,                  lh?.runsPerGame, true),
    row("HR",       hitting.homeRuns   ?? "0",                                 noAvg,                      null, null, true),
    row("SB",       hitting.stolenBases ?? "0",                                noAvg,                      null, null, true),
    row("BB%",      formatRate(hitting.baseOnBalls,  hitting.plateAppearances),fmtLgRate(lh?.bbPct),      metsBBPct, lh?.bbPct,   true),
    row("K%",       formatRate(hitting.strikeOuts,   hitting.plateAppearances),fmtLgRate(lh?.kPct),       metsKPct,  lh?.kPct,    false)
  ]);

  renderRows("pitching-body", [
    row("ERA",    formatDecimal(pitching.era),               fmtLgDec(lp?.era),  parseFloat(pitching.era),               lp?.era,  false),
    row("WHIP",   formatDecimal(pitching.whip),              fmtLgDec(lp?.whip), parseFloat(pitching.whip),              lp?.whip, false),
    row("K / 9",  formatDecimal(pitching.strikeoutsPer9Inn), fmtLgDec(lp?.k9),   parseFloat(pitching.strikeoutsPer9Inn), lp?.k9,   true),
    row("BB / 9", formatDecimal(pitching.walksPer9Inn),      fmtLgDec(lp?.bb9),  parseFloat(pitching.walksPer9Inn),      lp?.bb9,  false),
    row("H / 9",  formatDecimal(pitching.hitsPer9Inn),       fmtLgDec(lp?.h9),   parseFloat(pitching.hitsPer9Inn),       lp?.h9,   false),
    row("HR / 9", formatDecimal(pitching.homeRunsPer9),      fmtLgDec(lp?.hr9),  parseFloat(pitching.homeRunsPer9),      lp?.hr9,  false),
    row("Saves",  pitching.saves  ?? "0",                    noAvg,               null, null, true),
    row("Holds",  pitching.holds  ?? "0",                    noAvg,               null, null, true),
    row("IP",     pitching.inningsPitched || "0.0",          noAvg,               null, null, true)
  ]);

  renderRows("defense-body", [
    `<tr><td>Fielding %</td><td><strong>${formatPct(fielding.fielding)}</strong></td><td>${noAvg}</td></tr>`,
    `<tr><td>Errors</td><td><strong>${fielding.errors ?? "0"}</strong></td><td>${noAvg}</td></tr>`,
    `<tr><td>Double Plays</td><td><strong>${fielding.doublePlays ?? "0"}</strong></td><td>${noAvg}</td></tr>`,
    `<tr><td>Assists</td><td><strong>${fielding.assists ?? "0"}</strong></td><td>${noAvg}</td></tr>`,
    `<tr><td>Putouts</td><td><strong>${fielding.putOuts ?? "0"}</strong></td><td>${noAvg}</td></tr>`,
    `<tr><td>SB Allowed</td><td><strong>${fielding.stolenBases ?? "0"}</strong></td><td>${noAvg}</td></tr>`,
    `<tr><td>CS</td><td><strong>${fielding.caughtStealing ?? "0"}</strong></td><td>${noAvg}</td></tr>`
  ]);
}

// ── Render: hitters / pitchers ───────────────────────────────────────────────

function renderHitters(players, season) {
  const hitters = players
    .filter(p => p.position !== "P")
    .sort((a, b) => (Number(b.stats?.plateAppearances || 0) - Number(a.stats?.plateAppearances || 0)) || a.name.localeCompare(b.name));

  renderRows("hitters-body", hitters.map(player => {
    const s = player.stats || {};
    return `
      <tr>
        <td><div class="player-name-td"><img src="${headshotUrl(player.id)}" class="player-row-headshot" alt="${player.name}" onerror="this.style.display='none'"><strong>${player.name}</strong></div></td>
        <td>${player.position || "-"}</td>
        <td>${formatPct(s.avg)}</td>
        <td>${formatPct(s.obp)}</td>
        <td>${formatPct(s.ops)}</td>
        <td>${s.homeRuns ?? 0}</td>
        <td>${s.rbi ?? 0}</td>
        <td>${formatRate(s.baseOnBalls, s.plateAppearances)}</td>
        <td>${formatRate(s.strikeOuts,  s.plateAppearances)}</td>
      </tr>
    `;
  }));
  setText("hitters-card-title", `Hitters \u2014 ${season} Active Roster`);
}

function renderPitchers(players, season) {
  const pitchers = players
    .filter(p => p.position === "P")
    .sort((a, b) =>
      (Number(b.stats?.gamesStarted || 0) - Number(a.stats?.gamesStarted || 0)) ||
      (Number(b.stats?.inningsPitched || 0) - Number(a.stats?.inningsPitched || 0)) ||
      a.name.localeCompare(b.name));

  const starters  = pitchers.filter(p => Number(p.stats?.gamesStarted || 0) > 0);
  const relievers = pitchers.filter(p => Number(p.stats?.gamesStarted || 0) === 0);
  const none8 = colspan => `<tr><td colspan="${colspan}" style="color:#9099b0;padding:1rem;text-align:center">No stats available yet.</td></tr>`;

  renderRows("rotation-body", starters.length ? starters.map(player => {
    const s = player.stats || {};
    return `
      <tr>
        <td><div class="player-name-td"><img src="${headshotUrl(player.id)}" class="player-row-headshot" alt="${player.name}" onerror="this.style.display='none'"><strong>${player.name}</strong></div></td>
        <td>${s.gamesStarted ?? 0}</td>
        <td>${s.inningsPitched || "0.0"}</td>
        <td>${formatDecimal(s.era)}</td>
        <td>${formatDecimal(s.whip)}</td>
        <td>${formatDecimal(s.strikeoutWalkRatio)}</td>
        <td>${formatDecimal(s.strikeoutsPer9Inn)}</td>
        <td>${formatDecimal(s.walksPer9Inn)}</td>
      </tr>
    `;
  }) : [none8(8)]);

  renderRows("bullpen-body", relievers.length ? relievers.map(player => {
    const s = player.stats || {};
    return `
      <tr>
        <td><div class="player-name-td"><img src="${headshotUrl(player.id)}" class="player-row-headshot" alt="${player.name}" onerror="this.style.display='none'"><strong>${player.name}</strong></div></td>
        <td>${s.gamesPitched ?? 0}</td>
        <td>${s.inningsPitched || "0.0"}</td>
        <td>${formatDecimal(s.era)}</td>
        <td>${formatDecimal(s.whip)}</td>
        <td>${s.holds ?? 0}</td>
        <td>${s.saves ?? 0}</td>
        <td>${formatDecimal(s.strikeoutsPer9Inn)}</td>
      </tr>
    `;
  }) : [none8(8)]);

  setText("rotation-card-title", `Starting Rotation \u2014 ${season} Live Stats`);
  setText("bullpen-card-title",  `Bullpen \u2014 ${season} Live Stats`);
}

// ── Render: standings ────────────────────────────────────────────────────────

function renderStandings(standings) {
  renderRows("nle-body", standings.nlEast.map(team => {
    const isMets = team.team === "New York Mets";
    const logo   = getTeamLogoUrl(team.team);
    return `
      <tr class="${isMets ? "mets-row" : ""}">
        <td><div class="standings-team-cell">
          <img src="${logo}" class="standings-logo" alt="${team.team}" onerror="this.style.display='none'">
          <span${isMets ? ' style="font-weight:700;color:var(--navy)"' : ""}>${team.team}</span>
        </div></td>
        <td>${team.wins}</td>
        <td>${team.losses}</td>
        <td>${formatPct(team.pct)}</td>
        <td>${normalizeGamesBack(team.gamesBack)}</td>
        <td>${team.home   || "-"}</td>
        <td>${team.road   || "-"}</td>
        <td>${team.last10 || "-"}</td>
        <td>${team.streak || "-"}</td>
      </tr>
    `;
  }));

  renderRows("nl-full-body", standings.nlFull.flatMap(division => {
    const divider  = `<tr class="divider-row"><td colspan="5">${division.divisionName}</td></tr>`;
    const teamRows = division.teams.map(team => {
      const isMets = team.team === "New York Mets";
      const logo   = getTeamLogoUrl(team.team);
      return `
        <tr class="${isMets ? "mets-row" : ""}">
          <td><div class="standings-team-cell">
            <img src="${logo}" class="standings-logo" alt="${team.team}" onerror="this.style.display='none'">
            <span${isMets ? ' style="font-weight:700;color:var(--navy)"' : ""}>${team.team}</span>
          </div></td>
          <td>${team.wins}</td>
          <td>${team.losses}</td>
          <td>${formatPct(team.pct)}</td>
          <td>${normalizeGamesBack(team.gamesBack)}</td>
        </tr>
      `;
    });
    return [divider, ...teamRows];
  }));
}

// ── Timestamp / error ────────────────────────────────────────────────────────

async function loadGeneratedTimestamp() {
  try {
    const data = await fetchJson("data/sample-game.json");
    return data.generatedAt || null;
  } catch {
    return null;
  }
}

function renderTimestamp(value) {
  const el = document.getElementById("data-timestamp");
  if (!el || !value) return;
  el.textContent = "Last updated: " + new Date(value).toLocaleString("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
    hour12: true, timeZoneName: "short"
  });
}

function showErrorState(error) {
  console.error("Failed to render live stats page", error);
  const msg = "Live MLB data could not be loaded right now.";
  const e3 = `<tr><td colspan="3" style="color:#9099b0;padding:1rem;text-align:center">${msg}</td></tr>`;
  const e9 = `<tr><td colspan="9" style="color:#9099b0;padding:1rem;text-align:center">${msg}</td></tr>`;
  const e8 = `<tr><td colspan="8" style="color:#9099b0;padding:1rem;text-align:center">${msg}</td></tr>`;
  const e5 = `<tr><td colspan="5" style="color:#9099b0;padding:1rem;text-align:center">${msg}</td></tr>`;
  renderRows("offense-body",  [e3]);
  renderRows("pitching-body", [e3]);
  renderRows("defense-body",  [e3]);
  renderRows("hitters-body",  [e9]);
  renderRows("rotation-body", [e8]);
  renderRows("bullpen-body",  [e8]);
  renderRows("nle-body",      [e9]);
  renderRows("nl-full-body",  [e5]);
}

window.toggleFullStandings = function toggleFullStandings() {
  const el  = document.getElementById("full-nl-standings");
  const btn = document.querySelector(".full-standings-toggle");
  if (!el || !btn) return;
  el.classList.toggle("open");
  btn.textContent = el.classList.contains("open")
    ? "Full NL Standings \u25B2"
    : "Full NL Standings \u25BC";
};

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const season = getCurrentSeason();
  setText("stats-subtitle", `${season} Mets \u2014 live team stats, active roster production, pitching staff, and NL standings.`);
  setText("page-banner", "Live MLB data synced daily from the MetsMoneyline sources.");

  try {
    const [standings, overview, generatedAt, leagueAvg] = await Promise.all([
      loadStandings(season),
      loadOverview(),
      loadGeneratedTimestamp(),
      loadLeagueAverages(season)
    ]);

    const teamStats = loadTeamStats(overview);
    const hitters   = loadRosterStats(overview, "hitting");
    const pitchers  = loadRosterStats(overview, "pitching");

    renderAtAGlance(standings.mets);
    renderTeamStats(teamStats, leagueAvg, season);
    renderHitters(hitters, season);
    renderPitchers(pitchers, season);
    renderStandings(standings);
    renderTimestamp(generatedAt || new Date().toISOString());
  } catch (error) {
    showErrorState(error);
  }
}

init();
