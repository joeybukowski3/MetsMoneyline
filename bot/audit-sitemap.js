const fs = require("fs");
const path = require("path");

const SITEMAP_PATH = path.join(__dirname, "../public/sitemap.xml");

function getUrls(xml) {
  return Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g)).map((match) => match[1].trim());
}

async function fetchStatus(url) {
  try {
    const response = await fetch(url, { redirect: "follow" });
    return {
      url,
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
    };
  } catch (error) {
    return {
      url,
      ok: false,
      status: "ERR",
      finalUrl: null,
      error: error.message,
    };
  }
}

async function main() {
  const xml = fs.readFileSync(SITEMAP_PATH, "utf8");
  const urls = getUrls(xml);
  const results = [];

  for (const url of urls) {
    const result = await fetchStatus(url);
    results.push(result);
    const suffix = result.error ? ` (${result.error})` : result.finalUrl && result.finalUrl !== url ? ` -> ${result.finalUrl}` : "";
    console.log(`${result.status}\t${url}${suffix}`);
  }

  const broken = results.filter((result) => !result.ok);
  console.log("");
  console.log(`Checked ${results.length} sitemap URLs`);
  console.log(`Broken URLs: ${broken.length}`);
  if (broken.length) {
    broken.forEach((result) => {
      console.log(`BROKEN\t${result.status}\t${result.url}${result.error ? ` (${result.error})` : ""}`);
    });
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
