const SITE_NAV_ITEMS = [
  { href: "/", label: "Game Day", icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>` },
  { href: "/report", label: "Today's Report", icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>` },
  { href: "/trends", label: "Trends", icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>` },
  { href: "/advanced-stats", label: "Stats & Standings", icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>` },
  { href: "/rankings", label: "Power Rankings", icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>` },
  { href: "/prospects", label: "Prospects", icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>` },
  { href: "/depth-chart", label: "All Time Depth Chart", icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>` },
  { href: "/pick-history", label: "Moneyline Tracker", icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>` },
  { href: "/news", label: "News", icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/></svg>` },
  { href: "/on-this-day", label: "This Day", icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>` },
  { href: "/social", label: "Mets Social Score", icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>` },
  { href: "/betting", label: "Betting Lines", icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>` },
  { href: "/gear", label: "Moneyline Jersey", icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>` },
  { href: "/support", label: "Support", icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6.7-4.35-9.33-8.23C.65 9.8 1.3 5.54 4.8 3.68c2.17-1.15 4.72-.55 6.2 1.22 1.48-1.77 4.03-2.37 6.2-1.22 3.5 1.86 4.15 6.12 2.13 9.09C18.7 16.65 12 21 12 21z"/></svg>` },
];

const PRIMARY_NAV_HREFS = [
  "/",
  "/report",
  "/trends",
  "/advanced-stats",
  "/rankings",
  "/depth-chart",
  "/pick-history"
];

function normalizePath(pathname) {
  if (!pathname || pathname === "/index.html") return "/";
  return pathname;
}

