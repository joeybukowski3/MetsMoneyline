const fs = require("fs");
const path = require("path");

const {
  getTodayEasternISO,
  getGameForDate,
  buildGameFacts,
  generateOutputPackage,
  persistGeneratedOutput,
  buildEmailHtml,
  formatButtondownSubject,
  createButtondownEmail,
  updateButtondownEmail
} = require("./generator");

const STATE_PATH = path.join(__dirname, "report-send-state.json");
const WINDOW_MIN_MINUTES = 90;
const WINDOW_MAX_MINUTES = 130;

function parseArgs(argv) {
  const args = {
    date: getTodayEasternISO(),
    dryRun: false,
    skipWindow: false,
    allowDuplicate: false,
    debugAnalysis: false
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
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
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
    return parsed && typeof parsed === "object"
      ? { version: 1, games: parsed.games && typeof parsed.games === "object" ? parsed.games : {} }
      : { version: 1, games: {} };
  } catch {
    return { version: 1, games: {} };
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
  if (alreadySent) return { eligible: false, reason: "already sent for this game" };
  if (minutesUntilFirstPitch == null) return { eligible: false, reason: "missing first-pitch timestamp" };
  if (minutesUntilFirstPitch <= 0) return { eligible: false, reason: "first pitch already passed" };
  if (!pitchersReady) return { eligible: false, reason: "starting pitchers are not both announced" };
  if (!lineupsConfirmed) return { eligible: false, reason: "both lineups are not confirmed yet" };
  if (skipWindow) return { eligible: true, reason: "window bypassed manually" };
  if (minutesUntilFirstPitch >= WINDOW_MIN_MINUTES && minutesUntilFirstPitch <= WINDOW_MAX_MINUTES) {
    return { eligible: true, reason: "inside preferred 90-130 minute send window" };
  }
  if (minutesUntilFirstPitch > 0 && minutesUntilFirstPitch < WINDOW_MIN_MINUTES) {
    return { eligible: true, reason: "lineups confirmed late but still pregame" };
  }
  return { eligible: false, reason: "too early for send window" };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Checking Mets report send window for ${args.date}${args.dryRun ? " (dry run)" : ""}${args.skipWindow ? " (skip window)" : ""}${args.allowDuplicate ? " (allow duplicate)" : ""}...`);

  const scheduledGame = await getGameForDate(args.date);
  if (!scheduledGame) {
    console.log(`No Mets game scheduled for ${args.date}.`);
    return;
  }

  const gameFacts = await buildGameFacts(args.date);
  const gameId = deriveGameId(gameFacts);
  const state = loadState();
  const existingState = state.games[gameId] || {};
  const minutesUntilFirstPitch = getMinutesUntilFirstPitch(gameFacts);
  const lineupsConfirmed = lineupsAreConfirmed(gameFacts);
  const pitchersReady = startingPitchersAvailable(gameFacts);
  const alreadySent = !args.allowDuplicate && existingState.sent === true;
  const decision = describeEligibility({
    minutesUntilFirstPitch,
    lineupsConfirmed,
    pitchersReady,
    alreadySent,
    skipWindow: args.skipWindow
  });

  console.log(`Game: ${gameId}`);
  console.log(`Minutes until first pitch: ${minutesUntilFirstPitch == null ? "unknown" : minutesUntilFirstPitch}`);
  console.log(`Lineups confirmed: ${lineupsConfirmed ? "yes" : "no"}`);
  console.log(`Starting pitchers announced: ${pitchersReady ? "yes" : "no"}`);
  console.log(`Decision: ${decision.eligible ? "sendable" : "hold"} (${decision.reason})`);

  if (!decision.eligible) {
    return;
  }

  const { skipped, output } = await generateOutputPackage({
    date: args.date,
    dryRun: args.dryRun,
    debugAnalysis: args.debugAnalysis
  });
  if (skipped || !output?.games?.[0]) {
    throw new Error("Generator did not return a report payload.");
  }

  const game = output.games[0];
  const firstPitchIso = formatIso(gameFacts?.meta?.gameDateTime);

  if (args.dryRun) {
    console.log(JSON.stringify({
      gameId,
      firstPitchTime: firstPitchIso,
      subject: formatButtondownSubject(game),
      analyticalLean: game?.writeup?.analyticalLean || null,
      officialPick: game?.writeup?.officialPick || null,
      lineupStatus: game?.lineups?.lineupStatus || null,
      reportTitle: game?.writeup?.report?.header?.title || null
    }, null, 2));
    return;
  }

  persistGeneratedOutput(output);

  const gameState = {
    gameId,
    firstPitchTime: firstPitchIso,
    sent: false,
    sentAt: null,
    buttondownEmailId: existingState.buttondownEmailId || null,
    updatedAt: new Date().toISOString()
  };

  const subject = formatButtondownSubject(game);
  const body = buildEmailHtml(game);

  if (!gameState.buttondownEmailId) {
    const created = await createButtondownEmail({ game, status: "draft" });
    if (!created?.id) {
      throw new Error("Buttondown draft creation did not return an id.");
    }
    gameState.buttondownEmailId = created.id;
    state.games[gameId] = gameState;
    saveState(state);
    console.log(`Created Buttondown draft ${created.id}.`);
  }

  await updateButtondownEmail(gameState.buttondownEmailId, {
    subject,
    body,
    status: "about_to_send"
  });

  gameState.sent = true;
  gameState.sentAt = new Date().toISOString();
  gameState.updatedAt = gameState.sentAt;
  state.games[gameId] = gameState;
  saveState(state);

  console.log(`Queued Buttondown email ${gameState.buttondownEmailId} to send for ${gameId}.`);
}

main().catch((error) => {
  console.error("Report send check failed:", error.message);
  process.exit(1);
});
