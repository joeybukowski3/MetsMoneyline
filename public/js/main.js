async function loadGameData() {
  const res = await fetch("data/sample-game.json");
  const data = await res.json();
  return data.games;
}

function buildMatchupTable(game) {
  return `
    <div class="table-container">
      <h3>Matchup Overview</h3>
      <table>
        <thead><tr><th>Date</th><th>Time</th><th>Ballpark</th><th>Opponent</th><th>Mets</th><th>Opponent</th><th>Moneyline (NYM / OPP)</th></tr></thead>
        <tbody><tr>
          <td>${game.date}</td>
          <td>${game.time}</td>
          <td>${game.ballpark}</td>
          <td>${game.opponent}</td>
          <td>${game.metsRecord}</td>
          <td>${game.oppRecord}</td>
          <td>${game.moneyline.mets > 0 ? "+" : ""}${game.moneyline.mets} / ${game.moneyline.opp > 0 ? "+" : ""}${game.moneyline.opp}</td>
        </tr></tbody>
      </table>
    </div>`;
}

function buildPitchingTable(game) {
  const p = game.pitching;
  return `
    <div class="table-container">
      <h3>Starting Pitching &amp; Bullpens</h3>
      <table>
        <thead><tr><th></th><th>Starter</th><th>Hand</th><th>Season ERA</th><th>FIP</th><th>xERA</th><th>WHIP</th><th>Last 3 ERA</th><th>Last 3 FIP</th><th>K/BB</th></tr></thead>
        <tbody>
          <tr>
            <td><strong>Mets</strong></td>
            <td>${p.mets.name}</td><td>${p.mets.hand}</td>
            <td>${p.mets.seasonERA}</td><td>${p.mets.seasonFIP}</td><td>${p.mets.seasonXERA}</td><td>${p.mets.seasonWHIP}</td>
            <td>${p.mets.last3ERA}</td><td>${p.mets.last3FIP}</td><td>${p.mets.last3KBB}</td>
          </tr>
          <tr>
            <td><strong>Opp</strong></td>
            <td>${p.opp.name}</td><td>${p.opp.hand}</td>
            <td>${p.opp.seasonERA}</td><td>${p.opp.seasonFIP}</td><td>${p.opp.seasonXERA}</td><td>${p.opp.seasonWHIP}</td>
            <td>${p.opp.last3ERA}</td><td>${p.opp.last3FIP}</td><td>${p.opp.last3KBB}</td>
          </tr>
        </tbody>
      </table>
      <table style="margin-top:1px;">
        <thead><tr><th></th><th>Bullpen Season ERA</th><th>Season xFIP</th><th>Last 14d ERA</th><th>Last 3d IP</th><th>Rating</th></tr></thead>
        <tbody>
          <tr>
            <td><strong>Mets</strong></td>
            <td>${p.metsBullpen.seasonERA}</td><td>${p.metsBullpen.seasonXFIP}</td>
            <td>${p.metsBullpen.last14ERA}</td><td>${p.metsBullpen.last3DaysIP}</td>
            <td>${p.metsBullpen.rating}/100</td>
          </tr>
          <tr>
            <td><strong>Opp</strong></td>
            <td>${p.oppBullpen.seasonERA}</td><td>${p.oppBullpen.seasonXFIP}</td>
            <td>${p.oppBullpen.last14ERA}</td><td>${p.oppBullpen.last3DaysIP}</td>
            <td>${p.oppBullpen.rating}/100</td>
          </tr>
        </tbody>
      </table>
    </div>`;
}

