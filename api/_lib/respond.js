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
  // Log full error server-side but never expose stack traces or internal messages to clients
  console.error('[api-error]', statusCode, error?.message || error);
  sendJson(
    res,
    statusCode,
    {
      error: "Data temporarily unavailable",
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
