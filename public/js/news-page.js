(function initNewsPage() {
  const helpers = window.MetsNewsFeed;

  if (!helpers) {
    console.warn("[news] Shared news helpers failed to load.");
    return;
  }

  const CATEGORY_KEYWORDS = {
    pitching: [
      "pitch", "pitcher", "pitching", "starter", "bullpen", "rotation",
      "era", "strikeout", "mound", "arm", "relievers", "closer", "fastball",
      "curveball", "slider", "changeup", "no-hitter", "shutout", "whip",
      "innings pitched", "starting rotation"
    ],
    offense: [
      "batting", "bat", "batter", "hitter", "hitting", "lineup", "offense",
      "home run", "homer", "rbi", "slugging", "average", "on-base",
      "double", "triple", "single", "hit", "runs scored", "wrc", "woba",
      "dh", "designated hitter", "stolen base", "walk", "strikeout"
    ],
    "minor-leagues": [
      "minor", "farm", "prospect", "prospects", "aaa", "aa", "a-ball",
      "syracuse", "binghamton", "triple-a", "double-a", "single-a",
      "minor league", "system", "development", "affiliate", "call up",
      "called up", "promoted", "optioned", "drafted"
    ]
  };

  const MAX_ARTICLES = 24;
  let allArticles = [];
  let activeTab = "all";
  let lastUpdatedAt = null;

  function categorize(article) {
    const text = `${article.title} ${article.description}`.toLowerCase();

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (keywords.some((keyword) => text.includes(keyword))) {
        return category;
      }
    }

    return "general";
  }

  function catBadgeHtml(category) {
    if (category === "general") return "";

    const labels = {
      offense: "Offense",
      pitching: "Pitching",
      "minor-leagues": "Minor Leagues"
    };

    return `<span class="news-cat-badge ${category}">${labels[category]}</span>`;
  }

  function buildThumb(article) {
    const wrap = document.createElement("div");
    wrap.className = "news-thumb-wrap";

    if (!article.thumbnail) {
      const placeholder = document.createElement("div");
      placeholder.className = "news-thumb-placeholder";
      placeholder.textContent = "⚾";
      wrap.appendChild(placeholder);
      return wrap;
    }

    const img = document.createElement("img");
    img.src = article.thumbnail;
    img.alt = `${article.title} article thumbnail`;
    img.width = 640;
    img.height = 360;
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("error", function handleThumbError() {
      wrap.replaceChildren();
      const placeholder = document.createElement("div");
      placeholder.className = "news-thumb-placeholder";
      placeholder.textContent = "⚾";
      wrap.appendChild(placeholder);
    }, { once: true });
    wrap.appendChild(img);

    return wrap;
  }

  function updateLastUpdatedLabel() {
    const label = document.getElementById("last-updated");
    if (!label) return;

    label.textContent = lastUpdatedAt
      ? `Last updated: ${helpers.getRelativeTime(lastUpdatedAt)}`
      : "";
  }

  function renderArticles(articles) {
    const grid = document.getElementById("news-grid");
    if (!grid) return;

    const filtered = activeTab === "all"
      ? articles
      : articles.filter((article) => article.category === activeTab);

    if (!filtered.length) {
      const message = activeTab === "all"
        ? "No recent Mets articles are available right now."
        : `No ${activeTab.replace("-", " ")} articles are available right now. Try the All tab.`;
      grid.innerHTML = `<div class="news-empty">${message}</div>`;
      return;
    }

    const cards = filtered.map((article) => {
      const card = document.createElement("a");
      card.className = "news-card";
      card.href = article.link;
      card.target = "_blank";
      card.rel = "noopener noreferrer";

      card.appendChild(buildThumb(article));

      const body = document.createElement("div");
      body.className = "news-body";

      const source = document.createElement("span");
      source.className = "news-source";
      source.textContent = article.source;
      body.appendChild(source);

      const badgeHtml = catBadgeHtml(article.category);
      if (badgeHtml) {
        body.insertAdjacentHTML("beforeend", badgeHtml);
      }

      const title = document.createElement("span");
      title.className = "news-title";
      title.textContent = article.title;
      body.appendChild(title);

      if (article.description) {
        const description = document.createElement("p");
        description.className = "news-description";
        description.textContent = article.description;
        body.appendChild(description);
      }

      const date = document.createElement("span");
      date.className = "news-date";
      date.textContent = helpers.getRelativeTime(article.pubDate) || "Recently published";
      body.appendChild(date);

      card.appendChild(body);
      return card;
    });

    grid.replaceChildren(...cards);
  }

  async function fetchAllFeeds() {
    const button = document.getElementById("refresh-btn");
    const spinner = document.getElementById("spinner");
    const grid = document.getElementById("news-grid");

    if (!button || !spinner || !grid) {
      console.warn("[news] News page containers are missing.");
      return;
    }

    button.disabled = true;
    spinner.classList.add("active");
    grid.innerHTML = `<div class="news-empty">Fetching latest Mets news&hellip;</div>`;

    try {
      const response = await fetch(`/api/news?limit=${MAX_ARTICLES}`, {
        signal: AbortSignal.timeout(12000)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      allArticles = helpers.normalizeArticles(data && data.articles).map((article) => ({
        ...article,
        category: categorize(article)
      }));

      renderArticles(allArticles);
      lastUpdatedAt = new Date();
      updateLastUpdatedLabel();
    } catch (error) {
      console.warn("[news] Full page news failed:", error.message);
      grid.innerHTML = `<div class="news-empty">News feed unavailable right now. Please refresh or check back shortly.</div>`;
    } finally {
      button.disabled = false;
      spinner.classList.remove("active");
    }
  }

  function bindEvents() {
    const tabs = document.getElementById("news-tabs");
    const refreshButton = document.getElementById("refresh-btn");

    tabs.addEventListener("click", (event) => {
      const button = event.target.closest(".news-tab");
      if (!button) return;

      document.querySelectorAll(".news-tab").forEach((tab) => tab.classList.remove("active"));
      button.classList.add("active");
      activeTab = button.dataset.tab || "all";
      renderArticles(allArticles);
    });

    refreshButton.addEventListener("click", fetchAllFeeds);
  }

  function loadFooterTimestamp() {
    fetch("/data/sample-game.json")
      .then((response) => response.json())
      .then((data) => {
        if (!data || !data.generatedAt) return;

        const element = document.getElementById("data-timestamp");
        if (!element) return;

        element.textContent = "Last updated: " + new Date(data.generatedAt).toLocaleString("en-US", {
          timeZone: "America/New_York",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
          timeZoneName: "short"
        });
      })
      .catch(() => {});
  }

  bindEvents();
  loadFooterTimestamp();
  setInterval(updateLastUpdatedLabel, 60000);
  fetchAllFeeds();
})();
