const TEAM_LOGO_DIR = "logos/mlb";
const GENERIC_LOGO = `${TEAM_LOGO_DIR}/generic.svg`;

export const MLB_TEAM_LOGOS = {
  108: { canonicalKey: "angels", id: 108, mlbStatsTeamId: 108, name: "Los Angeles Angels", abbreviation: "LAA", file: "laa.svg", aliases: ["Angels", "LA Angels", "Anaheim Angels"] },
  109: { canonicalKey: "diamondbacks", id: 109, mlbStatsTeamId: 109, name: "Arizona Diamondbacks", abbreviation: "ARI", file: "ari.svg", aliases: ["Diamondbacks", "D-Backs", "Dbacks"] },
  110: { canonicalKey: "orioles", id: 110, mlbStatsTeamId: 110, name: "Baltimore Orioles", abbreviation: "BAL", file: "bal.svg", aliases: ["Orioles"] },
  111: { canonicalKey: "red-sox", id: 111, mlbStatsTeamId: 111, name: "Boston Red Sox", abbreviation: "BOS", file: "bos.svg", aliases: ["Red Sox"] },
  112: { canonicalKey: "cubs", id: 112, mlbStatsTeamId: 112, name: "Chicago Cubs", abbreviation: "CHC", file: "chc.svg", aliases: ["Cubs"] },
  113: { canonicalKey: "reds", id: 113, mlbStatsTeamId: 113, name: "Cincinnati Reds", abbreviation: "CIN", file: "cin.svg", aliases: ["Reds"] },
  114: { canonicalKey: "guardians", id: 114, mlbStatsTeamId: 114, name: "Cleveland Guardians", abbreviation: "CLE", file: "cle.svg", aliases: ["Guardians", "Cleveland"] },
  115: { canonicalKey: "rockies", id: 115, mlbStatsTeamId: 115, name: "Colorado Rockies", abbreviation: "COL", file: "col.svg", aliases: ["Rockies"] },
  116: { canonicalKey: "tigers", id: 116, mlbStatsTeamId: 116, name: "Detroit Tigers", abbreviation: "DET", file: "det.svg", aliases: ["Tigers"] },
  117: { canonicalKey: "astros", id: 117, mlbStatsTeamId: 117, name: "Houston Astros", abbreviation: "HOU", file: "hou.svg", aliases: ["Astros"] },
  118: { canonicalKey: "royals", id: 118, mlbStatsTeamId: 118, name: "Kansas City Royals", abbreviation: "KC", file: "kc.svg", aliases: ["Royals", "KCR"] },
  119: { canonicalKey: "dodgers", id: 119, mlbStatsTeamId: 119, name: "Los Angeles Dodgers", abbreviation: "LAD", file: "lad.svg", aliases: ["Dodgers", "LA Dodgers"] },
  120: { canonicalKey: "nationals", id: 120, mlbStatsTeamId: 120, name: "Washington Nationals", abbreviation: "WSH", file: "wsh.svg", aliases: ["Nationals", "Nats"] },
  121: { canonicalKey: "mets", id: 121, mlbStatsTeamId: 121, name: "New York Mets", abbreviation: "NYM", file: "nym.svg", aliases: ["Mets"], apiSportsIds: [24] },
  133: { canonicalKey: "athletics", id: 133, mlbStatsTeamId: 133, name: "Athletics", abbreviation: "ATH", file: "ath.svg", aliases: ["Oakland Athletics", "A's", "As", "Oakland A's", "Oakland"] },
  134: { canonicalKey: "pirates", id: 134, mlbStatsTeamId: 134, name: "Pittsburgh Pirates", abbreviation: "PIT", file: "pit.svg", aliases: ["Pirates"] },
  135: { canonicalKey: "padres", id: 135, mlbStatsTeamId: 135, name: "San Diego Padres", abbreviation: "SD", file: "sd.svg", aliases: ["Padres", "SDP"] },
  136: { canonicalKey: "mariners", id: 136, mlbStatsTeamId: 136, name: "Seattle Mariners", abbreviation: "SEA", file: "sea.svg", aliases: ["Mariners"] },
  137: { canonicalKey: "giants", id: 137, mlbStatsTeamId: 137, name: "San Francisco Giants", abbreviation: "SF", file: "sf.svg", aliases: ["Giants", "SFG"] },
  138: { canonicalKey: "cardinals", id: 138, mlbStatsTeamId: 138, name: "St. Louis Cardinals", abbreviation: "STL", file: "stl.svg", aliases: ["Cardinals", "St Louis Cardinals"] },
  139: { canonicalKey: "rays", id: 139, mlbStatsTeamId: 139, name: "Tampa Bay Rays", abbreviation: "TB", file: "tb.svg", aliases: ["Rays", "Tampa Bay Devil Rays"] },
  140: { canonicalKey: "rangers", id: 140, mlbStatsTeamId: 140, name: "Texas Rangers", abbreviation: "TEX", file: "tex.svg", aliases: ["Rangers"] },
  141: { canonicalKey: "blue-jays", id: 141, mlbStatsTeamId: 141, name: "Toronto Blue Jays", abbreviation: "TOR", file: "tor.svg", aliases: ["Blue Jays", "Jays"] },
  142: { canonicalKey: "twins", id: 142, mlbStatsTeamId: 142, name: "Minnesota Twins", abbreviation: "MIN", file: "min.svg", aliases: ["Twins"] },
  143: { canonicalKey: "phillies", id: 143, mlbStatsTeamId: 143, name: "Philadelphia Phillies", abbreviation: "PHI", file: "phi.svg", aliases: ["Phillies"] },
  144: { canonicalKey: "braves", id: 144, mlbStatsTeamId: 144, name: "Atlanta Braves", abbreviation: "ATL", file: "atl.svg", aliases: ["Braves"] },
  145: { canonicalKey: "white-sox", id: 145, mlbStatsTeamId: 145, name: "Chicago White Sox", abbreviation: "CWS", file: "cws.svg", aliases: ["White Sox", "Chi White Sox"] },
  146: { canonicalKey: "marlins", id: 146, mlbStatsTeamId: 146, name: "Miami Marlins", abbreviation: "MIA", file: "mia.svg", aliases: ["Marlins", "Florida Marlins"] },
  147: { canonicalKey: "yankees", id: 147, mlbStatsTeamId: 147, name: "New York Yankees", abbreviation: "NYY", file: "nyy.svg", aliases: ["Yankees"] },
  158: { canonicalKey: "brewers", id: 158, mlbStatsTeamId: 158, name: "Milwaukee Brewers", abbreviation: "MIL", file: "mil.svg", aliases: ["Brewers"] }
};

