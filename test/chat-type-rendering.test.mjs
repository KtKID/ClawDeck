/**
 * 聊天消息类型渲染测试
 *
 * 基于 CR 报告 cr-report-20260314-182313.md 中发现的 8 个问题设计。
 * 使用真实测试数据 test/data/4cbb6cd6b（含 fallback 场景的 22 条 JSONL 消息）。
 *
 * 覆盖范围：
 *   B1: Fallback 错误消息丢失（空气泡）
 *   B2: 缺少 Reading Indicator（三点等待动画）
 *   B3: 缺少 Fallback 模型切换提示
 *   B4: toolCall 内容的 assistant 消息渲染为空气泡
 *   B5: Fallback 重试导致重复用户消息
 *   B6: model-snapshot 内部事件不应对用户可见
 *   B7: 用户消息未剥离 Inbound Metadata 前缀
 *   B8: assistant content 混合类型处理缺陷
 *
 * 运行: node --test test/chat-type-rendering.test.mjs
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataRouter } from '../bridge/data-router.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================
// Mock Gateway（与 data-router.test.mjs 保持一致）
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
// 加载真实测试数据
// ============================================================

function loadTestData(filename) {
  const filePath = resolve(__dirname, 'data', filename);
  const raw = readFileSync(filePath, 'utf-8');
  return raw.trim().split('\n').map(line => JSON.parse(line));
}

// 4cbb6cd6b: 含 fallback 场景的 22 条消息
const FALLBACK_SESSION_MESSAGES = loadTestData('4cbb6cd6b');

// ============================================================
// 手工构造的边界消息（补充真实数据未覆盖的场景）
// ============================================================

/** B1 场景：assistant 回复 content=[], stopReason="error", 有 errorMessage */
const MSG_ASSISTANT_ERROR = {
  type: 'message',
  id: 'err-assistant-1',
  timestamp: '2026-03-14T10:00:00.000Z',
  message: {
    role: 'assistant',
    content: [],
    stopReason: 'error',
    errorMessage: '401 {"type":"error","error":{"type":"authentication_error","message":"invalid api key"}}',
    provider: 'minimax',
    model: 'MiniMax-M2.5',
  },
};

/** B4 场景：assistant 消息 content 全部是 toolCall */
const MSG_ASSISTANT_TOOLCALL_ONLY = {
  type: 'message',
  id: 'tc-only-1',
  timestamp: '2026-03-14T10:01:00.000Z',
  message: {
    role: 'assistant',
    content: [
      { type: 'toolCall', id: 'call_abc123', name: 'session_status', arguments: {} },
    ],
    stopReason: 'toolUse',
  },
};

/** B8 场景：assistant 消息 content 混合 text + toolCall */
const MSG_ASSISTANT_MIXED_CONTENT = {
  type: 'message',
  id: 'mixed-1',
  timestamp: '2026-03-14T10:02:00.000Z',
  message: {
    role: 'assistant',
    content: [
      { type: 'text', text: '让我查一下天气...' },
      { type: 'toolCall', id: 'call_weather', name: 'exec', arguments: { command: 'curl wttr.in' } },
    ],
    stopReason: 'toolUse',
  },
};

/** B6 场景：model-snapshot 自定义事件 */
const MSG_MODEL_SNAPSHOT = {
  type: 'custom',
  customType: 'model-snapshot',
  data: {
    timestamp: 1773482831497,
    provider: 'bailian',
    modelApi: 'openai-completions',
    modelId: 'qwen3-max-2026-01-23',
  },
  id: 'snapshot-1',
  timestamp: '2026-03-14T10:03:00.000Z',
};

/** B7 场景：用户消息含 Sender metadata 前缀 */
const MSG_USER_WITH_METADATA = {
  type: 'message',
  id: 'user-meta-1',
  timestamp: '2026-03-14T10:04:00.000Z',
  message: {
    role: 'user',
    content: [
      {
        type: 'text',
        text: 'Sender (untrusted metadata):\n```json\n{\n  "label": "openclaw-control-ui",\n  "id": "openclaw-control-ui"\n}\n```\n\n[Sat 2026-03-14 18:07 GMT+8] 你好，你是什么模型',
      },
    ],
  },
};

