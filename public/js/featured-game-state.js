(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.MetsFeaturedGameState = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const EASTERN_TIME_ZONE = "America/New_York";
  const DAY_MS = 24 * 60 * 60 * 1000;

  function getEasternDateISO(value = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: EASTERN_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(value);
  }

  function parseDateOnlyToUtcMidday(dateIso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateIso || ""))) return null;
    const parsed = new Date(`${dateIso}T12:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function normalizeGameDate(game) {
    if (!game) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(game.date || ""))) return game.date;
    const candidate = game.gameDateTime || game.startTime || game.raw?.gameDate || game.raw?.date || null;
    if (!candidate) return null;
    const parsed = new Date(candidate);
    if (Number.isNaN(parsed.getTime())) return null;
    return getEasternDateISO(parsed);
  }

  function normalizeStatusText(game) {
    return String(
      game?.status
      || game?.statusText
      || game?.raw?.status?.detailedState
      || game?.raw?.status?.abstractGameState
      || ""
    ).toLowerCase();
  }

  function isCancelledLike(game) {
    const status = normalizeStatusText(game);
    return /postponed|postponement|suspended|cancelled|canceled|ppd/.test(status);
  }

  function isFinalGame(game) {
    const status = normalizeStatusText(game);
    if (game?.result === "W" || game?.result === "L" || game?.status === "final") return true;
    return /final|completed|game over/.test(status);
  }

  function isLiveGame(game) {
    const status = normalizeStatusText(game);
    return /live|in progress|manager challenge|delayed start|delayed|warmup/.test(status);
  }

  function resolveGameTimestamp(game) {
    const direct = game?.gameDateTime || game?.startTime || game?.raw?.gameDate || game?.raw?.date;
    if (direct) {
      const parsed = new Date(direct);
      if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
    }

    const gameDate = normalizeGameDate(game);
    const timeLabel = String(game?.time || "").trim();
    const match = timeLabel.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!gameDate || !match) return parseDateOnlyToUtcMidday(gameDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;

    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const meridiem = match[3].toUpperCase();
    if (meridiem === "PM" && hour !== 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
    const hh = String(hour).padStart(2, "0");
    const mm = String(minute).padStart(2, "0");
    return new Date(`${gameDate}T${hh}:${mm}:00-04:00`).getTime();
  }

  function compareGamesForDisplay(a, b) {
    const liveDelta = Number(isLiveGame(b)) - Number(isLiveGame(a));
    if (liveDelta !== 0) return liveDelta;
    return resolveGameTimestamp(a) - resolveGameTimestamp(b);
  }

  function diffCalendarDays(fromIso, toIso) {
    const from = parseDateOnlyToUtcMidday(fromIso);
    const to = parseDateOnlyToUtcMidday(toIso);
    if (!from || !to) return null;
    return Math.round((to.getTime() - from.getTime()) / DAY_MS);
  }

  function isPlayableScheduledGame(game) {
    if (!game) return false;
    if (isCancelledLike(game)) return false;
    if (isFinalGame(game)) return false;
    return Boolean(normalizeGameDate(game));
  }

  function buildStateLogLines(state) {
    return [
      `Current site date/time: ${state.nowIso}`,
      `Derived local baseball date: ${state.referenceDate}`,
      `Today game: ${state.todayGame ? `${state.todayGame.date} ${state.todayGame.opponent}` : "none"}`,
      `Next upcoming game: ${state.nextUpcomingGame ? `${state.nextUpcomingGame.date} ${state.nextUpcomingGame.opponent}` : "none"}`,
      `Selected featured game: ${state.featuredGame ? `${state.featuredGame.date} ${state.featuredGame.opponent}` : "none"}`,
      `Featured state: ${state.kind}`,
      `Display label: ${state.displayLabel}`,
      `Off day: ${state.offDay ? "yes" : "no"}`
    ];
  }

  function resolveFeaturedGameState(games, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();
    const referenceDate = options.referenceDate || getEasternDateISO(now);
    const lookaheadDays = Number.isFinite(options.lookaheadDays) ? options.lookaheadDays : 7;
    const normalizedGames = Array.isArray(games)
      ? games
          .map((game) => {
            if (!game) return null;
            const normalizedDate = normalizeGameDate(game);
            if (!normalizedDate) return null;
            return { ...game, date: normalizedDate };
          })
          .filter(Boolean)
      : [];

    const sortedGames = normalizedGames.slice().sort(compareGamesForDisplay);
    const todayGames = sortedGames
      .filter((game) => game.date === referenceDate && isPlayableScheduledGame(game))
      .sort(compareGamesForDisplay);

    const futureGames = sortedGames.filter((game) => {
      if (!isPlayableScheduledGame(game)) return false;
      const dayDiff = diffCalendarDays(referenceDate, game.date);
      return dayDiff != null && dayDiff >= 1 && dayDiff <= lookaheadDays;
    });

    const todayGame = todayGames[0] || null;
    const nextUpcomingGame = futureGames[0] || null;
    const featuredGame = todayGame || nextUpcomingGame || null;

    let kind = "no-upcoming-data";
    let displayLabel = "No Mets game today";
    let offDay = false;

    if (todayGame) {
      kind = "today";
      displayLabel = "Today's Game";
    } else if (nextUpcomingGame) {
      offDay = true;
      const dayDiff = diffCalendarDays(referenceDate, nextUpcomingGame.date);
      if (dayDiff === 1) {
        kind = "tomorrow";
        displayLabel = "Tomorrow's Game";
      } else {
        kind = "next";
        displayLabel = "Next Game";
      }
    } else if (sortedGames.some((game) => game.date === referenceDate && isCancelledLike(game))) {
      kind = "off-day";
      displayLabel = "No Mets game today";
      offDay = true;
    }

    const state = {
      nowIso: now.toISOString(),
      referenceDate,
      kind,
      displayLabel,
      offDay,
      todayGames,
      todayGame,
      nextUpcomingGame,
      featuredGame,
      staleCompletedGames: sortedGames.filter((game) => {
        const dayDiff = diffCalendarDays(game.date, referenceDate);
        return dayDiff != null && dayDiff >= 1 && isFinalGame(game);
      }),
      allGames: sortedGames
    };
    state.logs = buildStateLogLines(state);
    return state;
  }

  return {
    EASTERN_TIME_ZONE,
    compareGamesForDisplay,
    diffCalendarDays,
    getEasternDateISO,
    isCancelledLike,
    isFinalGame,
    isLiveGame,
    isPlayableScheduledGame,
    normalizeGameDate,
    resolveFeaturedGameState,
    resolveGameTimestamp
  };
});
