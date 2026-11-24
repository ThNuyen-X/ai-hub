const http = require("node:http");

const MAX_TRANSIENT_RETRIES = 3;
const DEFAULT_MAX_RESET_WAIT_SEC = 300;
const DEFAULT_KIRO_MIN_INTERVAL_MS = 2800;
const DEFAULT_KIRO_MAX_CONCURRENCY = 1;

const PERMANENT_ERROR_RE = /(?:invalid_api_key|incorrect api key|authentication_error|permission_denied|context_length_exceeded|maximum context length|model_not_found|does not exist|unsupported_parameter)/i;

const TRANSIENT_ERROR_RE = /(?:429|502|503|504|529|Service Unavailable|Bad Gateway|Gateway Timeout|Too many requests|too_many_requests|rate_limit_exceeded|rate[-_ ]limit|overloaded|overloaded_error|(?:reset|retry)\s+after\s+(?:\d+(?:\.\d+)?\s*[hms]\s*)+|Please retry if you think this is a transient or recoverable error|ECONNRESET|ETIMEDOUT|socket hang up)/i;

function isTransientProviderError(errorText = "", statusCode = 0) {
  const text = String(errorText || "");
  if (PERMANENT_ERROR_RE.test(text)) return false;
  if ([429, 502, 503, 504, 529].includes(Number(statusCode))) return true;
  return TRANSIENT_ERROR_RE.test(text);
}

function isKiroModel(model = "") {
  const normalized = String(model || "").trim().toLowerCase();
  return normalized.startsWith("kr/") || normalized.startsWith("kiro/") || normalized === "kiro";
}

function getRateLimitBucketKey(model = "") {
  const normalized = String(model || "").trim().toLowerCase();
  if (!normalized) return "";
  if (isKiroModel(normalized)) return "provider:kiro";
  return `model:${normalized}`;
}

function formatDurationShort(ms = 0) {
  const totalSec = Math.max(1, Math.ceil(Number(ms || 0) / 1000));
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hours > 0) {
    return mins > 0 ? `${hours}h ${mins}m ${secs}s` : `${hours}h ${secs}s`;
  }
  if (mins > 0) {
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  return `${secs}s`;
}

function parseDurationExpressionSeconds(expr = "") {
  const raw = String(expr || "").trim();
  if (!raw) return 0;
  let total = 0;
  let matched = false;
  const partRe = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)\b/gi;
  let m;
  while ((m = partRe.exec(raw)) !== null) {
    const val = parseFloat(m[1]);
    if (Number.isNaN(val) || val < 0) continue;
    const unit = m[2].toLowerCase();
    matched = true;
    if (unit.startsWith("h")) total += val * 3600;
    else if (unit.startsWith("m")) total += val * 60;
    else total += val;
  }
  return matched ? total : 0;
}

function parseResetAfterSeconds(errorText = "", retryAfterHeader = "") {
  const text = String(errorText || "");

  // Match compound durations such as "reset after 2m 14s", "reset after 1h 2m 5s", "retry after 45s", "reset after 3m"
  const phraseMatch = text.match(/(?:reset|retry)\s+after\s+((?:\d+(?:\.\d+)?\s*(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)\b\s*)+)/i);
  if (phraseMatch) {
    const secs = parseDurationExpressionSeconds(phraseMatch[1]);
    if (secs > 0) return secs;
  }

  const jsonRetryMatch = text.match(/"retry_after"\s*:\s*(\d+(?:\.\d+)?)/i);
  if (jsonRetryMatch) {
    const secs = parseFloat(jsonRetryMatch[1]) || 0;
    if (secs > 0) return secs;
  }

  if (retryAfterHeader) {
    const trimmed = String(retryAfterHeader).trim();
    const numericSec = parseFloat(trimmed);
    if (!Number.isNaN(numericSec) && numericSec > 0 && /^\d+(?:\.\d+)?$/.test(trimmed)) {
      return numericSec;
    }
    const parsedDate = Date.parse(trimmed);
    if (!Number.isNaN(parsedDate)) {
      const diffSec = (parsedDate - Date.now()) / 1000;
      if (diffSec > 0) return diffSec;
    }
  }

  return 0;
}

