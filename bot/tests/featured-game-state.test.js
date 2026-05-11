const assert = require("node:assert/strict");

const {
  normalizeGameDate,
  resolveFeaturedGameState,
  shouldDiscardUntrustedCurrentDayCachedGame
} = require("../../public/js/featured-game-state.js");
const {
  isExactLocalGameReusable,
  resolveExternalGameDate,
  isExternalGameExactMatch
} = require("../generator");

function buildGame({
  date,
  time = "7:10 PM ET",
  status = "upcoming",
  opponent = "Opponent",
  homeAway = "home",
  pitching = null,
  startTime = null
} = {}) {
  return {
    date,
    time,
    status,
    opponent,
    homeAway,
    pitching: pitching || {
      mets: { name: "TBD", announced: false },
      opp: { name: "TBD", announced: false }
    },
    startTime
  };
}

const checks = [
  function selectsTodaysGame() {
    const state = resolveFeaturedGameState([
      buildGame({ date: "2026-05-11", opponent: "Diamondbacks" }),
      buildGame({ date: "2026-05-12", opponent: "Cubs" })
    ], {
      referenceDate: "2026-05-11",
      now: new Date("2026-05-11T15:00:00Z")
    });
    assert.equal(state.kind, "today");
    assert.equal(state.displayLabel, "Today's Game");
    assert.equal(state.featuredGame.opponent, "Diamondbacks");
  },
  function showsTomorrowsGameOnOffDay() {
    const state = resolveFeaturedGameState([
      buildGame({ date: "2026-05-12", opponent: "Diamondbacks" })
    ], {
      referenceDate: "2026-05-11",
      now: new Date("2026-05-11T15:00:00Z")
    });
    assert.equal(state.kind, "tomorrow");
    assert.equal(state.offDay, true);
    assert.equal(state.displayLabel, "Tomorrow's Game");
    assert.equal(state.featuredGame.opponent, "Diamondbacks");
  },
  function showsNextGameAfterMultiDayLayoff() {
    const state = resolveFeaturedGameState([
      buildGame({ date: "2026-05-14", opponent: "Dodgers" })
    ], {
      referenceDate: "2026-05-11",
      now: new Date("2026-05-11T15:00:00Z")
    });
    assert.equal(state.kind, "next");
    assert.equal(state.featuredGame.opponent, "Dodgers");
  },
  function neverPromotesYesterdaysFinal() {
    const state = resolveFeaturedGameState([
      buildGame({ date: "2026-05-10", opponent: "Diamondbacks", status: "final" }),
      buildGame({ date: "2026-05-12", opponent: "Cubs" })
    ], {
      referenceDate: "2026-05-11",
      now: new Date("2026-05-11T15:00:00Z")
    });
    assert.equal(state.featuredGame.opponent, "Cubs");
    assert.equal(state.staleCompletedGames.length, 1);
  },
  function preservesProbablesSeveralDaysEarly() {
    const state = resolveFeaturedGameState([
      buildGame({
        date: "2026-05-14",
        opponent: "Dodgers",
        pitching: {
          mets: { name: "Kodai Senga", announced: true },
          opp: { name: "Yoshinobu Yamamoto", announced: true }
        }
      })
    ], {
      referenceDate: "2026-05-11",
      now: new Date("2026-05-11T15:00:00Z")
    });
    assert.equal(state.featuredGame.pitching.mets.name, "Kodai Senga");
    assert.equal(state.featuredGame.pitching.opp.name, "Yoshinobu Yamamoto");
  },
  function handlesMissingProbables() {
    const state = resolveFeaturedGameState([
      buildGame({
        date: "2026-05-13",
        opponent: "Padres",
        pitching: {
          mets: { name: "TBD", announced: false },
          opp: { name: "TBD", announced: false }
        }
      })
    ], {
      referenceDate: "2026-05-11",
      now: new Date("2026-05-11T15:00:00Z")
    });
    assert.equal(state.featuredGame.opponent, "Padres");
    assert.equal(state.featuredGame.pitching.mets.name, "TBD");
  },
  function selectsFirstGameOfDoubleheader() {
    const state = resolveFeaturedGameState([
      buildGame({ date: "2026-05-11", time: "7:10 PM ET", opponent: "Braves" }),
      buildGame({ date: "2026-05-11", time: "1:10 PM ET", opponent: "Braves" })
    ], {
      referenceDate: "2026-05-11",
      now: new Date("2026-05-11T15:00:00Z")
    });
    assert.equal(state.todayGames.length, 2);
    assert.equal(state.featuredGame.time, "1:10 PM ET");
  },
  function respectsTimezoneNearMidnight() {
    const state = resolveFeaturedGameState([
      buildGame({ date: "2026-05-10", opponent: "Diamondbacks" }),
      buildGame({ date: "2026-05-11", opponent: "Cubs" })
    ], {
      now: new Date("2026-05-11T03:30:00Z")
    });
    assert.equal(state.referenceDate, "2026-05-10");
    assert.equal(state.kind, "today");
    assert.equal(state.featuredGame.opponent, "Diamondbacks");
  },
  function skipsPostponedGames() {
    const state = resolveFeaturedGameState([
      buildGame({ date: "2026-05-11", opponent: "Diamondbacks", status: "Postponed" }),
      buildGame({ date: "2026-05-12", opponent: "Giants" })
    ], {
      referenceDate: "2026-05-11",
      now: new Date("2026-05-11T15:00:00Z")
    });
    assert.equal(state.kind, "tomorrow");
    assert.equal(state.featuredGame.opponent, "Giants");
  },
  function handlesEmptyOrIncompleteResponses() {
    const state = resolveFeaturedGameState([
      { opponent: "Missing Date" },
      null
    ], {
      referenceDate: "2026-05-11",
      now: new Date("2026-05-11T15:00:00Z")
    });
    assert.equal(state.featuredGame, null);
    assert.equal(state.kind, "no-upcoming-data");
  },
  function normalizesDateFromStartTime() {
    assert.equal(
      normalizeGameDate(buildGame({ date: null, startTime: "2026-05-13T23:10:00Z" })),
      "2026-05-13"
    );
  },
  function rejectsStaleLocalSeriesContinuationGamesAsExactMatches() {
    assert.equal(isExactLocalGameReusable({
      date: "2026-05-11",
      opponent: "Diamondbacks",
      canonicalGameSource: {
        source: "local/public-data-series-continuation",
        stale: true
      }
    }, "2026-05-11"), false);
  },
  function rejectsExactLocalGamesWithoutCanonicalSourceMetadata() {
    assert.equal(isExactLocalGameReusable({
      date: "2026-05-11",
      opponent: "Diamondbacks"
    }, "2026-05-11"), false);
  },
  function rejectsExactLocalGamesThatOnlyPointBackToLocalCache() {
    assert.equal(isExactLocalGameReusable({
      date: "2026-05-11",
      opponent: "Diamondbacks",
      canonicalGameSource: {
        source: "local/public-data",
        stale: false
      }
    }, "2026-05-11"), false);
  },
  function resolvesExternalGameDateFromOfficialDate() {
    assert.equal(resolveExternalGameDate({
      officialDate: "2026-05-12",
      gameDate: "2026-05-13T00:10:00Z"
    }), "2026-05-12");
  },
  function rejectsExternalGamesThatDoNotActuallyMatchTargetDate() {
    assert.equal(isExternalGameExactMatch({
      officialDate: "2026-05-10",
      gameDate: "2026-05-11T00:10:00Z"
    }, "2026-05-11"), false);
  },
  function discardsUntrustedCurrentDayCachedGameWhenEndpointPointsToTomorrow() {
    assert.equal(shouldDiscardUntrustedCurrentDayCachedGame(
      {
        date: "2026-05-11",
        opponent: "Diamondbacks",
        status: "upcoming",
        canonicalGameSource: {
          source: "local/public-data",
          stale: false
        }
      },
      "2026-05-11",
      {
        date: "2026-05-12",
        opponent: "Tigers",
        status: "upcoming",
        canonicalGameSource: {
          source: "external/mlb-stats-window",
          stale: false
        }
      }
    ), true);
  },
  function preservesTrustedExternalCurrentDayGame() {
    assert.equal(shouldDiscardUntrustedCurrentDayCachedGame(
      {
        date: "2026-05-11",
        opponent: "Diamondbacks",
        status: "upcoming",
        canonicalGameSource: {
          source: "external/mlb-stats",
          stale: false
        }
      },
      "2026-05-11",
      null
    ), false);
  }
];

let passed = 0;
for (const check of checks) {
  check();
  passed += 1;
  console.log(`ok - ${check.name}`);
}

console.log(`featured-game-state checks passed: ${passed}/${checks.length}`);
