// dev-server.cjs — 轻量开发服务器，模拟 OpenClaw Gateway 的 HTTP 路由
// 用于本地前端开发和测试
//
// 用法：
//   node dev-server.cjs              → 真实模式，连接 OpenClaw Gateway
//   node dev-server.cjs --mock       → Mock 模式（默认 demo 场景）
//   node dev-server.cjs --mock=stress → Mock 模式（指定场景）

const http = require('http');
const fs = require('fs');
const path = require('path');
const { initMockLog, mockLog, getMockLogs, getLatestMockLogId } = require('./bridge/mock-logger.cjs');

// --- 解析 CLI 参数 ---
const args = process.argv.slice(2);
const mockArg = args.find(a => a.startsWith('--mock'));
let mockScenario = null;
if (mockArg) {
  mockScenario = mockArg.includes('=') ? mockArg.split('=')[1] : 'demo';
}

function getArgValue(flag) {
  const eq = args.find(a => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) {
    const next = args[idx + 1];
    if (next && !next.startsWith('--')) return next;
  }
  return null;
}

// Optional: seed mock-log dataset from an existing log file (text or legacy json).
// Example: node dev-server.cjs --mock --mock-log-seed=logs/refresh.log
const mockLogSeed = getArgValue('--mock-log-seed') || process.env.CLAWDECK_MOCK_LOG_SEED || null;

const PORT = process.env.PORT || 20000;
const ROOT = __dirname;
const ASSETS = path.join(ROOT, 'plugin', 'assets');
const ALLOWED_ROOT_DIRS = ['engine', 'world', 'ui', 'bridge', 'css', 'i18n'];

