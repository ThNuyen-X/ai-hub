// ==============================================================================
// AI HUB REMOTE CONTROLLER DAEMON (ANDROID PWA + UPTIME ALERT + POWER SCHEDULER)
// Lightweight & Resilient Remote Control Service for Windows & Tailscale
// ==============================================================================
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const { spawn, exec, execSync } = require("node:child_process");

const PORT = parseInt(process.env.AI_REMOTE_PORT || "20139", 10);
const HOST = process.env.AI_REMOTE_HOST || "0.0.0.0";
const AI_HUB_DIR = "D:\\ai-hub";
const AI_HUB_WEB_DIR = path.join(AI_HUB_DIR, "ai-hub-web");
const START_WEB_BAT = path.join(AI_HUB_DIR, "start-web.bat");
const WORKSPACES_JSON = path.join(AI_HUB_WEB_DIR, "workspaces.json");
const SCREEN_OFF_EXE = path.join(__dirname, "screen-off.exe");
const PUBLIC_DIR = path.join(__dirname, "public");
const CONFIG_FILE = path.join(__dirname, "remote-config.json");

// ==============================================================================
// CONFIGURATION & PERSISTENT STATE
// ==============================================================================
const DEFAULT_CONFIG = {
  uptimeAlert: {
    enabled: true,
    thresholdMinutes: 180,     // Cảnh báo khi máy hoạt động liên tục >= 3 giờ (180 phút)
    autoShutdownMinutes: 0,    // 0 = chỉ thông báo, >0 = tự tắt máy khi đạt ngưỡng này
    snoozeUntil: 0,
    lastAutoShutdownBootId: 0
  },
  schedule: {
    countdownActive: false,
    countdownTargetAt: 0,
    countdownDurationMin: 0,
    countdownAction: "shutdown", // "shutdown" | "restart" | "screen-off" | "lock"
    dailyEnabled: false,
    dailyTime: "23:30",          // HH:MM
    dailyRepeat: "daily",        // "daily" | "once"
    dailyAction: "shutdown",     // "shutdown" | "restart"
    lastTriggeredDate: "",
    waitAiIdle: true             // Đợi phiên AI chạy xong mới tắt máy
  },

};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      const merged = {
        uptimeAlert: Object.assign({}, DEFAULT_CONFIG.uptimeAlert, raw.uptimeAlert || {}),
        schedule: Object.assign({}, DEFAULT_CONFIG.schedule, raw.schedule || {})
      };
      // Nếu hẹn giờ đếm ngược cũ đã quá hạn khi máy tắt trước đó thì dọn sạch
      if (merged.schedule.countdownActive && merged.schedule.countdownTargetAt < Date.now() - 60000) {
        merged.schedule.countdownActive = false;
        merged.schedule.countdownTargetAt = 0;
      }
      return merged;
    }
  } catch (err) {
    console.warn("[CONFIG LOAD WARN]", err.message);
  }
  const initial = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  saveConfig(initial);
  return initial;
}

function saveConfig(cfg = remoteConfig) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
  } catch (err) {
    console.error("[CONFIG SAVE ERROR]", err.message);
  }
}

let remoteConfig = loadConfig();

// State management
let shutdownState = {
  active: false,
  type: null, // "shutdown" | "restart"
  secondsLeft: 0,
  timerId: null
};

let waitingForAiIdleReason = null;
let cachedTailscaleIp = { value: null, lastChecked: 0 };
let cachedBattery = { value: null, lastChecked: 0 };
let cachedAiHubStatus = { value: null, lastChecked: 0 };
let cachedAiHubEnv = null;
let activePromptJob = null;

function formatDurationVi(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const parts = [];
  if (days > 0) parts.push(`${days} ngày`);
  if (hours > 0) parts.push(`${hours} giờ`);
  if (mins > 0 || parts.length === 0) parts.push(`${mins} phút`);
  return parts.join(" ");
}

