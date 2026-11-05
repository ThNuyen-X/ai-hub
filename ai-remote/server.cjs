// ==============================================================================
// AI HUB REMOTE CONTROLLER DAEMON
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

// State management
let shutdownState = {
  active: false,
  type: null, // "shutdown" | "restart"
  secondsLeft: 0,
  timerId: null
};

let cachedTailscaleIp = { value: null, lastChecked: 0 };
let cachedBattery = { value: null, lastChecked: 0 };
let cachedAiHubEnv = null;
let activePromptJob = null;

// Lấy Tailscale IP từ network interfaces (không tốn tiến trình con)
function getTailscaleIp() {
  const now = Date.now();
  if (cachedTailscaleIp.value && now - cachedTailscaleIp.lastChecked < 60000) {
    return cachedTailscaleIp.value;
  }
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const netInfo of nets[name]) {
      if (netInfo.family === "IPv4" && !netInfo.internal) {
        if (netInfo.address.startsWith("100.")) {
          cachedTailscaleIp = { value: netInfo.address, lastChecked: now };
          return netInfo.address;
        }
      }
    }
  }
  cachedTailscaleIp = { value: "127.0.0.1", lastChecked: now };
  return cachedTailscaleIp.value;
}

// Lấy thông tin pin (cache 30s)
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

