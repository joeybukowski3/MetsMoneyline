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
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function normalizeDisplay(value) {
    return String(value || "")
      .replace(/Ã­/g, "i").replace(/Ã/g, "a").replace(/â€¦/g, "...")
      .replace(/Â°/g, " degrees").trim();
  }

  function slugify(value) {
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function formatUpdated(value) {
    var ts = Date.parse(value);
    if (!Number.isFinite(ts)) return "Last updated unavailable";
    return "Last updated " + new Date(ts).toLocaleString();
  }

  function formatRelative(value) {
    var ts = Date.parse(value);
    if (!Number.isFinite(ts)) return "";
    var diffMin = Math.max(1, Math.round((Date.now() - ts) / 60000));
    if (diffMin < 60) return diffMin + "m ago";
    var diffH = Math.round(diffMin / 60);
    if (diffH < 24) return diffH + "h ago";
    return Math.round(diffH / 24) + "d ago";
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
    if (platform === "x") return "𝕏";
    if (platform === "bluesky") return "Bluesky";
    return platform || "Source";
  }

  function platformIconMarkup(platform) {
    if (platform === "bluesky") return '<span aria-hidden="true">&#129419;</span>';
    if (platform === "x") return '<span aria-hidden="true" style="font-weight:900;">𝕏</span>';
    return '<span aria-hidden="true">&#8226;</span>';
  }

  function sourceFillColor(avg) {
    if (avg >= 0.25) return "#22c55e";
    if (avg <= -0.25) return "#ef4444";
    return "#f59e0b";
  }

  function buildSentimentGauge(score) {
    var s = Math.max(0, Math.min(100, score || 0));
    var cx = 150, cy = 120, r = 100;
    function arcPath(start, end) {
      var x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
      var x2 = cx + r * Math.cos(end),   y2 = cy + r * Math.sin(end);
      return "M " + x1 + " " + y1 + " A " + r + " " + r + " 0 0 1 " + x2 + " " + y2;
    }
    var needleAngle = Math.PI + (s / 100) * (-Math.PI);
    var nx = cx + (r - 12) * Math.cos(needleAngle);
    var ny = cy + (r - 12) * Math.sin(needleAngle);
    return '<svg viewBox="0 0 300 140" width="220" height="105" style="display:block;margin:0 auto;">' +
      '<path d="' + arcPath(Math.PI, Math.PI * 0.667) + '" fill="none" stroke="#ef4444" stroke-width="14" stroke-linecap="round" opacity="0.25"/>' +
      '<path d="' + arcPath(Math.PI * 0.667, Math.PI * 0.333) + '" fill="none" stroke="#f59e0b" stroke-width="14" stroke-linecap="round" opacity="0.25"/>' +
      '<path d="' + arcPath(Math.PI * 0.333, 0) + '" fill="none" stroke="#22c55e" stroke-width="14" stroke-linecap="round" opacity="0.25"/>' +
      '<line x1="' + cx + '" y1="' + cy + '" x2="' + nx + '" y2="' + ny + '" stroke="#002d72" stroke-width="2.5" stroke-linecap="round"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="5" fill="#002d72"/>' +
      '<text x="30" y="' + (cy + 16) + '" font-size="10" fill="#94a3b8" font-weight="600">NEG</text>' +
      '<text x="248" y="' + (cy + 16) + '" font-size="10" fill="#94a3b8" font-weight="600">POS</text>' +
      "</svg>";
  }

  function buildHeadshot(playerId, name) {
    if (!playerId) {
      return '<span class="sp-player-fallback">' + escapeHtml(String(name || "").slice(0, 1).toUpperCase()) + "</span>";
    }
    return '<img src="https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_60,q_auto:best/v1/people/' + Number(playerId) + '/headshot/67/current" alt="' + escapeHtml(name) + ' headshot" loading="lazy">';
  }

  /* ── Render topics (side panel pills) ── */
  function renderTopics(items) {
    if (!Array.isArray(items) || !items.length) {
      return '<p class="sp-empty-inline" style="padding-top:0.5rem;font-size:0.78rem;">No strong topics yet.</p>';
    }
    return items.map(function (item) {
      var label = escapeHtml(normalizeDisplay(item.label || item.name || "Unknown"));
      var count = Number(item.count ?? item.mentions ?? 0) || 0;
      var tone = sentimentTone(Number(item.sentiment ?? 0) || 0);
      return '<div class="sp-pill ' + tone + '">' +
        '<span class="sp-pill-label">' + label + "</span>" +
        '<span class="sp-pill-meta">' + count + " mentions</span>" +
        "</div>";
    }).join("");
  }

  /* ── Render player cards (side panel) ── */
  function renderPlayerCardsSide(items, groupLabel) {
    if (!Array.isArray(items) || !items.length) {
      return '<p class="sp-empty-inline" style="padding-top:0.5rem;font-size:0.78rem;">No player chatter yet.</p>';
    }
    return items.map(function (item) {
      var name = normalizeDisplay(item.name || item.label || "Unknown");
      var mentions = Number(item.mentions ?? item.count ?? 0) || 0;
      var tone = sentimentTone(Number(item.sentiment ?? 0) || 0);
      var key = slugify(groupLabel + "-" + name);
      var activeClass = selectedPlayerKey === key ? " is-active" : "";
      return '<button type="button" class="sp-player-card' + activeClass + '" data-player-key="' + escapeHtml(key) + '">' +
        buildHeadshot(item.playerId, name) +
        "<div>" +
        '<div class="sp-player-name">' + escapeHtml(name) + "</div>" +
        '<div class="sp-player-mentions">' + mentions + " mentions</div>" +
        "</div>" +
        '<div class="sp-player-meta">' +
        '<span class="sp-player-dot ' + tone + '"></span>' +
        sentimentLabel(Number(item.sentiment ?? 0) || 0).slice(0, 3) +
        "</div>" +
        "</button>";
    }).join("");
  }

  /* ── Render source breakdown (compact, inside hero) ── */
  function renderSourcesCompact(sources) {
    var entries = Object.entries(sources || {});
    if (!entries.length) return "";
    var maxPosts = entries.reduce(function (mx, e) { return Math.max(mx, Number(e[1] && e[1].postCount) || 0); }, 1);
    return entries.map(function (e) {
      var key = e[0], src = e[1] || {};
      var posts = Number(src.postCount ?? 0) || 0;
      var avg = Number(src.averageSentiment ?? 0) || 0;
      var width = Math.max(8, Math.round((posts / maxPosts) * 100));
      var icon = key === "x" ? "𝕏" : key === "bluesky" ? "🦋" : "●";
      var label = key === "x" ? "X / Twitter" : key === "bluesky" ? "Bluesky" : key;
      return '<div class="sp-source-row">' +
        '<span class="sp-source-icon">' + icon + "</span>" +
        '<span class="sp-source-name-sm">' + escapeHtml(label) + "</span>" +
        '<div class="sp-source-bar-mini"><div class="sp-source-bar-mini-fill" style="width:' + width + '%;background:' + sourceFillColor(avg) + ';"></div></div>' +
        '<span class="sp-source-count-sm">' + posts + " posts</span>" +
        "</div>";
    }).join("");
  }

  /* ── Render hero ── */
  function renderHero(data) {
    var score = Number(data && data.overallScore) || 0;
    var mood = escapeHtml(normalizeDisplay((data && (data.overallMood || data.mood)) || moodFromScore(score)));
    var summary = escapeHtml(normalizeDisplay((data && data.summary) || ""));
    var sourcesHtml = renderSourcesCompact(data && data.sources);
    return '<div class="sp-hero-score-block">' +
        '<div class="sp-hero-kicker">Fan Sentiment</div>' +
        '<span class="sp-hero-score">' + score + "</span>" +
        '<div class="sp-hero-mood">' + mood + "</div>" +
      "</div>" +
      '<div class="sp-hero-center">' +
        '<div class="sp-gauge-wrap">' + buildSentimentGauge(score) + "</div>" +
        (summary ? '<p class="sp-hero-summary">' + summary + "</p>" : "") +
      "</div>" +
      (sourcesHtml ? '<div class="sp-hero-sources"><div class="sp-sources-label">Sources</div>' + sourcesHtml + "</div>" : "");
  }

  function moodFromScore(score) {
    if (score >= 62) return "Positive";
    if (score >= 52) return "Mixed";
    if (score >= 40) return "Cautious";
    return "Negative";
  }

  function sourceTypeBadge(post) {
    if (isMediaSource(post)) return '<span class="sp-source-type-badge media">&#128240; Media</span>';
    return '<span class="sp-source-type-badge fan">&#128100; Fan</span>';
  }

  /* ── Render posts ── */
  function renderPosts(posts) {
    if (!Array.isArray(posts) || !posts.length) {
      return '<div class="sp-empty-state">No posts available yet.</div>';
    }
    var sorted = posts.slice().sort(function (a, b) {
      var aMedia = isMediaSource(a) ? 1 : 0, bMedia = isMediaSource(b) ? 1 : 0;
      if (bMedia !== aMedia) return bMedia - aMedia;
      return Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0);
    });
    return '<div class="sp-post-grid">' + sorted.map(function (post) {
      var sentiment = Number(post.sentiment ?? 0) || 0;
      var tone = sentimentTone(sentiment);
      var matchedTopics = Array.isArray(post.matchedTopics) ? post.matchedTopics.slice(0, 3) : [];
      var displayName = escapeHtml(normalizeDisplay(post.displayName || post.author || "Unknown"));
      var author = escapeHtml(normalizeDisplay(post.author || "unknown"));
      var text = escapeHtml(normalizeDisplay(post.text || ""));
      var media = isMediaSource(post);
      var exactTime = post.createdAt ? new Date(post.createdAt).toLocaleString() : "";
      return '<article class="sp-post-card sentiment-' + tone + (media ? " sp-post-media" : "") + '">' +
        '<div class="sp-post-head"><div>' +
          "<h3>" + displayName + "</h3>" +
          "<p>@" + author + "</p>" +
        "</div>" +
        '<div class="sp-post-meta">' +
          sourceTypeBadge(post) +
          '<span class="sp-platform-badge">' + platformIconMarkup(post.platform) + "<span>" + escapeHtml(platformLabel(post.platform)) + "</span></span>" +
          '<span class="sp-sentiment ' + tone + '">' + sentimentLabel(sentiment) + "</span>" +
          '<span class="sp-time" title="' + escapeHtml(exactTime) + '">' + escapeHtml(formatRelative(post.createdAt)) + "</span>" +
        "</div></div>" +
        '<p class="sp-post-text">' + text + "</p>" +
        '<div class="sp-post-foot">' +
          '<div class="sp-post-tags">' +
          matchedTopics.map(function (t) { return "<span>" + escapeHtml(normalizeDisplay(t)) + "</span>"; }).join("") +
          "</div>" +
          (post.url ? '<a href="' + escapeHtml(post.url) + '" target="_blank" rel="noopener noreferrer">View &#8599;</a>' : "") +
        "</div>" +
        "</article>";
    }).join("") + "</div>";
  }

  /* ── Player detail ── */
  function renderPlayerPosts() {
    var panel = document.getElementById("sp-player-detail-panel");
    var title = document.getElementById("sp-player-posts-title");
    var subtitle = document.getElementById("sp-player-posts-subtitle");
    var container = document.getElementById("sp-player-posts");
    if (!panel || !container) return;
    var activePlayer = playerIndex[selectedPlayerKey];
    if (!activePlayer) { panel.style.display = "none"; return; }
    panel.style.display = "";
    title.textContent = activePlayer.name + " — Recent Posts";
    subtitle.textContent = activePlayer.groupLabel + " · " + (Number(activePlayer.mentions || 0) || 0) + " tracked mentions";
    container.innerHTML = Array.isArray(activePlayer.posts) && activePlayer.posts.length
      ? renderPosts(activePlayer.posts)
      : '<div class="sp-empty-state">' + escapeHtml(EMPTY_PLAYER_POSTS) + "</div>";
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* ── Filters ── */
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
      btn.classList.toggle("active", activeFilters[btn.dataset.filterType] === btn.dataset.filterValue);
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
      (post.matchedTopics || []).forEach(function (topic) { topicCounts[topic] = (topicCounts[topic] || 0) + 1; });
    });
    var sorted = Object.entries(topicCounts).filter(function (e) { return e[1] >= 1; })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 10);
    if (!sorted.length) { topicEl.style.display = "none"; return; }
    topicEl.style.display = "";
    topicEl.innerHTML = '<span class="sp-filter-label">Topic:</span>' +
      '<button class="sp-topic-pill sp-filter-btn active" data-topic="all">All</button>' +
      sorted.map(function (e) {
        return '<button class="sp-topic-pill sp-filter-btn" data-topic="' + escapeHtml(e[0]) + '">' +
          escapeHtml(e[0]) + '<span class="sp-filter-count">' + e[1] + "</span></button>";
      }).join("");
    topicEl.querySelectorAll(".sp-topic-pill").forEach(function (btn) {
      btn.addEventListener("click", function () { activeFilters.topic = btn.dataset.topic; applyFilters(); });
    });
  }

  function wireFilterBar() {
    document.querySelectorAll(".sp-filter-btn[data-filter-type]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        activeFilters[btn.dataset.filterType] = btn.dataset.filterValue;
        if (btn.dataset.filterType !== "topic") activeFilters.topic = "all";
        applyFilters();
      });
    });
  }

  /* ── Build player index ── */
  function buildPlayerIndex(data) {
    var idx = {};
    function add(items, groupLabel) {
      if (!Array.isArray(items)) return;
      items.forEach(function (item) {
        var name = normalizeDisplay(item && item.name);
        if (!name) return;
        var key = slugify(groupLabel + "-" + name);
        idx[key] = { name, mentions: Number(item.mentions ?? item.count ?? 0) || 0, groupLabel, posts: Array.isArray(item.posts) ? item.posts : [] };
      });
    }
    add(data && data.currentPlayers, "Current Met");
    add(data && data.formerPlayers, "Former Met");
    return idx;
  }

  /* ── Main render ── */
  function render(data) {
    var hero = document.getElementById("sp-hero");
    var updated = document.getElementById("sp-updated");
    var topics = document.getElementById("sp-topics");
    var currentPlayers = document.getElementById("sp-current-players");
    var formerPlayersSide = document.getElementById("sp-former-players-side");
    var score = Number(data && data.overallScore) || 0;

    playerIndex = buildPlayerIndex(data || {});
    if (!playerIndex[selectedPlayerKey]) selectedPlayerKey = Object.keys(playerIndex)[0] || "";

    if (hero) {
      hero.classList.remove("positive", "mixed", "negative");
      hero.classList.add(scoreTone(score));
      hero.innerHTML = renderHero(data || {});
    }
    if (updated) updated.textContent = formatUpdated(data && data.generatedAt);
    if (topics) topics.innerHTML = renderTopics(data && data.trendingTopics);
    if (currentPlayers) currentPlayers.innerHTML = renderPlayerCardsSide(data && data.currentPlayers, "Current Met");
    if (formerPlayersSide) formerPlayersSide.innerHTML = renderPlayerCardsSide(data && data.formerPlayers, "Former Met");

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
      hero.innerHTML = '<div class="sp-empty-state" style="grid-column:1/-1;">' + escapeHtml(message || "Social pulse data is not available yet.") + "</div>";
    }
  }

  async function init() {
    // Player card clicks
    document.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("[data-player-key]") : null;
      if (btn) {
        selectedPlayerKey = btn.getAttribute("data-player-key") || "";
        document.querySelectorAll("[data-player-key]").forEach(function (c) {
          c.classList.toggle("is-active", c.getAttribute("data-player-key") === selectedPlayerKey);
        });
        renderPlayerPosts();
        return;
      }
      // Close button
      var closeBtn = e.target && e.target.closest ? e.target.closest("#sp-player-detail-close") : null;
      if (closeBtn) {
        selectedPlayerKey = "";
        document.querySelectorAll("[data-player-key]").forEach(function (c) { c.classList.remove("is-active"); });
        var panel = document.getElementById("sp-player-detail-panel");
        if (panel) panel.style.display = "none";
      }
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
