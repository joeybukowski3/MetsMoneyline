import { getTeamLogoUrl } from "./team-logo-helper.js";

const ADVANCED_STATS_SEASON = 2026;
const TEAM_ID = 121;
const EASTERN_TIME_ZONE = "America/New_York";

function getPageSeason() {
  return ADVANCED_STATS_SEASON;
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

function isValidSeasonValue(value, season) {
  return Number(value) === Number(season);
}

function getStatSeason(statBlock) {
  return statBlock?.splits?.[0]?.season || null;
}

function ensureOverviewSeason(overview, season) {
  if (!isValidSeasonValue(overview?.season, season)) {
    throw new Error(`Overview season mismatch: expected ${season}, got ${overview?.season ?? "unknown"}`);
  }

  const seasonBlocks = [
    ...(overview?.teamStats || []),
    ...(overview?.hitters || []).map((entry) => entry?.person?.stats?.[0] || null),
    ...(overview?.pitchers || []).map((entry) => entry?.person?.stats?.[0] || null)
  ].filter(Boolean);

  for (const block of seasonBlocks) {
    const blockSeason = getStatSeason(block);
    if (blockSeason != null && !isValidSeasonValue(blockSeason, season)) {
      throw new Error(`Overview contains non-${season} stat splits`);
    }
  }
}

function emptyStandingsState(season, reason = "Current-season standings are unavailable.") {
  return {
    season,
    source: "unavailable",
    unavailableReason: reason,
    mets: null,
    nlEast: [],
    nlFull: []
  };
}

function isValidRecordString(value) {
  return /^\d+-\d+$/.test(String(value || "").trim());
}

function selectFeaturedGame(games = [], season = ADVANCED_STATS_SEASON) {
  const targetGames = (games || []).filter((game) => String(game?.date || "").startsWith(`${season}-`));
  if (!targetGames.length) return null;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: EASTERN_TIME_ZONE });
  const sorted = [...targetGames].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  return sorted.find((game) => game.date === today)
    || sorted.find((game) => game.date > today)
    || [...sorted].reverse().find((game) => game.date < today)
    || sorted[0]
    || null;
}

