const fs = require("fs");
const path = require("path");

const {
  TEAM_ID,
  getTodayEasternISO,
  selectFeaturedGame,
  resolveMetsGameForDate,
  generateOutputPackage,
  persistGeneratedOutput,
  buildDailyReportEmailHtml,
  buildPresentationReport,
  formatButtondownSubject,
  formatPreliminaryButtondownSubject,
  createButtondownEmail,
  updateButtondownEmail,
  getMostRecentConfirmedLineup
} = require("./generator");

const STATE_PATH = path.join(__dirname, "report-send-state.json");
const OUTPUT_DIR = path.join(__dirname, "output");
const LATEST_EMAIL_PREVIEW_PATH = path.join(OUTPUT_DIR, "latest-email-preview.html");
const WINDOW_MIN_MINUTES = 90;
const WINDOW_MAX_MINUTES = 130;

function parseArgs(argv) {
  const args = {
    date: getTodayEasternISO(),
    dryRun: false,
    skipWindow: false,
    allowDuplicate: false,
    debugAnalysis: false,
    testSend: false,
    allowProjected: false,
    draftOnly: false,
    forceSend: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--date") {
      args.date = argv[i + 1];
      i += 1;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    } else if (token === "--skip-window") {
      args.skipWindow = true;
    } else if (token === "--allow-duplicate") {
      args.allowDuplicate = true;
    } else if (token === "--debug-analysis") {
      args.debugAnalysis = true;
    } else if (token === "--test-send") {
      args.testSend = true;
    } else if (token === "--allow-projected") {
      args.allowProjected = true;
    } else if (token === "--draft-only") {
      args.draftOnly = true;
    } else if (token === "--force-send") {
      args.forceSend = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (args.draftOnly && args.forceSend) {
    throw new Error("Choose either --draft-only or --force-send, not both.");
  }

  return args;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function deriveGameId(gameFacts) {
  return `${gameFacts.meta.date}-mets-vs-${slugify(gameFacts.game.opponent)}`;
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const games = parsed?.games && typeof parsed.games === "object" ? parsed.games : {};
    const normalizedGames = Object.fromEntries(
      Object.entries(games).map(([gameId, entry]) => {
        const normalized = {
          gameId,
          firstPitchTime: entry?.firstPitchTime || null,
          testSent: Boolean(entry?.testSent),
          testSentAt: entry?.testSentAt || null,
          finalSent: Boolean(entry?.finalSent ?? entry?.sent),
          finalSentAt: entry?.finalSentAt || entry?.sentAt || null,
          lineupSourceUsedForTest: entry?.lineupSourceUsedForTest || null,
          buttondownEmailIdTest: entry?.buttondownEmailIdTest || null,
          buttondownEmailIdFinal: entry?.buttondownEmailIdFinal || entry?.buttondownEmailId || null,
          updatedAt: entry?.updatedAt || null
        };
        return [gameId, normalized];
      })
    );
    return { version: 2, games: normalizedGames };
  } catch {
    return { version: 2, games: {} };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function lineupsAreConfirmed(gameFacts) {
  return gameFacts?.lineups?.status === "confirmed"
    && Array.isArray(gameFacts?.lineups?.mets)
    && Array.isArray(gameFacts?.lineups?.opp)
    && gameFacts.lineups.mets.length >= 9
    && gameFacts.lineups.opp.length >= 9;
}

function startingPitchersAvailable(gameFacts) {
  return Boolean(gameFacts?.pitching?.mets?.announced && gameFacts?.pitching?.opp?.announced);
}

function lineupsAreUsable(lineups = {}) {
  return Array.isArray(lineups?.mets) && Array.isArray(lineups?.opp) && lineups.mets.length >= 9 && lineups.opp.length >= 9;
}

function formatIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getMinutesUntilFirstPitch(gameFacts) {
  const firstPitch = gameFacts?.meta?.gameDateTime ? new Date(gameFacts.meta.gameDateTime) : null;
  if (!firstPitch || Number.isNaN(firstPitch.getTime())) return null;
  return Math.floor((firstPitch.getTime() - Date.now()) / 60000);
}

function describeEligibility({ minutesUntilFirstPitch, lineupsConfirmed, pitchersReady, alreadySent, skipWindow }) {
  // skipWindow overrides everything except alreadySent (which is cleared by --allow-duplicate)
  if (skipWindow && !alreadySent) return { eligible: true, reason: "window bypassed manually" };
  if (alreadySent) return { eligible: false, reason: "already sent for this game" };
  if (minutesUntilFirstPitch == null) return { eligible: false, reason: "missing first-pitch timestamp" };
  if (minutesUntilFirstPitch <= 0) return { eligible: false, reason: "first pitch already passed" };
  if (!pitchersReady) return { eligible: false, reason: "starting pitchers are not both announced" };
  if (!lineupsConfirmed) return { eligible: false, reason: "both lineups are not confirmed yet" };
  if (minutesUntilFirstPitch >= WINDOW_MIN_MINUTES && minutesUntilFirstPitch <= WINDOW_MAX_MINUTES) {
    return { eligible: true, reason: "inside preferred 90-130 minute send window" };
  }
  if (minutesUntilFirstPitch > 0 && minutesUntilFirstPitch < WINDOW_MIN_MINUTES) {
    return { eligible: true, reason: "lineups confirmed late but still pregame" };
  }
  return { eligible: false, reason: "too early for send window" };
}

async function selectPreliminaryLineups(gameFacts, { allowProjected = false } = {}) {
  const currentLineups = gameFacts?.lineups || {};
  if (allowProjected && lineupsAreUsable(currentLineups)) {
    return {
      mets: currentLineups.mets,
      opp: currentLineups.opp,
      status: "projected",
      source: currentLineups.status === "confirmed" ? "confirmed" : "projected",
      sourceLabel: currentLineups.status === "confirmed" ? "confirmed lineups" : "projected lineups"
    };
  }

  const [metsFallback, oppFallback] = await Promise.all([
    getMostRecentConfirmedLineup(TEAM_ID, gameFacts.meta.date),
    getMostRecentConfirmedLineup(gameFacts.game.oppTeamId, gameFacts.meta.date)
  ]);

  if (metsFallback.length >= 9 && oppFallback.length >= 9) {
    return {
      mets: metsFallback,
      opp: oppFallback,
      status: "previous-game-fallback",
      source: "previous-game-fallback",
      sourceLabel: "previous game's lineups"
    };
  }

  if (lineupsAreUsable(currentLineups)) {
    return {
      mets: currentLineups.mets,
      opp: currentLineups.opp,
      status: currentLineups.status || "projected",
      source: currentLineups.status === "confirmed" ? "confirmed" : "projected",
      sourceLabel: currentLineups.status === "confirmed" ? "confirmed lineups" : "projected lineups"
    };
  }

  throw new Error("No usable projected or fallback lineups available for preliminary send.");
}

function buildPreliminaryNote(lineupSource) {
  if (lineupSource === "previous-game-fallback") {
    return "This is a preliminary report using the previous game's lineups as fallback until official lineups are confirmed. A final updated report will be sent when official lineups are confirmed.";
  }
  return "This is a preliminary report based on projected lineups. A final updated report will be sent when official lineups are confirmed.";
}

function applyPreliminaryLabels(game, lineupPlan) {
  if (!game) return game;
  game.lineups = {
    ...game.lineups,
    mets: lineupPlan.mets,
    opp: lineupPlan.opp,
    lineupStatus: lineupPlan.status
  };
  game.writeup = {
    ...game.writeup,
    preliminaryMeta: {
      enabled: true,
      titlePrefix: "PRELIMINARY REPORT",
      lineupSource: lineupPlan.source,
      lineupSourceLabel: lineupPlan.sourceLabel,
      note: buildPreliminaryNote(lineupPlan.source)
    }
  };
  game.writeup.report = buildPresentationReport(game);
  return game;
}

function writeLatestEmailPreview(bodyHtml) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(LATEST_EMAIL_PREVIEW_PATH, bodyHtml, "utf8");
}

function getRunMode(args) {
  if (args.draftOnly) return "draft-only";
  if (args.forceSend) return "force-send";
  return "scheduled";
}

function logEmailDebugInfo({ mode, subject, status, bodyHtml }) {
  const startsFancy = bodyHtml.startsWith("<!-- buttondown-editor-mode: fancy -->");
  const startsHtml = /^\s*(<!doctype html>|<html)/i.test(bodyHtml);
  const includesLegacyMarker = bodyHtml.includes("TONIGHT'S PICK");

  console.log(`[send] mode: ${mode}`);
  console.log(`[send] subject: ${subject}`);
  console.log(`[send] Buttondown status: ${status}`);
  console.log(`[send] body length: ${bodyHtml.length} chars`);
  console.log(`[send] body starts with fancy editor comment: ${startsFancy ? "yes" : "no"}`);
  console.log(`[send] body starts with HTML: ${startsHtml ? "yes" : "no"}`);
  console.log(`[send] includes "Matchup Snapshot": ${bodyHtml.includes("Matchup Snapshot") ? "true" : "false"}`);
  console.log(`[send] includes "Last 20 Game Trend": ${bodyHtml.includes("Last 20 Game Trend") ? "true" : "false"}`);
  console.log(`[send] includes "Bullpen Trend": ${bodyHtml.includes("Bullpen Trend") ? "true" : "false"}`);
  console.log(`[send] includes "Model Read": ${bodyHtml.includes("Model Read") ? "true" : "false"}`);
  console.log(`[send] includes legacy marker "TONIGHT'S PICK": ${includesLegacyMarker ? "true" : "false"}`);
  if (includesLegacyMarker) {
    console.warn("[send] WARNING: legacy plain-text marker detected in HTML body.");
  }
}

function getDraftReference(emailRecord) {
  if (!emailRecord) return "(unknown draft)";
  return (
    emailRecord.absolute_url
    || emailRecord.admin_url
    || emailRecord.url
    || emailRecord.web_url
    || emailRecord.id
    || "(unknown draft)"
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = getRunMode(args);
  console.log(`Checking Mets report send window for ${args.date}${args.dryRun ? " (dry run)" : ""}${args.skipWindow ? " (skip window)" : ""}${args.allowDuplicate ? " (allow duplicate)" : ""}${args.testSend ? " (test send)" : ""}${args.allowProjected ? " (allow projected)" : ""}${args.draftOnly ? " (draft only)" : ""}${args.forceSend ? " (force send)" : ""}...`);

  const resolvedGame = await resolveMetsGameForDate(args.date, {
    allowSeriesContinuation: true,
    allowFutureFallback: false,
    log: true
  });
  if (!resolvedGame) {
    console.log(`No Mets game scheduled for ${args.date}.`);
    return;
  }

  // Generate the full report package first so the site always shows fresh data,
  // regardless of whether the email is eligible to send today.
  const { skipped, gameFacts, output } = await generateOutputPackage({
    date: args.date,
    dryRun: args.dryRun,
    debugAnalysis: args.debugAnalysis
  });

  if (skipped || !gameFacts) {
    console.log("Generator returned no data — keeping existing report.");
    return;
  }

  // Persist site data unconditionally on every run (not for dry-run or testSend,
  // which use modified lineups and should not overwrite the real-data report).
  if (!args.dryRun && !args.testSend) {
    persistGeneratedOutput(output, { referenceDate: args.date });
    console.log(`[refresh] Site report updated for ${args.date}`);
  }

  const gameId = deriveGameId(gameFacts);
  const state = loadState();
  const existingState = state.games[gameId] || {};
  const minutesUntilFirstPitch = getMinutesUntilFirstPitch(gameFacts);
  const lineupsConfirmed = lineupsAreConfirmed(gameFacts);
  const pitchersReady = startingPitchersAvailable(gameFacts);
  const alreadySent = args.testSend
    ? (!args.allowDuplicate && existingState.testSent === true)
    : (!args.allowDuplicate && existingState.finalSent === true);
  const decision = args.testSend
    ? (() => {
        if (alreadySent) return { eligible: false, reason: "preliminary report already sent for this game" };
        if (minutesUntilFirstPitch == null) return { eligible: false, reason: "missing first-pitch timestamp" };
        if (minutesUntilFirstPitch <= 0) return { eligible: false, reason: "first pitch already passed" };
        if (!pitchersReady) return { eligible: false, reason: "starting pitchers are not both announced" };
        return { eligible: true, reason: "manual preliminary send allowed before confirmed lineups" };
      })()
    : describeEligibility({
        minutesUntilFirstPitch,
        lineupsConfirmed,
        pitchersReady,
        alreadySent,
        skipWindow: args.skipWindow || args.draftOnly || args.forceSend
      });

  console.log(`Game: ${gameId}`);
  console.log(`Resolved game source: ${gameFacts?.canonicalGameSource?.source || resolvedGame.source || "unknown"}`);
  console.log(`Minutes until first pitch: ${minutesUntilFirstPitch == null ? "unknown" : minutesUntilFirstPitch}`);
  console.log(`Lineups confirmed: ${lineupsConfirmed ? "yes" : "no"}`);
  console.log(`Starting pitchers announced: ${pitchersReady ? "yes" : "no"}`);
  console.log(`Decision: ${decision.eligible ? "sendable" : "hold"} (${decision.reason})`);

  if (!decision.eligible) {
    return;
  }

  const game = selectFeaturedGame(output?.games, args.date);
  if (!game) {
    throw new Error("Generator did not return a report payload.");
  }
  let lineupPlan = null;
  if (args.testSend) {
    lineupPlan = await selectPreliminaryLineups(gameFacts, { allowProjected: args.allowProjected });
    applyPreliminaryLabels(game, lineupPlan);
  }
  const firstPitchIso = formatIso(gameFacts?.meta?.gameDateTime);

  if (args.dryRun) {
    console.log(JSON.stringify({
      gameId,
      firstPitchTime: firstPitchIso,
      subject: args.testSend
        ? formatPreliminaryButtondownSubject(game, lineupPlan?.sourceLabel || "projected lineups")
        : formatButtondownSubject(game),
      analyticalLean: game?.writeup?.analyticalLean || null,
      officialPick: game?.writeup?.officialPick || null,
      lineupStatus: game?.lineups?.lineupStatus || null,
      lineupSourceUsedForTest: lineupPlan?.source || null,
      reportTitle: game?.writeup?.report?.header?.title || null
    }, null, 2));
    return;
  }

  const gameState = {
    gameId,
    firstPitchTime: firstPitchIso,
    testSent: Boolean(existingState.testSent),
    testSentAt: existingState.testSentAt || null,
    finalSent: Boolean(existingState.finalSent),
    finalSentAt: existingState.finalSentAt || null,
    lineupSourceUsedForTest: existingState.lineupSourceUsedForTest || null,
    buttondownEmailIdTest: existingState.buttondownEmailIdTest || null,
    buttondownEmailIdFinal: existingState.buttondownEmailIdFinal || null,
    updatedAt: new Date().toISOString()
  };

  const subject = args.testSend
    ? formatPreliminaryButtondownSubject(game, lineupPlan?.sourceLabel || "projected lineups")
    : formatButtondownSubject(game);

  // Goal: send the designed HTML matchup snapshot through Buttondown, not the legacy text summary.
  // Build the full HTML report for the email body.
  console.log(`[send] Building email HTML…`);
  let bodyHtml;
  try {
    bodyHtml = buildDailyReportEmailHtml(game);
  } catch (htmlErr) {
    throw new Error(`[send] buildDailyReportEmailHtml threw: ${htmlErr.message}`);
  }
  if (!bodyHtml || bodyHtml.trim().length < 1000) {
    throw new Error(`[send] bodyHtml is too short (${bodyHtml?.length ?? 0} chars) — refusing to generate blank report`);
  }
  writeLatestEmailPreview(bodyHtml);
  console.log(`[send] Wrote HTML preview to ${LATEST_EMAIL_PREVIEW_PATH}`);

  // Also write the condensed HTML as a debug artifact
  try {
    const condensedDir = path.join(__dirname, "output");
    const condensedPath = path.join(condensedDir, `${gameId}-email-condensed.html`);
    fs.mkdirSync(condensedDir, { recursive: true });
    fs.writeFileSync(condensedPath, bodyHtml, "utf8");
    console.log(`[send] Wrote email HTML to ${condensedPath}`);
  } catch (writeErr) {
    console.warn(`[send] Could not write debug artifact: ${writeErr.message}`);
  }

  const emailIdKey = args.testSend ? "buttondownEmailIdTest" : "buttondownEmailIdFinal";
  const forceFreshDraft = Boolean(args.allowDuplicate);
  const createStatus = "draft";
  const finalStatus = args.draftOnly ? "draft" : "about_to_send";

  if (forceFreshDraft) {
    gameState[emailIdKey] = null;
  }

  logEmailDebugInfo({
    mode,
    subject,
    status: !gameState[emailIdKey] ? createStatus : finalStatus,
    bodyHtml
  });

  let emailRecord = null;
  if (!gameState[emailIdKey]) {
    console.log(`[send] Creating Buttondown email in ${createStatus} status.`);
    const created = await createButtondownEmail({ game, status: "draft", subject, body: bodyHtml });
    if (!created?.id) {
      throw new Error("Buttondown draft creation did not return an id.");
    }
    emailRecord = created;
    gameState[emailIdKey] = created.id;
    state.games[gameId] = gameState;
    saveState(state);
    console.log(`Created Buttondown draft ${getDraftReference(created)}.`);
  }

  if (args.draftOnly) {
    console.log("[send] Draft-only mode active. Updating draft and exiting before any send/publish status.");
    emailRecord = await updateButtondownEmail(gameState[emailIdKey], {
      subject,
      body: bodyHtml,
      status: "draft"
    });
    gameState.updatedAt = new Date().toISOString();
    state.games[gameId] = gameState;
    saveState(state);
    console.log(`Buttondown draft ready: ${getDraftReference(emailRecord)}`);
    return;
  }

  console.log(`[send] Updating Buttondown email ${gameState[emailIdKey]} to ${finalStatus}.`);
  await updateButtondownEmail(gameState[emailIdKey], {
    subject,
    body: bodyHtml,
    status: finalStatus
  });

  if (args.testSend) {
    gameState.testSent = true;
    gameState.testSentAt = new Date().toISOString();
    gameState.lineupSourceUsedForTest = lineupPlan?.source || null;
    gameState.updatedAt = gameState.testSentAt;
  } else {
    gameState.finalSent = true;
    gameState.finalSentAt = new Date().toISOString();
    gameState.updatedAt = gameState.finalSentAt;
  }
  state.games[gameId] = gameState;
  saveState(state);

  console.log(`Queued Buttondown email ${gameState[emailIdKey]} for ${gameId}${args.testSend ? " (test)" : " (final)"}.`);
}

main().catch((error) => {
  console.error("Report send check failed:", error.message);
  process.exit(1);
});