function buildLineupsTable(game) {
  const l = game.lineups;
  const statusLabel = l.status === "confirmed" ? "Confirmed Lineups" : "Projected Lineups";
  const metsRows = l.mets.map(p => `<tr><td>${p.order}</td><td>${p.name}</td><td>${p.pos}</td><td>${p.hand}</td><td>${p.seasonOPS}</td><td>${p.last14OPS}</td></tr>`).join("");
  const oppRows = l.opp.map(p => `<tr><td>${p.order}</td><td>${p.name}</td><td>${p.pos}</td><td>${p.hand}</td><td>${p.seasonOPS}</td><td>${p.last14OPS}</td></tr>`).join("");
  return `
    <div class="table-container">
      <h3>${statusLabel}</h3>
      <table>
        <thead><tr><th colspan="6" style="color:var(--mets-orange)">New York Mets</th></tr>
        <tr><th>#</th><th>Player</th><th>Pos</th><th>Hand</th><th>Season OPS</th><th>Last 14d OPS</th></tr></thead>
        <tbody>${metsRows}</tbody>
      </table>
      <table style="margin-top:1px;">
        <thead><tr><th colspan="6">${game.opponent}</th></tr>
        <tr><th>#</th><th>Player</th><th>Pos</th><th>Hand</th><th>Season OPS</th><th>Last 14d OPS</th></tr></thead>
        <tbody>${oppRows}</tbody>
      </table>
    </div>`;
}

function buildAdvancedTable(game) {
  const rows = game.advancedMatchup.map(r => `
    <tr>
      <td>${r.category}</td>
      <td>${r.mets}</td>
      <td>${r.opp}</td>
      <td style="color:${r.edge === "Mets" ? "var(--mets-orange)" : r.edge === "Neutral" ? "#888" : "#c0392b"}">${r.edge}</td>
    </tr>`).join("");
  return `
    <div class="table-container">
      <h3>Advanced Matchup Metrics</h3>
      <table>
        <thead><tr><th>Category</th><th>Mets</th><th>Opponent</th><th>Edge</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function buildTrendsTable(game) {
  const rows = game.trends.map(r => `
    <tr>
      <td>${r.category}</td>
      <td>${r.mets}</td>
      <td>${r.opp}</td>
      <td style="color:${r.edge === "Mets" ? "var(--mets-orange)" : r.edge === "Neutral" ? "#888" : "#c0392b"}">${r.edge}</td>
    </tr>`).join("");
  return `
    <div class="table-container">
      <h3>Schedule &amp; Trend Notes</h3>
      <table>
        <thead><tr><th>Category</th><th>Mets</th><th>Opponent</th><th>Edge</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function buildWriteup(game) {
  const sections = game.writeup.sections.map(s => `
    <h4 style="margin-bottom:8px; color:var(--mets-blue);">${s.heading}</h4>
    <p>${s.body}</p>`).join("");
  return `
    <div class="analysis-writeup">
      <h3>Game Analysis</h3>
      ${sections}
      <p class="official-pick">${game.writeup.officialPick}</p>
    </div>`;
}

function buildRecentTiles(games) {
  const past = games.filter(g => g.status === "final").slice(-5).reverse();
  if (!past.length) return "<p style='color:#666;'>No completed games yet.</p>";
  return past.map(g => `
    <div class="game-tile ${g.result === 'W' ? 'win' : ''}">
      <div style="font-size:0.8rem; color:#666;">${g.date}</div>
      <div style="font-weight:bold;">${g.opponent}</div>
      <div>${g.finalScore || "—"}</div>
      <div style="font-size:0.85rem; color:${g.result === 'W' ? 'var(--mets-orange)' : '#888'}">
        ${g.result === 'W' ? 'Mets Win' : 'See the breakdown'}
      </div>
    </div>`).join("");
}

async function init() {
  const games = await loadGameData();
  const today = new Date().toISOString().split("T")[0];
  const todayGame = games.find(g => g.date >= today && g.status === "upcoming")
    || games.find(g => g.status === "upcoming")
    || games[0];

  const container = document.getElementById("today-game-container");
  container.innerHTML =
    buildMatchupTable(todayGame) +
    buildPitchingTable(todayGame) +
    buildLineupsTable(todayGame) +
    buildAdvancedTable(todayGame) +
    buildTrendsTable(todayGame) +
    buildWriteup(todayGame);

  document.getElementById("recent-games-container").innerHTML = buildRecentTiles(games);
}

init();
