/**
 * ClawDeck Server + Telemetry Bridge 集成测试
 *
 * 使用 node:test（零依赖），覆盖：
 * - Telemetry ingest 端点（单条/批量/校验/格式）
 * - SSE 广播（事件完整性、sessionId 透传）
 * - API Key 鉴权
 * - 命令白名单安全
 * - 基础 API 端点
 *
 * 运行: node --test test/server.test.cjs
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// --- Test helpers ---

let server;
let baseUrl;

/** POST JSON to a path, returns { status, body } */
function post(path, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url = new URL(path, baseUrl);
    const req = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(buf); } catch { parsed = buf; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** GET a path, returns { status, body } */
function get(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    http.get(url, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(buf); } catch { parsed = buf; }
        resolve({ status: res.statusCode, body: parsed });
      });
    }).on('error', reject);
  });
}

/** Connect to SSE and collect messages until done() is called */
function connectSSE() {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/events/stream', baseUrl);
    http.get(url, (res) => {
      const messages = [];
      let buf = '';

      res.on('data', (chunk) => {
        buf += chunk.toString();
        // Parse SSE messages (separated by \n\n)
        const parts = buf.split('\n\n');
        buf = parts.pop(); // keep incomplete part
        for (const part of parts) {
          if (part.startsWith('data: ')) {
            try {
              messages.push(JSON.parse(part.slice(6)));
            } catch { /* skip non-JSON */ }
          }
        }
      });

      resolve({
        messages,
        close: () => res.destroy(),
      });
    }).on('error', reject);
  });
}

/** Create a minimal telemetry event */
function makeEvent(type, overrides = {}) {
  return {
    type,
    timestamp: Date.now(),
    sessionId: 'test-session',
    agentId: 'test-agent',
    data: {},
    ...overrides,
  };
}

// --- Test suites ---

