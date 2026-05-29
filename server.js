const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const dataFile = path.join(root, "leaderboard.json");
const port = Number(process.env.PORT || 4173);
const publicFiles = new Set(["/", "/index.html"]);
const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const hasSupabase = Boolean(supabaseUrl && supabaseServiceRoleKey);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8"
};

function defaultBoard() {
  return { score: [], distance: [] };
}

function readBoard() {
  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    return {
      score: Array.isArray(parsed.score) ? parsed.score.slice(0, 5) : [],
      distance: Array.isArray(parsed.distance) ? parsed.distance.slice(0, 5) : []
    };
  } catch {
    return defaultBoard();
  }
}

function writeBoard(board) {
  fs.writeFileSync(dataFile, `${JSON.stringify(board, null, 2)}\n`);
}

function normalizeEntry(raw) {
  const name = String(raw.name || "企鹅玩家").trim().slice(0, 12) || "企鹅玩家";
  const score = Math.max(0, Math.floor(Number(raw.score) || 0));
  const distance = Math.max(0, Math.floor(Number(raw.distance) || 0));
  return { name, score, distance, at: new Date().toISOString() };
}

function updateBoard(entry) {
  const board = readBoard();
  board.score = [...board.score, entry].sort((a, b) => b.score - a.score).slice(0, 5);
  board.distance = [...board.distance, entry].sort((a, b) => b.distance - a.distance).slice(0, 5);
  writeBoard(board);
  return board;
}

function mapSupabaseEntry(entry) {
  return {
    name: entry.name,
    score: entry.score,
    distance: entry.distance,
    at: entry.created_at
  };
}

async function supabaseRequest(pathname, options = {}) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const details = await res.text();
    throw new Error(`Supabase request failed: ${res.status} ${details}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function readSupabaseBoard() {
  const columns = "name,score,distance,created_at";
  const [score, distance] = await Promise.all([
    supabaseRequest(`leaderboard_entries?select=${columns}&order=score.desc&limit=5`),
    supabaseRequest(`leaderboard_entries?select=${columns}&order=distance.desc&limit=5`)
  ]);
  return {
    score: score.map(mapSupabaseEntry),
    distance: distance.map(mapSupabaseEntry)
  };
}

async function updateSupabaseBoard(entry) {
  await supabaseRequest("leaderboard_entries", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      name: entry.name,
      score: entry.score,
      distance: entry.distance
    })
  });
  return readSupabaseBoard();
}

async function getLeaderboard() {
  if (hasSupabase) return readSupabaseBoard();
  return readBoard();
}

async function saveLeaderboard(entry) {
  if (hasSupabase) return updateSupabaseBoard(entry);
  return updateBoard(entry);
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4096) {
        reject(new Error("payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function serveFile(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  if (!publicFiles.has(urlPath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const filePath = path.join(root, "index.html");
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": mime[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/leaderboard" && req.method === "GET") {
    try {
      sendJson(res, 200, await getLeaderboard());
    } catch (error) {
      console.error(error);
      sendJson(res, 500, { error: "leaderboard unavailable" });
    }
    return;
  }
  if (url.pathname === "/api/leaderboard" && req.method === "POST") {
    try {
      const body = await readRequestBody(req);
      const entry = normalizeEntry(JSON.parse(body || "{}"));
      sendJson(res, 200, await saveLeaderboard(entry));
    } catch (error) {
      console.error(error);
      sendJson(res, 400, { error: "invalid score" });
    }
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }
  serveFile(req, res);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Penguin game running on http://127.0.0.1:${port}`);
});