function getEasternDateISO(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

function normalizeEndpointGameDate(endpointGame) {
  const direct = endpointGame?.startTime || endpointGame?.gameDateTime || endpointGame?.raw?.gameDate || null;
  if (!direct) return null;
  const parsed = new Date(direct);
  if (Number.isNaN(parsed.getTime())) return null;
  return getEasternDateISO(parsed);
}

function isUpcomingEndpointGame(endpointGame, todayEt) {
  const gameDate = normalizeEndpointGameDate(endpointGame);
  if (!gameDate) return false;
  const status = String(endpointGame?.status || endpointGame?.statusText || endpointGame?.raw?.status?.detailedState || "").toLowerCase();
  if (/final|completed|game over|postponed|suspended|cancelled|canceled|ppd/.test(status)) return false;
  return gameDate >= todayEt;
}

function chooseReportNavCandidate(liveGame, nextGame, todayEt) {
  const liveOkay = liveGame?.gameId && isUpcomingEndpointGame(liveGame, todayEt);
  const nextOkay = nextGame?.gameId && isUpcomingEndpointGame(nextGame, todayEt);
  if (liveOkay && !nextOkay) return liveGame;
  if (!liveOkay && nextOkay) return nextGame;
  if (!liveOkay && !nextOkay) return null;

  const liveDate = normalizeEndpointGameDate(liveGame);
  const nextDate = normalizeEndpointGameDate(nextGame);
  const sameMatchup =
    liveDate === nextDate &&
    String(liveGame?.opponent || "") === String(nextGame?.opponent || "") &&
    Boolean(liveGame?.isMetsHome) === Boolean(nextGame?.isMetsHome);

  if (sameMatchup) return liveGame;
  if (liveDate === todayEt && nextDate !== todayEt) return liveGame;
  if (nextDate === todayEt && liveDate !== todayEt) return nextGame;
  return String(liveGame?.startTime || "") <= String(nextGame?.startTime || "") ? liveGame : nextGame;
}

async function updateReportNavLabel() {
  try {
    const todayEt = getEasternDateISO();
    const [liveGame, nextGame] = await Promise.all([
      fetch("/api/mlb/mets/live-game").then((res) => res.ok ? res.json() : null).catch(() => null),
      fetch("/api/mlb/mets/next-game").then((res) => res.ok ? res.json() : null).catch(() => null)
    ]);
    const selected = chooseReportNavCandidate(liveGame, nextGame, todayEt);
    const selectedDate = normalizeEndpointGameDate(selected);
    const label = selectedDate && selectedDate > todayEt ? "Next Game Preview" : "Today's Report";
    document.querySelectorAll('a[href="/report"]').forEach((link) => {
      link.textContent = label;
      link.setAttribute("aria-label", label);
    });
  } catch (error) {
    console.warn("[nav] Unable to update report nav label.", error);
  }
}

function buildSiteHeader() {
  const header = document.querySelector("header");
  if (!header) return;

  const currentPath = normalizePath(window.location.pathname);
  const primaryItems = SITE_NAV_ITEMS.filter((item) => PRIMARY_NAV_HREFS.includes(item.href));
  const overflowItems = SITE_NAV_ITEMS.filter((item) => !PRIMARY_NAV_HREFS.includes(item.href));
  const currentIsOverflow = overflowItems.some((item) => normalizePath(item.href) === currentPath);
  const desktopLinksHtml = primaryItems.map((item) => {
    const active = normalizePath(item.href) === currentPath ? " active" : "";
    return `<li><a href="${item.href}" class="nav-link${active}">${item.label}</a></li>`;
  }).join("");
  const overflowLinksHtml = overflowItems.map((item) => {
    const active = normalizePath(item.href) === currentPath ? " active" : "";
    return `<a href="${item.href}" class="nav-dropdown-link${active}">${item.label}</a>`;
  }).join("");
  const mobileLinksHtml = SITE_NAV_ITEMS.map((item) => {
    const active = normalizePath(item.href) === currentPath ? " active" : "";
    return `<a href="${item.href}" class="nav-mobile-link${active}">${item.label}</a>`;
  }).join("");

  header.innerHTML = `
    <nav class="site-nav">
      <a href="/" class="nav-brand">
        <span class="brand-mets">METS</span><span class="brand-mono">MONEYLINE</span>
      </a>
      <div class="nav-actions">
        <ul class="nav-links">
          ${desktopLinksHtml}
          <li class="nav-more">
            <button class="nav-link nav-more-trigger${currentIsOverflow ? " active" : ""}" type="button" aria-haspopup="true" aria-expanded="false">
              More
            </button>
            <div class="nav-more-menu">
              ${overflowLinksHtml}
            </div>
          </li>
        </ul>
        <button class="nav-hamburger" type="button" aria-label="Toggle menu" aria-expanded="false">
          <span></span><span></span><span></span>
        </button>
      </div>
    </nav>
    <div class="nav-mobile-panel">
      ${mobileLinksHtml}
    </div>
  `;

  const hamburger = header.querySelector(".nav-hamburger");
  const mobilePanel = header.querySelector(".nav-mobile-panel");
  const moreTrigger = header.querySelector(".nav-more-trigger");
  const moreItem = header.querySelector(".nav-more");

  if (hamburger && mobilePanel) {
    hamburger.addEventListener("click", () => {
      const open = mobilePanel.classList.toggle("open");
      hamburger.classList.toggle("open", open);
      hamburger.setAttribute("aria-expanded", String(open));
    });
    mobilePanel.querySelectorAll(".nav-mobile-link").forEach((link) => {
      link.addEventListener("click", () => {
        mobilePanel.classList.remove("open");
        hamburger.classList.remove("open");
        hamburger.setAttribute("aria-expanded", "false");
      });
    });
  }

  if (moreTrigger && moreItem) {
    moreTrigger.addEventListener("click", () => {
      const open = moreItem.classList.toggle("open");
      moreTrigger.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", (event) => {
      if (!moreItem.contains(event.target)) {
        moreItem.classList.remove("open");
        moreTrigger.setAttribute("aria-expanded", "false");
      }
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    buildSiteHeader();
    updateReportNavLabel();
  });
} else {
  buildSiteHeader();
  updateReportNavLabel();
}

