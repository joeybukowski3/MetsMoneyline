const SITE_NAV_ITEMS = [
  {
    href: "/",
    label: "Game Day"
  },
  {
    href: "/report.html",
    label: "Today's Report"
  },
  {
    href: "/advanced-stats.html",
    label: "Stats & Standings"
  },
  {
    href: "/trends.html",
    label: "Trends"
  },
  {
    href: "/prospects.html",
    label: "Prospects"
  },
  {
    href: "/power-rankings.html",
    label: "Power Rankings"
  },
  {
    href: "/on-this-day.html",
    label: "On This Day"
  },
  {
    href: "/betting-history.html",
    label: "History"
  },
  {
    href: "/news.html",
    label: "Team News"
  },
  {
    href: "/depth-chart.html",
    label: "Mets Depth Chart"
  }
];

const PRIMARY_NAV_HREFS = [
  "/",
  "/report.html",
  "/advanced-stats.html",
  "/trends.html",
  "/betting-history.html"
];

function normalizePath(pathname) {
  if (!pathname || pathname === "/index.html") return "/";
  return pathname;
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
  document.addEventListener('DOMContentLoaded', buildSiteHeader);
} else {
  buildSiteHeader();
}