/** 正常 assistant 文本回复（对照组） */
const MSG_ASSISTANT_TEXT = {
  type: 'message',
  id: 'text-1',
  timestamp: '2026-03-14T10:05:00.000Z',
  message: {
    role: 'assistant',
    content: [
      { type: 'text', text: '我是 MiniMax-M2.5 模型，由 MiniMax 提供支持。' },
    ],
    stopReason: 'stop',
  },
};

/** 正常 toolResult 消息（对照组） */
const MSG_TOOL_RESULT = {
  type: 'message',
  id: 'tr-1',
  timestamp: '2026-03-14T10:06:00.000Z',
  message: {
    role: 'toolResult',
    toolCallId: 'call_abc123',
    toolName: 'session_status',
    content: [{ type: 'text', text: '状态信息...' }],
    isError: false,
  },
};

/** 旧格式：顶层 type="text" 消息（官方 JSONL 另一种格式） */
const MSG_TOPLEVEL_TEXT = {
  type: 'text',
  text: '这是一条用旧格式发送的文本回复',
  id: 'old-text-1',
  timestamp: '2026-03-14T10:07:00.000Z',
};

/** 旧格式：顶层 type="toolCall" */
const MSG_TOPLEVEL_TOOLCALL = {
  type: 'toolCall',
  id: 'old-tc-1',
  name: 'memory_search',
  arguments: { query: 'AI新闻' },
  timestamp: '2026-03-14T10:08:00.000Z',
};

/** 旧格式：顶层 type="toolResult" */
const MSG_TOPLEVEL_TOOLRESULT = {
  type: 'toolResult',
  toolCallId: 'old-tc-1',
  toolName: 'memory_search',
  content: [{ type: 'text', text: '{"results":[]}' }],
  isError: false,
  id: 'old-tr-1',
  timestamp: '2026-03-14T10:09:00.000Z',
};

/** 旧格式：顶层 type="thinking" */
const MSG_TOPLEVEL_THINKING = {
  type: 'thinking',
  thinking: '用户问为什么早上会有两条AI新闻。',
  thinkingSignature: 'sig-abc',
  id: 'think-1',
  timestamp: '2026-03-14T10:10:00.000Z',
};

/** B5 场景：fallback 重试的重复用户消息对 */
const MSG_FALLBACK_USER_PAIR = [
  {
    type: 'message', id: 'u1',
    timestamp: '2026-03-14T10:00:01.000Z',
    message: { role: 'user', content: [{ type: 'text', text: '你好' }] },
  },
  MSG_ASSISTANT_ERROR,
  MSG_MODEL_SNAPSHOT,
  {
    type: 'message', id: 'u2',
    timestamp: '2026-03-14T10:00:03.000Z',
    message: { role: 'user', content: [{ type: 'text', text: '你好' }] },
  },
];

// ============================================================
// Tests
// ============================================================

