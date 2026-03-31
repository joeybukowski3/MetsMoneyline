const { buildRecentGamesPayload } = require("../../_lib/mlb-data");
const { sendError, sendJson } = require("../../_lib/respond");

module.exports = async function handler(req, res) {
  try {
    const payload = await buildRecentGamesPayload();
    sendJson(res, 200, payload, { sMaxAge: 300, staleWhileRevalidate: 900 });
  } catch (error) {
    sendError(res, error, { sMaxAge: 300, staleWhileRevalidate: 300 });
  }
};
