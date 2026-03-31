const { buildUrl, fetchJsonWithRetry } = require("./http");

const DEFAULT_BASE_URL = "https://v1.baseball.api-sports.io";

function getApiSportsConfig() {
  const apiKey = process.env.API_SPORTS_KEY || "";
  const baseUrl = (process.env.API_SPORTS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  // Confirm these IDs against your API-SPORTS Baseball account if your subscription returns different league/team identifiers.
  const leagueId = process.env.API_SPORTS_MLB_LEAGUE_ID || "1";
  const metsTeamId = process.env.API_SPORTS_METS_TEAM_ID || "24";

  return {
    apiKey,
    baseUrl,
    leagueId,
    metsTeamId
  };
}

function buildApiSportsHeaders(config = getApiSportsConfig()) {
  const host = new URL(config.baseUrl).hostname;
  return {
    Accept: "application/json",
    "x-apisports-key": config.apiKey,
    "x-rapidapi-key": config.apiKey,
    "x-rapidapi-host": host
  };
}

async function apiSportsGet(pathname, params = {}, options = {}) {
  const config = getApiSportsConfig();
  if (!config.apiKey) {
    const error = new Error("Missing API_SPORTS_KEY");
    error.statusCode = 500;
    throw error;
  }

  const url = buildUrl(`${config.baseUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`, params);
  return fetchJsonWithRetry(url, {
    headers: buildApiSportsHeaders(config),
    retries: options.retries ?? 2,
    timeoutMs: options.timeoutMs ?? 15000
  });
}

module.exports = {
  apiSportsGet,
  buildApiSportsHeaders,
  getApiSportsConfig
};
