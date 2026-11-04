'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  WORKSPACE_CONFIGS_FILE,
  getWorkspaceConfig,
  saveWorkspaceConfig,
  removeWorkspaceConfig,
  buildWorkspaceEnvInstruction,
  applyWorkspaceEnvToProcessEnv
} = require('./workspace-config.cjs');
const { buildSystemInstruction } = require('./system-instruction.cjs');

console.log('Testing Workspace Config (Name + Value Variables & AI Knowledge)...');

const testWs = 'D:\\test-workspace-sample';

// 1. Initial should be empty array
removeWorkspaceConfig(testWs);
let initial = getWorkspaceConfig(testWs);
assert.deepEqual(initial, [], 'Initial config must be empty array');

// 2. Save sample JDK and Maven
const saved = saveWorkspaceConfig(testWs, [
  { name: 'JDK', value: 'D:\\jdk-17' },
  { name: 'MAVEN_HOME', value: 'D:\\tools\\maven' },
  { name: '   ', value: '' } // blank entry should be ignored
]);
assert.equal(saved.length, 2, 'Should save 2 valid entries');
assert.equal(saved[0].name, 'JDK');
assert.equal(saved[0].value, 'D:\\jdk-17');
assert.equal(saved[1].name, 'MAVEN_HOME');
assert.equal(saved[1].value, 'D:\\tools\\maven');

// 3. Retrieve config with case-insensitive path
const retrieved = getWorkspaceConfig('d:/test-workspace-sample/');
assert.equal(retrieved.length, 2);
assert.equal(retrieved[0].name, 'JDK');

// 4. Verify AI System Instruction injection
const instruction = buildWorkspaceEnvInstruction(testWs);
assert.ok(instruction.includes('JDK: D:\\jdk-17'), 'Instruction must list JDK');
assert.ok(instruction.includes('MAVEN_HOME: D:\\tools\\maven'), 'Instruction must list MAVEN_HOME');
assert.ok(instruction.includes('quyết định sử dụng'), 'Instruction must guide AI to decide when to use');

// 5. Verify integration with buildSystemInstruction
const fullSystemInstruction = buildSystemInstruction(testWs);
assert.ok(fullSystemInstruction.includes('[CẤU HÌNH BIẾN MÔI TRƯỜNG & CÔNG CỤ WORKSPACE]'));
assert.ok(fullSystemInstruction.includes('JDK: D:\\jdk-17'));

// 6. Verify process env injection
const mockEnv = { PATH: 'C:\\Windows\\System32', OTHER_VAR: '123' };
applyWorkspaceEnvToProcessEnv(mockEnv, testWs);
assert.equal(mockEnv.JDK, 'D:\\jdk-17');
assert.equal(mockEnv.JAVA_HOME, 'D:\\jdk-17');
assert.equal(mockEnv.MAVEN_HOME, 'D:\\tools\\maven');

// 7. Cleanup
removeWorkspaceConfig(testWs);
assert.deepEqual(getWorkspaceConfig(testWs), []);
assert.equal(buildWorkspaceEnvInstruction(testWs), '');

console.log('All Workspace Config tests passed successfully!');
