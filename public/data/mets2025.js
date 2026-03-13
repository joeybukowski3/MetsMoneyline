const METS_2025 = {
  season: 2025,
  record: { W: 89, L: 73 },
  runDiff: 47,
  home: "46-35",
  road: "43-38",
  division: "NL East",

  // Offensive
  teamOPS: 0.748,
  teamWRC_plus: 104,
  teamAVG: 0.249,
  teamSLG: 0.414,
  teamOBP: 0.334,
  hardHitPct: 39.2,
  barrelPct: 8.9,
  kPct: 22.1,
  bbPct: 8.6,

  // Rotation
  rotationERA: 3.89,
  rotationFIP: 3.97,
  rotationxFIP: 3.91,
  rotationWHIP: 1.24,
  rotationKper9: 9.1,

  // Bullpen
  bullpenERA: 3.71,
  bullpenxFIP: 3.88,
  bullpenHoldPct: 71,

  // Defense
  teamDRS: 12,
  teamOAA: 8,
  sbAllowed: 94,

  leagueAvg2025: {
    teamOPS: 0.737,
    teamWRC_plus: 100,
    teamAVG: 0.244,
    kPct: 22.8,
    bbPct: 8.3,
    hardHitPct: 38.1,
    barrelPct: 8.4,
    rotationERA: 4.21,
    rotationFIP: 4.18,
    rotationWHIP: 1.29,
    rotationKper9: 8.7,
    bullpenERA: 4.09,
    bullpenxFIP: 4.01,
    teamDRS: 0,
    teamOAA: 0
  },

  opponents2025: {
    "St. Louis Cardinals": {
      teamOPS: 0.718, teamWRC_plus: 96, teamAVG: 0.239, rotationERA: 4.44,
      bullpenERA: 4.31, bullpenxFIP: 4.25, bullpenLast14ERA: 4.40, teamDRS: -4, teamOAA: -3
    },
    "Atlanta Braves": {
      teamOPS: 0.761, teamWRC_plus: 108, teamAVG: 0.253, rotationERA: 3.98,
      bullpenERA: 3.87, teamDRS: 9, teamOAA: 6
    },
    "Washington Nationals": {
      teamOPS: 0.694, teamWRC_plus: 89, teamAVG: 0.231, rotationERA: 4.71,
      bullpenERA: 4.58, teamDRS: -8, teamOAA: -6
    },
    "Philadelphia Phillies": {
      teamOPS: 0.769, teamWRC_plus: 112, teamAVG: 0.258, rotationERA: 3.84,
      bullpenERA: 3.76, teamDRS: 6, teamOAA: 5
    },
    "Miami Marlins": {
      teamOPS: 0.681, teamWRC_plus: 85, teamAVG: 0.228, rotationERA: 4.89,
      bullpenERA: 4.72, teamDRS: -11, teamOAA: -9
    }
  },

  // Key starters (2025 final)
  starters: {
    "David Peterson": { ERA: 3.47, FIP: 3.61, xFIP: 3.55, WHIP: 1.19, KBB: 3.8 },
    "Kodai Senga": { ERA: 2.98, FIP: 3.12, xFIP: 3.08, WHIP: 1.02, KBB: 5.1 },
    "Sean Manaea": { ERA: 3.82, FIP: 3.94, xFIP: 3.87, WHIP: 1.21, KBB: 3.2 },
    "Clay Holmes": { ERA: 4.01, FIP: 4.18, xFIP: 4.05, WHIP: 1.31, KBB: 2.9 },
    "Griffin Canning": { ERA: 4.23, FIP: 4.31, xFIP: 4.19, WHIP: 1.28, KBB: 2.7 }
  },

  // 2026 roster hitters — 2025 stats used as placeholders until season begins
  hitters: {
    // Returning core
    "Francisco Lindor":  { AVG: 0.273, OPS: 0.847, wRC_plus: 131, HR: 28 },
    "Juan Soto":         { AVG: 0.288, OPS: 0.963, wRC_plus: 158, HR: 31 },
    "Pete Alonso":       { AVG: 0.254, OPS: 0.881, wRC_plus: 138, HR: 34 },
    "Mark Vientos":      { AVG: 0.261, OPS: 0.812, wRC_plus: 121, HR: 23 },
    "Francisco Alvarez": { AVG: 0.238, OPS: 0.769, wRC_plus: 113, HR: 19 },
    "Brandon Nimmo":     { AVG: 0.241, OPS: 0.764, wRC_plus: 112, HR: 17 },
    // New additions
    "Marcus Semien":     { AVG: 0.230, OPS: 0.669, wRC_plus: 100, HR: 15 },
    "Bo Bichette":       { AVG: 0.311, OPS: 0.840, wRC_plus: 120, HR: 18 },
    "Luis Robert Jr.":   { AVG: 0.223, OPS: 0.661, wRC_plus:  90, HR: 14 },
    "Jorge Polanco":     { AVG: 0.265, OPS: 0.821, wRC_plus: 115, HR: 26 },
    "Brett Baty":        { AVG: 0.254, OPS: 0.748, wRC_plus: 105, HR: 18 },
    "Tyrone Taylor":     { AVG: 0.223, OPS: 0.598, wRC_plus:  75, HR:  2 },
    "Mike Tauchman":     { AVG: 0.263, OPS: 0.756, wRC_plus: 110, HR:  9 },
    "Ronny Mauricio":    { AVG: 0.226, OPS: 0.662, wRC_plus:  85, HR:  6 }
  }
};

export default METS_2025;
