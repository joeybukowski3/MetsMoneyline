import METS_2025 from "../data/mets2025.js";

async function loadGameData() {
  const res = await fetch("data/sample-game.json");
  const data = await res.json();
  return data.games;
}

const ESPN_LOGO = {
  "St. Louis Cardinals": "stl",
  "Atlanta Braves": "atl",
  "Washington Nationals": "wsh",
  "Philadelphia Phillies": "phi",
  "Miami Marlins": "mia",
  "Chicago Cubs": "chc",
  "Milwaukee Brewers": "mil",
  "Cincinnati Reds": "cin",
  "Pittsburgh Pirates": "pit",
  "San Francisco Giants": "sf",
  "Los Angeles Dodgers": "lad",
  "San Diego Padres": "sd"
};

const DEFAULT_METS_LINEUP = [
  { order: 1, name: "Brandon Nimmo",      pos: "CF", hand: "L" },
  { order: 2, name: "Francisco Lindor",   pos: "SS", hand: "S" },
  { order: 3, name: "Juan Soto",          pos: "LF", hand: "L" },
  { order: 4, name: "Pete Alonso",        pos: "1B", hand: "R" },
  { order: 5, name: "Mark Vientos",       pos: "3B", hand: "R" },
  { order: 6, name: "Francisco Alvarez",  pos: "C",  hand: "R" },
  { order: 7, name: "Starling Marte",     pos: "RF", hand: "R" },
  { order: 8, name: "Jeff McNeil",        pos: "2B", hand: "L" },
  { order: 9, name: "pitcher slot",       pos: "P",  hand: "-" }
];

function getTeamLogoUrl(teamName) {
  const slug = ESPN_LOGO[teamName];
  return slug ? `https://a.espncdn.com/i/teamlogos/mlb/500/${slug}.png` : "";
}

function isMissingStat(value) {
  return value == null || value === "" || value === "N/A";
}

function get2025PlayerStat(name, group, stat) {
  const entry = METS_2025[group]?.[name];
  if (!entry || entry[stat] == null) return "N/A";
  return `${entry[stat]} <span class="stat-year">(2025)</span>`;
}

function getMetsPitchingStat(liveValue, playerName, stat) {
  return isMissingStat(liveValue) ? get2025PlayerStat(playerName, "starters", stat) : liveValue;
}

function getMetsHitterSeasonOps(player) {
  return isMissingStat(player.seasonOPS)
    ? get2025PlayerStat(player.name, "hitters", "OPS")
    : player.seasonOPS;
}

/* ── Matchup Strip ── */
function buildMatchupStrip(game) {
  const oppLogo = getTeamLogoUrl(game.opponent);
  const metsML  = game.moneyline.mets > 0 ? `+${game.moneyline.mets}` : `${game.moneyline.mets}`;
  const oppML   = game.moneyline.opp  > 0 ? `+${game.moneyline.opp}`  : `${game.moneyline.opp}`;
  return `
    <div class="matchup-strip">
      <div class="team-block home">
        <img src="https://a.espncdn.com/i/teamlogos/mlb/500/nym.png" class="team-logo" alt="NYM">
        <div class="team-name">New York Mets</div>
        <div class="team-record">${game.metsRecord} &nbsp;|&nbsp; ML ${metsML}</div>
      </div>
      <div class="matchup-vs-block">
        <span class="matchup-vs-label">vs</span>
        <span class="matchup-vs-time">${game.time}</span>
        <span class="matchup-vs-venue">${game.ballpark}</span>
      </div>
      <div class="team-block away">
        ${oppLogo ? `<img src="${oppLogo}" class="team-logo" alt="${game.opponent}">` : ""}
        <div class="team-name">${game.opponent}</div>
        <div class="team-record">${game.oppRecord} &nbsp;|&nbsp; ML ${oppML}</div>
      </div>
    </div>`;
}

