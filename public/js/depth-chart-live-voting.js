(function () {
  const DEPTH_CHART_URL = "data/depth-chart.json";
  const STORAGE_KEYS = {
    voterSeed: "dc_voter_seed_v1",
    userVotes: "dc_live_user_votes_v2",
    submittedWriteIns: "dc_submitted_writeins_v1"
  };
  const POS_LABELS = {
    C: "Catcher",
    "1B": "First Base",
    "2B": "Second Base",
    "3B": "Third Base",
    SS: "Shortstop",
    LF: "Left Field",
    CF: "Center Field",
    RF: "Right Field",
    DH: "Designated Hitter",
    SP: "Starting Pitcher",
    RP: "Relief Pitcher"
  };
  const OFFENSIVE_POSITIONS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"];
  const BATTING_COLS = ["G", "AB", "H", "HR", "AVG", "OPS"];
  const SP_COLS = ["IP", "W", "L", "ERA", "K"];
  const RP_COLS = ["IP", "SV", "W", "L", "K"];
  const LIVE_COPY = "Rankings start with MetsMoneyline's curated baseline scores. Fan voting is shared online and adjusts the rankings over time. To limit spam, each browser can vote once per player per day. Write-ins are reviewed before appearing publicly.";
  const FALLBACK_COPY = "Live voting is temporarily unavailable. You can still view the depth chart.";
  const LIVE_ALERT = "Shared fan voting is live - displayed scores include MetsMoneyline baseline points plus fan votes";
  const FALLBACK_ALERT = "Live voting is temporarily unavailable - rankings are showing MetsMoneyline baseline points only";

  let storageAvailable = true;
  let memoryStore = {};
  let basePlayers = [];
  let approvedWriteIns = [];
  let positions = [];
  let currentPos = "ALL";
  let currentMode = "position";
  let supabaseClient = null;
  let liveVotingEnabled = false;
  let liveVotingMessage = "";
  let voterHashPromise = null;
  let pendingWriteIn = false;
  let controlBindingsApplied = false;
  const voteTotalsByPlayerId = new Map();
  const currentUserVotes = new Map();
  const pendingVoteKeys = new Set();

  function safeStorageGet(key, fallback) {
    if (!storageAvailable) return key in memoryStore ? memoryStore[key] : fallback;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      storageAvailable = false;
      return key in memoryStore ? memoryStore[key] : fallback;
    }
  }

  function safeStorageSet(key, value) {
    if (!storageAvailable) {
      memoryStore[key] = value;
      return;
    }
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      storageAvailable = false;
      memoryStore[key] = value;
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sanitizeName(value) {
    return String(value || "")
      .replace(/[<>]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function slugify(value) {
    return sanitizeName(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function buildPlayerId(pos, name) {
    return String(pos || "").toUpperCase() + ":" + slugify(name);
  }

  function voteKey(pos, playerId, day) {
    return (day || todayKey()) + "|" + String(pos || "").toUpperCase() + "|" + sanitizeName(playerId);
  }

  function initials(name) {
    return sanitizeName(name).split(" ").slice(0, 2).map(function (part) {
      return part.charAt(0).toUpperCase();
    }).join("") || "NY";
  }

  function headshotUrl(player) {
    if (player && player.imageUrl) {
      // Convert Wikipedia Commons direct file URLs to Wikimedia thumbnail API (allows hotlinking)
      const url = player.imageUrl;
      if (url.includes('wikipedia.org/wikipedia/commons/') && !url.includes('/thumb/')) {
        // Already a direct commons URL — use as-is (the img onerror will fall back)
        return url;
      }
      return url;
    }
    if (!player || !player.mlbId) return fallbackHeadshot(player && player.name);
    return "https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_120,q_auto:best/v1/people/" + player.mlbId + "/headshot/67/current";
  }

  function imageFallbackUrl(player) {
    // When primary image fails: try mlbstatic first, then SVG initials
    if (player && player.mlbId) {
      return "https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_120,q_auto:best/v1/people/" + player.mlbId + "/headshot/67/current";
    }
    return fallbackHeadshot(player && player.name);
  }

  function fallbackHeadshot(name) {
    const label = encodeURIComponent(initials(name));
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><rect width='100%' height='100%' fill='%23e9f3ff'/><text x='50%' y='54%' font-family='Inter,Arial,sans-serif' font-size='42' font-weight='800' text-anchor='middle' fill='%23002d72'>" + label + "</text></svg>";
    return "data:image/svg+xml;charset=UTF-8," + svg;
  }

  function showStatus(message, type) {
    const el = document.getElementById("dc-status");
    if (!el) return;
    el.textContent = message || "";
    el.className = "dc-status" + (type ? " " + type : "");
  }

  function setDisclaimer(text) {
    const el = document.getElementById("dc-disclaimer");
    if (el) el.textContent = text;
  }

  function setAlert(text) {
    const el = document.getElementById("dc-alert-banner");
    if (el) el.textContent = text;
  }

  function setVoteInfo(text) {
    const el = document.getElementById("dc-vote-info");
    if (el) el.textContent = text;
  }

  function setWriteInNote(text) {
    const el = document.getElementById("dc-writein-note");
    if (el) el.textContent = text;
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function getStoredVoteLog() {
    const raw = safeStorageGet(STORAGE_KEYS.userVotes, {});
    return raw && typeof raw === "object" ? raw : {};
  }

  function saveStoredVoteLog(log) {
    safeStorageSet(STORAGE_KEYS.userVotes, log);
  }

  function hydrateVotesFromStorage() {
    currentUserVotes.clear();
    const log = getStoredVoteLog();
    const today = todayKey();
    Object.keys(log).forEach(function (key) {
      if (!key.startsWith(today + "|")) return;
      const value = Number(log[key]);
      if (value === 1 || value === -1) currentUserVotes.set(key, value);
    });
  }

  function persistCurrentVotes() {
    const log = getStoredVoteLog();
    const today = todayKey();
    Object.keys(log).forEach(function (key) {
      if (key.startsWith(today + "|")) delete log[key];
    });
    currentUserVotes.forEach(function (value, key) {
      log[key] = value;
    });
    saveStoredVoteLog(log);
  }

  function currentVoteValue(playerId, pos) {
    return Number(currentUserVotes.get(voteKey(pos, playerId))) || 0;
  }

  function setCurrentVote(playerId, pos, value) {
    const key = voteKey(pos, playerId);
    if (value === 1 || value === -1) currentUserVotes.set(key, value);
    else currentUserVotes.delete(key);
    persistCurrentVotes();
  }

  function getSubmittedWriteIns() {
    return safeStorageGet(STORAGE_KEYS.submittedWriteIns, []);
  }

  function saveSubmittedWriteIns(items) {
    safeStorageSet(STORAGE_KEYS.submittedWriteIns, items);
  }

  function ensureVoterSeed() {
    let seed = safeStorageGet(STORAGE_KEYS.voterSeed, "");
    if (typeof seed === "string" && seed) return seed;

    if (window.crypto && window.crypto.getRandomValues) {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      seed = Array.from(bytes).map(function (value) {
        return value.toString(16).padStart(2, "0");
      }).join("");
    } else {
      seed = "fallback-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }

    safeStorageSet(STORAGE_KEYS.voterSeed, seed);
    return seed;
  }

  async function getVoterHash() {
    if (voterHashPromise) return voterHashPromise;
    voterHashPromise = (async function () {
      const seed = ensureVoterSeed();
      if (window.crypto && window.crypto.subtle && window.TextEncoder) {
        const encoded = new window.TextEncoder().encode(seed);
        const digest = await window.crypto.subtle.digest("SHA-256", encoded);
        return Array.from(new Uint8Array(digest)).map(function (value) {
          return value.toString(16).padStart(2, "0");
        }).join("");
      }
      return "raw-" + seed;
    })();
    return voterHashPromise;
  }

  function normalizeSupabaseUrl(rawUrl) {
    const value = String(rawUrl || "").trim();
    if (!value) return "";
    return value.replace(/\/rest\/v1\/?$/i, "");
  }

  function getSupabaseConfig() {
    const config = window.METS_DEPTH_CHART_SUPABASE || {};
    const url = normalizeSupabaseUrl(config.url);
    const anonKey = typeof config.anonKey === "string" ? config.anonKey.trim() : "";
    if (!url || !anonKey) return null;
    return { url: url, anonKey: anonKey };
  }

  function updateLiveCopy() {
    if (liveVotingEnabled) {
      setAlert(LIVE_ALERT);
      setDisclaimer(LIVE_COPY);
      setVoteInfo("Displayed scores include MetsMoneyline baseline ranking points plus live fan votes. You can add, switch, or remove one vote per player each day.");
      setWriteInNote("Write-ins are submitted for review before appearing publicly. Duplicate names at the same position are blocked.");
      return;
    }

    setAlert(FALLBACK_ALERT);
    setDisclaimer(FALLBACK_COPY);
    setVoteInfo("Live voting is temporarily unavailable. Rankings are showing MetsMoneyline baseline ranking points only.");
    setWriteInNote("Write-ins cannot be submitted while live voting is unavailable.");
  }

  function normalizePlayer(rawPlayer, sourceOrder, posRank) {
    const pos = String(rawPlayer.pos || "").toUpperCase();
    const name = sanitizeName(rawPlayer.name);
    const playerId = sanitizeName(rawPlayer.playerId) || buildPlayerId(pos, name);
    const stats = rawPlayer.stats && typeof rawPlayer.stats === "object" ? rawPlayer.stats : {};

    return {
      id: sanitizeName(rawPlayer.id) || playerId,
      playerId: playerId,
      name: name,
      pos: pos,
      sourceOrder: Number.isFinite(Number(rawPlayer.sourceOrder)) ? Number(rawPlayer.sourceOrder) : sourceOrder,
      posRank: Number.isFinite(Number(rawPlayer.posRank)) ? Number(rawPlayer.posRank) : posRank,
      mlbId: Number.isFinite(Number(rawPlayer.mlbId)) ? Number(rawPlayer.mlbId) : null,
      imageUrl: sanitizeName(rawPlayer.imageUrl),
      seedLabel: sanitizeName(rawPlayer.seedLabel) || "Seeded ranking points",
      seedUpvotes: Number.isFinite(Number(rawPlayer.seedUpvotes)) ? Number(rawPlayer.seedUpvotes) : 0,
      seedDownvotes: Number.isFinite(Number(rawPlayer.seedDownvotes)) ? Number(rawPlayer.seedDownvotes) : 0,
      seedNetVotes: Number.isFinite(Number(rawPlayer.seedNetVotes)) ? Number(rawPlayer.seedNetVotes) : 0,
      stats: stats,
      liveUpvotes: 0,
      liveDownvotes: 0,
      liveNetVotes: 0,
      upvotes: 0,
      downvotes: 0,
      netVotes: 0
    };
  }

  function getAllPlayers() {
    return basePlayers.concat(approvedWriteIns);
  }

  function comparePlayers(a, b) {
    if (b.netVotes !== a.netVotes) return b.netVotes - a.netVotes;
    const aPosRank = Number.isFinite(Number(a.posRank)) ? Number(a.posRank) : Number.MAX_SAFE_INTEGER;
    const bPosRank = Number.isFinite(Number(b.posRank)) ? Number(b.posRank) : Number.MAX_SAFE_INTEGER;
    if (a.pos === b.pos && aPosRank !== bPosRank) return aPosRank - bPosRank;
    const aSourceOrder = Number.isFinite(Number(a.sourceOrder)) ? Number(a.sourceOrder) : Number.MAX_SAFE_INTEGER;
    const bSourceOrder = Number.isFinite(Number(b.sourceOrder)) ? Number(b.sourceOrder) : Number.MAX_SAFE_INTEGER;
    if (aSourceOrder !== bSourceOrder) return aSourceOrder - bSourceOrder;
    return a.name.localeCompare(b.name);
  }

  function compareLineupPlayers(a, b) {
    if (b.upvotes !== a.upvotes) return b.upvotes - a.upvotes;
    if (b.netVotes !== a.netVotes) return b.netVotes - a.netVotes;
    const aSourceOrder = Number.isFinite(Number(a.sourceOrder)) ? Number(a.sourceOrder) : Number.MAX_SAFE_INTEGER;
    const bSourceOrder = Number.isFinite(Number(b.sourceOrder)) ? Number(b.sourceOrder) : Number.MAX_SAFE_INTEGER;
    if (aSourceOrder !== bSourceOrder) return aSourceOrder - bSourceOrder;
    return a.name.localeCompare(b.name);
  }

  function applyVoteTotals(player) {
    const totals = voteTotalsByPlayerId.get(player.playerId);
    const liveUpvotes = totals ? Number(totals.upvotes) || 0 : 0;
    const liveDownvotes = totals ? Number(totals.downvotes) || 0 : 0;
    const liveNetVotes = totals ? Number(totals.netVotes) || 0 : 0;
    const seedUpvotes = Number(player.seedUpvotes) || 0;
    const seedDownvotes = Number(player.seedDownvotes) || 0;
    const seedNetVotes = Number(player.seedNetVotes) || 0;

    return Object.assign({}, player, {
      liveUpvotes: liveUpvotes,
      liveDownvotes: liveDownvotes,
      liveNetVotes: liveNetVotes,
      upvotes: seedUpvotes + liveUpvotes,
      downvotes: seedDownvotes + liveDownvotes,
      netVotes: seedNetVotes + liveNetVotes
    });
  }

  function getDisplayedPlayers() {
    return getAllPlayers().map(applyVoteTotals);
  }

  function getPlayersAtPos(pos) {
    return getDisplayedPlayers()
      .filter(function (player) { return player.pos === pos; })
      .sort(comparePlayers);
  }

  function getTop10() {
    return getDisplayedPlayers().sort(comparePlayers).slice(0, 10);
  }

  function statColumnsForPos(pos) {
    if (pos === "SP") return SP_COLS;
    if (pos === "RP") return RP_COLS;
    return BATTING_COLS;
  }

  function statDisplay(value) {
    if (value == null || value === "" || String(value).toLowerCase() === "nan") return "&mdash;";
    return escapeHtml(value);
  }

  function isVotePending(playerId, pos) {
    return pendingVoteKeys.has(voteKey(pos, playerId));
  }

  function canVote(playerId, pos) {
    return liveVotingEnabled && !isVotePending(playerId, pos);
  }

  function renderDiamond() {
    const diamond = document.getElementById("diamond");
    diamond.querySelectorAll(".pos-spot").forEach(function (node) { node.remove(); });

    positions.forEach(function (pos) {
      const players = getPlayersAtPos(pos);
      const top = players[0];
      if (!top) return;

      const spot = document.createElement("button");
      spot.type = "button";
      spot.className = "pos-spot" + (currentPos === pos && currentMode === "position" ? " active" : "");
      spot.dataset.pos = pos;
      spot.setAttribute("aria-label", "Show " + POS_LABELS[pos] + " rankings");
      spot.addEventListener("click", function () {
        currentPos = pos;
        currentMode = "position";
        render();
      });

      const img = document.createElement("img");
      img.className = "pos-photo";
      img.src = headshotUrl(top);
      img.alt = top.name + " headshot";
      img.loading = "lazy";
      img.addEventListener("error", function () {
        img.onerror = function () {
          var backup = imageFallbackUrl(top);
          if (backup !== img.src) {
            img.onerror = function() { img.onerror = null; img.src = fallbackHeadshot(top.name); };
            img.src = backup;
          } else {
            img.onerror = null;
            img.src = fallbackHeadshot(top.name);
          }
        };
        img.src = imageFallbackUrl(top);
      });

      const label = document.createElement("span");
      label.className = "pos-label";
      label.textContent = pos;

      const name = document.createElement("span");
      name.className = "pos-name";
      name.textContent = top.name;

      spot.appendChild(label);
      spot.appendChild(img);
      spot.appendChild(name);
      diamond.appendChild(spot);
    });
  }

  function renderLineupPanel() {
    const list = document.getElementById("fan-lineup-list");
    const spPanel = document.getElementById("fan-lineup-sp");
    if (!list || !spPanel) return;

    const allPlayers = getDisplayedPlayers();
    const uniqueOffense = [];
    const seenNames = new Set();

    allPlayers
      .filter(function (player) { return OFFENSIVE_POSITIONS.includes(player.pos); })
      .sort(compareLineupPlayers)
      .forEach(function (player) {
        const nameKey = sanitizeName(player.name).toLowerCase();
        if (seenNames.has(nameKey)) return;
        seenNames.add(nameKey);
        uniqueOffense.push(player);
      });

    const lineup = uniqueOffense.slice(0, 9);
    if (!lineup.length) {
      list.innerHTML = "<li class=\"dc-lineup-item\"><span class=\"dc-lineup-slot\">1</span><div><div class=\"dc-lineup-name\">No lineup data available.</div></div></li>";
    } else {
      list.innerHTML = lineup.map(function (player, index) {
        return "<li class=\"dc-lineup-item\">" +
          "<span class=\"dc-lineup-slot\">" + (index + 1) + "</span>" +
          "<div><div class=\"dc-lineup-name\">" + escapeHtml(player.name) + "</div><div class=\"dc-lineup-meta\">" + escapeHtml(POS_LABELS[player.pos] || player.pos) + " — " + player.upvotes + " upvotes</div></div>" +
          "</li>";
      }).join("");
    }

    const topSp = allPlayers
      .filter(function (player) { return player.pos === "SP"; })
      .sort(compareLineupPlayers)[0];

    if (!topSp) {
      spPanel.innerHTML = "<div class=\"dc-lineup-sp-label\">Starting Pitcher</div><div class=\"dc-lineup-name\">No starting pitcher available.</div>";
      return;
    }

    spPanel.innerHTML = "<div class=\"dc-lineup-sp-label\">Starting Pitcher</div>" +
      "<div class=\"dc-lineup-name\">SP: " + escapeHtml(topSp.name) + "</div>" +
      "<div class=\"dc-lineup-meta\">" + topSp.upvotes + " upvotes</div>";
  }

  function renderPlayerCell(player) {
    const imgSrc = headshotUrl(player);
    const backupSrc = imageFallbackUrl(player);
    return [
      "<div class=\"player-cell\">",
      "<img src=\"" + imgSrc + "\" alt=\"" + escapeHtml(player.name) + " headshot\" loading=\"lazy\" onerror=\"this.onerror=null;this.src='" + backupSrc + "';this.onerror=function(){this.onerror=null;this.src='" + fallbackHeadshot(player.name) + "';};\">",
      "<div><div class=\"p-name\">" + escapeHtml(player.name) + "</div><div class=\"p-pos\">" + escapeHtml(POS_LABELS[player.pos] || player.pos) + "</div></div>",
      "</div>"
    ].join("");
  }

  function renderTable() {
    const thead = document.getElementById("dc-thead");
    const tbody = document.getElementById("dc-tbody");
    const label = document.getElementById("showing-label");

    let players;
    let statCols;
    if (currentMode === "top10") {
      players = getTop10();
      statCols = BATTING_COLS;
      label.textContent = "Showing: Overall Top 10";
    } else if (currentPos === "ALL") {
      players = getDisplayedPlayers().sort(comparePlayers);
      statCols = BATTING_COLS;
      label.textContent = "Showing: All Positions";
    } else {
      players = getPlayersAtPos(currentPos);
      statCols = statColumnsForPos(currentPos);
      label.textContent = "Showing: " + POS_LABELS[currentPos] + " (" + currentPos + ")";
    }

    thead.innerHTML = "<tr><th style=\"width:40px\">#</th><th>Player</th><th style=\"width:100px\">Vote</th><th style=\"width:70px\" title=\"Includes MetsMoneyline baseline ranking points plus live fan votes\">Score</th><th style=\"width:70px\" title=\"Includes MetsMoneyline baseline ranking points plus live fan votes\">Up</th><th style=\"width:70px\" title=\"Includes MetsMoneyline baseline ranking points plus live fan votes\">Down</th>" +
      statCols.map(function (col) { return "<th>" + escapeHtml(col) + "</th>"; }).join("") + "</tr>";

    tbody.innerHTML = players.map(function (player, index) {
      const rank = index + 1;
      const rankClass = rank === 1 ? "rank-1" : rank === 2 ? "rank-2" : rank === 3 ? "rank-3" : "rank-other";
      const scoreClass = player.netVotes > 0 ? "positive" : player.netVotes < 0 ? "negative" : "";
      const activeVote = currentVoteValue(player.playerId, player.pos);
      const canClick = canVote(player.playerId, player.pos);
      const stats = statCols.map(function (col) {
        return "<td>" + statDisplay(player.stats && player.stats[col]) + "</td>";
      }).join("");

      return "<tr class=\"" + (rank === 1 && currentMode !== "top10" ? "is-top1" : "") + "\">" +
        "<td><span class=\"rank-badge " + rankClass + "\">" + rank + "</span></td>" +
        "<td>" + renderPlayerCell(player) + "</td>" +
        "<td><div class=\"vote-cell\">" +
        "<button class=\"vote-btn up" + (activeVote === 1 ? " voted" : "") + "\" type=\"button\" aria-label=\"Upvote " + escapeHtml(player.name) + "\" onclick=\"window.recordDepthChartVote('" + escapeHtml(player.playerId) + "','" + escapeHtml(player.pos) + "',1)\"" + (canClick ? "" : " disabled") + ">&#9650;</button>" +
        "<button class=\"vote-btn down" + (activeVote === -1 ? " voted" : "") + "\" type=\"button\" aria-label=\"Downvote " + escapeHtml(player.name) + "\" onclick=\"window.recordDepthChartVote('" + escapeHtml(player.playerId) + "','" + escapeHtml(player.pos) + "',-1)\"" + (canClick ? "" : " disabled") + ">&#9660;</button>" +
        "</div></td>" +
        "<td><span class=\"vote-score " + scoreClass + "\">" + player.netVotes + "</span></td>" +
        "<td>" + player.upvotes + "</td>" +
        "<td>" + player.downvotes + "</td>" +
        stats +
        "</tr>";
    }).join("");

    document.getElementById("pos-filter").value = currentMode === "top10" ? "ALL" : currentPos;
    document.getElementById("btn-position").classList.toggle("active", currentMode === "position");
    document.getElementById("btn-top10").classList.toggle("active", currentMode === "top10");
    document.getElementById("writein-section").style.display = currentMode === "top10" || currentPos === "ALL" ? "none" : "block";
    document.getElementById("writein-pos").value = currentPos === "ALL" ? positions[0] : currentPos;
    document.getElementById("writein-submit").disabled = !liveVotingEnabled || pendingWriteIn;
  }

  function render() {
    renderDiamond();
    renderLineupPanel();
    renderTable();
  }

  async function initializeSupabase() {
    const config = getSupabaseConfig();
    if (!config || !window.supabase || typeof window.supabase.createClient !== "function") {
      liveVotingEnabled = false;
      liveVotingMessage = FALLBACK_COPY;
      return false;
    }

    try {
      supabaseClient = window.supabase.createClient(config.url, config.anonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      });
      liveVotingEnabled = true;
      liveVotingMessage = "";
      return true;
    } catch (error) {
      liveVotingEnabled = false;
      liveVotingMessage = FALLBACK_COPY;
      return false;
    }
  }

  async function loadVoteTotals() {
    voteTotalsByPlayerId.clear();
    if (!liveVotingEnabled || !supabaseClient) return;

    const result = await supabaseClient
      .from("depth_chart_vote_totals")
      .select("position, player_id, upvotes, downvotes, net_votes");

    if (result.error) throw result.error;

    (result.data || []).forEach(function (row) {
      const playerId = sanitizeName(row.player_id);
      if (!playerId) return;
      voteTotalsByPlayerId.set(playerId, {
        position: sanitizeName(row.position).toUpperCase(),
        upvotes: Number(row.upvotes) || 0,
        downvotes: Number(row.downvotes) || 0,
        netVotes: Number(row.net_votes) || 0
      });
    });
  }

  async function loadCurrentUserVotes() {
    currentUserVotes.clear();
    if (!liveVotingEnabled || !supabaseClient) {
      persistCurrentVotes();
      return;
    }

    const voterHash = await getVoterHash();
    const result = await supabaseClient.rpc("depth_chart_get_voter_votes", {
      p_voter_hash: voterHash,
      p_vote_day: todayKey()
    });

    if (result.error) throw result.error;

    (result.data || []).forEach(function (row) {
      const pos = String(row.vote_position || row.player_position || row.position || "").toUpperCase();
      const playerId = sanitizeName(row.player_id);
      const voteValue = Number(row.vote_value);
      if (!playerId || (voteValue !== 1 && voteValue !== -1)) return;
      currentUserVotes.set(voteKey(pos, playerId), voteValue);
    });
    persistCurrentVotes();
  }

  async function loadApprovedWriteIns() {
    approvedWriteIns = [];
    if (!liveVotingEnabled || !supabaseClient) return;

    const result = await supabaseClient
      .from("depth_chart_write_ins")
      .select("position, player_name, player_id, created_at")
      .eq("approved", true)
      .order("created_at", { ascending: true });

    if (result.error) throw result.error;

    const baseCountByPos = {};
    basePlayers.forEach(function (player) {
      baseCountByPos[player.pos] = (baseCountByPos[player.pos] || 0) + 1;
    });
    const approvedCountByPos = {};

    approvedWriteIns = (result.data || []).map(function (row, index) {
      const pos = String(row.position || "").toUpperCase();
      const nextRank = (baseCountByPos[pos] || 0) + ((approvedCountByPos[pos] || 0) + 1);
      approvedCountByPos[pos] = (approvedCountByPos[pos] || 0) + 1;
      return normalizePlayer({
        id: "approved-" + sanitizeName(row.player_id),
        playerId: sanitizeName(row.player_id),
        name: sanitizeName(row.player_name),
        pos: pos,
        stats: {}
      }, 100000 + index + 1, nextRank);
    });
  }

  function bindControls() {
    if (controlBindingsApplied) return;
    controlBindingsApplied = true;

    document.getElementById("btn-position").addEventListener("click", function () {
      currentMode = "position";
      render();
    });
    document.getElementById("btn-top10").addEventListener("click", function () {
      currentMode = "top10";
      currentPos = "ALL";
      render();
    });
    document.getElementById("pos-filter").addEventListener("change", function (event) {
      currentPos = event.target.value;
      currentMode = "position";
      render();
    });
    document.getElementById("writein-submit").addEventListener("click", submitWriteIn);
  }

  function populatePositionSelectors() {
    const filter = document.getElementById("pos-filter");
    const writeInPos = document.getElementById("writein-pos");
    filter.innerHTML = "<option value=\"ALL\">All Positions</option>";
    writeInPos.innerHTML = "";

    positions.forEach(function (pos) {
      const filterOption = document.createElement("option");
      filterOption.value = pos;
      filterOption.textContent = POS_LABELS[pos] + " (" + pos + ")";
      filter.appendChild(filterOption);

      const writeInOption = document.createElement("option");
      writeInOption.value = pos;
      writeInOption.textContent = pos;
      writeInPos.appendChild(writeInOption);
    });
  }

  function findPlayerByIdAndPos(playerId, pos) {
    return getAllPlayers().find(function (player) {
      return player.playerId === playerId && player.pos === pos;
    });
  }

  function isDuplicateWriteInError(error) {
    const message = String(error && (error.message || error.details || error.hint || error.code) || "").toLowerCase();
    return String(error && error.code || "") === "23505" || message.includes("duplicate") || message.includes("unique");
  }

  function isMissingToggleSetup(error) {
    const text = String(error && (error.message || error.details || error.hint || error.code) || "").toLowerCase();
    return text.includes("depth_chart_toggle_vote") || text.includes("depth_chart_get_voter_votes") || text.includes("pgrst") || text.includes("not configured");
  }

  async function recordVote(playerId, pos, direction) {
    if (!liveVotingEnabled || !supabaseClient) {
      showStatus(FALLBACK_COPY, "error");
      render();
      return;
    }
    if (!positions.includes(pos)) {
      showStatus("That position is not available for voting.", "error");
      return;
    }
    if (![1, -1].includes(direction)) {
      showStatus("Invalid vote value.", "error");
      return;
    }
    const player = findPlayerByIdAndPos(playerId, pos);
    if (!player) {
      showStatus("That player is not available for voting.", "error");
      return;
    }

    const key = voteKey(pos, playerId);
    if (pendingVoteKeys.has(key)) return;
    pendingVoteKeys.add(key);
    render();

    try {
      const voterHash = await getVoterHash();
      const currentValue = currentVoteValue(playerId, pos);

      // Use server-side proxy so the real IP can be captured for rate limiting
      const proxyRes = await fetch("/api/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          position: pos,
          player_id: playerId,
          vote_value: direction,
          voter_hash: voterHash
        })
      });

      const resultData = await proxyRes.json();
      if (!proxyRes.ok) throw new Error(resultData.error || "Vote failed");

      const action = sanitizeName(resultData && resultData.action).toLowerCase();
      if (action === "rate_limited") {
        showStatus("You\'ve already voted on this player today.", "error");
      } else if (action === "removed") {
        setCurrentVote(playerId, pos, 0);
        showStatus("Vote removed.", "success");
      } else if (action === "changed" || (currentValue !== 0 && currentValue !== direction)) {
        setCurrentVote(playerId, pos, direction);
        showStatus("Vote changed.", "success");
      } else {
        setCurrentVote(playerId, pos, direction);
        showStatus("Vote added.", "success");
      }

      await Promise.all([loadVoteTotals(), loadCurrentUserVotes()]);
    } catch (error) {
      if (isMissingToggleSetup(error)) {
        showStatus("Live voting needs the latest Supabase setup before votes can be changed here.", "error");
      } else {
        showStatus("Live voting is temporarily unavailable. Please try again later.", "error");
      }
    } finally {
      pendingVoteKeys.delete(key);
      render();
    }
  }

  async function submitWriteIn() {
    if (!liveVotingEnabled || !supabaseClient) {
      showStatus(FALLBACK_COPY, "error");
      return;
    }

    const nameInput = document.getElementById("writein-name");
    const posInput = document.getElementById("writein-pos");
    const name = sanitizeName(nameInput.value);
    const pos = String(posInput.value || "").toUpperCase();

    if (!name) {
      showStatus("Enter a player name.", "error");
      return;
    }
    if (!positions.includes(pos)) {
      showStatus("Select a valid position.", "error");
      return;
    }

    const normalizedName = name.toLowerCase();
    const duplicatePlayer = getAllPlayers().find(function (player) {
      return player.pos === pos && sanitizeName(player.name).toLowerCase() === normalizedName;
    });
    if (duplicatePlayer) {
      showStatus("This player is already listed at " + pos + ".", "error");
      return;
    }

    const submittedKey = pos + ":" + slugify(name);
    if (getSubmittedWriteIns().includes(submittedKey)) {
      showStatus("This write-in has already been submitted.", "error");
      return;
    }

    pendingWriteIn = true;
    render();

    try {
      const voterHash = await getVoterHash();
      const playerId = buildPlayerId(pos, name);
      const result = await supabaseClient
        .from("depth_chart_write_ins")
        .insert({
          position: pos,
          player_name: name,
          player_id: playerId,
          submitted_by_hash: voterHash,
          approved: false
        });

      if (result.error) throw result.error;

      const submitted = getSubmittedWriteIns();
      submitted.push(submittedKey);
      saveSubmittedWriteIns(submitted);
      nameInput.value = "";
      showStatus("Write-in submitted for review.", "success");
    } catch (error) {
      if (isDuplicateWriteInError(error)) {
        showStatus("This write-in has already been submitted.", "error");
      } else {
        showStatus("Write-in submission is temporarily unavailable.", "error");
      }
    } finally {
      pendingWriteIn = false;
      render();
    }
  }

  function applyFallbackState(message) {
    liveVotingEnabled = false;
    liveVotingMessage = message || FALLBACK_COPY;
    updateLiveCopy();
    showStatus(liveVotingMessage, "error");
  }

  async function initDepthChart() {
    try {
      hydrateVotesFromStorage();

      const response = await fetch(DEPTH_CHART_URL);
      if (!response.ok) throw new Error("Depth chart data request failed.");
      const data = await response.json();

      positions = Array.isArray(data.positions) ? data.positions : [];
      const posCounts = {};
      basePlayers = Array.isArray(data.players) ? data.players.map(function (player, index) {
        const pos = String(player.pos || "").toUpperCase();
        posCounts[pos] = (posCounts[pos] || 0) + 1;
        return normalizePlayer(player, index + 1, posCounts[pos]);
      }) : [];

      if (!positions.length || !basePlayers.length) {
        throw new Error("Depth chart data is empty.");
      }

      if (data.generatedAt) {
        document.getElementById("dc-updated").textContent = "Updated: " + new Date(data.generatedAt).toLocaleString();
      }

      populatePositionSelectors();
      bindControls();

      const liveReady = await initializeSupabase();
      if (liveReady) {
        try {
          await Promise.all([loadVoteTotals(), loadApprovedWriteIns(), loadCurrentUserVotes()]);
        } catch (error) {
          applyFallbackState(isMissingToggleSetup(error)
            ? "Live voting needs the latest Supabase setup. Rankings are showing baseline points only."
            : FALLBACK_COPY);
        }
      } else {
        updateLiveCopy();
      }

      render();

      if (!storageAvailable) {
        showStatus("localStorage is unavailable here. Vote highlighting will only persist for this session.", "error");
      }
    } catch (error) {
      setDisclaimer("Depth chart data is temporarily unavailable.");
      document.getElementById("dc-tbody").innerHTML = "<tr><td colspan=\"12\" style=\"padding:2rem;text-align:center;color:#b91c1c;\">Depth chart failed to load.</td></tr>";
      showStatus(error.message, "error");
    }
  }

  window.recordDepthChartVote = function (playerId, pos, direction) {
    recordVote(playerId, pos, direction);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDepthChart);
  } else {
    initDepthChart();
  }
})();
