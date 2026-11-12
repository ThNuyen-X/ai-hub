'use strict';

const fs = require('fs');
const assert = require('assert');
const vm = require('vm');

const html = fs.readFileSync('public/index.html', 'utf8');

function extractFn(name, endName) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `function ${name} must exist`);
  const end = html.indexOf(`function ${endName}(`, start);
  assert.ok(end !== -1, `function ${endName} must exist`);
  return html.substring(start, end);
}

// 1. Static HTML string assertions
assert.ok(html.includes('extractUserIntentFromSummary'), 'extractUserIntentFromSummary function must exist');
assert.ok(html.includes('internal-card-question-header'), 'internal-card-question-header element must exist in internal message card');
assert.ok(html.includes('Đoạn chat của câu hỏi:'), 'Question context header label must exist');

// 2. Functional sandbox tests
const sandbox = {
  console,
  document: {
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        className: '',
        dataset: {},
        innerHTML: '',
        classList: {
          contains: () => false,
          add() {},
          remove() {}
        },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        appendChild() {}
      };
    }
  },
  window: { _codeSnippets: {} },
  marked: { Renderer: function() {}, parse: s => s },
  customRenderer: {},
  escapeHtml: s => String(s || ''),
  currentSessionId: 'test_session',
  localStorage: { getItem: () => null },
  messageTime: msg => msg.created || Date.now(),
  enhanceChatElement: () => {},
  addMessageTiming: () => {}
};

const code = `
${extractFn('isInternalConversationMessage', 'extractUserIntentFromSummary')}
${extractFn('extractUserIntentFromSummary', 'classifyInternalEntry')}
${extractFn('classifyInternalEntry', 'buildInternalItemTitle')}
${extractFn('buildInternalItemTitle', 'appendInternalHistoryEntry')}
${extractFn('appendInternalHistoryEntry', 'parseChatMarkdown')}
${extractFn('parseChatMarkdown', 'renderInternalMessageCard')}
${extractFn('renderInternalMessageCard', 'toggleInternalMessageAccordion')}
${extractFn('extractSubagentsAndUserText', 'renderSubagentReportCard')}
${extractFn('renderSubagentReportCard', 'toggleSubagentAccordion')}
${extractFn('normalizePromptForCompare', 'prepareRunningSessionHistoryItems')}
${extractFn('buildHistoryItemsFromConversation', 'normalizePromptForCompare')}
${extractFn('historyItemText', 'openFullConversationModal')}
`;

vm.createContext(sandbox);
vm.runInContext(code, sandbox);

// Test 2.1: extractUserIntentFromSummary
const s1 = `# Conversation Summary\n\n## User Intent\n- Evaluate the entire Soul-Alcohol project as a Software Architect`;
assert.equal(sandbox.extractUserIntentFromSummary(s1), 'Evaluate the entire Soul-Alcohol project as a Software Architect');

const s2 = `# Conversation Summary\r\n\r\n## User Intent\r\n- (LATEST, in progress) 'thôi kệ đi, check ở các ổ D, E xem có thể tối ưu được gì không'`;
assert.equal(sandbox.extractUserIntentFromSummary(s2), "thôi kệ đi, check ở các ổ D, E xem có thể tối ưu được gì không");

const s3 = `# Conversation Summary\n\n## User Intent\n- ACTIVE: Implement two separate password-policy fields`;
assert.equal(sandbox.extractUserIntentFromSummary(s3), 'Implement two separate password-policy fields');

// Test 2.2: Full session where user prompt was present before compaction
const fullConversation = [
  { role: 'user', created: 1000, metadata: { userVisible: true }, content: [{ type: 'text', text: 'Kiểm tra cấu hình bảo mật' }] },
  { role: 'assistant', created: 1001, content: [{ type: 'text', text: 'Đang kiểm tra...' }] },
  { role: 'user', created: 1005, metadata: { userVisible: false }, content: [{ type: 'text', text: '# Conversation Summary\n\n## User Intent\n- Kiểm tra cấu hình bảo mật' }] },
  { role: 'assistant', created: 1006, metadata: { userVisible: false }, content: [{ type: 'text', text: 'Your context was compacted.' }] },
  { role: 'user', created: 1007, metadata: { userVisible: false, agentVisible: true }, content: [{ type: 'text', text: 'Kiểm tra cấu hình bảo mật' }] },
  { role: 'assistant', created: 1010, content: [{ type: 'text', text: 'Đã hoàn tất kiểm tra cấu hình.' }] }
];

