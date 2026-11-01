const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { LESSONS_FILE, buildSystemInstruction } = require("./system-instruction.cjs");

assert.ok(fs.existsSync(LESSONS_FILE), "Shared lessons.md should exist");

const promptForAiHub = buildSystemInstruction(path.resolve(__dirname, ".."));
assert.ok(promptForAiHub.includes("QUY CHUẨN MƯỢT MÀ, ỔN ĐỊNH & TỐI ƯU TÀI NGUYÊN"));
assert.ok(promptForAiHub.includes("[WORKSPACE HINTS (.goosehints)]"));
assert.ok(promptForAiHub.includes("[BÀI HỌC THỰC CHIẾN CHUNG"));
assert.ok(promptForAiHub.includes("AI Hub Workspace Architecture"));

const serverSrc = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
assert.ok(serverSrc.includes('require("./system-instruction.cjs")'));
assert.ok(serverSrc.includes("buildSystemInstruction(cwd)"));

const batSrc = fs.readFileSync(path.resolve(__dirname, "..", "run-ai.bat"), "utf8");
assert.ok(batSrc.includes("lessons.md"));
assert.ok(batSrc.includes(".goosehints"));

const ps1Src = fs.readFileSync(path.resolve(__dirname, "..", "run-ai.ps1"), "utf8");
assert.ok(ps1Src.includes("lessons.md"));
assert.ok(ps1Src.includes(".goosehints"));

console.log("System instruction & memory: 10 checks passed");