// Kiểm tra xem port 20130 của AI Hub có đang mở không
function checkAiHubServerStatus() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.on("connect", () => {
      socket.destroy();
      // Tìm PID qua netstat
      exec(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 20130 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`, { timeout: 1500 }, (err, stdout) => {
        const pid = stdout ? parseInt(stdout.trim(), 10) : null;
        resolve({ running: true, port: 20130, pid: Number.isInteger(pid) ? pid : null });
      });
    });
    socket.on("error", () => {
      socket.destroy();
      resolve({ running: false, port: 20130, pid: null });
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ running: false, port: 20130, pid: null });
    });
    socket.connect(20130, "127.0.0.1");
  });
}

// Đọc biến môi trường từ start-web.bat
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

// Khởi động server AI Hub
async function startAiHubServer() {
  const currentStatus = await checkAiHubServerStatus();
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

  // Đợi 1 giây để socket mở
  await new Promise(r => setTimeout(r, 1000));
  const newStatus = await checkAiHubServerStatus();
  return {
    ok: newStatus.running,
    message: newStatus.running ? "Khởi động AI Hub Server thành công!" : "Đã kích hoạt khởi động server.",
    pid: child.pid || newStatus.pid
  };
}

// Dừng server AI Hub
async function stopAiHubServer() {
  const currentStatus = await checkAiHubServerStatus();
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
  const afterStatus = await checkAiHubServerStatus();
  return {
    ok: !afterStatus.running,
    message: !afterStatus.running ? "Đã tắt AI Hub Server thành công!" : "Đang chờ tắt server..."
  };
}

// Restart server AI Hub
async function restartAiHubServer() {
  await stopAiHubServer();
  await new Promise(r => setTimeout(r, 1000));
  return await startAiHubServer();
}

// Tắt màn hình ngay lập tức (bằng C# exe siêu nhẹ)
function turnOffScreen() {
  if (fs.existsSync(SCREEN_OFF_EXE)) {
    const child = spawn(SCREEN_OFF_EXE, [], { detached: true, stdio: "ignore" });
    child.unref();
    return { ok: true, message: "Đã tắt màn hình laptop." };
  } else {
    // Fallback PowerShell
    const cmd = `powershell -NoProfile -Command "(Add-Type '[DllImport(\\"user32.dll\\")]public static extern int SendMessage(int hWnd,int hMsg,int wParam,int lParam);' -Name a -Pas)::SendMessage(-1,0x0112,0xF170,2)"`;
    exec(cmd);
    return { ok: true, message: "Đã tắt màn hình laptop (PowerShell)." };
  }
}

// Khóa máy
function lockWindows() {
  exec("rundll32.exe user32.dll,LockWorkStation");
  return { ok: true, message: "Đã khóa màn hình laptop." };
}

// Bắt đầu đếm ngược tắt máy / restart máy (an toàn 2 lớp)
function triggerSystemShutdown(type = "shutdown", seconds = 30) {
  if (shutdownState.active) {
    abortSystemShutdown();
  }
  const flag = type === "restart" ? "/r" : "/s";
  const comment = type === "restart" ? "Yeu cau Restart tu AI Remote" : "Yeu cau Tat May tu AI Remote";
  exec(`shutdown.exe ${flag} /t ${seconds} /c "${comment}"`);

  shutdownState = {
    active: true,
    type: type,
    secondsLeft: seconds,
    timerId: setInterval(() => {
      shutdownState.secondsLeft -= 1;
      if (shutdownState.secondsLeft <= 0) {
        clearInterval(shutdownState.timerId);
        shutdownState.timerId = null;
      }
    }, 1000)
  };

  return {
    ok: true,
    type: type,
    secondsLeft: seconds,
    message: `Đang chuẩn bị ${type === "restart" ? "khởi động lại" : "tắt"} máy sau ${seconds} giây. Bạn có thể bấm HỦY trên điện thoại.`
  };
}

// Hủy đếm ngược tắt máy
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
  return { ok: true, message: "Đã hủy tắt máy thành công!" };
}

// Đọc danh sách workspaces
function getWorkspaces() {
  try {
    if (fs.existsSync(WORKSPACES_JSON)) {
      const data = JSON.parse(fs.readFileSync(WORKSPACES_JSON, "utf8"));
      if (Array.isArray(data)) return data;
    }
  } catch {}
  return [AI_HUB_DIR, "C:\\Users\\Admin\\OneDrive\\Desktop"];
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
  // CORS header cho phép mọi origin nội bộ trong mạng Tailscale
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  // JSON Body Parser helper
  const readJson = () => new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => { body += chunk; if (body.length > 1e6) req.destroy(); });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (e) { resolve({}); }
    });
    req.on("error", reject);
  });

  const sendJson = (data, statusCode = 200) => {
    res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
  };

  // --- API ROUTES ---

  // 1. Trạng thái tổng quan hệ thống & AI Hub
  if (req.method === "GET" && pathname === "/api/status") {
    getBatteryInfo(async (battery) => {
      const hubStatus = await checkAiHubServerStatus();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const memPercent = Math.round((usedMem / totalMem) * 100);

      // CPU load (ước tính từ cpus)
      const cpus = os.cpus();
      const cpuCount = cpus.length;
      const cpuModel = cpus[0] ? cpus[0].model.trim() : "Unknown CPU";

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
        } : null
      });
    });
    return;
  }

  // 2. Danh sách workspaces
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
      const env = getAiHubEnvironment();

      // Setup Server-Sent Events (SSE)
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      });

      const sendEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      sendEvent("start", { workspace: targetDir, model, prompt });

      // Xác định câu lệnh chạy theo Model
      let execCmd = "";
      let execArgs = [];

      const systemInstruction = "QUY TAC BAT BUOC: Tra loi ngan gon, truc tiep, thuc thi chuan xac.";
      const gooseExe = env.GOOSE_PATH || "goose.exe";

      if (model === "claude-code") {
        execCmd = (process.platform === "win32" ? "claude.cmd" : "claude");
        execArgs = ["-p", prompt];
      } else {
        // Goose model
        execCmd = gooseExe;
        let gooseModel = "ag/gemini-3.8-flash";
        if (model === "goose-gemini-argon") gooseModel = "ag/gemini-4-argon-high";
        else if (model === "goose-claude-sonnet") gooseModel = "ag/claude-sonnet-5-5-high";
        else if (model === "goose-codex") gooseModel = "cx/gpt-6.1-sol";

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

      req.on("close", () => {
        // Client disconnect nhưng không kill ngay nếu user muốn chạy ngầm
      });
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
      // Fallback về index.html cho SPA nếu không tìm thấy
      filePath = path.join(PUBLIC_DIR, "index.html");
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const isDynamic = (ext === ".html" || ext === ".js" || ext === ".json" || ext === ".svg");
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