/* ── Matchup Overview Card ── */
function buildMatchupCard(game) {
  const metsML = game.moneyline.mets > 0 ? `+${game.moneyline.mets}` : `${game.moneyline.mets}`;
  const oppML  = game.moneyline.opp  > 0 ? `+${game.moneyline.opp}`  : `${game.moneyline.opp}`;
  const ou     = game.overUnder ? game.overUnder : (game.runLine ? `Run Line: ${game.runLine.mets} (${game.runLine.price > 0 ? "+" : ""}${game.runLine.price})` : "N/A");
  return `
    <div class="card">
      <div class="card-header">Matchup Overview</div>
      <ul class="info-list">
        <li>
          <span class="info-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </span>
          <span>
            <span class="info-label">Date &amp; Time</span>
            <span class="info-value">${game.date} &nbsp;&bull;&nbsp; <span style="color:var(--orange)">${game.time}</span></span>
          </span>
        </li>
        <li>
          <span class="info-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
          </span>
          <span>
            <span class="info-label">Location</span>
            <span class="info-value">${game.ballpark}</span>
          </span>
        </li>
        <li>
          <span class="info-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
          </span>
          <span>
            <span class="info-label">Moneyline</span>
            <span class="info-value">NYM <span class="highlight">${metsML}</span> &nbsp;/&nbsp; OPP ${oppML}</span>
          </span>
        </li>
        <li>
          <span class="info-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
            </svg>
          </span>
          <span>
            <span class="info-label">Run Line / O&amp;U</span>
            <span class="info-value">${ou}</span>
          </span>
        </li>
        <li>
          <span class="info-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
          </span>
          <span>
            <span class="info-label">Home / Away</span>
            <span class="info-value">${game.homeAway === "home" ? "Mets at Home" : "Mets on the Road"}</span>
          </span>
        </li>
      </ul>
    </div>`;
}

/* ── Starting Pitching Card ── */
function buildPitchingCard(game) {
  const p    = game.pitching;
  const mn   = p.mets.name;
  const mERA  = getMetsPitchingStat(p.mets.seasonERA,  mn, "ERA");
  const mFIP  = getMetsPitchingStat(p.mets.seasonFIP,  mn, "FIP");
  const mWHIP = getMetsPitchingStat(p.mets.seasonWHIP, mn, "WHIP");
  const mKBB  = getMetsPitchingStat(p.mets.last3KBB,   mn, "KBB");
  const mL3   = p.mets.last3ERA;

  const bpMetsERA  = p.metsBullpen?.seasonERA  ?? "N/A";
  const bpMetsXFIP = p.metsBullpen?.seasonXFIP ?? "N/A";
  const bpOppERA   = p.oppBullpen?.seasonERA   ?? "N/A";
  const bpOppXFIP  = p.oppBullpen?.seasonXFIP  ?? "N/A";
  const bpMetsRating = p.metsBullpen?.rating ?? "—";
  const bpOppRating  = p.oppBullpen?.rating  ?? "—";

  return `
    <div class="card">
      <div class="card-header">Starting Pitching</div>
      <div class="pitcher-comparison">
        <div class="pitcher-col">
          <div class="pitcher-team-label mets-label">NYM</div>
          <div class="pitcher-name mets-name">${p.mets.name}</div>
          <div class="pitcher-hand">${p.mets.hand}HP</div>
          <div class="pitcher-stats">
            <div class="pitcher-stat-row"><span class="stat-label">Season ERA</span><span class="stat-val">${mERA}</span></div>
            <div class="pitcher-stat-row"><span class="stat-label">FIP</span><span class="stat-val">${mFIP}</span></div>
            <div class="pitcher-stat-row"><span class="stat-label">WHIP</span><span class="stat-val">${mWHIP}</span></div>
            <div class="pitcher-stat-row"><span class="stat-label">K/BB</span><span class="stat-val">${mKBB}</span></div>
            <div class="pitcher-stat-row"><span class="stat-label">Last 3 ERA</span><span class="stat-val">${mL3}</span></div>
          </div>
        </div>
        <div class="pitcher-col">
          <div class="pitcher-team-label opp-label">OPP</div>
          <div class="pitcher-name opp-name">${p.opp.name}</div>
          <div class="pitcher-hand">${p.opp.hand}HP</div>
          <div class="pitcher-stats">
            <div class="pitcher-stat-row"><span class="stat-label">Season ERA</span><span class="stat-val">${p.opp.seasonERA}</span></div>
            <div class="pitcher-stat-row"><span class="stat-label">FIP</span><span class="stat-val">${p.opp.seasonFIP}</span></div>
            <div class="pitcher-stat-row"><span class="stat-label">WHIP</span><span class="stat-val">${p.opp.seasonWHIP}</span></div>
            <div class="pitcher-stat-row"><span class="stat-label">K/BB</span><span class="stat-val">${p.opp.last3KBB}</span></div>
            <div class="pitcher-stat-row"><span class="stat-label">Last 3 ERA</span><span class="stat-val">${p.opp.last3ERA}</span></div>
          </div>
        </div>
      </div>
      <div class="bullpen-row">
        <div class="bp-label">Bullpen</div>
        <div class="bp-mets">
          <div style="font-weight:700;font-size:0.8rem;">NYM</div>
          <div class="bp-stat-mini">ERA ${bpMetsERA} &nbsp;&bull;&nbsp; xFIP ${bpMetsXFIP} &nbsp;&bull;&nbsp; Rating ${bpMetsRating}/100</div>
        </div>
        <div class="bp-opp">
          <div style="font-weight:700;font-size:0.8rem;">OPP</div>
          <div class="bp-stat-mini">ERA ${bpOppERA} &nbsp;&bull;&nbsp; xFIP ${bpOppXFIP} &nbsp;&bull;&nbsp; Rating ${bpOppRating}/100</div>
        </div>
      </div>
    </div>`;
}

