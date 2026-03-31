const axios = require("axios");

const DEFAULT_BASE_URL = process.env.API_SPORTS_BASE_URL || "https://v1.baseball.api-sports.io";

function getApiSportsConfig() {
  const apiKey = process.env.API_SPORTS_KEY || "";
  const baseUrl = (process.env.API_SPORTS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const leagueId = process.env.API_SPORTS_MLB_LEAGUE_ID || "1";
  const metsTeamId = process.env.API_SPORTS_METS_TEAM_ID || "24";

  return {
    apiKey,
    baseUrl,
    leagueId,
    metsTeamId
  };
}

function buildHeaders(config) {
  const hostname = new URL(config.baseUrl).hostname;
  return {
    Accept: "application/json",
    "x-apisports-key": config.apiKey,
    "x-rapidapi-key": config.apiKey,
    "x-rapidapi-host": hostname
  };
}

async function apiSportsGet(pathname, params = {}) {
  const config = getApiSportsConfig();
  if (!config.apiKey) {
    throw new Error("Missing API_SPORTS_KEY");
  }

  const url = `${config.baseUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  const response = await axios.get(url, {
    timeout: 15000,
    params,
    headers: buildHeaders(config)
  });

  return response.data;
}

module.exports = {
  apiSportsGet,
  getApiSportsConfig
};