const fullItems = sandbox.buildHistoryItemsFromConversation(fullConversation);
assert.equal(fullItems.filter(i => i.role === 'user').length, 1, 'No duplicate user bubble when original prompt is present');
const fullInternal = fullItems.find(i => i.role === 'internal');
assert.ok(fullInternal, 'Internal item must exist');
assert.equal(fullInternal.questionText, 'Kiểm tra cấu hình bảo mật', 'Internal item must have questionText');

const container = { appendChild() {}, firstChild: null };
sandbox.renderInternalMessageCard(fullInternal, container);
assert.equal(fullInternal.domRow?.dataset?.turnQuestion, 'Kiểm tra cấu hình bảo mật');
assert.equal(fullInternal.domRow?.dataset?.questionText, 'Kiểm tra cấu hình bảo mật');
assert.ok(fullInternal.domRow?.innerHTML?.includes('Đoạn chat của câu hỏi:'), 'Card must render question context header');
assert.ok(fullInternal.domRow?.innerHTML?.includes('Kiểm tra cấu hình bảo mật'), 'Card must show question text in header');

const histText = sandbox.historyItemText(fullInternal);
assert.ok(histText.includes('[Đoạn chat của câu hỏi: Kiểm tra cấu hình bảo mật]'), 'History item text must include question header');

// Test 2.3: Truncated session (e.g. pagination limit=60) where original user prompt is missing
const paginatedConversation = [
  { role: 'user', created: 1005, metadata: { userVisible: false }, content: [{ type: 'text', text: '# Conversation Summary\n\n## User Intent\n- Nâng cấp deploy.bat có tham số' }] },
  { role: 'assistant', created: 1006, metadata: { userVisible: false }, content: [{ type: 'text', text: 'Your context was compacted.' }] },
  { role: 'user', created: 1007, metadata: { userVisible: false, agentVisible: true }, content: [{ type: 'text', text: 'Nâng cấp deploy.bat có tham số: Cho phép gõ deploy.bat id' }] },
  { role: 'assistant', created: 1010, content: [{ type: 'text', text: 'Đã cập nhật deploy.bat' }] }
];

const paginatedItems = sandbox.buildHistoryItemsFromConversation(paginatedConversation);
assert.equal(paginatedItems.filter(i => i.role === 'user').length, 1, 'Synthetic user item must be created above summary when original prompt was truncated');
assert.equal(paginatedItems[0].role, 'user', 'First item must be the user question');
assert.equal(paginatedItems[0].text, 'Nâng cấp deploy.bat có tham số: Cho phép gõ deploy.bat id');
assert.equal(paginatedItems[1].role, 'internal', 'Second item must be internal summary');
assert.equal(paginatedItems[1].questionText, 'Nâng cấp deploy.bat có tham số: Cho phép gõ deploy.bat id');
assert.equal(paginatedItems[2].role, 'assistant', 'Third item must be assistant');
assert.equal(paginatedItems[2].questionText, 'Nâng cấp deploy.bat có tham số: Cho phép gõ deploy.bat id');

// Test 2.4: Subagent card question header
const subagentItem = {
  role: 'subagent',
  questionText: 'Tối ưu hóa các truy vấn SQL',
  subagents: [{ id: '1', status: 'completed', summary: 'Đã tạo index' }]
};
sandbox.renderSubagentReportCard(subagentItem, container);
assert.equal(subagentItem.domRow?.dataset?.turnQuestion, 'Tối ưu hóa các truy vấn SQL');
assert.equal(subagentItem.domRow?.dataset?.questionText, 'Tối ưu hóa các truy vấn SQL');
assert.ok(subagentItem.domRow?.innerHTML?.includes('Đoạn chat của câu hỏi:'), 'Subagent card must render question header');
assert.ok(subagentItem.domRow?.innerHTML?.includes('Tối ưu hóa các truy vấn SQL'), 'Subagent card must show question text in header');

const boundary = { role: 'user', created: 900, content: [{ type: 'text', text: 'Original long-running question' }] };
const tail = [{ role: 'assistant', created: 1000, historyQuestion: boundary, content: [{ type: 'text', text: 'Latest answer' }] }];
const tailItems = sandbox.buildHistoryItemsFromConversation(tail);
assert.equal(tailItems[0].role, 'user');
assert.equal(tailItems[1].questionText, 'Original long-running question');
const mergedItems = sandbox.buildHistoryItemsFromConversation([boundary, ...tail]);
assert.equal(mergedItems.filter(item => item.role === 'user').length, 1, 'Ignore later page context when older rows are loaded');
console.log('Summary question header: All unit and regression tests passed!');
