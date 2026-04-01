#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const dotenv = require("dotenv");

const { apiSportsGet, getApiSportsConfig } = require("./lib/api-sports-client");
const { TEAM_IDENTITIES, resolveTeamIdentity } = require("../lib/mlb-team-identity");

dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

const OUTPUT_DIR = path.resolve(__dirname, "../public/logos/mlb");
const REPORT_PATH = path.resolve(__dirname, "mlb-logo-download-report.json");
const VIEWBOX_SIZE = 512;
const TARGET_SEASON = Number(process.env.API_SPORTS_MLB_SEASON || "2026");

function getOutputFilename(team) {
  return `${String(team.abbreviation || "").trim().toLowerCase()}.svg`;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['.]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildLookupMap() {
  const map = new Map();
  for (const team of TEAM_IDENTITIES) {
    const keys = [
      team.name,
      team.abbreviation,
      team.canonicalKey,
      ...(team.aliases || []),
      String(team.mlbStatsTeamId || "")
    ];
    for (const key of keys) {
      const normalized = normalizeText(key);
      if (normalized) map.set(normalized, team);
    }
  }
  return map;
}

const TEAM_LOOKUP = buildLookupMap();

function extractTeamRecord(entry) {
  if (!entry || typeof entry !== "object") return null;

  const teamData = entry.team && typeof entry.team === "object" ? entry.team : entry;
  const metadata = entry.team && typeof entry.team === "object" ? entry : null;
  if (!teamData || typeof teamData !== "object") return null;

  return {
    team: teamData,
    metadata
  };
}

function normalizeApiTeamCode(teamData) {
  return (
    teamData.code ||
    teamData.abbreviation ||
    teamData.shortName ||
    teamData.short_name ||
    teamData.slug ||
    null
  );
}

function getApiLogoUrl(teamData, metadata) {
  if (!teamData && !metadata) return null;
  return (
    teamData?.logo ||
    teamData?.image ||
    teamData?.images?.logo ||
    teamData?.images?.default ||
    metadata?.logo ||
    metadata?.image ||
    metadata?.images?.logo ||
    metadata?.images?.default ||
    null
  );
}

function resolveTeamFromApiEntry(entry) {
  const record = extractTeamRecord(entry);
  if (!record) return null;
  const { team: teamData, metadata } = record;
  const apiCode = normalizeApiTeamCode(teamData);

  const direct = resolveTeamIdentity({
    name: teamData.name,
    abbreviation: apiCode,
    team: teamData.name
  });
  if (direct) return direct;

  const candidates = [
    teamData.id,
    teamData.name,
    apiCode,
    teamData.abbreviation,
    teamData.shortName,
    teamData.short_name,
    teamData.nickname,
    teamData.nickName,
    teamData.city,
    teamData.location,
    `${teamData.city || teamData.location || ""} ${teamData.nickname || teamData.nickName || ""}`.trim(),
    `${teamData.city || teamData.location || ""} ${teamData.name || ""}`.trim(),
    metadata?.name,
    metadata?.code,
    metadata?.abbreviation
  ];

  for (const value of candidates) {
    const match = TEAM_LOOKUP.get(normalizeText(value));
    if (match) return match;
  }

  return null;
}

function summarizeKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value).sort();
}

function extractTeamsFromPayload(payload) {
  const candidates = [
    { path: "response", value: payload?.response },
    { path: "response.teams", value: payload?.response?.teams },
    { path: "data.response", value: payload?.data?.response },
    { path: "data.teams", value: payload?.data?.teams },
    { path: "teams", value: payload?.teams },
    { path: "data", value: payload?.data }
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate.value)) {
      return {
        teams: candidate.value,
        path: candidate.path
      };
    }
  }

  return {
    teams: [],
    path: null
  };
}

function printDebugResponse(payload, extraction) {
  const rawShape = {
    topLevelKeys: summarizeKeys(payload),
    responseType: Array.isArray(payload?.response) ? "array" : typeof payload?.response,
    responseKeys: summarizeKeys(payload?.response),
    dataType: Array.isArray(payload?.data) ? "array" : typeof payload?.data,
    dataKeys: summarizeKeys(payload?.data),
    nestedResponseType: Array.isArray(payload?.data?.response) ? "array" : typeof payload?.data?.response,
    nestedResponseKeys: summarizeKeys(payload?.data?.response),
    selectedTeamPath: extraction.path
  };

  console.log("API-SPORTS /teams raw response shape:");
  console.log(JSON.stringify(rawShape, null, 2));

  console.log(`Total teams returned: ${extraction.teams.length}`);
  console.log("First 10 team objects:");
  console.log(JSON.stringify(extraction.teams.slice(0, 10), null, 2));

  console.log("Team field summary:");
  for (const entry of extraction.teams) {
    const record = extractTeamRecord(entry);
    const teamData = record?.team || {};
    const logoUrl = getApiLogoUrl(teamData, record?.metadata);
    const code = normalizeApiTeamCode(teamData);
    console.log(JSON.stringify({
      id: teamData.id ?? null,
      name: teamData.name ?? null,
      code: code ?? null,
      logo: logoUrl ?? null
    }));
  }
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildSvgAsset({ mimeType, base64Data, teamName, sourceUrl }) {
  const safeTeamName = escapeXml(teamName);
  const safeSourceUrl = escapeXml(sourceUrl);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}" role="img" aria-label="${safeTeamName} logo">`,
    `  <title>${safeTeamName} logo</title>`,
    `  <desc>Downloaded from ${safeSourceUrl}</desc>`,
    `  <image href="data:${mimeType};base64,${base64Data}" x="0" y="0" width="${VIEWBOX_SIZE}" height="${VIEWBOX_SIZE}" preserveAspectRatio="xMidYMid meet"/>`,
    `</svg>`,
    ""
  ].join("\n");
}

