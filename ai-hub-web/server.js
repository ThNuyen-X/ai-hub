// ========================================================
// AI AGENT HUB - PRO SERVER (MINIMALIST & FAST)
// ========================================================
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execSync, execFile } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { isTechnicalSessionName, sessionTitle, titleFromContent } = require("./session-title.cjs");
const { cleanWorkspacePath, workspaceKey } = require("./workspace-path.cjs");
const { buildSystemInstruction } = require("./system-instruction.cjs");
const {
  startTurnSnapshot,
  captureExplicitToolPaths,
  syncTurnChanges,
  finalizeTurnSnapshotSync,
  deleteSessionDiffStore,
  getSessionFileChangesSummary,
  getSessionSingleFileDiff
} = require("./session-file-diff.cjs");

// Tu dong ghi log vao server.log va ghi server.pid
const LOG_DIR = path.join(process.env.LOCALAPPDATA || process.env.USERPROFILE || ".", "ai-hub", "logs");
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(path.join(LOG_DIR, "server.pid"), String(process.pid));
  const logStream = fs.createWriteStream(path.join(LOG_DIR, "server.log"), { flags: "a" });
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = function (chunk, ...args) {
    try { logStream.write(chunk); } catch {}
    return origOut(chunk, ...args);
  };
  process.stderr.write = function (chunk, ...args) {
    try { logStream.write(chunk); } catch {}
    return origErr(chunk, ...args);
  };
} catch {}
process.on("exit", () => {
  try {
    const pidPath = path.join(LOG_DIR, "server.pid");
    if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
  } catch {}
});

// Thong tin cau hinh & key duoc nap tu bien moi truong (D:\start-web.bat truyen vao)
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 20130;
const NINE_ROUTER_IP = process.env.NINE_ROUTER_IP || "127.0.0.1";
const NINE_ROUTER_PORT = process.env.NINE_ROUTER_PORT || "20128";
const NINE_ROUTER_KEY = process.env.NINE_ROUTER_KEY || process.env.OPENAI_API_KEY || "";

const GOOSE_PATH = process.env.GOOSE_PATH ||
  path.join(process.env.USERPROFILE || process.env.HOME || process.cwd(), ".local", "bin", "goose.exe");
const WORKSPACES_FILE = path.join(__dirname, "workspaces.json");

if (!NINE_ROUTER_KEY) {
  console.warn("⚠️  [CANH BAO] Khong tim thay NINE_ROUTER_KEY tu bien moi truong. Vui long khoi chay bang 'start-web.bat' de nap day du API key!");
}

// Multi-session State Manager
const activeSessions = new Map();
// ========================================================
// GLOBAL HUB EVENT STREAM (MULTI-DEVICE REALTIME SYNC)
// ========================================================
const hubEventClients = new Set();

function setupSseHeaders(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
    "Content-Encoding": "none"
  });
  if (res.socket) {
    if (typeof res.socket.setNoDelay === "function") res.socket.setNoDelay(true);
    if (typeof res.socket.setKeepAlive === "function") res.socket.setKeepAlive(true, 10000);
  }
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  // 4KB comment padding + retry hint to defeat Mobile Safari / WebKit buffering and speed up auto-reconnect
  res.write("retry: 1500\n: " + " ".repeat(4096) + "\n\n");
  if (typeof res.flush === "function") res.flush();
}

function broadcastHubEvent(event, data) {
  const p = data || {};
  const chunk = `event: ${event}\ndata: ${JSON.stringify(p)}\n\n`;
  for (const client of hubEventClients) {
    try {
      client.write(chunk);
      if (typeof client.flush === "function") client.flush();
    } catch {
      hubEventClients.delete(client);
    }
  }
}

if (typeof setInterval === "function") {
  setInterval(() => {
    for (const client of hubEventClients) {
      try {
        client.write(": heartbeat\n\n");
        if (typeof client.flush === "function") client.flush();
      } catch {
        hubEventClients.delete(client);
      }
    }
    for (const sessionCtx of activeSessions.values()) {
      if (!sessionCtx || !sessionCtx.clients) continue;
      for (const client of sessionCtx.clients) {
        try {
          client.write(": heartbeat\n\n");
          if (typeof client.flush === "function") client.flush();
        } catch {
          sessionCtx.clients.delete(client);
        }
      }
    }
  }, 15000);
}
 // Map<sessionId, SessionContext>

let activeProcess = null;
let activeSessionId = null;
let activeSessionInfo = null;
let activeSessionEvents = [];
const activeClients = new Set();
const recentlyCompletedSessions = new Map();

function getRunningSession(sessionId, skipDbLookup = false) {
  if (!sessionId) return null;
  if (activeSessions.size === 0 && recentlyCompletedSessions.size === 0) return null;
  if (activeSessions.has(sessionId)) return activeSessions.get(sessionId);
  for (const ctx of activeSessions.values()) {
    if (ctx.sessionId === sessionId || ctx.info?.sessionId === sessionId || ctx.tempName === sessionId || ctx.resolvedDbId === sessionId) {
      return ctx;
    }
  }
  if (!skipDbLookup && activeSessions.size > 0) {
    try {
      const stored = findStoredSession(sessionId);
      if (stored) {
        if (activeSessions.has(stored.id)) return activeSessions.get(stored.id);
        if (stored.name && activeSessions.has(stored.name)) return activeSessions.get(stored.name);
        for (const ctx of activeSessions.values()) {
          if (ctx.sessionId === stored.id || ctx.sessionId === stored.name || ctx.tempName === stored.name || ctx.resolvedDbId === stored.id) {
            ctx.resolvedDbId = stored.id;
            return ctx;
          }
        }
      }
    } catch {}
  }
  if (recentlyCompletedSessions.has(sessionId)) return recentlyCompletedSessions.get(sessionId);
  for (const ctx of recentlyCompletedSessions.values()) {
    if (ctx.sessionId === sessionId || ctx.info?.sessionId === sessionId || ctx.tempName === sessionId || ctx.resolvedDbId === sessionId) {
      return ctx;
    }
  }
  return null;
}

function isSessionRunning(sessionId) {
  const ctx = getRunningSession(sessionId);
  return !!(ctx && !ctx.isFinished);
}

function coalesceSessionEventsForReplay(events) {
  const result = [];
  for (const item of events) {
    const prev = result[result.length - 1];
    if ((item.event === "text" || item.event === "thinking") && prev && prev.event === item.event && typeof prev.payload?.text === "string" && typeof item.payload?.text === "string") {
      prev.id = item.id;
      prev.payload = { ...prev.payload, text: prev.payload.text + item.payload.text };
    } else {
      result.push({ id: item.id, event: item.event, payload: (typeof item.payload === "object" && item.payload !== null) ? { ...item.payload } : item.payload });
    }
  }
  return result;
}

function broadcastToSession(sessionCtx, event, payload) {
  if (!sessionCtx) return;
  const p = (typeof payload === "object" && payload !== null) ? { type: event, ...payload } : { type: event, value: payload };
  if (event === "tool_call" && p.name && !p.tool) p.tool = p.name;
  sessionCtx.nextEventId = (sessionCtx.nextEventId || 0) + 1;
  const eventId = sessionCtx.nextEventId;
  sessionCtx.events.push({ id: eventId, event, payload: p });
  if (sessionCtx.events.length > 1200) {
    const splitIdx = Math.floor(sessionCtx.events.length / 2);
    sessionCtx.events = coalesceSessionEventsForReplay(sessionCtx.events.slice(0, splitIdx)).concat(sessionCtx.events.slice(splitIdx));
    while (sessionCtx.events.length > 1200) {
      const rawIdx = sessionCtx.events.findIndex(e => e.event === "raw_log");
      if (rawIdx !== -1) sessionCtx.events.splice(rawIdx, 1);
      else sessionCtx.events.shift();
    }
  }
  const chunk = `id: ${eventId}\nevent: ${event}\ndata: ${JSON.stringify(p)}\n\n`;
  for (const client of sessionCtx.clients) {
    try {
      client.write(chunk);
      if (typeof client.flush === "function") client.flush();
    } catch {
      sessionCtx.clients.delete(client);
    }
  }
}

function attachClientToSession(res, sessionCtx, req) {
  setupSseHeaders(res);

  let lastEventId = 0;
  if (req) {
    const hId = req.headers && req.headers["last-event-id"];
    if (hId) {
      const parsed = parseInt(String(hId), 10);
      if (!Number.isNaN(parsed) && parsed > 0) lastEventId = parsed;
    }
    if (!lastEventId && req.url) {
      try {
        const u = new URL(req.url, "http://localhost");
        const qId = parseInt(u.searchParams.get("lastEventId") || "", 10);
        if (!Number.isNaN(qId) && qId > 0) lastEventId = qId;
      } catch {}
    }
  }
  if (lastEventId > (sessionCtx.nextEventId || 0)) lastEventId = 0;

  if (lastEventId === 0 && sessionCtx.info) {
    res.write(`event: session_info\ndata: ${JSON.stringify({ type: "session_info", ...sessionCtx.info })}\n\n`);
  }

  const pendingEvents = lastEventId > 0 ? sessionCtx.events.filter(item => (item.id || 0) > lastEventId) : sessionCtx.events;
  const replayedEvents = coalesceSessionEventsForReplay(pendingEvents);
  for (const item of replayedEvents) {
    const idPrefix = item.id ? `id: ${item.id}\n` : "";
    res.write(`${idPrefix}event: ${item.event}\ndata: ${JSON.stringify(item.payload)}\n\n`);
  }
  if (typeof res.flush === "function") res.flush(); // Flush replayed events on attach

  if (sessionCtx.isFinished) {
    try { res.end(); } catch {}
    return;
  }

  sessionCtx.clients.add(res);

  res.on("close", () => {
    sessionCtx.clients.delete(res);
    console.log(`[CLIENT DETACHED] Client tab disconnected for session ${sessionCtx.sessionId}. Active clients: ${sessionCtx.clients.size}. Task continues in background.`);
  });
}

// Backward compatibility wrappers
function broadcastSSE(event, payload) {
  for (const sessionCtx of activeSessions.values()) {
    broadcastToSession(sessionCtx, event, payload);
  }
}

function attachClientToActiveSession(res, sessionId) {
  const ctx = getRunningSession(sessionId) || (activeSessions.values().next().value || null);
  if (ctx) attachClientToSession(res, ctx);
}

// Chuan hoa legacy model ID (chuyen ag/gemini-3.8-flash-high sang adaptive ag/gemini-3.8-flash)
function normalizeModelId(modelId) {
  if (modelId === "ag/gemini-3.8-flash-high") return "ag/gemini-3.8-flash";
  return modelId;
}

