const { buildLiveGamePayload } = require("../../_lib/mlb-data");
const { sendError, sendJson } = require("../../_lib/respond");

module.exports = async function handler(req, res) {
  try {
    const payload = await buildLiveGamePayload();
    const isLive = Boolean(payload?.gameId) && /live|progress/i.test(String(payload?.status || ""));
    sendJson(res, 200, payload, isLive
      ? { sMaxAge: 20, staleWhileRevalidate: 20 }
      : { sMaxAge: 1200, staleWhileRevalidate: 300 });
  } catch (error) {
    sendError(res, error, { sMaxAge: 30, staleWhileRevalidate: 30 });
  }
};
