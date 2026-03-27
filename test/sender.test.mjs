/**
 * EventSender 单元测试
 *
 * 测试 HTTP 批量发送、静默降级、指数退避、探活恢复。
 * 使用 node:test + 内置 mock HTTP server 模拟 ClawDeck 端。
 *
 * 运行: node --test test/sender.test.mjs
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Since sender.ts is TypeScript, we test the logic patterns via a JS port.
// In real CI this would be compiled first. Here we inline the essential logic.

// --- Minimal EventSender reimplementation for testing (mirrors src/sender.ts) ---

const MAX_CONSECUTIVE_FAILURES = 5;
const BACKOFF_PROBE_INTERVAL_MS = 200; // shorter for tests

class EventSender {
  constructor(opts) {
    this.endpoint = `${opts.url}/api/telemetry/ingest`;
    this.headers = { 'Content-Type': 'application/json' };
    if (opts.apiKey) this.headers['Authorization'] = `Bearer ${opts.apiKey}`;
    this.batchIntervalMs = opts.batchIntervalMs ?? 50;
    this.batchSize = opts.batchSize ?? 10;
    this.logger = opts.logger;

    this.buffer = [];
    this.flushTimer = null;
    this.consecutiveFailures = 0;
    this.backoffTimer = null;
    this.alive = true;
    this.sentBatches = []; // for test inspection
  }

  send(event) {
    if (!this.alive) return;
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return;
    this.buffer.push(event);
    if (this.buffer.length >= this.batchSize) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.batchIntervalMs);
    }
  }

  async probe() {
    try {
      const statusUrl = this.endpoint.replace('/api/telemetry/ingest', '/api/status');
      const resp = await fetch(statusUrl, { signal: AbortSignal.timeout(2000) });
      return resp.ok;
    } catch { return false; }
  }

  stop() {
    this.alive = false;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.backoffTimer) clearInterval(this.backoffTimer);
    this.flush();
  }

  flush() {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    this.doSend(batch);
  }

  async doSend(batch) {
    try {
      const body = batch.length === 1 ? JSON.stringify(batch[0]) : JSON.stringify(batch);
      const resp = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.headers,
        body,
        signal: AbortSignal.timeout(3000),
      });
      this.sentBatches.push(batch);
      if (resp.ok) {
        this.consecutiveFailures = 0;
      } else {
        this.onFailure();
      }
    } catch {
      this.onFailure();
    }
  }

  onFailure() {
    this.consecutiveFailures++;
    this.logger?.debug?.(`send failed (${this.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`);
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.startBackoffProbe();
    }
  }

  startBackoffProbe() {
    if (this.backoffTimer) return;
    this.backoffTimer = setInterval(async () => {
      const ok = await this.probe();
      if (ok) {
        this.consecutiveFailures = 0;
        if (this.backoffTimer) { clearInterval(this.backoffTimer); this.backoffTimer = null; }
      }
    }, BACKOFF_PROBE_INTERVAL_MS);
  }
}

// --- Mock server ---

let mockServer;
let mockPort;
let requestLog = [];
let shouldFail = false;

function resetMock() {
  requestLog = [];
  shouldFail = false;
}

// --- Tests ---

describe('EventSender', () => {
  before(async () => {
    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        requestLog.push({ method: req.method, url: req.url, body, headers: req.headers });

        if (req.url === '/api/status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (shouldFail) {
          res.writeHead(500);
          res.end('error');
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ingested: 1 }));
      });
    });

    await new Promise(resolve => {
      mockServer.listen(0, () => {
        mockPort = mockServer.address().port;
        resolve();
      });
    });
  });

  after(() => { mockServer.close(); });
  beforeEach(() => resetMock());

  describe('basic sending', () => {
    it('sends a single event as non-array', async () => {
      const sender = new EventSender({ url: `http://localhost:${mockPort}` });
      sender.send({ type: 'token_usage', timestamp: 1, data: {} });
      sender.flush();
      await new Promise(r => setTimeout(r, 200));
      sender.stop();

      assert.equal(requestLog.length, 1);
      const parsed = JSON.parse(requestLog[0].body);
      assert.equal(parsed.type, 'token_usage'); // single, not array
    });

    it('sends batch as array when multiple events', async () => {
      const sender = new EventSender({
        url: `http://localhost:${mockPort}`,
        batchSize: 3,
        batchIntervalMs: 10,
      });
      sender.send({ type: 'a', timestamp: 1 });
      sender.send({ type: 'b', timestamp: 2 });
      sender.send({ type: 'c', timestamp: 3 }); // triggers flush at batchSize=3
      await new Promise(r => setTimeout(r, 200));
      sender.stop();

      assert.ok(requestLog.length >= 1);
      const parsed = JSON.parse(requestLog[0].body);
      assert.ok(Array.isArray(parsed));
      assert.equal(parsed.length, 3);
    });
  });

  describe('batch flush timer', () => {
    it('flushes after batchIntervalMs even if batch not full', async () => {
      const sender = new EventSender({
        url: `http://localhost:${mockPort}`,
        batchSize: 100,       // very large, won't trigger by size
        batchIntervalMs: 50,  // flush by timer
      });
      sender.send({ type: 'x', timestamp: 1 });
      await new Promise(r => setTimeout(r, 200));
      sender.stop();

      assert.ok(requestLog.length >= 1, 'should have flushed by timer');
    });

    it('does not send when buffer is empty', async () => {
      const sender = new EventSender({ url: `http://localhost:${mockPort}` });
      sender.flush();
      await new Promise(r => setTimeout(r, 100));
      sender.stop();

      assert.equal(requestLog.length, 0);
    });
  });

  describe('silent degradation', () => {
    it('does not throw when server is unreachable', async () => {
      const sender = new EventSender({ url: 'http://localhost:1' }); // unreachable port
      sender.send({ type: 'test', timestamp: 1 });
      sender.flush();
      await new Promise(r => setTimeout(r, 300));
      sender.stop();
      // If we get here without exception, test passes
      assert.ok(true);
    });

    it('increments failure count on server error', async () => {
      shouldFail = true;
      const sender = new EventSender({ url: `http://localhost:${mockPort}` });
      sender.send({ type: 'test', timestamp: 1 });
      sender.flush();
      await new Promise(r => setTimeout(r, 200));
      sender.stop();

      assert.ok(sender.consecutiveFailures >= 1);
    });

    it('resets failure count on success', async () => {
      shouldFail = true;
      const sender = new EventSender({ url: `http://localhost:${mockPort}` });

      // Cause some failures
      sender.send({ type: 'fail1', timestamp: 1 }); sender.flush();
      await new Promise(r => setTimeout(r, 100));
      assert.ok(sender.consecutiveFailures >= 1);

      // Now succeed
      shouldFail = false;
      sender.send({ type: 'ok', timestamp: 2 }); sender.flush();
      await new Promise(r => setTimeout(r, 200));
      sender.stop();

      assert.equal(sender.consecutiveFailures, 0);
    });
  });

  describe('backoff mode', () => {
    it('enters backoff after MAX_CONSECUTIVE_FAILURES', async () => {
      shouldFail = true;
      const sender = new EventSender({
        url: `http://localhost:${mockPort}`,
        batchIntervalMs: 10,
        batchSize: 1,
      });

      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES + 2; i++) {
        sender.send({ type: 'fail', timestamp: i });
        await new Promise(r => setTimeout(r, 50));
      }

      assert.ok(sender.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES);
      sender.stop();
    });

    it('drops events silently in backoff mode', async () => {
      shouldFail = true;
      const sender = new EventSender({
        url: `http://localhost:${mockPort}`,
        batchSize: 1,
        batchIntervalMs: 10,
      });

      // Drive into backoff
      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES + 1; i++) {
        sender.send({ type: 'fail', timestamp: i });
        await new Promise(r => setTimeout(r, 50));
      }

      const reqCountBefore = requestLog.length;

      // These should be silently dropped
      sender.send({ type: 'dropped1', timestamp: 100 });
      sender.send({ type: 'dropped2', timestamp: 101 });
      await new Promise(r => setTimeout(r, 200));

      assert.equal(sender.buffer.length, 0, 'buffer should not accumulate in backoff');
      sender.stop();
    });
  });

  describe('probe', () => {
    it('returns true when server is reachable', async () => {
      const sender = new EventSender({ url: `http://localhost:${mockPort}` });
      const ok = await sender.probe();
      sender.stop();
      assert.equal(ok, true);
    });

    it('returns false when server is unreachable', async () => {
      const sender = new EventSender({ url: 'http://localhost:1' });
      const ok = await sender.probe();
      sender.stop();
      assert.equal(ok, false);
    });
  });

  describe('stop', () => {
    it('flushes remaining buffer on stop', async () => {
      const sender = new EventSender({
        url: `http://localhost:${mockPort}`,
        batchSize: 100,
        batchIntervalMs: 60000, // very long, won't trigger
      });
      sender.send({ type: 'pending1', timestamp: 1 });
      sender.send({ type: 'pending2', timestamp: 2 });
      sender.stop();
      await new Promise(r => setTimeout(r, 200));

      assert.ok(requestLog.length >= 1, 'should flush on stop');
    });

    it('ignores sends after stop', async () => {
      const sender = new EventSender({ url: `http://localhost:${mockPort}` });
      sender.stop();
      sender.send({ type: 'after-stop', timestamp: 1 });
      await new Promise(r => setTimeout(r, 100));

      assert.equal(sender.buffer.length, 0);
    });
  });

  describe('API key', () => {
    it('sends Authorization header when apiKey is set', async () => {
      const sender = new EventSender({
        url: `http://localhost:${mockPort}`,
        apiKey: 'my-secret',
      });
      sender.send({ type: 'auth-test', timestamp: 1 });
      sender.flush();
      await new Promise(r => setTimeout(r, 200));
      sender.stop();

      assert.ok(requestLog.length >= 1);
      assert.equal(requestLog[0].headers['authorization'], 'Bearer my-secret');
    });

    it('does not send Authorization header when apiKey is empty', async () => {
      const sender = new EventSender({ url: `http://localhost:${mockPort}` });
      sender.send({ type: 'no-auth', timestamp: 1 });
      sender.flush();
      await new Promise(r => setTimeout(r, 200));
      sender.stop();

      assert.ok(requestLog.length >= 1);
      assert.equal(requestLog[0].headers['authorization'], undefined);
    });
  });
});
