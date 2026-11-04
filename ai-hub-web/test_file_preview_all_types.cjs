const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

// 1. Verify HTML frontend structure
const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

assert.ok(html.includes('xlsx.full.min.js'), 'Must include SheetJS library for Excel');
assert.ok(html.includes('mammoth.browser.min.js'), 'Must include Mammoth library for Word (.docx)');
assert.ok(html.includes('docx-preview.min.js'), 'Must include docx-preview library for paginated Word rendering');

// Verify Preview Containers
assert.ok(html.includes('id="filePreviewVideoContainer"'), 'Must have Video preview container');
assert.ok(html.includes('id="filePreviewAudioContainer"'), 'Must have Audio preview container');
assert.ok(html.includes('id="filePreviewPdfContainer"'), 'Must have PDF preview container');
assert.ok(html.includes('id="filePreviewDocxContainer"'), 'Must have Word (.docx) preview container');
assert.ok(html.includes('id="filePreviewDocLegacyContainer"'), 'Must have Word (.doc legacy) preview container');
assert.ok(html.includes('id="filePreviewDocxLoading"'), 'Must have Word scoped loading overlay');
assert.ok(html.includes('id="filePreviewDocxError"'), 'Must have Word scoped error overlay');
assert.ok(html.includes('id="filePreviewSheetContainer"'), 'Must have Excel (.xlsx) preview container');
assert.ok(html.includes('id="filePreviewMarkdownContainer"'), 'Must have Markdown rendered container');
assert.ok(html.includes('id="filePreviewHtmlContainer"'), 'Must have HTML sandbox container');

// Verify Buttons and Tabs
assert.ok(html.includes('id="fileTabPreviewBtn"'), 'Must have Preview tab button');
assert.ok(html.includes('id="filePreviewNewTabBtn"'), 'Must have New Tab button');
assert.ok(html.includes('id="filePreviewOpenBtn"'), 'Must have Open on PC button');
assert.ok(html.includes('id="filePreviewCopyBtn"'), 'Must have Copy button');

// Verify attach files list has preview trigger
assert.ok(html.includes("previewLocalFile('${escapeJs(item.path)}', event)"), 'Attach files modal must have preview button for each file item');

// 2. Test server.js logic and API behavior
// Check that server.js includes the new routes and mime helpers
const serverSrc = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
assert.ok(serverSrc.includes('pathname === "/api/file-raw"'), 'server.js must implement /api/file-raw');
assert.ok(serverSrc.includes('getPreviewMimeType'), 'server.js must have getPreviewMimeType');
assert.ok(serverSrc.includes('getPreviewFileType'), 'server.js must have getPreviewFileType');

// Create temp test files of various types in a temp directory
const tempDir = path.join(__dirname, 'test_tmp_preview_' + Date.now());
fs.mkdirSync(tempDir, { recursive: true });

try {
  const testDocx = path.join(tempDir, 'sample.docx');
  const testXlsx = path.join(tempDir, 'data.xlsx');
  const testPdf = path.join(tempDir, 'manual.pdf');
  const testMp4 = path.join(tempDir, 'clip.mp4');
  const testMp3 = path.join(tempDir, 'song.mp3');
  const testPng = path.join(tempDir, 'pic.png');
  const testMd = path.join(tempDir, 'readme.md');
  const testHtml = path.join(tempDir, 'index.html');
  const testJs = path.join(tempDir, 'app.js');

  // Dummy contents
  fs.writeFileSync(testDocx, Buffer.from([0x50, 0x4b, 0x03, 0x04])); // ZIP header
  fs.writeFileSync(testXlsx, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  fs.writeFileSync(testPdf, Buffer.from('%PDF-1.4\n%test\n'));
  fs.writeFileSync(testMp4, Buffer.from('test mp4 content video data stream 1234567890'));
  fs.writeFileSync(testMp3, Buffer.from('test mp3 content audio data stream 1234567890'));
  fs.writeFileSync(testPng, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(testMd, '# Hello World\n\n- Item 1\n- Item 2\n');
  fs.writeFileSync(testHtml, '<!DOCTYPE html><html><body><h1>Test</h1></body></html>');
  fs.writeFileSync(testJs, 'const x = 42; console.log(x);');

  // Helper to extract mime type and preview type from docx-pdf-service module
  const docxPdfService = require('./docx-pdf-service.cjs');
  assert.ok(serverSrc.includes('docx-pdf-service.cjs'), 'server.js must import docx-pdf-service.cjs');
  assert.ok(typeof docxPdfService.getPreviewMimeType === 'function', 'Must have getPreviewMimeType function');
  assert.ok(typeof docxPdfService.getPreviewFileType === 'function', 'Must have getPreviewFileType function');

  const getMime = docxPdfService.getPreviewMimeType;
  const getType = docxPdfService.getPreviewFileType;

  // Test mime mappings
  assert.equal(getMime(testDocx), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(getMime(testXlsx), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(getMime(testPdf), 'application/pdf');
  assert.equal(getMime(testMp4), 'video/mp4');
  assert.equal(getMime(testMp3), 'audio/mpeg');
  assert.equal(getMime(testPng), 'image/png');
  assert.equal(getMime(testMd), 'text/markdown; charset=utf-8');
  assert.equal(getMime(testHtml), 'text/html; charset=utf-8');
  assert.equal(getMime(testJs), 'text/javascript; charset=utf-8');

  // Test file type mappings
  assert.equal(getType('.docx'), 'docx');
  assert.equal(getType('.doc'), 'doc-legacy');
  assert.equal(getType('.xlsx'), 'excel');
  assert.equal(getType('.xls'), 'excel');
  assert.equal(getType('.csv'), 'csv');
  assert.equal(getType('.pdf'), 'pdf');
  assert.equal(getType('.mp4'), 'video');
  assert.equal(getType('.mov'), 'video');
  assert.equal(getType('.mp3'), 'audio');
  assert.equal(getType('.wav'), 'audio');
  assert.equal(getType('.png'), 'image');
  assert.equal(getType('.jpg'), 'image');
  assert.equal(getType('.webp'), 'image');
  assert.equal(getType('.md'), 'markdown');
  assert.equal(getType('.html'), 'html');
  assert.equal(getType('.js'), 'code');
  assert.equal(getType('.py'), 'code');

  console.log('All file preview types (Word, Excel, PDF, Video, Audio, Image, Markdown, HTML, Code) passed regression verification!');
} finally {
  // Cleanup temp files
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (_) {}
}
