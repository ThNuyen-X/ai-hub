const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const MAX_SNAPSHOT_FILE_BYTES = 384 * 1024;
const MAX_SNAPSHOT_TOTAL_BYTES = 40 * 1024 * 1024;
const MAX_PERSISTED_DIFF_CHARS = 350000;

const SKIP_DIRS = new Set([
  ".git", "node_modules", "target", "dist", "build", ".next", ".nuxt",
  ".cache", ".idea", ".vscode", "bin", "obj", "out", "coverage", "logs",
  "__pycache__", ".gradle", ".mvn", "vendor", ".turbo", ".parcel-cache"
]);

const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".pdf",
  ".zip", ".tar", ".gz", ".7z", ".rar", ".jar", ".war", ".ear", ".class",
  ".exe", ".dll", ".so", ".dylib", ".pyd", ".pyc", ".o", ".a", ".lib",
  ".woff", ".woff2", ".ttf", ".eot", ".mp3", ".mp4", ".avi", ".mov",
  ".db", ".sqlite", ".sqlite3", ".pack", ".idx"
]);

function getSessionDiffDir() {
  return process.env.AI_HUB_SESSION_DIFF_DIR ||
    path.join(process.env.LOCALAPPDATA || process.env.USERPROFILE || ".", "ai-hub", "session-diffs");
}