// Cac model co san tren 9Router
const AVAILABLE_MODELS = [
  { id: "cx/gpt-6.1-sol", name: "Codex", full: "cx/gpt-6.1-sol", provider: "OpenAI", tag: "Code chuẩn, tư duy sâu", iconType: "openai" },
  { id: "ag/gemini-3.8-flash", name: "Gemini 3.8 Flash", full: "ag/gemini-3.8-flash", provider: "Google", tag: "Tốc độ cao, suy luận thích ứng", iconType: "gemini" },
  { id: "ag/claude-sonnet-5-5-high", name: "Claude Sonnet 5.5", full: "ag/claude-sonnet-5-5-high", provider: "Anthropic", tag: "Refactor sâu & tự sửa bug", iconType: "claude" },
  { id: "ag/gemini-4-argon-high", name: "Gemini 4 Argon", full: "ag/gemini-4-argon-high", provider: "DeepMind", tag: "Mô hình suy luận cao cấp", iconType: "argon" }
];

// Quan ly danh sach Workspaces
function getSavedWorkspaces() {
  const defaults = process.env.AI_HUB_DEFAULT_WORKSPACE ? [process.env.AI_HUB_DEFAULT_WORKSPACE] : [];
  try {
    if (fs.existsSync(WORKSPACES_FILE)) {
      const data = JSON.parse(fs.readFileSync(WORKSPACES_FILE, "utf8"));
      if (Array.isArray(data)) return [...new Map(data.filter(p => typeof p === "string" && p.trim())
        .map(p => [workspaceKey(p), cleanWorkspacePath(p)])).values()];
    }
  } catch {}
  return defaults;
}

function saveWorkspace(newPath) {
  const list = getSavedWorkspaces();
  const cleanPath = cleanWorkspacePath(newPath);
  if (!list.some(p => workspaceKey(p) === workspaceKey(cleanPath))) {
    list.unshift(cleanPath);
    try {
      fs.writeFileSync(WORKSPACES_FILE, JSON.stringify(list, null, 2), "utf8");
    } catch {}
  }
  return list;
}

function removeWorkspace(wsPath) {
  let list = getSavedWorkspaces();
  const cleanPath = workspaceKey(wsPath);
  list = list.filter(p => workspaceKey(p) !== cleanPath);
  try {
    fs.writeFileSync(WORKSPACES_FILE, JSON.stringify(list, null, 2), "utf8");
  } catch {}
  return list;
}

function deleteSession(sessionId) {
  let db;
  try {
    const dbPath = path.join(process.env.APPDATA, "Block", "goose", "data", "sessions", "sessions.db");
    if (!fs.existsSync(dbPath)) return { ok: false, error: "Không tìm thấy CSDL sessions.db" };
    db = new DatabaseSync(dbPath);

    let realId = sessionId;
    const findStmt = db.prepare("SELECT id FROM sessions WHERE id = ? OR name = ?");
    const found = findStmt.get(sessionId, sessionId);
    if (found && found.id) {
      realId = found.id;
    }

    db.exec("PRAGMA foreign_keys = ON;");
    db.prepare("DELETE FROM messages WHERE session_id = ?").run(realId);
    db.prepare("DELETE FROM usage_ledger WHERE session_id = ?").run(realId);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(realId);
    db.close();
    db = null;

    // Neu phien nay dang chay, dung tien trinh
    const runningCtx = getRunningSession(sessionId) || getRunningSession(realId);
    if (runningCtx) {
      try { process.kill(runningCtx.process.pid); } catch {}
      for (const c of runningCtx.clients) {
        try { c.end(); } catch {}
      }
      runningCtx.clients.clear();
      activeSessions.delete(runningCtx.sessionId);
      if (runningCtx.tempName) activeSessions.delete(runningCtx.tempName);
      if (runningCtx.info?.sessionId) activeSessions.delete(runningCtx.info.sessionId);
      if (activeProcess === runningCtx.process) {
        activeProcess = null;
        activeSessionId = null;
        activeSessionInfo = null;
        activeSessionEvents = [];
      }
    }

    return { ok: true, id: realId };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (db) { try { db.close(); } catch {} }
  }
}

function extractUserPromptTextFromContentJson(contentJson) {
  let content = [];
  try {
    content = typeof contentJson === "string"
      ? JSON.parse(contentJson || "[]")
      : (Array.isArray(contentJson) ? contentJson : []);
  } catch {
    return "";
  }
  const userTexts = [];
  for (const c of content) {
    if (!c || c.type === "toolResponse") continue;
    if (typeof c === "string") userTexts.push(c);
    else if (typeof c.text === "string") userTexts.push(c.text);
    else if (c.text && typeof c.text.value === "string") userTexts.push(c.text.value);
  }
  return String(userTexts.join("\n") || "")
    .replace(/<turn-context\b[^>]*>[\s\S]*?<\/turn-context>/gi, "")
    .replace(/^\[Yêu cầu:[^\]]*\]\s*/i, "")
    .trim();
}

