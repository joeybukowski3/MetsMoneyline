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

function getMetsHitterAVG(player) {
  return isMissingStat(player.seasonAVG)
    ? get2025PlayerStat(player.name, "hitters", "AVG")
    : player.seasonAVG;
}

/* ── ROW 1: Matchup Strip ── */
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

/* ── ROW 2: Starting Pitching — full-width 3-column comparison grid ── */
function buildPitchingCard(game) {
  const p  = game.pitching;
  const mn = p.mets.name;

  // Starter stats with 2025 fallback for Mets pitcher
  const mERA  = getMetsPitchingStat(p.mets.seasonERA,  mn, "ERA");
  const mFIP  = getMetsPitchingStat(p.mets.seasonFIP,  mn, "FIP");
  const mXERA = getMetsPitchingStat(p.mets.seasonXERA, mn, "xFIP");
  const mWHIP = getMetsPitchingStat(p.mets.seasonWHIP, mn, "WHIP");
  const mKBB  = getMetsPitchingStat(p.mets.last3KBB,   mn, "KBB");
  const mL3   = isMissingStat(p.mets.last3ERA) ? "N/A" : p.mets.last3ERA;

  const oERA  = isMissingStat(p.opp.seasonERA)  ? "N/A" : p.opp.seasonERA;
  const oFIP  = isMissingStat(p.opp.seasonFIP)  ? "N/A" : p.opp.seasonFIP;
  const oXERA = isMissingStat(p.opp.seasonXERA) ? "N/A" : p.opp.seasonXERA;
  const oWHIP = isMissingStat(p.opp.seasonWHIP) ? "N/A" : p.opp.seasonWHIP;
  const oKBB  = isMissingStat(p.opp.last3KBB)   ? "N/A" : p.opp.last3KBB;
  const oL3   = isMissingStat(p.opp.last3ERA)   ? "N/A" : p.opp.last3ERA;

  // Bullpen
  const bpMetsERA    = p.metsBullpen?.seasonERA   ?? "N/A";
  const bpMetsXFIP   = p.metsBullpen?.seasonXFIP  ?? "N/A";
  const bpMets14ERA  = p.metsBullpen?.last14ERA   ?? "N/A";
  const bpMetsRating = p.metsBullpen?.rating      ?? "—";
  const bpOppERA     = p.oppBullpen?.seasonERA    ?? "N/A";
  const bpOppXFIP    = p.oppBullpen?.seasonXFIP   ?? "N/A";
  const bpOpp14ERA   = p.oppBullpen?.last14ERA    ?? "N/A";
  const bpOppRating  = p.oppBullpen?.rating       ?? "—";

  const row = (left, mid, right) => `
    <div class="pitching-col-left pg-val">${left}</div>
    <div class="pitching-col-mid">${mid}</div>
    <div class="pitching-col-right pg-val">${right}</div>`;

  return `
    <div class="card full-card">
      <div class="card-header">Starting Pitching</div>
      <div class="pitching-grid">

        <!-- Pitcher name header row -->
        <div class="pitching-col-left">
          <div class="pg-name">${p.mets.name}</div>
          <div class="pg-label">NYM &middot; ${p.mets.hand}HP</div>
        </div>
        <div class="pitching-col-mid"></div>
        <div class="pitching-col-right">
          <div class="pg-name">${p.opp.name}</div>
          <div class="pg-label">OPP &middot; ${p.opp.hand}HP</div>
        </div>

        ${row(mERA,  "ERA",        oERA)}
        ${row(mFIP,  "FIP",        oFIP)}
        ${row(mXERA, "xERA",       oXERA)}
        ${row(mWHIP, "WHIP",       oWHIP)}
        ${row(mKBB,  "K/BB",       oKBB)}
        ${row(mL3,   "Last 3 ERA", oL3)}

        <!-- Bullpen divider -->
        <div class="pitching-section-divider">Bullpen</div>

        <!-- Bullpen team labels -->
        <div class="pitching-col-left" style="color:#9099b0;font-size:0.78rem;font-weight:600;">NYM</div>
        <div class="pitching-col-mid"></div>
        <div class="pitching-col-right" style="color:#9099b0;font-size:0.78rem;font-weight:600;">OPP</div>

        ${row(bpMetsERA,   "ERA",       bpOppERA)}
        ${row(bpMetsXFIP,  "xFIP",      bpOppXFIP)}
        ${row(bpMets14ERA, "Last 14d",  bpOpp14ERA)}
        ${row(`${bpMetsRating}/100`, "Rating", `${bpOppRating}/100`)}

      </div>
    </div>`;
}