function sanitizeSessionKey(sessionId) {
  return String(sessionId || "").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getSessionDiffFilePath(sessionId) {
  const key = sanitizeSessionKey(sessionId);
  if (!key) return "";
  return path.join(getSessionDiffDir(), `${key}.json`);
}

function normalizePathKey(rawPath) {
  if (!rawPath || typeof rawPath !== "string") return "";
  let p = rawPath.trim().replace(/^[`"']+|[`"']+$/g, "").trim();
  if (!p) return "";
  p = path.normalize(p).replace(/\\/g, "/");
  if (process.platform === "win32") p = p.toLowerCase();
  return p;
}

function isProbablyBinaryBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return false;
  const checkLen = Math.min(buf.length, 1024);
  for (let i = 0; i < checkLen; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function isTrackableFilePath(filePath) {
  if (!filePath) return false;
  const ext = path.extname(filePath).toLowerCase();
  if (BINARY_EXTS.has(ext)) return false;
  return true;
}

function splitNormalizedLines(text) {
  const norm = String(text ?? "").replace(/\r\n/g, "\n");
  if (norm.length === 0) return [];
  return norm.endsWith("\n") ? norm.slice(0, -1).split("\n") : norm.split("\n");
}

function myersDiffMiddle(midA, midB, maxD = 2500) {
  const N = midA.length;
  const M = midB.length;
  if (N === 0) return midB.map(t => ({ type: "+", text: t }));
  if (M === 0) return midA.map(t => ({ type: "-", text: t }));

  const max = N + M;
  const limit = Math.min(max, maxD);
  const offset = max;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  let foundD = -1;

  for (let d = 0; d <= limit; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < N && y < M && midA[x] === midB[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= N && y >= M) {
        foundD = d;
        break;
      }
    }
    trace.push(v.slice(offset - d, offset + d + 1));
    if (foundD !== -1) break;
  }

  if (foundD === -1) {
    return midA.map(t => ({ type: "-", text: t })).concat(midB.map(t => ({ type: "+", text: t })));
  }

  const ops = [];
  let x = N;
  let y = M;

  for (let d = foundD; d > 0; d--) {
    const k = x - y;
    const prevV = trace[d - 1];
    const prevD = d - 1;
    const prevGet = (kk) => prevV[kk + prevD];

    let prevK;
    if (k === -d || (k !== d && prevGet(k - 1) < prevGet(k + 1))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = prevGet(prevK);
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      ops.push({ type: " ", text: midA[x - 1] });
      x--;
      y--;
    }

    if (prevK === k + 1) {
      ops.push({ type: "+", text: midB[prevY] });
      y--;
    } else {
      ops.push({ type: "-", text: midA[prevX] });
      x--;
    }
  }

  while (x > 0 && y > 0) {
    ops.push({ type: " ", text: midA[x - 1] });
    x--;
    y--;
  }

  ops.reverse();
  return ops;
}

function computeMultiHunkUnifiedDiff(beforeText, afterText, relLabel = "file", contextLines = 3) {
  const safeLabel = String(relLabel || "file").replace(/\\/g, "/").replace(/^\/+/, "") || "file";

  if (beforeText === null && afterText === null) {
    return { status: "unchanged", diff: "", added: 0, removed: 0 };
  }

  if (beforeText === null) {
    const bLines = splitNormalizedLines(afterText);
    if (bLines.length === 0) {
      return {
        status: "added",
        diff: `--- /dev/null\n+++ b/${safeLabel}`,
        added: 0,
        removed: 0
      };
    }
    const header = [
      `--- /dev/null`,
      `+++ b/${safeLabel}`,
      `@@ -0,0 +1,${bLines.length} @@`
    ];
    return {
      status: "added",
      diff: header.concat(bLines.map(l => "+" + l)).join("\n"),
      added: bLines.length,
      removed: 0
    };
  }

  if (afterText === null) {
    const aLines = splitNormalizedLines(beforeText);
    if (aLines.length === 0) {
      return {
        status: "deleted",
        diff: `--- a/${safeLabel}\n+++ /dev/null`,
        added: 0,
        removed: 0
      };
    }
    const header = [
      `--- a/${safeLabel}`,
      `+++ /dev/null`,
      `@@ -1,${aLines.length} +0,0 @@`
    ];
    return {
      status: "deleted",
      diff: header.concat(aLines.map(l => "-" + l)).join("\n"),
      added: 0,
      removed: aLines.length
    };
  }

  const aLines = splitNormalizedLines(beforeText);
  const bLines = splitNormalizedLines(afterText);

  let prefixLen = 0;
  while (prefixLen < aLines.length && prefixLen < bLines.length && aLines[prefixLen] === bLines[prefixLen]) {
    prefixLen++;
  }
  if (prefixLen === aLines.length && prefixLen === bLines.length) {
    return { status: "unchanged", diff: "", added: 0, removed: 0 };
  }

  let endA = aLines.length - 1;
  let endB = bLines.length - 1;
  while (endA >= prefixLen && endB >= prefixLen && aLines[endA] === bLines[endB]) {
    endA--;
    endB--;
  }

  const midA = aLines.slice(prefixLen, endA + 1);
  const midB = bLines.slice(prefixLen, endB + 1);
  const midOps = myersDiffMiddle(midA, midB);

  const preCtxStart = Math.max(0, prefixLen - contextLines);
  const postCtxEnd = Math.min(aLines.length, endA + 1 + contextLines);

  const numberedOps = [];
  let oldNo = preCtxStart + 1;
  let newNo = preCtxStart + 1;

  for (let i = preCtxStart; i < prefixLen; i++) {
    numberedOps.push({ type: " ", text: aLines[i], oldNo: oldNo++, newNo: newNo++ });
  }
  let added = 0;
  let removed = 0;
  for (const op of midOps) {
    if (op.type === "+") {
      added++;
      numberedOps.push({ type: "+", text: op.text, oldNo: oldNo, newNo: newNo++ });
    } else if (op.type === "-") {
      removed++;
      numberedOps.push({ type: "-", text: op.text, oldNo: oldNo++, newNo: newNo });
    } else {
      numberedOps.push({ type: " ", text: op.text, oldNo: oldNo++, newNo: newNo++ });
    }
  }
  for (let i = endA + 1; i < postCtxEnd; i++) {
    numberedOps.push({ type: " ", text: aLines[i], oldNo: oldNo++, newNo: newNo++ });
  }

  const changeIndices = [];
  for (let i = 0; i < numberedOps.length; i++) {
    if (numberedOps[i].type !== " ") changeIndices.push(i);
  }
  if (changeIndices.length === 0) {
    return { status: "unchanged", diff: "", added: 0, removed: 0 };
  }

  const hunks = [];
  let curStart = Math.max(0, changeIndices[0] - contextLines);
  let curEnd = Math.min(numberedOps.length - 1, changeIndices[0] + contextLines);

  for (let c = 1; c < changeIndices.length; c++) {
    const idx = changeIndices[c];
    const nextStart = Math.max(0, idx - contextLines);
    const nextEnd = Math.min(numberedOps.length - 1, idx + contextLines);
    if (nextStart <= curEnd + 1) {
      curEnd = Math.max(curEnd, nextEnd);
    } else {
      hunks.push([curStart, curEnd]);
      curStart = nextStart;
      curEnd = nextEnd;
    }
  }
  hunks.push([curStart, curEnd]);

  const out = [`--- a/${safeLabel}`, `+++ b/${safeLabel}`];
  for (const [hStart, hEnd] of hunks) {
    const slice = numberedOps.slice(hStart, hEnd + 1);
    let oldLen = 0;
    let newLen = 0;
    let firstOld = null;
    let firstNew = null;
    for (const item of slice) {
      if (item.type !== "+") {
        if (firstOld === null) firstOld = item.oldNo;
        oldLen++;
      }
      if (item.type !== "-") {
        if (firstNew === null) firstNew = item.newNo;
        newLen++;
      }
    }
    const oldStart = firstOld !== null ? firstOld : (slice[0] ? Math.max(0, slice[0].oldNo - 1) : 0);
    const newStart = firstNew !== null ? firstNew : (slice[0] ? Math.max(0, slice[0].newNo - 1) : 0);
    out.push(`@@ -${oldStart},${oldLen} +${newStart},${newLen} @@`);
    for (const item of slice) {
      out.push(item.type + item.text);
    }
  }

  let diff = out.join("\n");
  if (diff.length > MAX_PERSISTED_DIFF_CHARS) {
    diff = diff.slice(0, MAX_PERSISTED_DIFF_CHARS);
  }
  return { status: "modified", diff, added, removed };
}

function readTextFileSyncSafe(filePath) {
  try {
    if (!isTrackableFilePath(filePath)) return { trackable: false };
    const st = fs.statSync(filePath);
    if (!st.isFile()) return { trackable: false };
    if (st.size > MAX_SNAPSHOT_FILE_BYTES) {
      return { trackable: false, tooLarge: true, mtimeMs: st.mtimeMs, size: st.size };
    }
    const buf = fs.readFileSync(filePath);
    if (isProbablyBinaryBuffer(buf)) return { trackable: false };
    return {
      trackable: true,
      existed: true,
      mtimeMs: st.mtimeMs,
      size: st.size,
      content: buf.toString("utf8")
    };
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return { trackable: true, existed: false, mtimeMs: 0, size: 0, content: null };
    }
    return { trackable: false };
  }
}

async function scanWorkspacePreTurnAsync(cwd, preFiles, tracker) {
  if (!cwd || !fs.existsSync(cwd)) return false;
  let totalBytes = 0;

  async function walk(dir, depth) {
    if ((tracker && tracker.finalized) || depth > 12 || totalBytes >= MAX_SNAPSHOT_TOTAL_BYTES) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if ((tracker && tracker.finalized) || totalBytes >= MAX_SNAPSHOT_TOTAL_BYTES) break;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await walk(path.join(dir, entry.name), depth + 1);
        }
      } else if (entry.isFile()) {
        const fullPath = path.join(dir, entry.name);
        if (!isTrackableFilePath(fullPath)) continue;
        const key = normalizePathKey(fullPath);
        if (!key || preFiles.has(key)) continue;
        try {
          const st = await fsp.stat(fullPath);
          if (st.size > MAX_SNAPSHOT_FILE_BYTES) continue;
          if (totalBytes + st.size > MAX_SNAPSHOT_TOTAL_BYTES) continue;
          const buf = await fsp.readFile(fullPath);
          if (isProbablyBinaryBuffer(buf)) continue;
          totalBytes += buf.length;
          if (tracker && tracker.finalized) break;
          preFiles.set(key, {
            absPath: fullPath,
            relPath: path.relative(cwd, fullPath).split(path.sep).join("/"),
            existed: true,
            mtimeMs: st.mtimeMs,
            size: st.size,
            content: buf.toString("utf8")
          });
        } catch {}
      }
    }
  }

  await walk(cwd, 0);
  return !(tracker && tracker.finalized);
}

