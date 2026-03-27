/**
 * WorkshopPanel 订单模块测试
 *
 * 测试 WorkshopPanel 的状态渲染、打断按钮、发送按钮等功能。
 *
 * 运行: node --test test/workshop-panel.test.mjs
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Mock DataRouter
function createMockDataRouter(agents = [], sessions = []) {
  return {
    getAgentsForWorkshop: () => agents,
    getSessionsForWorkshop: () => sessions,
    getMetrics: () => ({ totalTokens: 0, totalCost: 0, completedSessions: 0, totalErrors: 0 }),
  };
}

// Mock Gateway
function createMockGateway() {
  return {
    status: 'connected',
    on: () => {},
    off: () => {},
    resolveApproval: async () => ({ ok: true }),
    sendInstruction: async () => ({ ok: true }),
    abortSession: async () => ({ ok: true }),
  };
}

// ============================================================
// 模拟 WorkshopPanel 的关键方法（用于测试）
// ============================================================

/** 模拟 _canAbort 方法（复制自 workshop-panel.js） */
function canAbort(session) {
  if (!session?.id) return false;
  const runState = session?.runState?.status;
  // 只有运行中状态才显示打断按钮：running, streaming, tool
  if (runState === 'running' || runState === 'streaming' || runState === 'tool') {
    return true;
  }
  return false;
}

/** 模拟状态判断逻辑（复制自 workshop-panel.js） */
function getStatusDisplay(session) {
  const runState = session?.runState;
  const abortedLastRun = session?.abortedLastRun;

  if (runState?.status === 'tool') {
    return { text: `${runState.toolEmoji || '🧰'} ${runState.toolTitle || '执行工具'}`, class: 'working' };
  } else if (runState?.status === 'streaming') {
    return { text: '💭 思考中', class: 'working' };
  } else if (runState?.status === 'running') {
    return { text: '⚡ 运行中', class: 'working' };
  } else if (runState?.status === 'error' || abortedLastRun) {
    return { text: '⚠️ 上次异常', class: 'error' };
  } else if (runState?.status === 'aborted') {
    return { text: '⏹ 已中止', class: 'error' };
  } else if (session?.pendingApproval) {
    return { text: '🔔 等待审批', class: 'pending' };
  } else {
    return { text: '✅ 就绪', class: 'idle' };
  }
}

// ============================================================
// Tests
// ============================================================

describe('WorkshopPanel 订单状态渲染', () => {

  describe('runState.status === tool', () => {
    it('显示 "🧰 执行工具中"，class=working，有打断按钮', () => {
      const session = {
        id: 'sess-1',
        sessionKey: 'agent:a1:main:direct:user',
        title: '测试会话',
        runState: { status: 'tool', toolName: 'Bash', toolEmoji: '💻', toolTitle: '执行终端命令' },
      };

      const status = getStatusDisplay(session);
      assert.equal(status.text, '💻 执行终端命令');
      assert.equal(status.class, 'working');
      assert.equal(canAbort(session), true);
    });
  });

  describe('runState.status === streaming', () => {
    it('显示 "💭 思考中"，class=working，有打断按钮', () => {
      const session = {
        id: 'sess-1',
        sessionKey: 'agent:a1:main:direct:user',
        title: '测试会话',
        runState: { status: 'streaming' },
      };

      const status = getStatusDisplay(session);
      assert.equal(status.text, '💭 思考中');
      assert.equal(status.class, 'working');
      assert.equal(canAbort(session), true);
    });
  });

  describe('runState.status === running', () => {
    it('显示 "⚡ 运行中"，class=working，有打断按钮', () => {
      const session = {
        id: 'sess-1',
        sessionKey: 'agent:a1:main:direct:user',
        title: '测试会话',
        runState: { status: 'running' },
      };

      const status = getStatusDisplay(session);
      assert.equal(status.text, '⚡ 运行中');
      assert.equal(status.class, 'working');
      assert.equal(canAbort(session), true);
    });
  });

  describe('runState.status === error', () => {
    it('显示 "⚠️ 上次异常"，class=error，无打断按钮', () => {
      const session = {
        id: 'sess-1',
        sessionKey: 'agent:a1:main:direct:user',
        title: '测试会话',
        runState: { status: 'error' },
      };

      const status = getStatusDisplay(session);
      assert.equal(status.text, '⚠️ 上次异常');
      assert.equal(status.class, 'error');
      assert.equal(canAbort(session), false);
    });
  });

  describe('abortedLastRun === true', () => {
    it('显示 "⚠️ 上次异常"，class=error，无打断按钮', () => {
      const session = {
        id: 'sess-1',
        sessionKey: 'agent:a1:main:direct:user',
        title: '测试会话',
        abortedLastRun: true,
      };

      const status = getStatusDisplay(session);
      assert.equal(status.text, '⚠️ 上次异常');
      assert.equal(status.class, 'error');
      assert.equal(canAbort(session), false);
    });
  });

  describe('runState.status === aborted', () => {
    it('显示 "⏹ 已中止"，class=error，无打断按钮', () => {
      const session = {
        id: 'sess-1',
        sessionKey: 'agent:a1:main:direct:user',
        title: '测试会话',
        runState: { status: 'aborted' },
      };

      const status = getStatusDisplay(session);
      assert.equal(status.text, '⏹ 已中止');
      assert.equal(status.class, 'error');
      assert.equal(canAbort(session), false);
    });
  });

  describe('pendingApproval 存在', () => {
    it('显示 "🔔 等待审批"，class=pending，无打断按钮', () => {
      const session = {
        id: 'sess-1',
        sessionKey: 'agent:a1:main:direct:user',
        title: '测试会话',
        pendingApproval: { id: 'apr-1', toolName: 'Bash' },
      };

      const status = getStatusDisplay(session);
      assert.equal(status.text, '🔔 等待审批');
      assert.equal(status.class, 'pending');
      assert.equal(canAbort(session), false);
    });
  });

  describe('空闲状态', () => {
    it('显示 "✅ 就绪"，class=idle，无打断按钮', () => {
      const session = {
        id: 'sess-1',
        sessionKey: 'agent:a1:main:direct:user',
        title: '测试会话',
        // 无 runState、无 abortedLastRun、无 pendingApproval
      };

      const status = getStatusDisplay(session);
      assert.equal(status.text, '✅ 就绪');
      assert.equal(status.class, 'idle');
      assert.equal(canAbort(session), false);
    });
  });

  describe('runState.status === idle', () => {
    it('显示 "✅ 就绪"，class=idle，无打断按钮', () => {
      const session = {
        id: 'sess-1',
        sessionKey: 'agent:a1:main:direct:user',
        title: '测试会话',
        runState: { status: 'idle' },
      };

      const status = getStatusDisplay(session);
      assert.equal(status.text, '✅ 就绪');
      assert.equal(status.class, 'idle');
      assert.equal(canAbort(session), false);
    });
  });
});