/* ── ROW 3: Lineups + Advanced Metrics ── */
function buildRow3(game) {
  const l = game.lineups || {};
  const metsLineup = Array.isArray(l.mets) && l.mets.length > 0 ? l.mets : DEFAULT_METS_LINEUP;
  const oppLineup  = Array.isArray(l.opp)  ? l.opp : [];
  const statusLabel = l.status === "confirmed" ? "Confirmed" : "Projected";

  const metsRows = metsLineup.map(p => `
    <tr>
      <td>${p.order}</td>
      <td style="font-weight:600">${p.name}</td>
      <td>${p.pos}</td>
      <td>${getMetsHitterAVG(p)}</td>
      <td>${getMetsHitterSeasonOps(p)}</td>
    </tr>`).join("");

  const oppRows = oppLineup.length > 0
    ? oppLineup.map(p => `
    <tr>
      <td>${p.order}</td>
      <td style="font-weight:600">${p.name}</td>
      <td>${p.pos}</td>
      <td>${p.seasonAVG ?? "N/A"}</td>
      <td>${p.seasonOPS ?? "N/A"}</td>
    </tr>`).join("")
    : `<tr><td colspan="5" style="color:#9099b0;text-align:center;padding:1rem">Lineup TBD</td></tr>`;

  // Advanced metrics (col 3)
  const advRows = game.advancedMatchup.map(r => {
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

  const topEdge = game.advancedMatchup.find(r => r.edge === "Mets");
  const edgeCallout = topEdge
    ? `<div class="edge-callout">Key Edge: ${topEdge.category} — NYM ${topEdge.mets} vs OPP ${topEdge.opp}</div>`
    : `<div class="edge-callout neutral">No clear statistical edge identified</div>`;

  return `
    <div class="row-3-grid">
      <div class="card">
        <div class="card-header">${statusLabel} Lineup — Mets</div>
        <div class="lineup-team-header mets-header">New York Mets</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Player</th><th>POS</th><th>AVG</th><th>OPS</th></tr></thead>
            <tbody>${metsRows}</tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header">${statusLabel} Lineup — ${game.opponent}</div>
        <div class="lineup-team-header opp-header">${game.opponent}</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Player</th><th>POS</th><th>AVG</th><th>OPS</th></tr></thead>
            <tbody>${oppRows}</tbody>
          </table>
        </div>
      </div>

      <div class="card advanced-metrics">
        <div class="card-header">Advanced Metrics</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Metric</th><th>NYM</th><th>OPP</th><th>Edge</th></tr></thead>
            <tbody>${advRows}</tbody>
          </table>
        </div>
        ${edgeCallout}
      </div>
    </div>`;
}

/* ── ROW 4: Analysis tiles (3 side-by-side) ── */
function buildAnalysisRow(game) {
  const sections = game.writeup?.sections ?? [];

  // Map the first 3 sections to tiles; use section heading as the title
  const tiles = [0, 1, 2].map(i => {
    const s = sections[i];
    if (!s) return "";
    return `
      <div class="section-card">
        <div class="section-title">${s.heading}</div>
        <p style="padding:1rem 1.1rem;font-size:0.875rem;color:#374151;line-height:1.7;">${s.body}</p>
      </div>`;
  }).join("");

  return `<div class="tile-grid" style="margin-bottom:1.5rem;">${tiles}</div>`;
}

/* ── ROW 5: Pick Banner ── */
function buildPickSection(game) {
  const sections = game.writeup?.sections ?? [];
  // Use the last section (Final Read / Putting It Together) for the summary
  const finalSection = sections[3]
    || sections.find(s => /putting|together|final|bottom line/i.test(s.heading));
  const summary = finalSection?.body || game.writeup?.pickSummary || game.matchupSummary || "";

  const metsML  = game.moneyline?.mets;
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

/* ── Trends Card (full-width, below pick if present) ── */
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

  // Update hero headline dynamically
  const shortOpp = todayGame.opponent.split(" ").pop();
  const heroEl = document.getElementById("hero-headline");
  if (heroEl) heroEl.textContent = `Today's Edge: NYM vs ${shortOpp}`;

  const container = document.getElementById("today-game-container");
  container.innerHTML =
    buildMatchupStrip(todayGame) +          // Row 1 — matchup header
    buildPitchingCard(todayGame) +          // Row 2 — full-width pitching comparison
    buildRow3(todayGame) +                  // Row 3 — lineups + advanced metrics
    buildAnalysisRow(todayGame) +           // Row 4 — 3 analysis tiles
    buildPickSection(todayGame) +           // Row 5 — pick banner
    buildTrendsCard(todayGame);             // supplemental trends

  document.getElementById("recent-games-container").innerHTML = buildRecentTiles(games);
}

init();
