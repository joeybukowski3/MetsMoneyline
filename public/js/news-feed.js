(() => {
  function stripHtml(value) {
    return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  function getRelativeTime(dateValue) {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return "";

    const diffMs = date.getTime() - Date.now();
    const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
    const minutes = Math.round(diffMs / 60000);

    if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");

    const hours = Math.round(diffMs / 3600000);
    if (Math.abs(hours) < 24) return rtf.format(hours, "hour");

    const days = Math.round(diffMs / 86400000);
    return rtf.format(days, "day");
  }

  function toSafeExternalUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return /^https?:$/i.test(url.protocol) ? url.toString() : "";
    } catch (_error) {
      return "";
    }
  }

  function normalizeArticle(article) {
    const normalized = {
      source: stripHtml(article && article.source) || "Mets News",
      title: stripHtml(article && article.title),
      link: toSafeExternalUrl(article && article.link),
      pubDate: article && article.pubDate ? article.pubDate : "",
      description: stripHtml(article && article.description),
      thumbnail: toSafeExternalUrl(article && article.thumbnail)
    };

    if (!normalized.title || !normalized.link) {
      return null;
    }

    return normalized;
  }

  function normalizeArticles(items) {
    const articles = Array.isArray(items) ? items : [];
    let skippedCount = 0;

    const normalized = articles.map((article) => {
      const item = normalizeArticle(article);
      if (!item) skippedCount += 1;
      return item;
    }).filter(Boolean);

    if (skippedCount) {
      console.warn(`[news] Skipped ${skippedCount} incomplete article${skippedCount === 1 ? "" : "s"}.`);
    }

    return normalized;
  }

  window.MetsNewsFeed = {
    getRelativeTime,
    normalizeArticles,
    stripHtml,
    toSafeExternalUrl
  };
})();
