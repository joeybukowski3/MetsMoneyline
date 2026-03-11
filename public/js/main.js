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

function getTeamAbbr(teamName) {
  const slug = ESPN_LOGO[teamName];
  if (slug) return slug.toUpperCase();
  const words = teamName.split(" ");
  return words[words.length - 1].substring(0, 3).toUpperCase();
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
      <div class="mb-teams">
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

/* ── Percentile Engine ──
   Maps a raw stat value to an estimated 0–100 MLB percentile.
   Lower-is-better stats (ERA, WHIP, BB%) are inverted so 100 = best.
   Curves based on 2025 MLB starter distributions. */
const PCTL = {
  // ERA: elite ~2.50 (99th), avg ~4.20 (50th), poor ~5.50 (10th)
  ERA:  v => clamp(Math.round(100 - ((parseFloat(v) - 2.50) / (5.80 - 2.50)) * 90), 5, 99),
  // FIP: elite ~2.80, avg ~4.10, poor ~5.20
  FIP:  v => clamp(Math.round(100 - ((parseFloat(v) - 2.80) / (5.40 - 2.80)) * 90), 5, 99),
  // xERA: similar to FIP
  xERA: v => clamp(Math.round(100 - ((parseFloat(v) - 2.70) / (5.30 - 2.70)) * 90), 5, 99),
  // WHIP: elite ~0.90, avg ~1.28, poor ~1.65
  WHIP: v => clamp(Math.round(100 - ((parseFloat(v) - 0.90) / (1.70 - 0.90)) * 90), 5, 99),
  // K%: elite ~33%, avg ~22%, poor ~13%
  KPct: v => clamp(Math.round(((parseFloat(v) - 10) / (36 - 10)) * 95), 5, 99),
  // BB%: elite ~4%, avg ~8%, poor ~13% — lower is better
  BBPct: v => clamp(Math.round(100 - ((parseFloat(v) - 3.5) / (13.5 - 3.5)) * 90), 5, 99),
  // K/BB: elite ~5.0, avg ~2.8, poor ~1.5
  KBB:  v => clamp(Math.round(((parseFloat(v) - 1.2) / (6.0 - 1.2)) * 95), 5, 99),
  // Hard-Hit%: lower is better for pitcher; elite ~28%, avg ~37%, poor ~45%
  HardHit: v => clamp(Math.round(100 - ((parseFloat(v) - 26) / (47 - 26)) * 90), 5, 99),
  // GB%: higher is generally better; elite ~55%, avg ~43%, poor ~33%
  GB:   v => clamp(Math.round(((parseFloat(v) - 30) / (58 - 30)) * 95), 5, 99),
  // Bullpen ERA: elite ~3.00, avg ~4.00, poor ~5.20
  BPERA: v => clamp(Math.round(100 - ((parseFloat(v) - 2.80) / (5.50 - 2.80)) * 90), 5, 99),
  // Bullpen xFIP: elite ~3.10, avg ~4.00, poor ~5.00
  BPxFIP: v => clamp(Math.round(100 - ((parseFloat(v) - 3.00) / (5.20 - 3.00)) * 90), 5, 99),
  // Rating: direct 0–100
  Rating: v => clamp(Math.round(parseFloat(v)), 0, 100),
};

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/* Color the bar: blue (poor) → gray (avg) → red (elite) */
function pctlColor(pct) {
  if (pct >= 80) return "#c0392b";   // elite red
  if (pct >= 60) return "#e08060";   // good orange-red
  if (pct >= 45) return "#aab8c8";   // avg gray
  if (pct >= 25) return "#5a9fd4";   // below avg blue
  return "#1a6bb5";                  // poor blue
}

/* Build a single stat row with percentile bar */
function statBar(label, rawVal, pctlFn, displayVal) {
  if (rawVal == null || rawVal === "N/A" || rawVal === "") {
    return `<div class="sbar-row">
      <span class="sbar-label">${label}</span>
      <div class="sbar-track"><div class="sbar-fill" style="width:0%"></div></div>
      <span class="sbar-val">N/A</span>
    </div>`;
  }
  const numStr = String(rawVal).replace(/<[^>]*>/g, "").replace("%","").trim();
  const pct    = pctlFn(numStr);
  const color  = pctlColor(pct);
  const shown  = displayVal || rawVal;
  return `<div class="sbar-row">
    <span class="sbar-label">${label}</span>
    <div class="sbar-track">
      <div class="sbar-fill" style="width:${pct}%;background:${color}">
        <span class="sbar-pct">${pct}</span>
      </div>
    </div>
    <span class="sbar-val">${shown}</span>
  </div>`;
}

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

  // vs. Current Roster — colored stat tile grid
  const vsRosterGrid = vsRoster => {
    if (!vsRoster) {
      return `<div style="color:#9099b0;font-size:0.85rem;text-align:center;padding:1.25rem 0">No prior matchup data available</div>`;
    }
    // For pitcher-allowed stats: lower offensive value = better for pitcher = higher pct = red
    const inv = (v, lo, hi) => clamp(Math.round(100 - ((v - lo) / (hi - lo)) * 90), 5, 99);
    const tiles = [
      { label: "PA",        val: vsRoster.PA,          fmt: v => v,                           pct: () => 50 },
      { label: "K%",        val: vsRoster.kPct,        fmt: v => `${(v*100).toFixed(1)}%`,    pct: v => PCTL.KPct(v*100) },
      { label: "BB%",       val: vsRoster.bbPct,       fmt: v => `${(v*100).toFixed(1)}%`,    pct: v => PCTL.BBPct(v*100) },
      { label: "AVG",       val: vsRoster.AVG,         fmt: v => v,                           pct: v => inv(v, 0.160, 0.340) },
      { label: "wOBA",      val: vsRoster.wOBA,        fmt: v => v,                           pct: v => inv(v, 0.240, 0.400) },
      { label: "xwOBA",     val: vsRoster.xwOBA,       fmt: v => v,                           pct: v => inv(v, 0.240, 0.400) },
      { label: "Exit Velo", val: vsRoster.exitVelo,    fmt: v => `${v} mph`,                  pct: v => inv(v, 82, 95) },
      { label: "Launch °",  val: vsRoster.launchAngle, fmt: v => `${v}°`,                     pct: () => 50 },
      { label: "xBA",       val: vsRoster.xBA,         fmt: v => v,                           pct: v => inv(v, 0.170, 0.330) },
      { label: "xSLG",      val: vsRoster.xSLG,        fmt: v => v,                           pct: v => inv(v, 0.280, 0.560) },
    ];
    const tilesHtml = tiles.map(t => {
      if (t.val == null) {
        return `<div class="vsr-tile" style="background:#f0f2f8">
          <div class="vsr-label" style="color:#9099b0">${t.label}</div>
          <div class="vsr-val" style="color:#9099b0">—</div>
        </div>`;
      }
      const pct  = t.pct(t.val);
      const bg   = pct === 50 ? "#e8ecf2" : pctlColor(pct);
      const isColored = pct !== 50;
      const labelColor = isColored ? "rgba(255,255,255,0.72)" : "#9099b0";
      const valColor   = isColored ? "#fff" : "#1a1a2e";
      return `<div class="vsr-tile" style="background:${bg}">
        <div class="vsr-label" style="color:${labelColor}">${t.label}</div>
        <div class="vsr-val" style="color:${valColor}">${t.fmt(t.val)}</div>
      </div>`;
    }).join("");
    return `<div class="vsr-grid">${tilesHtml}</div>`;
  };

  // Build one pitcher card
  const pitcherCard = (sideLabel, pitcher, seasonStats, vsRoster) => {
    const prow = (label, val) =>
      `<div class="pstat-row"><span class="pstat-label">${label}</span><span class="pstat-val">${val}</span></div>`;

    if (pitcher.announced === false) {
      return `<div class="pitcher-card-v2">
        <div class="pitcher-img-panel">
          <div class="pitcher-photo-placeholder">&#9918;</div>
        </div>
        <div class="pitcher-stats-panel">
          <div class="pitcher-name-lg">TBD</div>
          <div class="pitcher-meta-line">${sideLabel} &middot; Not yet announced</div>
        </div>
      </div>`;
    }

    const { era, fip, xera, whip, kbb, kpct, bbpct } = seasonStats;
    const hhPct = pitcher.savant?.hardHitPct ?? null;
    const gbPct = pitcher.savant?.gbPct      ?? null;

    const id = pitcher.mlbId || METS_PITCHER_IDS[pitcher.name] || 0;
    // Action shot URL (larger crop, person standing)
    const photoHtml = id
      ? `<img class="pitcher-photo-sm"
           src="https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:action:hero:current.png/w_360,q_auto:best/v1/people/${id}/action/hero/current"
           alt="${pitcher.name}"
           onerror="this.src='https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_200,q_auto:best/v1/people/${id}/headshot/67/current'">`
      : `<div class="pitcher-photo-placeholder">&#9918;</div>`;

    // Strip HTML tags from stat values for numeric parsing
    const raw = s => String(s).replace(/<[^>]*>/g, "").replace("%","").trim();

    return `<div class="pitcher-card-v2">
      <div class="pitcher-img-panel">
        ${photoHtml}
      </div>
      <div class="pitcher-stats-panel">
        <div class="pitcher-name-row">
          <span class="pitcher-name-lg">${pitcher.name}</span>
          ${pitcher.seasonRecord ? `<span class="pitcher-record-tag">Record ${pitcher.seasonRecord}</span>` : ""}
        </div>
        <div class="pitcher-meta-line">
          <span class="pitcher-team-tag">${sideLabel}</span>
        </div>
        <div class="sbar-section-label">Traditional</div>
        ${statBar("ERA",  raw(era),  PCTL.ERA,  era)}
        ${statBar("WHIP", raw(whip), PCTL.WHIP, whip)}
        ${statBar("K%",   raw(kpct).replace("%",""), PCTL.KPct, kpct)}
        ${statBar("BB%",  raw(bbpct).replace("%",""), PCTL.BBPct, bbpct)}
        <div class="sbar-section-label" style="margin-top:0.6rem">Advanced</div>
        ${statBar("FIP",       raw(fip),  PCTL.FIP,     fip)}
        ${statBar("xERA",      raw(xera), PCTL.xERA,    xera)}
        ${statBar("K/BB",      raw(kbb),  PCTL.KBB,     kbb)}
        ${statBar("Hard-Hit%", hhPct ? raw(hhPct).replace("%","") : null, PCTL.HardHit, hhPct)}
        ${statBar("GB%",       gbPct ? raw(gbPct).replace("%","") : null, PCTL.GB,      gbPct)}
      </div>
    </div>`;
  };

  const metsCard = pitcherCard(
    "NYM", p.mets,
    { era: mERA, fip: mFIP, xera: mXERA, whip: mWHIP, kbb: mKBB, kpct: mKPct, bbpct: mBBPct }
  );
  const oppCard = pitcherCard(
    game.opponent, p.opp,
    { era: oERA, fip: oFIP, xera: oXERA, whip: oWHIP, kbb: oKBB, kpct: oKPct, bbpct: oBBPct }
  );

  const vsRosterSection = `
    <div class="section-floating-label">Career Matchup — vs. Current Roster</div>
    <div class="pitcher-two-col">
      <div class="card full-card">
        <div class="card-header">${p.mets.name} vs ${getTeamAbbr(game.opponent)} Roster</div>
        ${vsRosterGrid(p.mets.vsRoster)}
      </div>
      <div class="card full-card">
        <div class="card-header">${p.opp.name} vs NYM Roster</div>
        ${vsRosterGrid(p.opp.vsRoster)}
      </div>
    </div>`;

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
    <div class="section-floating-label">Starting Pitching (2025)</div>
    <div class="pitcher-two-col">
      ${metsCard}
      ${oppCard}
    </div>
    ${vsRosterSection}

    <div class="section-floating-label">Bullpen</div>
    <div class="pitcher-two-col">
      <div class="card full-card" style="padding:1.25rem">
        <div class="sbar-section-label" style="margin-bottom:0.6rem">NYM Bullpen</div>
        ${statBar("ERA",       metsBP.era?.replace ? metsBP.era.replace(/<[^>]*>/g,"").trim() : metsBP.era,   PCTL.BPERA,  metsBP.era)}
        ${statBar("xFIP",      metsBP.xfip?.replace ? metsBP.xfip.replace(/<[^>]*>/g,"").trim() : metsBP.xfip, PCTL.BPxFIP, metsBP.xfip)}
        ${statBar("Last 14d ERA", metsBP.last14?.replace ? metsBP.last14.replace(/<[^>]*>/g,"").trim() : metsBP.last14, PCTL.BPERA, metsBP.last14)}
        ${statBar("Rating",    String(metsBP.rating), PCTL.Rating, `${metsBP.rating}/100`)}
      </div>
      <div class="card full-card" style="padding:1.25rem">
        <div class="sbar-section-label" style="margin-bottom:0.6rem">${getTeamAbbr(game.opponent)} Bullpen</div>
        ${statBar("ERA",       oppBP.era?.replace ? oppBP.era.replace(/<[^>]*>/g,"").trim() : oppBP.era,   PCTL.BPERA,  oppBP.era)}
        ${statBar("xFIP",      oppBP.xfip?.replace ? oppBP.xfip.replace(/<[^>]*>/g,"").trim() : oppBP.xfip, PCTL.BPxFIP, oppBP.xfip)}
        ${statBar("Last 14d ERA", oppBP.last14?.replace ? oppBP.last14.replace(/<[^>]*>/g,"").trim() : oppBP.last14, PCTL.BPERA, oppBP.last14)}
        ${statBar("Rating",    String(oppBP.rating), PCTL.Rating, `${oppBP.rating}/100`)}
      </div>
    </div>
    ${statcastSection ? `<div class="card full-card">${statcastSection}</div>` : ""}`;
}

/* ── ROW 3: Lineups + Advanced Metrics ── */
function buildRow3(game) {
  const l = game.lineups || {};
  const notReleased = l.lineupStatus === "not_released";
  const metsLineup = (!notReleased && Array.isArray(l.mets) && l.mets.length > 0) ? l.mets : DEFAULT_METS_LINEUP;
  const oppLineup  = Array.isArray(l.opp) ? l.opp : [];
  const statusLabel = l.lineupStatus === "confirmed" ? "Confirmed" : "Projected";
  const oppAbbr = getTeamAbbr(game.opponent);

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

  // Advanced metrics — individual cards with progress bars (matching Lovable design)
  const resolvedMetrics = resolveAdvancedMatchup(game);
  const advCards = resolvedMetrics.map(r => {
    // Extract raw numeric values for progress bar calculation
    const nymRaw = parseFloat(String(r.mets).replace(/<[^>]*>/g, "").trim());
    const oppRaw = parseFloat(String(r.opp).replace(/<[^>]*>/g, "").trim());
    const isKPct = r.category === "K%";
    // For K%, lower is better for NYM. Otherwise higher = better.
    const nymWins = isKPct ? (nymRaw < oppRaw) : (nymRaw > oppRaw);
    // Progress bar widths: scale both relative to the higher value
    const maxVal = Math.max(nymRaw, oppRaw, 0.001);
    const nymPct = Math.min((nymRaw / (maxVal * 1.25)) * 100, 100) || 50;
    const oppPct = Math.min((oppRaw / (maxVal * 1.25)) * 100, 100) || 50;
    return `
      <div class="adv-metric-card">
        <div class="amc-label">${r.category}</div>
        <div class="amc-row">
          <span class="amc-abbr ${nymWins ? "winner" : ""}">NYM</span>
          <span class="amc-val ${nymWins ? "winner" : ""}">${r.mets}</span>
        </div>
        <div class="amc-bar-track">
          <div class="amc-bar-fill ${nymWins ? "win" : "lose"}" style="width:${nymPct.toFixed(1)}%"></div>
        </div>
        <div class="amc-row" style="margin-top:0.5rem">
          <span class="amc-abbr ${!nymWins ? "winner" : ""}">${oppAbbr}</span>
          <span class="amc-val ${!nymWins ? "winner" : ""}">${r.opp}</span>
        </div>
        <div class="amc-bar-track">
          <div class="amc-bar-fill ${!nymWins ? "win" : "lose"}" style="width:${oppPct.toFixed(1)}%"></div>
        </div>
      </div>`;
  }).join("");

  return `
    <div class="section-floating-label">Projected Lineups (2025)</div>
    <div class="lineup-two-col">
      <div class="card full-card">
        <div class="lineup-team-header mets-header">New York Mets</div>
        ${metsBattingBlock}
      </div>
      <div class="card full-card">
        <div class="lineup-team-header opp-header">${game.opponent}</div>
        ${oppBattingBlock}
      </div>
    </div>

    <div class="adv-metrics-section">
      <div class="adv-metrics-header">
        <span class="section-floating-label" style="margin:0">Advanced Metrics (2025)</span>
        <span class="adv-edge-tag">&#x2197; Edge: NYM</span>
      </div>
      <div class="adv-metric-cards-grid">
        ${advCards}
      </div>
    </div>`;
}

/* ── ROW 4: Analysis tiles (3 side-by-side) ── */
function buildAnalysisRow(game) {
  if (!game.writeup?.sections?.length) return "";
  const sections = game.writeup.sections;

  const icons = ["⚔️", "🎯", "📅"];
  const tiles = [0, 1, 2].map(i => {
    const s = sections[i];
    if (!s) return "";
    // Try to extract two key stats from the body text for the bottom grid
    // Fall back to showing nothing if none found
    return `
      <div class="analysis-tile">
        <div class="analysis-tile-title">${s.heading}</div>
        <div class="analysis-advantage">
          <span class="advantage-icon">${icons[i]}</span>
          <span class="advantage-label">Advantage: NYM</span>
        </div>
        <p class="analysis-tile-body">${s.body}</p>
      </div>`;
  }).join("");

  return `
    <div class="section-floating-label">Game Analysis</div>
    <div class="analysis-three-col">${tiles}</div>`;
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
        <div class="pick-badge-rect">
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

  // Update hero headline — three separate lines
  const isToday = todayGame.date === today;
  const vsAt    = todayGame.homeAway === "away" ? "@" : "vs";
  const labelEl   = document.getElementById("hero-game-label");
  const dateEl    = document.getElementById("hero-game-date");
  const matchupEl = document.getElementById("hero-game-matchup");
  if (labelEl)   labelEl.textContent   = isToday ? "Today's Game" : "Next Game";
  if (dateEl && todayGame.date)
    dateEl.textContent = new Date(todayGame.date + "T12:00:00")
      .toLocaleDateString("en-US", { month: "long", day: "numeric" });
  if (matchupEl) matchupEl.textContent = `New York Mets ${vsAt} ${todayGame.opponent}`;

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