describe('ClawDeck Server', () => {
  before(async () => {
    // Remove API key for most tests
    delete process.env.CLAWDECK_API_KEY;

    const { createServer } = require('../server.cjs');
    server = createServer();
    await new Promise((resolve) => {
      server.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  after(() => {
    server.close();
  });

  // ==========================================
  // Basic API endpoints
  // ==========================================

  describe('GET /api/status', () => {
    it('returns ok with uptime and client count', async () => {
      const { status, body } = await get('/api/status');
      assert.equal(status, 200);
      assert.equal(body.ok, true);
      assert.equal(typeof body.uptime, 'number');
      assert.equal(typeof body.clients, 'number');
    });
  });

  describe('GET /api/unknown', () => {
    it('returns 404 for unknown API routes', async () => {
      const { status, body } = await get('/api/nonexistent');
      assert.equal(status, 404);
      assert.equal(body.error, 'Not found');
    });
  });

  // ==========================================
  // Telemetry ingest — single event
  // ==========================================

  describe('POST /api/telemetry/ingest — single event', () => {
    it('accepts a valid token_usage event', async () => {
      const event = makeEvent('token_usage', {
        data: { inputTokens: 1200, outputTokens: 350, cacheReadTokens: 800 },
      });
      const { status, body } = await post('/api/telemetry/ingest', event);
      assert.equal(status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.ingested, 1);
    });

    it('accepts a valid tool_call event', async () => {
      const event = makeEvent('tool_call', {
        data: { name: 'web_search', callId: 'c1', paramsKeys: ['query'] },
      });
      const { status, body } = await post('/api/telemetry/ingest', event);
      assert.equal(status, 200);
      assert.equal(body.ingested, 1);
    });

    it('accepts a valid tool_result event', async () => {
      const event = makeEvent('tool_result', {
        data: { name: 'web_search', callId: 'c1', success: true, durationMs: 1400 },
      });
      const { status, body } = await post('/api/telemetry/ingest', event);
      assert.equal(status, 200);
      assert.equal(body.ingested, 1);
    });

    it('accepts a valid agent:message event', async () => {
      const event = makeEvent('agent:message', {
        data: { role: 'assistant', contentPreview: 'Hello', contentLength: 5 },
      });
      const { status, body } = await post('/api/telemetry/ingest', event);
      assert.equal(status, 200);
      assert.equal(body.ingested, 1);
    });

    it('accepts a valid error event', async () => {
      const event = makeEvent('error', {
        data: { type: 'timeout', message: 'API timeout', runId: 'run-1' },
      });
      const { status, body } = await post('/api/telemetry/ingest', event);
      assert.equal(status, 200);
      assert.equal(body.ingested, 1);
    });

    it('accepts a valid session:start event', async () => {
      const event = makeEvent('session:start', {
        data: { runId: 'run-1', trigger: 'cron' },
      });
      const { status, body } = await post('/api/telemetry/ingest', event);
      assert.equal(status, 200);
      assert.equal(body.ingested, 1);
    });

    it('accepts a valid session:end event', async () => {
      const event = makeEvent('session:end', {
        data: { runId: 'run-1', status: 'completed' },
      });
      const { status, body } = await post('/api/telemetry/ingest', event);
      assert.equal(status, 200);
      assert.equal(body.ingested, 1);
    });
  });

  // ==========================================
  // Telemetry ingest — batch
  // ==========================================

  describe('POST /api/telemetry/ingest — batch', () => {
    it('accepts an array of events', async () => {
      const events = [
        makeEvent('tool_call', { data: { name: 'Read', callId: 'c1' } }),
        makeEvent('tool_result', { data: { callId: 'c1', success: true, durationMs: 100 } }),
        makeEvent('token_usage', { data: { inputTokens: 500, outputTokens: 100 } }),
      ];
      const { status, body } = await post('/api/telemetry/ingest', events);
      assert.equal(status, 200);
      assert.equal(body.ingested, 3);
    });

    it('skips events missing type field', async () => {
      const events = [
        makeEvent('token_usage'),
        { timestamp: Date.now(), data: {} }, // missing type
        { type: 'error' }, // missing timestamp
      ];
      const { status, body } = await post('/api/telemetry/ingest', events);
      assert.equal(status, 200);
      assert.equal(body.ingested, 1);
    });

    it('handles empty array', async () => {
      const { status, body } = await post('/api/telemetry/ingest', []);
      assert.equal(status, 200);
      assert.equal(body.ingested, 0);
    });
  });

  // ==========================================
  // Telemetry ingest — validation
  // ==========================================

  describe('POST /api/telemetry/ingest — validation', () => {
    it('rejects invalid JSON', async () => {
      const { status, body } = await new Promise((resolve, reject) => {
        const url = new URL('/api/telemetry/ingest', baseUrl);
        const req = http.request(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }, (res) => {
          let buf = '';
          res.on('data', c => buf += c);
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(buf) }));
        });
        req.on('error', reject);
        req.end('not-json{{{');
      });
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid JSON');
    });

    it('skips event without type', async () => {
      const { status, body } = await post('/api/telemetry/ingest', {
        timestamp: Date.now(),
        sessionId: 's1',
        data: {},
      });
      assert.equal(status, 200);
      assert.equal(body.ingested, 0);
    });

    it('skips event without timestamp', async () => {
      const { status, body } = await post('/api/telemetry/ingest', {
        type: 'token_usage',
        sessionId: 's1',
        data: {},
      });
      assert.equal(status, 200);
      assert.equal(body.ingested, 0);
    });
  });

  // ==========================================
  // SSE broadcast — event delivery
  // ==========================================

  describe('SSE broadcast', () => {
    it('delivers connected message on connect', async () => {
      const sse = await connectSSE();
      // Wait for the initial connected message
      await new Promise(r => setTimeout(r, 100));
      sse.close();

      assert.ok(sse.messages.length >= 1);
      assert.equal(sse.messages[0].type, 'connected');
    });

    it('delivers single ingested event to SSE client', async () => {
      const sse = await connectSSE();
      await new Promise(r => setTimeout(r, 100));

      const event = makeEvent('token_usage', {
        sessionId: 'sse-test-1',
        agentId: 'agent-1',
        data: { inputTokens: 100, outputTokens: 50 },
      });
      await post('/api/telemetry/ingest', event);
      await new Promise(r => setTimeout(r, 100));
      sse.close();

      const telemetryMsg = sse.messages.find(m => m.type === 'token_usage');
      assert.ok(telemetryMsg, 'should receive token_usage event');
      assert.equal(telemetryMsg.data.sessionId, 'sse-test-1');
      assert.equal(telemetryMsg.data.agentId, 'agent-1');
    });

    it('delivers batch events to SSE client', async () => {
      const sse = await connectSSE();
      await new Promise(r => setTimeout(r, 100));

      const events = [
        makeEvent('session:start', { sessionId: 'sse-batch' }),
        makeEvent('tool_call', { sessionId: 'sse-batch', data: { name: 'Read' } }),
        makeEvent('tool_result', { sessionId: 'sse-batch', data: { success: true } }),
        makeEvent('session:end', { sessionId: 'sse-batch' }),
      ];
      await post('/api/telemetry/ingest', events);
      await new Promise(r => setTimeout(r, 100));
      sse.close();

      const types = sse.messages.map(m => m.type).filter(t => t !== 'connected');
      assert.deepEqual(types, ['session:start', 'tool_call', 'tool_result', 'session:end']);
    });

    it('preserves sessionId and agentId in SSE payload', async () => {
      const sse = await connectSSE();
      await new Promise(r => setTimeout(r, 100));

      await post('/api/telemetry/ingest', makeEvent('agent:message', {
        sessionId: 'sid-preserve',
        agentId: 'aid-preserve',
        data: { role: 'assistant', contentPreview: 'test' },
      }));
      await new Promise(r => setTimeout(r, 100));
      sse.close();

      const msg = sse.messages.find(m => m.type === 'agent:message');
      assert.ok(msg);
      assert.equal(msg.data.sessionId, 'sid-preserve');
      assert.equal(msg.data.agentId, 'aid-preserve');
    });

    it('preserves nested data fields in SSE payload', async () => {
      const sse = await connectSSE();
      await new Promise(r => setTimeout(r, 100));

      await post('/api/telemetry/ingest', makeEvent('token_usage', {
        data: { inputTokens: 999, outputTokens: 111, model: 'test-model' },
      }));
      await new Promise(r => setTimeout(r, 100));
      sse.close();

      const msg = sse.messages.find(m => m.type === 'token_usage');
      assert.ok(msg);
      assert.equal(msg.data.data.inputTokens, 999);
      assert.equal(msg.data.data.outputTokens, 111);
      assert.equal(msg.data.data.model, 'test-model');
    });

    it('increments client count on SSE connect', async () => {
      const before = await get('/api/status');
      const clientsBefore = before.body.clients;

      const sse = await connectSSE();
      await new Promise(r => setTimeout(r, 100));

      const during = await get('/api/status');
      assert.equal(during.body.clients, clientsBefore + 1);

      sse.close();
      await new Promise(r => setTimeout(r, 100));

      const afterDisc = await get('/api/status');
      assert.equal(afterDisc.body.clients, clientsBefore);
    });
  });

  // ==========================================
  // Command whitelist security
  // ==========================================

  describe('POST /api/execute — command whitelist', () => {
    it('rejects commands not in whitelist', async () => {
      const { status, body } = await post('/api/execute', { command: 'ls', args: ['-la'] });
      assert.equal(status, 403);
      assert.match(body.error, /not allowed/);
    });

    it('rejects shell injection attempts', async () => {
      const { status, body } = await post('/api/execute', {
        command: 'agent; rm -rf /',
        args: [],
      });
      assert.equal(status, 403);
      assert.match(body.error, /not allowed/);
    });

    it('rejects pipe injection in command', async () => {
      const { status, body } = await post('/api/execute', {
        command: 'agent | cat /etc/passwd',
        args: [],
      });
      assert.equal(status, 403);
    });

    for (const cmd of ['agent', 'task', 'config', 'status', 'plugin', 'channels']) {
      it(`allows whitelisted command: ${cmd}`, async () => {
        // These will fail with spawn error since openclaw isn't installed,
        // but the point is they don't get 403
        const { status } = await post('/api/execute', { command: cmd, args: ['--help'] });
        assert.notEqual(status, 403, `${cmd} should not be blocked`);
      });
    }

    it('rejects invalid JSON body', async () => {
      const { status, body } = await new Promise((resolve, reject) => {
        const url = new URL('/api/execute', baseUrl);
        const req = http.request(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }, (res) => {
          let buf = '';
          res.on('data', c => buf += c);
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(buf) }));
        });
        req.on('error', reject);
        req.end('bad json');
      });
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid JSON');
    });
  });
});