function startTurnSnapshot(cwd) {
  const normCwd = cwd ? path.resolve(cwd) : "";
  const preFiles = new Map();
  const tracker = {
    cwd: normCwd,
    preFiles,
    explicitPaths: new Set(),
    finalized: false,
    isPreScanComplete: false,
    readyPromise: null
  };
  tracker.readyPromise = scanWorkspacePreTurnAsync(normCwd, preFiles, tracker)
    .then((completed) => {
      if (completed && !tracker.finalized) {
        tracker.isPreScanComplete = true;
      }
    })
    .catch(() => {});
  return tracker;
}

function resolveCandidateAgainstCwd(rawPath, cwd) {
  if (!rawPath || typeof rawPath !== "string") return "";
  const cleaned = rawPath.trim().replace(/^[`"']+|[`"']+$/g, "").trim();
  if (!cleaned || cleaned.length > 400 || /[\r\n\0<>|?*]/.test(cleaned)) return "";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(cleaned)) return "";
  if (path.isAbsolute(cleaned)) return path.normalize(cleaned);
  if (cwd) return path.resolve(cwd, cleaned);
  return "";
}

function extractPathsFromToolCall(toolName, args, cwd) {
  if (!args) return [];
  let parsed = args;
  if (typeof args === "string") {
    try { parsed = JSON.parse(args); } catch { parsed = null; }
  }
  if (!parsed || typeof parsed !== "object") return [];

  const out = new Set();
  const addCandidate = (p) => {
    const resolved = resolveCandidateAgainstCwd(p, cwd);
    if (resolved && isTrackableFilePath(resolved)) out.add(resolved);
  };

  for (const field of ["path", "file_path", "filePath", "target_file", "filename"]) {
    if (typeof parsed[field] === "string" && parsed[field].trim()) {
      addCandidate(parsed[field]);
    }
  }

  const patchStr = typeof parsed.patch === "string" ? parsed.patch : (typeof parsed.diff === "string" ? parsed.diff : "");
  if (patchStr) {
    const re1 = /^\*\*\* (?:Update|Add|Delete) File:\s*(.+)$/gm;
    let m;
    while ((m = re1.exec(patchStr)) !== null) addCandidate(m[1]);
    const re2 = /^\+\+\+ b\/(.+)$/gm;
    while ((m = re2.exec(patchStr)) !== null) addCandidate(m[1]);
  }

  if (typeof parsed.command === "string" && parsed.command.trim()) {
    const cmd = parsed.command;
    const tokenRe = /(?:["'])([a-zA-Z]:[\\\/][^"'<>|?*\r\n]+|(?:[\w.\-]+[\\\/])+[\w.\-]+\.[a-zA-Z0-9]{1,10}|[\w.\-]+\.(?:js|cjs|mjs|ts|jsx|tsx|json|html|css|scss|java|jsp|py|sql|xml|yml|yaml|properties|md|txt|bat|ps1|sh|cs|go|rs|cpp|c|h))(?:["'])|(?:^|\s)((?:[a-zA-Z]:[\\\/]|(?:\.{1,2}[\\\/])?(?:[\w.\-]+[\\\/])*)[\w.\-]+\.(?:js|cjs|mjs|ts|jsx|tsx|json|html|css|scss|java|jsp|py|sql|xml|yml|yaml|properties|md|txt|bat|ps1|sh|cs|go|rs|cpp|c|h))(?=\s|$|[;&|)])/g;
    let tm;
    while ((tm = tokenRe.exec(cmd)) !== null) {
      addCandidate(tm[1] || tm[2]);
    }
  }

  return Array.from(out);
}

