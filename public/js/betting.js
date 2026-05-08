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
  var ODDS_URL = "api/mlb/mets/odds.json";
  var SAMPLE_GAME_URL = "data/sample-game.json";

  var offersData = null;

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatTimestamp(value) {
    var ts = Date.parse(value);
    if (!Number.isFinite(ts)) return "Updated recently";
    return "Updated " + new Date(ts).toLocaleString();
  }

  function formatOdds(value) {
    var num = Number(value);
    if (!Number.isFinite(num)) return "&mdash;";
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
    return num % 1 === 0 ? String(num) : String(num);
  }

  function getBrand(name) {
    return BRAND[name] || { bg: "#002d72", text: "#ffffff", accent: "#ff5910", abbr: String(name || "").slice(0, 3).toUpperCase() };
  }

  function getEnabledBooks() {
    var source = Array.isArray(offersData && offersData.sportsbooks) ? offersData.sportsbooks : [];
    return SPORTSBOOK_ORDER.map(function (name) {
      return source.find(function (book) {
        return book && book.enabled !== false && book.name === name;
      }) || null;
    }).filter(Boolean);
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
    var teams = [raw.home_team, raw.away_team].filter(Boolean);
    if (!teams.includes("New York Mets")) return false;
    if (todayGame.opponent && !teams.includes(todayGame.opponent)) return false;
    var oddsDate = getEtDateFromIso(raw.commence_time || oddsData.startTime || "");
    return !oddsDate || oddsDate === todayGame.date;
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
      return String(market && market.key || "").toLowerCase() === key;
    }) : null;
  }

  function findOutcome(outcomes, name) {
    return Array.isArray(outcomes) ? outcomes.find(function (outcome) {
      return outcome && outcome.name === name;
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
      metsMlPrice: metsMl && Number.isFinite(Number(metsMl.price)) ? Number(metsMl.price) : null,
      runLinePrice: metsRunLine && Number.isFinite(Number(metsRunLine.price)) ? Number(metsRunLine.price) : null,
      runLinePoint: metsRunLine && Number.isFinite(Number(metsRunLine.point)) ? Number(metsRunLine.point) : null,
      overPrice: totalOver && Number.isFinite(Number(totalOver.price)) ? Number(totalOver.price) : null,
      underPrice: totalUnder && Number.isFinite(Number(totalUnder.price)) ? Number(totalUnder.price) : null,
      totalPoint: totalOver && Number.isFinite(Number(totalOver.point)) ? Number(totalOver.point) : (
        totalUnder && Number.isFinite(Number(totalUnder.point)) ? Number(totalUnder.point) : null
      )
    };
  }

  function getBestValues(rows) {
    function maxNumeric(values) {
      var nums = values.filter(function (value) {
        return Number.isFinite(value);
      });
      return nums.length ? Math.max.apply(null, nums) : null;
    }

    var bestMl = maxNumeric(rows.map(function (row) { return row.metsMlPrice; }));
    var bestRunLine = maxNumeric(rows.map(function (row) { return row.runLinePrice; }));
    var bestTotalScore = null;

    rows.forEach(function (row) {
      if (!Number.isFinite(row.totalPoint) || !Number.isFinite(row.overPrice)) return;
      var score = (row.totalPoint * 1000) + row.overPrice;
      if (bestTotalScore == null || score > bestTotalScore) bestTotalScore = score;
    });

    return {
      bestMl: bestMl,
      bestRunLine: bestRunLine,
      bestTotalScore: bestTotalScore
    };
  }

  function renderLinkedCell(labelHtml, referralUrl, isBest) {
    var content = isBest
      ? '<span class="best-odds">' + labelHtml + '<span class="best-flag">Best</span></span>'
      : '<span class="odds-cell">' + labelHtml + "</span>";
    if (!referralUrl) return content;
    return '<a href="' + escapeHtml(referralUrl) + '" target="_blank" rel="sponsored nofollow noopener noreferrer">' + content + "</a>";
  }

  function renderOddsTable(todayGame, oddsData) {
    var state = document.getElementById("odds-comparison-state");
    var subtitle = document.getElementById("odds-panel-subtitle");
    var updated = document.getElementById("odds-panel-updated");
    if (!state) return;

    if (!todayGame) {
      if (subtitle) subtitle.textContent = "The sportsbook links stay live even when the Mets are off.";
      if (updated) updated.textContent = "No game scheduled today";
      state.innerHTML = '<div class="no-game-state">No Mets game today &mdash; check back tomorrow</div>';
      return;
    }

    if (subtitle) {
      subtitle.textContent = "New York Mets at " + todayGame.opponent + " • " + todayGame.time;
    }
    if (updated) {
      updated.textContent = formatTimestamp((oddsData && oddsData.meta && oddsData.meta.generatedAt) || (offersData && offersData.lastUpdated) || todayGame.date);
    }

    var books = getEnabledBooks();
    var hasMatchingOdds = oddsMatchGame(oddsData, todayGame);
    var rows = books.map(function (book) {
      return hasMatchingOdds ? buildBookRow(book, oddsData) : {
        name: book.name,
        referralUrl: String(book.referralUrl || "").trim(),
        metsMlPrice: null,
        runLinePrice: null,
        runLinePoint: null,
        overPrice: null,
        underPrice: null,
        totalPoint: null
      };
    });

    var best = getBestValues(rows);
    var body = rows.map(function (row) {
      var totalScore = Number.isFinite(row.totalPoint) && Number.isFinite(row.overPrice)
        ? (row.totalPoint * 1000) + row.overPrice
        : null;
      var mlHtml = row.metsMlPrice == null ? '<span class="odds-muted">&mdash;</span>' : escapeHtml(formatOdds(row.metsMlPrice));
      var runLineHtml = row.runLinePrice == null || row.runLinePoint == null
        ? '<span class="odds-muted">&mdash;</span>'
        : escapeHtml(formatPoint(row.runLinePoint)) + " (" + escapeHtml(formatOdds(row.runLinePrice)) + ")";
      var totalHtml = row.totalPoint == null || row.overPrice == null || row.underPrice == null
        ? '<span class="odds-muted">&mdash;</span>'
        : "O " + escapeHtml(formatDecimal(row.totalPoint)) + " (" + escapeHtml(formatOdds(row.overPrice)) + ") / U " + escapeHtml(formatDecimal(row.totalPoint)) + " (" + escapeHtml(formatOdds(row.underPrice)) + ")";
      var bookLink = row.referralUrl
        ? '<a class="sportsbook-link" href="' + escapeHtml(row.referralUrl) + '" target="_blank" rel="sponsored nofollow noopener noreferrer">' + escapeHtml(row.name) + "</a>"
        : '<span class="sportsbook-link">' + escapeHtml(row.name) + "</span>";

      return (
        "<tr>" +
          "<td>" + bookLink + "</td>" +
          "<td>" + renderLinkedCell(mlHtml, row.referralUrl, row.metsMlPrice != null && row.metsMlPrice === best.bestMl) + "</td>" +
          "<td>" + renderLinkedCell(runLineHtml, row.referralUrl, row.runLinePrice != null && row.runLinePrice === best.bestRunLine) + "</td>" +
          "<td>" + renderLinkedCell(totalHtml, row.referralUrl, totalScore != null && totalScore === best.bestTotalScore) + "</td>" +
        "</tr>"
      );
    }).join("");

    state.innerHTML =
      '<div class="odds-table-wrap">' +
        '<table class="odds-table">' +
          "<thead><tr><th>Sportsbook</th><th>Mets ML</th><th>Mets Run Line</th><th>Over/Under</th></tr></thead>" +
          "<tbody>" + body + "</tbody>" +
        "</table>" +
      "</div>" +
      '<div class="odds-note">' +
        (hasMatchingOdds
          ? "Best cells are highlighted in green. Books without a live price in the current feed are shown as —."
          : "Today's Mets game is scheduled, but the live per-book odds feed is not synced yet. Referral links remain available.") +
      "</div>";
  }

  async function init() {
    try {
      var responses = await Promise.all([
        fetch(OFFERS_URL, { cache: "no-store" }),
        fetch(ODDS_URL, { cache: "no-store" }).catch(function () { return null; }),
        fetch(SAMPLE_GAME_URL, { cache: "no-store" }).catch(function () { return null; })
      ]);

      var offersResponse = responses[0];
      var oddsResponse = responses[1];
      var sampleResponse = responses[2];

      if (!offersResponse.ok) {
        throw new Error("Betting offers request failed with " + offersResponse.status);
      }

      offersData = await offersResponse.json();
      var oddsData = oddsResponse && oddsResponse.ok ? await oddsResponse.json() : null;
      var sampleGame = sampleResponse && sampleResponse.ok ? await sampleResponse.json() : null;
      var todayGame = findTodayGame(sampleGame);

      var disclosure = document.getElementById("affiliate-disclosure");
      var responsible = document.getElementById("responsible-gaming");
      var updated = document.getElementById("betting-updated");

      if (disclosure) disclosure.textContent = offersData.affiliateDisclosure || "";
      if (responsible) responsible.textContent = (offersData.responsibleGaming || "") + " Users are responsible for confirming eligibility, location restrictions, and sportsbook terms.";
      if (updated) updated.textContent = formatTimestamp((oddsData && oddsData.meta && oddsData.meta.generatedAt) || offersData.lastUpdated);

      renderBadgeRow();
      renderOddsTable(todayGame, oddsData);
    } catch (error) {
      console.error("Failed to load betting hub data:", error);
      var badgeRow = document.getElementById("sportsbook-badge-row");
      var oddsState = document.getElementById("odds-comparison-state");
      if (badgeRow) badgeRow.innerHTML = '<div class="bet-empty">Sportsbook links are not available yet.</div>';
      if (oddsState) oddsState.innerHTML = '<div class="bet-empty">Live Mets odds are not available right now.</div>';
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
