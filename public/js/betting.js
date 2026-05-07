(function () {
  var BRAND = {
    'Fanatics': { color: '#000000', bg: '#000', text: '#fff', accent: '#e8380d', abbr: 'FAN' },
    'DraftKings': { color: '#53d337', bg: '#0b0e12', text: '#53d337', accent: '#53d337', abbr: 'DK' },
    'FanDuel': { color: '#1493ff', bg: '#0f1923', text: '#1493ff', accent: '#1493ff', abbr: 'FD' },
    'BetMGM': { color: '#c5a44e', bg: '#1a1a2e', text: '#c5a44e', accent: '#c5a44e', abbr: 'MGM' },
    'Caesars': { color: '#1b6b4a', bg: '#1b3c2a', text: '#c5a44e', accent: '#1b6b4a', abbr: 'CZR' },
  };

  function getBrand(name) {
    return BRAND[name] || { color: '#002d72', bg: '#002d72', text: '#fff', accent: '#ff5910', abbr: (name||'').slice(0,3).toUpperCase() };
  }

  function buildLogoSvg(name) {
    var b = getBrand(name);
    return '<div style="width:100%;height:56px;background:' + b.bg + ';border-radius:10px;display:flex;align-items:center;justify-content:center;margin-bottom:0.6rem;">' +
      '<span style="font-family:Oswald,sans-serif;font-size:1.3rem;font-weight:700;color:' + b.text + ';letter-spacing:0.03em;text-transform:uppercase;">' + escapeHtml(name) + '</span>' +
      '</div>';
  }

  const OFFERS_URL = "data/betting-offers.json";
  const ODDS_URL = "api/mlb/mets/odds.json";
  const SAMPLE_GAME_URL = "data/sample-game.json";
  const FILTERS = ["All", "Game Lines", "Player Props", "Futures", "Promos", "Beginner Friendly"];
  const MARKET_SECTIONS = [
    "Today's Mets Game",
    "Moneyline",
    "Run Line",
    "Total",
    "Player Home Runs",
    "Pitcher Strikeouts",
    "Hits/RBI Props",
    "Futures",
    "Promos/Boosts"
  ];

  let offersData = null;
  let activeFilter = "All";

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatTimestamp(value) {
    const ts = Date.parse(value);
    if (!Number.isFinite(ts)) return "Updated recently";
    return `Updated ${new Date(ts).toLocaleString()}`;
  }

  function formatOdds(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "—";
    return num > 0 ? `+${num}` : `${num}`;
  }

  function renderFilterButtons() {
    const wrap = document.getElementById("betting-filters");
    if (!wrap) return;
    wrap.innerHTML = FILTERS.map((filter) => {
      const active = filter === activeFilter ? " active" : "";
      return `<button class="bet-filter${active}" type="button" data-filter="${escapeHtml(filter)}">${escapeHtml(filter)}</button>`;
    }).join("");

    wrap.querySelectorAll(".bet-filter").forEach((button) => {
      button.addEventListener("click", () => {
        activeFilter = button.getAttribute("data-filter") || "All";
        renderSportsbookCards();
        renderFilterButtons();
      });
    });
  }

  function sportsbookMatchesFilter(book) {
    if (activeFilter === "All") return true;
    const tags = Array.isArray(book.tags) ? book.tags : [];
    return tags.includes(activeFilter);
  }

  function renderSportsbookCards() {
    const grid = document.getElementById("sportsbook-grid");
    if (!grid) return;

    const books = Array.isArray(offersData?.sportsbooks) ? offersData.sportsbooks.filter((book) => book?.enabled !== false) : [];
    const filtered = books.filter(sportsbookMatchesFilter);

    if (!filtered.length) {
      grid.innerHTML = '<div class="bet-empty">No sportsbook offers match this filter yet.</div>';
      return;
    }

    grid.innerHTML = filtered.map((book) => {
      const hasLink = !!String(book.referralUrl || "").trim();
      const markets = Array.isArray(book.markets) ? book.markets : [];
      const tags = Array.isArray(book.tags) ? book.tags : [];
      var brand = getBrand(book.name);
      return `<article class="book-card" style="border-top:4px solid ${brand.color};">
        ${buildLogoSvg(book.name)}
        <div class="book-card-head">
          <div>
            <span class="book-kicker" style="color:${brand.color};">${escapeHtml(book.category || "Sportsbook")}</span>
            <h3>${escapeHtml(book.name || "Sportsbook")}</h3>
          </div>
          <span class="book-bestfor">${escapeHtml(book.bestFor || "")}</span>
        </div>
        <p class="book-offer">${escapeHtml(book.offerText || "Offer details coming soon.")}</p>
        <div class="book-block">
          <strong>Markets</strong>
          <div class="book-pill-wrap">
            ${markets.map((market) => '<span class="book-pill">' + escapeHtml(market) + '</span>').join("")}
          </div>
        </div>
        ${tags.length ? '<div class="book-block"><strong>Best fit</strong><div class="book-pill-wrap">' + tags.map((tag) => '<span class="book-pill muted">' + escapeHtml(tag) + '</span>').join("") + '</div></div>' : ""}
        ${book.stateNote ? '<p class="book-note">' + escapeHtml(book.stateNote) + '</p>' : ""}
        ${hasLink
          ? '<a class="book-cta" href="' + escapeHtml(book.referralUrl) + '" target="_blank" rel="sponsored nofollow noopener noreferrer" style="background:' + brand.color + ';">View Offer</a>'
          : '<button class="book-cta disabled" type="button" disabled>Link coming soon</button>'}
      </article>`;
    }).join("");
  }

  function renderMarkets() {
    const wrap = document.getElementById("markets-grid");
    if (!wrap) return;
    wrap.innerHTML = MARKET_SECTIONS.map((label) => {
      const copy = label === "Today's Mets Game"
        ? "Start with the current Mets side, total, and run line before shopping books."
        : label === "Moneyline"
          ? "Track straight-up Mets prices and compare consensus vs book-specific numbers."
          : label === "Run Line"
            ? "Watch alternate spreads and standard -1.5/+1.5 pricing for the Mets matchup."
            : label === "Total"
              ? "Compare over/under movement and book-to-book totals for today's game."
              : label === "Player Home Runs"
                ? "Use this section for power props tied to Mets hitters and opposing sluggers."
                : label === "Pitcher Strikeouts"
                  ? "Monitor strikeout ladders and standard K props for today's starters."
                  : label === "Hits/RBI Props"
                    ? "Check hit, total bases, RBI, and combo props once books post the card."
                    : label === "Futures"
                      ? "Track Mets division, pennant, World Series, and season award prices."
                      : "Use boosts carefully and always confirm the exact house terms before placing a bet.";
      return `<div class="market-card"><h3>${escapeHtml(label)}</h3><p>${escapeHtml(copy)}</p></div>`;
    }).join("");
  }

  function findMarket(markets, key) {
    return Array.isArray(markets) ? markets.find((market) => String(market?.key || "").toLowerCase() === key) : null;
  }

  function renderLinesCard(sampleGame, oddsData) {
    const card = document.getElementById("today-lines-card");
    if (!card) return;

    const markets = Array.isArray(oddsData?.markets) ? oddsData.markets : [];
    const h2h = findMarket(markets, "h2h");
    const spreads = findMarket(markets, "spreads");
    const totals = findMarket(markets, "totals");
    const opponent = sampleGame?.games?.find((game) => game?.date === sampleGame?.generatedAt?.slice?.(0, 10))?.opponent
      || sampleGame?.games?.[0]?.opponent
      || "Opponent";

    if (!h2h && !spreads && !totals) {
      card.innerHTML = '<div class="bet-empty">Live Mets odds can be connected here from the existing odds feed.</div>';
      return;
    }

    const metsMl = h2h?.outcomes?.find((outcome) => outcome?.name === "New York Mets")?.price;
    const oppMl = h2h?.outcomes?.find((outcome) => outcome?.name && outcome.name !== "New York Mets")?.price;
    const metsSpread = spreads?.outcomes?.find((outcome) => outcome?.name === "New York Mets");
    const totalOver = totals?.outcomes?.find((outcome) => outcome?.name === "Over");
    const updated = oddsData?.meta?.generatedAt || oddsData?.generatedAt;

    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.75rem;">
        <img src="https://www.mlbstatic.com/team-logos/121.svg" alt="Mets" width="32" height="32" style="flex-shrink:0;">
        <div><div style="font-weight:800;color:#002d72;font-size:0.95rem;">New York Mets</div>
        <div style="font-size:0.72rem;color:#6b7280;">Today's betting lines</div></div></div>
      <div class="lines-header">
        <div>
          <h3>Today's Mets Lines</h3>
          <p>${escapeHtml(opponent)} vs Mets from the existing odds cache.</p>
        </div>
        <span class="lines-updated">${escapeHtml(formatTimestamp(updated))}</span>
      </div>
      <div class="lines-grid">
        <div class="line-tile">
          <span class="line-label">Moneyline</span>
          <strong>Mets ${escapeHtml(formatOdds(metsMl))}</strong>
          <small>${escapeHtml(opponent)} ${escapeHtml(formatOdds(oppMl))}</small>
        </div>
        <div class="line-tile">
          <span class="line-label">Run Line</span>
          <strong>${metsSpread ? `Mets ${formatOdds(metsSpread.price)} (${metsSpread.point > 0 ? "+" : ""}${metsSpread.point})` : "—"}</strong>
          <small>Standard spread from the current feed</small>
        </div>
        <div class="line-tile">
          <span class="line-label">Total</span>
          <strong>${totalOver ? `${totalOver.point}` : "—"}</strong>
          <small>${totalOver ? `Over ${formatOdds(totalOver.price)}` : "Market not available"}</small>
        </div>
      </div>
    `;
  }

  async function init() {
    renderMarkets();
    try {
      const [offersResponse, oddsResponse, sampleResponse] = await Promise.all([
        fetch(OFFERS_URL, { cache: "no-store" }),
        fetch(ODDS_URL, { cache: "no-store" }).catch(() => null),
        fetch(SAMPLE_GAME_URL, { cache: "no-store" }).catch(() => null)
      ]);

      if (!offersResponse.ok) throw new Error(`Betting offers request failed with ${offersResponse.status}`);
      offersData = await offersResponse.json();
      const oddsData = oddsResponse && oddsResponse.ok ? await oddsResponse.json() : null;
      const sampleGame = sampleResponse && sampleResponse.ok ? await sampleResponse.json() : null;

      const disclosure = document.getElementById("affiliate-disclosure");
      const responsible = document.getElementById("responsible-gaming");
      const updated = document.getElementById("betting-updated");

      if (disclosure) disclosure.textContent = offersData?.affiliateDisclosure || "";
      if (responsible) responsible.textContent = `${offersData?.responsibleGaming || ""} Users are responsible for confirming eligibility, location restrictions, and sportsbook terms.`;
      if (updated) updated.textContent = formatTimestamp(offersData?.lastUpdated);

      renderFilterButtons();
      renderSportsbookCards();
      renderLinesCard(sampleGame, oddsData);
    } catch (error) {
      console.error("Failed to load betting hub data:", error);
      const grid = document.getElementById("sportsbook-grid");
      if (grid) grid.innerHTML = '<div class="bet-empty">Betting offers are not available yet.</div>';
      const lines = document.getElementById("today-lines-card");
      if (lines) lines.innerHTML = '<div class="bet-empty">Live Mets odds can be connected here from the existing odds feed.</div>';
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