const lookup = new Map();

function registerLookup(key, entry) {
  if (!key) return;
  lookup.set(String(key).trim().toLowerCase(), entry);
}

for (const entry of Object.values(MLB_TEAM_LOGOS)) {
  registerLookup(entry.canonicalKey, entry);
  registerLookup(entry.id, entry);
  registerLookup(entry.mlbStatsTeamId, entry);
  registerLookup(entry.name, entry);
  registerLookup(entry.abbreviation, entry);
  for (const apiSportsId of entry.apiSportsIds || []) registerLookup(apiSportsId, entry);
  for (const alias of entry.aliases || []) registerLookup(alias, entry);
}

export function resolveMlbTeam(teamRef) {
  if (teamRef == null) return null;

  if (typeof teamRef === "object") {
    return (
      resolveMlbTeam(teamRef.canonicalKey) ||
      resolveMlbTeam(teamRef.apiSportsTeamId) ||
      resolveMlbTeam(teamRef.mlbStatsTeamId) ||
      resolveMlbTeam(teamRef.id) ||
      resolveMlbTeam(teamRef.teamId) ||
      resolveMlbTeam(teamRef.abbreviation) ||
      resolveMlbTeam(teamRef.code) ||
      resolveMlbTeam(teamRef.name) ||
      resolveMlbTeam(teamRef.team)
    );
  }

  return lookup.get(String(teamRef).trim().toLowerCase()) || null;
}

export function getMlbTeamLogoUrl(teamRef) {
  const team = resolveMlbTeam(teamRef);
  return team ? `${TEAM_LOGO_DIR}/${team.file}` : GENERIC_LOGO;
}

export function getMlbTeamAbbr(teamRef) {
  const team = resolveMlbTeam(teamRef);
  if (team?.abbreviation) return team.abbreviation;
  const text = String(teamRef || "").trim();
  if (!text) return "MLB";
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.map((word) => word[0]).join("").slice(0, 3).toUpperCase();
}

export function getGenericMlbLogoUrl() {
  return GENERIC_LOGO;
}