async function loadMatchupSnapshot(season) {
  try {
    const data = await fetchJson("data/sample-game.json");
    const featuredGame = selectFeaturedGame(data?.games || [], season);
    if (!featuredGame) return { generatedAt: data?.generatedAt || null, featuredGame: null };
    const recentGames = featuredGame.gameContext?.metsRecentGames || [];
    let streak = null;
    if (recentGames.length && ["W", "L"].includes(recentGames[0]?.result)) {
      const result = recentGames[0].result;
      let count = 0;
      for (const game of recentGames) {
        if (game?.result !== result) break;
        count += 1;
      }
      streak = `${result}${count}`;
    }
    return {
      generatedAt: data?.generatedAt || null,
      featuredGame: {
        metsRecord: featuredGame.metsRecord,
        homeRoad: featuredGame.trends?.find((trend) => trend.category === "Home/Road")?.mets || null,
        last10: featuredGame.trends?.find((trend) => trend.category === "Last 10 Games")?.mets || null,
        streak
      }
    };
  } catch {
    return { generatedAt: null, featuredGame: null };
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

function collectNodes(node, out = []) {
  if (!node || typeof node !== "object") return out;
  out.push(node);
  for (const child of node.children || []) collectNodes(child, out);
  return out;
}

function parseEspnStandings(data) {
  const nodes = collectNodes(data);
  const nlLeague = nodes.find((node) => /national\s+league/i.test(node?.name || ""));
  if (!nlLeague) throw new Error("ESPN: NL data not found");

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

  const divisions = collectNodes(nlLeague)
    .filter((node) => Array.isArray(node?.standings?.entries) && node.standings.entries.length > 0)
    .filter((node) => /east|central|west/i.test(node?.name || ""));

  if (!divisions.length) throw new Error("ESPN: NL division tables not found");

  const nlEastDiv = divisions.find(d => /east/i.test(d.name));
  const nlEast    = (nlEastDiv?.standings?.entries || []).map(parseTeam);
  const nlFull    = divisions.map(div => ({
    divisionName: div.name,
    teams: (div.standings?.entries || []).map(parseTeam)
  }));

  const metsData = nlEast.find(t => t.team === "New York Mets");
  return {
    season: Number(data?.season?.year || data?.season || ADVANCED_STATS_SEASON),
    source: "espn",
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
    const espn = await loadEspnStandings(season);
    if (!isValidSeasonValue(espn?.season, season)) {
      throw new Error(`ESPN returned season ${espn?.season ?? "unknown"}`);
    }
    if (!espn.nlEast.length || !espn.nlFull.length) {
      throw new Error("ESPN returned an incomplete NL standings table");
    }
    return espn;
  } catch (espnErr) {
    console.warn(`[advanced-stats] ESPN standings failed: ${espnErr.message}`);
  }

  try {
    const data = await fetchJsonWithFallback(
      "api/mlb/mets/standings",
      "api/mlb/mets/standings.json"
    );
    const provider = String(data?.meta?.provider || "").toLowerCase();
    const teams = Array.isArray(data?.teams) ? data.teams : [];

    if (!isValidSeasonValue(data?.season, season)) {
      throw new Error(`Cached standings season mismatch: expected ${season}, got ${data?.season ?? "unknown"}`);
    }
    if (provider.includes("fallback-2025")) {
      throw new Error("Cached standings are a previous-season fallback");
    }
    if (!teams.length) {
      throw new Error("Cached standings are empty");
    }

    const divisions = new Map();
    for (const team of teams) {
      const divisionName = team.division || data?.division || "NL East";
      if (!divisions.has(divisionName)) divisions.set(divisionName, []);
      divisions.get(divisionName).push({
        team: team.team,
        wins: team.wins,
        losses: team.losses,
        pct: team.pct,
        gamesBack: team.gamesBack,
        home: team.home,
        road: team.road,
        last10: team.last10,
        streak: team.streak
      });
    }

    const nlFull = [...divisions.entries()].map(([divisionName, divisionTeams]) => ({
      divisionName,
      teams: divisionTeams
    }));
    const nlEast = nlFull.find((division) => /east/i.test(division.divisionName))?.teams || [];
    const metsRaw = teams.find((team) => String(team.teamId) === String(TEAM_ID) || team.team === "New York Mets") || null;

    if (!nlEast.length || !nlFull.length) {
      throw new Error("Cached standings payload is incomplete");
    }

    return {
      season,
      source: "api-cache",
      mets: metsRaw ? buildMetsStanding(metsRaw) : null,
      nlEast,
      nlFull
    };
  } catch (cacheErr) {
    console.warn(`[advanced-stats] cached standings rejected: ${cacheErr.message}`);
    return emptyStandingsState(season, "2026 standings are unavailable from the current sources.");
  }
}

// ── League averages ──────────────────────────────────────────────────────────

async function loadLeagueAverages(season) {
  try {
    const url = `https://statsapi.mlb.com/api/v1/teams/stats?stats=season&group=hitting,pitching,fielding&season=${season}&sportId=1`;
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
    const fSplits = statsArr.find(s => s.group?.displayName === "fielding")?.splits || [];

    return {
      averages: {
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
          }),
          homeRuns: mean(hSplits, "homeRuns"),
          stolenBases: mean(hSplits, "stolenBases")
        },
        pitching: {
          era:  mean(pSplits, "era"),
          whip: mean(pSplits, "whip"),
          k9:   mean(pSplits, "strikeoutsPer9Inn"),
          bb9:  mean(pSplits, "walksPer9Inn"),
          h9:   mean(pSplits, "hitsPer9Inn"),
          hr9:  mean(pSplits, "homeRunsPer9"),
          saves: mean(pSplits, "saves"),
          holds: mean(pSplits, "holds"),
          inningsPitched: meanRate(pSplits, s => parseFloat(s.stat?.inningsPitched))
        },
        fielding: {
          fielding: mean(fSplits, "fielding"),
          errors: mean(fSplits, "errors"),
          doublePlays: mean(fSplits, "doublePlays"),
          assists: mean(fSplits, "assists"),
          putOuts: mean(fSplits, "putOuts"),
          stolenBases: mean(fSplits, "stolenBases"),
          caughtStealing: mean(fSplits, "caughtStealing")
        }
      },
      ranks: {
        hitting: {
          avg: buildRankMap(hSplits, s => parseFloat(s.stat?.avg), { higherBetter: true }).get(TEAM_ID) ?? null,
          obp: buildRankMap(hSplits, s => parseFloat(s.stat?.obp), { higherBetter: true }).get(TEAM_ID) ?? null,
          slg: buildRankMap(hSplits, s => parseFloat(s.stat?.slg), { higherBetter: true }).get(TEAM_ID) ?? null,
          ops: buildRankMap(hSplits, s => parseFloat(s.stat?.ops), { higherBetter: true }).get(TEAM_ID) ?? null,
          runsPerGame: buildRankMap(hSplits, s => {
            const r = Number(s.stat?.runs);
            const g = Number(s.stat?.gamesPlayed);
            return g > 0 ? r / g : null;
          }, { higherBetter: true }).get(TEAM_ID) ?? null,
          homeRuns: buildRankMap(hSplits, s => Number(s.stat?.homeRuns), { higherBetter: true }).get(TEAM_ID) ?? null,
          stolenBases: buildRankMap(hSplits, s => Number(s.stat?.stolenBases), { higherBetter: true }).get(TEAM_ID) ?? null,
          bbPct: buildRankMap(hSplits, s => {
            const bb = Number(s.stat?.baseOnBalls);
            const pa = Number(s.stat?.plateAppearances);
            return pa > 0 ? bb / pa : null;
          }, { higherBetter: true }).get(TEAM_ID) ?? null,
          kPct: buildRankMap(hSplits, s => {
            const k = Number(s.stat?.strikeOuts);
            const pa = Number(s.stat?.plateAppearances);
            return pa > 0 ? k / pa : null;
          }, { higherBetter: false }).get(TEAM_ID) ?? null
        },
        pitching: {
          era: buildRankMap(pSplits, s => parseFloat(s.stat?.era), { higherBetter: false }).get(TEAM_ID) ?? null,
          whip: buildRankMap(pSplits, s => parseFloat(s.stat?.whip), { higherBetter: false }).get(TEAM_ID) ?? null,
          k9: buildRankMap(pSplits, s => parseFloat(s.stat?.strikeoutsPer9Inn), { higherBetter: true }).get(TEAM_ID) ?? null,
          bb9: buildRankMap(pSplits, s => parseFloat(s.stat?.walksPer9Inn), { higherBetter: false }).get(TEAM_ID) ?? null,
          h9: buildRankMap(pSplits, s => parseFloat(s.stat?.hitsPer9Inn), { higherBetter: false }).get(TEAM_ID) ?? null,
          hr9: buildRankMap(pSplits, s => parseFloat(s.stat?.homeRunsPer9), { higherBetter: false }).get(TEAM_ID) ?? null,
          saves: buildRankMap(pSplits, s => Number(s.stat?.saves), { higherBetter: true }).get(TEAM_ID) ?? null,
          holds: buildRankMap(pSplits, s => Number(s.stat?.holds), { higherBetter: true }).get(TEAM_ID) ?? null,
          inningsPitched: buildRankMap(pSplits, s => parseFloat(s.stat?.inningsPitched), { higherBetter: true }).get(TEAM_ID) ?? null
        },
        fielding: {
          fielding: buildRankMap(fSplits, s => parseFloat(s.stat?.fielding), { higherBetter: true }).get(TEAM_ID) ?? null,
          errors: buildRankMap(fSplits, s => Number(s.stat?.errors), { higherBetter: false }).get(TEAM_ID) ?? null,
          doublePlays: buildRankMap(fSplits, s => Number(s.stat?.doublePlays), { higherBetter: true }).get(TEAM_ID) ?? null,
          assists: buildRankMap(fSplits, s => Number(s.stat?.assists), { higherBetter: true }).get(TEAM_ID) ?? null,
          putOuts: buildRankMap(fSplits, s => Number(s.stat?.putOuts), { higherBetter: true }).get(TEAM_ID) ?? null,
          stolenBases: buildRankMap(fSplits, s => Number(s.stat?.stolenBases), { higherBetter: false }).get(TEAM_ID) ?? null,
          caughtStealing: buildRankMap(fSplits, s => Number(s.stat?.caughtStealing), { higherBetter: true }).get(TEAM_ID) ?? null
        }
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

async function loadSeasonGameLog(teamId, season) {
  const startDate = `${season}-03-01`;
  const endDate = `${season}-11-30`;
  const data = await fetchJson(
    `https://statsapi.mlb.com/api/v1/schedule?teamId=${teamId}&sportId=1&gameType=R&startDate=${startDate}&endDate=${endDate}`
  );
  return (data?.dates || [])
    .flatMap((dateEntry) => (dateEntry.games || []).map((game) => {
      const isHome = Number(game?.teams?.home?.team?.id) === Number(teamId);
      const teamSide = isHome ? game?.teams?.home : game?.teams?.away;
      const oppSide = isHome ? game?.teams?.away : game?.teams?.home;
      const finalLike = ["Final", "Game Over", "Completed Early"].includes(String(game?.status?.detailedState || ""));
      const teamScore = Number(teamSide?.score);
      const oppScore = Number(oppSide?.score);
      return {
        date: game?.officialDate || dateEntry?.date || null,
        isHome,
        status: finalLike ? "final" : "scheduled",
        runsFor: Number.isFinite(teamScore) ? teamScore : null,
        runsAgainst: Number.isFinite(oppScore) ? oppScore : null,
        result: finalLike && Number.isFinite(teamScore) && Number.isFinite(oppScore)
          ? (teamScore > oppScore ? "W" : "L")
          : null
      };
    }));
}

function buildSeasonSummaryFromGames(games = []) {
  const completed = (games || [])
    .filter((game) => game?.status === "final" && Number.isFinite(game?.runsFor) && Number.isFinite(game?.runsAgainst))
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

  if (!completed.length) {
    return {
      record: null,
      runDifferential: null,
      home: null,
      road: null,
      last10: null,
      streak: null
    };
  }

  let wins = 0;
  let losses = 0;
  let homeWins = 0;
  let homeLosses = 0;
  let roadWins = 0;
  let roadLosses = 0;
  let runsFor = 0;
  let runsAgainst = 0;

  for (const game of completed) {
    runsFor += Number(game.runsFor || 0);
    runsAgainst += Number(game.runsAgainst || 0);
    if (game.result === "W") {
      wins += 1;
      if (game.isHome) homeWins += 1;
      else roadWins += 1;
    } else if (game.result === "L") {
      losses += 1;
      if (game.isHome) homeLosses += 1;
      else roadLosses += 1;
    }
  }

  const last10Games = completed.slice(-10);
  const last10Wins = last10Games.filter((game) => game.result === "W").length;
  const last10Losses = last10Games.filter((game) => game.result === "L").length;
  const latestResult = completed[completed.length - 1]?.result || null;
  let streakCount = 0;
  for (let i = completed.length - 1; i >= 0; i -= 1) {
    if (completed[i]?.result !== latestResult) break;
    streakCount += 1;
  }

  return {
    record: `${wins}-${losses}`,
    runDifferential: runsFor - runsAgainst,
    home: `${homeWins}-${homeLosses}`,
    road: `${roadWins}-${roadLosses}`,
    last10: `${last10Wins}-${last10Losses}`,
    streak: latestResult && streakCount ? `${latestResult}${streakCount}` : null
  };
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

function formatRunDiff(value) {
  if (!Number.isFinite(value)) return "—";
  if (value > 0) return `+${value}`;
  return String(value);
}

function formatStrikeoutWalkRatio(stats) {
  const ratio = stats?.strikeoutWalkRatio;
  if (ratio != null && ratio !== "" && ratio !== "-.--" && ratio !== ".---") {
    return formatDecimal(ratio);
  }

  const strikeouts = Number(stats?.strikeOuts);
  const walks = Number(stats?.baseOnBalls);
  if (!Number.isFinite(strikeouts) || !Number.isFinite(walks)) return "N/A";
  if (walks === 0) return strikeouts.toFixed(1);
  return formatDecimal(strikeouts / walks);
}

function parseComparableNumber(value) {
  if (value == null || value === "" || value === "N/A" || value === "—" || value === ".---" || value === "-.--") return null;
  const numeric = parseFloat(String(value).replace("%", ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function averageComparable(values) {
  const nums = values.map(parseComparableNumber).filter(value => value != null);
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function buildRankMap(splits, extractor, { higherBetter = true } = {}) {
  const ranked = (splits || [])
    .map((split) => ({
      teamId: split?.team?.id,
      value: extractor(split)
    }))
    .filter((entry) => Number.isFinite(entry.teamId) && Number.isFinite(entry.value))
    .sort((a, b) => higherBetter ? b.value - a.value : a.value - b.value);

  const rankMap = new Map();
  ranked.forEach((entry, index) => {
    if (!rankMap.has(entry.teamId)) rankMap.set(entry.teamId, index + 1);
  });
  return rankMap;
}

function buildMetricTone(subjectRaw, baselineRaw, higherIsBetter) {
  const subject = parseComparableNumber(subjectRaw);
  const baseline = parseComparableNumber(baselineRaw);
  if (subject == null || baseline == null || baseline === 0) {
    return { style: "", color: "#111827" };
  }

  const diff = higherIsBetter ? (subject - baseline) : (baseline - subject);
  const distance = Math.abs(subject - baseline) / Math.max(Math.abs(baseline), 1);
  const neutralFloor = 0.03;
  const scaled = distance <= neutralFloor ? 0 : Math.min(1, (distance - neutralFloor) / 0.32);
  if (scaled === 0) {
    return {
      style: "background:rgba(148,163,184,0.03);",
      color: "#111827"
    };
  }

  const alpha = 0.05 + (scaled * 0.2);
  return diff >= 0
    ? { style: `background:rgba(192,57,43,${alpha.toFixed(3)});`, color: "#9f2a1d" }
    : { style: `background:rgba(37,99,235,${alpha.toFixed(3)});`, color: "#1d4ed8" };
}

function buildComparisonCell(display, subjectRaw, baselineRaw, higherIsBetter, rank = null) {
  const tone = buildMetricTone(subjectRaw, baselineRaw, higherIsBetter);
  const rankHtml = Number.isFinite(rank) ? `<span class="stat-rank">(#${rank} MLB)</span>` : "";
  return `<td style="${tone.style}"><span class="stat-value-stack"><strong style="color:${tone.color};">${display}</strong>${rankHtml}</span></td>`;
}

function buildPlayerCell(display, subjectRaw, baselineRaw, higherIsBetter) {
  const tone = buildMetricTone(subjectRaw, baselineRaw, higherIsBetter);
  return `<td style="${tone.style};color:${tone.color};">${display}</td>`;
}

function compareAgainstAverage(players, accessor) {
  return averageComparable(players.map(accessor));
}

function playerRateBase(player, numeratorKey, denominatorKey) {
  const stats = player.stats || {};
  const numerator = Number(stats[numeratorKey]);
  const denominator = Number(stats[denominatorKey]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return (numerator / denominator) * 100;
}

function renderUnavailableMessage(colspan, message) {
  return `<tr><td colspan="${colspan}" style="color:#9099b0;padding:1rem;text-align:center">${message}</td></tr>`;
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

function renderAtAGlance(metsStanding, matchupSnapshot = null, seasonSummary = null) {
  const snapshotRecord = isValidRecordString(matchupSnapshot?.metsRecord) ? matchupSnapshot.metsRecord : null;
  const homeRoadText = String(matchupSnapshot?.homeRoad || "");
  const snapshotHome = /^Home\s+/i.test(homeRoadText) ? homeRoadText.replace(/^Home\s+/i, "") : null;
  const snapshotRoad = /^Road\s+/i.test(homeRoadText) ? homeRoadText.replace(/^Road\s+/i, "") : null;
  const snapshotLast10 = isValidRecordString(matchupSnapshot?.last10) ? matchupSnapshot.last10 : null;
  const snapshotStreak = matchupSnapshot?.streak || null;
  const derivedRecord = isValidRecordString(seasonSummary?.record) ? seasonSummary.record : null;
  const derivedHome = isValidRecordString(seasonSummary?.home) ? seasonSummary.home : null;
  const derivedRoad = isValidRecordString(seasonSummary?.road) ? seasonSummary.road : null;
  const derivedLast10 = isValidRecordString(seasonSummary?.last10) ? seasonSummary.last10 : null;
  const derivedStreak = seasonSummary?.streak || null;
  const derivedRunDiff = Number.isFinite(seasonSummary?.runDifferential) ? seasonSummary.runDifferential : null;

  if (!metsStanding) {
    renderRows("at-a-glance", [
      `<div class="glance-item"><div class="glance-label">Record</div><div class="glance-value highlight">${derivedRecord || snapshotRecord || "2026 only"}</div></div>`,
      `<div class="glance-item"><div class="glance-label">Run Diff</div><div class="glance-value">${formatRunDiff(derivedRunDiff)}</div></div>`,
      `<div class="glance-item"><div class="glance-label">Home</div><div class="glance-value">${derivedHome || snapshotHome || "—"}</div></div>`,
      `<div class="glance-item"><div class="glance-label">Road</div><div class="glance-value">${derivedRoad || snapshotRoad || "—"}</div></div>`,
      `<div class="glance-item"><div class="glance-label">Last 10</div><div class="glance-value">${derivedLast10 || snapshotLast10 || "—"}</div></div>`,
      `<div class="glance-item"><div class="glance-label">Streak</div><div class="glance-value">${derivedStreak || snapshotStreak || "Unavailable"}</div></div>`
    ]);
    return;
  }

  const standingRecord = `${metsStanding.wins}-${metsStanding.losses}`;
  const homeRecord = splitRecord(metsStanding, "home");
  const roadRecord = splitRecord(metsStanding, "away");
  const last10Record = splitRecord(metsStanding, "lastTen");
  const standingStreak = metsStanding.streak?.streakCode || "-";
  const standingRunDiff = Number.isFinite(metsStanding.runDifferential) ? metsStanding.runDifferential : null;

  const items = [
    { label: "Record",   value: isValidRecordString(standingRecord) ? standingRecord : (derivedRecord || snapshotRecord || "—"), highlight: true },
    { label: "Run Diff", value: formatRunDiff(derivedRunDiff ?? standingRunDiff) },
    { label: "Home",     value: homeRecord !== "0-0" ? homeRecord : (derivedHome || snapshotHome || "—") },
    { label: "Road",     value: roadRecord !== "0-0" ? roadRecord : (derivedRoad || snapshotRoad || "—") },
    { label: "Last 10",  value: last10Record !== "0-0" ? last10Record : (derivedLast10 || snapshotLast10 || "—") },
    { label: "Streak",   value: standingStreak !== "-" ? standingStreak : (derivedStreak || snapshotStreak || "—") }
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
  const lh = leagueAvg?.averages?.hitting  || null;
  const lp = leagueAvg?.averages?.pitching || null;
  const lf = leagueAvg?.averages?.fielding || null;
  const rh = leagueAvg?.ranks?.hitting || {};
  const rp = leagueAvg?.ranks?.pitching || {};
  const rf = leagueAvg?.ranks?.fielding || {};
  const noAvg = leagueAvg != null ? "—" : `${season} only`;

  function fmtLgPct(v)  { return v != null ? formatPct(v)           : noAvg; }
  function fmtLgDec(v)  { return v != null ? formatDecimal(v)       : noAvg; }
  function fmtLgRate(v) { return v != null ? `${(v * 100).toFixed(1)}%` : noAvg; }
  function fmtLgNum(v)  { return v != null ? formatDecimal(v, 1)    : noAvg; }

  const metsRPG    = Number(hitting.gamesPlayed) > 0 ? Number(hitting.runs)         / Number(hitting.gamesPlayed)        : null;
  const metsBBPct  = Number(hitting.plateAppearances) > 0 ? Number(hitting.baseOnBalls) / Number(hitting.plateAppearances) : null;
  const metsKPct   = Number(hitting.plateAppearances) > 0 ? Number(hitting.strikeOuts)  / Number(hitting.plateAppearances) : null;

  function row(label, value, lgDisplay, metsRaw, lgRaw, higherBetter, rank = null) {
    return `<tr><td>${label}</td>${buildComparisonCell(value, metsRaw, lgRaw, higherBetter, rank)}<td>${lgDisplay}</td></tr>`;
  }

  renderRows("offense-body", [
    row("AVG",      formatPct(hitting.avg),                                    fmtLgPct(lh?.avg),         parseFloat(hitting.avg),  lh?.avg,         true, rh.avg),
    row("OBP",      formatPct(hitting.obp),                                    fmtLgPct(lh?.obp),         parseFloat(hitting.obp),  lh?.obp,         true, rh.obp),
    row("SLG",      formatPct(hitting.slg),                                    fmtLgPct(lh?.slg),         parseFloat(hitting.slg),  lh?.slg,         true, rh.slg),
    row("OPS",      formatPct(hitting.ops),                                    fmtLgPct(lh?.ops),         parseFloat(hitting.ops),  lh?.ops,         true, rh.ops),
    row("Runs / G", formatPerGame(hitting.runs, hitting.gamesPlayed),          fmtLgDec(lh?.runsPerGame), metsRPG,                  lh?.runsPerGame, true, rh.runsPerGame),
    row("HR",       hitting.homeRuns ?? "0",                                   fmtLgNum(lh?.homeRuns),    hitting.homeRuns,         lh?.homeRuns,    true, rh.homeRuns),
    row("SB",       hitting.stolenBases ?? "0",                                fmtLgNum(lh?.stolenBases), hitting.stolenBases,      lh?.stolenBases, true, rh.stolenBases),
    row("BB%",      formatRate(hitting.baseOnBalls,  hitting.plateAppearances),fmtLgRate(lh?.bbPct),      metsBBPct,               lh?.bbPct,       true, rh.bbPct),
    row("K%",       formatRate(hitting.strikeOuts,   hitting.plateAppearances),fmtLgRate(lh?.kPct),       metsKPct,                lh?.kPct,        false, rh.kPct)
  ]);

  renderRows("pitching-body", [
    row("ERA",    formatDecimal(pitching.era),               fmtLgDec(lp?.era),            parseFloat(pitching.era),               lp?.era,            false, rp.era),
    row("WHIP",   formatDecimal(pitching.whip),              fmtLgDec(lp?.whip),           parseFloat(pitching.whip),              lp?.whip,           false, rp.whip),
    row("K / 9",  formatDecimal(pitching.strikeoutsPer9Inn), fmtLgDec(lp?.k9),             parseFloat(pitching.strikeoutsPer9Inn), lp?.k9,             true, rp.k9),
    row("BB / 9", formatDecimal(pitching.walksPer9Inn),      fmtLgDec(lp?.bb9),            parseFloat(pitching.walksPer9Inn),      lp?.bb9,            false, rp.bb9),
    row("H / 9",  formatDecimal(pitching.hitsPer9Inn),       fmtLgDec(lp?.h9),             parseFloat(pitching.hitsPer9Inn),       lp?.h9,             false, rp.h9),
    row("HR / 9", formatDecimal(pitching.homeRunsPer9),      fmtLgDec(lp?.hr9),            parseFloat(pitching.homeRunsPer9),      lp?.hr9,            false, rp.hr9),
    row("Saves",  pitching.saves  ?? "0",                    fmtLgNum(lp?.saves),          pitching.saves,                         lp?.saves,          true, rp.saves),
    row("Holds",  pitching.holds  ?? "0",                    fmtLgNum(lp?.holds),          pitching.holds,                         lp?.holds,          true, rp.holds),
    row("IP",     pitching.inningsPitched || "0.0",          fmtLgNum(lp?.inningsPitched), parseFloat(pitching.inningsPitched),    lp?.inningsPitched, true, rp.inningsPitched)
  ]);

  renderRows("defense-body", [
    row("Fielding %", formatPct(fielding.fielding), fmtLgPct(lf?.fielding), fielding.fielding, lf?.fielding, true, rf.fielding),
    row("Errors", fielding.errors ?? "0", fmtLgNum(lf?.errors), fielding.errors, lf?.errors, false, rf.errors),
    row("Double Plays", fielding.doublePlays ?? "0", fmtLgNum(lf?.doublePlays), fielding.doublePlays, lf?.doublePlays, true, rf.doublePlays),
    row("Assists", fielding.assists ?? "0", fmtLgNum(lf?.assists), fielding.assists, lf?.assists, true, rf.assists),
    row("Putouts", fielding.putOuts ?? "0", fmtLgNum(lf?.putOuts), fielding.putOuts, lf?.putOuts, true, rf.putOuts),
    row("SB Allowed", fielding.stolenBases ?? "0", fmtLgNum(lf?.stolenBases), fielding.stolenBases, lf?.stolenBases, false, rf.stolenBases),
    row("CS", fielding.caughtStealing ?? "0", fmtLgNum(lf?.caughtStealing), fielding.caughtStealing, lf?.caughtStealing, true, rf.caughtStealing)
  ]);
}

// ── Render: hitters / pitchers ───────────────────────────────────────────────

function renderHitters(players, season) {
  const hitters = players
    .filter(p => p.position !== "P")
    .sort((a, b) => (Number(b.stats?.plateAppearances || 0) - Number(a.stats?.plateAppearances || 0)) || a.name.localeCompare(b.name));

  const baselines = {
    avg: compareAgainstAverage(hitters, player => player.stats?.avg),
    obp: compareAgainstAverage(hitters, player => player.stats?.obp),
    ops: compareAgainstAverage(hitters, player => player.stats?.ops),
    homeRuns: compareAgainstAverage(hitters, player => player.stats?.homeRuns),
    rbi: compareAgainstAverage(hitters, player => player.stats?.rbi),
    bbPct: compareAgainstAverage(hitters, player => playerRateBase(player, "baseOnBalls", "plateAppearances")),
    kPct: compareAgainstAverage(hitters, player => playerRateBase(player, "strikeOuts", "plateAppearances"))
  };

  renderRows("hitters-body", hitters.map(player => {
    const s = player.stats || {};
    const bbPct = playerRateBase(player, "baseOnBalls", "plateAppearances");
    const kPct = playerRateBase(player, "strikeOuts", "plateAppearances");
    return `
      <tr>
        <td><div class="player-name-td"><img src="${headshotUrl(player.id)}" class="player-row-headshot" alt="${player.name}" onerror="this.style.display='none'"><strong>${player.name}</strong></div></td>
        <td>${player.position || "-"}</td>
        ${buildPlayerCell(formatPct(s.avg), s.avg, baselines.avg, true)}
        ${buildPlayerCell(formatPct(s.obp), s.obp, baselines.obp, true)}
        ${buildPlayerCell(formatPct(s.ops), s.ops, baselines.ops, true)}
        ${buildPlayerCell(s.homeRuns ?? 0, s.homeRuns, baselines.homeRuns, true)}
        ${buildPlayerCell(s.rbi ?? 0, s.rbi, baselines.rbi, true)}
        ${buildPlayerCell(formatRate(s.baseOnBalls, s.plateAppearances), bbPct, baselines.bbPct, true)}
        ${buildPlayerCell(formatRate(s.strikeOuts,  s.plateAppearances), kPct, baselines.kPct, false)}
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

  const starterBaselines = {
    era: compareAgainstAverage(starters, player => player.stats?.era),
    whip: compareAgainstAverage(starters, player => player.stats?.whip),
    kbb: compareAgainstAverage(starters, player => player.stats?.strikeoutWalkRatio),
    k9: compareAgainstAverage(starters, player => player.stats?.strikeoutsPer9Inn),
    bb9: compareAgainstAverage(starters, player => player.stats?.walksPer9Inn)
  };

  const relieverBaselines = {
    era: compareAgainstAverage(relievers, player => player.stats?.era),
    whip: compareAgainstAverage(relievers, player => player.stats?.whip),
    holds: compareAgainstAverage(relievers, player => player.stats?.holds),
    saves: compareAgainstAverage(relievers, player => player.stats?.saves),
    k9: compareAgainstAverage(relievers, player => player.stats?.strikeoutsPer9Inn)
  };

  renderRows("rotation-body", starters.length ? starters.map(player => {
    const s = player.stats || {};
    return `
      <tr>
        <td><div class="player-name-td"><img src="${headshotUrl(player.id)}" class="player-row-headshot" alt="${player.name}" onerror="this.style.display='none'"><strong>${player.name}</strong></div></td>
        <td>${s.gamesStarted ?? 0}</td>
        <td>${s.inningsPitched || "0.0"}</td>
        ${buildPlayerCell(formatDecimal(s.era), s.era, starterBaselines.era, false)}
        ${buildPlayerCell(formatDecimal(s.whip), s.whip, starterBaselines.whip, false)}
        ${buildPlayerCell(formatStrikeoutWalkRatio(s), s.strikeoutWalkRatio, starterBaselines.kbb, true)}
        ${buildPlayerCell(formatDecimal(s.strikeoutsPer9Inn), s.strikeoutsPer9Inn, starterBaselines.k9, true)}
        ${buildPlayerCell(formatDecimal(s.walksPer9Inn), s.walksPer9Inn, starterBaselines.bb9, false)}
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
        ${buildPlayerCell(formatDecimal(s.era), s.era, relieverBaselines.era, false)}
        ${buildPlayerCell(formatDecimal(s.whip), s.whip, relieverBaselines.whip, false)}
        ${buildPlayerCell(s.holds ?? 0, s.holds, relieverBaselines.holds, true)}
        ${buildPlayerCell(s.saves ?? 0, s.saves, relieverBaselines.saves, true)}
        ${buildPlayerCell(formatDecimal(s.strikeoutsPer9Inn), s.strikeoutsPer9Inn, relieverBaselines.k9, true)}
      </tr>
    `;
  }) : [none8(8)]);

  setText("rotation-card-title", `Starting Rotation \u2014 ${season} Live Stats`);
  setText("bullpen-card-title",  `Bullpen \u2014 ${season} Live Stats`);
}

// ── Render: standings ────────────────────────────────────────────────────────

function renderStandings(standings) {
  if (!standings.nlEast.length) {
    renderRows("nle-body", [renderUnavailableMessage(9, standings.unavailableReason || "2026 standings are unavailable.")]);
    renderRows("nl-full-body", [renderUnavailableMessage(5, standings.unavailableReason || "2026 standings are unavailable.")]);
    return;
  }

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

  const fullRows = standings.nlFull.flatMap(division => {
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
  });

  renderRows("nl-full-body", fullRows.length ? fullRows : [renderUnavailableMessage(5, "2026 full NL standings are unavailable.")]);
}

// ── Timestamp / error ────────────────────────────────────────────────────────

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
  renderRows("offense-body",  [renderUnavailableMessage(3, msg)]);
  renderRows("pitching-body", [renderUnavailableMessage(3, msg)]);
  renderRows("defense-body",  [renderUnavailableMessage(3, msg)]);
  renderRows("hitters-body",  [renderUnavailableMessage(9, msg)]);
  renderRows("rotation-body", [renderUnavailableMessage(8, msg)]);
  renderRows("bullpen-body",  [renderUnavailableMessage(8, msg)]);
  renderRows("nle-body",      [renderUnavailableMessage(9, msg)]);
  renderRows("nl-full-body",  [renderUnavailableMessage(5, msg)]);
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

function updateSeasonCopy(season, standings) {
  setText("stats-subtitle", `${season} Mets \u2014 live team stats, active roster production, pitching staff, and NL standings.`);
  if (standings?.nlEast?.length) {
    const sourceText = standings.source === "espn" ? "ESPN standings" : "MetsMoneyline cached standings";
    setText("page-banner", `Live ${season} season mode \u2014 ${sourceText}, team stats, and roster tables are current-season only.`);
  } else {
    setText("page-banner", `Live ${season} season mode \u2014 team stats are current-season only. Standings are unavailable instead of falling back to another season.`);
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const season = getPageSeason();
  setText("stats-subtitle", `${season} Mets \u2014 live team stats, active roster production, pitching staff, and NL standings.`);
  setText("page-banner", `Live ${season} season mode \u2014 current-season data only.`);

  try {
    const [standings, overview, matchupSnapshot, leagueAvg, seasonGames] = await Promise.all([
      loadStandings(season),
      loadOverview(),
      loadMatchupSnapshot(season),
      loadLeagueAverages(season),
      loadSeasonGameLog(TEAM_ID, season).catch(() => [])
    ]);

    ensureOverviewSeason(overview, season);

    const teamStats = loadTeamStats(overview);
    const hitters   = loadRosterStats(overview, "hitting");
    const pitchers  = loadRosterStats(overview, "pitching");
    const seasonSummary = buildSeasonSummaryFromGames(seasonGames);
    if (!Number.isFinite(seasonSummary.runDifferential)) {
      const runsFor = Number(teamStats?.hitting?.runs);
      const runsAgainst = Number(teamStats?.pitching?.runs);
      if (Number.isFinite(runsFor) && Number.isFinite(runsAgainst)) {
        seasonSummary.runDifferential = runsFor - runsAgainst;
      }
    }

    updateSeasonCopy(season, standings);
    renderAtAGlance(standings.mets, matchupSnapshot?.featuredGame || null, seasonSummary);
    renderTeamStats(teamStats, leagueAvg, season);
    renderHitters(hitters, season);
    renderPitchers(pitchers, season);
    renderStandings(standings);
    renderTimestamp(matchupSnapshot?.generatedAt || new Date().toISOString());
  } catch (error) {
    showErrorState(error);
  }
}

init();
