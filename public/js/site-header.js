const SITE_NAV_ITEMS = [
  {
    href: "/",
    label: "Game Day",
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`
  },
  {
    href: "/report.html",
    label: "Today's Report",
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v5h5"/><path d="M8 13h8"/><path d="M8 17h6"/><path d="M8 9h3"/></svg>`
  },
  {
    href: "/advanced-stats.html",
    label: "Stats & Standings",
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`
  },
  {
    href: "/betting-history.html",
    label: "History",
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
  },
  {
    href: "/news.html",
    label: "Team News",
    icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M2 15h10"/><path d="M9 18l3-3-3-3"/></svg>`
  }
];

function normalizePath(pathname) {
  if (!pathname || pathname === "/index.html") return "/";
  return pathname;
}

function buildSiteHeader() {
  const header = document.querySelector("header");
  if (!header) return;

  const currentPath = normalizePath(window.location.pathname);
  const navLinksHtml = SITE_NAV_ITEMS.map((item) => {
    const active = normalizePath(item.href) === currentPath ? " active" : "";
    return `<li><a href="${item.href}" class="nav-link${active}">${item.icon}${item.label}</a></li>`;
  }).join("");

  header.innerHTML = `
    <nav>
      <a href="/" class="nav-brand">
        <span class="brand-mets">METS</span><span class="brand-mono">MONEYLINE</span>
      </a>
      <button class="nav-hamburger" aria-label="Toggle menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
      <ul class="nav-links">${navLinksHtml}</ul>
    </nav>
  `;

  const hamburger = header.querySelector('.nav-hamburger');
  const navLinks = header.querySelector('.nav-links');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      const open = navLinks.classList.toggle('open');
      hamburger.classList.toggle('open', open);
      hamburger.setAttribute('aria-expanded', String(open));
    });
    navLinks.querySelectorAll('.nav-link').forEach((link) => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
        hamburger.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
      });
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', buildSiteHeader);
} else {
  buildSiteHeader();
}
