(function () {
  const DATA_URL = "data/social-pulse.json";
  const EMPTY_PLAYER_POSTS = "No recent pulled posts available for this player.";
  let selectedPlayerKey = "";
  let playerIndex = {};
  let ALL_POSTS = [];
  let activeFilters = { platform: "all", sourcetype: "all", topic: "all" };

  var MEDIA_HANDLES = new Set([
    "craigcalcaterra.com", "jessespector.com", "jomboymedia.bsky.social",
    "talkinbaseballbot.bsky.social", "umpscorecard.bsky.social", "rawmlb.bsky.social",
    "grandcentralmets.com", "metsmysterymanager.bsky.social", "juan-soto-stats.bsky.social",
    "fptrack.com", "soltalks.bsky.social", "docbeisbol"
  ]);

  function isMediaSource(post) {
    var st = String(post && post.sourceType || "").toLowerCase();
    var handle = String(post && post.author || "").toLowerCase().replace(/^@/, "");
    return st === "media" || MEDIA_HANDLES.has(handle);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeDisplay(value) {
    return String(value || "")
      .replace(/Ã­/g, "i")
      .replace(/Ã/g, "a")
      .replace(/â€¦/g, "...")
      .replace(/Â°/g, " degrees")
      .trim();
  }

  function slugify(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function formatUpdated(value) {
    var timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return "Last updated unavailable";
    return "Last updated " + new Date(timestamp).toLocaleString();
  }

  function formatRelative(value) {
    var timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return "";
    var diffMinutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000));
    if (diffMinutes < 60) return diffMinutes + "m ago";
    var diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) return diffHours + "h ago";
    return Math.round(diffHours / 24) + "d ago";
  }

  function scoreTone(score) {
    if (score >= 56) return "positive";
    if (score >= 45) return "mixed";
    return "negative";
  }

  function sentimentTone(value) {
    if (value >= 0.25) return "positive";
    if (value <= -0.25) return "negative";
    return "mixed";
  }

  function sentimentLabel(value) {
    if (value >= 0.25) return "Positive";
    if (value <= -0.25) return "Negative";
    return "Mixed";
  }

  function platformLabel(platform) {
    if (platform === "x") return "X";
    if (platform === "bluesky") return "Bluesky";
    return platform || "Source";
  }

  function platformIconMarkup(platform) {
    if (platform === "bluesky") return '<span aria-hidden="true">&#129419;</span>';
    if (platform === "x") return '<span aria-hidden="true">&#10005;</span>';
    return '<span aria-hidden="true">&#8226;</span>';
  }

  function sourceFillColor(avg) {
    if (avg >= 0.25) return "linear-gradient(90deg, #22c55e, #16a34a)";
    if (avg <= -0.25) return "linear-gradient(90deg, #ef4444, #dc2626)";
    return "linear-gradient(90deg, #fbbf24, #f59e0b)";
  }

  function buildSentimentGauge(score) {
    var s = Math.max(0, Math.min(100, score || 0));
    var cx = 150, cy = 130, r = 110;
    var startAngle = Math.PI;
    var endAngle = 0;
    var needleAngle = startAngle + (s / 100) * (endAngle - startAngle);

    function arcPath(start, end) {
      var x1 = cx + r * Math.cos(start);
      var y1 = cy + r * Math.sin(start);
      var x2 = cx + r * Math.cos(end);
      var y2 = cy + r * Math.sin(end);
      var large = (end - start > Math.PI) ? 1 : 0;
      return "M " + x1 + " " + y1 + " A " + r + " " + r + " 0 " + large + " 1 " + x2 + " " + y2;
    }

    var nx = cx + (r - 15) * Math.cos(needleAngle);
    var ny = cy + (r - 15) * Math.sin(needleAngle);

    return '<svg viewBox="0 0 300 155" width="280" height="145" style="display:block;margin:0 auto;">' +
      '<path d="' + arcPath(Math.PI, Math.PI * 0.667) + '" fill="none" stroke="#ef4444" stroke-width="18" stroke-linecap="round" opacity="0.2"/>' +
      '<path d="' + arcPath(Math.PI * 0.667, Math.PI * 0.333) + '" fill="none" stroke="#f59e0b" stroke-width="18" stroke-linecap="round" opacity="0.2"/>' +
      '<path d="' + arcPath(Math.PI * 0.333, 0) + '" fill="none" stroke="#22c55e" stroke-width="18" stroke-linecap="round" opacity="0.2"/>' +
      '<line x1="' + cx + '" y1="' + cy + '" x2="' + nx + '" y2="' + ny + '" stroke="#002d72" stroke-width="3" stroke-linecap="round"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="6" fill="#002d72"/>' +
      '<text x="' + cx + '" y="' + (cy + 2) + '" text-anchor="middle" font-family="Oswald" font-size="42" font-weight="700" fill="#002d72" dy="-18">' + s + "</text>" +
      '<text x="40" y="' + (cy + 18) + '" font-size="11" fill="#94a3b8" font-weight="600">NEGATIVE</text>' +
      '<text x="230" y="' + (cy + 18) + '" font-size="11" fill="#94a3b8" font-weight="600">POSITIVE</text>' +
      "</svg>";
  }

  function buildHeadshot(playerId, name) {
    if (!playerId) {
      return '<span class="sp-player-fallback">' + escapeHtml(String(name || "").slice(0, 1).toUpperCase()) + "</span>";
    }

    return '<img src="https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_60,q_auto:best/v1/people/' + Number(playerId) + '/headshot/67/current" alt="' + escapeHtml(name) + ' headshot" loading="lazy">';
  }

  function renderTopics(items) {
    if (!Array.isArray(items) || !items.length) {
      return '<p class="sp-empty-inline">No strong current-team signals yet.</p>';
    }

    return items.map(function (item) {
      var label = escapeHtml(normalizeDisplay(item.label || item.name || "Unknown"));
      var count = Number(item.count ?? item.mentions ?? 0) || 0;
      var sentiment = Number(item.sentiment ?? 0) || 0;
      var tone = sentimentTone(sentiment);
      return '<div class="sp-pill ' + tone + '">' +
        '<span class="sp-pill-label">' + label + "</span>" +
        '<span class="sp-pill-meta">' + count + " mentions</span>" +
        "</div>";
    }).join("");
  }

  function renderPlayerCards(items, groupLabel) {
    if (!Array.isArray(items) || !items.length) {
      return '<p class="sp-empty-inline">No player chatter yet.</p>';
    }

    return items.map(function (item) {
      var name = normalizeDisplay(item.name || item.label || "Unknown");
      var mentions = Number(item.mentions ?? item.count ?? 0) || 0;
      var sentiment = Number(item.sentiment ?? 0) || 0;
      var tone = sentimentTone(sentiment);
      var key = slugify(groupLabel + "-" + name);
      var activeClass = selectedPlayerKey === key ? " is-active" : "";

      return '<button type="button" class="sp-player-card sp-player-card-button' + activeClass + '" data-player-key="' + escapeHtml(key) + '">' +
        buildHeadshot(item.playerId, name) +
        "<div>" +
        '<div class="sp-player-name">' + escapeHtml(name) + "</div>" +
        '<div class="sp-player-role">' + escapeHtml(groupLabel) + "</div>" +
        '<div class="sp-player-mentions">' + mentions + " mentions</div>" +
        "</div>" +
        '<div class="sp-player-meta">' +
        '<span class="sp-player-dot ' + tone + '"></span>' +
        "<span>" + sentimentLabel(sentiment) + "</span>" +
        "</div>" +
        "</button>";
    }).join("");
  }

  function renderSourceCards(sources) {
    var entries = Object.entries(sources || {});
    if (!entries.length) {
      return '<div class="sp-empty-inline">Waiting for the first pulse update.</div>';
    }

    var maxPosts = entries.reduce(function (max, entry) {
      return Math.max(max, Number(entry[1] && entry[1].postCount) || 0);
    }, 1);

    return '<div class="sp-source-list">' + entries.map(function (entry) {
      var key = entry[0];
      var source = entry[1] || {};
      var posts = Number(source.postCount ?? 0) || 0;
      var avg = Number(source.averageSentiment ?? 0) || 0;
      var width = Math.max(10, Math.round((posts / maxPosts) * 100));
      var label = platformLabel(key);
      return '<div class="sp-source-bar">' +
        '<div class="sp-source-name">' + platformIconMarkup(key) + " " + escapeHtml(label) + "</div>" +
        '<div class="sp-source-fill">' +
        '<div class="sp-source-fill-inner" style="width:' + width + "%;background:" + sourceFillColor(avg) + ';"></div>' +
        '<div class="sp-source-fill-label">Avg ' + avg.toFixed(2) + "</div>" +
        "</div>" +
        '<div class="sp-source-count">' + posts + " posts</div>" +
        "</div>";
    }).join("") + "</div>";
  }

  function sourceTypeBadge(post) {
    if (isMediaSource(post)) {
      return '<span class="sp-source-type-badge media">&#128240; Media</span>';
    }
    return '<span class="sp-source-type-badge fan">&#128100; Fan</span>';
  }

  function renderPosts(posts) {
    if (!Array.isArray(posts) || !posts.length) {
      return '<div class="sp-empty-state">Social pulse data is not available yet.</div>';
    }

    var sorted = posts.slice().sort(function (a, b) {
      var aMedia = isMediaSource(a) ? 1 : 0;
      var bMedia = isMediaSource(b) ? 1 : 0;
      if (bMedia !== aMedia) return bMedia - aMedia;
      return Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0);
    });

    return '<div class="sp-post-grid">' + sorted.map(function (post) {
      var sentiment = Number(post.sentiment ?? 0) || 0;
      var tone = sentimentTone(sentiment);
      var matchedTopics = Array.isArray(post.matchedTopics) ? post.matchedTopics.slice(0, 4) : [];
      var displayName = normalizeDisplay(post.displayName || post.author || "Unknown author");
      var author = normalizeDisplay(post.author || "unknown");
      var text = normalizeDisplay(post.text || "");
      var media = isMediaSource(post);
      var exactTime = post.createdAt ? new Date(post.createdAt).toLocaleString() : "";

      return '<article class="sp-post-card sentiment-' + tone + (media ? ' sp-post-media' : '') + '">' +
        '<div class="sp-post-head">' +
        "<div>" +
        "<h3>" + escapeHtml(displayName) + "</h3>" +
        "<p>@" + escapeHtml(author) + "</p>" +
        "</div>" +
        '<div class="sp-post-meta">' +
        sourceTypeBadge(post) +
        '<span class="sp-platform-badge">' + platformIconMarkup(post.platform) + "<span>" + escapeHtml(platformLabel(post.platform)) + "</span></span>" +
        '<span class="sp-sentiment ' + tone + '">' + sentimentLabel(sentiment) + "</span>" +
        '<span class="sp-time" title="' + escapeHtml(exactTime) + '">' + escapeHtml(formatRelative(post.createdAt)) + "</span>" +
        "</div>" +
        "</div>" +
        '<p class="sp-post-text">' + escapeHtml(text) + "</p>" +
        '<div class="sp-post-foot">' +
        '<div class="sp-post-tags">' +
        matchedTopics.map(function (topic) {
          return "<span>" + escapeHtml(normalizeDisplay(topic)) + "</span>";
        }).join("") +
        "</div>" +
        (post.url ? '<a href="' + escapeHtml(post.url) + '" target="_blank" rel="noopener noreferrer">View post &#8599;</a>' : "") +
        "</div>" +
        "</article>";
    }).join("") + "</div>";
  }

  function renderPlayerPosts() {
    var title = document.getElementById("sp-player-posts-title");
    var subtitle = document.getElementById("sp-player-posts-subtitle");
    var container = document.getElementById("sp-player-posts");
    var activePlayer = playerIndex[selectedPlayerKey];

    if (!container || !title || !subtitle) return;

    if (!activePlayer) {
      title.textContent = "Player Post Detail";
      subtitle.textContent = "Click a current or former player above to inspect the recent posts used for that name.";
      container.innerHTML = '<div class="sp-empty-state">' + escapeHtml(EMPTY_PLAYER_POSTS) + "</div>";
      return;
    }

    title.textContent = activePlayer.name + " Recent Posts";
    subtitle.textContent = activePlayer.groupLabel + " • " + (Number(activePlayer.mentions || 0) || 0) + " tracked mentions";
    container.innerHTML = Array.isArray(activePlayer.posts) && activePlayer.posts.length
      ? renderPosts(activePlayer.posts)
      : '<div class="sp-empty-state">' + escapeHtml(EMPTY_PLAYER_POSTS) + "</div>";
  }

  function moodFromScore(score) {
    if (score >= 62) return "Positive";
    if (score >= 52) return "Mixed";
    if (score >= 40) return "Cautious";
    return "Negative";
  }

  function applyFilters() {
    var postsEl = document.getElementById("sp-posts");
    if (!postsEl) return;

    var filtered = ALL_POSTS.filter(function (post) {
      if (activeFilters.platform !== "all" && post.platform !== activeFilters.platform) return false;
      if (activeFilters.sourcetype !== "all") {
        var st = isMediaSource(post) ? "media" : "fan";
        if (st !== activeFilters.sourcetype) return false;
      }
      if (activeFilters.topic !== "all") {
        var topics = (post.matchedTopics || []).map(function (t) { return String(t || "").toLowerCase(); });
        if (!topics.includes(activeFilters.topic.toLowerCase())) return false;
      }
      return true;
    });

    postsEl.innerHTML = filtered.length
      ? renderPosts(filtered)
      : '<div class="sp-no-results">No posts match this filter combination.</div>';

    document.querySelectorAll(".sp-filter-btn[data-filter-type]").forEach(function (btn) {
      var type = btn.dataset.filterType;
      var val = btn.dataset.filterValue;
      btn.classList.toggle("active", activeFilters[type] === val);
    });
    document.querySelectorAll(".sp-topic-pill").forEach(function (btn) {
      btn.classList.toggle("active", activeFilters.topic === btn.dataset.topic);
    });
  }

  function buildTopicFilterBar(posts) {
    var topicEl = document.getElementById("sp-topic-filters");
    if (!topicEl) return;

    var topicCounts = {};
    posts.forEach(function (post) {
      (post.matchedTopics || []).forEach(function (topic) {
        topicCounts[topic] = (topicCounts[topic] || 0) + 1;
      });
    });

    var sorted = Object.entries(topicCounts)
      .filter(function (entry) { return entry[1] >= 1; })
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, 10);

    if (!sorted.length) {
      topicEl.style.display = "none";
      return;
    }

    topicEl.style.display = "";
    topicEl.innerHTML = '<span class="sp-filter-label">Topic:</span>' +
      '<button class="sp-topic-pill sp-filter-btn active" data-topic="all">All</button>' +
      sorted.map(function (entry) {
        return '<button class="sp-topic-pill sp-filter-btn" data-topic="' + escapeHtml(entry[0]) + '">' +
          escapeHtml(entry[0]) +
          '<span class="sp-filter-count">' + entry[1] + "</span></button>";
      }).join("");

    topicEl.querySelectorAll(".sp-topic-pill").forEach(function (btn) {
      btn.addEventListener("click", function () {
        activeFilters.topic = btn.dataset.topic;
        applyFilters();
      });
    });
  }

  function wireFilterBar() {
    document.querySelectorAll(".sp-filter-btn[data-filter-type]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        activeFilters[btn.dataset.filterType] = btn.dataset.filterValue;
        if (btn.dataset.filterType !== "topic") {
          activeFilters.topic = "all";
        }
        applyFilters();
      });
    });
  }

  function renderHero(data) {
    var score = Number(data && data.overallScore) || 0;
    var rawMood = (data && (data.overallMood || data.mood)) || moodFromScore(score);
    var mood = escapeHtml(normalizeDisplay(rawMood));
    var summary = escapeHtml(normalizeDisplay((data && data.summary) || ""));
    return '<div class="sp-hero-compact">' +
      '<div class="sp-hero-left">' +
        '<div class="sp-hero-kicker">Fan Sentiment</div>' +
        '<div class="sp-hero-score-row">' +
          '<span class="sp-hero-score">' + score + "</span>" +
          '<span class="sp-hero-mood">' + mood + "</span>" +
        "</div>" +
        (summary ? '<p class="sp-hero-summary">' + summary + "</p>" : "") +
      "</div>" +
      '<div class="sp-hero-right">' + buildSentimentGauge(score) + "</div>" +
      "</div>";
  }

  function buildPlayerIndex(data) {
    var nextIndex = {};

    function addPlayers(items, groupLabel) {
      if (!Array.isArray(items)) return;
      items.forEach(function (item) {
        var name = normalizeDisplay(item && item.name);
        if (!name) return;
        var key = slugify(groupLabel + "-" + name);
        nextIndex[key] = {
          name: name,
          mentions: Number(item.mentions ?? item.count ?? 0) || 0,
          groupLabel: groupLabel,
          posts: Array.isArray(item.posts) ? item.posts : []
        };
      });
    }

    addPlayers(data && data.currentPlayers, "Current Met");
    addPlayers(data && data.formerPlayers, "Former Met");
    return nextIndex;
  }

  function render(data) {
    var hero = document.getElementById("sp-hero");
    var updated = document.getElementById("sp-updated");
    var topics = document.getElementById("sp-topics");
    var currentPlayers = document.getElementById("sp-current-players");
    var formerPlayers = document.getElementById("sp-former-players");
    var sources = document.getElementById("sp-sources");
    var score = Number(data && data.overallScore) || 0;

    playerIndex = buildPlayerIndex(data || {});
    if (!playerIndex[selectedPlayerKey]) {
      selectedPlayerKey = Object.keys(playerIndex)[0] || "";
    }

    if (hero) {
      hero.classList.remove("positive", "mixed", "negative");
      hero.classList.add(scoreTone(score));
      hero.innerHTML = renderHero(data || {});
    }

    if (updated) updated.textContent = formatUpdated(data && data.generatedAt);
    if (topics) topics.innerHTML = renderTopics(data && data.trendingTopics);
    if (currentPlayers) currentPlayers.innerHTML = renderPlayerCards(data && data.currentPlayers, "Current Met");
    if (formerPlayers) formerPlayers.innerHTML = renderPlayerCards(data && data.formerPlayers, "Former Met");
    if (sources) sources.innerHTML = renderSourceCards(data && data.sources);

    ALL_POSTS = Array.isArray(data && data.posts) ? data.posts : [];
    buildTopicFilterBar(ALL_POSTS);
    wireFilterBar();
    applyFilters();
    renderPlayerPosts();
  }

  function renderEmpty(message) {
    var hero = document.getElementById("sp-hero");
    if (hero) {
      hero.classList.remove("positive", "mixed", "negative");
      hero.innerHTML = '<div class="sp-empty-state">' + escapeHtml(message || "Social pulse data is not available yet.") + "</div>";
    }
  }

  async function init() {
    document.addEventListener("click", function (event) {
      var button = event.target && event.target.closest ? event.target.closest("[data-player-key]") : null;
      if (!button) return;
      selectedPlayerKey = button.getAttribute("data-player-key") || "";
      var cards = document.querySelectorAll("[data-player-key]");
      cards.forEach(function (card) {
        card.classList.toggle("is-active", card.getAttribute("data-player-key") === selectedPlayerKey);
      });
      renderPlayerPosts();
    });

    try {
      var response = await fetch(DATA_URL, { cache: "no-store" });
      if (!response.ok) throw new Error("Social pulse request failed with " + response.status);
      var data = await response.json();
      render(data || {});
    } catch (error) {
      console.error("Failed to load social pulse data:", error);
      renderEmpty("Social pulse data is not available yet.");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
