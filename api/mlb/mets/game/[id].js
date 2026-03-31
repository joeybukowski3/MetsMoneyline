const { buildGameDetailsPayload } = require("../../../_lib/mlb-data");
const { sendError, sendJson } = require("../../../_lib/respond");

module.exports = async function handler(req, res) {
  try {
    const gameId = req.query?.id;
    const payload = await buildGameDetailsPayload(gameId);
    const status = String(payload?.status || "").toLowerCase();
    const cacheOptions = /live|progress/.test(status)
      ? { sMaxAge: 20, staleWhileRevalidate: 20 }
      : /final|completed/.test(status)
        ? { sMaxAge: 21600, staleWhileRevalidate: 86400 }
        : { sMaxAge: 1200, staleWhileRevalidate: 300 };

    sendJson(res, 200, payload, cacheOptions);
  } catch (error) {
    sendError(res, error, { sMaxAge: 60, staleWhileRevalidate: 60 });
  }
};