// ==========================================
// API Key auth (separate describe to control env)
// ==========================================

describe('API Key authentication', () => {
  let authServer;
  let authBaseUrl;

  before(async () => {
    process.env.CLAWDECK_API_KEY = 'secret-key-123';
    // Re-require to pick up env change — but since server.cjs reads env at request time, same module works
    delete require.cache[require.resolve('../server.cjs')];
    const { createServer } = require('../server.cjs');
    authServer = createServer();
    await new Promise((resolve) => {
      authServer.listen(0, () => {
        const port = authServer.address().port;
        authBaseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  after(() => {
    authServer.close();
    delete process.env.CLAWDECK_API_KEY;
  });

  function authPost(path, data, headers = {}) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(data);
      const url = new URL(path, authBaseUrl);
      const req = http.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
      }, (res) => {
        let buf = '';
        res.on('data', c => buf += c);
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(buf); } catch { parsed = buf; }
          resolve({ status: res.statusCode, body: parsed });
        });
      });
      req.on('error', reject);
      req.end(body);
    });
  }

  it('rejects request without API key', async () => {
    const event = makeEvent('token_usage');
    const { status, body } = await authPost('/api/telemetry/ingest', event);
    assert.equal(status, 401);
    assert.equal(body.error, 'Unauthorized');
  });

  it('rejects request with wrong API key', async () => {
    const event = makeEvent('token_usage');
    const { status, body } = await authPost('/api/telemetry/ingest', event, {
      'Authorization': 'Bearer wrong-key',
    });
    assert.equal(status, 401);
    assert.equal(body.error, 'Unauthorized');
  });

  it('rejects request with malformed Authorization header', async () => {
    const event = makeEvent('token_usage');
    const { status, body } = await authPost('/api/telemetry/ingest', event, {
      'Authorization': 'Basic secret-key-123',
    });
    assert.equal(status, 401);
  });

  it('accepts request with correct API key', async () => {
    const event = makeEvent('token_usage', { data: { inputTokens: 42 } });
    const { status, body } = await authPost('/api/telemetry/ingest', event, {
      'Authorization': 'Bearer secret-key-123',
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.ingested, 1);
  });

  it('accepts batch with correct API key', async () => {
    const events = [makeEvent('tool_call'), makeEvent('tool_result')];
    const { status, body } = await authPost('/api/telemetry/ingest', events, {
      'Authorization': 'Bearer secret-key-123',
    });
    assert.equal(status, 200);
    assert.equal(body.ingested, 2);
  });

  it('does not require API key for non-ingest endpoints', async () => {
    const { status, body } = await new Promise((resolve, reject) => {
      const url = new URL('/api/status', authBaseUrl);
      http.get(url, (res) => {
        let buf = '';
        res.on('data', c => buf += c);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(buf) }));
      }).on('error', reject);
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });
});