/* ── Advanced Metrics Card ── */
function buildAdvancedCard(game) {
  const rows = game.advancedMatchup.map(r => {
    const edgeColor = r.edge === "Mets"
      ? "color:var(--orange);font-weight:700"
      : r.edge === "Neutral"
        ? "color:#9099b0"
        : "color:#c0392b;font-weight:700";
    return `<tr>
      <td>${r.category}</td>
      <td>${r.mets}</td>
      <td>${r.opp}</td>
      <td style="${edgeColor}">${r.edge}</td>
    </tr>`;
  }).join("");

  // Find the top Mets edge for the callout
  const topEdge = game.advancedMatchup.find(r => r.edge === "Mets");
  const edgeCallout = topEdge
    ? `<div class="edge-callout">Key Edge: ${topEdge.category} — NYM ${topEdge.mets} vs OPP ${topEdge.opp}</div>`
    : `<div class="edge-callout neutral">No clear statistical edge identified</div>`;

  return `
    <div class="card">
      <div class="card-header">Advanced Metrics</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Metric</th><th>NYM</th><th>OPP</th><th>Edge</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${edgeCallout}
    </div>`;
}

/* ── Lineup Grid (Mets + Opp + Game Analysis) ── */
function buildLineupGrid(game) {
  const l = game.lineups || {};
  const metsLineup = Array.isArray(l.mets) && l.mets.length > 0 ? l.mets : DEFAULT_METS_LINEUP;
  const oppLineup  = Array.isArray(l.opp)  ? l.opp : [];
  const statusLabel = l.status === "confirmed" ? "Confirmed" : "Projected";

  const metsRows = metsLineup.map(p => `
    <tr>
      <td>${p.order}</td>
      <td style="font-weight:600">${p.name}</td>
      <td>${p.pos}</td>
      <td>${p.hand}</td>
      <td>${getMetsHitterSeasonOps(p)}</td>
    </tr>`).join("");

  const oppRows = oppLineup.length > 0
    ? oppLineup.map(p => `
    <tr>
      <td>${p.order}</td>
      <td style="font-weight:600">${p.name}</td>
      <td>${p.pos}</td>
      <td>${p.hand}</td>
      <td>${p.seasonOPS ?? "N/A"}</td>
    </tr>`).join("")
    : `<tr><td colspan="5" style="color:#9099b0;text-align:center;padding:1rem">Lineup TBD</td></tr>`;

  // Game Analysis — use first 3 writeup sections mapped to labels
  const sectionLabels = ["Offensive Matchup", "Pitching Matchup", "Key Edge"];
  const sections = game.writeup?.sections ?? [];
  const analysisSections = [0, 1, 2].map(i => {
    const s = sections[i];
    if (!s) return "";
    const label = sectionLabels[i] || s.heading;
    return `
      <div class="analysis-section">
        <div class="analysis-section-label">${label}</div>
        <p>${s.body}</p>
      </div>`;
  }).join("");

  return `
    <div class="lineup-grid">
      <div class="card">
        <div class="card-header">${statusLabel} Lineup — Mets</div>
        <div class="lineup-team-header mets-header">New York Mets</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Player</th><th>POS</th><th>Hand</th><th>OPS</th></tr></thead>
            <tbody>${metsRows}</tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-header">${statusLabel} Lineup — ${game.opponent}</div>
        <div class="lineup-team-header opp-header">${game.opponent}</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Player</th><th>POS</th><th>Hand</th><th>OPS</th></tr></thead>
            <tbody>${oppRows}</tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-header">Game Analysis</div>
        ${analysisSections}
      </div>
    </div>`;
}