function getTodayDateString(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ==============================================================================
// SYSTEM & AI HUB HELPERS
// ==============================================================================
function getTailscaleIp() {
  const now = Date.now();
  if (cachedTailscaleIp.value && now - cachedTailscaleIp.lastChecked < 60000) {
    return cachedTailscaleIp.value;
  }
  const nets = os.networkInterfaces();
  let lanFallback = null;
  for (const name of Object.keys(nets)) {
    for (const netInfo of nets[name]) {
      if (netInfo.family === "IPv4" && !netInfo.internal) {
        if (netInfo.address.startsWith("100.")) {
          cachedTailscaleIp = { value: netInfo.address, lastChecked: now };
          return netInfo.address;
        }
        if (!lanFallback) lanFallback = netInfo.address;
      }
    }
  }
  cachedTailscaleIp = { value: lanFallback || "127.0.0.1", lastChecked: now };
  return cachedTailscaleIp.value;
}

function getBatteryInfo(callback) {
  const now = Date.now();
  if (cachedBattery.value !== null && now - cachedBattery.lastChecked < 30000) {
    return callback(cachedBattery.value);
  }
  const cmd = `powershell -NoProfile -NonInteractive -Command "$b = Get-CimInstance Win32_Battery; if ($b) { [PSCustomObject]@{Percent=$b.EstimatedChargeRemaining; Status=$b.BatteryStatus} | ConvertTo-Json -Compress } else { '{}' }"`;
  exec(cmd, { timeout: 3000 }, (err, stdout) => {
    let result = { percent: 100, isCharging: true };
    if (!err && stdout.trim()) {
      try {
        const parsed = JSON.parse(stdout.trim());
        if (typeof parsed.Percent === "number") {
          result.percent = parsed.Percent;
          result.isCharging = parsed.Status === 2 || parsed.Status === 6 || parsed.Status === 7 || parsed.Status === 8;
        }
      } catch {}
    }
    cachedBattery = { value: result, lastChecked: now };
    callback(result);
  });
}

function checkAiHubServerStatus(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedAiHubStatus.value && now - cachedAiHubStatus.lastChecked < 8000) {
    return Promise.resolve(cachedAiHubStatus.value);
  }
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.on("connect", () => {
      socket.destroy();
      exec(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 20130 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess"`, { timeout: 1500 }, (err, stdout) => {
        const pid = stdout ? parseInt(stdout.trim(), 10) : null;
        const val = { running: true, port: 20130, pid: Number.isInteger(pid) ? pid : null };
        cachedAiHubStatus = { value: val, lastChecked: Date.now() };
        resolve(val);
      });
    });
    socket.on("error", () => {
      socket.destroy();
      const val = { running: false, port: 20130, pid: null };
      cachedAiHubStatus = { value: val, lastChecked: Date.now() };
      resolve(val);
    });
    socket.on("timeout", () => {
      socket.destroy();
      const val = { running: false, port: 20130, pid: null };
      cachedAiHubStatus = { value: val, lastChecked: Date.now() };
      resolve(val);
    });
    socket.connect(20130, "127.0.0.1");
  });
}

// Kiểm tra xem có phiên AI nào đang chạy trên AI Remote hoặc AI Hub Web không
async function isAnyAiSessionRunning() {
  if (activePromptJob) return true;
  try {
    const res = await fetch("http://127.0.0.1:20130/api/sessions", {
      signal: AbortSignal.timeout(1500)
    });
    if (res.ok) {
      const data = await res.json();
      const list = Array.isArray(data) ? data : (Array.isArray(data.sessions) ? data.sessions : []);
      if (list.some(s => s && (s.isRunning || s.running || s.status === "running"))) {
        return true;
      }
    }
  } catch {}
  return false;
}

function getAiHubEnvironment() {
  if (cachedAiHubEnv) return cachedAiHubEnv;
  try {
    const cmd = `cmd.exe /d /c "call \\"${START_WEB_BAT}\\" --export-env >nul && set"`;
    const out = execSync(cmd, { encoding: "utf8", timeout: 5000 });
    const env = Object.assign({}, process.env);
    out.split(/\r?\n/).forEach(line => {
      const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (match) {
        env[match[1]] = match[2];
      }
    });
    cachedAiHubEnv = env;
    return env;
  } catch (err) {
    console.error("[ENV LOAD ERROR]", err.message);
    return process.env;
  }
}

