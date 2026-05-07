(function () {
  const DATA_URL = "data/social-pulse.json";

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatUpdated(value) {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return "Last updated unavailable";
    return `Last updated ${new Date(timestamp).toLocaleString()}`;
  }

  function formatRelative(value) {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return "";
    const diffMinutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000));
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.round(diffHours / 24)}d ago`;
  }

  function scoreTone(score) {
    if (score >= 76) return "very-positive";
    if (score >= 56) return "positive";
    if (score >= 45) return "mixed";
    if (score >= 25) return "negative";
    return "very-negative";
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

  function renderPills(items, kind) {
    if (!Array.isArray(items) || !items.length) {
      return '<p class="sp-empty-inline">No strong signals yet.</p>';
    }

    return items.map((item) => {
      const label = escapeHtml(item.label || item.name || "Unknown");
      const count = Number(item.count ?? item.mentions ?? 0) || 0;
      const sentiment = Number(item.sentiment ?? 0) || 0;
      const tone = sentimentTone(sentiment);
      return `<div class="sp-pill ${kind} ${tone}">
        <span class="sp-pill-label">${label}</span>
        <span class="sp-pill-meta">${count}${kind === "player" ? " mentions" : ""}</span>
      </div>`;
    }).join("");
  }

  function renderSourceCards(sources) {
    const entries = Object.entries(sources || {});
    if (!entries.length) {
      return '<div class="sp-source-card"><h3>No sources</h3><p>Waiting for the first pulse update.</p></div>';
    }

    return entries.map(([key, source]) => {
      const avg = Number(source?.averageSentiment ?? 0) || 0;
      return `<div class="sp-source-card">
        <h3>${escapeHtml(key)}</h3>
        <p>${Number(source?.postCount ?? 0) || 0} posts indexed</p>
        <span class="sp-source-badge ${sentimentTone(avg)}">Avg sentiment ${avg.toFixed(2)}</span>
      </div>`;
    }).join("");
  }

  function platformLabel(platform) {
    if (platform === "x") return "X";
    if (platform === "bluesky") return "Bluesky";
    return platform || "Source";
  }

  function renderPosts(posts) {
    if (!Array.isArray(posts) || !posts.length) {
      return '<div class="sp-empty-state">Social pulse data is not available yet.</div>';
    }

    return posts.map((post) => {
      const sentiment = Number(post.sentiment ?? 0) || 0;
      const matchedTopics = Array.isArray(post.matchedTopics) ? post.matchedTopics.slice(0, 4) : [];
      return `<article class="sp-post-card">
        <div class="sp-post-head">
          <div>
            <h3>${escapeHtml(post.displayName || post.author || "Unknown author")}</h3>
            <p>@${escapeHtml(post.author || "unknown")}</p>
          </div>
          <div class="sp-post-meta">
            <span class="sp-platform-badge">${escapeHtml(platformLabel(post.platform))}</span>
            <span class="sp-sentiment ${sentimentTone(sentiment)}">${sentimentLabel(sentiment)}</span>
            <span class="sp-time">${escapeHtml(formatRelative(post.createdAt))}</span>
          </div>
        </div>
        <p class="sp-post-text">${escapeHtml(post.text || "")}</p>
        <div class="sp-post-foot">
          <div class="sp-post-tags">
            ${matchedTopics.map((topic) => `<span>${escapeHtml(topic)}</span>`).join("")}
          </div>
          ${post.url ? `<a href="${escapeHtml(post.url)}" target="_blank" rel="noopener noreferrer">View post</a>` : ""}
        </div>
      </article>`;
    }).join("");
  }

  function render(data) {
    const score = Number(data?.overallScore ?? 50) || 50;
    const mood = escapeHtml(data?.mood || "Mixed");
      const summary = escapeHtml(data?.summary || "Social pulse data is not available yet.");

    const scoreCard = document.getElementById("sp-score-card");
    const updated = document.getElementById("sp-updated");
    const topics = document.getElementById("sp-topics");
    const players = document.getElementById("sp-players");
    const sources = document.getElementById("sp-sources");
    const posts = document.getElementById("sp-posts");
    const state = document.getElementById("sp-loading");

    if (scoreCard) {
      scoreCard.innerHTML = `
        <div class="sp-score-ring ${scoreTone(score)}">
          <span class="sp-score-value">${score}</span>
        </div>
        <div class="sp-score-copy">
          <h1>Mets Social Media Pulse</h1>
          <p class="sp-score-mood ${scoreTone(score)}">${mood}</p>
          <p class="sp-score-summary">${summary}</p>
        </div>
      `;
    }

    if (updated) updated.textContent = formatUpdated(data?.generatedAt);
    if (topics) topics.innerHTML = renderPills(data?.trendingTopics, "topic");
    if (players) players.innerHTML = renderPills(data?.trendingPlayers, "player");
    if (sources) sources.innerHTML = renderSourceCards(data?.sources);
    if (posts) posts.innerHTML = renderPosts(data?.posts);
    if (state) state.remove();
  }

  function renderEmpty(message) {
    const state = document.getElementById("sp-loading");
    if (state) {
      state.className = "sp-empty-state";
      state.textContent = message || "Social pulse data is not available yet.";
    }
  }

  async function init() {
    try {
      const response = await fetch(DATA_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`Social pulse request failed with ${response.status}`);
      const data = await response.json();
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