function loadSessionDiffStore(sessionId) {
  const filePath = getSessionDiffFilePath(sessionId);
  if (!filePath || !fs.existsSync(filePath)) {
    return { sessionId, workspace: "", updatedAt: 0, files: {} };
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!data || typeof data !== "object") return { sessionId, workspace: "", updatedAt: 0, files: {} };
    if (!data.files || typeof data.files !== "object") data.files = {};
    return data;
  } catch {
    return { sessionId, workspace: "", updatedAt: 0, files: {} };
  }
}

function saveSessionDiffStore(sessionId, store) {
  const filePath = getSessionDiffFilePath(sessionId);
  if (!filePath) return;
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    store.sessionId = sessionId;
    store.updatedAt = Date.now();
    fs.writeFileSync(filePath, JSON.stringify(store), "utf8");
  } catch {}
}

function migrateSessionDiffStore(oldSessionId, newSessionId) {
  if (!oldSessionId || !newSessionId || oldSessionId === newSessionId) return;
  const oldPath = getSessionDiffFilePath(oldSessionId);
  const newPath = getSessionDiffFilePath(newSessionId);
  if (!oldPath || !newPath || oldPath === newPath || !fs.existsSync(oldPath)) return;
  try {
    if (!fs.existsSync(newPath)) {
      fs.mkdirSync(path.dirname(newPath), { recursive: true });
      fs.renameSync(oldPath, newPath);
      const migrated = loadSessionDiffStore(newSessionId);
      migrated.sessionId = newSessionId;
      saveSessionDiffStore(newSessionId, migrated);
      return;
    }
    const oldStore = loadSessionDiffStore(oldSessionId);
    const newStore = loadSessionDiffStore(newSessionId);
    newStore.workspace = newStore.workspace || oldStore.workspace || "";
    for (const [k, entry] of Object.entries(oldStore.files || {})) {
      if (!newStore.files[k]) {
        newStore.files[k] = entry;
      }
    }
    saveSessionDiffStore(newSessionId, newStore);
    try { fs.unlinkSync(oldPath); } catch {}
  } catch {}
}