async function startAiHubServer() {
  const currentStatus = await checkAiHubServerStatus(true);
  if (currentStatus.running) {
    return { ok: true, message: "AI Hub Server đã đang chạy.", pid: currentStatus.pid };
  }
  const env = getAiHubEnvironment();
  const serverJs = path.join(AI_HUB_WEB_DIR, "server.js");

  const child = spawn(process.execPath, [serverJs], {
    cwd: AI_HUB_WEB_DIR,
    env: env,
    detached: true,
    stdio: "ignore"
  });
  child.unref();

  await new Promise(r => setTimeout(r, 1000));
  const newStatus = await checkAiHubServerStatus(true);
  return {
    ok: newStatus.running,
    message: newStatus.running ? "Khởi động AI Hub Server thành công!" : "Đã kích hoạt khởi động server.",
    pid: child.pid || newStatus.pid
  };
}

async function stopAiHubServer() {
  const currentStatus = await checkAiHubServerStatus(true);
  if (!currentStatus.running) {
    return { ok: true, message: "AI Hub Server hiện không chạy." };
  }
  if (currentStatus.pid) {
    try {
      execSync(`taskkill /PID ${currentStatus.pid} /F /T`, { timeout: 3000 });
    } catch (err) {
      console.warn("[TASKKILL ERROR]", err.message);
    }
  }
  await new Promise(r => setTimeout(r, 800));
  const afterStatus = await checkAiHubServerStatus(true);
  return {
    ok: !afterStatus.running,
    message: !afterStatus.running ? "Đã tắt AI Hub Server thành công!" : "Đang chờ tắt server..."
  };
}

async function restartAiHubServer() {
  await stopAiHubServer();
  await new Promise(r => setTimeout(r, 1000));
  return await startAiHubServer();
}

function turnOffScreen() {
  if (fs.existsSync(SCREEN_OFF_EXE)) {
    const child = spawn(SCREEN_OFF_EXE, [], { detached: true, stdio: "ignore" });
    child.unref();
    return { ok: true, message: "Đã tắt màn hình laptop." };
  } else {
    const cmd = `powershell -NoProfile -Command "(Add-Type '[DllImport(\\"user32.dll\\")]public static extern int SendMessage(int hWnd,int hMsg,int wParam,int lParam);' -Name a -Pas)::SendMessage(-1,0x0112,0xF170,2)"`;
    exec(cmd);
    return { ok: true, message: "Đã tắt màn hình laptop (PowerShell)." };
  }
}

function lockWindows() {
  exec("rundll32.exe user32.dll,LockWorkStation");
  return { ok: true, message: "Đã khóa màn hình laptop." };
}

function triggerSystemShutdown(type = "shutdown", seconds = 30, reasonText = "") {
  if (type === "screen-off") {
    return turnOffScreen();
  }
  if (type === "lock") {
    return lockWindows();
  }
  if (shutdownState.active) {
    abortSystemShutdown();
  }
  const safeSeconds = Math.max(5, Math.min(3600, Math.floor(Number(seconds) || 30)));
  const flag = type === "restart" ? "/r" : "/s";
  const comment = reasonText || (type === "restart" ? "Yeu cau Restart tu Bo Tot Remote" : "Yeu cau Tat May tu Bo Tot Remote");
  exec(`shutdown.exe ${flag} /t ${safeSeconds} /c "${comment}"`);

  shutdownState = {
    active: true,
    type: type,
    secondsLeft: safeSeconds,
    timerId: setInterval(() => {
      shutdownState.secondsLeft -= 1;
      if (shutdownState.secondsLeft <= 0) {
        clearInterval(shutdownState.timerId);
        shutdownState.timerId = null;
      }
    }, 1000)
  };

  const actionVi = type === "restart" ? "khởi động lại" : "tắt máy";


  return {
    ok: true,
    type: type,
    secondsLeft: safeSeconds,
    message: `Đang chuẩn bị ${actionVi} sau ${safeSeconds} giây. Bạn có thể bấm HỦY trên điện thoại.`
  };
}

function abortSystemShutdown() {
  exec("shutdown.exe /a");
  if (shutdownState.timerId) {
    clearInterval(shutdownState.timerId);
  }
  shutdownState = {
    active: false,
    type: null,
    secondsLeft: 0,
    timerId: null
  };
  waitingForAiIdleReason = null;
  return { ok: true, message: "Đã hủy tắt máy thành công!" };
}

