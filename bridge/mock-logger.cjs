// bridge/mock-logger.cjs - Mock mode log module (CommonJS)
//
// Used by dev-server.cjs:
// - POST /api/mock-log/ingest -> append a log entry
// - GET  /api/mock-log/logs?sinceId=N -> tail log entries
//
// Compatibility goals:
// - Read legacy JSON log files: { entries: [...], nextId }
// - Read real plugin text log files:
//   [2026-03-13T05:40:36.308Z] [init] message {"json":"payload"}
// - Allow seeding mock logs from an existing .log fixture.

const fs = require('fs');
const os = require('os');
const path = require('path');

// Default to repo-local logs/mock so fixtures are easy to inspect and share.
// Fall back to a temp folder if cwd is not writable for some reason.
const DEFAULT_LOG_DIR = path.resolve(process.cwd(), 'logs', 'mock');
const FALLBACK_LOG_DIR = process.platform === 'win32'
  ? path.join(process.env.TEMP || process.env.TMP || path.join(os.homedir(), 'AppData', 'Local', 'Temp'), 'ClawDeck')
  : '/tmp/ClawDeck';

let _logDir = null;
let _logFile = null;
let _logId = 0;
let _maxSize = 5 * 1024 * 1024; // 5MB

/**
 * Initialize mock log file.
 * @param {string} [logDir=DEFAULT_LOG_DIR] - target directory for the new log file
 * @param {object} [options={}] - options
 * @param {number} [options.maxSize=5*1024*1024] - max file size in bytes (approximate)
 * @param {string} [options.seedFrom] - optional seed file path (text or legacy json)
 */
function initMockLog(logDir, options = {}) {
  _maxSize = options.maxSize || _maxSize;

  const targetDir = (logDir === undefined || logDir === null) ? DEFAULT_LOG_DIR : logDir;
  _logDir = _ensureDirWritable(path.resolve(targetDir));

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  _logFile = path.join(_logDir, `clawdeck-${timestamp}.log`);

  const seedPath = _resolveExistingPath(options.seedFrom);
  if (seedPath) {
    _seedLogFile(_logFile, seedPath);
  } else {
    _writeTextHeaderIfNeeded(_logFile, { maxFileSize: _maxSize });
  }

  _logId = _parseLogFile(_logFile).latestId;
  console.log(`[MockLog] Initialized: ${_logFile}${seedPath ? ` (seeded from ${seedPath})` : ''}`);
}

/**
 * Append a log entry (text format) to the current log file.
 * @param {string} cat - category, e.g. init/hook/rpc/error/refresh
 * @param {string} msg - message
 * @returns {{id:number, ts:string, cat:string, msg:string}}
 */
function mockLog(cat, msg) {
  if (!_logFile) initMockLog();

  // Rotate if current file is too large (based on file size on disk).
  try {
    const st = fs.statSync(_logFile);
    if (st.size > _maxSize) {
      _rotateLog();
      _writeTextHeaderIfNeeded(_logFile, { maxFileSize: _maxSize });
    }
  } catch {
    // ignore
  }

  const ts = new Date().toISOString();
  const safeCat = String(cat || 'info').trim() || 'info';
  const safeMsg = String(msg || '').replace(/\r?\n/g, ' ').trim();

  const entry = { id: ++_logId, ts, cat: safeCat, msg: safeMsg };
  const line = `[${ts}] [${safeCat}] ${safeMsg}\n`;
  fs.appendFileSync(_logFile, line, 'utf-8');
  return entry;
}

/**
 * Tail log entries.
 * @param {number} [sinceId=0] - return entries with id > sinceId
 * @returns {{entries: Array, latestId: number, count: number}}
 */
function getMockLogs(sinceId = 0) {
  if (!_logFile || !fs.existsSync(_logFile)) {
    return { entries: [], latestId: _logId, count: 0 };
  }

  const parsed = _parseLogFile(_logFile);
  const entries = parsed.entries.filter(e => e.id > sinceId);
  return { entries, latestId: parsed.latestId, count: entries.length };
}

/**
 * Get latest log id.
 * @returns {number}
 */