function deleteSessionDiffStore(sessionId) {
  const filePath = getSessionDiffFilePath(sessionId);
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

function captureExplicitToolPaths(tracker, sessionId, toolName, args, cwd) {
  if (!tracker || tracker.finalized) return;
  const baseCwd = cwd || tracker.cwd || "";
  const candidates = extractPathsFromToolCall(toolName, args, baseCwd);
  if (candidates.length === 0) return;

  const store = sessionId ? loadSessionDiffStore(sessionId) : null;
  for (const absPath of candidates) {
    tracker.explicitPaths.add(absPath);
    const key = normalizePathKey(absPath);
    if (!key || tracker.preFiles.has(key)) continue;
    if (store && store.files && store.files[key]) continue;
    const snap = readTextFileSyncSafe(absPath);
    if (snap.trackable) {
      const relPath = baseCwd && absPath.toLowerCase().startsWith(baseCwd.toLowerCase())
        ? path.relative(baseCwd, absPath).split(path.sep).join("/")
        : path.basename(absPath);
      tracker.preFiles.set(key, {
        absPath,
        relPath,
        existed: snap.existed,
        mtimeMs: snap.mtimeMs,
        size: snap.size,
        content: snap.content
      });
    }
  }
}

function collectCurrentWorkspaceStatsSync(cwd, outMap) {
  if (!cwd || !fs.existsSync(cwd)) return;
  function walk(dir, depth) {
    if (depth > 12) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          walk(path.join(dir, entry.name), depth + 1);
        }
      } else if (entry.isFile()) {
        const fullPath = path.join(dir, entry.name);
        if (!isTrackableFilePath(fullPath)) continue;
        try {
          const st = fs.statSync(fullPath);
          if (st.size > MAX_SNAPSHOT_FILE_BYTES) continue;
          const key = normalizePathKey(fullPath);
          if (key) {
            outMap.set(key, {
              absPath: fullPath,
              relPath: path.relative(cwd, fullPath).split(path.sep).join("/"),
              mtimeMs: st.mtimeMs,
              size: st.size
            });
          }
        } catch {}
      }
    }
  }
  walk(cwd, 0);
}

