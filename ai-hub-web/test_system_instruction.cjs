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
assert.ok(serverSrc.includes("buildSystemInstruction(cwd, model)"));

const batSrc = fs.readFileSync(path.resolve(__dirname, "..", "run-ai.bat"), "utf8");
assert.ok(batSrc.includes("lessons.md"));
assert.ok(batSrc.includes(".goosehints"));

const ps1Src = fs.readFileSync(path.resolve(__dirname, "..", "run-ai.ps1"), "utf8");
assert.ok(ps1Src.includes("lessons.md"));
assert.ok(ps1Src.includes(".goosehints"));
assert.ok(promptForAiHub.includes("Select-String -Path"));
assert.ok(promptForAiHub.includes("git grep -n -I"));
assert.ok(promptForAiHub.includes("KHÔNG cài `rg`"));
assert.ok(promptForAiHub.includes("3-6 lượt gọi tool"));
assert.ok(promptForAiHub.includes("trích xuất và ghép trực tiếp trên đĩa"));
assert.ok(serverSrc.includes('GOOSE_CONTEXT_LIMIT: process.env.GOOSE_CONTEXT_LIMIT || "400000"'));
assert.ok(batSrc.includes("GOOSE_CONTEXT_LIMIT=400000"));
assert.ok(ps1Src.includes('$env:GOOSE_CONTEXT_LIMIT = "400000"'));

console.log("System instruction & memory: 18 checks passed");