function getLatestMockLogId() {
  if (!_logFile || !fs.existsSync(_logFile)) return _logId;
  try {
    return _parseLogFile(_logFile).latestId;
  } catch {
    return _logId;
  }
}

/**
 * Get underlying log file path (debug).
 * @returns {string|null}
 */
function getMockLogPath() {
  return _logFile;
}

function _ensureDirWritable(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    const probe = path.join(dirPath, '.write-probe.tmp');
    fs.writeFileSync(probe, 'ok', 'utf-8');
    fs.unlinkSync(probe);
    return dirPath;
  } catch {
    const fallback = path.resolve(FALLBACK_LOG_DIR);
    if (!fs.existsSync(fallback)) fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

function _resolveExistingPath(p) {
  if (!p) return null;
  const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  try {
    return fs.existsSync(abs) ? abs : null;
  } catch {
    return null;
  }
}

function _writeTextHeaderIfNeeded(filePath, options = {}) {
  if (fs.existsSync(filePath)) return;
  const header = [
    `# ClawDeck Log Started at ${new Date().toISOString()}`,
    `# Options: maxFileSize=${options.maxFileSize ?? _maxSize}`,
    '',
  ].join('\n');
  fs.writeFileSync(filePath, header, 'utf-8');
}

function _seedLogFile(outPath, seedPath) {
  const seedText = fs.readFileSync(seedPath, 'utf-8');
  // If the seed is legacy JSON, convert to text lines so output is consistent.
  const converted = _tryConvertLegacyJsonToText(seedText);
  const text = converted ?? seedText;
  fs.writeFileSync(outPath, text.endsWith('\n') ? text : `${text}\n`, 'utf-8');
}

function _tryConvertLegacyJsonToText(content) {
  try {
    const data = JSON.parse(content);
    if (!data || !Array.isArray(data.entries)) return null;

    const lines = [];
    lines.push(`# ClawDeck Log Started at ${new Date().toISOString()}`);
    lines.push(`# Seed converted from legacy JSON format`);
    lines.push('');
    for (const e of data.entries) {
      const ts = typeof e.ts === 'string' ? e.ts : new Date().toISOString();
      const cat = typeof e.cat === 'string' ? e.cat : 'info';
      const msg = String(e.msg ?? '').replace(/\r?\n/g, ' ').trim();
      lines.push(`[${ts}] [${cat}] ${msg}`);
    }
    lines.push('');
    return lines.join('\n');
  } catch {
    return null;
  }
}

function _rotateLog() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  _logFile = path.join(_logDir, `clawdeck-${timestamp}.log`);
  _logId = 0;
  console.log(`[MockLog] Rotated to: ${_logFile}`);
}

function _parseLogFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');

  // Legacy JSON format.
  try {
    const data = JSON.parse(content);
    if (data && Array.isArray(data.entries)) {
      const entries = data.entries
        .map(e => ({
          id: Number(e.id) || 0,
          ts: String(e.ts || ''),
          cat: String(e.cat || ''),
          msg: String(e.msg || ''),
        }))
        .filter(e => Number.isFinite(e.id) && e.id > 0);
      const latestId = Number(data.nextId) || (entries.length ? entries[entries.length - 1].id : 0);
      return { entries, latestId };
    }
  } catch {
    // fall through to text parser
  }

  const entries = _parseTextLogContent(content);
  const latestId = entries.length ? entries[entries.length - 1].id : 0;
  return { entries, latestId };
}

function _parseTextLogContent(content) {
  const lines = content.split(/\r?\n/);
  const entries = [];
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('#')) continue;
    if (!line.startsWith('[')) continue;

    // Example: [2026-03-13T05:40:36.308Z] [init] message {"json":"payload"}
    const m = line.match(/^\[([^\]]+)\]\s+\[([^\]]+)\]\s*(.*)$/);
    if (!m) continue;
    const ts = m[1].trim();
    const cat = m[2].trim();
    const msg = (m[3] || '').trim();
    entries.push({ id: entries.length + 1, ts, cat, msg });
  }
  return entries;
}

module.exports = {
  initMockLog,
  mockLog,
  getMockLogs,
  getLatestMockLogId,
  getMockLogPath,
};

