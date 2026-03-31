const { buildOddsPayload } = require("../../_lib/mlb-data");
const { sendError, sendJson } = require("../../_lib/respond");

module.exports = async function handler(req, res) {
  try {
    const payload = await buildOddsPayload();
    sendJson(res, 200, payload, { sMaxAge: 180, staleWhileRevalidate: 60 });
  } catch (error) {
    sendError(res, error, { sMaxAge: 30, staleWhileRevalidate: 30 });
  }
};
