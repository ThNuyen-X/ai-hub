// ========================================================
// AI AGENT HUB - PRO SERVER (MINIMALIST & FAST)
// ========================================================
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { isTechnicalSessionName, sessionTitle, titleFromContent } = require("./session-title.cjs");
const { cleanWorkspacePath, workspaceKey } = require("./workspace-path.cjs");

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

let activeProcess = null;
let activeSessionId = null;
let activeSessionInfo = null; // { model, cwd, sessionId, prompt, startTime }
let activeSessionEvents = []; // [ { event, payload } ]
const activeClients = new Set(); // Set<http.ServerResponse>

function broadcastSSE(event, payload) {
  const p = (typeof payload === "object" && payload !== null) ? { type: event, ...payload } : { type: event, value: payload };
  if (event === "tool_call" && p.name && !p.tool) p.tool = p.name;
  activeSessionEvents.push({ event, payload: p });
  if (activeSessionEvents.length > 1000) activeSessionEvents.shift();
  const chunk = `event: ${event}\ndata: ${JSON.stringify(p)}\n\n`;
  for (const client of activeClients) {
    try {
      client.write(chunk);
    } catch {}
  }
}

function attachClientToActiveSession(res, sessionId) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  });
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  activeClients.add(res);

  if (activeSessionInfo) {
    res.write(`event: session_info\ndata: ${JSON.stringify(activeSessionInfo)}\n\n`);
  }

  for (const item of activeSessionEvents) {
    res.write(`event: ${item.event}\ndata: ${JSON.stringify(item.payload)}\n\n`);
  }

  res.on("close", () => {
    activeClients.delete(res);
    console.log(`[CLIENT DETACHED] Client tab disconnected (F5/close). Active clients: ${activeClients.size}. Task continues in background.`);
  });
}

