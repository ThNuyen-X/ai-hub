'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ModelLevels = require('./public/model-levels.js');
const html = fs.readFileSync(__dirname + '/public/index.html', 'utf8');
const source = fs.readFileSync(__dirname + '/server.js', 'utf8');
const context = vm.createContext({ ModelLevels });
vm.runInContext(html.match(/const MODELS = \[[\s\S]*?\];/)[0] + '\nthis.models = MODELS;', context);
const models = context.models;
assert.ok(!models.some(m => /3\.1-pro/.test(m.id)));
assert.ok(models.some(m => m.id === 'ag/gemini-4-carbon-high'));
const hydrogen = models.find(m => m.id.includes('hydrogen'));
assert.deepEqual(ModelLevels.variants(hydrogen).map(m => m.id), [
 'ag/gemini-4-hydrogen-low', 'ag/gemini-4-hydrogen-medium', 'ag/gemini-4-hydrogen-high', 'ag/gemini-4-hydrogen-xhigh'
]);
const argon = models.find(m => m.id.includes('argon'));
assert.deepEqual(ModelLevels.variants(argon).map(m => m.id), [
 'ag/gemini-4-argon-low', 'ag/gemini-4-argon-medium', 'ag/gemini-4-argon-high'
]);
const flash = models.find(m => m.id.includes('flash'));
assert.equal(ModelLevels.variants(flash).length, 4);
assert.equal(ModelLevels.variants(flash)[3].id, 'ag/gemini-3.8-flash-high');
for (const m of models.filter(m => m.id.startsWith('ag/claude-'))) {
 assert.deepEqual(ModelLevels.variants(m).map(v => v.level), ['low', 'medium', 'high']);
}
for (const m of models.filter(m => m.group === 'chatgpt')) assert.equal(ModelLevels.variants(m).length, 1);
const normalize = html.slice(html.indexOf('    function normalizeModelId('), html.indexOf('    function setSessionModel('));
vm.runInContext(normalize + '\nthis.resolve = resolveModelMeta; this.normalize = normalizeModelId;', context);
for (const model of models.flatMap(ModelLevels.variants)) {
 assert.equal(context.normalize(model.id), model.id);
 assert.equal(context.resolve(model.id).id, model.id);
 assert.equal(context.resolve(model.id).name, model.name);
}
assert.ok(source.includes('].flatMap(modelLevelVariants);'));
assert.ok(!source.includes('if (modelId === "ag/gemini-3.8-flash-high")'));
assert.ok(html.indexOf('src="/model-levels.js"') < html.indexOf('const MODELS ='));
assert.ok(html.includes('aria-label="Reasoning level"'));
console.log('PASS: supported per-model levels, exact variant metadata, Flash High preserved, shared server catalog');

const backendContext = vm.createContext({ modelLevelVariants: ModelLevels.variants });
vm.runInContext(source.match(/const AVAILABLE_MODELS = \[[\s\S]*?\]\.flatMap\(modelLevelVariants\);/)[0] + '\nthis.models = AVAILABLE_MODELS;', backendContext);
assert.deepEqual(Array.from(backendContext.models, m => m.id), Array.from(models.flatMap(ModelLevels.variants), m => m.id));
assert.deepEqual(Array.from(backendContext.models, m => m.group), Array.from(models.flatMap(ModelLevels.variants), m => m.group));
assert.equal(new Set(backendContext.models.map(m => m.id)).size, 111);
assert.equal(ModelLevels.normalize('ag/claude-opus-5-5'), 'ag/claude-opus-5-5-high');
assert.equal(ModelLevels.normalize('ag/gemini-3.8-flash-high'), 'ag/gemini-3.8-flash-high');
assert.ok(source.includes('!AVAILABLE_MODELS.some(item => item.id === model)'));
assert.ok(html.includes('normalizedSavedModel) ? normalizedSavedModel : MODELS[0].id'));

const neon = models.find(m => m.id === 'ag/gemini-4-neon-high');
assert.deepEqual(ModelLevels.variants(neon).map(m => m.id), ['ag/gemini-4-neon-low', 'ag/gemini-4-neon-medium', 'ag/gemini-4-neon-high', 'ag/gemini-4-neon-xhigh']);
assert.deepEqual(ModelLevels.variants({id: 'ag/gemini-4-neon-xhigh'}).map(m => m.id), ['ag/gemini-4-neon-xhigh']);