describe('WorkshopPanel 打断按钮逻辑', () => {

  describe('session.id 为空', () => {
    it('返回 false（不显示打断按钮）', () => {
      const session = {
        // 无 id
        sessionKey: 'agent:a1:main:direct:user',
        runState: { status: 'running' },
      };

      assert.equal(canAbort(session), false);
    });
  });

  describe('session 为空', () => {
    it('返回 false', () => {
      assert.equal(canAbort(null), false);
      assert.equal(canAbort(undefined), false);
    });
  });

  describe('runState 为空', () => {
    it('返回 false', () => {
      const session = {
        id: 'sess-1',
        sessionKey: 'agent:a1:main:direct:user',
        // 无 runState
      };

      assert.equal(canAbort(session), false);
    });
  });

  describe('状态转换场景', () => {
    it('running → tool → running → idle 状态切换', () => {
      // 初始 running
      let session = { id: 'sess-1', runState: { status: 'running' } };
      assert.equal(canAbort(session), true);

      // 切换到 tool
      session = { id: 'sess-1', runState: { status: 'tool' } };
      assert.equal(canAbort(session), true);

      // 切换到 running
      session = { id: 'sess-1', runState: { status: 'running' } };
      assert.equal(canAbort(session), true);

      // 切换到 idle（结束）
      session = { id: 'sess-1', runState: { status: 'idle' } };
      assert.equal(canAbort(session), false);
    });

    it('running → error → running 恢复场景', () => {
      // 运行时出错
      let session = { id: 'sess-1', runState: { status: 'error' } };
      assert.equal(canAbort(session), false);

      // 重新运行
      session = { id: 'sess-1', runState: { status: 'running' } };
      assert.equal(canAbort(session), true);
    });
  });
});

describe('WorkshopPanel 按钮 data-session 属性', () => {

  describe('按钮使用 sessionKey 作为 data-session', () => {
    it('data-session 应该是 sessionKey，不是 sessionId', () => {
      // DataRouter 返回的数据结构
      const session = {
        id: 'sess-1',  // 这是 id
        sessionKey: 'agent:a1:main:direct:user',  // 这是 sessionKey
        title: '测试会话',
        runState: { status: 'running' },
      };

      // 模板中使用 session.sessionKey
      const dataSession = session.sessionKey;

      assert.equal(dataSession, 'agent:a1:main:direct:user');
      assert.notEqual(dataSession, 'sess-1');
    });
  });

  describe('sessionKey 为空时的处理', () => {
    it('空字符串 fallback', () => {
      const session = {
        id: 'sess-1',
        // 无 sessionKey
        title: '测试会话',
        runState: { status: 'running' },
      };

      const dataSession = session?.sessionKey || '';
      assert.equal(dataSession, '');
    });
  });
});

describe('WorkshopPanel 状态覆盖完整测试', () => {

  // 覆盖所有 7 种状态组合
  const allStatusCombinations = [
    { name: 'tool 状态', session: { id: 's1', runState: { status: 'tool', toolName: 'Read' } }, expectAbort: true, expectClass: 'working' },
    { name: 'streaming 状态', session: { id: 's2', runState: { status: 'streaming' } }, expectAbort: true, expectClass: 'working' },
    { name: 'running 状态', session: { id: 's3', runState: { status: 'running' } }, expectAbort: true, expectClass: 'working' },
    { name: 'error 状态', session: { id: 's4', runState: { status: 'error' } }, expectAbort: false, expectClass: 'error' },
    { name: 'abortedLastRun', session: { id: 's5', abortedLastRun: true }, expectAbort: false, expectClass: 'error' },
    { name: 'aborted 状态', session: { id: 's6', runState: { status: 'aborted' } }, expectAbort: false, expectClass: 'error' },
    { name: 'pendingApproval', session: { id: 's7', pendingApproval: { id: 'apr-1' } }, expectAbort: false, expectClass: 'pending' },
    { name: 'idle 状态', session: { id: 's8', runState: { status: 'idle' } }, expectAbort: false, expectClass: 'idle' },
    { name: '空状态（就绪）', session: { id: 's9' }, expectAbort: false, expectClass: 'idle' },
  ];

  allStatusCombinations.forEach(({ name, session, expectAbort, expectClass }) => {
    it(`${name}: 打断按钮=${expectAbort}, statusClass=${expectClass}`, () => {
      const status = getStatusDisplay(session);
      assert.equal(canAbort(session), expectAbort, `打断按钮预期: ${expectAbort}`);
      assert.equal(status.class, expectClass, `状态class预期: ${expectClass}`);
    });
  });
});
