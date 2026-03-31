const GENERIC_LOGO = "logos/mlb/generic.svg";

const TEAM_MLB_ID = {
  "Arizona Diamondbacks": 109,
  "Atlanta Braves": 144,
  "Baltimore Orioles": 110,
  "Boston Red Sox": 111,
  "Chicago Cubs": 112,
  "Chicago White Sox": 145,
  "Cincinnati Reds": 113,
  "Cleveland Guardians": 114,
  "Colorado Rockies": 115,
  "Detroit Tigers": 116,
  "Houston Astros": 117,
  "Kansas City Royals": 118,
  "Los Angeles Angels": 108,
  "Los Angeles Dodgers": 119,
  "Miami Marlins": 146,
  "Milwaukee Brewers": 158,
  "Minnesota Twins": 142,
  "New York Mets": 121,
  "New York Yankees": 147,
  "Oakland Athletics": 133,
  "Philadelphia Phillies": 143,
  "Pittsburgh Pirates": 134,
  "San Diego Padres": 135,
  "San Francisco Giants": 137,
  "Seattle Mariners": 136,
  "St. Louis Cardinals": 138,
  "Tampa Bay Rays": 139,
  "Texas Rangers": 140,
  "Toronto Blue Jays": 141,
  "Washington Nationals": 120
};

const TEAM_ABBR = {
  "Arizona Diamondbacks": "ARI",
  "Atlanta Braves": "ATL",
  "Baltimore Orioles": "BAL",
  "Boston Red Sox": "BOS",
  "Chicago Cubs": "CHC",
  "Chicago White Sox": "CWS",
  "Cincinnati Reds": "CIN",
  "Cleveland Guardians": "CLE",
  "Colorado Rockies": "COL",
  "Detroit Tigers": "DET",
  "Houston Astros": "HOU",
  "Kansas City Royals": "KC",
  "Los Angeles Angels": "LAA",
  "Los Angeles Dodgers": "LAD",
  "Miami Marlins": "MIA",
  "Milwaukee Brewers": "MIL",
  "Minnesota Twins": "MIN",
  "New York Mets": "NYM",
  "New York Yankees": "NYY",
  "Oakland Athletics": "ATH",
  "Philadelphia Phillies": "PHI",
  "Pittsburgh Pirates": "PIT",
  "San Diego Padres": "SD",
  "San Francisco Giants": "SF",
  "Seattle Mariners": "SEA",
  "St. Louis Cardinals": "STL",
  "Tampa Bay Rays": "TB",
  "Texas Rangers": "TEX",
  "Toronto Blue Jays": "TOR",
  "Washington Nationals": "WSH"
};

const TEAM_CANONICAL_IDS = {
  "angels": 108,
  "diamondbacks": 109,
  "orioles": 110,
  "red-sox": 111,
  "cubs": 112,
  "reds": 113,
  "guardians": 114,
  "rockies": 115,
  "tigers": 116,
  "astros": 117,
  "royals": 118,
  "dodgers": 119,
  "nationals": 120,
  "mets": 121,
  "athletics": 133,
  "pirates": 134,
  "padres": 135,
  "mariners": 136,
  "giants": 137,
  "cardinals": 138,
  "rays": 139,
  "rangers": 140,
  "blue-jays": 141,
  "twins": 142,
  "phillies": 143,
  "braves": 144,
  "white-sox": 145,
  "marlins": 146,
  "yankees": 147,
  "brewers": 158
};

const TEAM_NAME_LOOKUP = {};

function normalizeName(value) {
  if (!value) return "";
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

Object.entries(TEAM_MLB_ID).forEach(([name, id]) => {
  const normalized = normalizeName(name);
  if (normalized) TEAM_NAME_LOOKUP[normalized] = id;
  const nickname = name.split(" ").slice(-1)[0];
  if (nickname) {
    const normalizedNickname = normalizeName(nickname);
    if (normalizedNickname) TEAM_NAME_LOOKUP[normalizedNickname] = id;
  }
});

function findByCanonical(key) {
  if (!key) return null;
  return TEAM_CANONICAL_IDS[key.toLowerCase()] || null;
}

function findByName(value) {
  const normalized = normalizeName(value);
  return normalized ? TEAM_NAME_LOOKUP[normalized] : null;
}

function resolveTeamId(teamRef) {
  if (teamRef == null) return null;
  if (typeof teamRef === "number") return teamRef;

  if (typeof teamRef === "object") {
    const id = teamRef.mlbStatsTeamId || teamRef.teamId || teamRef.id;
    if (id) return id;
    const canonical = teamRef.canonicalKey || teamRef.canonical || teamRef.slug;
    const code = teamRef.code || teamRef.abbreviation;
    return (
      findByCanonical(canonical) ||
      findByCanonical(code) ||
      findByName(teamRef.name) ||
      findByName(teamRef.team) ||
      findByName(teamRef.nickname) ||
      findByName(teamRef.shortName) ||
      null
    );
  }

  if (typeof teamRef === "string") {
    return (
      TEAM_MLB_ID[teamRef] ||
      findByCanonical(teamRef) ||
      findByName(teamRef) ||
      null
    );
  }

  return null;
}

export function getTeamLogoUrl(teamRef) {
  const id = resolveTeamId(teamRef);
  return id ? `https://www.mlbstatic.com/team-logos/${id}.svg` : GENERIC_LOGO;
}

export function getTeamAbbr(teamName) {
  if (!teamName) return "MLB";
  if (TEAM_ABBR[teamName]) return TEAM_ABBR[teamName];
  const words = (teamName || "").split(" ").filter(Boolean);
  if (words.length === 0) return "MLB";
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.map((word) => word[0]).join("").slice(0, 3).toUpperCase();
}
