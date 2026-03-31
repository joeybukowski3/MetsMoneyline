const { buildStandingsPayload } = require("../../_lib/mlb-data");
const { sendError, sendJson } = require("../../_lib/respond");

module.exports = async function handler(req, res) {
  try {
    const payload = await buildStandingsPayload();
    sendJson(res, 200, payload, { sMaxAge: 900, staleWhileRevalidate: 300 });
  } catch (error) {
    sendError(res, error, { sMaxAge: 60, staleWhileRevalidate: 60 });
  }
};
