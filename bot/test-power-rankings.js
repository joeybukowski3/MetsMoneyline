/**
 * Quick smoke test for build-power-rankings.js
 * Run: node bot/test-power-rankings.js
 */
"use strict";

// Inline the same logic without network calls
function isoDate(d) { return d.toISOString().slice(0, 10); }

function percentileRank(values, value, higherIsBetter = true) {
  const sorted = [...values].filter(v => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return 12.5;
  const rank = sorted.findIndex(v => v >= value);
  const pct = rank < 0 ? 1 : rank / (sorted.length - 1 || 1);
  return parseFloat((higherIsBetter ? pct * 25 : (1 - pct) * 25).toFixed(1));
}

function buildRankedTeams(standings, opsMap, xeraMap, bpMap) {
  if (!Array.isArray(standings) || standings.length === 0) return [];
  const teams = standings.map(t => ({
    ...t,
    opsPlus:     opsMap[t.teamId]?.opsPlus ?? 100,
    starterXera: xeraMap[t.teamId] ?? null,
    bullpenXfip: bpMap[t.teamId] ?? 4.50,
  }));
  const opsPlusValues = teams.map(t => t.opsPlus);
  const xeraValues    = teams.map(t => t.starterXera).filter(v => typeof v === "number" && Number.isFinite(v));
  const bpValues      = teams.map(t => t.bullpenXfip);
  const rdValues      = teams.map(t => t.runDiff);
  teams.forEach(t => {
    const s1 = percentileRank(opsPlusValues, t.opsPlus, true);
    const xera = typeof t.starterXera === "number" ? t.starterXera : 4.50;
    const s2 = percentileRank(xeraValues, xera, false);
    const s3 = percentileRank(bpValues, t.bullpenXfip, false);
    const s4 = percentileRank(rdValues, t.runDiff, true);
    t.composite = parseFloat((s1 + s2 + s3 + s4).toFixed(1));
  });
  teams.sort((a, b) => b.composite - a.composite);
  return teams;
}

// Mock data
const standings = [
  { teamId: 119, team: "Dodgers",  wins: 24, losses: 14, record: "24-14", runDiff:  79 },
  { teamId: 147, team: "Yankees",  wins: 26, losses: 11, record: "26-11", runDiff:  88 },
  { teamId: 144, team: "Braves",   wins: 22, losses: 14, record: "22-14", runDiff:  55 },
  { teamId: 121, team: "Mets",     wins: 20, losses: 26, record: "20-26", runDiff: -12 },
  { teamId: 143, team: "Phillies", wins: 18, losses: 18, record: "18-18", runDiff:   2 },
];
const opsMap  = { 119:{opsPlus:115}, 147:{opsPlus:122}, 144:{opsPlus:108}, 121:{opsPlus:92}, 143:{opsPlus:98} };
const xeraMap = { 119: 3.55, 147: 3.41, 144: 3.72, 121: 4.10, 143: 4.05 };
const bpMap   = { 119: 3.82, 147: 3.61, 144: 3.95, 121: 4.35, 143: 4.20 };

const l30Window = getL30Window();

function getL30Window() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

let passed = 0, failed = 0;
function assert(label, condition) {
  if (condition) { console.log("  ✅", label); passed++; }
  else           { console.error("  ❌ FAIL:", label); failed++; }
}

console.log("\n=== build-power-rankings smoke test ===\n");

// Test 1: percentileRank
console.log("1. percentileRank()");
assert("higher-is-better top value scores ~25",   percentileRank([1,2,3,4,5], 5, true)  >= 24);
assert("higher-is-better bottom value scores ~0",  percentileRank([1,2,3,4,5], 1, true)  <= 1);
assert("lower-is-better top value scores ~25",     percentileRank([1,2,3,4,5], 1, false) >= 24);
assert("lower-is-better bottom value scores ~0",   percentileRank([1,2,3,4,5], 5, false) <= 1);
assert("empty array returns 12.5",                 percentileRank([], 5, true) === 12.5);
assert("null-filtered array returns 12.5",         percentileRank([null, NaN], 5, true) === 12.5);

// Test 2: buildRankedTeams
console.log("\n2. buildRankedTeams()");
const teams = buildRankedTeams(standings, opsMap, xeraMap, bpMap);
assert("returns 5 teams",                          teams.length === 5);
assert("all have composite score",                 teams.every(t => typeof t.composite === "number"));
assert("composites between 0-100",                 teams.every(t => t.composite >= 0 && t.composite <= 100));
assert("sorted descending",                        teams[0].composite >= teams[4].composite);
assert("Yankees or Dodgers #1 (best stats)",       teams[0].teamId === 147 || teams[0].teamId === 119);

// Test 3: null/empty guards
console.log("\n3. Null/empty guards");
assert("empty standings → []",   buildRankedTeams([], opsMap, xeraMap, bpMap).length === 0);
assert("null standings → []",    buildRankedTeams(null, opsMap, xeraMap, bpMap).length === 0);
assert("missing opsMap → works", buildRankedTeams(standings, {}, xeraMap, bpMap).length === 5);

// Test 4: L30 date format
console.log("\n4. L30 date format");
assert("startDate uses dashes",  l30Window.startDate.match(/^\d{4}-\d{2}-\d{2}$/) !== null);
assert("endDate uses dashes",    l30Window.endDate.match(/^\d{4}-\d{2}-\d{2}$/) !== null);
assert("no slashes in dates",    !l30Window.startDate.includes("/") && !l30Window.endDate.includes("/"));
assert("30-day spread",          (new Date(l30Window.endDate) - new Date(l30Window.startDate)) / 86400000 >= 29);

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