// ==============================================================================
// BACKGROUND MONITOR: UPTIME ALERT & POWER SCHEDULER (CHẠY MỖI 10 GIÂY)
// ==============================================================================
async function evaluateUptimeAndSchedules() {
  const now = Date.now();
  const uptimeSec = Math.floor(os.uptime());
  const uptimeMin = Math.floor(uptimeSec / 60);
  const upCfg = remoteConfig.uptimeAlert;
  const schCfg = remoteConfig.schedule;

  // 1. KIỂM TRA CẢNH BÁO MÁY HOẠT ĐỘNG LÂU (UPTIME ALERT)
  if (upCfg.enabled && upCfg.thresholdMinutes > 0 && uptimeMin >= upCfg.thresholdMinutes) {
    const isSnoozed = upCfg.snoozeUntil && now < upCfg.snoozeUntil;
    // Tự động tắt máy nếu vượt ngưỡng autoShutdownMinutes
    if (upCfg.autoShutdownMinutes > 0 && uptimeMin >= upCfg.autoShutdownMinutes && !shutdownState.active && ! isSnoozed) {
      const bootId = Math.floor((now - uptimeSec * 1000) / 60000);
      if (upCfg.lastAutoShutdownBootId !== bootId) {
        if (schCfg.waitAiIdle && await isAnyAiSessionRunning()) {
          waitingForAiIdleReason = `Đang đợi phiên AI hoàn tất để tự tắt máy (đã chạy ${formatDurationVi(uptimeSec)})`;
        } else {
          waitingForAiIdleReason = null;
          upCfg.lastAutoShutdownBootId = bootId;
          saveConfig();
          triggerSystemShutdown("shutdown", 60, `Tu dong tat may do hoat dong qua ${upCfg.autoShutdownMinutes} phut`);
        }
      }
    }
  }

  // 2. KIỂM TRA HẸN GIỜ ĐẾM NGƯỢC (COUNTDOWN SCHEDULE)
  if (schCfg.countdownActive && schCfg.countdownTargetAt > 0) {
    const msLeft = schCfg.countdownTargetAt - now;

    // Đến giờ thực thi
    if (msLeft <= 0) {
      if (schCfg.waitAiIdle && (schCfg.countdownAction === "shutdown" || schCfg.countdownAction === "restart") && await isAnyAiSessionRunning()) {
        waitingForAiIdleReason = "Đã đến giờ hẹn tắt máy — đang đợi phiên AI chạy xong...";
      } else {
        waitingForAiIdleReason = null;
        const actionToRun = schCfg.countdownAction || "shutdown";
        schCfg.countdownActive = false;
        schCfg.countdownTargetAt = 0;
        saveConfig();
        triggerSystemShutdown(actionToRun, 45, "Thuc thi hen gio tu Bo Tot Remote");
      }
    }
  }

  // 3. KIỂM TRA LỊCH TẮT CỐ ĐỊNH HÀNG NGÀY (DAILY SCHEDULE)
  if (schCfg.dailyEnabled && schCfg.dailyTime) {
    const d = new Date(now);
    const todayStr = getTodayDateString(d);
    const [targetH, targetM] = String(schCfg.dailyTime).split(":").map(Number);

    if (Number.isInteger(targetH) && Number.isInteger(targetM)) {
      const targetToday = new Date(d.getFullYear(), d.getMonth(), d.getDate(), targetH, targetM, 0, 0).getTime();
      const diffMs = targetToday - now;

      // Đến giờ hẹn (trong cửa sổ 15 phút kể từ giờ hẹn và chưa chạy hôm nay)
      if (diffMs <= 0 && diffMs >= -900000 && schCfg.lastTriggeredDate !== todayStr && !shutdownState.active) {
        if (schCfg.waitAiIdle && await isAnyAiSessionRunning()) {
          waitingForAiIdleReason = `Đến lịch ${schCfg.dailyTime} — đang đợi phiên AI chạy xong...`;
        } else {
          waitingForAiIdleReason = null;
          schCfg.lastTriggeredDate = todayStr;
          if (schCfg.dailyRepeat === "once") {
            schCfg.dailyEnabled = false;
          }
          saveConfig();
          triggerSystemShutdown(schCfg.dailyAction || "shutdown", 45, `Lich tat may dinh ky luc ${schCfg.dailyTime}`);
        }
      }
    }
  }
}

setInterval(() => {
  evaluateUptimeAndSchedules().catch(err => console.warn("[SCHEDULER WARN]", err.message));
}, 10000);

