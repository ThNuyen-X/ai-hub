"use strict";

const path = require("node:path");

// 1. MIME and File Type classification
const MIME_MAP = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".csv": "text/csv; charset=utf-8",
  ".tsv": "text/tab-separated-values; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "video/ogg",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

function getPreviewMimeType(filePath) {
  const ext = path.extname(filePath || "").toLowerCase();
  return MIME_MAP[ext] || "application/octet-stream";
}

function getPreviewFileType(ext) {
  ext = (ext || "").toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp"].includes(ext)) return "image";
  if ([".mp4", ".webm", ".ogg", ".mov"].includes(ext)) return "video";
  if ([".mp3", ".wav", ".m4a", ".flac", ".aac"].includes(ext)) return "audio";
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  if (ext === ".doc") return "doc-legacy";
  if ([".xlsx", ".xls"].includes(ext)) return "excel";
  if ([".csv", ".tsv"].includes(ext)) return "csv";
  if ([".md", ".markdown"].includes(ext)) return "markdown";
  if ([".html", ".htm"].includes(ext)) return "html";
  return "code";
}

module.exports = { getPreviewMimeType, getPreviewFileType };
