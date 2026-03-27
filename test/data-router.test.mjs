/**
 * DataRouter 前端数据路由测试
 *
 * 测试 DataRouter 的路由逻辑、数据转换、路由日志回调。
 * Mock gateway 记录所有 call() 调用，返回预设数据。
 *
 * 运行: node --test test/data-router.test.mjs
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { DataRouter } from '../bridge/data-router.js';

// ============================================================
// Mock Gateway
// ============================================================

function createMockGateway(responses = {}) {
  const calls = [];
  const listeners = {};
  return {
    calls,
    _listeners: listeners,
    async call(method, params = {}) {
      calls.push({ method, params });
      if (responses[method]) {
        return typeof responses[method] === 'function'
          ? responses[method](params)
          : responses[method];
      }
      return {};
    },
    on(event, fn) {
      (listeners[event] ||= []).push(fn);
    },
    off(event, fn) {
      const list = listeners[event];
      if (list) {
        const idx = list.indexOf(fn);
        if (idx >= 0) list.splice(idx, 1);
      }
    },
    _emit(event, data) {
      (listeners[event] || []).forEach(fn => fn(data));
    },
  };
}

// ============================================================
// 预设数据
// ============================================================

const MOCK_AGENTS = {
  agents: [
    { id: 'a1', name: 'Reporter', identity: { name: 'Reporter', emoji: 'R' } },
    { id: 'a2', name: 'Coder', identity: { name: 'Coder', emoji: 'C' } },
  ],
};

const MOCK_ACTIVE_SESSIONS = {
  sessions: [
    {
      sessionId: 'sess-1', key: 'agent:a1:main:direct:user',
      label: 'Session sess-1', abortedLastRun: false,
      inputTokens: 100, outputTokens: 50, totalTokens: 150,
    },
  ],
};

const MOCK_ALL_SESSIONS = {
  sessions: [
    { sessionId: 'sess-1', key: 'agent:a1:main:direct:user', label: 'Session sess-1', abortedLastRun: false },
    { sessionId: 'sess-2', key: 'agent:a2:main:direct:user', label: 'Session sess-2', abortedLastRun: false },
    { sessionId: 'sess-3', key: 'agent:a1:main:direct:user', label: 'Session sess-3', abortedLastRun: false },
  ],
};

const MOCK_USAGE = {
  totals: { totalTokens: 5000, totalCost: 0.05 },
};

// chat.history 返回的 Message[] 格式
const MOCK_CHAT_HISTORY = {
  sessionKey: 'agent:a1:main:direct:user',
  sessionId: 'sess-1',
  messages: [
    { role: 'user', content: '请帮我读取 README.md 文件并总结内容', timestamp: 1000 },
    { role: 'assistant', content: [
      { type: 'text', text: '好的，我来读取文件' },
      { type: 'tool_use', name: 'Read', input: { path: 'README.md' } },
    ], timestamp: 2000 },
    { role: 'tool', content: '# Project\nThis is a README file.', toolName: 'Read', timestamp: 3000 },
    { role: 'assistant', content: '这是一个项目的 README 文件，包含项目基本信息。', timestamp: 4000 },
  ],
};

// 旧格式（保留用于参考）
const MOCK_SESSION_DETAIL = {
  sessionId: 'sess-1',
  key: 'agent:a1:main:direct:user',
  status: 'active',
  steps: [
    { id: 'step-1', type: 'llm_input', summary: 'LLM request', timestamp: 1000 },
    { id: 'step-2', type: 'tool_call', summary: 'Tool call', timestamp: 2000 },
  ],
};

// ============================================================
// Tests
// ============================================================

describe('DataRouter', () => {
  describe('构造', () => {
    it('传入 mock gateway，初始状态为空', () => {
      const gw = createMockGateway();
      const router = new DataRouter(gw);

      assert.deepStrictEqual(router.getAgentsForStarMap(), []);
      assert.deepStrictEqual(router.getActiveSessionsForStarMap(), []);
      assert.deepStrictEqual(router.getMetrics(), {
        agents: 0,
        activeSessions: 0,
        activeAgents: 0,
        totalTokens: 0,
        totalCost: 0,
        completedSessions: 0,
        totalErrors: 0,
      });
    });
  });

  describe('refresh() 路由验证', () => {
    it('调用 agents.list + sessions.list x2（官方 Gateway 层）', async () => {
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': (params) =>
          params.activeMinutes ? MOCK_ACTIVE_SESSIONS : MOCK_ALL_SESSIONS,
      });
      const router = new DataRouter(gw);

      await router.refresh();

      const methods = gw.calls.map(c => c.method);
      assert.deepStrictEqual(methods, ['agents.list', 'sessions.list', 'sessions.list']);

      // 验证 activeMinutes 参数
      assert.ok(gw.calls[1].params.activeMinutes);
      assert.ok(!gw.calls[2].params.activeMinutes);
    });

    it('sessions.list 活跃调用包含 includeLastMessage', async () => {
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': (params) =>
          params.activeMinutes ? MOCK_ACTIVE_SESSIONS : MOCK_ALL_SESSIONS,
      });
      const router = new DataRouter(gw);
      await router.refresh();

      // 活跃 sessions 调用应包含 includeLastMessage: true
      assert.equal(gw.calls[1].params.includeLastMessage, true);
      // 全量 sessions 调用应包含 includeDerivedTitles: true
      assert.equal(gw.calls[2].params.includeDerivedTitles, true);
    });

    it('返回数据正确存储', async () => {
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': (params) =>
          params.activeMinutes ? MOCK_ACTIVE_SESSIONS : MOCK_ALL_SESSIONS,
      });
      const router = new DataRouter(gw);
      await router.refresh();

      assert.equal(router.getAgentsForStarMap().length, 2);
      assert.equal(router.getActiveSessionsForStarMap().length, 1);
    });
  });

  describe('refreshUsage() 路由验证', () => {
    it('调用 sessions.usage（官方 Gateway 层）', async () => {
      const gw = createMockGateway({
        'sessions.usage': MOCK_USAGE,
      });
      const router = new DataRouter(gw);

      await router.refreshUsage();

      assert.equal(gw.calls.length, 1);
      assert.equal(gw.calls[0].method, 'sessions.usage');
    });
  });

  describe('getSessionDetail() 路由验证', () => {
    it('调用 chat.history（官方 Gateway 层）', async () => {
      const gw = createMockGateway({
        'chat.history': MOCK_CHAT_HISTORY,
      });
      const router = new DataRouter(gw);

      const detail = await router.getSessionDetail('agent:a1:main:direct:user');

      assert.equal(gw.calls.length, 1);
      assert.equal(gw.calls[0].method, 'chat.history');
      assert.deepStrictEqual(gw.calls[0].params, { sessionKey: 'agent:a1:main:direct:user', limit: 200 });
      // 返回应包含转换后的 steps
      assert.ok(Array.isArray(detail.steps));
      assert.ok(detail.steps.length > 0);
    });

    it('chat.history 返回空时，steps 为空数组', async () => {
      const gw = createMockGateway({
        'chat.history': { sessionKey: 'k', sessionId: 's', messages: [] },
      });
      const router = new DataRouter(gw);

      const detail = await router.getSessionDetail('k');
      assert.ok(Array.isArray(detail.steps));
      assert.equal(detail.steps.length, 0);
    });
  });

  describe('getSessionTimeline() 路由验证', () => {
    it('调用 chat.history 并返回 steps 数组', async () => {
      const gw = createMockGateway({
        'chat.history': MOCK_CHAT_HISTORY,
      });
      const router = new DataRouter(gw);

      const steps = await router.getSessionTimeline('agent:a1:main:direct:user');

      assert.equal(gw.calls[0].method, 'chat.history');
      assert.ok(Array.isArray(steps));
      assert.ok(steps.length > 0);
    });

    it('chat.history 为 null 时返回空数组', async () => {
      const gw = createMockGateway({
        'chat.history': null,
      });
      const router = new DataRouter(gw);

      const steps = await router.getSessionTimeline('nonexistent');

      assert.ok(Array.isArray(steps));
      assert.equal(steps.length, 0);
    });
  });

  describe('_messagesToSteps() 转换', () => {
    it('user message → llm_input', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps([
        { role: 'user', content: '请帮我读取文件', timestamp: 1000 },
      ]);
      assert.equal(steps.length, 1);
      assert.equal(steps[0].type, 'llm_input');
      assert.equal(steps[0].summary, '请帮我读取文件');
      assert.equal(steps[0].timestamp, 1000);
    });

    it('user message content 超过 80 字符截断', () => {
      const router = new DataRouter(createMockGateway());
      const longContent = 'A'.repeat(100);
      const steps = router._messagesToSteps([
        { role: 'user', content: longContent, timestamp: 1000 },
      ]);
      assert.equal(steps[0].summary.length, 83); // 80 + '...'
      assert.ok(steps[0].summary.endsWith('...'));
    });

    it('assistant 纯文本 → llm_output', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps([
        { role: 'assistant', content: '这是回复内容', timestamp: 2000 },
      ]);
      assert.equal(steps.length, 1);
      assert.equal(steps[0].type, 'llm_output');
    });

    it('assistant 含 tool_use block → tool_call', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps([
        {
          role: 'assistant',
          content: [
            { type: 'text', text: '让我来读取文件' },
            { type: 'tool_use', name: 'Read', input: { path: 'a.txt' } },
          ],
          timestamp: 2000,
        },
      ]);
      assert.equal(steps.length, 1);
      assert.equal(steps[0].type, 'tool_call');
      assert.ok(steps[0].summary.includes('Read'));
    });

    it('tool message → tool_result', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps([
        { role: 'tool', content: 'file content here', toolName: 'Read', timestamp: 3000 },
      ]);
      assert.equal(steps.length, 1);
      assert.equal(steps[0].type, 'tool_result');
      assert.ok(steps[0].summary.includes('Read'));
    });

    it('完整对话流转换', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps(MOCK_CHAT_HISTORY.messages);
      assert.equal(steps.length, 4);
      assert.equal(steps[0].type, 'llm_input');
      assert.equal(steps[1].type, 'tool_call');
      assert.equal(steps[2].type, 'tool_result');
      assert.equal(steps[3].type, 'llm_output');
    });

    it('空 messages 返回空数组', () => {
      const router = new DataRouter(createMockGateway());
      assert.deepStrictEqual(router._messagesToSteps([]), []);
      assert.deepStrictEqual(router._messagesToSteps(null), []);
      assert.deepStrictEqual(router._messagesToSteps(undefined), []);
    });

    it('NO_REPLY assistant 纯文本 → 被过滤', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps([
        { role: 'assistant', content: 'NO_REPLY', timestamp: 1000 },
      ]);
      assert.equal(steps.length, 0);
    });

    it('NO_REPLY assistant 含空白 → 被过滤', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps([
        { role: 'assistant', content: '  NO_REPLY  ', timestamp: 1000 },
      ]);
      assert.equal(steps.length, 0);
    });

    it('NO_REPLY assistant content blocks → 被过滤', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps([
        { role: 'assistant', content: [{ type: 'text', text: 'NO_REPLY' }], timestamp: 1000 },
      ]);
      assert.equal(steps.length, 0);
    });

    it('NO_REPLY user 消息 → 不过滤', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps([
        { role: 'user', content: 'NO_REPLY', timestamp: 1000 },
      ]);
      assert.equal(steps.length, 1);
      assert.equal(steps[0].type, 'llm_input');
    });
  });

  describe('getUsageCost() 路由验证', () => {
    it('调用 usage.cost（官方 Gateway 层）', async () => {
      const mockCost = { daily: [], total: { cost: 1.23 } };
      const gw = createMockGateway({ 'usage.cost': mockCost });
      const router = new DataRouter(gw);

      const result = await router.getUsageCost();

      assert.equal(gw.calls.length, 1);
      assert.equal(gw.calls[0].method, 'usage.cost');
      assert.equal(gw.calls[0].params.days, 7);
      assert.equal(gw.calls[0].params.mode, 'gateway');
      assert.deepStrictEqual(result, mockCost);
    });

    it('支持自定义参数覆盖', async () => {
      const gw = createMockGateway({ 'usage.cost': {} });
      const router = new DataRouter(gw);

      await router.getUsageCost({ days: 30 });

      assert.equal(gw.calls[0].params.days, 30);
      assert.equal(gw.calls[0].params.mode, 'gateway');
    });
  });

  describe('getSessionsPreview() 路由验证', () => {
    it('调用 sessions.preview（官方 Gateway 层）', async () => {
      const mockPreview = { previews: [{ key: 'k1', preview: 'hello' }] };
      const gw = createMockGateway({ 'sessions.preview': mockPreview });
      const router = new DataRouter(gw);

      const keys = ['k1', 'k2'];
      const result = await router.getSessionsPreview(keys);

      assert.equal(gw.calls.length, 1);
      assert.equal(gw.calls[0].method, 'sessions.preview');
      assert.deepStrictEqual(gw.calls[0].params.keys, keys);
      assert.equal(gw.calls[0].params.limit, 12);
      assert.equal(gw.calls[0].params.maxChars, 240);
      assert.deepStrictEqual(result, mockPreview);
    });
  });

  describe('getAgentsForStarMap() 数据转换', () => {
    it('输入 agents.list 格式 → 输出 StarMap 格式', async () => {
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': { sessions: [] },
      });
      const router = new DataRouter(gw);
      await router.refresh();

      const agents = router.getAgentsForStarMap();
      assert.equal(agents.length, 2);
      assert.equal(agents[0].id, 'a1');
      assert.equal(agents[0].label, 'Reporter');
      assert.equal(agents[0].icon, 'R');
    });

    it('status 推导：idle（无活跃 session）', async () => {
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': { sessions: [] },
      });
      const router = new DataRouter(gw);
      await router.refresh();

      const agents = router.getAgentsForStarMap();
      assert.equal(agents[0].status, 'idle');
      assert.equal(agents[1].status, 'idle');
    });

    it('status 推导：working（有活跃 session）', async () => {
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': (params) =>
          params.activeMinutes ? MOCK_ACTIVE_SESSIONS : MOCK_ALL_SESSIONS,
      });
      const router = new DataRouter(gw);
      await router.refresh();

      const agents = router.getAgentsForStarMap();
      const a1 = agents.find(a => a.id === 'a1');
      assert.equal(a1.status, 'working');
    });

    it('status 推导：error（活跃 session 有 abortedLastRun）', async () => {
      const errorSessions = {
        sessions: [{
          sessionId: 'sess-err', key: 'agent:a1:main:direct:user',
          abortedLastRun: true,
        }],
      };
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': (params) =>
          params.activeMinutes ? errorSessions : MOCK_ALL_SESSIONS,
      });
      const router = new DataRouter(gw);
      await router.refresh();

      const a1 = router.getAgentsForStarMap().find(a => a.id === 'a1');
      assert.equal(a1.status, 'error');
    });
  });

  describe('getActiveSessionsForStarMap() 数据转换', () => {
    it('输入 sessions.list 格式 → 输出 StarMap 格式', async () => {
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': (params) =>
          params.activeMinutes ? MOCK_ACTIVE_SESSIONS : MOCK_ALL_SESSIONS,
      });
      const router = new DataRouter(gw);
      await router.refresh();

      const sessions = router.getActiveSessionsForStarMap();
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].id, 'sess-1');
      assert.equal(sessions[0].sessionKey, 'agent:a1:main:direct:user');
    });

    it('agentId 从 sessionKey 提取', async () => {
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': (params) =>
          params.activeMinutes ? MOCK_ACTIVE_SESSIONS : MOCK_ALL_SESSIONS,
      });
      const router = new DataRouter(gw);
      await router.refresh();

      const sessions = router.getActiveSessionsForStarMap();
      assert.equal(sessions[0].agentId, 'a1');
    });

    it('abortedLastRun 映射为 error status', async () => {
      const errorSessions = {
        sessions: [{
          sessionId: 'sess-err', key: 'agent:a1:main:direct:user',
          abortedLastRun: true, label: 'Error Session',
        }],
      };
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': (params) =>
          params.activeMinutes ? errorSessions : MOCK_ALL_SESSIONS,
      });
      const router = new DataRouter(gw);
      await router.refresh();

      const sessions = router.getActiveSessionsForStarMap();
      assert.equal(sessions[0].status, 'error');
    });

    it('包含 lastMessagePreview 字段', async () => {
      const sessionsWithMsg = {
        sessions: [{
          sessionId: 'sess-1', key: 'agent:a1:main:direct:user',
          label: 'Session sess-1', abortedLastRun: false,
          lastMessage: { role: 'assistant', content: '任务完成了' },
        }],
      };
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': (params) =>
          params.activeMinutes ? sessionsWithMsg : MOCK_ALL_SESSIONS,
      });
      const router = new DataRouter(gw);
      await router.refresh();

      const sessions = router.getActiveSessionsForStarMap();
      assert.equal(sessions[0].lastMessagePreview, '任务完成了');
    });
  });

  // ============================================================
  // Workshop 数据接口
  // ============================================================

  describe('getSessionsForWorkshop() 数据转换', () => {
    // 辅助函数：创建包含 updatedAt 的 session（确保在 2 分钟活跃窗口内）
    const now = Date.now();
    const recentUpdatedAt = now - 60000; // 1 分钟前

    it('基本映射：sessionId/sessionKey/title/agentId', async () => {
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': {
          sessions: [
            { sessionId: 'sess-1', key: 'agent:a1:main:direct:user', label: '测试会话', abortedLastRun: false, updatedAt: recentUpdatedAt },
          ],
        },
      });
      const router = new DataRouter(gw);
      await router.refresh();

      const sessions = router.getSessionsForWorkshop();
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].id, 'sess-1');
      assert.equal(sessions[0].sessionKey, 'agent:a1:main:direct:user');
      assert.equal(sessions[0].title, '测试会话');
      assert.equal(sessions[0].agentId, 'a1');
    });

    it('runState 为空时返回 null', async () => {
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': {
          sessions: [
            { sessionId: 'sess-1', key: 'agent:a1:main:direct:user', label: '测试会话', abortedLastRun: false, updatedAt: recentUpdatedAt },
          ],
        },
      });
      const router = new DataRouter(gw);
      await router.refresh();

      const sessions = router.getSessionsForWorkshop();
      assert.equal(sessions[0].runState, null);
    });

    it('包含 abortedLastRun 字段', async () => {
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': {
          sessions: [
            { sessionId: 'sess-1', key: 'agent:a1:main:direct:user', label: '正常会话', abortedLastRun: false, updatedAt: recentUpdatedAt },
            { sessionId: 'sess-2', key: 'agent:a2:main:direct:user', label: '异常会话', abortedLastRun: true, updatedAt: recentUpdatedAt },
          ],
        },
      });
      const router = new DataRouter(gw);
      await router.refresh();

      const sessions = router.getSessionsForWorkshop();
      assert.equal(sessions[0].abortedLastRun, false);
      assert.equal(sessions[1].abortedLastRun, true);
    });

    it('包含 pendingApproval 字段（无审批时为 null）', async () => {
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': {
          sessions: [
            { sessionId: 'sess-1', key: 'agent:a1:main:direct:user', label: '测试会话', abortedLastRun: false, updatedAt: recentUpdatedAt },
          ],
        },
      });
      const router = new DataRouter(gw);
      await router.refresh();

      const sessions = router.getSessionsForWorkshop();
      assert.equal(sessions[0].pendingApproval, null);
    });

    it('runState 从 agent 事件更新：lifecycle start → running', async () => {
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': {
          sessions: [
            { sessionId: 'sess-1', key: 'agent:a1:main:direct:user', label: '测试会话', abortedLastRun: false, updatedAt: recentUpdatedAt },
          ],
        },
      });
      const router = new DataRouter(gw);
      await router.refresh();  // 先初始化 session 数据
      router.subscribePush();

      // 模拟 lifecycle start 事件
      gw._emit('agent', {
        sessionKey: 'agent:a1:main:direct:user',
        stream: 'lifecycle',
        data: { phase: 'start' },
        runId: 'run-1',
      });

      const sessions = router.getSessionsForWorkshop();
      assert.equal(sessions[0].runState.status, 'running');
      assert.equal(sessions[0].runState.runId, 'run-1');
    });

    it('runState 从 agent 事件更新：tool start → tool', async () => {
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': {
          sessions: [
            { sessionId: 'sess-1', key: 'agent:a1:main:direct:user', label: '测试会话', abortedLastRun: false, updatedAt: recentUpdatedAt },
          ],
        },
      });
      const router = new DataRouter(gw);
      await router.refresh();  // 先初始化 session 数据
      router.subscribePush();

      // 模拟 tool start 事件
      gw._emit('agent', {
        sessionKey: 'agent:a1:main:direct:user',
        stream: 'tool',
        data: { phase: 'start', name: 'Bash' },
        runId: 'run-1',
      });

      const sessions = router.getSessionsForWorkshop();
      assert.equal(sessions[0].runState.status, 'tool');
      assert.equal(sessions[0].runState.toolName, 'Bash');
      // Bash 映射到 'Exec' (tool-display.js 中 bash: { emoji: '🛠️', title: 'Exec' })
      assert.equal(sessions[0].runState.toolTitle, 'Exec');
    });

    it('runState 从 agent 事件更新：assistant → streaming', async () => {
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': {
          sessions: [
            { sessionId: 'sess-1', key: 'agent:a1:main:direct:user', label: '测试会话', abortedLastRun: false, updatedAt: recentUpdatedAt },
          ],
        },
      });
      const router = new DataRouter(gw);
      await router.refresh();  // 先初始化 session 数据
      router.subscribePush();

      // 模拟 assistant 事件（模型输出）
      gw._emit('agent', {
        sessionKey: 'agent:a1:main:direct:user',
        stream: 'assistant',
        data: {},
        runId: 'run-1',
      });

      const sessions = router.getSessionsForWorkshop();
      assert.equal(sessions[0].runState.status, 'streaming');
    });

    it('runState 从 agent 事件更新：lifecycle end → idle', async () => {
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': {
          sessions: [
            { sessionId: 'sess-1', key: 'agent:a1:main:direct:user', label: '测试会话', abortedLastRun: false, updatedAt: recentUpdatedAt },
          ],
        },
      });
      const router = new DataRouter(gw);
      await router.refresh();  // 先初始化 session 数据
      router.subscribePush();

      // 先开始 session
      gw._emit('agent', {
        sessionKey: 'agent:a1:main:direct:user',
        stream: 'lifecycle',
        data: { phase: 'start' },
        runId: 'run-1',
      });

      // 结束 session
      gw._emit('agent', {
        sessionKey: 'agent:a1:main:direct:user',
        stream: 'lifecycle',
        data: { phase: 'end' },
        runId: 'run-1',
      });

      const sessions = router.getSessionsForWorkshop();
      assert.equal(sessions[0].runState.status, 'idle');
    });

    it('runState 从 agent 事件更新：lifecycle error → error', async () => {
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': {
          sessions: [
            { sessionId: 'sess-1', key: 'agent:a1:main:direct:user', label: '测试会话', abortedLastRun: false, updatedAt: recentUpdatedAt },
          ],
        },
      });
      const router = new DataRouter(gw);
      await router.refresh();  // 先初始化 session 数据
      router.subscribePush();

      // 模拟 error 事件
      gw._emit('agent', {
        sessionKey: 'agent:a1:main:direct:user',
        stream: 'lifecycle',
        data: { phase: 'error' },
        runId: 'run-1',
      });

      const sessions = router.getSessionsForWorkshop();
      assert.equal(sessions[0].runState.status, 'error');
    });

    it('runState 从 chat 事件更新：aborted → aborted', async () => {
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': {
          sessions: [
            { sessionId: 'sess-1', key: 'agent:a1:main:direct:user', label: '测试会话', abortedLastRun: false, updatedAt: recentUpdatedAt },
          ],
        },
      });
      const router = new DataRouter(gw);
      await router.refresh();  // 先初始化 session 数据
      router.subscribePush();

      // 模拟 chat aborted 事件
      gw._emit('chat', {
        sessionKey: 'agent:a1:main:direct:user',
        state: 'aborted',
        runId: 'run-1',
      });

      const sessions = router.getSessionsForWorkshop();
      assert.equal(sessions[0].runState.status, 'aborted');
    });

    it('runState 从 chat 事件更新：final → idle', async () => {
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': {
          sessions: [
            { sessionId: 'sess-1', key: 'agent:a1:main:direct:user', label: '测试会话', abortedLastRun: false, updatedAt: recentUpdatedAt },
          ],
        },
      });
      const router = new DataRouter(gw);
      await router.refresh();  // 先初始化 session 数据
      router.subscribePush();

      // 模拟 chat final 事件
      gw._emit('chat', {
        sessionKey: 'agent:a1:main:direct:user',
        state: 'final',
        runId: 'run-1',
      });

      const sessions = router.getSessionsForWorkshop();
      assert.equal(sessions[0].runState.status, 'idle');
    });
  });

  describe('getMetrics() 聚合', () => {
    it('验证 agents/activeSessions/totalTokens 等字段', async () => {
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': (params) =>
          params.activeMinutes ? MOCK_ACTIVE_SESSIONS : MOCK_ALL_SESSIONS,
        'sessions.usage': MOCK_USAGE,
      });
      const router = new DataRouter(gw);
      await router.refresh();
      await router.refreshUsage();

      const m = router.getMetrics();
      assert.equal(m.agents, 2);
      assert.equal(m.activeSessions, 1);
      assert.equal(m.activeAgents, 1);  // 只有 a1 有活跃 session
      assert.equal(m.totalTokens, 5000);
      assert.equal(m.totalCost, 0.05);
      assert.equal(m.completedSessions, 2);  // 3 total - 1 active = 2
    });
  });

  // ============================================================
  // 阶段三：扩展数据与控制
  // ============================================================

  describe('getHealth() 系统健康', () => {
    it('调用 health 方法（gateway 层）', async () => {
      const mockHealth = { status: 'ok', uptime: 12345, agents: 3 };
      const gw = createMockGateway({ 'health': mockHealth });
      const router = new DataRouter(gw);

      const result = await router.getHealth();

      assert.equal(gw.calls.length, 1);
      assert.equal(gw.calls[0].method, 'health');
      assert.deepStrictEqual(result, mockHealth);
    });

    it('结果存储到 _health', async () => {
      const mockHealth = { status: 'ok', uptime: 999 };
      const gw = createMockGateway({ 'health': mockHealth });
      const router = new DataRouter(gw);

      await router.getHealth();

      assert.deepStrictEqual(router._health, mockHealth);
    });

    it('health getter 返回最新状态', async () => {
      const mockHealth = { status: 'ok', uptime: 555 };
      const gw = createMockGateway({ 'health': mockHealth });
      const router = new DataRouter(gw);

      await router.getHealth();

      assert.deepStrictEqual(router.health, mockHealth);
    });

    it('传递 probe 参数', async () => {
      const gw = createMockGateway({ 'health': { status: 'ok' } });
      const router = new DataRouter(gw);

      await router.getHealth(true);

      assert.equal(gw.calls[0].params.probe, true);
    });
  });

  describe('getModels() 可用模型', () => {
    it('调用 models.list 方法', async () => {
      const mockModels = { models: [
        { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
        { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      ]};
      const gw = createMockGateway({ 'models.list': mockModels });
      const router = new DataRouter(gw);

      const result = await router.getModels();

      assert.equal(gw.calls.length, 1);
      assert.equal(gw.calls[0].method, 'models.list');
      assert.equal(result.length, 2);
      assert.equal(result[0].id, 'claude-opus-4-6');
    });

    it('结果存储到 _models', async () => {
      const mockModels = { models: [{ id: 'm1', label: 'Model 1' }] };
      const gw = createMockGateway({ 'models.list': mockModels });
      const router = new DataRouter(gw);

      await router.getModels();

      assert.equal(router._models.length, 1);
      assert.equal(router._models[0].id, 'm1');
    });

    it('空响应返回空数组', async () => {
      const gw = createMockGateway({ 'models.list': {} });
      const router = new DataRouter(gw);

      const result = await router.getModels();

      assert.deepStrictEqual(result, []);
      assert.deepStrictEqual(router._models, []);
    });
  });

  describe('会话管理操作', () => {
    it('patchSession 调用 sessions.patch', async () => {
      const gw = createMockGateway({ 'sessions.patch': { ok: true } });
      const router = new DataRouter(gw);

      await router.patchSession('key-1', { label: 'new-label' });

      assert.equal(gw.calls.length, 1);
      assert.equal(gw.calls[0].method, 'sessions.patch');
      assert.equal(gw.calls[0].params.key, 'key-1');
      assert.deepStrictEqual(gw.calls[0].params.patch, { label: 'new-label' });
    });

    it('resetSession 调用 sessions.reset', async () => {
      const gw = createMockGateway({ 'sessions.reset': { ok: true, sessionId: 'key-1' } });
      const router = new DataRouter(gw);

      await router.resetSession('key-1', '手动重置');

      assert.equal(gw.calls.length, 1);
      assert.equal(gw.calls[0].method, 'sessions.reset');
      assert.equal(gw.calls[0].params.key, 'key-1');
      assert.equal(gw.calls[0].params.note, '手动重置');
    });

    it('compactSessions 调用 sessions.compact', async () => {
      const gw = createMockGateway({ 'sessions.compact': { ok: true, compactedCount: 3 } });
      const router = new DataRouter(gw);

      const result = await router.compactSessions();

      assert.equal(gw.calls.length, 1);
      assert.equal(gw.calls[0].method, 'sessions.compact');
      assert.equal(result.compactedCount, 3);
    });
  });

  describe('getMetrics() 错误聚合', () => {
    it('totalErrors 统计 abortedLastRun 数量', async () => {
      const errorSessions = {
        sessions: [
          { sessionId: 'e1', key: 'agent:a1:mock:direct:demo', abortedLastRun: true },
          { sessionId: 'e2', key: 'agent:a2:mock:direct:demo', abortedLastRun: false },
          { sessionId: 'e3', key: 'agent:a1:mock:direct:demo', abortedLastRun: true },
        ],
      };
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': (params) => params.activeMinutes ? errorSessions : MOCK_ALL_SESSIONS,
      });
      const router = new DataRouter(gw);
      await router.refresh();

      const m = router.getMetrics();
      assert.equal(m.totalErrors, 2);
    });

    it('无错误时 totalErrors 为 0', async () => {
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': (params) => params.activeMinutes ? MOCK_ACTIVE_SESSIONS : MOCK_ALL_SESSIONS,
      });
      const router = new DataRouter(gw);
      await router.refresh();

      const m = router.getMetrics();
      assert.equal(m.totalErrors, 0);
    });
  });

  describe('tailLogs() 日志查询', () => {
    it('调用 logs.tail 方法', async () => {
      const mockLogs = { file: 'openclaw.log', cursor: 5, lines: ['line1', 'line2'], truncated: false };
      const gw = createMockGateway({ 'logs.tail': mockLogs });
      const router = new DataRouter(gw);

      const result = await router.tailLogs(0);

      assert.equal(gw.calls.length, 1);
      assert.equal(gw.calls[0].method, 'logs.tail');
      assert.deepStrictEqual(result, mockLogs);
    });

    it('传递 cursor 和 limit 参数', async () => {
      const gw = createMockGateway({ 'logs.tail': { lines: [] } });
      const router = new DataRouter(gw);

      await router.tailLogs(42, 50);

      assert.equal(gw.calls[0].params.cursor, 42);
      assert.equal(gw.calls[0].params.limit, 50);
    });

    it('默认 limit 为 100', async () => {
      const gw = createMockGateway({ 'logs.tail': { lines: [] } });
      const router = new DataRouter(gw);

      await router.tailLogs(0);

      assert.equal(gw.calls[0].params.limit, 100);
    });
  });

  describe('路由日志回调', () => {
    it('每次调用都触发 onRoute 回调', async () => {
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': { sessions: [] },
      });
      const router = new DataRouter(gw);
      const logs = [];
      router.onRoute(entry => logs.push(entry));

      await router.refresh();

      // refresh() 产生 3 次 gateway 调用
      assert.equal(logs.length, 3);
    });

    it('getSessionDetail 记录 gateway 层（chat.history）', async () => {
      const gw = createMockGateway({
        'chat.history': MOCK_CHAT_HISTORY,
      });
      const router = new DataRouter(gw);
      const logs = [];
      router.onRoute(entry => logs.push(entry));

      await router.getSessionDetail('agent:a1:main:direct:user');

      assert.equal(logs.length, 1);
      const log = logs[0];
      assert.equal(log.caller, 'getSessionDetail');
      assert.equal(log.method, 'chat.history');
      assert.equal(log.layer, 'gateway');
      assert.equal(typeof log.durationMs, 'number');
      assert.ok(log.durationMs >= 0);
    });

    it('refresh 调用记录 gateway 层', async () => {
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': { sessions: [] },
      });
      const router = new DataRouter(gw);
      const logs = [];
      router.onRoute(entry => logs.push(entry));

      await router.refresh();

      for (const log of logs) {
        assert.equal(log.layer, 'gateway');
        assert.equal(log.caller, 'refresh');
      }
      assert.equal(logs[0].method, 'agents.list');
      assert.equal(logs[1].method, 'sessions.list');
      assert.equal(logs[2].method, 'sessions.list');
    });

    it('refreshUsage 调用记录 gateway 层', async () => {
      const gw = createMockGateway({
        'sessions.usage': MOCK_USAGE,
      });
      const router = new DataRouter(gw);
      const logs = [];
      router.onRoute(entry => logs.push(entry));

      await router.refreshUsage();

      assert.equal(logs.length, 1);
      assert.equal(logs[0].caller, 'refreshUsage');
      assert.equal(logs[0].method, 'sessions.usage');
      assert.equal(logs[0].layer, 'gateway');
    });

    it('getSessionTimeline 复用 getSessionDetail，记录 gateway 层', async () => {
      const gw = createMockGateway({
        'chat.history': MOCK_CHAT_HISTORY,
      });
      const router = new DataRouter(gw);
      const logs = [];
      router.onRoute(entry => logs.push(entry));

      await router.getSessionTimeline('agent:a1:main:direct:user');

      assert.equal(logs.length, 1);
      assert.equal(logs[0].caller, 'getSessionDetail');
      assert.equal(logs[0].method, 'chat.history');
      assert.equal(logs[0].layer, 'gateway');
    });

    it('无回调注册时不报错', async () => {
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': { sessions: [] },
      });
      const router = new DataRouter(gw);
      // 不注册 onRoute
      await router.refresh();  // should not throw
    });
  });

  describe('subscribePush() 推送事件', () => {
    it('subscribePush 注册 4 个事件监听', () => {
      const gw = createMockGateway();
      const router = new DataRouter(gw);

      router.subscribePush();

      assert.ok(gw._listeners['agent']?.length === 1);
      assert.ok(gw._listeners['chat']?.length === 1);
      assert.ok(gw._listeners['exec.approval.requested']?.length === 1);
      assert.ok(gw._listeners['health']?.length === 1);
    });

    it('unsubscribePush 注销所有监听', () => {
      const gw = createMockGateway();
      const router = new DataRouter(gw);

      router.subscribePush();
      router.unsubscribePush();

      assert.equal(gw._listeners['agent']?.length || 0, 0);
      assert.equal(gw._listeners['chat']?.length || 0, 0);
      assert.equal(gw._listeners['exec.approval.requested']?.length || 0, 0);
      assert.equal(gw._listeners['health']?.length || 0, 0);
    });

    it('重复 subscribePush 不重复注册', () => {
      const gw = createMockGateway();
      const router = new DataRouter(gw);

      router.subscribePush();
      router.subscribePush();
      router.subscribePush();

      assert.equal(gw._listeners['agent'].length, 1);
      assert.equal(gw._listeners['chat'].length, 1);
    });

    it('chat final → emit push:chat with step', () => {
      const gw = createMockGateway();
      const router = new DataRouter(gw);
      const received = [];
      router.on('push:chat', (data) => received.push(data));
      router.subscribePush();

      gw._emit('chat', {
        sessionKey: 'agent:a1:mock:direct:demo',
        state: 'final',
        message: { role: 'user', content: '你好', timestamp: 1000 },
      });

      assert.equal(received.length, 1);
      assert.equal(received[0].sessionKey, 'agent:a1:mock:direct:demo');
      assert.ok(received[0].step);
      assert.equal(received[0].step.type, 'llm_input');
    });

    it('chat error → emit push:chat with error step', () => {
      const gw = createMockGateway();
      const router = new DataRouter(gw);
      const received = [];
      router.on('push:chat', (data) => received.push(data));
      router.subscribePush();

      gw._emit('chat', {
        sessionKey: 'agent:a1:mock:direct:demo',
        state: 'error',
        errorMessage: 'timeout',
      });

      assert.equal(received.length, 1);
      assert.equal(received[0].step.type, 'error');
      assert.ok(received[0].step.summary.includes('timeout'));
    });

    it('chat delta → 不触发 push:chat', () => {
      const gw = createMockGateway();
      const router = new DataRouter(gw);
      const received = [];
      router.on('push:chat', (data) => received.push(data));
      router.subscribePush();

      gw._emit('chat', {
        sessionKey: 'agent:a1:mock:direct:demo',
        state: 'delta',
        message: 'partial...',
      });

      assert.equal(received.length, 0);
    });

    it('agent → emit push:agent + 触发防抖 refresh', async () => {
      const gw = createMockGateway({
        'agents.list': MOCK_AGENTS,
        'sessions.list': { sessions: [] },
      });
      const router = new DataRouter(gw);
      const received = [];
      router.on('push:agent', (data) => received.push(data));
      router.subscribePush();

      gw._emit('agent', { runId: 'run-1', seq: 1, data: { status: 'working' } });

      assert.equal(received.length, 1);
      assert.equal(received[0].runId, 'run-1');

      // 防抖 refresh 会在 1s 后触发
      assert.ok(router._refreshTimer);
      // 清理 timer 避免测试 hang
      clearTimeout(router._refreshTimer);
      router._refreshTimer = null;
    });

    it('approval → 添加到 pendingApprovals + emit push:approval', () => {
      const gw = createMockGateway();
      const router = new DataRouter(gw);
      const received = [];
      router.on('push:approval', (data) => received.push(data));
      router.subscribePush();

      gw._emit('exec.approval.requested', {
        requestId: 'apr-1',
        toolName: 'Bash',
        sessionKey: 'agent:a1:mock:direct:demo',
        params: { command: 'ls' },
      });

      assert.equal(received.length, 1);
      assert.equal(received[0].requestId, 'apr-1');
      assert.equal(router.getPendingApprovals().length, 1);
      assert.equal(router.getPendingApprovals()[0].toolName, 'Bash');
    });

    it('health → 更新 _health + emit push:health', () => {
      const gw = createMockGateway();
      const router = new DataRouter(gw);
      const received = [];
      router.on('push:health', (data) => received.push(data));
      router.subscribePush();

      gw._emit('health', { status: 'ok', agents: 3 });

      assert.equal(received.length, 1);
      assert.equal(router._health.status, 'ok');
    });

    it('resolveApproval 从列表中移除', () => {
      const gw = createMockGateway();
      const router = new DataRouter(gw);
      router.subscribePush();

      gw._emit('exec.approval.requested', { requestId: 'apr-1', toolName: 'Bash' });
      gw._emit('exec.approval.requested', { requestId: 'apr-2', toolName: 'Write' });
      assert.equal(router.getPendingApprovals().length, 2);

      router.resolveApproval('apr-1');
      assert.equal(router.getPendingApprovals().length, 1);
      assert.equal(router.getPendingApprovals()[0].requestId, 'apr-2');
    });

    it('chat aborted + assistant message → emit push:chat with aborted step', () => {
      const gw = createMockGateway();
      const router = new DataRouter(gw);
      const received = [];
      router.on('push:chat', (data) => received.push(data));
      router.subscribePush();

      gw._emit('chat', {
        sessionKey: 'agent:a1:mock:direct:demo',
        state: 'aborted',
        message: { role: 'assistant', content: '部分回复内容', timestamp: 5000 },
      });

      assert.equal(received.length, 1);
      assert.equal(received[0].sessionKey, 'agent:a1:mock:direct:demo');
      assert.equal(received[0].step.type, 'aborted');
    });

    it('chat aborted 无 message → 不触发 push:chat', () => {
      const gw = createMockGateway();
      const router = new DataRouter(gw);
      const received = [];
      router.on('push:chat', (data) => received.push(data));
      router.subscribePush();

      gw._emit('chat', {
        sessionKey: 'agent:a1:mock:direct:demo',
        state: 'aborted',
      });

      assert.equal(received.length, 0);
    });

    it('chat aborted + non-assistant message → 不触发 push:chat', () => {
      const gw = createMockGateway();
      const router = new DataRouter(gw);
      const received = [];
      router.on('push:chat', (data) => received.push(data));
      router.subscribePush();

      gw._emit('chat', {
        sessionKey: 'agent:a1:mock:direct:demo',
        state: 'aborted',
        message: { role: 'user', content: '用户消息', timestamp: 5000 },
      });

      assert.equal(received.length, 0);
    });

    it('chat final 无 message → 不触发 push:chat', () => {
      const gw = createMockGateway();
      const router = new DataRouter(gw);
      const received = [];
      router.on('push:chat', (data) => received.push(data));
      router.subscribePush();

      gw._emit('chat', {
        sessionKey: 'agent:a1:mock:direct:demo',
        state: 'final',
      });

      assert.equal(received.length, 0);
    });

    it('chat error 无 errorMessage → 显示未知错误', () => {
      const gw = createMockGateway();
      const router = new DataRouter(gw);
      const received = [];
      router.on('push:chat', (data) => received.push(data));
      router.subscribePush();

      gw._emit('chat', {
        sessionKey: 'agent:a1:mock:direct:demo',
        state: 'error',
      });

      assert.equal(received.length, 1);
      assert.equal(received[0].step.type, 'error');
      assert.equal(received[0].step.summary, '未知错误');
    });

    it('推送事件触发路由日志回调（layer: push）', () => {
      const gw = createMockGateway();
      const router = new DataRouter(gw);
      const logs = [];
      router.onRoute(entry => logs.push(entry));
      router.subscribePush();

      gw._emit('chat', { sessionKey: 'k', state: 'final', message: { role: 'user', content: 'hi', timestamp: 1 } });
      gw._emit('agent', { runId: 'r' });
      gw._emit('exec.approval.requested', { requestId: 'a' });
      gw._emit('health', { status: 'ok' });

      assert.equal(logs.length, 4);
      for (const log of logs) {
        assert.equal(log.layer, 'push');
        assert.equal(log.caller, 'push');
        assert.equal(log.durationMs, 0);
      }
      assert.equal(logs[0].method, 'chat');
      assert.equal(logs[1].method, 'agent');
      assert.equal(logs[2].method, 'exec.approval.requested');
      assert.equal(logs[3].method, 'health');

      // 清理 agent 推送产生的 refresh timer
      clearTimeout(router._refreshTimer);
      router._refreshTimer = null;
    });
  });

  // ============================================================
  // AI Advice 数据管理
  // ============================================================

  describe('AI Advice 数据管理', () => {
    const MOCK_AI_ADVICES = {
      advices: [
        { id: 'a1', type: 'suggestion', message: '建议1', priority: 1, createdAt: 1000 },
        { id: 'a2', type: 'reminder', message: '提醒2', priority: 2, createdAt: 2000 },
        { id: 'a3', type: 'tip', message: '技巧3', priority: 3, createdAt: 3000 },
      ],
      config: { maxAdviceCount: 5 },
    };

    it('getAIAdvices() 初始状态返回 null', () => {
      const gw = createMockGateway();
      const router = new DataRouter(gw);

      const result = router.getAIAdvices();

      assert.strictEqual(result.advices, null);
      assert.equal(result.maxCount, 3);  // 默认值
    });

    it('refreshAIAdvices() 成功时设置 _aiAdvices', async () => {
      const gw = createMockGateway({
        'clawdeck.aiAdvices': MOCK_AI_ADVICES,
      });
      const router = new DataRouter(gw);

      await router.refreshAIAdvices();

      assert.equal(router.getAIAdvices().advices.length, 3);
      assert.equal(router.getAIAdvices().maxCount, 5);
    });

    it('refreshAIAdvices() 失败时 _aiAdvices = []', async () => {
      const gw = createMockGateway({
        'clawdeck.aiAdvices': null,  // 返回 null 模拟失败
      });
      const router = new DataRouter(gw);

      await router.refreshAIAdvices();

      assert.deepStrictEqual(router.getAIAdvices().advices, []);
      assert.equal(router.getAIAdvices().maxCount, 3);  // 保持默认值
    });

    it('refreshAIAdvices() 调用 clawdeck.aiAdvices 方法', async () => {
      const gw = createMockGateway({
        'clawdeck.aiAdvices': MOCK_AI_ADVICES,
      });
      const router = new DataRouter(gw);

      await router.refreshAIAdvices();

      assert.equal(gw.calls.length, 1);
      assert.equal(gw.calls[0].method, 'clawdeck.aiAdvices');
    });

    it('_scheduleAIAdvicesRefresh() 延迟触发 refresh', async () => {
      const gw = createMockGateway({
        'clawdeck.aiAdvices': MOCK_AI_ADVICES,
      });
      const router = new DataRouter(gw);

      // 调用 _scheduleAIAdvicesRefresh 内部方法
      router._scheduleAIAdvicesRefresh();

      // 初始状态：未调用
      assert.equal(gw.calls.length, 0);

      // 等待 5.5 秒（延迟 5 秒 + 缓冲）
      await new Promise(resolve => setTimeout(resolve, 5500));

      // 定时器触发后调用了 refreshAIAdvices
      assert.equal(gw.calls.length, 1);
      assert.equal(gw.calls[0].method, 'clawdeck.aiAdvices');

      // 清理定时器
      if (router._aiAdviceTimer) {
        clearTimeout(router._aiAdviceTimer);
        router._aiAdviceTimer = null;
      }
    });

    it('refreshAIAdvices() 成功后触发 data:ai-advices-updated 事件', async () => {
      const gw = createMockGateway({
        'clawdeck.aiAdvices': MOCK_AI_ADVICES,
      });
      const router = new DataRouter(gw);

      const received = [];
      router.on('data:ai-advices-updated', () => received.push(true));

      await router.refreshAIAdvices();

      assert.equal(received.length, 1);
    });

    it('连续调用 _scheduleAIAdvicesRefresh() 只触发一次 refresh', async () => {
      const gw = createMockGateway({
        'clawdeck.aiAdvices': MOCK_AI_ADVICES,
      });
      const router = new DataRouter(gw);

      // 连续调用 3 次
      router._scheduleAIAdvicesRefresh();
      router._scheduleAIAdvicesRefresh();
      router._scheduleAIAdvicesRefresh();

      // 等待 5.5 秒
      await new Promise(resolve => setTimeout(resolve, 5500));

      // 只触发一次
      assert.equal(gw.calls.length, 1);

      // 清理定时器
      if (router._aiAdviceTimer) {
        clearTimeout(router._aiAdviceTimer);
        router._aiAdviceTimer = null;
      }
    });

    it('空 advices 数组也正确处理', async () => {
      const gw = createMockGateway({
        'clawdeck.aiAdvices': { advices: [], config: { maxAdviceCount: 3 } },
      });
      const router = new DataRouter(gw);

      await router.refreshAIAdvices();

      assert.deepStrictEqual(router.getAIAdvices().advices, []);
      assert.equal(router.getAIAdvices().maxCount, 3);
    });
  });
});
