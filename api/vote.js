// Proxy for depth chart voting — captures real client IP server-side
// so IP-based rate limiting can be enforced in Supabase.
const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function hashIp(ip) {
  // One-way hash — we never store raw IPs
  return crypto.createHash("sha256").update("mml-vote-v1:" + ip).digest("hex").slice(0, 32);
}

module.exports = async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Validate config
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(503).json({ error: "Voting service not configured" });
  }

  const { position, player_id, vote_value, voter_hash } = req.body || {};

  // Input validation
  if (!position || typeof position !== "string" || position.length > 10) {
    return res.status(400).json({ error: "Invalid position" });
  }
  if (!player_id || typeof player_id !== "string" || player_id.length > 120) {
    return res.status(400).json({ error: "Invalid player_id" });
  }
  if (vote_value !== 1 && vote_value !== -1) {
    return res.status(400).json({ error: "vote_value must be 1 or -1" });
  }
  if (!voter_hash || typeof voter_hash !== "string" || voter_hash.length > 128) {
    return res.status(400).json({ error: "Invalid voter_hash" });
  }

  const ip = getClientIp(req);
  const ipHash = hashIp(ip);

  try {
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/depth_chart_toggle_vote_v2`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Prefer": "return=representation"
      },
      body: JSON.stringify({
        p_position: String(position).toUpperCase(),
        p_player_id: player_id,
        p_vote_value: vote_value,
        p_voter_hash: voter_hash,
        p_ip_hash: ipHash
      })
    });

    const data = await rpcRes.json();

    if (!rpcRes.ok) {
      console.error("[vote] Supabase RPC error:", data);
      return res.status(502).json({ error: "Vote failed", detail: data?.message || "Unknown error" });
    }

    // Cache-control: no caching on voting endpoint
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(data);
  } catch (err) {
    console.error("[vote] Unexpected error:", err.message);
    return res.status(500).json({ error: "Voting temporarily unavailable" });
  }
};