// Mock 模式下的 AI 建议状态内存存储
const mockAdviceStatus = {
  'advice-004': {
    status: 'completed',
    resultSummary: '爪爪已清理 512MB 过期日志文件，磁盘占用恢复正常。',
    updatedAt: new Date().toISOString(),
  },
  'advice-003': {
    status: 'dispatched',
    sessionId: 'mock-session-001',
    updatedAt: new Date().toISOString(),
  },
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

function loadMockAgentProfiles(scenario) {
  const defaultPath = path.join(ASSETS, 'agent-profiles.default.json');
  let profiles = {};

  try {
    const raw = JSON.parse(fs.readFileSync(defaultPath, 'utf-8'));
    profiles = raw && typeof raw === 'object' && raw.profiles && typeof raw.profiles === 'object'
      ? { ...raw.profiles }
      : {};
  } catch {
    profiles = {};
  }

  if (scenario === 'demo') {
    return {
      profiles: {
        ...profiles,
        'agent-1': { ...profiles['agent-1'], traits: ['细致', '准时'] },
        'agent-2': { ...profiles['agent-2'], traits: ['严格', '强迫症'] },
        'agent-3': { ...profiles['agent-3'], traits: ['理性', '谨慎'] },
        'agent-4': { ...profiles['agent-4'], traits: ['灵感爆棚', '猫娘'] },
        'agent-5': { ...profiles['agent-5'] },
      },
    };
  }

  return { profiles };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let relPath = url.pathname;

  // CORS 头（允许跨域请求）
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // 处理预检请求
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // --- Mock 日志 API ---
  if (relPath === '/api/mock-log/logs' && req.method === 'GET') {
    const sinceId = parseInt(url.searchParams.get('sinceId') || '0', 10);
    const result = getMockLogs(sinceId);
    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  if (relPath === '/api/mock-log/ingest' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { cat, msg } = JSON.parse(body);
        const entry = mockLog(cat || 'rpc', msg || '');
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, entry }));
      } catch (err) {
        res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // --- Mock 日志路径查询 ---
  if (relPath === '/api/mock-log/path' && req.method === 'GET') {
    const logPath = require('./bridge/mock-logger.cjs').getMockLogPath();
    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ path: logPath }));
    return;
  }

  // Mock: Agent profiles（与插件生产路由 /plugins/clawdeck/api/agent-profiles 路径一致）
  if ((relPath === '/plugins/clawdeck/api/agent-profiles' || relPath === '/plugins/clawdeck/api/agent-profiles/') && req.method === 'GET') {
    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(loadMockAgentProfiles(mockScenario)));
    return;
  }

  // Mock: AI 建议状态内存存储（PATCH 更新，GET 读取合并）
  // Mock: PATCH /plugins/clawdeck/api/ai-advices/:id — 更新建议状态
  if (relPath.startsWith('/plugins/clawdeck/api/ai-advices/') && req.method === 'PATCH') {
    const adviceId = decodeURIComponent(relPath.slice('/plugins/clawdeck/api/ai-advices/'.length));
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { status, sessionId, resultSummary } = JSON.parse(body);
        const validStatuses = ['pending', 'dispatched', 'completed', 'failed', 'dismissed'];
        if (!status || !validStatuses.includes(status)) {
          res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid status' }));
          return;
        }
        mockAdviceStatus[adviceId] = {
          status,
          ...(sessionId ? { sessionId } : {}),
          ...(resultSummary ? { resultSummary } : {}),
          updatedAt: new Date().toISOString(),
        };
        // Mock 模式：dispatch 后 3 秒自动推进到 completed
        if (status === 'dispatched') {
          setTimeout(() => {
            if (mockAdviceStatus[adviceId]?.status === 'dispatched') {
              mockAdviceStatus[adviceId] = {
                status: 'completed',
                resultSummary: '伙伴已完成委托，任务顺利收工～',
                updatedAt: new Date().toISOString(),
              };
              console.log(`[Mock] 建议 ${adviceId} 自动推进到 completed`);
            }
          }, 3000);
        }
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, adviceId, status }));
      } catch (err) {
        res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Mock: AI 建议数据（与插件生产路由 /plugins/clawdeck/api/ai-advices 路径一致）
  if (relPath === '/plugins/clawdeck/api/ai-advices' && req.method === 'GET') {
    const filePath = path.join(ROOT, 'plugin', 'data', 'ai-advices.json');
    const includeAll = url.searchParams.get('include') === 'all';
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const advices = (raw.advices || []).map(a => {
        const st = mockAdviceStatus[a.id];
        return {
          ...a,
          status: st ? st.status : 'pending',
          ...(st?.sessionId ? { sessionId: st.sessionId } : {}),
          ...(st?.runId ? { runId: st.runId } : {}),
          ...(st?.resultSummary ? { resultSummary: st.resultSummary } : {}),
          ...(st?.updatedAt ? { statusUpdatedAt: st.updatedAt } : {}),
        };
      });
      const filtered = includeAll
        ? advices
        : advices.filter(a => a.status === 'pending' || a.status === 'dispatched');
      filtered.sort((a, b) => (b.priority || 0) - (a.priority || 0));
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ advices: filtered, config: raw.config || { maxAdviceCount: 3 } }));
    } catch {
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ advices: [], config: { maxAdviceCount: 3 } }));
    }
    return;
  }

  // "/" 或 "/plugins/clawdeck/" → plugin/assets/index.html
  // 先规范化插件首页路径，避免内联 module 的相对导入在无尾随斜杠 URL 下被错误解析
  if (relPath === '/plugins/clawdeck') {
    const fullUrl = 'http://localhost:' + (PORT || 20000) + req.url;
    const url = new URL(fullUrl);
    const location = `/plugins/clawdeck/${url.search}`;
    res.writeHead(302, { 'Location': location });
    res.end();
    return;
  }

  // Mock 模式下：如果 URL 没有 ?mock 参数，自动重定向
  if (relPath === '/' || relPath === '/index.html' || relPath === '/plugins/clawdeck/') {
    const fullUrl = 'http://localhost:' + (PORT || 20000) + req.url;
    const url = new URL(fullUrl);
    if (mockScenario && !url.searchParams.has('mock')) {
      res.writeHead(302, { 'Location': `/?mock=${mockScenario}` });
      res.end();
      return;
    }
    return serveFile(res, path.join(ASSETS, 'index.html'));
  }

  // 规范化路径（移除前导斜杠，避免 Windows path.join 问题）
  let normalizedPath = relPath.startsWith('/') ? relPath.slice(1) : relPath;

  // 处理 /plugins/clawdeck/ 前缀的请求，映射到项目根目录
  // 例如: plugins/clawdeck/i18n/index.js -> i18n/index.js
  const PLUGIN_PREFIX = 'plugins/clawdeck/';
  if (normalizedPath.startsWith(PLUGIN_PREFIX)) {
    normalizedPath = normalizedPath.slice(PLUGIN_PREFIX.length);
  }

  // 先查 plugin/assets/
  const assetFile = path.join(ASSETS, normalizedPath);
  if (assetFile.startsWith(ASSETS) && isFile(assetFile)) {
    return serveFile(res, assetFile);
  }

  // 再查项目根目录白名单（与 plugin/src/http.ts 保持一致）
  const firstSeg = normalizedPath.split('/').filter(Boolean)[0];
  if (firstSeg && ALLOWED_ROOT_DIRS.includes(firstSeg)) {
    const rootFile = path.join(ROOT, normalizedPath);
    if (rootFile.startsWith(ROOT) && isFile(rootFile)) {
      return serveFile(res, rootFile);
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

server.listen(PORT, () => {
  // 初始化 Mock 日志模块（Mock 模式下）
  if (mockScenario) {
    initMockLog(undefined, mockLogSeed ? { seedFrom: mockLogSeed } : undefined);
    // 写入初始化日志
    mockLog('init', `Mock server started, scenario: ${mockScenario}`);
    mockLog('init', `Log file: ${require('./bridge/mock-logger.cjs').getMockLogPath()}`);
  }

  console.log(`\n  ClawDeck Dev Server`);
  if (mockScenario) {
    console.log(`  模式: Mock (${mockScenario})`);
    console.log(`  http://localhost:${PORT}/\n`);
    console.log(`  可用场景：`);
    console.log(`    --mock=demo    — 3个伙伴模拟完整生命周期`);
    console.log(`    --mock=stress  — 压力测试（大量 Agent/Session）`);
    console.log(`    --mock=replay  — 回放预录快照\n`);
  } else {
    console.log(`  模式: 真实接入 (OpenClaw Gateway)`);
    console.log(`  http://localhost:${PORT}/\n`);
    console.log(`  提示: 需要 OpenClaw Gateway 运行中`);
    console.log(`  如需模拟数据，请使用: npm run dev:mock\n`);
  }
});
