const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function normalizeEntry(raw) {
  const name = String(raw.name || "企鹅玩家").trim().slice(0, 12) || "企鹅玩家";
  const score = Math.max(0, Math.floor(Number(raw.score) || 0));
  const distance = Math.max(0, Math.floor(Number(raw.distance) || 0));
  return { name, score, distance };
}

function mapEntry(entry) {
  return {
    name: entry.name,
    score: entry.score,
    distance: entry.distance,
    at: entry.created_at
  };
}

async function supabaseRequest(pathname, options = {}) {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Missing Supabase environment variables");
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Supabase request failed: ${response.status} ${details}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function readLeaderboard() {
  const columns = "name,score,distance,created_at";
  const [score, distance] = await Promise.all([
    supabaseRequest(`leaderboard_entries?select=${columns}&order=score.desc&limit=5`),
    supabaseRequest(`leaderboard_entries?select=${columns}&order=distance.desc&limit=5`)
  ]);

  return {
    score: score.map(mapEntry),
    distance: distance.map(mapEntry)
  };
}

async function submitLeaderboard(rawEntry) {
  const entry = normalizeEntry(rawEntry);
  await supabaseRequest("leaderboard_entries", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(entry)
  });
  return readLeaderboard();
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    if (req.method === "GET") {
      res.status(200).json(await readLeaderboard());
      return;
    }

    if (req.method === "POST") {
      res.status(200).json(await submitLeaderboard(req.body || {}));
      return;
    }

    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "leaderboard unavailable" });
  }
};
