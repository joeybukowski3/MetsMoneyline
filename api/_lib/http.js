function buildUrl(baseUrl, params = {}) {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

async function fetchJsonWithRetry(url, options = {}) {
  const {
    headers = {},
    retries = 2,
    timeoutMs = 15000,
    parseJson = true
  } = options;

  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs)
      });

      console.log(`[debug] HTTP ${response.status} ${url}`);

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const error = new Error(`Request failed: ${response.status} ${url}${body ? ` :: ${body.slice(0, 200)}` : ""}`);
        error.statusCode = response.status;
        throw error;
      }

      return parseJson ? response.json() : response;
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }

  throw lastError || new Error(`Request failed: ${url}`);
}

module.exports = {
  buildUrl,
  fetchJsonWithRetry
};
