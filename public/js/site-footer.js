(function () {
  function buildFooter() {
    var footer = document.querySelector("footer");
    if (!footer) return;

    footer.innerHTML = `
      <div class="footer-brand">
        <span class="brand-mets">METS</span><span class="brand-mono">MONEYLINE</span>
      </div>
      <nav class="footer-links" aria-label="Footer navigation">
        <div class="footer-link-group">
          <span class="footer-link-heading">Content</span>
          <a href="/report">Today's Report</a>
          <a href="/trends">Trend Lines</a>
          <a href="/game-log">Analytics</a>
          <a href="/rankings">Power Rankings</a>
          <a href="/social">Social Score</a>
          <a href="/on-this-day">On This Day</a>
        </div>
        <div class="footer-link-group">
          <span class="footer-link-heading">Site</span>
          <a href="/about">About</a>
          <a href="/support">Support</a>
          <a href="/privacy-policy">Privacy Policy</a>
          <a href="/terms">Terms</a>
          <a href="/editorial-policy">Editorial Policy</a>
          <a href="/disclaimer">Disclaimer</a>
        </div>
      </nav>
      <p class="footer-disclaimer">MetsMoneyline provides sports analysis for informational and entertainment purposes only. It is not financial advice, gambling advice, or a guarantee of results. Please follow all local laws and gamble responsibly.</p>
      <p class="footer-copy">&copy; 2026 MetsMoneyline. Not affiliated with the New York Mets or MLB.</p>
    `;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildFooter);
  } else {
    buildFooter();
  }
})();