function parseTransientRetryDelayMs(errorText = "", attempt = 1, retryAfterHeader = "", baseMsOverride = undefined, maxResetWaitSec = DEFAULT_MAX_RESET_WAIT_SEC) {
  const safeAttempt = Math.max(1, Number(attempt) || 1);
  if (baseMsOverride !== undefined && baseMsOverride !== null && !Number.isNaN(Number(baseMsOverride))) {
    return Math.max(10, Number(baseMsOverride) * safeAttempt);
  }

  const resetSec = parseResetAfterSeconds(errorText, retryAfterHeader);
  if (resetSec > 0) {
    const capSec = Math.max(10, Number(maxResetWaitSec) || DEFAULT_MAX_RESET_WAIT_SEC);
    const clampedSec = Math.min(Math.max(resetSec, 0.5), capSec);
    return Math.round(clampedSec * 1000 + 1500 + (safeAttempt - 1) * 1000);
  }

  const baseMs = 2200;
  return Math.min(20000, baseMs * safeAttempt);
}

function cleanupTrailingTransientErrorMessages(DatabaseSync, dbPath, sessionId) {
  if (!DatabaseSync || !dbPath || !sessionId) return 0;
  let db;
  try {
    db = new DatabaseSync(dbPath);
    const rows = db.prepare(
      "SELECT id, role, content_json FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 3"
    ).all(sessionId);
    let deleted = 0;
    for (const row of rows) {
      let parsed = [];
      try { parsed = JSON.parse(row.content_json || "[]"); } catch {}
      if (!Array.isArray(parsed) || parsed.length === 0) break;
      const isOnlyTransientErr = row.role === "assistant" && parsed.every(
        item => item && item.type === "error" && isTransientProviderError(item.message || item.text || "")
      );
      if (isOnlyTransientErr) {
        db.prepare("DELETE FROM messages WHERE id = ?").run(row.id);
        deleted++;
      } else {
        break;
      }
    }
    return deleted;
  } catch {
    return 0;
  } finally {
    if (db) {
      try { db.close(); } catch {}
    }
  }
}

