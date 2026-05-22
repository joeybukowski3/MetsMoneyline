(function (global) {
  var BRAND_ENTRIES = [
    {
      key: "fanatics",
      displayName: "Fanatics",
      aliases: ["fanatics"],
      assetPath: "assets/sportsbooks/fanatics.png",
      assetType: "image/png",
      sourceUrl: "https://www.fanaticsinc.com",
      sourceAssetUrl: "https://images.squarespace-cdn.com/content/v1/5ff494b9931735466ce28d5b/1bde765f-2d5d-4479-8c52-5a03a3e456fd/Fanatics_Primary_White.png",
      preferredBackground: "#111827",
      status: "ready"
    },
    {
      key: "draftkings",
      displayName: "DraftKings",
      aliases: ["draftkings"],
      assetPath: "assets/sportsbooks/draftkings.png",
      assetType: "image/png",
      sourceUrl: "https://sportsbook.draftkings.com/",
      sourceAssetUrl: "https://sportsbook.draftkings.com/static/Sportsbook_sideRail_icon_2.png",
      preferredBackground: "#0b0e12",
      status: "ready"
    },
    {
      key: "fanduel",
      displayName: "FanDuel",
      aliases: ["fanduel"],
      assetPath: "assets/sportsbooks/fanduel.svg",
      assetType: "image/svg+xml",
      sourceUrl: "https://www.fanduel.com/",
      sourceAssetUrl: "https://s3.amazonaws.com/cdn.fanduel.com/images/2023/fanduel/homepage/facelift/shield-blue.svg",
      preferredBackground: "#eaf4ff",
      status: "ready"
    },
    {
      key: "betmgm",
      displayName: "BetMGM",
      aliases: ["betmgm"],
      assetPath: "assets/sportsbooks/betmgm.svg",
      assetType: "image/svg+xml",
      sourceUrl: "https://www.betmgm.com/en/sports",
      sourceAssetUrl: "inline:data-uri-from-official-betmgm-page",
      preferredBackground: "#000000",
      status: "ready"
    },
    {
      key: "caesars",
      displayName: "Caesars",
      aliases: ["caesars", "williamhill_us", "williamhill", "william hill"],
      assetPath: "assets/sportsbooks/caesars.svg",
      assetType: "image/svg+xml",
      sourceUrl: "https://sportsbook.caesars.com/",
      sourceAssetUrl: "https://sportsbook.caesars.com/us/build/czr/safari-pinned-tab.svg",
      preferredBackground: "#0a3532",
      status: "ready"
    },
    {
      key: "archivedconsensus",
      displayName: "Oddschecker Best",
      aliases: ["archived-consensus", "archivedconsensus", "oddschecker best", "oddschecker"],
      assetPath: null,
      assetType: null,
      sourceUrl: "https://www.oddschecker.com/us/",
      sourceAssetUrl: null,
      preferredBackground: null,
      status: "fallback-text"
    }
  ];

  function normalizeBookmakerKey(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function getSportsbookBrand(bookmaker) {
    var normalized = normalizeBookmakerKey(
      bookmaker && (bookmaker.key || bookmaker.title || bookmaker.name || bookmaker)
    );

    if (!normalized) return null;

    return BRAND_ENTRIES.find(function (entry) {
      return entry.aliases.some(function (alias) {
        var normalizedAlias = normalizeBookmakerKey(alias);
        return normalized === normalizedAlias || normalized.indexOf(normalizedAlias) !== -1;
      });
    }) || null;
  }

  global.MML_SPORTSBOOK_BRANDING = {
    brands: BRAND_ENTRIES,
    normalizeBookmakerKey: normalizeBookmakerKey,
    getSportsbookBrand: getSportsbookBrand
  };
})(window);
