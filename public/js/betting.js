(function () {
  var BRAND = {
    Fanatics: { bg: "#111827", text: "#ffffff", accent: "#ff5910", abbr: "FAN" },
    DraftKings: { bg: "#0b0e12", text: "#53d337", accent: "#53d337", abbr: "DK" },
    FanDuel: { bg: "#0f1923", text: "#1493ff", accent: "#1493ff", abbr: "FD" },
    BetMGM: { bg: "#1a1a2e", text: "#c5a44e", accent: "#c5a44e", abbr: "MGM" },
    Caesars: { bg: "#1b3c2a", text: "#c5a44e", accent: "#c5a44e", abbr: "CZR" }
  };

  var SPORTSBOOK_ORDER = ["Fanatics", "DraftKings", "FanDuel", "BetMGM", "Caesars"];
  var BOOK_ALIASES = {
    Fanatics: ["fanatics"],
    DraftKings: ["draftkings"],
    FanDuel: ["fanduel"],
    BetMGM: ["betmgm"],
    Caesars: ["caesars", "williamhill", "william hill"]
  };

  var OFFERS_URL = "data/betting-offers.json";
  var LIVE_ODDS_URL = "/api/mlb/mets/odds";
  var STATIC_ODDS_URL = "api/mlb/mets/odds.json";
  var SAMPLE_GAME_URL = "data/sample-game.json";
  var DEBUG_ODDS = typeof window !== "undefined"
    && window.location
    && new URLSearchParams(window.location.search).get("debugOdds") === "1";

  var offersData = null;

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function debugOddsLog(label, payload) {
    if (!DEBUG_ODDS || typeof console === "undefined" || !console.debug) return;
    console.debug("[betting]", label, payload);
  }

  function formatTimestamp(value) {
    var ts = Date.parse(value);
    if (!Number.isFinite(ts)) return "Updated recently";
    return "Updated " + new Date(ts).toLocaleString();
  }

  function formatOddsUpdated(value) {
    var ts = Date.parse(value);
    if (!Number.isFinite(ts)) return "Odds updated recently";
    return "Odds updated: " + new Date(ts).toLocaleString();
  }

  function normalizeAmericanOdds(value) {
    var num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function compareAmericanOdds(a, b) {
    return normalizeAmericanOdds(b) - normalizeAmericanOdds(a);
  }

  function isBetterAmericanOdds(candidate, current) {
    var candidateNum = normalizeAmericanOdds(candidate);
    var currentNum = normalizeAmericanOdds(current);
    if (candidateNum == null) return false;
    if (currentNum == null) return true;
    return candidateNum > currentNum;
  }

  function formatAmericanOdds(value) {
    var num = normalizeAmericanOdds(value);
    if (num == null) return "&mdash;";
    return num > 0 ? "+" + num : String(num);
  }

  function formatPoint(value) {
    var num = Number(value);
    if (!Number.isFinite(num)) return "&mdash;";
    return (num > 0 ? "+" : "") + num;
  }

  function formatDecimal(value) {
    var num = Number(value);
    if (!Number.isFinite(num)) return "&mdash;";
    return String(num);
  }

  function normalizeNameKey(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function getBrand(name) {
    return BRAND[name] || { bg: "#002d72", text: "#ffffff", accent: "#ff5910", abbr: String(name || "").slice(0, 3).toUpperCase() };
  }

  function getTodayEt() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  }

  function getEtDateFromIso(value) {
    var ts = Date.parse(value);
    if (!Number.isFinite(ts)) return "";
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date(ts));
  }

  function getEnabledBooks() {
    var source = Array.isArray(offersData && offersData.sportsbooks) ? offersData.sportsbooks : [];
    return SPORTSBOOK_ORDER.map(function (name) {
      return source.find(function (book) {
        return book && book.enabled !== false && book.name === name;
      }) || null;
    }).filter(Boolean);
  }

  function getOfferByBookName(bookName) {
    var source = Array.isArray(offersData && offersData.sportsbooks) ? offersData.sportsbooks : [];
    return source.find(function (book) {
      return book && book.name === bookName;
    }) || null;
  }

  function getReferralUrl(bookName) {
    var offer = getOfferByBookName(bookName);
    return offer ? String(offer.referralUrl || "").trim() : "";
  }

  function renderBadgeRow() {
    var row = document.getElementById("sportsbook-badge-row");
    if (!row) return;

    var books = getEnabledBooks();
    if (!books.length) {
      row.innerHTML = '<div class="bet-empty">Sportsbook links are not available yet.</div>';
      return;
    }

    row.innerHTML = books.map(function (book) {
      var brand = getBrand(book.name);
      var referralUrl = String(book.referralUrl || "").trim();
      var openAttrs = referralUrl
        ? ' href="' + escapeHtml(referralUrl) + '" target="_blank" rel="sponsored nofollow noopener noreferrer"'
        : "";
      return (
        '<a class="book-badge"' + openAttrs + ">" +
          '<div class="book-badge-logo" style="background:' + brand.bg + ';">' +
            '<span style="color:' + brand.text + ';">' + escapeHtml(book.name) + "</span>" +
          "</div>" +
          '<div class="book-badge-copy">' +
            "<span>Open book</span>" +
            '<em style="color:' + brand.accent + ';">' + escapeHtml(brand.abbr) + "</em>" +
          "</div>" +
        "</a>"
      );
    }).join("");
  }

  function findTodayGame(sampleGame) {
    var todayEt = getTodayEt();
    var games = Array.isArray(sampleGame && sampleGame.games) ? sampleGame.games : [];
    return games.find(function (game) {
      if (!game || game.date !== todayEt) return false;
      var status = String(game.status || "").toLowerCase();
      return status !== "final" && status !== "postponed" && status !== "cancelled";
    }) || null;
  }

  function oddsMatchGame(oddsData, todayGame) {
    if (!oddsData || !todayGame) return false;
    var raw = oddsData.raw || {};
    var context = oddsData.context || {};
    var teams = [raw.home_team, raw.away_team, context.homeTeam && context.homeTeam.name, context.awayTeam && context.awayTeam.name].filter(Boolean);
    if (teams.indexOf("New York Mets") === -1) return false;
    if (todayGame.opponent && teams.indexOf(todayGame.opponent) === -1) return false;
    var eventDate = getEtDateFromIso(raw.commence_time || context.startTime || oddsData.startTime || "");
    return !eventDate || eventDate === todayGame.date;
  }

  function normalizeBookKey(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function findBookmaker(bookmakers, bookName) {
    var aliases = BOOK_ALIASES[bookName] || [bookName];
    return (Array.isArray(bookmakers) ? bookmakers : []).find(function (bookmaker) {
      var key = normalizeBookKey(bookmaker && bookmaker.key);
      var title = normalizeBookKey(bookmaker && bookmaker.title);
      return aliases.some(function (alias) {
        var normalized = normalizeBookKey(alias);
        return key.indexOf(normalized) !== -1 || title.indexOf(normalized) !== -1;
      });
    }) || null;
  }

  function findMarket(markets, key) {
    return Array.isArray(markets) ? markets.find(function (market) {
      return String(market && market.key || "").toLowerCase() === String(key || "").toLowerCase();
    }) : null;
  }

  function findOutcome(outcomes, name) {
    return Array.isArray(outcomes) ? outcomes.find(function (outcome) {
      return String(outcome && outcome.name || "").toLowerCase() === String(name || "").toLowerCase();
    }) : null;
  }

  function buildBookRow(book, oddsData) {
    var bookmaker = findBookmaker(oddsData && oddsData.bookmakers, book.name);
    var h2h = findMarket(bookmaker && bookmaker.markets, "h2h");
    var spreads = findMarket(bookmaker && bookmaker.markets, "spreads");
    var totals = findMarket(bookmaker && bookmaker.markets, "totals");
    var metsMl = findOutcome(h2h && h2h.outcomes, "New York Mets");
    var metsRunLine = findOutcome(spreads && spreads.outcomes, "New York Mets");
    var totalOver = findOutcome(totals && totals.outcomes, "Over");
    var totalUnder = findOutcome(totals && totals.outcomes, "Under");

    return {
      name: book.name,
      referralUrl: String(book.referralUrl || "").trim(),
      metsMlPrice: normalizeAmericanOdds(metsMl && metsMl.price),
      runLinePrice: normalizeAmericanOdds(metsRunLine && metsRunLine.price),
      runLinePoint: metsRunLine && Number.isFinite(Number(metsRunLine.point)) ? Number(metsRunLine.point) : null,
      overPrice: normalizeAmericanOdds(totalOver && totalOver.price),
      underPrice: normalizeAmericanOdds(totalUnder && totalUnder.price),
      totalPoint: totalOver && Number.isFinite(Number(totalOver.point)) ? Number(totalOver.point) : (
        totalUnder && Number.isFinite(Number(totalUnder.point)) ? Number(totalUnder.point) : null
      )
    };
  }

  function getBestValues(rows) {
    var best = {
      bestMl: null,
      bestRunLine: null,
      bestOver: null,
      bestUnder: null
    };

    rows.forEach(function (row) {
      if (isBetterAmericanOdds(row.metsMlPrice, best.bestMl)) best.bestMl = row.metsMlPrice;
      if (isBetterAmericanOdds(row.runLinePrice, best.bestRunLine)) best.bestRunLine = row.runLinePrice;
      if (isBetterAmericanOdds(row.overPrice, best.bestOver)) best.bestOver = row.overPrice;
      if (isBetterAmericanOdds(row.underPrice, best.bestUnder)) best.bestUnder = row.underPrice;
    });

    return best;
  }

  function renderLinkedValue(contentHtml, referralUrl, isBest) {
    var content = isBest
      ? '<span class="best-odds">' + contentHtml + '<span class="best-flag">Best</span></span>'
      : '<span class="odds-cell">' + contentHtml + "</span>";
    if (!referralUrl) return content;
    return '<a href="' + escapeHtml(referralUrl) + '" target="_blank" rel="sponsored nofollow noopener noreferrer">' + content + "</a>";
  }

  function renderBookLink(bookName, referralUrl) {
    if (!referralUrl) {
      return '<span class="sportsbook-link">' + escapeHtml(bookName) + "</span>";
    }
    return '<a class="sportsbook-link" href="' + escapeHtml(referralUrl) + '" target="_blank" rel="sponsored nofollow noopener noreferrer">' + escapeHtml(bookName) + "</a>";
  }

  function renderGameOddsTable(oddsData) {
    var books = getEnabledBooks();
    var rows = books.map(function (book) {
      return buildBookRow(book, oddsData);
    });
    var best = getBestValues(rows);

    var body = rows.map(function (row) {
      var mlHtml = row.metsMlPrice == null
        ? '<span class="odds-muted">&mdash;</span>'
        : escapeHtml(formatAmericanOdds(row.metsMlPrice));
      var runLineHtml = row.runLinePrice == null || row.runLinePoint == null
        ? '<span class="odds-muted">&mdash;</span>'
        : escapeHtml(formatPoint(row.runLinePoint)) + " (" + escapeHtml(formatAmericanOdds(row.runLinePrice)) + ")";
      var overHtml = row.totalPoint == null || row.overPrice == null
        ? '<span class="odds-muted">&mdash;</span>'
        : "O " + escapeHtml(formatDecimal(row.totalPoint)) + " (" + escapeHtml(formatAmericanOdds(row.overPrice)) + ")";
      var underHtml = row.totalPoint == null || row.underPrice == null
        ? '<span class="odds-muted">&mdash;</span>'
        : "U " + escapeHtml(formatDecimal(row.totalPoint)) + " (" + escapeHtml(formatAmericanOdds(row.underPrice)) + ")";
      var totalHtml = row.totalPoint == null || row.overPrice == null || row.underPrice == null
        ? '<span class="odds-muted">&mdash;</span>'
        : renderLinkedValue(overHtml, row.referralUrl, row.overPrice === best.bestOver)
          + '<span class="odds-separator">/</span>'
          + renderLinkedValue(underHtml, row.referralUrl, row.underPrice === best.bestUnder);

      return (
        "<tr>" +
          "<td>" + renderBookLink(row.name, row.referralUrl) + "</td>" +
          "<td>" + renderLinkedValue(mlHtml, row.referralUrl, row.metsMlPrice != null && row.metsMlPrice === best.bestMl) + "</td>" +
          "<td>" + renderLinkedValue(runLineHtml, row.referralUrl, row.runLinePrice != null && row.runLinePrice === best.bestRunLine) + "</td>" +
          '<td class="odds-total-cell">' + totalHtml + "</td>" +
        "</tr>"
      );
    }).join("");

    var missingBooks = Array.isArray(oddsData && oddsData.diagnostics && oddsData.diagnostics.missingTrackedSportsbooks)
      ? oddsData.diagnostics.missingTrackedSportsbooks
      : [];
    var feedNote = missingBooks.length
      ? "Current feed does not list " + missingBooks.join(", ") + ", so those cells show \u2014."
      : "Books without a live price in the current feed are shown as \u2014.";

    return (
      '<div class="odds-table-wrap">' +
        '<table class="odds-table">' +
          "<thead><tr><th>Sportsbook</th><th>Mets ML</th><th>Mets Run Line</th><th>Over/Under</th></tr></thead>" +
          "<tbody>" + body + "</tbody>" +
        "</table>" +
      "</div>" +
      '<div class="odds-note">Best available Mets prices are highlighted in green. ' + escapeHtml(feedNote) + "</div>"
    );
  }

  function getPropBookmakers(oddsData) {
    return Array.isArray(oddsData && oddsData.props && oddsData.props.bookmakers) ? oddsData.props.bookmakers : [];
  }

  function extractPlayerNameFromOutcome(outcome, marketKey) {
    var description = String(outcome && outcome.description || "").trim();
    var name = String(outcome && outcome.name || "").trim();
    if (description) return description;
    if (marketKey === "player_strikeouts" && /^(over|under)$/i.test(name)) return "";
    if (marketKey === "player_home_runs" && /^(yes|no)$/i.test(name)) return "";
    return name;
  }

  function collectPlayerPropOutcomes(oddsData, marketKey) {
    var rows = [];
    getPropBookmakers(oddsData).forEach(function (bookmaker) {
      var market = findMarket(bookmaker && bookmaker.markets, marketKey);
      if (!market || !Array.isArray(market.outcomes)) return;

      market.outcomes.forEach(function (outcome) {
        var playerName = extractPlayerNameFromOutcome(outcome, marketKey);
        var odds = normalizeAmericanOdds(outcome && outcome.price);
        if (!playerName || odds == null) return;

        rows.push({
          bookName: bookmaker.title || bookmaker.key || "Bookmaker",
          referralUrl: getReferralUrl(bookmaker.title || bookmaker.key || ""),
          marketKey: marketKey,
          playerName: playerName,
          playerKey: normalizeNameKey(playerName),
          side: String(outcome && outcome.name || "").trim(),
          line: Number.isFinite(Number(outcome && outcome.point)) ? Number(outcome.point) : null,
          odds: odds
        });
      });
    });

    return rows;
  }

  function getPrimaryLine(entries) {
    var counts = {};
    (Array.isArray(entries) ? entries : []).forEach(function (entry) {
      if (!Number.isFinite(entry && entry.line)) return;
      var key = String(entry.line);
      counts[key] = (counts[key] || 0) + 1;
    });

    var bestKey = null;
    var bestCount = 0;
    Object.keys(counts).forEach(function (key) {
      if (counts[key] > bestCount) {
        bestCount = counts[key];
        bestKey = key;
      }
    });

    return bestKey == null ? null : Number(bestKey);
  }

  function getBestPrices(outcomes, side, maxCount, line) {
    var filtered = (Array.isArray(outcomes) ? outcomes : []).filter(function (entry) {
      if (!entry || entry.odds == null) return false;
      if (side && String(entry.side || "").toLowerCase() !== String(side).toLowerCase()) return false;
      if (line != null && Number.isFinite(line) && Number.isFinite(entry.line) && entry.line !== line) return false;
      if (line != null && Number.isFinite(line) && entry.line == null) return false;
      return true;
    });

    var bestByBook = {};
    filtered.forEach(function (entry) {
      var key = normalizeNameKey(entry.bookName + "|" + entry.side + "|" + entry.playerName + "|" + (entry.line == null ? "" : entry.line));
      if (!bestByBook[key] || isBetterAmericanOdds(entry.odds, bestByBook[key].odds)) {
        bestByBook[key] = entry;
      }
    });

    return Object.keys(bestByBook)
      .map(function (key) { return bestByBook[key]; })
      .sort(function (a, b) {
        var oddsSort = compareAmericanOdds(a.odds, b.odds);
        if (oddsSort !== 0) return oddsSort;
        return String(a.bookName || "").localeCompare(String(b.bookName || ""));
      })
      .slice(0, maxCount || 3);
  }

  function buildPitcherStrikeoutRows(oddsData, nextGame) {
    var probablePitchers = [
      nextGame && nextGame.probablePitchers && nextGame.probablePitchers.mets,
      nextGame && nextGame.probablePitchers && nextGame.probablePitchers.opp
    ].filter(function (pitcher) {
      return pitcher && pitcher.fullName;
    });
    var allEntries = collectPlayerPropOutcomes(oddsData, "player_strikeouts");

    return probablePitchers.map(function (pitcher) {
      var playerEntries = allEntries.filter(function (entry) {
        return entry.playerKey === normalizeNameKey(pitcher.fullName);
      });
      if (!playerEntries.length) return null;

      var line = getPrimaryLine(playerEntries);
      var over = getBestPrices(playerEntries, "Over", 3, line);
      var under = getBestPrices(playerEntries, "Under", 3, line);
      if (!over.length && !under.length) return null;

      return {
        label: pitcher.fullName + (line != null ? " O/U " + formatDecimal(line) : ""),
        over: over,
        under: under
      };
    }).filter(Boolean);
  }

  function buildHomeRunRows(oddsData, lineup) {
    var hitters = Array.isArray(lineup) ? lineup : [];
    if (!hitters.length) return [];

    var allEntries = collectPlayerPropOutcomes(oddsData, "player_home_runs");
    return hitters.map(function (player) {
      var playerEntries = allEntries.filter(function (entry) {
        return entry.playerKey === normalizeNameKey(player.name);
      });
      var yesPrices = getBestPrices(playerEntries, "Yes", 3, null);
      var fallbackPrices = yesPrices.length ? yesPrices : getBestPrices(playerEntries, null, 3, null);
      if (!fallbackPrices.length) return null;

      return {
        playerName: player.name,
        order: Number(player.order) || 99,
        prices: fallbackPrices
      };
    }).filter(Boolean);
  }

  function formatBookPrice(bookName, odds, line, side, referralUrl) {
    var sidePrefix = "";
    if (side && /^(over|under)$/i.test(side)) {
      sidePrefix = String(side).slice(0, 1).toUpperCase() + " ";
    }
    var linePart = Number.isFinite(line) ? formatDecimal(line) + " " : "";
    var oddsPart = formatAmericanOdds(odds);
    var bookLabel = referralUrl
      ? '<a class="prop-book-link" href="' + escapeHtml(referralUrl) + '" target="_blank" rel="sponsored nofollow noopener noreferrer">' + escapeHtml(bookName) + "</a>"
      : '<span class="prop-book-link">' + escapeHtml(bookName) + "</span>";
    return (
      '<span class="prop-pill">' +
        bookLabel +
        '<span class="prop-pill-copy">' + escapeHtml((sidePrefix + linePart + oddsPart).trim()) + "</span>" +
      "</span>"
    );
  }

  function renderPropPriceList(prices) {
    if (!Array.isArray(prices) || !prices.length) {
      return '<span class="odds-muted">&mdash;</span>';
    }

    return '<div class="prop-price-list">' + prices.map(function (entry, index) {
      return (
        '<div class="prop-price-item' + (index === 0 ? " prop-price-item-best" : "") + '">' +
          formatBookPrice(entry.bookName, entry.odds, entry.line, entry.side, entry.referralUrl) +
        "</div>"
      );
    }).join("") + "</div>";
  }

  function renderPitcherPropsSection(rows) {
    if (!rows.length) {
      return (
        '<section class="prop-section">' +
          "<h3>Starting Pitcher Strikeout Props</h3>" +
          '<div class="prop-unavailable">Pitcher strikeout props are not available yet for this game.</div>' +
        "</section>"
      );
    }

    var body = rows.map(function (row) {
      return (
        "<tr>" +
          "<td>" + escapeHtml(row.label) + "</td>" +
          "<td>" + renderPropPriceList(row.over) + "</td>" +
          "<td>" + renderPropPriceList(row.under) + "</td>" +
        "</tr>"
      );
    }).join("");

    return (
      '<section class="prop-section">' +
        "<h3>Starting Pitcher Strikeout Props</h3>" +
        '<div class="prop-table-wrap">' +
          '<table class="prop-table prop-table-wide">' +
            "<thead><tr><th>Pitcher Prop</th><th>Best Over Lines</th><th>Best Under Lines</th></tr></thead>" +
            "<tbody>" + body + "</tbody>" +
          "</table>" +
        "</div>" +
      "</section>"
    );
  }

  function renderHomeRunSection(title, rows) {
    if (!rows.length) {
      return (
        '<section class="prop-section">' +
          "<h3>" + escapeHtml(title) + "</h3>" +
          '<div class="prop-unavailable">' + escapeHtml(title === "Mets Batter Home Run Props"
            ? "Mets home run props are not available yet for this game."
            : "Opponent home run props are not available yet for this game.") + "</div>" +
        "</section>"
      );
    }

    var body = rows.map(function (row) {
      var cells = [0, 1, 2].map(function (index) {
        var price = row.prices[index];
        return "<td>" + (price ? renderPropPriceList([price]) : '<span class="odds-muted">&mdash;</span>') + "</td>";
      }).join("");

      return "<tr><td>" + escapeHtml(row.playerName) + "</td>" + cells + "</tr>";
    }).join("");

    return (
      '<section class="prop-section">' +
        "<h3>" + escapeHtml(title) + "</h3>" +
        '<div class="prop-table-wrap">' +
          '<table class="prop-table">' +
            "<thead><tr><th>Batter</th><th>Best HR Price</th><th>2nd Best</th><th>3rd Best</th></tr></thead>" +
            "<tbody>" + body + "</tbody>" +
          "</table>" +
        "</div>" +
      "</section>"
    );
  }

  function renderOddsContent(todayGame, oddsData) {
    var state = document.getElementById("odds-comparison-state");
    var subtitle = document.getElementById("odds-panel-subtitle");
    var updated = document.getElementById("odds-panel-updated");
    if (!state) return;

    if (!todayGame) {
      if (subtitle) subtitle.textContent = "The sportsbook links stay live even when the Mets are off.";
      if (updated) updated.textContent = "No game scheduled today";
      state.innerHTML = '<div class="no-game-state">No Mets game today - check back tomorrow.</div>';
      return;
    }

    if (subtitle) {
      subtitle.textContent = "New York Mets vs " + todayGame.opponent + " • " + todayGame.time;
    }
    if (updated) {
      updated.textContent = formatOddsUpdated((oddsData && oddsData.meta && oddsData.meta.generatedAt) || (offersData && offersData.lastUpdated) || todayGame.date);
    }

    if (!oddsData || !oddsMatchGame(oddsData, todayGame)) {
      state.innerHTML = '<div class="bet-empty">Odds temporarily unavailable - check back soon.</div>';
      return;
    }

    debugOddsLog("Live odds diagnostics", oddsData.diagnostics || null);
    debugOddsLog("Raw game odds response", oddsData.raw || null);
    debugOddsLog("Raw props response", oddsData.props && oddsData.props.raw ? oddsData.props.raw : null);

    var contextGame = oddsData.context || null;
    var pitcherRows = buildPitcherStrikeoutRows(oddsData, contextGame);
    var metsHrRows = buildHomeRunRows(oddsData, contextGame && contextGame.lineups && contextGame.lineups.mets);
    var oppHrRows = buildHomeRunRows(oddsData, contextGame && contextGame.lineups && contextGame.lineups.opp);

    state.innerHTML =
      renderGameOddsTable(oddsData) +
      renderPitcherPropsSection(pitcherRows) +
      renderHomeRunSection("Mets Batter Home Run Props", metsHrRows) +
      (oppHrRows.length ? renderHomeRunSection("Opponent Batter Home Run Props", oppHrRows) : "");
  }

  async function fetchJsonOrNull(url) {
    try {
      var response = await fetch(url, { cache: "no-store" });
      if (!response.ok) return null;
      return response.json();
    } catch (error) {
      return null;
    }
  }

  async function fetchOddsPayload() {
    var liveUrl = LIVE_ODDS_URL + (DEBUG_ODDS ? "?debug=1" : "");
    var livePayload = await fetchJsonOrNull(liveUrl);
    if (livePayload && !livePayload.error) {
      return livePayload;
    }
    return fetchJsonOrNull(STATIC_ODDS_URL);
  }

  async function init() {
    try {
      var responses = await Promise.all([
        fetch(OFFERS_URL, { cache: "no-store" }),
        fetchOddsPayload(),
        fetchJsonOrNull(SAMPLE_GAME_URL)
      ]);

      var offersResponse = responses[0];
      var oddsData = responses[1];
      var sampleGame = responses[2];

      if (!offersResponse.ok) {
        throw new Error("Betting offers request failed with " + offersResponse.status);
      }

      offersData = await offersResponse.json();

      var disclosure = document.getElementById("affiliate-disclosure");
      var responsible = document.getElementById("responsible-gaming");
      var updated = document.getElementById("betting-updated");
      var todayGame = findTodayGame(sampleGame);

      if (disclosure) disclosure.textContent = offersData.affiliateDisclosure || "";
      if (responsible) responsible.textContent = (offersData.responsibleGaming || "") + " Users are responsible for confirming eligibility, location restrictions, and sportsbook terms.";
      if (updated) updated.textContent = formatTimestamp((oddsData && oddsData.meta && oddsData.meta.generatedAt) || offersData.lastUpdated);

      renderBadgeRow();
      renderOddsContent(todayGame, oddsData);
    } catch (error) {
      console.error("Failed to load betting hub data:", error);
      var badgeRow = document.getElementById("sportsbook-badge-row");
      var oddsState = document.getElementById("odds-comparison-state");
      if (badgeRow) badgeRow.innerHTML = '<div class="bet-empty">Sportsbook links are not available yet.</div>';
      if (oddsState) oddsState.innerHTML = '<div class="bet-empty">Odds temporarily unavailable - check back soon.</div>';
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