function truncateLastUserTurn(sessionId, newTitlePrompt = "") {
  if (!sessionId) return { ok: false, error: "Thiếu sessionId" };
  let db;
  try {
    const runningCtx = getRunningSession(sessionId);
    const resolvedRunningId = runningCtx?.resolvedDbId || runningCtx?.info?.sessionId || null;
    if (runningCtx) {
      try {
        if (runningCtx.process?.pid) {
          if (process.platform === "win32") {
            try { execSync(`taskkill /pid ${runningCtx.process.pid} /f /t`, { windowsHide: true }); } catch {}
          } else {
            process.kill(runningCtx.process.pid);
          }
        }
      } catch {}
      runningCtx.isFinished = true;
      for (const c of runningCtx.clients) {
        try { c.end(); } catch {}
      }
      runningCtx.clients.clear();
      activeSessions.delete(runningCtx.sessionId);
      if (runningCtx.tempName) activeSessions.delete(runningCtx.tempName);
      if (runningCtx.info?.sessionId) activeSessions.delete(runningCtx.info.sessionId);
      if (runningCtx.resolvedDbId) activeSessions.delete(runningCtx.resolvedDbId);
      recentlyCompletedSessions.delete(runningCtx.sessionId);
      if (runningCtx.tempName) recentlyCompletedSessions.delete(runningCtx.tempName);
      if (runningCtx.info?.sessionId) recentlyCompletedSessions.delete(runningCtx.info.sessionId);
    }

    const dbPath = path.join(process.env.APPDATA || "", "Block", "goose", "data", "sessions", "sessions.db");
    if (!fs.existsSync(dbPath)) return { ok: true, deletedCount: 0 };
    db = new DatabaseSync(dbPath);

    const lookupId = resolvedRunningId || sessionId;
    const found = db.prepare(`SELECT id, name, user_set_name FROM sessions
      WHERE id = ? OR name = ? OR id = ? OR name = ?
      ORDER BY CASE WHEN id = ? OR id = ? THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`)
      .get(sessionId, sessionId, lookupId, lookupId, sessionId, lookupId);

    if (!found || !found.id) {
      return { ok: true, deletedCount: 0 };
    }

    const realId = found.id;
    const msgRows = db.prepare("SELECT id, role, content_json, metadata_json FROM messages WHERE session_id = ? ORDER BY id ASC").all(realId);

    let lastUserIdx = -1;
    let lastUserText = "";
    for (let i = msgRows.length - 1; i >= 0; i--) {
      const r = msgRows[i];
      if (r.role !== "user") continue;
      const txt = extractUserPromptTextFromContentJson(r.content_json);
      if (!txt || /^#\s*Conversation Summary\b/i.test(txt)) continue;
      lastUserIdx = i;
      lastUserText = txt;
      break;
    }

    let deletedCount = 0;
    if (lastUserIdx >= 0) {
      const targetRow = msgRows[lastUserIdx];
      const delRes = db.prepare("DELETE FROM messages WHERE session_id = ? AND id >= ?").run(realId, targetRow.id);
      deletedCount += Number(delRes?.changes || 0);

      for (let j = lastUserIdx - 1; j >= Math.max(0, lastUserIdx - 4); j--) {
        const prev = msgRows[j];
        if (prev.role !== "user") continue;
        const prevTxt = extractUserPromptTextFromContentJson(prev.content_json);
        if (prevTxt && prevTxt === lastUserText) {
          let meta = {};
          try { meta = JSON.parse(prev.metadata_json || "{}"); } catch {}
          if (meta && meta.agentVisible === false) {
            const dupRes = db.prepare("DELETE FROM messages WHERE session_id = ? AND id = ?").run(realId, prev.id);
            deletedCount += Number(dupRes?.changes || 0);
          }
          break;
        }
      }

      let hasRemainingUserPrompt = false;
      for (let k = 0; k < lastUserIdx; k++) {
        if (msgRows[k].role !== "user") continue;
        const t = extractUserPromptTextFromContentJson(msgRows[k].content_json);
        if (t && !/^#\s*Conversation Summary\b/i.test(t) && t !== lastUserText) {
          hasRemainingUserPrompt = true;
          break;
        }
      }
      if (!hasRemainingUserPrompt && !found.user_set_name && newTitlePrompt && String(newTitlePrompt).trim()) {
        const nextTitle = sessionTitle(String(newTitlePrompt).trim());
        db.prepare("UPDATE sessions SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(nextTitle, realId);
      }
    }

    return { ok: true, sessionId: realId, deletedCount };
  } catch (err) {
    console.error("[REWIND LAST TURN] " + err.message);
    return { ok: false, error: err.message };
  } finally {
    if (db) { try { db.close(); } catch {} }
  }
}

function renameSession(sessionId, newName) {
  let db;
  try {
    const dbPath = path.join(process.env.APPDATA, "Block", "goose", "data", "sessions", "sessions.db");
    if (!fs.existsSync(dbPath)) return { ok: false, error: "Không tìm thấy CSDL sessions.db" };
    db = new DatabaseSync(dbPath);

    let realId = sessionId;
    const findStmt = db.prepare("SELECT id FROM sessions WHERE id = ? OR name = ?");
    const found = findStmt.get(sessionId, sessionId);
    if (found && found.id) {
      realId = found.id;
    }

    db.prepare("UPDATE sessions SET name = ?, user_set_name = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(newName, realId);
    db.close();
    db = null;
    return { ok: true, id: realId, name: newName };
  } catch (err) {
    console.error("Lỗi đổi tên phiên:", err);
    return { ok: false, error: err.message };
  } finally {
    if (db) { try { db.close(); } catch {} }
  }
}

function deleteWorkspaceAndSessions(wsPath) {
  let db;
  const normalize = workspaceKey;
  try {
    if (typeof wsPath !== "string" || !wsPath.trim()) {
      throw new Error("Đường dẫn workspace không hợp lệ");
    }
    const target = normalize(wsPath);
    for (const ctx of activeSessions.values()) {
      if (ctx.info?.cwd && normalize(ctx.info.cwd) === target) {
        throw new Error("Workspace đang chạy tác vụ. Vui lòng dừng tác vụ trước khi xóa.");
      }
    }
    const deletedSessionIds = [];
    const dbPath = path.join(process.env.APPDATA, "Block", "goose", "data", "sessions", "sessions.db");
    if (fs.existsSync(dbPath)) {
      db = new DatabaseSync(dbPath);
      db.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;");
      const rows = db.prepare("SELECT id, working_dir FROM sessions").all();
      const messages = db.prepare("DELETE FROM messages WHERE session_id = ?");
      const usage = db.prepare("DELETE FROM usage_ledger WHERE session_id = ?");
      const sessions = db.prepare("DELETE FROM sessions WHERE id = ?");
      for (const row of rows) {
        if (!row.working_dir || normalize(row.working_dir) !== target) continue;
        messages.run(row.id);
        usage.run(row.id);
        sessions.run(row.id);
        deletedSessionIds.push(row.id);
      }
      db.exec("COMMIT;");
    }
    const workspaces = removeWorkspace(wsPath);
    return { ok: true, workspaces, deletedSessionIds };
  } catch (err) {
    if (db) { try { db.exec("ROLLBACK;"); } catch {} }
    return { ok: false, error: err.message };
  } finally {
    if (db) db.close();
  }
}

// Refresh drives so newly mounted and disconnected volumes are reflected.
function getAvailableDrives() {
  if (process.platform !== "win32") return [path.parse(process.cwd()).root];
  const drives = [];
  for (let i = 65; i <= 90; i++) {
    const drive = String.fromCharCode(i) + ":\\";
    try { if (fs.statSync(drive).isDirectory()) drives.push(drive); } catch {}
  }
  return drives;
}

function resolveBrowsePath(targetPath) {
  if (typeof targetPath !== "string") throw new TypeError("Đường dẫn thư mục phải là chuỗi");
  let value = targetPath.trim();
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  // A bare drive letter means its root, not Windows' per-drive working directory.
  if (process.platform === "win32" && /^[a-z]:$/i.test(value)) value += "\\";
  return path.resolve(value || process.cwd());
}

function listFolderEntries(targetPath, foldersOnly) {
  const drives = getAvailableDrives();
  let current = process.cwd();
  const key = foldersOnly ? "folders" : "items";
  try {
    current = resolveBrowsePath(targetPath || "");
    const entries = fs.readdirSync(current, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name.startsWith("$") || entry.name === "node_modules") continue;
      const fullPath = path.join(current, entry.name);
      let isDirectory = entry.isDirectory();
      let size = 0;
      try {
        if (entry.isSymbolicLink() || !isDirectory) {
          const stat = fs.statSync(fullPath);
          isDirectory = stat.isDirectory();
          size = isDirectory ? 0 : stat.size;
        }
      } catch {
        if (entry.isSymbolicLink()) continue;
      }
      if (foldersOnly) {
        if (isDirectory) items.push({ name: entry.name, path: fullPath });
      } else {
        items.push({ name: entry.name, path: fullPath, isDirectory, size,
          ext: isDirectory ? "" : path.extname(entry.name).toLowerCase() });
      }
    }
    items.sort((a, b) => {
      if (!foldersOnly && a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    const parent = path.dirname(current);
    return { current, currentDir: current, parent: parent === current ? null : parent, drives, [key]: items };
  } catch (err) {
    return { error: err.message, current, currentDir: current, parent: null, drives, [key]: [] };
  }
}

function listFolderDirectories(targetPath) {
  return listFolderEntries(targetPath, true);
}

function listFolderFiles(targetPath) {
  return listFolderEntries(targetPath, false);
}

// Each picker owns its stdout result; no shared files or shell-interpolated paths.
function runNativePicker(req, res, kind, initialDir) {
  const isFolder = kind === "folder";
  let child;
  let timer;
  let finished = false;
  let stdout = "";
  let stderr = "";
  const cleanup = () => {
    clearTimeout(timer);
    res.removeListener("close", disconnected);
    req.removeListener("aborted", disconnected);
  };
  const finish = (result) => {
    if (finished) return;
    finished = true;
    cleanup();
    if (!res.destroyed && !res.writableEnded) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(result));
    }
  };
  const failure = (message, error = false) => {
    const result = { ok: false, ...(isFolder ? {} : { files: [] }), message };
    if (error) result.error = message;
    finish(result);
  };
  const disconnected = () => {
    if (finished) return;
    finished = true;
    cleanup();
    if (child) { try { child.kill(); } catch {} }
  };
  res.once("close", disconnected);
  req.once("aborted", disconnected);
  try {
    child = spawn("powershell.exe", [
      "-ExecutionPolicy", "Bypass", "-NoProfile", "-Sta", "-File",
      path.join(__dirname, isFolder ? "browse_folder.ps1" : "browse_files.ps1")
    ], {
      windowsHide: true,
      env: { ...process.env, AI_HUB_PICKER_INITIAL_DIRECTORY: typeof initialDir === "string" && initialDir ? resolveBrowsePath(initialDir) : "" }
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdout += chunk;
      if (stdout.length > 4 * 1024 * 1024) {
        failure("Kết quả chọn tệp vượt quá giới hạn dung lượng", true);
        try { child.kill(); } catch {}
      }
    });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-16384); });
    child.once("error", err => failure(err.message, true));
    child.once("close", code => {
      if (finished) return;
      if (code !== 0) return failure(stderr.trim() || "Hộp thoại chọn tệp kết thúc với mã " + code, true);
      try {
        const result = JSON.parse(stdout.replace(/^\uFEFF/, "").trim());
        if (!result || typeof result.ok !== "boolean") throw new Error("Phản hồi từ hộp thoại chọn tệp không hợp lệ");
        if (!result.ok) return failure(result.message || "Đã hủy chọn");
        if (isFolder) {
          if (typeof result.path !== "string" || !path.isAbsolute(result.path) || !fs.statSync(result.path).isDirectory()) {
            throw new Error("Hộp thoại trả về đường dẫn thư mục không hợp lệ");
          }
          finish({ ok: true, path: result.path, workspaces: saveWorkspace(result.path) });
        } else {
          if (!Array.isArray(result.files) || result.files.length === 0 ||
              !result.files.every(file => typeof file === "string" && path.isAbsolute(file) && fs.statSync(file).isFile())) {
            throw new Error("Hộp thoại trả về đường dẫn tệp không hợp lệ");
          }
          finish({ ok: true, files: result.files });
        }
      } catch (err) {
        failure(stderr.trim() || err.message, true);
      }
    });
    timer = setTimeout(() => {
      failure("Đã hết thời gian chờ chọn tệp hoặc thư mục", true);
      try { child.kill(); } catch {}
    }, isFolder ? 60000 : 90000);
    if (req.aborted || res.destroyed) disconnected();
  } catch (err) {
    failure(err.message, true);
  }
}

// Tim thu muc theo ten va file mau tren cac o dia
function findMatchingFolder(targetName, sampleFile) {
  if (!targetName) return null;

  // 1. Kiem tra trong danh sach workspace da luu truoc
  const saved = getSavedWorkspaces();
  for (const ws of saved) {
    const base = path.basename(ws);
    if (base.toLowerCase() === targetName.toLowerCase()) {
      if (!sampleFile || fs.existsSync(path.join(ws, sampleFile))) {
        return ws;
      }
      return ws;
    }
  }

  // Search only configured roots, saved workspaces and the current user directory.
  const roots = [...new Set([...(process.env.AI_HUB_SEARCH_ROOTS || "").split(path.delimiter),
    ...saved, process.env.USERPROFILE || process.env.HOME, process.cwd()].filter(Boolean))];

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    try {
      const queue = [{ p: root, d: 0 }];
      while (queue.length > 0) {
        const { p, d } = queue.shift();
        if (d > 3) continue;
        const entries = fs.readdirSync(p, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory() && !e.name.startsWith('$') && !e.name.startsWith('.') && e.name !== 'node_modules') {
            const full = path.join(p, e.name);
            if (e.name.toLowerCase() === targetName.toLowerCase()) {
              if (!sampleFile || fs.existsSync(path.join(full, sampleFile))) {
                return full;
              }
            }
            queue.push({ p: full, d: d + 1 });
          }
        }
      }
    } catch (_) {}
  }

  return null;
}

// Luu model gan nhat cua tung phien trong bo nho va trich xuat tu SQLite model_config_json
const sessionModels = new Map();
function extractSessionModel(modelConfigJson, sessionId, sessionName) {
  const runningCtx = (sessionId && getRunningSession(sessionId, true)) || (sessionName && getRunningSession(sessionName, true));
  if (runningCtx && runningCtx.info && runningCtx.info.model) return normalizeModelId(runningCtx.info.model);
  if (sessionId && sessionModels.has(sessionId)) return normalizeModelId(sessionModels.get(sessionId));
  if (sessionName && sessionModels.has(sessionName)) return normalizeModelId(sessionModels.get(sessionName));
  if (modelConfigJson && typeof modelConfigJson === "string") {
    try {
      const parsed = JSON.parse(modelConfigJson);
      const m = parsed?.model_name || parsed?.model || null;
      if (m) return normalizeModelId(m);
    } catch {}
  }
  return null;
}

