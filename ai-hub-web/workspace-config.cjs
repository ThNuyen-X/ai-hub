const fs = require("node:fs");
const path = require("node:path");
const { workspaceKey } = require("./workspace-path.cjs");

const WORKSPACE_CONFIGS_FILE = path.join(__dirname, "workspace-configs.json");

function cleanValue(val) {
  let s = String(val || "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function readRawWorkspaceConfigs() {
  try {
    if (!fs.existsSync(WORKSPACE_CONFIGS_FILE)) return {};
    const raw = fs.readFileSync(WORKSPACE_CONFIGS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed : {};
  } catch (err) {
    console.error("[WORKSPACE_CONFIG] Lỗi khi đọc workspace-configs.json:", err.message);
    return {};
  }
}

function writeRawWorkspaceConfigs(data) {
  try {
    fs.writeFileSync(WORKSPACE_CONFIGS_FILE, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (err) {
    console.error("[WORKSPACE_CONFIG] Lỗi khi ghi workspace-configs.json:", err.message);
    return false;
  }
}

function getWorkspaceConfig(wsPath) {
  if (!wsPath) return [];
  const key = workspaceKey(wsPath);
  if (!key) return [];
  const all = readRawWorkspaceConfigs();
  const entries = all[key];
  if (Array.isArray(entries)) {
    return entries
      .filter(item => item && typeof item === "object")
      .map(item => ({
        name: String(item.name || "").trim(),
        value: cleanValue(item.value)
      }));
  }
  return [];
}

function saveWorkspaceConfig(wsPath, entries) {
  if (!wsPath) return [];
  const key = workspaceKey(wsPath);
  if (!key) return [];

  const rawEntries = Array.isArray(entries)
    ? entries
    : (entries && typeof entries === "object"
      ? Object.entries(entries).map(([name, value]) => ({ name, value }))
      : []);

  const cleanEntries = rawEntries
    .map(item => ({
      name: String(item.name || "").trim(),
      value: cleanValue(item.value)
    }))
    .filter(item => item.name.length > 0 || item.value.length > 0);

  const all = readRawWorkspaceConfigs();
  if (cleanEntries.length === 0) {
    delete all[key];
  } else {
    all[key] = cleanEntries;
  }
  writeRawWorkspaceConfigs(all);
  return cleanEntries;
}

function removeWorkspaceConfig(wsPath) {
  if (!wsPath) return false;
  const key = workspaceKey(wsPath);
  if (!key) return false;
  const all = readRawWorkspaceConfigs();
  if (all[key]) {
    delete all[key];
    writeRawWorkspaceConfigs(all);
    return true;
  }
  return false;
}

function buildWorkspaceEnvInstruction(wsPath) {
  if (!wsPath) return "";
  const entries = getWorkspaceConfig(wsPath);
  const valid = entries.filter(e => e.name && e.value);
  if (valid.length === 0) return "";

  const lines = valid.map(e => `  - ${e.name}: ${e.value}`);
  return (
    "[CẤU HÌNH BIẾN MÔI TRƯỜNG & CÔNG CỤ WORKSPACE]:\n" +
    "Workspace này có các biến / đường dẫn công cụ / script thực thi được người dùng thiết lập riêng:\n" +
    lines.join("\n") + "\n" +
    "AI hãy chủ động xem xét và quyết định sử dụng các công cụ/đường dẫn/script trên (ví dụ gọi thực thi file script .bat/.cmd/.sh, gọi trực tiếp công cụ, hoặc dùng biến môi trường tương ứng khi build, test, deploy, chạy lệnh) nếu phù hợp với yêu cầu của tác vụ."
  );
}

function applyWorkspaceEnvToProcessEnv(targetEnv, wsPath) {
  if (!targetEnv || !wsPath) return;
  const entries = getWorkspaceConfig(wsPath);
  const pathPrefixes = [];

  for (const entry of entries) {
    const name = (entry.name || "").trim();
    const value = cleanValue(entry.value);
    if (!name || !value) continue;

    // Đặt biến môi trường nếu name là identifier hợp lệ
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      targetEnv[name] = value;
    }
    // Chuẩn hóa tên có khoảng trắng sang snake_case UPPER (ví dụ "deploy docker" -> "DEPLOY_DOCKER")
    const envKey = name.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
    if (envKey && /^[A-Za-z_][A-Za-z0-9_]*$/.test(envKey)) {
      targetEnv[envKey] = value;
    }

    const upper = name.toUpperCase();
    if (upper === "JDK" || upper === "JAVA_HOME") {
      targetEnv.JAVA_HOME = value;
      targetEnv.JDK = value;
      const binDir = path.join(value, "bin");
      if (fs.existsSync(binDir)) {
        pathPrefixes.push(binDir);
      } else if (fs.existsSync(value)) {
        pathPrefixes.push(value);
      }
    } else if (upper === "MAVEN_HOME" || upper === "M2_HOME" || upper === "MAVEN") {
      targetEnv.MAVEN_HOME = value;
      const binDir = path.join(value, "bin");
      if (fs.existsSync(binDir)) {
        pathPrefixes.push(binDir);
      }
    } else if (upper === "PYTHON_HOME" || upper === "PYTHONPATH" || upper === "PYTHON") {
      if (fs.existsSync(value)) {
        pathPrefixes.push(value);
      }
    }
  }

  if (pathPrefixes.length > 0) {
    const currentPath = targetEnv.PATH || targetEnv.Path || "";
    targetEnv.PATH = pathPrefixes.join(path.delimiter) + path.delimiter + currentPath;
    targetEnv.Path = targetEnv.PATH;
  }
}

module.exports = {
  WORKSPACE_CONFIGS_FILE,
  cleanValue,
  readRawWorkspaceConfigs,
  writeRawWorkspaceConfigs,
  getWorkspaceConfig,
  saveWorkspaceConfig,
  removeWorkspaceConfig,
  buildWorkspaceEnvInstruction,
  applyWorkspaceEnvToProcessEnv
};