function createLlmRetryProxy(options = {}) {
  const getTargetHost = typeof options.getTargetHost === "function"
    ? options.getTargetHost
    : () => options.targetHost || "127.0.0.1";
  const getTargetPort = typeof options.getTargetPort === "function"
    ? options.getTargetPort
    : () => Number(options.targetPort || 20128);
  const maxRetries = options.maxRetries !== undefined ? Number(options.maxRetries) : 4;
  const minModelIntervalMs = options.minModelIntervalMs !== undefined ? Number(options.minModelIntervalMs) : 1150;
  const kiroMinIntervalMs = options.kiroMinIntervalMs !== undefined
    ? Number(options.kiroMinIntervalMs)
    : (process.env.AI_HUB_KIRO_MIN_INTERVAL_MS !== undefined
      ? Math.max(0, Number(process.env.AI_HUB_KIRO_MIN_INTERVAL_MS) || 0)
      : DEFAULT_KIRO_MIN_INTERVAL_MS);
  const kiroMaxConcurrency = options.kiroMaxConcurrency !== undefined
    ? Math.max(1, Number(options.kiroMaxConcurrency) || 1)
    : (process.env.AI_HUB_KIRO_MAX_CONCURRENCY !== undefined
      ? Math.max(1, Number(process.env.AI_HUB_KIRO_MAX_CONCURRENCY) || 1)
      : DEFAULT_KIRO_MAX_CONCURRENCY);
  const maxResetWaitSec = options.maxResetWaitSec !== undefined
    ? Number(options.maxResetWaitSec)
    : DEFAULT_MAX_RESET_WAIT_SEC;
  const baseMsOverride = options.baseMsOverride;
  const onRetry = typeof options.onRetry === "function" ? options.onRetry : null;
  const onCooldownWait = typeof options.onCooldownWait === "function" ? options.onCooldownWait : null;

  // Per-bucket pacing, shared cooldown, and concurrency queue state
  const bucketNextSlotAt = new Map();
  const bucketCooldownUntil = new Map();
  const bucketQueues = new Map();

  function getBucketIntervalMs(modelKey) {
    if (!modelKey) return 0;
    return isKiroModel(modelKey) ? kiroMinIntervalMs : minModelIntervalMs;
  }

  function getBucketConcurrencyLimit(modelKey) {
    if (isKiroModel(modelKey)) return kiroMaxConcurrency;
    return 0; // 0 = unlimited concurrency for non-Kiro models
  }

  function pruneOldMapEntries(map, now) {
    if (map.size <= 200) return;
    for (const [k, v] of map.entries()) {
      if (v < now - 60000) map.delete(k);
    }
  }

  function setSharedCooldown(modelKey, delayMs) {
    const bucketKey = getRateLimitBucketKey(modelKey);
    if (!bucketKey || !delayMs || delayMs <= 0) return;
    const now = Date.now();
    const until = now + delayMs;
    const prev = bucketCooldownUntil.get(bucketKey) || 0;
    if (until > prev) {
      bucketCooldownUntil.set(bucketKey, until);
    }
    pruneOldMapEntries(bucketCooldownUntil, now);
  }

  function getSharedCooldownRemainingMs(modelKey) {
    const bucketKey = getRateLimitBucketKey(modelKey);
    if (!bucketKey) return 0;
    const until = bucketCooldownUntil.get(bucketKey) || 0;
    if (!until) return 0;
    const rem = until - Date.now();
    if (rem <= 0) {
      bucketCooldownUntil.delete(bucketKey);
      return 0;
    }
    return rem;
  }

  function reserveModelPacingDelay(modelKey) {
    const bucketKey = getRateLimitBucketKey(modelKey);
    const intervalMs = getBucketIntervalMs(modelKey);
    if (!bucketKey) return 0;
    const now = Date.now();
    const cooldownUntil = bucketCooldownUntil.get(bucketKey) || 0;
    const nextAllowed = Math.max(bucketNextSlotAt.get(bucketKey) || 0, cooldownUntil);
    const slotTime = Math.max(now, nextAllowed);
    if (intervalMs > 0) {
      bucketNextSlotAt.set(bucketKey, slotTime + intervalMs);
      pruneOldMapEntries(bucketNextSlotAt, now);
    }
    return Math.max(0, slotTime - now);
  }

  function bumpBucketNextSlotAfterCompletion(modelKey) {
    const bucketKey = getRateLimitBucketKey(modelKey);
    const intervalMs = getBucketIntervalMs(modelKey);
    if (!bucketKey || intervalMs <= 0) return;
    const now = Date.now();
    const prev = bucketNextSlotAt.get(bucketKey) || 0;
    const next = now + intervalMs;
    if (next > prev) {
      bucketNextSlotAt.set(bucketKey, next);
    }
    pruneOldMapEntries(bucketNextSlotAt, now);
  }

  function getQueueState(bucketKey) {
    let q = bucketQueues.get(bucketKey);
    if (!q) {
      q = { active: 0, waiters: [] };
      bucketQueues.set(bucketKey, q);
    }
    return q;
  }

  function acquireConcurrencySlot(modelKey, isAbortedFn, onAcquired) {
    const limit = getBucketConcurrencyLimit(modelKey);
    const bucketKey = getRateLimitBucketKey(modelKey);
    if (!bucketKey || limit <= 0) {
      onAcquired(() => {});
      return () => {};
    }

    const q = getQueueState(bucketKey);
    let cancelled = false;
    let released = false;

    const release = () => {
      if (released) return;
      released = true;
      q.active = Math.max(0, q.active - 1);
      bumpBucketNextSlotAfterCompletion(modelKey);
      drainQueue();
    };

    const drainQueue = () => {
      while (q.active < limit && q.waiters.length > 0) {
        const nextWaiter = q.waiters.shift();
        if (!nextWaiter || nextWaiter.cancelled || nextWaiter.isAbortedFn()) {
          continue;
        }
        q.active++;
        nextWaiter.run();
        return;
      }
      if (q.active === 0 && q.waiters.length === 0) {
        bucketQueues.delete(bucketKey);
      }
    };

    if (q.active < limit) {
      q.active++;
      onAcquired(release);
      return () => {
        cancelled = true;
        release();
      };
    }

    const waiter = {
      cancelled: false,
      isAbortedFn,
      run: () => {
        if (cancelled || isAbortedFn()) {
          release();
          return;
        }
        onAcquired(release);
      }
    };
    q.waiters.push(waiter);

    return () => {
      cancelled = true;
      waiter.cancelled = true;
      const idx = q.waiters.indexOf(waiter);
      if (idx !== -1) q.waiters.splice(idx, 1);
      if (q.active === 0 && q.waiters.length === 0) {
        bucketQueues.delete(bucketKey);
      }
    };
  }

  function handleProxyRequest(req, res) {
    const bodyChunks = [];
    let reqAborted = false;
    let activeTimer = null;
    let activeUpReq = null;
    let cancelSlot = null;

    const isClosed = () => reqAborted || res.writableEnded || res.destroyed;

    const cleanupOnAbort = () => {
      if (reqAborted) return;
      reqAborted = true;
      if (activeTimer) {
        clearTimeout(activeTimer);
        activeTimer = null;
      }
      if (activeUpReq) {
        try { activeUpReq.destroy(); } catch {}
        activeUpReq = null;
      }
      if (cancelSlot) {
        try { cancelSlot(); } catch {}
        cancelSlot = null;
      }
    };

    req.on("aborted", cleanupOnAbort);
    res.on("close", () => {
      if (!res.writableEnded) cleanupOnAbort();
    });

    req.on("data", chunk => {
      bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      if (isClosed()) return;
      const bodyBuffer = Buffer.concat(bodyChunks);
      let modelKey = "";
      if (req.method === "POST" && bodyBuffer.length > 0 && bodyBuffer.length < 5 * 1024 * 1024) {
        try {
          const headStr = bodyBuffer.slice(0, 2048).toString("utf8");
          const m = headStr.match(/"model"\s*:\s*"([^"]+)"/);
          if (m) modelKey = m[1].trim().toLowerCase();
        } catch {}
      }

      const forwardHeaders = { ...req.headers };
      delete forwardHeaders.host;
      delete forwardHeaders.connection;
      delete forwardHeaders["transfer-encoding"];
      forwardHeaders["content-length"] = String(bodyBuffer.length);

      const attemptRequest = (attempt, notifiedCooldownWait = false) => {
        if (isClosed()) return;

        // If the provider bucket is already in a shared cooldown window, wait before taking a concurrency slot
        const sharedCooldownMs = getSharedCooldownRemainingMs(modelKey);
        if (sharedCooldownMs > 0) {
          if (!notifiedCooldownWait && onCooldownWait && sharedCooldownMs >= 2000) {
            try {
              onCooldownWait({
                model: modelKey,
                delayMs: sharedCooldownMs,
                bucket: getRateLimitBucketKey(modelKey)
              });
            } catch {}
          }
          activeTimer = setTimeout(() => {
            activeTimer = null;
            attemptRequest(attempt, true);
          }, sharedCooldownMs + 100);
          if (activeTimer && typeof activeTimer.unref === "function") activeTimer.unref();
          return;
        }

        cancelSlot = acquireConcurrencySlot(modelKey, isClosed, (releaseSlot) => {
          if (isClosed()) {
            releaseSlot();
            return;
          }

          // Re-check shared cooldown after waiting in concurrency queue
          const postQueueCooldownMs = getSharedCooldownRemainingMs(modelKey);
          if (postQueueCooldownMs > 0) {
            releaseSlot();
            cancelSlot = null;
            if (!notifiedCooldownWait && onCooldownWait && postQueueCooldownMs >= 2000) {
              try {
                onCooldownWait({
                  model: modelKey,
                  delayMs: postQueueCooldownMs,
                  bucket: getRateLimitBucketKey(modelKey)
                });
              } catch {}
            }
            activeTimer = setTimeout(() => {
              activeTimer = null;
              attemptRequest(attempt, true);
            }, postQueueCooldownMs + 100);
            if (activeTimer && typeof activeTimer.unref === "function") activeTimer.unref();
            return;
          }

          const pacingDelayMs = reserveModelPacingDelay(modelKey);

          const startUpstream = () => {
            if (isClosed()) {
              releaseSlot();
              cancelSlot = null;
              return;
            }
            const targetHost = getTargetHost();
            const targetPort = getTargetPort();

            const upReq = http.request(
              {
                hostname: targetHost,
                port: targetPort,
                path: req.url,
                method: req.method,
                headers: { ...forwardHeaders, host: `${targetHost}:${targetPort}` }
              },
              (upRes) => {
                const statusCode = upRes.statusCode || 502;
                if (statusCode >= 200 && statusCode < 400) {
                  let streamDone = false;
                  const finishStream = () => {
                    if (streamDone) return;
                    streamDone = true;
                    activeUpReq = null;
                    releaseSlot();
                    cancelSlot = null;
                  };
                  upRes.on("end", finishStream);
                  upRes.on("close", finishStream);
                  upRes.on("error", finishStream);
                  res.on("finish", finishStream);
                  res.writeHead(statusCode, upRes.headers);
                  upRes.pipe(res);
                  return;
                }

                // Non-2xx status: buffer error body to inspect if it's a transient rate limit / 503
                const errChunks = [];
                upRes.on("data", c => errChunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
                upRes.on("end", () => {
                  activeUpReq = null;
                  releaseSlot();
                  cancelSlot = null;

                  if (isClosed()) return;
                  const errBuf = Buffer.concat(errChunks);
                  const errText = errBuf.toString("utf8");

                  if (isTransientProviderError(errText, statusCode)) {
                    const delayMs = parseTransientRetryDelayMs(
                      errText,
                      attempt,
                      upRes.headers["retry-after"] || "",
                      baseMsOverride,
                      maxResetWaitSec
                    );
                    // Record shared cooldown for all sessions using the same bucket (e.g. provider:kiro)
                    if (statusCode === 429 || statusCode === 503 || parseResetAfterSeconds(errText, upRes.headers["retry-after"] || "") > 0) {
                      setSharedCooldown(modelKey, delayMs);
                    }
                    if (attempt <= maxRetries) {
                      if (onRetry) {
                        try {
                          onRetry({
                            model: modelKey,
                            attempt,
                            maxRetries,
                            delayMs,
                            statusCode,
                            errorText: errText
                          });
                        } catch {}
                      }
                      activeTimer = setTimeout(() => {
                        activeTimer = null;
                        attemptRequest(attempt + 1, true);
                      }, delayMs);
                      if (activeTimer && typeof activeTimer.unref === "function") activeTimer.unref();
                      return;
                    }
                  }

                  const outHeaders = { ...upRes.headers, "content-length": String(errBuf.length) };
                  res.writeHead(statusCode, outHeaders);
                  res.end(errBuf);
                });
              }
            );

            activeUpReq = upReq;

            upReq.on("error", (err) => {
              activeUpReq = null;
              releaseSlot();
              cancelSlot = null;

              if (isClosed()) return;
              const errText = err && err.message ? err.message : "Upstream network error";
              if (attempt <= maxRetries && isTransientProviderError(errText, 503)) {
                const delayMs = parseTransientRetryDelayMs(errText, attempt, "", baseMsOverride, maxResetWaitSec);
                if (onRetry) {
                  try {
                    onRetry({
                      model: modelKey,
                      attempt,
                      maxRetries,
                      delayMs,
                      statusCode: 503,
                      errorText: errText
                    });
                  } catch {}
                }
                activeTimer = setTimeout(() => {
                  activeTimer = null;
                  attemptRequest(attempt + 1, true);
                }, delayMs);
                if (activeTimer && typeof activeTimer.unref === "function") activeTimer.unref();
                return;
              }
              if (!res.headersSent) {
                const payload = JSON.stringify({ error: { message: `Upstream connection failed: ${errText}`, type: "upstream_error" } });
                res.writeHead(502, { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(payload)) });
                res.end(payload);
              } else {
                try { res.end(); } catch {}
              }
            });

            if (bodyBuffer.length > 0) {
              upReq.write(bodyBuffer);
            }
            upReq.end();
          };

          if (pacingDelayMs > 0) {
            activeTimer = setTimeout(() => {
              activeTimer = null;
              startUpstream();
            }, pacingDelayMs);
            if (activeTimer && typeof activeTimer.unref === "function") activeTimer.unref();
          } else {
            startUpstream();
          }
        });
      };

      attemptRequest(1, false);
    });
  }

  return {
    handleProxyRequest,
    reserveModelPacingDelay,
    setSharedCooldown,
    getSharedCooldownRemainingMs
  };
}

module.exports = {
  MAX_TRANSIENT_RETRIES,
  DEFAULT_MAX_RESET_WAIT_SEC,
  DEFAULT_KIRO_MIN_INTERVAL_MS,
  DEFAULT_KIRO_MAX_CONCURRENCY,
  isTransientProviderError,
  isKiroModel,
  getRateLimitBucketKey,
  formatDurationShort,
  parseDurationExpressionSeconds,
  parseResetAfterSeconds,
  parseTransientRetryDelayMs,
  cleanupTrailingTransientErrorMessages,
  createLlmRetryProxy
};