// ==============================================================================
// BRIDGE: LẮNG NGHE SỰ KIỆN HOÀN TẤT PHIÊN TỪ AI HUB WEB (PORT 20130)
// ==============================================================================
// ==============================================================================
// MODELS & WORKSPACES
// ==============================================================================
const AVAILABLE_MODELS = [
  { id: "ag/gemini-3.8-flash", name: "Gemini 3.8 Flash", provider: "Google", tag: "Tốc độ cao, suy luận thích ứng", badge: "Mặc định", icon: "gemini", default: true },
  { id: "ag/claude-sonnet-5-5-high", name: "Claude Sonnet 5.5", provider: "Anthropic", tag: "Refactor sâu & tự sửa bug", badge: "Khuyên dùng", icon: "claude" },
  { id: "cx/gpt-6.1-sol", name: "GPT-6.1 Sol (Codex)", provider: "OpenAI", tag: "Code chuẩn, tư duy sâu", badge: "Codex", icon: "openai" },
  { id: "claude-code", name: "Claude Code", provider: "Anthropic", tag: "Agent tự hành chính chủ Claude", badge: "Agent CLI", icon: "claude" },
  { id: "ag/gemini-4-argon-high", name: "Gemini 4 Argon", provider: "DeepMind", tag: "Mô hình suy luận cao cấp", badge: "Argon High", icon: "gemini" },
  { id: "ag/claude-opus-5-5-high", name: "Claude Opus 5.5", provider: "Anthropic", tag: "Tư duy cấu trúc & phân tích phức tạp", badge: "Opus High", icon: "claude" },
  { id: "ag/gpt-oss-120b-medium", name: "GPT OSS 120B", provider: "Antigravity", tag: "Mã nguồn mở linh hoạt", badge: "Open Source", icon: "openai" }
];

function getWorkspaces() {
  try {
    if (fs.existsSync(WORKSPACES_JSON)) {
      const data = JSON.parse(fs.readFileSync(WORKSPACES_JSON, "utf8"));
      if (Array.isArray(data)) return data;
    }
  } catch {}
  return [AI_HUB_DIR, "C:\\Users\\Admin\\OneDrive\\Desktop"];
}

function buildStatusScheduleSummary() {
  const now = Date.now();
  const uptimeSeconds = Math.floor(os.uptime());
  const uptimeMinutes = Math.floor(uptimeSeconds / 60);
  const upCfg = remoteConfig.uptimeAlert;
  const schCfg = remoteConfig.schedule;
  const countdownRemainingSec = (schCfg.countdownActive && schCfg.countdownTargetAt > now)
    ? Math.max(0, Math.ceil((schCfg.countdownTargetAt - now) / 1000))
    : 0;
  const snoozeRemainingSec = (upCfg.snoozeUntil && upCfg.snoozeUntil > now)
    ? Math.max(0, Math.ceil((upCfg.snoozeUntil - now) / 1000))
    : 0;

  return {
    uptimeSeconds,
    uptimeMinutes,
    uptimeFormatted: formatDurationVi(uptimeSeconds),
    bootTime: now - uptimeSeconds * 1000,
    uptimeAlert: {
      enabled: upCfg.enabled,
      thresholdMinutes: upCfg.thresholdMinutes,
      autoShutdownMinutes: upCfg.autoShutdownMinutes,
      isOverThreshold: Boolean(upCfg.enabled && upCfg.thresholdMinutes > 0 && uptimeMinutes >= upCfg.thresholdMinutes),
      snoozeRemainingSec,
    },
    schedule: {
      countdownActive: schCfg.countdownActive && countdownRemainingSec > 0,
      countdownTargetAt: schCfg.countdownTargetAt,
      countdownRemainingSec,
      countdownDurationMin: schCfg.countdownDurationMin,
      countdownAction: schCfg.countdownAction,
      dailyEnabled: schCfg.dailyEnabled,
      dailyTime: schCfg.dailyTime,
      dailyRepeat: schCfg.dailyRepeat,
      dailyAction: schCfg.dailyAction,
      waitAiIdle: schCfg.waitAiIdle,
      waitingForAiIdleReason
    },

  };
}

// MIME types cho file tĩnh PWA
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

