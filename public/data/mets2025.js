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

  // Key starters (2025 final)
  starters: {
    "David Peterson": { ERA: 3.47, FIP: 3.61, xFIP: 3.55, WHIP: 1.19, KBB: 3.8 },
    "Kodai Senga": { ERA: 2.98, FIP: 3.12, xFIP: 3.08, WHIP: 1.02, KBB: 5.1 },
    "Sean Manaea": { ERA: 3.82, FIP: 3.94, xFIP: 3.87, WHIP: 1.21, KBB: 3.2 },
    "Clay Holmes": { ERA: 4.01, FIP: 4.18, xFIP: 4.05, WHIP: 1.31, KBB: 2.9 },
    "Griffin Canning": { ERA: 4.23, FIP: 4.31, xFIP: 4.19, WHIP: 1.28, KBB: 2.7 }
  },

  // Key hitters (2025 final)
  hitters: {
    "Francisco Lindor": { AVG: 0.273, OPS: 0.847, wRC_plus: 131, HR: 28 },
    "Pete Alonso": { AVG: 0.254, OPS: 0.881, wRC_plus: 138, HR: 34 },
    "Juan Soto": { AVG: 0.288, OPS: 0.963, wRC_plus: 158, HR: 31 },
    "Brandon Nimmo": { AVG: 0.241, OPS: 0.764, wRC_plus: 112, HR: 17 },
    "Mark Vientos": { AVG: 0.261, OPS: 0.812, wRC_plus: 121, HR: 23 },
    "Starling Marte": { AVG: 0.256, OPS: 0.731, wRC_plus: 105, HR: 11 },
    "Jeff McNeil": { AVG: 0.267, OPS: 0.751, wRC_plus: 108, HR: 9 },
    "Francisco Alvarez": { AVG: 0.238, OPS: 0.769, wRC_plus: 113, HR: 19 }
  }
};

export default METS_2025;
