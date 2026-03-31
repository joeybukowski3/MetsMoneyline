function setCacheHeaders(res, { sMaxAge, staleWhileRevalidate = 60 }) {
  res.setHeader(
    "Cache-Control",
    `public, s-maxage=${Math.max(0, sMaxAge || 0)}, stale-while-revalidate=${Math.max(0, staleWhileRevalidate || 0)}`
  );
}

function sendJson(res, statusCode, payload, cacheOptions) {
  if (cacheOptions) setCacheHeaders(res, cacheOptions);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(statusCode).send(JSON.stringify(payload));
}

function sendError(res, error, cacheOptions) {
  const statusCode = error?.statusCode && Number(error.statusCode) >= 400 ? Number(error.statusCode) : 500;
  sendJson(
    res,
    statusCode,
    {
      error: "Failed to load Mets data endpoint",
      message: error?.message || "Unknown error",
      generatedAt: new Date().toISOString()
    },
    cacheOptions
  );
}

module.exports = {
  sendError,
  sendJson,
  setCacheHeaders
};