// Cac model co san tren 9Router
const AVAILABLE_MODELS = [
  { id: "cx/gpt-6.1-sol", name: "Codex", full: "cx/gpt-6.1-sol", provider: "OpenAI", tag: "Code chuẩn, tư duy sâu", iconType: "openai" },
  { id: "ag/gemini-3.8-flash-high", name: "Gemini 3.8 Flash", full: "ag/gemini-3.8-flash-high", provider: "Google", tag: "Tốc độ cao, ngữ cảnh lớn", iconType: "gemini" },
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
  try {
    const dbPath = path.join(process.env.APPDATA, "Block", "goose", "data", "sessions", "sessions.db");
    if (!fs.existsSync(dbPath)) return { ok: false, error: "Không tìm thấy CSDL sessions.db" };
    const db = new DatabaseSync(dbPath);

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

    // Neu phien nay dang chay, dung tien trinh
    if (activeProcess && (activeSessionId === sessionId || activeSessionId === realId)) {
      try { process.kill(activeProcess.pid); } catch {}
      activeProcess = null;
      activeSessionId = null;
      activeSessionInfo = null;
      activeSessionEvents = [];
    }

    return { ok: true, id: realId };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function renameSession(sessionId, newName) {
  try {
    const dbPath = path.join(process.env.APPDATA, "Block", "goose", "data", "sessions", "sessions.db");
    if (!fs.existsSync(dbPath)) return { ok: false, error: "Không tìm thấy CSDL sessions.db" };
    const db = new DatabaseSync(dbPath);

    let realId = sessionId;
    const findStmt = db.prepare("SELECT id FROM sessions WHERE id = ? OR name = ?");
    const found = findStmt.get(sessionId, sessionId);
    if (found && found.id) {
      realId = found.id;
    }

    db.prepare("UPDATE sessions SET name = ?, user_set_name = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(newName, realId);
    db.close();
    return { ok: true, id: realId, name: newName };
  } catch (err) {
    console.error("Lỗi đổi tên phiên:", err);
    return { ok: false, error: err.message };
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
    if (activeProcess && activeSessionInfo?.cwd && normalize(activeSessionInfo.cwd) === target) {
      throw new Error("Workspace đang chạy tác vụ. Vui lòng dừng tác vụ trước khi xóa.");
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
      return rows.map(({ first_prompt, ...session }) => ({
        ...session,
        cwd: cleanWorkspacePath(session.cwd),
        name: isTechnicalSessionName(session.name) ? titleFromContent(first_prompt) : session.name,
        date: session.updated_at
      }));
    } catch (err) {
      console.error("[SESSION TITLES] " + err.message);
    } finally {
      if (db) db.close();
    }
  }
  try {
    const out = execSync(`"${GOOSE_PATH}" session list`, { encoding: "utf8", timeout: 4000 });
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

function getSessionDetail(sessionId) {
  try {
    let out = '';
    try {
      out = execSync(`"${GOOSE_PATH}" session export --session-id "${sessionId}" --format json`, {
        encoding: "utf8",
        timeout: 6000,
        maxBuffer: 50 * 1024 * 1024
      });
    } catch {
      // Neu sessionId la session name (vi du session_17933...), tim internal ID tu session list
      const list = getSessionsList();
      const match = list.find(s => s.name === sessionId || s.id === sessionId);
      if (match && match.id && match.id !== sessionId) {
        out = execSync(`"${GOOSE_PATH}" session export --session-id "${match.id}" --format json`, {
          encoding: "utf8",
          timeout: 6000,
          maxBuffer: 50 * 1024 * 1024
        });
      }
    }
    return JSON.parse(out);
  } catch (err) {
    return { error: err.message };
  }
}

function getSystemInfo() {
  let tailscaleIp = process.env.AI_HUB_TAILSCALE_IP || "127.0.0.1";
  try {
    tailscaleIp = execSync("tailscale ip -4", { encoding: "utf8", timeout: 2000 }).trim();
  } catch {}
  return {
    tailscaleIp,
    vpsHost: `${NINE_ROUTER_IP}:${NINE_ROUTER_PORT}`,
    endpoint: `http://${NINE_ROUTER_IP}:${NINE_ROUTER_PORT}/v1`,
    models: AVAILABLE_MODELS,
    workspaces: getSavedWorkspaces(),
    drives: getAvailableDrives(),
    gooseFound: fs.existsSync(GOOSE_PATH),
    activeSessionId,
    activeSessionInfo,
    isBusy: !!activeProcess
  };
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
    const list = getSessionsList().map(s => ({
      ...s,
      isRunning: (activeSessionId && (s.id === activeSessionId || s.name === activeSessionId))
    }));
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
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(getSessionDetail(id)));
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

        targetPath = targetPath.replace(/^[`"']+|[`"']+$/g, "").trim();

        let resolved = targetPath;
        if (!path.isAbsolute(resolved)) {
          if (workspace && fs.existsSync(workspace)) {
            resolved = path.resolve(workspace, targetPath);
          } else {
            resolved = path.resolve(process.cwd(), targetPath);
          }
        }

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

      targetPath = targetPath.replace(/^[`"']+|[`"']+$/g, "").trim();

      let resolved = targetPath;
      if (!path.isAbsolute(resolved)) {
        if (workspace && fs.existsSync(workspace)) {
          resolved = path.resolve(workspace, targetPath);
        } else {
          resolved = path.resolve(process.cwd(), targetPath);
        }
      }

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
        const { id } = JSON.parse(body);
        if (!id) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Thiếu mã phiên" }));
          return;
        }
        const result = deleteSession(id);
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
        const { id, name } = JSON.parse(body);
        if (!id || !name || !name.trim()) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "Vui lòng nhập tên mới hợp lệ" }));
          return;
        }
        const result = renameSession(id, name.trim());
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
    if (activeProcess) {
      console.log(`[STOP] User explicitly stopped task for session ${activeSessionId} (PID: ${activeProcess.pid})`);
      try {
        process.kill(activeProcess.pid);
      } catch {}
      broadcastSSE("stderr", { text: "Tiến trình đã được dừng bởi người dùng." });
      broadcastSSE("finish", { exitCode: -1, sessionId: activeSessionId, session_id: activeSessionId });
      for (const c of activeClients) {
        try { c.end(); } catch {}
      }
      activeClients.clear();
      activeProcess = null;
      activeSessionId = null;
      activeSessionInfo = null;
      activeSessionEvents = [];
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, message: "Đã dừng tác vụ" }));
    return;
  }

  // API: Tai ket noi luong SSE (vi du khi nguoi dung F5 / mo lai tab)
  if (req.method === "GET" && pathname === "/api/chat/stream") {
    const sId = urlObj.searchParams.get("sessionId");
    if (activeProcess && activeSessionId && (!sId || sId === activeSessionId)) {
      console.log(`[RECONNECT] Client reconnected to active session ${activeSessionId}`);
      attachClientToActiveSession(res, activeSessionId);
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Không có tác vụ đang chạy cho phiên này" }));
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
      const model = data.model || "cx/gpt-6.1-sol";
      const rawCwd = data.cwd || data.workspace;
      const cwd = (rawCwd && fs.existsSync(rawCwd)) ? rawCwd : ((process.env.AI_HUB_DEFAULT_WORKSPACE && fs.existsSync(process.env.AI_HUB_DEFAULT_WORKSPACE)) ? process.env.AI_HUB_DEFAULT_WORKSPACE : process.cwd());
      let sessionId = data.sessionId || `session_${Date.now()}`;
      let storedSession;
      try {
        storedSession = data.sessionId ? findStoredSession(data.sessionId) : null;
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Cannot load conversation: " + err.message }));
        return;
      }
      const resume = !!storedSession;
      if (storedSession) sessionId = storedSession.id;
      // Never silently start a blank conversation when a previous session is missing.
      if (data.sessionId && !resume && !(activeProcess && activeSessionId === sessionId)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Conversation not found. Please select an existing session or start a new chat." }));
        return;
      }

      // Neu phien nay dang chay san -> gan client vao nghe tiep thay vi chay de
      if (activeProcess && activeSessionId === sessionId) {
        console.log(`[ATTACH] Client re-attached to existing running session ${sessionId}`);
        attachClientToActiveSession(res, sessionId);
        return;
      }

      // Neu co phien khac dang chay -> dung phien cu truoc khi chay moi
      if (activeProcess) {
        console.log(`[REPLACE] Terminating previous process ${activeProcess.pid} for session ${activeSessionId} to start ${sessionId}`);
        try { process.kill(activeProcess.pid); } catch {}
        activeProcess = null;
        for (const c of activeClients) {
          try { c.end(); } catch {}
        }
        activeClients.clear();
      }

      if (!prompt.trim()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Vui lòng nhập nội dung tin nhắn" }));
        return;
      }

      console.log(`[CHAT] Prompt: "${prompt.substring(0, 50)}" | Model: ${model} | CWD: ${cwd} | Session: ${sessionId} | Resume: ${resume}`);
      saveWorkspace(cwd);

      activeSessionId = sessionId;
      const existingTitle = storedSession && (isTechnicalSessionName(storedSession.name)
        ? getSessionsList().find(s => s.id === storedSession.id)?.name : storedSession.name);
      const title = existingTitle || sessionTitle(data.titlePrompt || prompt);
      activeSessionInfo = { model, cwd, sessionId, prompt, title, startTime: Date.now() };
      activeSessionEvents = [];
      activeClients.clear();

      // Thiet lap Server-Sent Events (SSE) cho client hien tai
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      });
      if (typeof res.flushHeaders === "function") res.flushHeaders();
      activeClients.add(res);

      res.on("close", () => {
        activeClients.delete(res);
        console.log(`[CLIENT DETACHED] Client disconnected from session ${sessionId}. Task PID ${child.pid} continues running in background.`);
      });

      broadcastSSE("session_title", { title });
      broadcastSSE("status", { status: "starting", model, cwd, sessionId, session_id: sessionId, text: "Đang kết nối Agent..." });

      const env = {
        ...process.env,
        OPENAI_API_KEY: NINE_ROUTER_KEY,
        OPENAI_HOST: `http://${NINE_ROUTER_IP}:${NINE_ROUTER_PORT}`,
        OPENAI_BASE_URL: `http://${NINE_ROUTER_IP}:${NINE_ROUTER_PORT}/v1`,
        OPENAI_API_BASE: `http://${NINE_ROUTER_IP}:${NINE_ROUTER_PORT}/v1`,
        GOOSE_PROVIDER: "openai",
        GOOSE_MODEL: model,
        GOOSE_CLI_MIN_PRIORITY: "0.8",
        GOOSE_SHOW_FULL_OUTPUT: "false"
      };

      const systemInstruction = 
        "QUY TẮC BẮT BUỘC:\n" +
        "- Trước khi gọi lệnh shell quan trọng (build, deploy, sửa file lớn, tác động hệ thống), BẮT BUỘC viết 1 câu siêu ngắn (dưới 15 từ) thông báo mục đích cho người dùng trước khi gọi tool.\n" +
        "- Với các thao tác đọc nhẹ (ls, cat, grep nhỏ), hãy gọi thẳng lệnh để tối ưu tốc độ phản hồi.";

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
      const child = spawn(GOOSE_PATH, args, { cwd, env });
      activeProcess = child;

      let buffer = "";

      child.stdout.on("data", (chunk) => {
        if (activeProcess !== child) return;
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
                    broadcastSSE("text", { text: textVal });
                  } else if (item.type === "toolRequest" && item.toolCall) {
                    broadcastSSE("tool_call", {
                      name: item.toolCall.value?.name || "tool",
                      args: item.toolCall.value?.arguments || {}
                    });
                  } else if (item.type === "toolResponse") {
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
                      } else {
                        outStr = String(trVal || "");
                      }
                    }
                    broadcastSSE("tool_result", {
                      output: outStr,
                      id: item.id || ""
                    });
                  } else if (item.type === "error") {
                    broadcastSSE("error", { error: item.message || item.text || "Lỗi phản hồi" });
                  }
                }
              } else if (parsed.type === "toolResponse") {
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
                  } else {
                    outStr = String(trVal || "");
                  }
                }
                broadcastSSE("tool_result", {
                  output: outStr,
                  id: parsed.id || ""
                });
              } else if (parsed.type === "error") {
                broadcastSSE("error", { error: parsed.error || "Lỗi tiến trình" });
              } else if (parsed.type === "complete") {
                broadcastSSE("complete", parsed);
              }
            } catch {
              if (trimmed.toLowerCase().startsWith("error:")) {
                broadcastSSE("error", { error: trimmed });
              } else {
                broadcastSSE("raw_log", { line: trimmed });
              }
            }
          } else {
            if (trimmed.toLowerCase().startsWith("error:")) {
              broadcastSSE("error", { error: trimmed });
            } else {
              // stream-json answers come from message events; plain stdout is CLI diagnostics.
              broadcastSSE("raw_log", { line: trimmed });
            }
          }
        }
      });

      child.stderr.on("data", (chunk) => {
        if (activeProcess !== child) return;
        const text = chunk.toString("utf8").trim();
        console.error(`[GOOSE STDERR] ${text}`);
        if (text) broadcastSSE("stderr", { text });
      });

      child.on("close", (code) => {
        // A replaced process must not finish or clear the next running turn.
        if (activeProcess !== child) return;
        console.log(`[GOOSE CLOSE] Exit code: ${code}`);
        try {
          const stored = findStoredSession(sessionId);
          if (stored) {
            sessionId = stored.id;
            if (!resume && isTechnicalSessionName(stored.name)) {
              const renamed = renameSession(sessionId, title);
              if (!renamed.ok) console.error("[SESSION TITLE] " + renamed.error);
            }
          }
        } catch (err) {
          console.error("[SESSION RESOLVE] " + err.message);
        }
        if (code !== 0 && code !== null) {
          broadcastSSE("stderr", { text: `Tiến trình kết thúc với mã lỗi: ${code}` });
        }
        broadcastSSE("finish", { exitCode: code, sessionId, session_id: sessionId });

        for (const c of activeClients) {
          try { c.end(); } catch {}
        }
        activeClients.clear();
        activeProcess = null;
        activeSessionId = null;
        activeSessionInfo = null;
      });

      child.on("error", (err) => {
        if (activeProcess !== child) return;
        console.error(`[GOOSE ERROR] ${err.message}`);
        broadcastSSE("error", { error: err.message });
        for (const c of activeClients) {
          try { c.end(); } catch {}
        }
        activeClients.clear();
        activeProcess = null;
        activeSessionId = null;
        activeSessionInfo = null;
      });
    });
    return;
  }

  // Phuc vu static files (HTML, CSS, JS)
  let filePath = path.join(__dirname, "public", pathname === "/" ? "index.html" : pathname);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, "public", "index.html");
  }

  const ext = path.extname(filePath);
  const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml"
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    } else {
      res.writeHead(200, { "Content-Type": mimeTypes[ext] || "text/plain" });
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
