/**
 * EventStream + TelemetryManager 前端事件路由测试
 *
 * 测试 _handleTelemetryEvent 的双格式兼容、SessionTracker 聚合逻辑。
 * 模拟浏览器环境中的事件流处理（不需要真实 EventSource）。
 *
 * 运行: node --test test/telemetry-routing.test.mjs
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// --- Import source modules (ES Modules) ---
import { TelemetryEventType, SessionTracker, TelemetryManager } from '../bridge/telemetry.js';
import { EventStream } from '../bridge/event-stream.js';

// Patch: EventStream.connect() uses browser EventSource; skip it for unit tests.

describe('TelemetryEventType', () => {
  it('defines all 7 event types', () => {
    const types = Object.values(TelemetryEventType);
    assert.equal(types.length, 7);
    assert.ok(types.includes('agent:message'));
    assert.ok(types.includes('tool_call'));
    assert.ok(types.includes('tool_result'));
    assert.ok(types.includes('token_usage'));
    assert.ok(types.includes('error'));
    assert.ok(types.includes('session:start'));
    assert.ok(types.includes('session:end'));
  });
});

describe('SessionTracker', () => {
  let tracker;

  beforeEach(() => {
    tracker = new SessionTracker('sess-1', 'agent-1');
  });

  describe('recordTokenUsage', () => {
    it('accumulates token counts', () => {
      tracker.recordTokenUsage({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 30, cacheWriteTokens: 10 });
      tracker.recordTokenUsage({ inputTokens: 200, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 });

      assert.equal(tracker.stats.totalTokens.input, 300);
      assert.equal(tracker.stats.totalTokens.output, 150);
      assert.equal(tracker.stats.totalTokens.cacheRead, 30);
      assert.equal(tracker.stats.totalTokens.cacheWrite, 10);
    });

    it('handles missing fields gracefully', () => {
      tracker.recordTokenUsage({});
      assert.equal(tracker.stats.totalTokens.input, 0);
      assert.equal(tracker.stats.totalTokens.output, 0);
    });
  });

  describe('recordToolCall + recordToolResult', () => {
    it('tracks tool call count', () => {
      tracker.recordToolCall({ name: 'Read', params: { file: 'a.js' } });
      tracker.recordToolCall({ name: 'Write', params: { file: 'b.js' } });

      assert.equal(tracker.stats.toolCalls.total, 2);
    });

    it('tracks success and failure', () => {
      const call = tracker.recordToolCall({ name: 'Read', params: {} });
      const callId = call.data.callId;

      tracker.recordToolResult({ callId, success: true });
      assert.equal(tracker.stats.toolCalls.success, 1);

      tracker.recordToolCall({ name: 'Write', params: {} });
      tracker.recordToolResult({ callId: 'unknown', success: false });
      assert.equal(tracker.stats.toolCalls.failed, 1);
    });

    it('calculates duration from pending calls', () => {
      const call = tracker.recordToolCall({ name: 'Read', params: {} });
      const callId = call.data.callId;

      // Simulate some time passing
      const result = tracker.recordToolResult({ callId, success: true });
      assert.equal(typeof result.data.durationMs, 'number');
      assert.ok(result.data.durationMs >= 0);
    });
  });

  describe('recordMessage', () => {
    it('counts messages by role', () => {
      tracker.recordMessage({ role: 'user', content: 'hello' });
      tracker.recordMessage({ role: 'assistant', content: 'hi' });
      tracker.recordMessage({ role: 'assistant', content: 'ok' });

      assert.equal(tracker.stats.messages.user, 1);
      assert.equal(tracker.stats.messages.assistant, 2);
    });
  });

  describe('recordError', () => {
    it('counts errors and categorizes by type', () => {
      tracker.recordError({ type: 'timeout', message: 'timed out' });
      tracker.recordError({ type: 'timeout', message: 'another timeout' });
      tracker.recordError({ type: 'network', message: 'disconnected' });

      assert.equal(tracker.stats.errors.total, 3);
      assert.equal(tracker.stats.errors.byType.timeout, 2);
      assert.equal(tracker.stats.errors.byType.network, 1);
    });
  });

  describe('getSummary', () => {
    it('returns session summary with stats', () => {
      tracker.recordTokenUsage({ inputTokens: 100, outputTokens: 50 });
      tracker.recordToolCall({ name: 'Read', params: {} });

      const summary = tracker.getSummary();
      assert.equal(summary.sessionId, 'sess-1');
      assert.equal(summary.agentId, 'agent-1');
      assert.equal(summary.eventCount, 2);
      assert.equal(typeof summary.durationMs, 'number');
    });
  });
});

describe('TelemetryManager', () => {
  let manager;

  beforeEach(() => {
    manager = new TelemetryManager();
  });

  it('starts and retrieves sessions', () => {
    const tracker = manager.startSession('s1', 'a1');
    assert.ok(tracker instanceof SessionTracker);
    assert.equal(manager.getSession('s1'), tracker);
  });

  it('returns undefined for unknown session', () => {
    assert.equal(manager.getSession('nonexistent'), undefined);
  });

  it('ends session and returns summary', () => {
    manager.startSession('s1', 'a1');
    const summary = manager.endSession('s1');
    assert.ok(summary);
    assert.equal(summary.sessionId, 's1');
  });

  it('broadcasts events to listeners', () => {
    const received = [];
    manager.addListener(evt => received.push(evt));

    manager.startSession('s1');
    assert.ok(received.length >= 1); // session:start event
  });

  it('returns unsubscribe function from addListener', () => {
    const received = [];
    const unsub = manager.addListener(evt => received.push(evt));

    manager.startSession('s1');
    const countAfterFirst = received.length;

    unsub();
    manager.startSession('s2');
    assert.equal(received.length, countAfterFirst); // no more events
  });
});

describe('EventStream._handleTelemetryEvent', () => {
  let stream;
  let manager;

  beforeEach(() => {
    stream = new EventStream();
    manager = new TelemetryManager();
    stream.setTelemetryManager(manager);
  });

  describe('new format (from OpenClaw plugin via server)', () => {
    // Server broadcasts: { type, data: { timestamp, sessionId, agentId, data: {...} } }

    it('routes token_usage and creates session', () => {
      stream._handleTelemetryEvent({
        type: 'token_usage',
        data: {
          timestamp: 1000,
          sessionId: 'new-sess',
          agentId: 'agent-x',
          data: { inputTokens: 500, outputTokens: 200 },
        },
      });

      const tracker = manager.getSession('new-sess');
      assert.ok(tracker, 'should auto-create session');
      assert.equal(tracker.stats.totalTokens.input, 500);
      assert.equal(tracker.stats.totalTokens.output, 200);
    });

    it('routes tool_call', () => {
      stream._handleTelemetryEvent({
        type: 'tool_call',
        data: {
          sessionId: 'tc-sess',
          data: { name: 'web_search', callId: 'c1', paramsKeys: ['query'] },
        },
      });

      const tracker = manager.getSession('tc-sess');
      assert.ok(tracker);
      assert.equal(tracker.stats.toolCalls.total, 1);
    });

    it('routes tool_result', () => {
      // First create a tool call
      stream._handleTelemetryEvent({
        type: 'tool_call',
        data: { sessionId: 'tr-sess', data: { name: 'Read', callId: 'c1' } },
      });
      stream._handleTelemetryEvent({
        type: 'tool_result',
        data: { sessionId: 'tr-sess', data: { callId: 'c1', success: true, durationMs: 42 } },
      });

      const tracker = manager.getSession('tr-sess');
      assert.equal(tracker.stats.toolCalls.success, 1);
    });

    it('routes agent:message', () => {
      stream._handleTelemetryEvent({
        type: 'agent:message',
        data: {
          sessionId: 'msg-sess',
          data: { role: 'assistant', contentPreview: 'hello', contentLength: 5 },
        },
      });

      const tracker = manager.getSession('msg-sess');
      assert.equal(tracker.stats.messages.assistant, 1);
    });

    it('routes error', () => {
      stream._handleTelemetryEvent({
        type: 'error',
        data: {
          sessionId: 'err-sess',
          data: { type: 'timeout', message: 'timed out' },
        },
      });

      const tracker = manager.getSession('err-sess');
      assert.equal(tracker.stats.errors.total, 1);
    });

    it('routes session:end and produces summary', () => {
      // Start session first
      stream._handleTelemetryEvent({
        type: 'token_usage',
        data: { sessionId: 'end-sess', data: { inputTokens: 100 } },
      });

      stream._handleTelemetryEvent({
        type: 'session:end',
        data: { sessionId: 'end-sess', data: { status: 'completed' } },
      });

      // Session should still exist (endSession returns summary but doesn't delete)
    });
  });

  describe('legacy format compatibility', () => {
    // Old format from test endpoint: { type, sessionId, agentId, data: {...} }

    it('handles legacy format with top-level sessionId', () => {
      stream._handleTelemetryEvent({
        type: 'token_usage',
        sessionId: 'legacy-sess',
        agentId: 'legacy-agent',
        data: { inputTokens: 300, outputTokens: 100 },
      });

      const tracker = manager.getSession('legacy-sess');
      assert.ok(tracker);
      assert.equal(tracker.stats.totalTokens.input, 300);
    });
  });

  describe('edge cases', () => {
    it('ignores events without sessionId', () => {
      stream._handleTelemetryEvent({
        type: 'token_usage',
        data: { data: { inputTokens: 100 } },
      });

      assert.equal(manager.sessions.size, 0);
    });

    it('ignores events when telemetry manager is not set', () => {
      const bareStream = new EventStream();
      // Should not throw
      bareStream._handleTelemetryEvent({
        type: 'token_usage',
        data: { sessionId: 's1', data: {} },
      });
      assert.ok(true);
    });

    it('broadcasts normalized event to manager listeners', () => {
      const received = [];
      manager.addListener(evt => received.push(evt));

      stream._handleTelemetryEvent({
        type: 'token_usage',
        data: {
          sessionId: 'bcast-sess',
          agentId: 'bcast-agent',
          data: { inputTokens: 42 },
        },
      });

      // Should have session:start (auto) + token_usage broadcast + manager internal
      const tokenEvt = received.find(e => e.type === 'token_usage');
      assert.ok(tokenEvt);
      assert.equal(tokenEvt.sessionId, 'bcast-sess');
      assert.equal(tokenEvt.agentId, 'bcast-agent');
    });

    it('handles multiple sessions concurrently', () => {
      stream._handleTelemetryEvent({
        type: 'token_usage',
        data: { sessionId: 'sess-a', data: { inputTokens: 100 } },
      });
      stream._handleTelemetryEvent({
        type: 'token_usage',
        data: { sessionId: 'sess-b', data: { inputTokens: 200 } },
      });

      assert.equal(manager.getSession('sess-a').stats.totalTokens.input, 100);
      assert.equal(manager.getSession('sess-b').stats.totalTokens.input, 200);
    });
  });
});