/* ── Trends Card (full-width) ── */
function buildTrendsCard(game) {
  if (!game.trends || game.trends.length === 0) return "";
  const rows = game.trends.map(r => {
    const edgeColor = r.edge === "Mets"
      ? "color:var(--orange);font-weight:700"
      : r.edge === "Neutral"
        ? "color:#9099b0"
        : "color:#c0392b;font-weight:700";
    return `<tr>
      <td>${r.category}</td>
      <td>${r.mets}</td>
      <td>${r.opp}</td>
      <td style="${edgeColor}">${r.edge}</td>
    </tr>`;
  }).join("");
  return `
    <div class="card full-card">
      <div class="card-header">Schedule &amp; Trend Notes</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Category</th><th>Mets</th><th>Opponent</th><th>Edge</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

/* ── Pick Section ── */
function buildPickSection(game) {
  const sections  = game.writeup?.sections ?? [];
  // "Putting It Together" is typically the last section
  const putTogether = sections.find(s => /putting|together|bottom line/i.test(s.heading));
  const summary = putTogether?.body || game.writeup?.pickSummary || game.matchupSummary || "";

  const officialPick = game.writeup?.officialPick || "NYM Moneyline";
  const metsML = game.moneyline?.mets;
  const oddsStr = metsML != null ? (metsML > 0 ? `+${metsML}` : `${metsML}`) : "";

  return `
    <div class="pick-section">
      <div class="pick-left">
        <div class="pick-fire-row">
          <span>&#x1F525;</span>
          <span class="pick-tag">Today's Pick</span>
        </div>
        <p class="pick-summary">${summary}</p>
      </div>
      <div class="pick-right">
        <div class="pick-badge">
          NYM Moneyline <span class="pick-odds">${oddsStr}</span>
        </div>
      </div>
    </div>`;
}

/* ── Recent Game Tiles ── */
function buildRecentTiles(games) {
  const past = games.filter(g => g.status === "final").slice(-5).reverse();
  if (!past.length) return "<p style='color:#9099b0;padding:1rem;'>No completed games yet.</p>";
  return past.map(g => `
    <div class="game-tile ${g.result === "W" ? "win" : ""}">
      <div style="font-size:0.78rem;color:#9099b0;margin-bottom:0.2rem">${g.date}</div>
      <div style="font-weight:700;color:var(--navy);margin-bottom:0.2rem">${g.opponent}</div>
      <div style="font-size:0.9rem">${g.finalScore || "—"}</div>
      <div style="font-size:0.82rem;color:${g.result === "W" ? "var(--orange)" : "#9099b0"};margin-top:0.2rem">
        ${g.result === "W" ? "Mets Win" : "See the breakdown"}
      </div>
    </div>`).join("");
}

/* ── Init ── */
async function init() {
  const games = await loadGameData();
  const today = new Date().toISOString().split("T")[0];
  const todayGame = games.find(g => g.date >= today && g.status === "upcoming")
    || games.find(g => g.status === "upcoming")
    || games[0];

  // Update hero headline
  const shortOpp = todayGame.opponent.split(" ").pop(); // e.g. "Phillies"
  const heroEl = document.getElementById("hero-headline");
  if (heroEl) heroEl.textContent = `Today's Edge: NYM vs ${shortOpp}`;

  const container = document.getElementById("today-game-container");
  container.innerHTML =
    buildMatchupStrip(todayGame) +
    '<div class="three-col-grid">' +
      buildMatchupCard(todayGame) +
      buildPitchingCard(todayGame) +
      buildAdvancedCard(todayGame) +
    "</div>" +
    buildLineupGrid(todayGame) +
    buildTrendsCard(todayGame) +
    buildPickSection(todayGame);

  document.getElementById("recent-games-container").innerHTML = buildRecentTiles(games);
}

init();
