function formatAmericanOdds(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return value > 0 ? `+${value}` : `${value}`;
}

function findMoneylineMarket(payload) {
  const markets = Array.isArray(payload?.markets) ? payload.markets : [];
  return markets.find((market) => String(market?.key || "").toLowerCase() === "h2h") || null;
}

function findOutcomePrice(market, teamName) {
  if (!market || !teamName) return null;
  const outcome = Array.isArray(market?.outcomes)
    ? market.outcomes.find((entry) => String(entry?.name || "") === teamName)
    : null;
  return typeof outcome?.price === "number" && Number.isFinite(outcome.price) ? outcome.price : null;
}

async function updateReportOddsRow() {
  try {
    const [sampleGameResponse, oddsResponse] = await Promise.all([
      fetch("data/sample-game.json"),
      fetch("api/mlb/mets/odds")
    ]);

    if (!sampleGameResponse.ok || !oddsResponse.ok) return;

    const sampleGame = await sampleGameResponse.json();
    const oddsPayload = await oddsResponse.json();
    const game = Array.isArray(sampleGame?.games) ? sampleGame.games[0] : null;
    if (!game) return;

    const market = findMoneylineMarket(oddsPayload);
    if (!market) return;

    const metsOdds = findOutcomePrice(market, "New York Mets");
    const opponentName = String(game?.opponent || "");
    const oppOdds = findOutcomePrice(market, opponentName);
    if (metsOdds == null && oppOdds == null) return;

    const oddsRow = Array.from(document.querySelectorAll(".report-summary-table tbody tr"))
      .find((row) => row.children?.[1]?.textContent?.trim() === "Odds");
    if (!oddsRow) return;

    if (metsOdds != null) oddsRow.children[0].textContent = formatAmericanOdds(metsOdds);
    if (oppOdds != null) oddsRow.children[2].textContent = formatAmericanOdds(oppOdds);
  } catch (error) {
    console.warn("Unable to refresh report odds from live cache.", error);
  }
}

updateReportOddsRow();
