import METS_2025 from "../data/mets2025.js";

async function loadGameData() {
  const res = await fetch("data/sample-game.json");
  return res.json();
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
  { order: 1, name: "Brandon Nimmo",      pos: "CF", hand: "L", playerId: 607043 },
  { order: 2, name: "Francisco Lindor",   pos: "SS", hand: "S", playerId: 596019 },
  { order: 3, name: "Juan Soto",          pos: "LF", hand: "L", playerId: 665742 },
  { order: 4, name: "Pete Alonso",        pos: "1B", hand: "R", playerId: 624413 },
  { order: 5, name: "Mark Vientos",       pos: "3B", hand: "R", playerId: 668978 },
  { order: 6, name: "Francisco Alvarez",  pos: "C",  hand: "R", playerId: 682628 },
  { order: 7, name: "Starling Marte",     pos: "RF", hand: "R", playerId: 516782 },
  { order: 8, name: "Jeff McNeil",        pos: "2B", hand: "L", playerId: 643446 },
  { order: 9, name: "pitcher slot",       pos: "P",  hand: "-", playerId: null   }
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

function stat2025(val) {
  return `${val} <span class="stat-year">(2025)</span>`;
}

function fallback(liveVal, fallbackVal) {
  return isMissingStat(liveVal) ? stat2025(fallbackVal) : liveVal;
}

/* FIX 2 — bullpen 2025 fallbacks */
function resolveBullpen(bullpenObj, isNYM, oppName) {
  const bp = bullpenObj || {};
  if (isNYM) {
    return {
      era:    fallback(bp.seasonERA,  METS_2025.bullpenERA),
      xfip:   fallback(bp.seasonXFIP, METS_2025.bullpenxFIP),
      last14: fallback(bp.last14ERA,  METS_2025.bullpenERA),
      rating: bp.rating ?? 70
    };
  }
  const oppData = METS_2025.opponents2025?.[oppName];
  return {
    era:    isMissingStat(bp.seasonERA)  ? (oppData?.bullpenERA  ? stat2025(oppData.bullpenERA)  : "N/A") : bp.seasonERA,
    xfip:   bp.seasonXFIP  ?? "N/A",
    last14: bp.last14ERA   ?? "N/A",
    rating: bp.rating ?? 65
  };
}

/* FIX 3 — advanced metrics 2025 fallbacks */
function resolveAdvancedMatchup(game) {
  const oppData = METS_2025.opponents2025?.[game.opponent];
  const live    = game.advancedMatchup || [];

  const get = (i, key) => live[i]?.[key];

  const metsWRC = METS_2025.teamWRC_plus;
  const oppWRC  = oppData?.teamWRC_plus;
  const wrcEdge = (metsWRC && oppWRC && (metsWRC - oppWRC) >= 5) ? "Mets" : "Neutral";

  const resolveRow = (i, metsFallback, oppFallback, edgeFallback) => ({
    category: get(i, "category") || live[i]?.category,
    mets: !isMissingStat(get(i, "mets")) ? get(i, "mets") : stat2025(metsFallback),
    opp:  !isMissingStat(get(i, "opp"))  ? get(i, "opp")  : (oppFallback != null ? stat2025(oppFallback) : "N/A"),
    edge: (get(i, "edge") && get(i, "edge") !== "Neutral") ? get(i, "edge") : edgeFallback
  });

  return [
    resolveRow(0, metsWRC, oppWRC, wrcEdge),
    resolveRow(1, METS_2025.hardHitPct, null, "N/A"),
    resolveRow(2, METS_2025.barrelPct,  null, "N/A"),
    resolveRow(3, METS_2025.bbPct,      null, "N/A"),
    resolveRow(4, METS_2025.kPct,       null, "N/A")
  ];
}

/* ── ROW 1: Matchup Bar ── */
function buildMatchupStrip(game) {
  const oppLogo = getTeamLogoUrl(game.opponent);
  const metsML  = game.moneyline.mets > 0 ? `+${game.moneyline.mets}` : `${game.moneyline.mets}`;
  const oppML   = game.moneyline.opp  > 0 ? `+${game.moneyline.opp}`  : `${game.moneyline.opp}`;

  const gameDate = game.date || "";
  const dateDisplay = gameDate
    ? new Date(gameDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    : "";

  const total = game.total ?? game.overUnder ?? null;
  const ouItem = total != null
    ? `<span class="mb-meta-item"><span>&#x2197;</span> O/U ${total}</span>`
    : "";

  const oppLogoHtml = oppLogo
    ? `<img src="${oppLogo}" alt="${game.opponent}">`
    : `<span style="width:36px;height:36px;display:inline-block;"></span>`;

  return `
    <div class="matchup-bar-compact">
      <div class="mb-team">
        <img src="https://a.espncdn.com/i/teamlogos/mlb/500/nym.png" alt="NYM">
        <div>
          <div class="mb-team-name">New York Mets</div>
          <span class="mb-record">${game.metsRecord}</span>
        </div>
      </div>
      <div class="mb-vs">
        <span class="mb-vs-label">VS</span>
        <span class="mb-vs-time">${game.time}</span>
      </div>
      <div class="mb-team">
        ${oppLogoHtml}
        <div>
          <div class="mb-team-name">${game.opponent}</div>
          <span class="mb-record">${game.oppRecord}</span>
        </div>
      </div>
      <div class="mb-divider"></div>
      <div class="mb-meta">
        ${dateDisplay ? `<span class="mb-meta-item">&#x1F550; ${dateDisplay}</span>` : ""}
        <span class="mb-meta-item">&#x1F4CD; ${game.ballpark}</span>
        <span class="mb-meta-item">$ <span class="mb-ml-nym">NYM ${metsML}</span> / OPP ${oppML}</span>
        ${ouItem}
      </div>
    </div>`;
}

const METS_PITCHER_IDS = {
  "Kodai Senga":       663853,
  "David Peterson":    656945,
  "Sean Manaea":       640455,
  "Clay Holmes":       669203,
  "Griffin Canning":   663158,
  "Jose Quintana":     542432,
  "Luis Severino":     622663,
  "Max Scherzer":      453286,
  "Tylor Megill":      676477,
  "Jose Butto":        683737
};

/* ── ROW 2: Starting Pitching (two-column pitcher card layout) ── */
function buildPitchingCard(game) {
  const p  = game.pitching;
  const mn = p.mets.name;

  // Season stats with 2025 fallbacks for Mets pitcher
  const mERA  = getMetsPitchingStat(p.mets.seasonERA,  mn, "ERA");
  const mFIP  = getMetsPitchingStat(p.mets.seasonFIP,  mn, "FIP");
  const mXERA = getMetsPitchingStat(p.mets.seasonXERA, mn, "xFIP");
  const mWHIP = getMetsPitchingStat(p.mets.seasonWHIP, mn, "WHIP");
  const mKBB  = getMetsPitchingStat(p.mets.last3KBB,   mn, "KBB");
  const mKPct  = p.mets.savant?.kPct  ?? "N/A";
  const mBBPct = p.mets.savant?.bbPct ?? "N/A";

  const oERA  = isMissingStat(p.opp.seasonERA)  ? "N/A" : p.opp.seasonERA;
  const oFIP  = isMissingStat(p.opp.seasonFIP)  ? "N/A" : p.opp.seasonFIP;
  const oXERA = isMissingStat(p.opp.seasonXERA) ? "N/A" : p.opp.seasonXERA;
  const oWHIP = isMissingStat(p.opp.seasonWHIP) ? "N/A" : p.opp.seasonWHIP;
  const oKBB  = isMissingStat(p.opp.last3KBB)   ? "N/A" : p.opp.last3KBB;
  const oKPct  = p.opp.savant?.kPct  ?? "N/A";
  const oBBPct = p.opp.savant?.bbPct ?? "N/A";

  // Bullpen — apply 2025 fallbacks
  const metsBP = resolveBullpen(p.metsBullpen, true,  game.opponent);
  const oppBP  = resolveBullpen(p.oppBullpen,  false, game.opponent);

  // Headshot: rectangular MLB CDN crop, placeholder on failure
  const pitcherPhoto = (mlbId, name) => {
    const id = mlbId || METS_PITCHER_IDS[name] || 0;
    if (!id) return `<div class="pitcher-photo-placeholder">&#9918;</div>`;
    return `<img
      src="https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_200,q_auto:best/v1/people/${id}/headshot/67/current"
      class="pitcher-photo" alt="${name}"
      onerror="this.outerHTML='<div class=&quot;pitcher-photo-placeholder&quot;>&#9918;</div>'">`;
  };

  // xwOBA color class
  const xwobaClass = val => {
    if (val == null) return "";
    if (val < 0.290) return "xwoba-good";
    if (val > 0.340) return "xwoba-bad";
    return "xwoba-neutral";
  };

  // vs. Current Roster table
  const vsRosterTable = vsRoster => {
    if (!vsRoster) {
      return `<table class="matchup-table">
        <caption>vs. Current Roster</caption>
        <tbody><tr><td colspan="10" style="color:#9099b0;font-size:0.85rem;text-align:center;padding:0.75rem 0">No prior matchup data available</td></tr></tbody>
      </table>`;
    }
    const fmt    = v  => v  != null ? v  : "—";
    const fmtPct = v  => v  != null ? `${(v * 100).toFixed(1)}%` : "—";
    const xwClass = xwobaClass(vsRoster.xwOBA);
    return `<table class="matchup-table">
      <caption>vs. Current Roster</caption>
      <thead>
        <tr><th>PA</th><th>K%</th><th>BB%</th><th>AVG</th><th>wOBA</th><th>Exit Velo</th><th>Launch&nbsp;°</th><th>xBA</th><th>xSLG</th><th>xwOBA</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>${fmt(vsRoster.PA)}</td>
          <td>${fmtPct(vsRoster.kPct)}</td>
          <td>${fmtPct(vsRoster.bbPct)}</td>
          <td>${fmt(vsRoster.AVG)}</td>
          <td>${fmt(vsRoster.wOBA)}</td>
          <td>${vsRoster.exitVelo   != null ? vsRoster.exitVelo + " mph" : "—"}</td>
          <td>${vsRoster.launchAngle != null ? vsRoster.launchAngle + "°" : "—"}</td>
          <td>${fmt(vsRoster.xBA)}</td>
          <td>${fmt(vsRoster.xSLG)}</td>
          <td class="${xwClass}">${fmt(vsRoster.xwOBA)}</td>
        </tr>
      </tbody>
    </table>`;
  };

  // Build one pitcher card
  const pitcherCard = (sideLabel, pitcher, seasonStats, vsRoster) => {
    const prow = (label, val) =>
      `<div class="pstat-row"><span class="pstat-label">${label}</span><span class="pstat-val">${val}</span></div>`;

    if (pitcher.announced === false) {
      return `<div class="pitcher-card">
        <div class="pitcher-card-inner">
          <div class="pitcher-photo-placeholder" style="width:80px;height:100px;">&#9918;</div>
          <div class="pitcher-info">
            <div class="pitcher-name-lg">TBD</div>
            <div class="pitcher-meta-line">${sideLabel} &middot; Not yet announced</div>
          </div>
        </div>
        ${vsRosterTable(vsRoster)}
      </div>`;
    }

    const { era, fip, xera, whip, kbb, kpct, bbpct } = seasonStats;
    const hhPct = pitcher.savant?.hardHitPct ?? "N/A";
    const gbPct = pitcher.savant?.gbPct      ?? "N/A";

    const id = pitcher.mlbId || METS_PITCHER_IDS[pitcher.name] || 0;
    const photoHtml = id
      ? `<img class="pitcher-photo-sm"
           src="https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_200,q_auto:best/v1/people/${id}/headshot/67/current"
           alt="${pitcher.name}"
           onerror="this.outerHTML='<div class=&quot;pitcher-photo-placeholder&quot; style=&quot;width:80px;height:100px&quot;>&#9918;</div>'">`
      : `<div class="pitcher-photo-placeholder" style="width:80px;height:100px;">&#9918;</div>`;

    return `<div class="pitcher-card">
      <div class="pitcher-card-inner">
        ${photoHtml}
        <div class="pitcher-info">
          <div class="pitcher-name-lg">${pitcher.name}</div>
          <div class="pitcher-meta-line">${sideLabel} &middot; ${era} ERA</div>
          <div class="pitcher-stats-cols">
            <div class="pitcher-col">
              <div class="pcol-header">TRADITIONAL</div>
              ${prow("ERA",  era)}
              ${prow("WHIP", whip)}
              ${prow("K%",   kpct)}
              ${prow("BB%",  bbpct)}
            </div>
            <div class="pitcher-col">
              <div class="pcol-header advanced">ADVANCED</div>
              ${prow("FIP",       fip)}
              ${prow("xERA",      xera)}
              ${prow("K/BB",      kbb)}
              ${prow("Hard-Hit%", hhPct)}
              ${prow("GB%",       gbPct)}
            </div>
          </div>
        </div>
      </div>
      ${vsRosterTable(vsRoster)}
    </div>`;
  };

  const metsCard = pitcherCard(
    "NYM", p.mets,
    { era: mERA, fip: mFIP, xera: mXERA, whip: mWHIP, kbb: mKBB, kpct: mKPct, bbpct: mBBPct },
    p.mets.vsRoster
  );
  const oppCard = pitcherCard(
    game.opponent, p.opp,
    { era: oERA, fip: oFIP, xera: oXERA, whip: oWHIP, kbb: oKBB, kpct: oKPct, bbpct: oBBPct },
    p.opp.vsRoster
  );

  const statcastSection = (p.mets.savant || p.opp.savant) ? `
    <div class="pitching-table-label">Statcast (2025)</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Pitcher</th><th>xERA</th><th>Barrel%</th><th>Hard-Hit%</th><th>Whiff%</th><th>Chase%</th><th>K%</th><th>BB%</th></tr></thead>
        <tbody>
          <tr>
            <td style="font-weight:600;color:var(--navy)">${p.mets.name}</td>
            <td>${p.mets.savant?.xERA       ?? "N/A"}</td>
            <td>${p.mets.savant?.barrelPct  ?? "N/A"}</td>
            <td>${p.mets.savant?.hardHitPct ?? "N/A"}</td>
            <td>${p.mets.savant?.whiffPct   ?? "N/A"}</td>
            <td>${p.mets.savant?.chasePct   ?? "N/A"}</td>
            <td>${p.mets.savant?.kPct       ?? "N/A"}</td>
            <td>${p.mets.savant?.bbPct      ?? "N/A"}</td>
          </tr>
          <tr>
            <td style="font-weight:600;color:#374151">${p.opp.name}</td>
            <td>${p.opp.savant?.xERA       ?? "N/A"}</td>
            <td>${p.opp.savant?.barrelPct  ?? "N/A"}</td>
            <td>${p.opp.savant?.hardHitPct ?? "N/A"}</td>
            <td>${p.opp.savant?.whiffPct   ?? "N/A"}</td>
            <td>${p.opp.savant?.chasePct   ?? "N/A"}</td>
            <td>${p.opp.savant?.kPct       ?? "N/A"}</td>
            <td>${p.opp.savant?.bbPct      ?? "N/A"}</td>
          </tr>
        </tbody>
      </table>
    </div>` : "";

  return `
    <div class="card full-card">
      <div class="card-header">Starting Pitching</div>
      <div class="pitcher-cards-grid">
        ${metsCard}
        <div class="pitcher-divider"></div>
        ${oppCard}
      </div>
    </div>

    <div class="card full-card">
      <div class="pitching-table-label">Bullpen</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Team</th><th>ERA</th><th>xFIP</th><th>Last 14d ERA</th><th>Rating</th></tr></thead>
          <tbody>
            <tr>
              <td style="font-weight:600;color:var(--orange)">NYM</td>
              <td>${metsBP.era}</td><td>${metsBP.xfip}</td><td>${metsBP.last14}</td><td>${metsBP.rating}/100</td>
            </tr>
            <tr>
              <td style="font-weight:600;color:#9099b0">OPP</td>
              <td>${oppBP.era}</td><td>${oppBP.xfip}</td><td>${oppBP.last14}</td><td>${oppBP.rating}/100</td>
            </tr>
          </tbody>
        </table>
      </div>
      ${statcastSection}
    </div>`;
}

/* ── ROW 3: Lineups + Advanced Metrics ── */
function buildRow3(game) {
  const l = game.lineups || {};
  const notReleased = l.lineupStatus === "not_released";
  const metsLineup = (!notReleased && Array.isArray(l.mets) && l.mets.length > 0) ? l.mets : DEFAULT_METS_LINEUP;
  const oppLineup  = Array.isArray(l.opp) ? l.opp : [];
  const statusLabel = l.lineupStatus === "confirmed" ? "Confirmed" : "Projected";

  // FIX 1: headshot helper — uses playerId if present, falls back to 0 (generic MLB silhouette via Cloudinary d_ param)
  const headshotImg = (p) => {
    const pid = p.playerId || p.id || 0;
    return `<img src="https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_60,q_auto:best/v1/people/${pid}/headshot/67/current" class="player-headshot" alt="${p.name}" onerror="this.style.display='none'">`;
  };

  const metsRows = metsLineup.map(p => `
    <tr>
      <td>${p.order}</td>
      <td class="player-name-cell">${headshotImg(p)}<span style="font-weight:600">${p.name}</span></td>
      <td>${p.pos}</td>
      <td>${getMetsHitterAVG(p)}</td>
      <td>${getMetsHitterSeasonOps(p)}</td>
    </tr>`).join("");

  const oppRows = oppLineup.length > 0
    ? oppLineup.map(p => `
    <tr>
      <td>${p.order}</td>
      <td class="player-name-cell">${headshotImg(p)}<span style="font-weight:600">${p.name}</span></td>
      <td>${p.pos}</td>
      <td>${p.seasonAVG ?? "N/A"}</td>
      <td>${p.seasonOPS ?? "N/A"}</td>
    </tr>`).join("")
    : `<tr><td colspan="5" style="color:#9099b0;text-align:center;padding:1rem">Lineup TBD</td></tr>`;

  // Advanced metrics (col 3) — FIX 3: apply 2025 fallbacks
  const resolvedMetrics = resolveAdvancedMatchup(game);
  const advRows = resolvedMetrics.map(r => {
    const edgeColor = r.edge === "Mets"
      ? "color:var(--orange);font-weight:700"
      : (r.edge === "Neutral" || r.edge === "N/A" || r.edge === "—")
        ? "color:#9099b0"
        : "color:#c0392b;font-weight:700";
    return `<tr>
      <td>${r.category}</td>
      <td>${r.mets}</td>
      <td>${r.opp}</td>
      <td style="${edgeColor}">${r.edge}</td>
    </tr>`;
  }).join("");

  const topEdge = resolvedMetrics.find(r => r.edge === "Mets");
  const edgeCallout = topEdge
    ? `<div class="edge-callout">Key Edge: ${topEdge.category} — NYM ${topEdge.mets} vs OPP ${topEdge.opp}</div>`
    : `<div class="edge-callout neutral">No clear statistical edge identified</div>`;

  const metsBattingBlock = notReleased
    ? `<div class="lineup-pending"><span class="stat-year">📋 Lineup not yet released</span></div>`
    : `<div class="table-wrap"><table>
         <thead><tr><th>#</th><th>Player</th><th>POS</th><th>AVG</th><th>OPS</th></tr></thead>
         <tbody>${metsRows}</tbody>
       </table></div>`;

  const oppBattingBlock = notReleased
    ? `<div class="lineup-pending"><span class="stat-year">📋 Lineup not yet released</span></div>`
    : `<div class="table-wrap"><table>
         <thead><tr><th>#</th><th>Player</th><th>POS</th><th>AVG</th><th>OPS</th></tr></thead>
         <tbody>${oppRows}</tbody>
       </table></div>`;

  return `
    <div class="row-3-grid">
      <div class="card">
        <div class="card-header">${statusLabel} Lineup — Mets</div>
        <div class="lineup-team-header mets-header">New York Mets</div>
        ${metsBattingBlock}
      </div>

      <div class="card">
        <div class="card-header">${statusLabel} Lineup — ${game.opponent}</div>
        <div class="lineup-team-header opp-header">${game.opponent}</div>
        ${oppBattingBlock}
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
  if (!game.writeup?.sections?.length) return "";
  const sections = game.writeup.sections;

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
  // No writeup yet (pre-game day)
  if (!game.writeup) {
    const dateDisplay = game.date
      ? new Date(game.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
      : "";
    return `
      <div class="pick-section pick-pending">
        <p class="pick-summary">Today's analysis and pick will be generated on game day morning.</p>
        <p class="pick-label">📅 Next Game: ${dateDisplay} vs ${game.opponent}</p>
      </div>`;
  }

  const sections = game.writeup.sections ?? [];
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
  const { games, generatedAt } = await loadGameData();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
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

  if (generatedAt) {
    const el = document.getElementById("data-timestamp");
    if (el) {
      const d = new Date(generatedAt);
      el.textContent = "Last updated: " + d.toLocaleString("en-US", {
        timeZone: "America/New_York", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short"
      });
    }
  }
}

init();