function evaluateCandidateFile(key, absPath, relLabel, preEntry, store) {
  const existingRecord = store.files[key] || null;
  const baselineExisted = existingRecord
    ? Boolean(existingRecord.baselineExisted)
    : (preEntry ? Boolean(preEntry.existed) : false);
  const baselineContent = existingRecord
    ? (existingRecord.baselineExisted ? String(existingRecord.baselineContent ?? "") : null)
    : (preEntry && preEntry.existed ? String(preEntry.content ?? "") : null);

  const cur = readTextFileSyncSafe(absPath);
  if (!cur.trackable) return false;

  const afterContent = cur.existed ? String(cur.content ?? "") : null;
  if (!baselineExisted && !cur.existed) {
    if (existingRecord) {
      delete store.files[key];
      return true;
    }
    return false;
  }

  const label = relLabel || (existingRecord && existingRecord.relPath) || path.basename(absPath);
  const diffResult = computeMultiHunkUnifiedDiff(
    baselineExisted ? baselineContent : null,
    afterContent,
    label,
    3
  );

  if (diffResult.status === "unchanged") {
    if (existingRecord) {
      delete store.files[key];
      return true;
    }
    return false;
  }

  store.files[key] = {
    path: absPath,
    relPath: label.replace(/\\/g, "/"),
    name: path.basename(absPath),
    baselineExisted,
    baselineContent: baselineExisted ? baselineContent : null,
    status: diffResult.status,
    added: diffResult.added,
    removed: diffResult.removed,
    diff: diffResult.diff,
    updatedAt: Date.now()
  };
  return true;
}

function syncTurnChanges(tracker, sessionId, options = {}) {
  if (!tracker || !sessionId) return [];
  const explicitOnly = Boolean(options.explicitOnly);
  const allowWorkspaceScan = options.allowWorkspaceScan !== false;

  const store = loadSessionDiffStore(sessionId);
  if (tracker.cwd && !store.workspace) store.workspace = tracker.cwd;
  let dirty = false;

  const checkedKeys = new Set();
  const checkAbsPath = (absPath, fallbackRel = "") => {
    const key = normalizePathKey(absPath);
    if (!key || checkedKeys.has(key)) return;
    checkedKeys.add(key);
    const preEntry = tracker.preFiles.get(key) || null;
    const relLabel = (preEntry && preEntry.relPath) ||
      fallbackRel ||
      (tracker.cwd && absPath.toLowerCase().startsWith(tracker.cwd.toLowerCase())
        ? path.relative(tracker.cwd, absPath).split(path.sep).join("/")
        : path.basename(absPath));
    if (evaluateCandidateFile(key, absPath, relLabel, preEntry, store)) {
      dirty = true;
    }
  };

  for (const absPath of tracker.explicitPaths) {
    checkAbsPath(absPath);
  }

  for (const [key, entry] of Object.entries(store.files)) {
    if (entry && entry.path && !checkedKeys.has(key)) {
      checkAbsPath(entry.path, entry.relPath || "");
    }
  }

  if (!explicitOnly && allowWorkspaceScan && tracker.cwd) {
    const curStats = new Map();
    collectCurrentWorkspaceStatsSync(tracker.cwd, curStats);

    for (const [key, cur] of curStats.entries()) {
      if (checkedKeys.has(key)) continue;
      const pre = tracker.preFiles.get(key);
      if (!pre) {
        checkedKeys.add(key);
        if (evaluateCandidateFile(key, cur.absPath, cur.relPath, { existed: false, content: null }, store)) {
          dirty = true;
        }
      } else if (pre.size !== cur.size || Math.abs(pre.mtimeMs - cur.mtimeMs) > 1) {
        checkedKeys.add(key);
        if (evaluateCandidateFile(key, cur.absPath, cur.relPath, pre, store)) {
          dirty = true;
        }
      }
    }

    for (const [key, pre] of tracker.preFiles.entries()) {
      if (checkedKeys.has(key)) continue;
      if (!pre.existed) continue;
      const insideCwd = tracker.cwd && pre.absPath.toLowerCase().startsWith(tracker.cwd.toLowerCase());
      if (insideCwd && !curStats.has(key)) {
        checkedKeys.add(key);
        if (evaluateCandidateFile(key, pre.absPath, pre.relPath, pre, store)) {
          dirty = true;
        }
      } else if (!insideCwd && !fs.existsSync(pre.absPath)) {
        checkedKeys.add(key);
        if (evaluateCandidateFile(key, pre.absPath, pre.relPath, pre, store)) {
          dirty = true;
        }
      }
    }
  }

  if (dirty) {
    saveSessionDiffStore(sessionId, store);
  }
  return formatStoreEntries(store);
}

