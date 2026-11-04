const fs = require('node:fs');
const path = require('node:path');

function installRuntimeDiagnostics(logDir, runtime = process) {
  const file = path.join(logDir, 'runtime.log');
  const previous = path.join(logDir, 'runtime.previous.log');
  function record(event, details = {}) {
    try {
      fs.mkdirSync(logDir, { recursive: true });
      if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) {
        fs.renameSync(file, previous);
      }
      const memory = runtime.memoryUsage();
      fs.appendFileSync(file, JSON.stringify({
        time: new Date().toISOString(), pid: runtime.pid, event,
        rssMB: Math.round(memory.rss / 1048576),
        heapMB: Math.round(memory.heapUsed / 1048576), ...details
      }) + '\n');
    } catch { /* Diagnostics must not interrupt the server. */ }
  }
  record('start', { node: runtime.version, parentPid: runtime.ppid });
  // Observe fatal exceptions without suppressing Node's normal crash behavior.
  runtime.on('uncaughtExceptionMonitor', (error, origin) => {
    record('uncaught_exception', { origin, error: String(error.stack || error).slice(0, 12000) });
  });
  runtime.on('warning', warning => {
    record('warning', { error: String(warning.stack || warning).slice(0, 12000) });
  });
  runtime.on('exit', code => record('exit', { code }));
  const timer = setInterval(() => record('heartbeat'), 60000);
  timer.unref();
  return { record, stop: () => clearInterval(timer) };
}

module.exports = { installRuntimeDiagnostics };