// ==============================================================================
// HTTP SERVER & ROUTING
// ==============================================================================
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  const readJson = () => new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => { body += chunk; if (body.length > 1e6) req.destroy(); });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { resolve({}); }
    });
    req.on("error", reject);
  });

  const sendJson = (data, statusCode = 200) => {
    res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
  };

  // --- 1. TRẠNG THÁI TỔNG QUAN HỆ THỐNG, UPTIME, LỊCH TẮT & AI HUB ---
  if (req.method === "GET" && pathname === "/api/status") {
    getBatteryInfo(async (battery) => {
      const hubStatus = await checkAiHubServerStatus();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const memPercent = Math.round((usedMem / totalMem) * 100);
      const cpus = os.cpus();
      const cpuCount = cpus.length;
      const cpuModel = cpus[0] ? cpus[0].model.trim() : "Unknown CPU";
      const summary = buildStatusScheduleSummary();

      sendJson({
        tailscaleIp: getTailscaleIp(),
        hostname: os.hostname(),
        platform: "Windows 11",
        cpu: { model: cpuModel, cores: cpuCount },
        memory: {
          totalMB: Math.round(totalMem / 1048576),
          usedMB: Math.round(usedMem / 1048576),
          percent: memPercent
        },
        battery: battery,
        aiHub: hubStatus,
        shutdownState: {
          active: shutdownState.active,
          type: shutdownState.type,
          secondsLeft: Math.max(0, shutdownState.secondsLeft)
        },
        activePrompt: activePromptJob ? {
          workspace: activePromptJob.workspace,
          model: activePromptJob.model,
          startedAt: activePromptJob.startedAt
        } : null,
        ...summary
      });
    });
    return;
  }

  // --- 2. CẤU HÌNH CẢNH BÁO UPTIME, LỊCH TẮT MÁY & THÔNG BÁO ANDROID ---
  if (req.method === "GET" && pathname === "/api/config") {
    return sendJson({
      ok: true,
      config: remoteConfig
    });
  }

  if (req.method === "POST" && pathname === "/api/config") {
    readJson().then((body) => {
      if (body.uptimeAlert && typeof body.uptimeAlert === "object") {
        const u = body.uptimeAlert;
        if (typeof u.enabled === "boolean") remoteConfig.uptimeAlert.enabled = u.enabled;
        if (typeof u.thresholdMinutes === "number") remoteConfig.uptimeAlert.thresholdMinutes = Math.max(10, Math.min(2880, Math.round(u.thresholdMinutes)));
        if (typeof u.autoShutdownMinutes === "number") remoteConfig.uptimeAlert.autoShutdownMinutes = Math.max(0, Math.min(2880, Math.round(u.autoShutdownMinutes)));
      }
      if (body.schedule && typeof body.schedule === "object") {
        const s = body.schedule;
        if (typeof s.dailyEnabled === "boolean") remoteConfig.schedule.dailyEnabled = s.dailyEnabled;
        if (typeof s.dailyTime === "string" && /^\d{2}:\d{2}$/.test(s.dailyTime.trim())) {
          remoteConfig.schedule.dailyTime = s.dailyTime.trim();
          remoteConfig.schedule.lastTriggeredDate = "";
        }
        if (s.dailyRepeat === "daily" || s.dailyRepeat === "once") remoteConfig.schedule.dailyRepeat = s.dailyRepeat;
        if (s.dailyAction === "shutdown" || s.dailyAction === "restart") remoteConfig.schedule.dailyAction = s.dailyAction;
        if (typeof s.waitAiIdle === "boolean") remoteConfig.schedule.waitAiIdle = s.waitAiIdle;
      }
      saveConfig();
      evaluateUptimeAndSchedules().catch(() => {});
      sendJson({
        ok: true,
        message: "Đã lưu cấu hình thành công!",
        ...buildStatusScheduleSummary()
      });
    });
    return;
  }

  // Đặt / Hủy hẹn giờ đếm ngược tắt máy
  if (req.method === "POST" && pathname === "/api/schedule/countdown") {
    readJson().then((body) => {
      const minutes = Number(body.minutes) || 0;
      const action = ["shutdown", "restart", "screen-off", "lock"].includes(body.action) ? body.action : "shutdown";
      if (body.cancel || minutes <= 0) {
        remoteConfig.schedule.countdownActive = false;
        remoteConfig.schedule.countdownTargetAt = 0;
        remoteConfig.schedule.countdownDurationMin = 0;
        waitingForAiIdleReason = null;
        saveConfig();
        return sendJson({
          ok: true,
          message: "Đã hủy hẹn giờ đếm ngược.",
          ...buildStatusScheduleSummary()
        });
      }

      const safeMin = Math.max(1, Math.min(1440, Math.round(minutes)));
      const targetAt = Date.now() + safeMin * 60000;
      remoteConfig.schedule.countdownActive = true;
      remoteConfig.schedule.countdownTargetAt = targetAt;
      remoteConfig.schedule.countdownDurationMin = safeMin;
      remoteConfig.schedule.countdownAction = action;
      if (typeof body.waitAiIdle === "boolean") {
        remoteConfig.schedule.waitAiIdle = body.waitAiIdle;
      }
      saveConfig();

      const actionLabel = action === "restart" ? "khởi động lại" : (action === "screen-off" ? "tắt màn hình" : (action === "lock" ? "khóa máy" : "tắt máy"));
      const timeStr = new Date(targetAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
      sendJson({
        ok: true,
        message: `Đã hẹn giờ ${actionLabel} sau ${safeMin} phút (${timeStr}).`,
        ...buildStatusScheduleSummary()
      });
    });
    return;
  }

  // Tạm hoãn cảnh báo máy hoạt động lâu hoặc lùi hẹn giờ tắt máy
  if (req.method === "POST" && pathname === "/api/schedule/snooze") {
    readJson().then((body) => {
      const minutes = Math.max(5, Math.min(720, Number(body.minutes) || 60));
      const now = Date.now();
      remoteConfig.uptimeAlert.snoozeUntil = now + minutes * 60000;
      if (remoteConfig.schedule.countdownActive && remoteConfig.schedule.countdownTargetAt > now) {
        remoteConfig.schedule.countdownTargetAt += minutes * 60000;
      }
      if (shutdownState.active) {
        abortSystemShutdown();
      }
      saveConfig();
      sendJson({
        ok: true,
        message: `Đã tạm hoãn cảnh báo trong ${minutes} phút.`,
        ...buildStatusScheduleSummary()
      });
    });
    return;
  }

  // 2. Danh sách workspaces & models
  if (req.method === "GET" && pathname === "/api/models") {
    return sendJson({ models: AVAILABLE_MODELS });
  }

  if (req.method === "GET" && pathname === "/api/workspaces") {
    return sendJson({ workspaces: getWorkspaces() });
  }

  // 3. Điều khiển AI Hub
  if (req.method === "POST" && pathname === "/api/hub/start") {
    startAiHubServer().then(result => sendJson(result)).catch(err => sendJson({ ok: false, error: err.message }, 500));
    return;
  }
  if (req.method === "POST" && pathname === "/api/hub/stop") {
    stopAiHubServer().then(result => sendJson(result)).catch(err => sendJson({ ok: false, error: err.message }, 500));
    return;
  }
  if (req.method === "POST" && pathname === "/api/hub/restart") {
    restartAiHubServer().then(result => sendJson(result)).catch(err => sendJson({ ok: false, error: err.message }, 500));
    return;
  }

  // 4. Điều khiển Hệ Thống
  if (req.method === "POST" && pathname === "/api/system/screen-off") {
    return sendJson(turnOffScreen());
  }
  if (req.method === "POST" && pathname === "/api/system/lock") {
    return sendJson(lockWindows());
  }
  if (req.method === "POST" && pathname === "/api/system/shutdown") {
    readJson().then(body => {
      const timeout = typeof body.timeout === "number" ? body.timeout : 30;
      sendJson(triggerSystemShutdown("shutdown", timeout));
    });
    return;
  }
  if (req.method === "POST" && pathname === "/api/system/restart") {
    readJson().then(body => {
      const timeout = typeof body.timeout === "number" ? body.timeout : 30;
      sendJson(triggerSystemShutdown("restart", timeout));
    });
    return;
  }
  if (req.method === "POST" && pathname === "/api/system/abort-shutdown") {
    return sendJson(abortSystemShutdown());
  }

  // 5. Hủy Prompt đang chạy
  if (req.method === "POST" && pathname === "/api/prompt/abort") {
    if (activePromptJob && activePromptJob.process) {
      try {
        execSync(`taskkill /PID ${activePromptJob.process.pid} /F /T`);
      } catch {}
      activePromptJob = null;
      return sendJson({ ok: true, message: "Đã hủy tiến trình prompt thành công." });
    }
    return sendJson({ ok: true, message: "Không có prompt nào đang chạy." });
  }

  // 6. Chạy Prompt từ xa (Realtime Stream SSE)
  if (req.method === "POST" && pathname === "/api/prompt/run") {
    readJson().then(body => {
      const { workspace, model, prompt } = body;
      if (!prompt || !prompt.trim()) {
        return sendJson({ ok: false, error: "Prompt không được để trống." }, 400);
      }

      if (activePromptJob) {
        return sendJson({ ok: false, error: "Đang có một prompt khác đang chạy. Hãy đợi hoặc bấm Hủy." }, 409);
      }

      const targetDir = (workspace && fs.existsSync(workspace)) ? workspace : AI_HUB_DIR;
      const env = Object.assign({}, getAiHubEnvironment());

      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      });

      const sendEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      sendEvent("start", { workspace: targetDir, model, prompt });

      let execCmd = "";
      let execArgs = [];

      const systemInstruction = "QUY TAC BAT BUOC: Tra loi ngan gon, truc tiep, thuc thi chuan xac.";
      const gooseExe = env.GOOSE_PATH || "goose.exe";

      if (model === "claude-code") {
        execCmd = (process.platform === "win32" ? "claude.cmd" : "claude");
        execArgs = ["-p", prompt];
      } else {
        execCmd = gooseExe;
        let gooseModel = model || "ag/gemini-3.8-flash";
        if (model === "goose-gemini-flash") gooseModel = "ag/gemini-3.8-flash";
        else if (model === "goose-claude-sonnet") gooseModel = "ag/claude-sonnet-5-5-high";
        else if (model === "goose-codex") gooseModel = "cx/gpt-6.1-sol";
        else if (model === "goose-gemini-argon") gooseModel = "ag/gemini-4-argon-high";

        env.GOOSE_PROVIDER = "openai";
        env.GOOSE_MODEL = gooseModel;
        execArgs = ["run", "-t", prompt, "--provider", "openai", "--model", gooseModel, "--no-session", "--system", systemInstruction];
      }

      sendEvent("log", { text: `[START] Đang khởi chạy Agent: ${model} tại: ${targetDir}...\n` });

      const child = spawn(execCmd, execArgs, {
        cwd: targetDir,
        env: env,
        shell: (model === "claude-code"),
      });

      activePromptJob = {
        process: child,
        workspace: targetDir,
        model: model,
        startedAt: Date.now()
      };

      child.stdout.on("data", chunk => {
        sendEvent("log", { text: chunk.toString("utf8") });
      });

      child.stderr.on("data", chunk => {
        sendEvent("log", { text: chunk.toString("utf8") });
      });

      child.on("close", code => {
        activePromptJob = null;
        sendEvent("done", { code: code });
        res.end();

      });

      child.on("error", err => {
        activePromptJob = null;
        sendEvent("error", { message: err.message });
        res.end();
      });

      req.on("close", () => {});
    });
    return;
  }

  // --- STATIC FILES (PWA) ---
  let filePath = path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(PUBLIC_DIR, "index.html");
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const isDynamic = (ext === ".html" || ext === ".js" || ext === ".json" || ext === ".webmanifest" || ext === ".svg");
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": isDynamic ? "no-cache, no-store, must-revalidate, max-age=0" : "public, max-age=86400",
      "Pragma": "no-cache",
      "Expires": "0"
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log(`[INFO] Port ${PORT} đã có tiến trình Bò Tót Remote khác đang chạy. Tự động thoát an toàn.`);
    process.exit(0);
  } else {
    console.error("[SERVER ERROR]", err);
  }
});

server.listen(PORT, HOST, () => {
  const ip = getTailscaleIp();
  console.log("========================================================");
  console.log("    AI HUB REMOTE CONTROLLER DAEMON DANG CHAY");
  console.log("========================================================");
  console.log(`- Cong Daemon   : ${PORT}`);
  console.log(`- Truy cap local: http://127.0.0.1:${PORT}`);
  console.log(`- Qua Tailscale : http://${ip}:${PORT}`);
  console.log("========================================================");
});
