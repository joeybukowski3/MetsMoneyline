const { resolveArchivedOdds } = require("../bot/lib/odds-history");

function buildArchivedOddsFallbackPayload(history, targetGame) {
  if (!history || !targetGame) return null;

  const isMetsHome = typeof targetGame?.isMetsHome === "boolean"
    ? targetGame.isMetsHome
    : String(targetGame?.homeAway || "").toLowerCase() === "home";
  const homeTeamName = targetGame?.homeTeam?.name || targetGame?.home?.name || (isMetsHome ? "New York Mets" : null);
  const awayTeamName = targetGame?.awayTeam?.name || targetGame?.away?.name || (!isMetsHome ? "New York Mets" : null);
  const opponent = targetGame?.opponent || (isMetsHome ? awayTeamName : homeTeamName);
  const startTime = targetGame?.startTime || targetGame?.date || null;
  const date = targetGame?.date || targetGame?.startTime || null;
  const archivedOdds = resolveArchivedOdds(history, {
    date,
    startTime,
    opponent,
    homeAway: isMetsHome ? "home" : "road"
  });

  if (!archivedOdds) return null;

  const metsTeamName = isMetsHome ? (homeTeamName || "New York Mets") : (awayTeamName || "New York Mets");
  const oppTeamName = isMetsHome ? awayTeamName : homeTeamName;
  const outcomes = [];

  if (oppTeamName && typeof archivedOdds.oppOdds === "number" && Number.isFinite(archivedOdds.oppOdds)) {
    outcomes.push({
      name: oppTeamName,
      price: archivedOdds.oppOdds,
      point: null
    });
  }

  if (metsTeamName && typeof archivedOdds.odds === "number" && Number.isFinite(archivedOdds.odds)) {
    outcomes.push({
      name: metsTeamName,
      price: archivedOdds.odds,
      point: null
    });
  }

  if (!outcomes.length) return null;

  const market = {
    key: "h2h",
    label: "Moneyline",
    outcomes
  };
  const consensus = {
    key: "archived-consensus",
    title: archivedOdds.bookmaker || "Archived Consensus",
    markets: [market]
  };

  return {
    gameId: targetGame?.gameId || null,
    markets: [market],
    bookmakers: [consensus],
    consensus,
    raw: {
      commence_time: startTime,
      home_team: homeTeamName || null,
      away_team: awayTeamName || null,
      source: archivedOdds.source || "odds-history",
      archiveKey: archivedOdds.key || null,
      captured_at: archivedOdds.capturedAt || null
    },
    fallbackSource: archivedOdds.source || "odds-history"
  };
}

module.exports = {
  buildArchivedOddsFallbackPayload
};