async function fetchLogoBytes(url) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 20000,
    maxRedirects: 5,
    headers: { Accept: "image/*,*/*;q=0.8" }
  });

  const contentType = String(response.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  return {
    bytes: Buffer.from(response.data),
    mimeType: contentType || "application/octet-stream"
  };
}

function toReportRow({ localTeam, apiTeam, logoUrl, status, outputFile, reason }) {
  return {
    team: localTeam.name,
    abbreviation: localTeam.abbreviation,
    outputFile,
    apiSportsTeamId: apiTeam?.id ?? apiTeam?.team?.id ?? null,
    apiSportsName: apiTeam?.name ?? apiTeam?.team?.name ?? null,
    logoUrl: logoUrl || null,
    status,
    reason: reason || null
  };
}

async function fetchApiTeams() {
  const config = getApiSportsConfig();
  const params = {
    league: String(config.leagueId || "1"),
    season: String(TARGET_SEASON)
  };

  console.log(`Requesting API-SPORTS teams with /teams?league=${params.league}&season=${params.season}`);
  const payload = await apiSportsGet("/teams", params);
  const extraction = extractTeamsFromPayload(payload);

  printDebugResponse(payload, extraction);

  if (!extraction.path) {
    throw new Error("API-SPORTS /teams returned an unexpected payload shape; no array-like teams collection found.");
  }

  return extraction.teams;
}

async function main() {
  const config = getApiSportsConfig();
  if (!config.apiKey) {
    throw new Error("Missing API_SPORTS_KEY in environment.");
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const apiTeams = await fetchApiTeams();
  const matchedApiTeams = new Map();
  const report = [];

  for (const entry of apiTeams) {
    const record = extractTeamRecord(entry);
    const resolved = resolveTeamFromApiEntry(entry);
    if (resolved && !matchedApiTeams.has(resolved.canonicalKey)) {
      matchedApiTeams.set(resolved.canonicalKey, record);
    }
  }

  for (const localTeam of TEAM_IDENTITIES) {
    const apiRecord = matchedApiTeams.get(localTeam.canonicalKey);
    const apiTeam = apiRecord?.team || null;
    const apiMetadata = apiRecord?.metadata || null;
    const outputFile = path.join(OUTPUT_DIR, getOutputFilename(localTeam));

    if (!apiTeam) {
      report.push(toReportRow({
        localTeam,
        apiTeam: null,
        logoUrl: null,
        status: "failed",
        outputFile,
        reason: "No matching MLB team found in API-SPORTS response."
      }));
      continue;
    }

    const logoUrl = getApiLogoUrl(apiTeam, apiMetadata);
    if (!logoUrl) {
      report.push(toReportRow({
        localTeam,
        apiTeam,
        logoUrl: null,
        status: "failed",
        outputFile,
        reason: "API-SPORTS team entry did not include a logo URL."
      }));
      continue;
    }

    try {
      const { bytes, mimeType } = await fetchLogoBytes(logoUrl);
      const svgAsset = buildSvgAsset({
        mimeType,
        base64Data: bytes.toString("base64"),
        teamName: localTeam.name,
        sourceUrl: logoUrl
      });
      fs.writeFileSync(outputFile, svgAsset, "utf8");

      report.push(toReportRow({
        localTeam,
        apiTeam,
        logoUrl,
        status: "success",
        outputFile,
        reason: null
      }));
    } catch (error) {
      report.push(toReportRow({
        localTeam,
        apiTeam,
        logoUrl,
        status: "failed",
        outputFile,
        reason: error.message
      }));
    }
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    apiSportsBaseUrl: config.baseUrl,
    leagueId: config.leagueId,
    season: TARGET_SEASON,
    outputDirectory: OUTPUT_DIR,
    totals: {
      success: report.filter((row) => row.status === "success").length,
      failed: report.filter((row) => row.status === "failed").length
    },
    teams: report
  }, null, 2));

  console.log(`MLB logo download report written to ${REPORT_PATH}`);
  for (const row of report) {
    const marker = row.status === "success" ? "OK" : "FAIL";
    const detail = row.status === "success"
      ? `${row.logoUrl} -> ${row.outputFile}`
      : row.reason;
    console.log(`[${marker}] ${row.abbreviation} ${row.team}: ${detail}`);
  }

  if (report.some((row) => row.status === "failed")) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`MLB logo download failed: ${error.message}`);
  process.exit(1);
});