// Lay danh sach cac phien lam viec tu Goose
function getSessionsList() {
  const dbPath = path.join(process.env.APPDATA || "", "Block", "goose", "data", "sessions", "sessions.db");
  if (fs.existsSync(dbPath)) {
    let db;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      const rows = db.prepare(`SELECT s.id, s.name, s.working_dir AS cwd, s.created_at, s.updated_at,
        (SELECT content_json FROM messages WHERE session_id = s.id AND role = 'user' ORDER BY id LIMIT 1) AS first_prompt
        FROM sessions s WHERE s.archived_at IS NULL
          AND s.session_type = 'user' AND s.parent_session_id IS NULL
        ORDER BY s.updated_at DESC`).all();
      const modelConfigMap = new Map();
      try {
        for (const mr of db.prepare("SELECT id, model_config_json FROM sessions WHERE archived_at IS NULL AND model_config_json IS NOT NULL").all()) {
          if (mr.id && mr.model_config_json) modelConfigMap.set(mr.id, mr.model_config_json);
        }
      } catch {}
      return rows.map(({ first_prompt, ...session }) => {
        const resolvedModel = extractSessionModel(modelConfigMap.get(session.id), session.id, session.name);
        const techName = isTechnicalSessionName(session.name) ? session.name : null;
        return {
          ...session,
          cwd: cleanWorkspacePath(session.cwd),
          name: techName ? titleFromContent(first_prompt) : session.name,
          ...(techName ? { tempName: techName } : {}),
          date: session.updated_at,
          ...(resolvedModel ? { model: resolvedModel } : {})
        };
      });
    } catch (err) {
      console.error("[SESSION TITLES] " + err.message);
    } finally {
      if (db) db.close();
    }
  }
  try {
    const out = execSync(`"${GOOSE_PATH}" session list`, { encoding: "utf8", timeout: 4000, windowsHide: true });
    const lines = out.split("\n").filter(l => l.trim() && !l.includes("Available sessions:"));
    return lines.map(line => {
      const parts = line.split(" - ");
      return {
        id: parts[0]?.trim(),
        name: parts[1]?.trim() || "Phiên làm việc",
        date: parts[2]?.trim() || "",
        cwd: parts[3]?.trim() || ""
      };
    }).filter(s => s.id && !/^Delegated task$/i.test(s.name));
  } catch {
    return [];
  }
}

// Lay noi dung chi tiet cua mot phien lam viec

function findStoredSession(sessionId) {
  const dbPath = path.join(process.env.APPDATA || "", "Block", "goose", "data", "sessions", "sessions.db");
  if (!fs.existsSync(dbPath)) return null;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare("SELECT id, name FROM sessions WHERE id = ? OR name = ? ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, updated_at DESC LIMIT 1")
      .get(sessionId, sessionId, sessionId) || null;
  } finally {
    db.close();
  }
}

function getSessionDetail(sessionId, skipCliFallback = false) {
  const dbPath = path.join(process.env.APPDATA || "", "Block", "goose", "data", "sessions", "sessions.db");
  if (fs.existsSync(dbPath)) {
    let db;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      const row = db.prepare(`SELECT id, name, working_dir, user_set_name, session_type, created_at, updated_at
        FROM sessions WHERE id = ? OR name = ?
        ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`).get(sessionId, sessionId, sessionId);
      let rowModelConfigJson = null;
      if (row && row.id) {
        try {
          const mc = db.prepare("SELECT model_config_json FROM sessions WHERE id = ?").get(row.id);
          rowModelConfigJson = mc?.model_config_json || null;
        } catch {}
      }
      if (row && row.id) {
        const msgRows = db.prepare(`SELECT message_id, role, created_timestamp, content_json, metadata_json
          FROM messages WHERE session_id = ? ORDER BY id ASC`).all(row.id);
        const conversation = msgRows.map(r => {
          let content = [];
          let metadata;
          try { content = JSON.parse(r.content_json || "[]"); } catch {}
          try { if (r.metadata_json) metadata = JSON.parse(r.metadata_json); } catch {}
          return {
            id: r.message_id,
            role: r.role,
            created: r.created_timestamp,
            content,
            ...(metadata !== undefined ? { metadata } : {})
          };
        });
        return {
          id: row.id,
          name: row.name,
          working_dir: row.working_dir,
          user_set_name: !!row.user_set_name,
          session_type: row.session_type,
          created_at: row.created_at,
          updated_at: row.updated_at,
          model: extractSessionModel(rowModelConfigJson, row.id, row.name),
          conversation,
          message_count: conversation.length
        };
      }
      if (skipCliFallback) return { conversation: [] };
    } catch (err) {
      console.error("[SESSION DETAIL DB] " + err.message);
    } finally {
      if (db) db.close();
    }
  }
  if (skipCliFallback) return { conversation: [] };
  try {
    let out = '';
    try {
      out = execSync(`"${GOOSE_PATH}" session export --session-id "${sessionId}" --format json`, {
        encoding: "utf8",
        timeout: 6000,
        windowsHide: true,
        maxBuffer: 50 * 1024 * 1024
      });
    } catch {
      const list = getSessionsList();
      const match = list.find(s => s.name === sessionId || s.id === sessionId);
      if (match && match.id && match.id !== sessionId) {
        out = execSync(`"${GOOSE_PATH}" session export --session-id "${match.id}" --format json`, {
          encoding: "utf8",
          timeout: 6000,
          windowsHide: true,
          maxBuffer: 50 * 1024 * 1024
        });
      }
    }
    return JSON.parse(out);
  } catch (err) {
    return { error: err.message };
  }
}

let _cachedTailscaleIp = null;
let _cachedTailscaleIpAt = 0;
function getSystemInfo() {
  const now = Date.now();
  if (!_cachedTailscaleIp || (now - _cachedTailscaleIpAt) > 60000) {
    let ip = process.env.AI_HUB_TAILSCALE_IP || "127.0.0.1";
    try {
      ip = execSync("tailscale ip -4", { encoding: "utf8", timeout: 2000, windowsHide: true }).trim() || ip;
    } catch {}
    _cachedTailscaleIp = ip;
    _cachedTailscaleIpAt = now;
  }
  const tailscaleIp = _cachedTailscaleIp;
  for (const ctx of activeSessions.values()) {
    if (ctx && !ctx.isFinished && !ctx.resolvedDbId) {
      try {
        const stored = findStoredSession(ctx.sessionId);
        if (stored && stored.id) ctx.resolvedDbId = stored.id;
      } catch {}
    }
  }
  const activeCtxList = Array.from(new Set(activeSessions.values())).filter(c => c && !c.isFinished);
  const latestCtx = activeCtxList[0] || null;
  const formatActiveInfo = (c) => {
    if (!c) return null;
    const resolvedId = c.resolvedDbId || c.info?.sessionId || c.sessionId;
    const tempName = c.tempName || (c.sessionId && c.sessionId !== resolvedId ? c.sessionId : null);
    return {
      ...c.info,
      sessionId: resolvedId,
      ...(tempName ? { tempName } : {}),
      ...(c.resolvedDbId ? { resolvedDbId: c.resolvedDbId } : {})
    };
  };
  return {
    tailscaleIp,
    vpsHost: `${NINE_ROUTER_IP}:${NINE_ROUTER_PORT}`,
    endpoint: `http://${NINE_ROUTER_IP}:${NINE_ROUTER_PORT}/v1`,
    models: AVAILABLE_MODELS,
    workspaces: getSavedWorkspaces(),
    platform: process.platform,
    drives: getAvailableDrives(),
    gooseFound: fs.existsSync(GOOSE_PATH),
    activeSessionId: latestCtx ? (latestCtx.resolvedDbId || latestCtx.info?.sessionId || latestCtx.sessionId) : null,
    activeSessionInfo: formatActiveInfo(latestCtx),
    activeSessions: activeCtxList.map(formatActiveInfo).filter(Boolean),
    isBusy: activeCtxList.length > 0
  };
}

function resolveLocalTargetPath(rawInput, workspace) {
  if (!rawInput || typeof rawInput !== "string") return { valid: false, resolved: "" };
  const cleaned = rawInput.trim().replace(/^[`"']+|[`"']+$/g, "").trim();
  if (!cleaned || cleaned.length > 400 || /[\r\n\0]/.test(cleaned)) {
    return { valid: false, resolved: "" };
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(cleaned)) {
    return { valid: false, resolved: "" };
  }
  if (process.platform === "win32") {
    if (cleaned.startsWith("/") || cleaned.startsWith("\\\\")) {
      return { valid: false, resolved: "" };
    }
    if (/^[a-zA-Z]:[\\\/]/.test(cleaned)) {
      const driveRoot = cleaned.slice(0, 2).toUpperCase() + "\\";
      const drives = getAvailableDrives().map(d => d.toUpperCase());
      if (!drives.includes(driveRoot)) {
        return { valid: false, resolved: "" };
      }
      return { valid: true, resolved: path.normalize(cleaned) };
    }
  }
  if (!path.isAbsolute(cleaned)) {
    if (workspace && fs.existsSync(workspace)) {
      return { valid: true, resolved: path.resolve(workspace, cleaned) };
    }
    return { valid: true, resolved: path.resolve(process.cwd(), cleaned) };
  }
  return { valid: true, resolved: path.normalize(cleaned) };
}

function runGitAsync(args, cwd, timeoutMs = 4500) {
  return new Promise((resolve) => {
    execFile("git", ["--no-optional-locks", ...args], {
      cwd,
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8"
    }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, stdout: stdout || "", stderr: stderr || err.message || "" });
      } else {
        resolve({ ok: true, stdout: stdout || "", stderr: stderr || "" });
      }
    });
  });
}

function countUnifiedDiffStats(diffText) {
  if (!diffText) return { added: 0, removed: 0 };
  let added = 0;
  let removed = 0;
  const lines = diffText.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return { added, removed };
}

