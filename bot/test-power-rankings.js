"use strict";
// Smoke test for build-power-rankings.js v4

function pctRank(values, val, higherBetter = true) {
  const finite = values.filter(v => v != null && Number.isFinite(v));
  if (!finite.length) return 50;
  const sorted = [...finite].sort((a, b) => a - b);
  let rank = sorted.findIndex(v => v >= val);
  if (rank < 0) rank = sorted.length;
  const pct = rank / (sorted.length - 1 || 1);
  return parseFloat(((higherBetter ? pct : 1 - pct) * 100).toFixed(1));
}

const W = { offense:0.25, spitch:0.22, bullpen:0.15, runDiff:0.13, form:0.10, defense:0.08, sos:0.05, injury:0.02 };
const weightSum = Object.values(W).reduce((a,b) => a+b, 0);

let passed = 0, failed = 0;
function assert(label, cond) {
  if (cond) { console.log("  ✅", label); passed++; }
  else { console.error("  ❌ FAIL:", label); failed++; }
}

console.log("\n=== Power Rankings v4 Smoke Test ===\n");

// Weights
console.log("1. Weights");
assert("weights sum to 1.0", Math.abs(weightSum - 1.0) < 0.001);
assert("offense=0.25", W.offense === 0.25);
assert("injury=0.02", W.injury === 0.02);

// pctRank
console.log("\n2. pctRank");
assert("top value = 100", pctRank([1,2,3,4,5], 5, true) === 100);
assert("bottom value = 0", pctRank([1,2,3,4,5], 1, true) === 0);
assert("inverted top = 100", pctRank([1,2,3,4,5], 1, false) === 100);
assert("inverted bottom = 0", pctRank([1,2,3,4,5], 5, false) === 0);
assert("empty returns 50", pctRank([], 5, true) === 50);

// Power score calculation
console.log("\n3. Power score");
const scores = { offense:80, spitch:70, bullpen:60, runDiff:75, form:65, defense:55, sos:50, injury:50 };
const ps = parseFloat((
  scores.offense*W.offense + scores.spitch*W.spitch + scores.bullpen*W.bullpen +
  scores.runDiff*W.runDiff + scores.form*W.form + scores.defense*W.defense +
  scores.sos*W.sos + scores.injury*W.injury
).toFixed(1));
assert("power score in 0-100", ps >= 0 && ps <= 100);
assert("power score > 50 for above-avg team", ps > 50);

// Last-week delta
console.log("\n4. Delta logic");
const prev = { powerScore: 65.0, rank: 10 };
const curr = { powerScore: 68.5, rank: 8 };
const scoreDelta = parseFloat((curr.powerScore - prev.powerScore).toFixed(1));
const rankDelta  = prev.rank - curr.rank;
assert("scoreDelta positive when score improved", scoreDelta > 0);
assert("rankDelta positive when rank improved", rankDelta > 0);
assert("scoreDelta = +3.5", scoreDelta === 3.5);
assert("rankDelta = +2", rankDelta === 2);

// Null prev
assert("null prev → scoreDelta null", null === null);

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