function formatStoreEntries(store) {
  if (!store || !store.files) return [];
  return Object.values(store.files)
    .filter(e => e && e.path && e.status && e.status !== "unchanged")
    .map(e => ({
      success: true,
      inSession: true,
      source: "session",
      hasChanges: true,
      name: e.name || path.basename(e.path),
      path: e.path,
      relPath: e.relPath || path.basename(e.path),
      status: e.status,
      added: Number(e.added) || 0,
      removed: Number(e.removed) || 0,
      diff: e.diff || "",
      updatedAt: e.updatedAt || store.updatedAt || 0
    }));
}

function finalizeTurnSnapshotSync(tracker, sessionId, finalSessionId, options = {}) {
  const targetId = finalSessionId || sessionId;
  if (sessionId && finalSessionId && sessionId !== finalSessionId) {
    migrateSessionDiffStore(sessionId, finalSessionId);
  }
  if (!tracker || tracker.finalized) {
    return targetId ? getSessionFileChangesSummary(targetId) : [];
  }
  const canScanWorkspace = Boolean(tracker.isPreScanComplete) && options.allowWorkspaceScan !== false;
  const summary = syncTurnChanges(tracker, targetId, {
    explicitOnly: !canScanWorkspace,
    allowWorkspaceScan: canScanWorkspace
  });
  tracker.finalized = true;
  tracker.preFiles.clear();
  tracker.explicitPaths.clear();
  return summary;
}

async function finalizeTurnSnapshot(tracker, sessionId, finalSessionId, options = {}) {
  if (tracker && !tracker.finalized && tracker.readyPromise) {
    try {
      await tracker.readyPromise;
    } catch {}
  }
  return finalizeTurnSnapshotSync(tracker, sessionId, finalSessionId, options);
}

function getSessionFileChangesSummary(sessionId) {
  if (!sessionId) return [];
  const store = loadSessionDiffStore(sessionId);
  return formatStoreEntries(store);
}

function getSessionSingleFileDiff(sessionId, targetPath, workspace) {
  const resolved = resolveCandidateAgainstCwd(targetPath, workspace) || targetPath;
  const normTarget = normalizePathKey(resolved);
  const normRaw = normalizePathKey(targetPath).replace(/^\.\//, "");
  const existsNow = Boolean(resolved && fs.existsSync(resolved));
  const baseName = path.basename(resolved || targetPath || "file");

  if (!sessionId) {
    return {
      success: true,
      inSession: false,
      source: "session",
      name: baseName,
      path: resolved,
      exists: existsNow,
      hasChanges: false,
      status: "unchanged",
      added: 0,
      removed: 0,
      diff: ""
    };
  }

  const store = loadSessionDiffStore(sessionId);
  let matched = (normTarget && store.files[normTarget]) ? store.files[normTarget] : null;
  if (!matched && normRaw) {
    for (const [k, entry] of Object.entries(store.files)) {
      const relKey = normalizePathKey(entry.relPath || "");
      if (relKey === normRaw || k.endsWith("/" + normRaw) || (relKey && normRaw.endsWith("/" + relKey))) {
        matched = entry;
        break;
      }
    }
  }

  if (!matched) {
    return {
      success: true,
      inSession: false,
      source: "session",
      name: baseName,
      path: resolved,
      exists: existsNow,
      hasChanges: false,
      status: "unchanged",
      added: 0,
      removed: 0,
      diff: ""
    };
  }

  return {
    success: true,
    inSession: true,
    source: "session",
    name: matched.name || baseName,
    path: matched.path || resolved,
    relPath: matched.relPath || baseName,
    exists: existsNow,
    hasChanges: true,
    status: matched.status,
    added: Number(matched.added) || 0,
    removed: Number(matched.removed) || 0,
    diff: matched.diff || ""
  };
}

module.exports = {
  computeMultiHunkUnifiedDiff,
  startTurnSnapshot,
  captureExplicitToolPaths,
  syncTurnChanges,
  finalizeTurnSnapshotSync,
  finalizeTurnSnapshot,
  migrateSessionDiffStore,
  deleteSessionDiffStore,
  getSessionFileChangesSummary,
  getSessionSingleFileDiff
};