function buildSyntheticUnifiedDiff(content, mode, relLabel) {
  const safeLabel = (relLabel || "file").replace(/\\/g, "/");
  const norm = String(content || "").replace(/\r\n/g, "\n");
  const lines = norm.length === 0 ? [] : (norm.endsWith("\n") ? norm.slice(0, -1).split("\n") : norm.split("\n"));
  if (mode === "deleted") {
    const header = [
      `diff --git a/${safeLabel} b/${safeLabel}`,
      `--- a/${safeLabel}`,
      "+++ /dev/null",
      `@@ -1,${lines.length} +0,0 @@`
    ];
    return header.concat(lines.map(l => "-" + l)).join("\n");
  }
  const header = [
    `diff --git a/${safeLabel} b/${safeLabel}`,
    "--- /dev/null",
    `+++ b/${safeLabel}`,
    `@@ -0,0 +1,${lines.length} @@`
  ];
  return header.concat(lines.map(l => "+" + l)).join("\n");
}

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = urlObj.pathname;

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // API: Lay thong tin he thong
  if (req.method === "GET" && pathname === "/api/info") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(getSystemInfo()));
    return;
  }

  // API: Danh sach sessions
  if (req.method === "GET" && pathname === "/api/sessions") {
    for (const ctx of activeSessions.values()) {
      if (ctx && !ctx.isFinished && !ctx.resolvedDbId) {
        try {
          const stored = findStoredSession(ctx.sessionId);
          if (stored && stored.id) ctx.resolvedDbId = stored.id;
        } catch {}
      }
    }
    const list = getSessionsList().map(s => {
      const runningCtx = getRunningSession(s.id, true) || (s.tempName && getRunningSession(s.tempName, true)) || getRunningSession(s.name, true);
      if (runningCtx && s.id && !runningCtx.resolvedDbId) {
        runningCtx.resolvedDbId = s.id;
      }
      const isRunning = !!(runningCtx && !runningCtx.isFinished);
      const model = runningCtx?.info?.model || s.model || extractSessionModel(null, s.id, s.name);
      const tempName = runningCtx?.tempName || s.tempName || (runningCtx?.sessionId && runningCtx.sessionId !== s.id ? runningCtx.sessionId : null);
      return {
        ...s,
        name: (isRunning && (isTechnicalSessionName(s.name) || !s.name || s.name === 'Cuộc trò chuyện mới') && runningCtx.info?.title) ? runningCtx.info.title : s.name,
        ...(tempName ? { tempName } : {}),
        ...(model ? { model } : {}),
        isRunning
      };
    });
    for (const ctx of activeSessions.values()) {
      if (!ctx || ctx.isFinished) continue;
      const alreadyInList = list.some(s =>
        s.id === ctx.sessionId || s.name === ctx.sessionId || s.tempName === ctx.sessionId ||
        (ctx.resolvedDbId && (s.id === ctx.resolvedDbId || s.tempName === ctx.resolvedDbId)) ||
        (ctx.tempName && (s.id === ctx.tempName || s.name === ctx.tempName || s.tempName === ctx.tempName)) ||
        (ctx.info?.sessionId && (s.id === ctx.info.sessionId || s.name === ctx.info.sessionId || s.tempName === ctx.info.sessionId))
      );
      if (!alreadyInList) {
        list.unshift({
          id: ctx.resolvedDbId || ctx.info?.sessionId || ctx.sessionId,
          ...(ctx.tempName ? { tempName: ctx.tempName } : {}),
          name: ctx.info?.title || ctx.sessionId,
          cwd: cleanWorkspacePath(ctx.info?.cwd || ""),
          date: new Date(ctx.info?.startTime || Date.now()).toISOString(),
          ...(ctx.info?.model ? { model: ctx.info.model } : {}),
          isRunning: true
        });
      }
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(list));
    return;
  }

  // API: Chi tiet session cu
  if (req.method === "GET" && pathname === "/api/session") {
    const id = urlObj.searchParams.get("id");
    if (!id) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Thiếu mã phiên" }));
      return;
    }
    const runningCtx = getRunningSession(id);
    const isRunning = !!(runningCtx && !runningCtx.isFinished);
    const detail = getSessionDetail(id, isRunning) || {};
    detail.isRunning = isRunning;
    if (!detail.model) {
      const fallbackModel = runningCtx?.info?.model || extractSessionModel(null, id, detail.name);
      if (fallbackModel) detail.model = fallbackModel;
    }
    if (detail.isRunning) {
      delete detail.error;
      if (!Array.isArray(detail.conversation)) detail.conversation = [];
      if (runningCtx.info) {
        detail.activeSessionInfo = runningCtx.info;
        if (runningCtx.info.model) detail.model = runningCtx.info.model;
      }
    }
    const resolvedDetailId = detail.id || runningCtx?.info?.sessionId || id;
    let sessionChanges = getSessionFileChangesSummary(resolvedDetailId);
    if ((!sessionChanges || sessionChanges.length === 0) && runningCtx?.tempName && runningCtx.tempName !== resolvedDetailId) {
      sessionChanges = getSessionFileChangesSummary(runningCtx.tempName);
    }
    if ((!sessionChanges || sessionChanges.length === 0) && id !== resolvedDetailId) {
      sessionChanges = getSessionFileChangesSummary(id);
    }
    detail.sessionFileChanges = sessionChanges || [];
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(detail));
    return;
  }

  // API: Duyet danh sach thu muc truc tiep (Visual Folder Browser)
  if (req.method === "GET" && pathname === "/api/fs-folders") {
    const dir = urlObj.searchParams.get("dir") || "";
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(listFolderDirectories(dir)));
    return;
  }

  // API: Duyet danh sach tap tin & thu muc (File Picker chi lay duong dan)
  if (req.method === "GET" && pathname === "/api/fs-files") {
    const dir = urlObj.searchParams.get("dir") || "";
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(listFolderFiles(dir)));
    return;
  }

  // API: Khop thu muc duoc chon tu trinh duyet (webkitdirectory)
  if (req.method === "POST" && pathname === "/api/match-folder") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const { folderName, sampleFile } = JSON.parse(body);
        if (!folderName) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Thiếu tên thư mục" }));
          return;
        }

        const matched = findMatchingFolder(folderName, sampleFile);
        if (matched) {
          const list = saveWorkspace(matched);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, path: matched, workspaces: list }));
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, message: `Không tìm thấy thư mục "${folderName}" trên máy.` }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // Native picker responses preserve the existing folder/files API shapes.
  if (req.method === "POST" && (pathname === "/api/browse-folder" || pathname === "/api/browse-files")) {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      let payload = {};
      try { if (body) payload = JSON.parse(body) || {}; } catch {}
      runNativePicker(req, res, pathname === "/api/browse-folder" ? "folder" : "files",
        payload.initialDir || payload.workspace || payload.dir || "");
    });
    return;
  }

  // API: Mo thu muc hoac file tren may tinh
  if (req.method === "POST" && pathname === "/api/open-path") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body || "{}");
        let targetPath = (payload.path || "").trim();
        const workspace = (payload.workspace || "").trim();

        if (!targetPath) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ success: false, error: "Đường dẫn trống" }));
          return;
        }

        const loc = resolveLocalTargetPath(targetPath, workspace);
        if (!loc.valid || !loc.resolved) {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ success: false, error: `Đường dẫn không thuộc máy cục bộ: ${targetPath}` }));
          return;
        }
        const resolved = loc.resolved;

        if (!fs.existsSync(resolved)) {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({
            success: false,
            error: `Đường dẫn không tồn tại trên máy: ${resolved}`
          }));
          return;
        }

        const stat = fs.statSync(resolved);
        const isDir = stat.isDirectory();
        const baseName = path.basename(resolved);
        const ext = path.extname(resolved).toLowerCase();

        if (process.platform === "win32") {
          if (isDir) {
            const cp = spawn("explorer.exe", [resolved], { detached: true, stdio: "ignore" });
            cp.unref();
          } else if (!payload.reveal && [".html", ".htm", ".jsp", ".java", ".js", ".cjs", ".mjs", ".ts", ".tsx", ".jsx", ".css", ".scss", ".json", ".xml", ".svg", ".md", ".txt", ".log", ".sql", ".py", ".go", ".rs", ".cs", ".c", ".h", ".cpp", ".yaml", ".yml", ".toml", ".properties", ".env", ".sh", ".bat", ".cmd", ".ps1"].includes(ext)) {
            // Open source as text instead of launching browser associations or executing scripts.
            const cp = spawn("notepad.exe", [resolved], { detached: true, stdio: "ignore" });
            cp.unref();
          } else if ([".exe", ".bat", ".cmd", ".msi", ".ps1"].includes(ext) || payload.reveal) {
            const cp = spawn("explorer.exe", ["/select,", resolved], { detached: true, stdio: "ignore" });
            cp.unref();
          } else {
            const cp = spawn("cmd.exe", ["/c", "start", '""', resolved], {
              detached: true,
              stdio: "ignore",
              windowsVerbatimArguments: true
            });
            cp.unref();
          }
        } else if (process.platform === "darwin") {
          spawn("open", [resolved], { detached: true, stdio: "ignore" }).unref();
        } else {
          spawn("xdg-open", [resolved], { detached: true, stdio: "ignore" }).unref();
        }

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({
          success: true,
          isDir,
          path: resolved,
          name: baseName
        }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // API: Xem truoc noi dung file (ho tro ca mobile qua Tailscale)
  if (req.method === "GET" && pathname === "/api/file-preview") {
    try {
      let targetPath = (urlObj.searchParams.get("path") || "").trim();
      const workspace = (urlObj.searchParams.get("workspace") || "").trim();

      if (!targetPath) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, error: "Thiếu tham số path" }));
        return;
      }

      const loc = resolveLocalTargetPath(targetPath, workspace);
      if (!loc.valid || !loc.resolved) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, error: `Đường dẫn không thuộc máy cục bộ: ${targetPath}` }));
        return;
      }
      const resolved = loc.resolved;

      if (!fs.existsSync(resolved)) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, error: `File không tồn tại: ${resolved}` }));
        return;
      }

      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, isDir: true, error: "Đường dẫn là thư mục, không phải file" }));
        return;
      }

      const ext = path.extname(resolved).toLowerCase();
      const imageExts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico"];
      if (imageExts.includes(ext)) {
        const imgBuffer = fs.readFileSync(resolved);
        const mimeType = ext === ".svg" ? "image/svg+xml" : ext === ".ico" ? "image/x-icon" : `image/${ext.replace(".", "")}`;
        const base64 = `data:${mimeType};base64,${imgBuffer.toString("base64")}`;
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({
          success: true,
          name: path.basename(resolved),
          path: resolved,
          size: stat.size,
          isImage: true,
          imageUrl: base64,
          ext
        }));
        return;
      }

      const MAX_SIZE = 2 * 1024 * 1024;
      const readSize = Math.min(stat.size, MAX_SIZE);
      const fd = fs.openSync(resolved, "r");
      const buffer = Buffer.alloc(readSize);
      fs.readSync(fd, buffer, 0, readSize, 0);
      fs.closeSync(fd);

      const content = buffer.toString("utf8");

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        success: true,
        name: path.basename(resolved),
        path: resolved,
        size: stat.size,
        truncated: stat.size > MAX_SIZE,
        ext,
        content
      }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // API: Kiem tra nhanh danh sach duong dan co ton tai tren may cuc bo hay khong
  if (req.method === "POST" && pathname === "/api/check-paths") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body || "{}");
        const rawList = Array.isArray(payload.paths) ? payload.paths.slice(0, 150) : [];
        const workspace = (payload.workspace || "").trim();
        const results = {};
        for (const item of rawList) {
          if (typeof item !== "string") continue;
          const key = item.trim();
          if (!key || results[key]) continue;
          const loc = resolveLocalTargetPath(key, workspace);
          if (!loc.valid || !loc.resolved) {
            results[key] = { exists: false, isDir: false, path: "" };
            continue;
          }
          try {
            if (fs.existsSync(loc.resolved)) {
              const st = fs.statSync(loc.resolved);
              results[key] = { exists: true, isDir: st.isDirectory(), path: loc.resolved };
            } else {
              results[key] = { exists: false, isDir: false, path: loc.resolved };
            }
          } catch {
            results[key] = { exists: false, isDir: false, path: "" };
          }
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: true, platform: process.platform, results }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // API: Xem thay doi file theo phien lam viec (Session-only Diff, khong lay tu Git)
  if (req.method === "GET" && pathname === "/api/session-file-diff") {
    try {
      const sessionId = (urlObj.searchParams.get("sessionId") || "").trim();
      const targetPath = (urlObj.searchParams.get("path") || "").trim();
      const workspace = (urlObj.searchParams.get("workspace") || "").trim();
      if (!targetPath) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, error: "Thiếu tham số path" }));
        return;
      }
      const runningCtx = sessionId ? getRunningSession(sessionId) : null;
      const effectiveSessionId = runningCtx?.info?.sessionId || runningCtx?.sessionId || sessionId;
      let result = getSessionSingleFileDiff(effectiveSessionId, targetPath, workspace);
      if (!result.inSession && runningCtx?.tempName && runningCtx.tempName !== effectiveSessionId) {
        result = getSessionSingleFileDiff(runningCtx.tempName, targetPath, workspace);
      }
      if (!result.inSession && sessionId && sessionId !== effectiveSessionId) {
        result = getSessionSingleFileDiff(sessionId, targetPath, workspace);
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ success: false, error: err.message || "Lỗi đọc thay đổi file trong phiên" }));
    }
    return;
  }

  // API: Xem thay doi file (Git Diff: dong xanh them / dong do xoa)
  if (req.method === "GET" && pathname === "/api/file-diff") {
    (async () => {
      try {
        const targetPath = (urlObj.searchParams.get("path") || "").trim();
        const workspace = (urlObj.searchParams.get("workspace") || "").trim();
        if (!targetPath) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ success: false, error: "Thiếu tham số path" }));
          return;
        }
        const loc = resolveLocalTargetPath(targetPath, workspace);
        if (!loc.valid || !loc.resolved) {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ success: false, error: "Đường dẫn không thuộc máy cục bộ" }));
          return;
        }
        const resolved = loc.resolved;
        const existsNow = fs.existsSync(resolved);
        let stat = null;
        if (existsNow) {
          stat = fs.statSync(resolved);
          if (stat.isDirectory()) {
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ success: false, isDir: true, error: "Đường dẫn là thư mục" }));
            return;
          }
        }

        const ext = path.extname(resolved).toLowerCase();
        const binaryExts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".exe", ".dll", ".zip", ".pdf", ".woff", ".woff2"];
        const isBinary = binaryExts.includes(ext);

        let probeDir = path.dirname(resolved);
        while (probeDir && !fs.existsSync(probeDir)) {
          const parent = path.dirname(probeDir);
          if (parent === probeDir) break;
          probeDir = parent;
        }
        if ((!probeDir || !fs.existsSync(probeDir)) && workspace && fs.existsSync(workspace)) {
          probeDir = workspace;
        }

        let inGit = false;
        let status = existsNow ? "unchanged" : "deleted";
        let diffText = "";

        if (probeDir && fs.existsSync(probeDir)) {
          const topRes = await runGitAsync(["rev-parse", "--show-toplevel"], probeDir);
          if (topRes.ok && topRes.stdout.trim()) {
            inGit = true;
            const repoRoot = path.normalize(topRes.stdout.trim());
            const relPath = path.relative(repoRoot, resolved);
            const relPosix = relPath.split(path.sep).join("/");
            const stRes = await runGitAsync(["status", "--porcelain", "--", relPosix], repoRoot);
            const stLine = (stRes.stdout || "").split(/\r?\n/).find(Boolean) || "";
            const xy = stLine.slice(0, 2);

            if (!existsNow || xy.includes("D")) {
              status = "deleted";
              let dRes = await runGitAsync(["diff", "HEAD", "--unified=3", "--", relPosix], repoRoot);
              if (!dRes.ok || !dRes.stdout.trim()) {
                dRes = await runGitAsync(["diff", "--unified=3", "--", relPosix], repoRoot);
              }
              if (dRes.ok && dRes.stdout.trim()) {
                diffText = dRes.stdout;
              } else if (!isBinary) {
                const showRes = await runGitAsync(["show", `HEAD:${relPosix}`], repoRoot);
                if (showRes.ok && showRes.stdout) {
                  diffText = buildSyntheticUnifiedDiff(showRes.stdout, "deleted", relPosix);
                }
              }
            } else if (xy === "??") {
              status = "added";
              if (!isBinary && stat && stat.size <= 512 * 1024) {
                const rawContent = fs.readFileSync(resolved, "utf8");
                diffText = buildSyntheticUnifiedDiff(rawContent, "added", relPosix);
              }
            } else if (stLine) {
              status = xy.includes("A") ? "added" : "modified";
              const dRes = await runGitAsync(["diff", "HEAD", "--unified=3", "--", relPosix], repoRoot);
              if (!dRes.ok || !dRes.stdout.trim()) {
                const cRes = await runGitAsync(["diff", "--cached", "--unified=3", "--", relPosix], repoRoot);
                const wRes = await runGitAsync(["diff", "--unified=3", "--", relPosix], repoRoot);
                diffText = (cRes.stdout || "") + (wRes.stdout || "");
              } else {
                diffText = dRes.stdout;
              }
              if (!diffText.trim() && status === "added" && !isBinary && stat && stat.size <= 512 * 1024) {
                const rawContent = fs.readFileSync(resolved, "utf8");
                diffText = buildSyntheticUnifiedDiff(rawContent, "added", relPosix);
              }
            }
          }
        }

        const MAX_DIFF_CHARS = 350000;
        let diffTruncated = false;
        if (diffText.length > MAX_DIFF_CHARS) {
          diffText = diffText.slice(0, MAX_DIFF_CHARS);
          diffTruncated = true;
        }
        const stats = countUnifiedDiffStats(diffText);
        if (!inGit && !existsNow) {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({
            success: true,
            name: path.basename(resolved),
            path: resolved,
            exists: false,
            inGit: false,
            hasChanges: false,
            status: "missing",
            added: 0,
            removed: 0,
            diff: ""
          }));
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({
          success: true,
          name: path.basename(resolved),
          path: resolved,
          size: stat ? stat.size : 0,
          exists: existsNow,
          isBinary,
          inGit,
          hasChanges: inGit ? Boolean(diffText.trim() || status !== "unchanged") : false,
          status: inGit ? status : "unchanged",
          added: stats.added,
          removed: stats.removed,
          diffTruncated,
          diff: diffText
        }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    })();
    return;
  }

  // API: Them Workspace truc tiep
  if (req.method === "POST" && pathname === "/api/workspaces") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const dir = payload.dir || payload.workspace;
        if (dir && fs.existsSync(dir)) {
          const updated = saveWorkspace(dir);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, workspaces: updated }));
          return;
        }
      } catch {}
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Đường dẫn không hợp lệ hoặc thư mục không tồn tại." }));
    });
    return;
  }

  // API: Xoa Workspace khoi danh sach
  if (req.method === "POST" && pathname === "/api/delete-workspace") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const dir = payload.dir || payload.workspace;
        if (!dir) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Thiếu đường dẫn workspace" }));
          return;
        }
        const result = deleteWorkspaceAndSessions(dir);
        if (result && result.ok) {
          broadcastHubEvent("sessions_updated", { type: "workspace_deleted", wsPath: dir });
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // API: Xoa phien lam viec
  if (req.method === "POST" && pathname === "/api/delete-session") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const id = payload.id || payload.sessionId;
        if (!id) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Thiếu mã phiên" }));
          return;
        }
        const result = deleteSession(id);
        if (result && result.ok) {
          deleteSessionDiffStore(id);
          broadcastHubEvent("sessions_updated", { type: "session_deleted", sessionId: id });
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // API: Doi ten phien lam viec
  if (req.method === "POST" && pathname === "/api/rename-session") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const id = payload.id || payload.sessionId;
        const name = payload.name || payload.newName;
        if (!id || !name || !name.trim()) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "Vui lòng nhập tên mới hợp lệ" }));
          return;
        }
        const result = renameSession(id, name.trim());
        if (result && result.ok) {
          broadcastHubEvent("sessions_updated", { type: "session_renamed", sessionId: id, name: name.trim() });
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // API: Dung tien trinh dang chay (nut Dung)
  if (req.method === "POST" && pathname === "/api/stop") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let data = {};
      try { data = JSON.parse(body); } catch {}
      const targetId = data.sessionId;
      const targetCtx = targetId ? getRunningSession(targetId) : (activeSessions.values().next().value || null);
      if (targetCtx) {
        console.log(`[STOP] User explicitly stopped task for session ${targetCtx.sessionId} (PID: ${targetCtx.process?.pid})`);
        try {
          if (targetCtx.process?.pid) {
            if (process.platform === 'win32') {
              try { execSync(`taskkill /pid ${targetCtx.process.pid} /f /t`, { windowsHide: true }); } catch {}
            } else {
              process.kill(targetCtx.process.pid);
            }
          }
        } catch {}
        let stoppedFileChanges = [];
        try {
          const stopSid = targetCtx.info?.sessionId || targetCtx.sessionId;
          if (targetCtx.turnDiffTracker && stopSid) {
            stoppedFileChanges = syncTurnChanges(targetCtx.turnDiffTracker, stopSid, { explicitOnly: false, allowWorkspaceScan: true });
            targetCtx.turnDiffTracker.finalized = true;
          }
        } catch {}
        targetCtx.isFinished = true;
        recentlyCompletedSessions.set(targetCtx.sessionId, targetCtx);
        if (targetCtx.tempName) recentlyCompletedSessions.set(targetCtx.tempName, targetCtx);
        if (targetCtx.info?.sessionId) recentlyCompletedSessions.set(targetCtx.info.sessionId, targetCtx);
        setTimeout(() => {
          recentlyCompletedSessions.delete(targetCtx.sessionId);
          if (targetCtx.tempName) recentlyCompletedSessions.delete(targetCtx.tempName);
          if (targetCtx.info?.sessionId) recentlyCompletedSessions.delete(targetCtx.info.sessionId);
        }, 15000);
        if (stoppedFileChanges.length > 0) {
          broadcastToSession(targetCtx, "session_file_diffs", { sessionId: targetCtx.info?.sessionId || targetCtx.sessionId, files: stoppedFileChanges });
        }
        broadcastToSession(targetCtx, "stderr", { text: "Tiến trình đã được dừng bởi người dùng." });
        broadcastToSession(targetCtx, "finish", { exitCode: -1, sessionId: targetCtx.sessionId, session_id: targetCtx.sessionId, sessionFileChanges: stoppedFileChanges });
        for (const c of targetCtx.clients) {
          try { c.end(); } catch {}
        }
        targetCtx.clients.clear();
        activeSessions.delete(targetCtx.sessionId);
        if (targetCtx.tempName) activeSessions.delete(targetCtx.tempName);
        if (targetCtx.info?.sessionId) activeSessions.delete(targetCtx.info.sessionId);
        if (activeProcess === targetCtx.process) {
          activeProcess = null;
          activeSessionId = null;
          activeSessionInfo = null;
          activeSessionEvents = [];
        }
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      broadcastHubEvent("session_stopped", { sessionId: targetId || targetCtx?.sessionId || null });
      res.end(JSON.stringify({ ok: true, message: "Đã dừng tác vụ" }));
    });
    return;
  }

  // API: Tai ket noi luong SSE (vi du khi nguoi dung F5 / mo lai tab)
  
  // API: Global SSE stream for real-time multi-device synchronization
  if (req.method === "GET" && pathname === "/api/hub/events") {
    setupSseHeaders(res);
    res.write(`: connected\n\n`);
    if (typeof res.flush === "function") res.flush();

    hubEventClients.add(res);
    console.log(`[HUB SSE] Client connected. Total clients: ${hubEventClients.size}`);
    req.on("close", () => {
      hubEventClients.delete(res);
      console.log(`[HUB SSE] Client disconnected. Total clients: ${hubEventClients.size}`);
    });
    return;
  }
  if (req.method === "GET" && pathname === "/api/chat/stream") {
    const sId = urlObj.searchParams.get("sessionId");
    const sessionCtx = sId ? getRunningSession(sId) : (activeSessions.values().next().value || null);
    if (sessionCtx) {
      console.log(`[RECONNECT] Client reconnected to active session ${sessionCtx.sessionId}`);
      attachClientToSession(res, sessionCtx, req);
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Không có tác vụ đang chạy cho phiên này" }));
    return;
  }

  // API: Rewind luot cau hoi moi nhat de gui lai (Option 1 Edit)
  if (req.method === "POST" && pathname === "/api/rewind-last-turn") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let data = {};
      try { data = JSON.parse(body); } catch {}
      const result = truncateLastUserTurn(data.sessionId, data.titlePrompt || data.prompt || "");
      res.writeHead(result.ok ? 200 : 500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(result));
    });
    return;
  }

  // API: Gui prompt va nhan stream SSE
  if (req.method === "POST" && pathname === "/api/chat") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let data = {};
      try { data = JSON.parse(body); } catch {}

      const prompt = data.prompt || "";
      const model = normalizeModelId(data.model) || "cx/gpt-6.1-sol";
      const rawCwd = data.cwd || data.workspace;
      const cwd = (rawCwd && fs.existsSync(rawCwd)) ? rawCwd : ((process.env.AI_HUB_DEFAULT_WORKSPACE && fs.existsSync(process.env.AI_HUB_DEFAULT_WORKSPACE)) ? process.env.AI_HUB_DEFAULT_WORKSPACE : process.cwd());
      let sessionId = data.sessionId || `session_${Date.now()}`;
      if (data.rewindLastTurn && data.sessionId) {
        const rewindRes = truncateLastUserTurn(data.sessionId, data.titlePrompt || prompt);
        if (rewindRes && rewindRes.sessionId) {
          sessionId = rewindRes.sessionId;
        }
      }
      let storedSession;
      try {
        storedSession = data.sessionId ? (findStoredSession(sessionId) || findStoredSession(data.sessionId)) : null;
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Cannot load conversation: " + err.message }));
        return;
      }
      const resume = !!storedSession;
      if (storedSession) sessionId = storedSession.id;

      // Never silently start a blank conversation when a previous session is missing.
      if (data.sessionId && !resume && !isSessionRunning(sessionId) && !data.rewindLastTurn) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Conversation not found. Please select an existing session or start a new chat." }));
        return;
      }

      // Neu phien nay dang chay san -> gan client vao nghe tiep thay vi chay de
      const existingSession = getRunningSession(sessionId);
      if (existingSession && !existingSession.isFinished) {
        console.log(`[ATTACH] Client re-attached to existing running session ${sessionId}`);
        if (data.streamMode === "eventsource") {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, sessionId: existingSession.sessionId, tempName: existingSession.tempName || null }));
          return;
        }
        attachClientToSession(res, existingSession, req);
        return;
      }

      // Xoa cache finished session cu vi phien bat dau luot chat moi
      recentlyCompletedSessions.delete(sessionId);
      if (storedSession) {
        recentlyCompletedSessions.delete(storedSession.id);
        if (storedSession.name) recentlyCompletedSessions.delete(storedSession.name);
      }

      if (!prompt.trim()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Vui lòng nhập nội dung tin nhắn" }));
        return;
      }

      console.log(`[CHAT] Prompt: "${prompt.substring(0, 50)}" | Model: ${model} | CWD: ${cwd} | Session: ${sessionId} | Resume: ${resume} | Active sessions: ${activeSessions.size}`);
      saveWorkspace(cwd);
      if (model && sessionId) {
        sessionModels.set(sessionId, model);
        if (storedSession?.id) sessionModels.set(storedSession.id, model);
        if (storedSession?.name) sessionModels.set(storedSession.name, model);
      }

      const rawPrompt = (typeof data.titlePrompt === "string" && data.titlePrompt.trim())
        ? data.titlePrompt.trim()
        : prompt;
      const existingTitle = storedSession && (isTechnicalSessionName(storedSession.name)
        ? getSessionsList().find(s => s.id === storedSession.id)?.name : storedSession.name);
      const title = existingTitle || sessionTitle(rawPrompt);

      const sessionCtx = {
        process: null,
        sessionId,
        tempName: (!resume && sessionId.startsWith('session_')) ? sessionId : null,
        info: { model, cwd, sessionId, prompt: rawPrompt, title, startTime: Date.now() },
        turnDiffTracker: startTurnSnapshot(cwd),
        events: [],
        clients: new Set((data.streamMode === "eventsource") ? [] : [res])
      };

      activeSessions.set(sessionId, sessionCtx);
      activeSessionId = sessionId;
      activeSessionInfo = sessionCtx.info;
      activeSessionEvents = sessionCtx.events;

      if (data.streamMode === "eventsource") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, sessionId, tempName: sessionCtx.tempName || null }));
      } else {
        // Thiet lap Server-Sent Events (SSE) cho client hien tai
        setupSseHeaders(res);

        res.on("close", () => {
          sessionCtx.clients.delete(res);
          console.log(`[CLIENT DETACHED] Client disconnected from session ${sessionId}. Task PID ${sessionCtx.process?.pid} continues running in background.`);
        });
      }

      broadcastToSession(sessionCtx, "session_title", { title });
      broadcastToSession(sessionCtx, "status", { status: "starting", model, cwd, sessionId, session_id: sessionId, text: "Đang kết nối Agent..." });

      const env = {
        ...process.env,
        OPENAI_API_KEY: NINE_ROUTER_KEY,
        OPENAI_HOST: `http://${NINE_ROUTER_IP}:${NINE_ROUTER_PORT}`,
        OPENAI_BASE_URL: `http://${NINE_ROUTER_IP}:${NINE_ROUTER_PORT}/v1`,
        OPENAI_API_BASE: `http://${NINE_ROUTER_IP}:${NINE_ROUTER_PORT}/v1`,
        GOOSE_PROVIDER: "openai",
        GOOSE_MODEL: model,
        GOOSE_CONTEXT_LIMIT: process.env.GOOSE_CONTEXT_LIMIT || "400000",
        GOOSE_CLI_MIN_PRIORITY: "0.8",
        GOOSE_SHOW_FULL_OUTPUT: "false"
      };

      const systemInstruction = buildSystemInstruction(cwd);

      const args = [
        "run",
        "--provider", "openai",
        "--model", model,
        "--system", systemInstruction,
        "--output-format", "stream-json",
        "--text", prompt
      ];

      if (resume) {
        args.push("--resume", "--session-id", sessionId);
      } else {
        args.push("--name", sessionId);
      }

      console.log(`[SPAWN] goose ${args.join(" ")}`);
      const child = spawn(GOOSE_PATH, args, { cwd, env, windowsHide: true });
      sessionCtx.process = child;
      sessionCtx.info.pid = child.pid;
      activeProcess = child;

      broadcastHubEvent("session_turn_started", {
        sessionId,
        tempName: sessionCtx.tempName || null,
        title,
        clientId: data.clientId || null,
        prompt: rawPrompt,
        model,
        cwd,
        timestamp: Date.now()
      });

      let buffer = "";

      child.stdout.on("data", (chunk) => {
        if (sessionCtx.process !== child) return;
        const str = chunk.toString("utf8");
        buffer += str;
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
            try {
              const parsed = JSON.parse(trimmed);
              if (parsed.type === "message" && parsed.message && parsed.message.content) {
                for (const item of parsed.message.content) {
                  if (item.type === "text" && item.text) {
                    const textVal = typeof item.text === 'string' ? item.text : (item.text?.value || item.text?.text || JSON.stringify(item.text));
                    broadcastToSession(sessionCtx, "text", { text: textVal });
                  } else if (item.type === "thinking" && item.thinking) {
                    const thoughtVal = typeof item.thinking === 'string' ? item.thinking : (item.thinking?.value || item.thinking?.thinking || '');
                    if (thoughtVal) {
                      broadcastToSession(sessionCtx, "thinking", { text: thoughtVal });
                    }
                  } else if (item.type === "toolRequest" && item.toolCall) {
                    const reqToolName = item.toolCall.value?.name || "tool";
                    const reqToolArgs = item.toolCall.value?.arguments || {};
                    try {
                      captureExplicitToolPaths(sessionCtx.turnDiffTracker, sessionCtx.info?.sessionId || sessionId, reqToolName, reqToolArgs, cwd);
                    } catch {}
                    broadcastToSession(sessionCtx, "tool_call", {
                      name: reqToolName,
                      args: reqToolArgs
                    });
                  } else if (item.type === "toolResponse") {
                    const isErr = Boolean(item.toolResult?.status === "error" || item.toolResult?.value?.isError || item.toolResult?.error);
                    let outStr = item.output || item.value || "";
                    if (!outStr && item.toolResult) {
                      const trVal = item.toolResult.value;
                      if (typeof trVal === "object" && trVal !== null) {
                        const stdout = trVal.structuredContent?.stdout;
                        const stderr = trVal.structuredContent?.stderr;
                        if (stdout !== undefined || stderr !== undefined) {
                          outStr = (stdout || "") + (stderr ? ("\n[STDERR]: " + stderr) : "");
                        } else if (Array.isArray(trVal.content) && trVal.content[0]?.text) {
                          outStr = trVal.content.map(c => c.text || "").join("\n");
                        } else {
                          outStr = JSON.stringify(trVal, null, 2);
                        }
                      } else if (trVal !== undefined && trVal !== null) {
                        outStr = String(trVal || "");
                      } else if (item.toolResult.error) {
                        outStr = String(item.toolResult.error);
                      }
                    }
                    broadcastToSession(sessionCtx, "tool_result", {
                      output: outStr,
                      id: item.id || "",
                      isError: isErr
                    });
                    if (!isErr && sessionCtx.turnDiffTracker) {
                      try {
                        const liveChanges = syncTurnChanges(sessionCtx.turnDiffTracker, sessionCtx.info?.sessionId || sessionId, { explicitOnly: true, allowWorkspaceScan: false });
                        if (liveChanges.length > 0) {
                          broadcastToSession(sessionCtx, "session_file_diffs", { sessionId: sessionCtx.info?.sessionId || sessionId, files: liveChanges });
                        }
                      } catch {}
                    }
                  } else if (item.type === "error") {
                    broadcastToSession(sessionCtx, "error", { error: item.message || item.text || "Lỗi phản hồi" });
                  }
                }
              } else if (parsed.type === "toolResponse") {
                const isErr = Boolean(parsed.toolResult?.status === "error" || parsed.toolResult?.value?.isError || parsed.toolResult?.error);
                let outStr = parsed.output || parsed.value || "";
                if (!outStr && parsed.toolResult) {
                  const trVal = parsed.toolResult.value;
                  if (typeof trVal === "object" && trVal !== null) {
                    const stdout = trVal.structuredContent?.stdout;
                    const stderr = trVal.structuredContent?.stderr;
                    if (stdout !== undefined || stderr !== undefined) {
                      outStr = (stdout || "") + (stderr ? ("\n[STDERR]: " + stderr) : "");
                    } else if (Array.isArray(trVal.content) && trVal.content[0]?.text) {
                      outStr = trVal.content.map(c => c.text || "").join("\n");
                    } else {
                      outStr = JSON.stringify(trVal, null, 2);
                    }
                  } else if (trVal !== undefined && trVal !== null) {
                    outStr = String(trVal || "");
                  } else if (parsed.toolResult.error) {
                    outStr = String(parsed.toolResult.error);
                  }
                }
                broadcastToSession(sessionCtx, "tool_result", {
                  output: outStr,
                  id: parsed.id || "",
                  isError: isErr
                });
                if (!isErr && sessionCtx.turnDiffTracker) {
                  try {
                    const liveChanges = syncTurnChanges(sessionCtx.turnDiffTracker, sessionCtx.info?.sessionId || sessionId, { explicitOnly: true, allowWorkspaceScan: false });
                    if (liveChanges.length > 0) {
                      broadcastToSession(sessionCtx, "session_file_diffs", { sessionId: sessionCtx.info?.sessionId || sessionId, files: liveChanges });
                    }
                  } catch {}
                }
              } else if (parsed.type === "error") {
                broadcastToSession(sessionCtx, "error", { error: parsed.error || "Lỗi tiến trình" });
              } else if (parsed.type === "complete") {
                broadcastToSession(sessionCtx, "complete", parsed);
              }
            } catch {
              if (trimmed.toLowerCase().startsWith("error:")) {
                broadcastToSession(sessionCtx, "error", { error: trimmed });
              } else {
                broadcastToSession(sessionCtx, "raw_log", { line: trimmed });
              }
            }
          } else {
            if (trimmed.toLowerCase().startsWith("error:")) {
              broadcastToSession(sessionCtx, "error", { error: trimmed });
            } else {
              broadcastToSession(sessionCtx, "raw_log", { line: trimmed });
            }
          }
        }
      });

      child.stderr.on("data", (chunk) => {
        if (sessionCtx.process !== child) return;
        const text = chunk.toString("utf8").trim();
        console.error(`[GOOSE STDERR] ${text}`);
        if (text) broadcastToSession(sessionCtx, "stderr", { text });
      });

      child.on("close", (code) => {
        if (sessionCtx.process !== child) return;
        console.log(`[GOOSE CLOSE] Exit code: ${code} for session ${sessionId}`);
        try {
          const stored = findStoredSession(sessionId);
          if (stored) {
            sessionId = stored.id;
            sessionCtx.info.sessionId = stored.id;
            if (!resume && isTechnicalSessionName(stored.name)) {
              const renamed = renameSession(sessionId, title);
              if (!renamed.ok) console.error("[SESSION TITLE] " + renamed.error);
            }
          }
        } catch (err) {
          console.error("[SESSION RESOLVE] " + err.message);
        }
        let finalFileChanges = [];
        try {
          finalFileChanges = finalizeTurnSnapshotSync(sessionCtx.turnDiffTracker, sessionCtx.tempName || sessionCtx.sessionId, sessionId);
        } catch (err) {
          console.error("[SESSION DIFF] " + err.message);
        }
        if (sessionCtx.isFinished) return;
        if (finalFileChanges.length > 0) {
          broadcastToSession(sessionCtx, "session_file_diffs", { sessionId, files: finalFileChanges });
        }
        if (code !== 0 && code !== null) {
          broadcastToSession(sessionCtx, "stderr", { text: `Tiến trình kết thúc với mã lỗi: ${code}` });
        }
        sessionCtx.isFinished = true;
        recentlyCompletedSessions.set(sessionCtx.sessionId, sessionCtx);
        if (sessionCtx.tempName) recentlyCompletedSessions.set(sessionCtx.tempName, sessionCtx);
        if (sessionCtx.info?.sessionId) recentlyCompletedSessions.set(sessionCtx.info.sessionId, sessionCtx);
        setTimeout(() => {
          recentlyCompletedSessions.delete(sessionCtx.sessionId);
          if (sessionCtx.tempName) recentlyCompletedSessions.delete(sessionCtx.tempName);
          if (sessionCtx.info?.sessionId) recentlyCompletedSessions.delete(sessionCtx.info.sessionId);
        }, 15000);

        broadcastToSession(sessionCtx, "finish", { exitCode: code, sessionId, session_id: sessionId, sessionFileChanges: finalFileChanges });

        for (const c of sessionCtx.clients) {
          try { c.end(); } catch {}
        }
        sessionCtx.clients.clear();
        activeSessions.delete(sessionCtx.sessionId);
        if (sessionCtx.tempName) activeSessions.delete(sessionCtx.tempName);
        if (sessionCtx.info?.sessionId) activeSessions.delete(sessionCtx.info.sessionId);
        if (activeProcess === child) {
          activeProcess = null;
          activeSessionId = null;
          activeSessionInfo = null;
          activeSessionEvents = [];
        }
        broadcastHubEvent("session_turn_completed", { sessionId, tempName: sessionCtx.tempName || null, exitCode: code });
      });

      child.on("error", (err) => {
        if (sessionCtx.process !== child) return;
        console.error(`[GOOSE ERROR] ${err.message} for session ${sessionId}`);
        sessionCtx.isFinished = true;
        recentlyCompletedSessions.set(sessionCtx.sessionId, sessionCtx);
        if (sessionCtx.tempName) recentlyCompletedSessions.set(sessionCtx.tempName, sessionCtx);
        if (sessionCtx.info?.sessionId) recentlyCompletedSessions.set(sessionCtx.info.sessionId, sessionCtx);
        setTimeout(() => {
          recentlyCompletedSessions.delete(sessionCtx.sessionId);
          if (sessionCtx.tempName) recentlyCompletedSessions.delete(sessionCtx.tempName);
          if (sessionCtx.info?.sessionId) recentlyCompletedSessions.delete(sessionCtx.info.sessionId);
        }, 15000);

        broadcastToSession(sessionCtx, "error", { error: err.message });
        for (const c of sessionCtx.clients) {
          try { c.end(); } catch {}
        }
        sessionCtx.clients.clear();
        activeSessions.delete(sessionCtx.sessionId);
        if (sessionCtx.tempName) activeSessions.delete(sessionCtx.tempName);
        if (sessionCtx.info?.sessionId) activeSessions.delete(sessionCtx.info.sessionId);
        if (activeProcess === child) {
          activeProcess = null;
          activeSessionId = null;
          activeSessionInfo = null;
          activeSessionEvents = [];
        }
        broadcastHubEvent("session_turn_completed", { sessionId, tempName: sessionCtx.tempName || null, error: err.message });
      });
    });
    return;
  }

  // Phuc vu static files (HTML, CSS, JS)
  let filePath = path.join(__dirname, "public", pathname === "/" ? "index.html" : pathname);
  const reqExt = path.extname(pathname).toLowerCase();
  const baseAssetName = path.posix.basename(pathname);
  const isKnownRootIconOrManifest = /^(favicon\.ico|apple-touch-icon.*\.png|icon-.*\.(png|ico)|ai-hub-.*\.(png|ico)|logo.*\.(png|ico|svg)|manifest\.json|site\.webmanifest)$/i.test(baseAssetName);
  if (!fs.existsSync(filePath) && isKnownRootIconOrManifest) {
    const rootAssetCandidate = path.join(__dirname, "public", baseAssetName);
    if (fs.existsSync(rootAssetCandidate)) filePath = rootAssetCandidate;
  }
  const isStaticAssetReq = /^\.(ico|png|svg|webp|jpg|jpeg|gif|webmanifest|css|js|map)$/.test(reqExt) && (pathname.split("/").filter(Boolean).length === 1 || isKnownRootIconOrManifest);
  if (!fs.existsSync(filePath)) {
    if (isStaticAssetReq) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }
    filePath = path.join(__dirname, "public", "index.html");
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg"
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    } else {
      const noCache = (ext === ".html" || ext === ".json" || ext === ".webmanifest");
      res.writeHead(200, {
        "Content-Type": mimeTypes[ext] || "application/octet-stream",
        "Cache-Control": noCache ? "no-cache, must-revalidate" : "public, max-age=86400"
      });
      res.end(content);
    }
  });
});

server.listen(PORT, process.env.AI_HUB_HOST || "127.0.0.1", () => {
  const sys = getSystemInfo();
  console.log("========================================================");
  console.log("       AI AGENT HUB - PRO SERVER DANG CHAY");
  console.log("========================================================");
  console.log(`Local Access     : http://localhost:${PORT}`);
  console.log(`Tailscale Access : http://${sys.tailscaleIp}:${PORT}`);
  console.log(`Router VPS       : http://${sys.vpsHost}/v1`);
  console.log(`Key Status       : ${NINE_ROUTER_KEY ? "Da nap tu moi truong [OK]" : "CHUA CO KEY (Kiem tra start-web.bat) [CANH BAO]"}`);
  console.log("========================================================");
});