describe('聊天消息类型渲染 — CR 报告验证', () => {

  // ----------------------------------------------------------
  // B1: Fallback 错误消息丢失（空气泡）
  // ----------------------------------------------------------
  describe('B1: assistant 错误回复（content=[], stopReason=error）', () => {

    it('真实数据第 6 行：minimax 认证失败的 assistant 回复不应渲染为空 llm_output', () => {
      const router = new DataRouter(createMockGateway());
      const msg = FALLBACK_SESSION_MESSAGES[5]; // 第 6 行（0-indexed=5）
      const steps = router._messagesToSteps([msg]);

      assert.equal(steps.length, 1);
      const step = steps[0];

      // 当前状态：type='llm_output' 且 content=[] → 空气泡（BUG）
      // 期望：不应该是 llm_output，或者应该有 isError 标记和 errorMessage
      // 此测试记录当前行为并标记为已知 BUG
      if (step.type === 'llm_output') {
        // BUG: 应该检测 stopReason=error 并标记
        const hasErrorInfo = step.isError === true
          || step.summary?.includes('error')
          || step.summary?.includes('401')
          || step.data?.message?.errorMessage;
        assert.ok(
          hasErrorInfo,
          'B1 BUG: assistant 错误回复被映射为 llm_output 但没有错误信息。' +
          ' content=[] + stopReason=error 应该渲染为错误卡片而非空气泡。' +
          ` 实际 step.type=${step.type}, summary="${step.summary}"`
        );
      }
    });

    it('构造数据：stopReason=error 的 assistant 消息应携带 errorMessage 信息', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps([MSG_ASSISTANT_ERROR]);

      assert.equal(steps.length, 1);
      const step = steps[0];

      // 验证原始数据中的 errorMessage 可达
      assert.ok(
        step.data?.message?.errorMessage,
        'B1: errorMessage 字段应保留在 step.data 中'
      );

      // 当前 BUG：即使 errorMessage 在 data 里，type=llm_output + summary='' → 空气泡
      // 期望修复后：step.type 应为 'error' 或 step.isError=true
      if (step.type === 'llm_output' && !step.summary) {
        assert.fail(
          'B1 BUG: content=[] + stopReason=error 的 assistant 消息被渲染为空 llm_output 气泡。' +
          ' 应该检测 stopReason/errorMessage 并渲染为错误卡片。'
        );
      }
    });

    it('真实数据第 14 行：第二次 minimax 认证失败也应有错误展示', () => {
      const router = new DataRouter(createMockGateway());
      const msg = FALLBACK_SESSION_MESSAGES[13]; // 第 14 行
      const steps = router._messagesToSteps([msg]);

      assert.equal(steps.length, 1);
      const step = steps[0];

      // 与 B1 第一个 case 相同的 BUG
      if (step.type === 'llm_output' && !step.summary) {
        assert.fail(
          'B1 BUG: 第二次 minimax 认证失败（第14行）也渲染为空气泡。'
        );
      }
    });
  });

  // ----------------------------------------------------------
  // B4: toolCall 内容的 assistant 消息渲染为空气泡
  // ----------------------------------------------------------
  describe('B4: assistant 消息 content=[{type:"toolCall"}] 不应为空气泡', () => {

    it('真实数据第 9 行：session_status 工具调用', () => {
      const router = new DataRouter(createMockGateway());
      const msg = FALLBACK_SESSION_MESSAGES[8]; // 第 9 行
      const steps = router._messagesToSteps([msg]);

      assert.equal(steps.length, 1);
      const step = steps[0];

      // BUG 验证：content=[{type:"toolCall"}] 被映射为 llm_output
      // extractTextContent 只取 type="text" → summary 为空
      if (step.type === 'llm_output') {
        assert.ok(
          step.summary && step.summary.length > 0,
          'B4 BUG: assistant content=[{type:"toolCall"}] 被映射为 llm_output，但 summary 为空。' +
          ' 应该映射为 tool_call 或在 UI 层跳过空内容。' +
          ` 实际 summary="${step.summary}"`
        );
      }
    });

    it('构造数据：纯 toolCall assistant 应被识别为 tool_call 类型', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps([MSG_ASSISTANT_TOOLCALL_ONLY]);

      assert.equal(steps.length, 1);
      const step = steps[0];

      // 期望：应映射为 tool_call 而非 llm_output
      // 当前 BUG：message.role=assistant → step.type=llm_output
      if (step.type === 'llm_output') {
        const hasContent = step.summary && step.summary.length > 0;
        assert.ok(
          hasContent,
          'B4 BUG: 纯 toolCall 的 assistant 消息映射为 llm_output + 空 summary。' +
          ' 应该检测 content 中只有 toolCall 并映射为 tool_call 类型。'
        );
      } else {
        // 修复后期望是 tool_call
        assert.equal(step.type, 'tool_call', '纯 toolCall assistant 应映射为 tool_call');
      }
    });

    it('真实数据第 17 行：read 工具调用', () => {
      const router = new DataRouter(createMockGateway());
      const msg = FALLBACK_SESSION_MESSAGES[16]; // 第 17 行
      const steps = router._messagesToSteps([msg]);
      const step = steps[0];

      if (step.type === 'llm_output' && !step.summary) {
        assert.fail('B4 BUG: read 工具调用（第17行）渲染为空 llm_output 气泡');
      }
    });

    it('真实数据第 19 行：exec 工具调用', () => {
      const router = new DataRouter(createMockGateway());
      const msg = FALLBACK_SESSION_MESSAGES[18]; // 第 19 行
      const steps = router._messagesToSteps([msg]);
      const step = steps[0];

      if (step.type === 'llm_output' && !step.summary) {
        assert.fail('B4 BUG: exec 工具调用（第19行）渲染为空 llm_output 气泡');
      }
    });
  });

  // ----------------------------------------------------------
  // B5: Fallback 重试导致重复用户消息
  // ----------------------------------------------------------
  describe('B5: Fallback 重试不应产生重复用户消息', () => {

    it('真实数据第 5、8 行：同一用户输入出现两次', () => {
      const router = new DataRouter(createMockGateway());
      // 提取第5和第8行（都是"你好，你是什么模型"的用户消息）
      const msg5 = FALLBACK_SESSION_MESSAGES[4];
      const msg8 = FALLBACK_SESSION_MESSAGES[7];

      // 验证确实是相同内容
      const text5 = msg5.message.content[0].text;
      const text8 = msg8.message.content[0].text;
      assert.equal(text5, text8, '预期：两条用户消息内容完全相同');

      // 全量转换
      const steps = router._messagesToSteps(FALLBACK_SESSION_MESSAGES);
      const userInputSteps = steps.filter(s => s.type === 'llm_input');

      // 找到包含"你好，你是什么模型"的用户消息
      const matchingInputs = userInputSteps.filter(s => {
        const text = s.summary || '';
        return text.includes('你好') || text.includes('你是什么模型');
      });

      // BUG 验证：应该只有 1 条，但当前有 2 条
      if (matchingInputs.length > 1) {
        assert.fail(
          `B5 BUG: "你好，你是什么模型" 出现了 ${matchingInputs.length} 次用户气泡。` +
          ' Fallback 重试的重复消息应该被去重或标记为重试。'
        );
      }
    });

    it('真实数据第 13、16 行：第二轮同一用户输入也重复', () => {
      const router = new DataRouter(createMockGateway());
      const msg13 = FALLBACK_SESSION_MESSAGES[12];
      const msg16 = FALLBACK_SESSION_MESSAGES[15];

      const text13 = msg13.message.content[0].text;
      const text16 = msg16.message.content[0].text;
      assert.equal(text13, text16, '预期：两条天气查询消息内容完全相同');

      const steps = router._messagesToSteps(FALLBACK_SESSION_MESSAGES);
      const weatherInputs = steps.filter(s =>
        s.type === 'llm_input' && (s.summary || '').includes('天气')
      );

      if (weatherInputs.length > 1) {
        assert.fail(
          `B5 BUG: "明天杭州天气怎么样" 出现了 ${weatherInputs.length} 次用户气泡。`
        );
      }
    });

    it('构造数据：连续相同内容的 user 消息（中间夹 error+snapshot）应去重', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps(MSG_FALLBACK_USER_PAIR);
      const userSteps = steps.filter(s => s.type === 'llm_input');

      if (userSteps.length > 1) {
        assert.fail(
          `B5 BUG: 构造的 fallback 重试场景中，相同用户消息出现了 ${userSteps.length} 次。` +
          ' 期望去重后只有 1 条。'
        );
      }
    });
  });

  // ----------------------------------------------------------
  // B6: model-snapshot 内部事件不应对用户可见
  // ----------------------------------------------------------
  describe('B6: model-snapshot 应被过滤或标记为内部事件', () => {

    it('真实数据：22 条消息中包含 4 个 model-snapshot', () => {
      const snapshots = FALLBACK_SESSION_MESSAGES.filter(
        m => m.type === 'custom' && m.customType === 'model-snapshot'
      );
      assert.equal(snapshots.length, 4, '预期真实数据中有 4 个 model-snapshot');
    });

    it('model-snapshot 不应渲染为用户可见的 meta 卡片', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps(FALLBACK_SESSION_MESSAGES);

      const snapshotSteps = steps.filter(s =>
        s.originalType === 'custom' && s.data?.customType === 'model-snapshot'
      );

      // BUG 验证：当前映射为 type='custom'，会渲染为 meta 卡片
      for (const step of snapshotSteps) {
        if (step.type === 'custom') {
          assert.fail(
            `B6 BUG: model-snapshot (id=${step.id}) 映射为 type='custom' 会渲染为 meta 卡片。` +
            ' 应该过滤掉或标记为 internal 类型不渲染。'
          );
        }
      }
    });

    it('构造数据：model-snapshot 独立转换也不应可见', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps([MSG_MODEL_SNAPSHOT]);

      if (steps.length > 0 && steps[0].type !== 'internal') {
        assert.fail(
          'B6 BUG: model-snapshot 应被过滤或映射为 internal 类型。' +
          ` 实际 type="${steps[0].type}"`
        );
      }
    });
  });

  // ----------------------------------------------------------
  // B7: 用户消息未剥离 Inbound Metadata 前缀
  // ----------------------------------------------------------
  describe('B7: 用户消息应剥离 Sender metadata 前缀', () => {

    it('真实数据第 5 行：用户消息包含 Sender metadata', () => {
      const router = new DataRouter(createMockGateway());
      const msg = FALLBACK_SESSION_MESSAGES[4]; // 第 5 行
      const steps = router._messagesToSteps([msg]);

      assert.equal(steps.length, 1);
      const step = steps[0];
      assert.equal(step.type, 'llm_input');

      // BUG 验证：summary 是否包含 metadata 前缀
      const summary = step.summary || '';
      if (summary.includes('Sender (untrusted metadata)') || summary.includes('openclaw-control-ui')) {
        assert.fail(
          'B7 BUG: 用户消息 summary 包含 Sender metadata 前缀。' +
          ' 应该剥离 metadata 只显示实际用户文本。' +
          ` 实际 summary 前 80 字符: "${summary.slice(0, 80)}"`
        );
      }
    });

    it('构造数据：含 Sender metadata 的用户消息应只保留实际文本', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps([MSG_USER_WITH_METADATA]);

      assert.equal(steps.length, 1);
      const step = steps[0];
      const summary = step.summary || '';

      // 期望 summary 只包含 "你好，你是什么模型" 或类似实际文本
      const hasMetadata = summary.includes('Sender (untrusted metadata)')
        || summary.includes('openclaw-control-ui')
        || summary.includes('untrusted');
      if (hasMetadata) {
        assert.fail(
          'B7 BUG: 用户消息包含 Sender metadata 前缀未被剥离。' +
          ` 实际 summary: "${summary.slice(0, 100)}"`
        );
      }
      assert.ok(
        summary.includes('你好'),
        `B7: 剥离 metadata 后应保留实际用户文本。实际: "${summary}"`
      );
    });

    it('含 Conversation info + Sender + message_id 的复合 metadata 应全部剥离', () => {
      const router = new DataRouter(createMockGateway());
      const complexMsg = {
        type: 'message',
        id: 'complex-user-1',
        timestamp: '2026-03-14T10:00:00.000Z',
        message: {
          role: 'user',
          content: [{
            type: 'text',
            text: 'Conversation info (untrusted metadata):\n```json\n{"message_id":"om_x100"}\n```\n\nSender (untrusted metadata):\n```json\n{"label":"KID","id":"ou_7c65"}\n```\n\n[message_id: om_x100]\nKID: 为什么早上会有两条ai新闻？',
          }],
        },
      };
      const steps = router._messagesToSteps([complexMsg]);
      const summary = steps[0]?.summary || '';

      if (summary.includes('Conversation info') || summary.includes('message_id')) {
        assert.fail(
          'B7 BUG: 复合 metadata 前缀未被完全剥离。' +
          ` 实际: "${summary.slice(0, 120)}"`
        );
      }
    });
  });

  // ----------------------------------------------------------
  // B8: assistant content 混合类型处理
  // ----------------------------------------------------------
  describe('B8: assistant 混合 content（text + toolCall）的处理', () => {

    it('混合内容应至少提取出 text 部分', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps([MSG_ASSISTANT_MIXED_CONTENT]);

      // 至少应有一个 step 包含文本内容
      const textSteps = steps.filter(s =>
        s.type === 'llm_output' && s.summary && s.summary.includes('让我查一下天气')
      );
      assert.ok(
        textSteps.length > 0,
        'B8: 混合 content 中的 text 部分应被提取到 summary 中'
      );
    });

    it('混合内容中的 toolCall 部分不应被丢失', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps([MSG_ASSISTANT_MIXED_CONTENT]);

      // 检查是否有 tool_call 信息保留
      const hasToolInfo = steps.some(s =>
        s.type === 'tool_call'
        || (s.summary && s.summary.includes('exec'))
        || s.data?.message?.content?.some?.(c => c.type === 'toolCall')
      );

      if (!hasToolInfo) {
        // 当前行为：整条消息映射为单个 llm_output，toolCall 信息在 data 中但不可见
        // 降级验证：至少 data 中保留了 toolCall
        const step = steps[0];
        const contentHasToolCall = step.data?.message?.content?.some?.(c => c.type === 'toolCall');
        assert.ok(contentHasToolCall, 'B8: 原始数据中的 toolCall 至少应保留在 step.data 中');

        // 标记为已知缺陷
        assert.fail(
          'B8 BUG: 混合 content 中的 toolCall 部分在渲染层不可见。' +
          ' 建议拆分为多个 step（text → llm_output, toolCall → tool_call）。'
        );
      }
    });
  });

  // ----------------------------------------------------------
  // 正确渲染对照组
  // ----------------------------------------------------------
  describe('对照组：正常消息类型的正确映射', () => {

    it('type=session → step.type=session', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps([FALLBACK_SESSION_MESSAGES[0]]);
      assert.equal(steps[0].type, 'session');
      assert.equal(steps[0].originalType, 'session');
    });

    it('type=model_change → step.type=model_change', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps([FALLBACK_SESSION_MESSAGES[1]]);
      assert.equal(steps[0].type, 'model_change');
      assert.ok(steps[0].data.modelId, 'model_change 应保留 modelId');
    });

    it('type=thinking_level_change → step.type=thinking_level_change', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps([FALLBACK_SESSION_MESSAGES[2]]);
      assert.equal(steps[0].type, 'thinking_level_change');
    });

    it('type=message, role=assistant, content=[{type:"text"}] → llm_output 有内容', () => {
      const router = new DataRouter(createMockGateway());
      const msg = FALLBACK_SESSION_MESSAGES[10]; // 第 11 行：正常 AI 回复
      const steps = router._messagesToSteps([msg]);
      assert.equal(steps[0].type, 'llm_output');
      assert.ok(steps[0].summary.length > 0, '正常 AI 回复应有非空 summary');
      assert.ok(steps[0].summary.includes('MiniMax'), '应包含回复文本');
    });

    it('type=message, role=toolResult → tool_result', () => {
      const router = new DataRouter(createMockGateway());
      const msg = FALLBACK_SESSION_MESSAGES[9]; // 第 10 行：session_status 工具结果
      const steps = router._messagesToSteps([msg]);
      assert.equal(steps[0].type, 'tool_result');
      assert.ok(steps[0].summary.includes('session_status'));
    });

    it('构造数据：正常 assistant 文本 → llm_output 有内容', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps([MSG_ASSISTANT_TEXT]);
      assert.equal(steps[0].type, 'llm_output');
      assert.ok(steps[0].summary.includes('MiniMax'));
    });

    it('构造数据：正常 toolResult → tool_result', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps([MSG_TOOL_RESULT]);
      assert.equal(steps[0].type, 'tool_result');
      assert.ok(steps[0].summary.includes('session_status'));
    });
  });

  // ----------------------------------------------------------
  // 旧格式（顶层 type）兼容性
  // ----------------------------------------------------------
  describe('旧格式兼容：顶层 type 字段的消息', () => {

    it('顶层 type=text → llm_output（无 role 时默认）', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps([MSG_TOPLEVEL_TEXT]);
      // 当前实现走 case 'text' 分支，无 role 则 step.type='llm_output'
      assert.equal(steps[0].originalType, 'text');
      assert.ok(
        steps[0].type === 'llm_output' || steps[0].type === 'meta',
        `顶层 text 消息应有合理类型映射，实际: ${steps[0].type}`
      );
    });

    it('顶层 type=toolCall → tool_call', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps([MSG_TOPLEVEL_TOOLCALL]);
      assert.equal(steps[0].type, 'tool_call');
      assert.ok(steps[0].summary.includes('memory_search'));
    });

    it('顶层 type=toolResult → tool_result', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps([MSG_TOPLEVEL_TOOLRESULT]);
      assert.equal(steps[0].type, 'tool_result');
      assert.ok(steps[0].summary.includes('memory_search'));
    });

    it('顶层 type=thinking → thinking', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps([MSG_TOPLEVEL_THINKING]);
      assert.equal(steps[0].type, 'thinking');
    });
  });

  // ----------------------------------------------------------
  // 真实数据全量验证
  // ----------------------------------------------------------
  describe('真实数据全量验证：test/data/4cbb6cd6b', () => {

    it('22 条消息全部可转换，无异常', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps(FALLBACK_SESSION_MESSAGES);
      assert.equal(steps.length, FALLBACK_SESSION_MESSAGES.length);
    });

    it('每个 step 都有必要字段：id, type, timestamp, data', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps(FALLBACK_SESSION_MESSAGES);
      for (const step of steps) {
        assert.ok(step.id, `step 缺少 id: ${JSON.stringify(step).slice(0, 80)}`);
        assert.ok(step.type, `step 缺少 type: ${JSON.stringify(step).slice(0, 80)}`);
        assert.ok(step.timestamp, `step 缺少 timestamp: ${JSON.stringify(step).slice(0, 80)}`);
        assert.ok(step.data !== undefined, `step 缺少 data: ${JSON.stringify(step).slice(0, 80)}`);
        assert.ok(step.originalType, `step 缺少 originalType: ${JSON.stringify(step).slice(0, 80)}`);
      }
    });

    it('类型分布统计：验证消息被正确分类', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps(FALLBACK_SESSION_MESSAGES);

      const typeCounts = {};
      for (const step of steps) {
        typeCounts[step.type] = (typeCounts[step.type] || 0) + 1;
      }

      // 预期分布（基于测试数据内容）：
      // session: 1, model_change: 1, thinking_level_change: 1
      // custom: 4 (model-snapshot)
      // llm_input (user): 至少 2 条（不去重时 4 条）
      // llm_output (assistant): 至少 2 条（含错误回复和工具调用）
      // tool_result: 至少 3 条
      assert.ok(typeCounts['session'] >= 1, `session 类型应 >= 1，实际 ${typeCounts['session']}`);
      assert.ok(typeCounts['model_change'] >= 1, `model_change 应 >= 1，实际 ${typeCounts['model_change']}`);

      // 记录当前类型分布供调试
      console.log('    类型分布:', JSON.stringify(typeCounts));
    });

    it('llm_output 步骤中不应有空 summary（排除已知 BUG 消息）', () => {
      const router = new DataRouter(createMockGateway());
      const steps = router._messagesToSteps(FALLBACK_SESSION_MESSAGES);

      const emptyOutputs = steps.filter(s =>
        s.type === 'llm_output' && (!s.summary || s.summary.length === 0)
      );

      if (emptyOutputs.length > 0) {
        const ids = emptyOutputs.map(s => s.id).join(', ');
        assert.fail(
          `B1/B4 BUG: ${emptyOutputs.length} 个 llm_output 步骤 summary 为空。` +
          ` IDs: ${ids}。` +
          ' 这些可能是 error 回复(B1) 或 toolCall(B4) 消息被错误映射为 llm_output。'
        );
      }
    });
  });

  // ----------------------------------------------------------
  // B2/B3: UI 层缺失功能（无法在 Node.js 中直接测试 DOM 渲染，
  //        但可以验证 DataRouter 是否提供足够的数据支撑）
  // ----------------------------------------------------------
  describe('B2: Reading Indicator 数据支撑', () => {

    it('DataRouter 应在 agent stream=assistant 事件时更新 sessionRunState 为 streaming', () => {
      const gw = createMockGateway();
      const router = new DataRouter(gw);
      router.subscribePush();

      // 模拟 agent 事件：assistant stream 开始
      gw._emit('agent', {
        sessionKey: 'agent:main:main',
        stream: 'assistant',
        runId: 'run-1',
        data: {},
      });

      const runState = router.getSessionRunState('agent:main:main');
      assert.ok(runState, 'agent assistant 事件后应有 runState');
      assert.equal(runState.status, 'streaming', '状态应为 streaming');
    });

    it('lifecycle.start → running 状态', () => {
      const gw = createMockGateway();
      const router = new DataRouter(gw);
      router.subscribePush();

      gw._emit('agent', {
        sessionKey: 'agent:main:main',
        stream: 'lifecycle',
        runId: 'run-1',
        data: { phase: 'start' },
      });

      const runState = router.getSessionRunState('agent:main:main');
      assert.equal(runState.status, 'running');
    });

    it('lifecycle.end → idle 状态', () => {
      const gw = createMockGateway();
      const router = new DataRouter(gw);
      router.subscribePush();

      // 先 start
      gw._emit('agent', {
        sessionKey: 'agent:main:main',
        stream: 'lifecycle',
        runId: 'run-1',
        data: { phase: 'start' },
      });
      // 再 end
      gw._emit('agent', {
        sessionKey: 'agent:main:main',
        stream: 'lifecycle',
        runId: 'run-1',
        data: { phase: 'end' },
      });

      const runState = router.getSessionRunState('agent:main:main');
      assert.equal(runState.status, 'idle');
    });

    it('B2 缺失：chatDrawerPanel 未根据 streaming 状态显示三点动画', () => {
      // 此测试为标记性测试，记录 B2 缺陷
      // 当 sessionRunState.status === 'streaming' 且消息区域无新内容时
      // 应在消息底部追加 reading-indicator
      // 当前 ChatDrawerPanel 没有此逻辑
      assert.ok(true, 'B2: 需要在 ChatDrawerPanel 中实现 reading-indicator，' +
        '当 sessionRunState.status=streaming 且无新文本时显示三点动画');
    });
  });

  describe('B3: Fallback 模型切换数据支撑', () => {

    it('真实数据中的 fallback 模式：error → model-snapshot → 重试', () => {
      // 验证测试数据确实包含 fallback 模式
      // 第 6 行：assistant error (minimax)
      // 第 7 行：model-snapshot (切换到 bailian)
      // 第 8 行：user 消息重发
      const errorMsg = FALLBACK_SESSION_MESSAGES[5];
      const snapshotMsg = FALLBACK_SESSION_MESSAGES[6];
      const retryMsg = FALLBACK_SESSION_MESSAGES[7];

      assert.equal(errorMsg.message.role, 'assistant');
      assert.equal(errorMsg.message.stopReason, 'error');
      assert.equal(errorMsg.message.provider, 'minimax');

      assert.equal(snapshotMsg.type, 'custom');
      assert.equal(snapshotMsg.customType, 'model-snapshot');
      assert.equal(snapshotMsg.data.provider, 'bailian');

      assert.equal(retryMsg.message.role, 'user');
    });

    it('B3 缺失：DataRouter 未识别 fallback 事件并 emit 通知', () => {
      // 标记性测试：记录 B3 缺陷
      // 当前 DataRouter._onAgentPush 不处理 stream=fallback 事件
      // 期望：监听 lifecycle.fallback / lifecycle.fallback_cleared
      // 并 emit push:fallback 事件供 UI 层消费
      assert.ok(true, 'B3: 需要在 DataRouter 中添加 fallback 事件处理，' +
        '识别 lifecycle.fallback 并通知 UI 层显示切换提示');
    });
  });

  // ----------------------------------------------------------
  // 推送事件处理（chat push payload 验证）
  // ----------------------------------------------------------
  describe('推送事件：chat push 消息转 step', () => {

    it('chat push state=final + message → emit push:chat 事件', (_, done) => {
      const gw = createMockGateway();
      const router = new DataRouter(gw);
      router.subscribePush();

      router.on('push:chat', ({ sessionKey, step }) => {
        assert.equal(sessionKey, 'agent:main:main');
        assert.ok(step.type, 'push:chat step 应有 type');
        done();
      });

      gw._emit('chat', {
        sessionKey: 'agent:main:main',
        state: 'final',
        runId: 'run-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '任务完成' }],
        },
      });
    });

    it('chat push state=error → emit push:chat 错误 step', (_, done) => {
      const gw = createMockGateway();
      const router = new DataRouter(gw);
      router.subscribePush();

      router.on('push:chat', ({ sessionKey, step }) => {
        assert.equal(step.type, 'error');
        assert.ok(step.summary.includes('test error'));
        done();
      });

      gw._emit('chat', {
        sessionKey: 'agent:main:main',
        state: 'error',
        runId: 'run-1',
        errorMessage: 'test error',
      });
    });

    it('chat push state=aborted + assistant message → emit push:chat aborted step', (_, done) => {
      const gw = createMockGateway();
      const router = new DataRouter(gw);
      router.subscribePush();

      router.on('push:chat', ({ sessionKey, step }) => {
        assert.equal(step.type, 'aborted');
        done();
      });

      gw._emit('chat', {
        sessionKey: 'agent:main:main',
        state: 'aborted',
        runId: 'run-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '中断了' }],
        },
      });
    });
  });
});
