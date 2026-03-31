const TEAM_IDENTITIES = [
  { canonicalKey: "angels", name: "Los Angeles Angels", abbreviation: "LAA", mlbStatsTeamId: 108, aliases: ["Angels", "LA Angels", "Anaheim Angels"] },
  { canonicalKey: "diamondbacks", name: "Arizona Diamondbacks", abbreviation: "ARI", mlbStatsTeamId: 109, aliases: ["Diamondbacks", "D-Backs", "Dbacks"] },
  { canonicalKey: "orioles", name: "Baltimore Orioles", abbreviation: "BAL", mlbStatsTeamId: 110, aliases: ["Orioles"] },
  { canonicalKey: "red-sox", name: "Boston Red Sox", abbreviation: "BOS", mlbStatsTeamId: 111, aliases: ["Red Sox"] },
  { canonicalKey: "cubs", name: "Chicago Cubs", abbreviation: "CHC", mlbStatsTeamId: 112, aliases: ["Cubs"] },
  { canonicalKey: "reds", name: "Cincinnati Reds", abbreviation: "CIN", mlbStatsTeamId: 113, aliases: ["Reds"] },
  { canonicalKey: "guardians", name: "Cleveland Guardians", abbreviation: "CLE", mlbStatsTeamId: 114, aliases: ["Guardians", "Cleveland"] },
  { canonicalKey: "rockies", name: "Colorado Rockies", abbreviation: "COL", mlbStatsTeamId: 115, aliases: ["Rockies"] },
  { canonicalKey: "tigers", name: "Detroit Tigers", abbreviation: "DET", mlbStatsTeamId: 116, aliases: ["Tigers"] },
  { canonicalKey: "astros", name: "Houston Astros", abbreviation: "HOU", mlbStatsTeamId: 117, aliases: ["Astros"] },
  { canonicalKey: "royals", name: "Kansas City Royals", abbreviation: "KC", mlbStatsTeamId: 118, aliases: ["Royals", "KCR"] },
  { canonicalKey: "dodgers", name: "Los Angeles Dodgers", abbreviation: "LAD", mlbStatsTeamId: 119, aliases: ["Dodgers", "LA Dodgers"] },
  { canonicalKey: "nationals", name: "Washington Nationals", abbreviation: "WSH", mlbStatsTeamId: 120, aliases: ["Nationals", "Nats"] },
  { canonicalKey: "mets", name: "New York Mets", abbreviation: "NYM", mlbStatsTeamId: 121, aliases: ["Mets"] },
  { canonicalKey: "athletics", name: "Athletics", abbreviation: "ATH", mlbStatsTeamId: 133, aliases: ["Oakland Athletics", "A's", "As", "Oakland A's", "Oakland"] },
  { canonicalKey: "pirates", name: "Pittsburgh Pirates", abbreviation: "PIT", mlbStatsTeamId: 134, aliases: ["Pirates"] },
  { canonicalKey: "padres", name: "San Diego Padres", abbreviation: "SD", mlbStatsTeamId: 135, aliases: ["Padres", "SDP"] },
  { canonicalKey: "mariners", name: "Seattle Mariners", abbreviation: "SEA", mlbStatsTeamId: 136, aliases: ["Mariners"] },
  { canonicalKey: "giants", name: "San Francisco Giants", abbreviation: "SF", mlbStatsTeamId: 137, aliases: ["Giants", "SFG"] },
  { canonicalKey: "cardinals", name: "St. Louis Cardinals", abbreviation: "STL", mlbStatsTeamId: 138, aliases: ["Cardinals", "St Louis Cardinals"] },
  { canonicalKey: "rays", name: "Tampa Bay Rays", abbreviation: "TB", mlbStatsTeamId: 139, aliases: ["Rays", "Tampa Bay Devil Rays"] },
  { canonicalKey: "rangers", name: "Texas Rangers", abbreviation: "TEX", mlbStatsTeamId: 140, aliases: ["Rangers"] },
  { canonicalKey: "blue-jays", name: "Toronto Blue Jays", abbreviation: "TOR", mlbStatsTeamId: 141, aliases: ["Blue Jays", "Jays"] },
  { canonicalKey: "twins", name: "Minnesota Twins", abbreviation: "MIN", mlbStatsTeamId: 142, aliases: ["Twins"] },
  { canonicalKey: "phillies", name: "Philadelphia Phillies", abbreviation: "PHI", mlbStatsTeamId: 143, aliases: ["Phillies"] },
  { canonicalKey: "braves", name: "Atlanta Braves", abbreviation: "ATL", mlbStatsTeamId: 144, aliases: ["Braves"] },
  { canonicalKey: "white-sox", name: "Chicago White Sox", abbreviation: "CWS", mlbStatsTeamId: 145, aliases: ["White Sox", "Chi White Sox"] },
  { canonicalKey: "marlins", name: "Miami Marlins", abbreviation: "MIA", mlbStatsTeamId: 146, aliases: ["Marlins", "Florida Marlins"] },
  { canonicalKey: "yankees", name: "New York Yankees", abbreviation: "NYY", mlbStatsTeamId: 147, aliases: ["Yankees"] },
  { canonicalKey: "brewers", name: "Milwaukee Brewers", abbreviation: "MIL", mlbStatsTeamId: 158, aliases: ["Brewers"] }
];

const lookup = new Map();

function registerLookup(key, team) {
  if (!key) return;
  lookup.set(String(key).trim().toLowerCase(), team);
}

for (const team of TEAM_IDENTITIES) {
  registerLookup(team.canonicalKey, team);
  registerLookup(team.mlbStatsTeamId, team);
  registerLookup(team.name, team);
  registerLookup(team.abbreviation, team);
  for (const alias of team.aliases || []) registerLookup(alias, team);
}

function resolveTeamIdentity(teamRef) {
  if (teamRef == null) return null;

  if (typeof teamRef === "object") {
    return (
      resolveTeamIdentity(teamRef.canonicalKey) ||
      resolveTeamIdentity(teamRef.mlbStatsTeamId) ||
      resolveTeamIdentity(teamRef.abbreviation) ||
      resolveTeamIdentity(teamRef.code) ||
      resolveTeamIdentity(teamRef.name) ||
      resolveTeamIdentity(teamRef.team)
    );
  }

  return lookup.get(String(teamRef).trim().toLowerCase()) || null;
}

function normalizeTeamIdentity(teamRef, rawApiSportsTeamId = null) {
  const team = resolveTeamIdentity(teamRef);
  return {
    canonicalKey: team?.canonicalKey || null,
    mlbStatsTeamId: team?.mlbStatsTeamId ?? null,
    apiSportsTeamId: rawApiSportsTeamId ?? (typeof teamRef === "object" ? teamRef?.apiSportsTeamId ?? teamRef?.id ?? null : null),
    abbreviation: team?.abbreviation || null,
    name: team?.name || (typeof teamRef === "object" ? teamRef?.name || teamRef?.team || null : null)
  };
}

module.exports = {
  TEAM_IDENTITIES,
  normalizeTeamIdentity,
  resolveTeamIdentity
};
