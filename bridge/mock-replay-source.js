// bridge/mock-replay-source.js — Mock / Replay 数据源
// 实现与 GatewayClient 相同的接口，用于离线开发、演示和状态回放
// 支持官方 Gateway 方法：agents.list / sessions.list / sessions.usage
// 用法：import { MockGatewayClient } from './mock-replay-source.js';
//       const gateway = new MockGatewayClient({ scenario: 'demo' });
//       gateway.connect();

export class MockGatewayClient {
  /**
   * @param {object} opts
   * @param {'demo'|'replay'|'stress'|'recording'} [opts.scenario='demo'] - 场景模式
   * @param {number} [opts.tickInterval=2000] - 状态推进间隔（ms）
   * @param {Array}  [opts.replayData] - replay 模式的快照序列
   */
  constructor(opts = {}) {
    this.scenario = opts.scenario ?? 'demo';
    this.tickInterval = opts.tickInterval ?? opts.pollInterval ?? 2000;
    this.replayData = opts.replayData ?? null;

    this._listeners = {};
    this._tickTimer = null;
    this._connected = false;
    this._status = 'disconnected';
    this._tick = 0;
    this._replayIndex = 0;
    this._seq = 0;

    // Recording 模式的事件队列
    this._recordingEvents = null;
    this._eventIndex = 0;
    this._currentSession = null;
    this._currentRunId = null;

    // Demo 场景的模拟状态
    this._state = createInitialState();

    // 日志写入（Mock 模式下使用 HTTP API）
    this._logApi = opts.mockApi || '/api/mock-log/ingest';

    // 日志配置：控制各模式是否写入日志
    // 优先级：opts.logConfig > config.yaml（需 dev-server.cjs 传入）
    // 默认值用于无配置时的 fallback
    this._logConfig = opts.logConfig ?? {
      demo: { enabled: true },
      recording: { enabled: true },
      replay: { enabled: false },
      stress: { enabled: false },
    };
    // 预先计算当前模式的日志开关，避免每次 _log() 调用时查找
    this._logEnabled = this._logConfig[this.scenario]?.enabled ?? false;
  }

  /**
   * 写入 Mock 日志（通过 HTTP API）
   * @param {string} cat - 分类
   * @param {string} msg - 消息
   */
  async _log(cat, msg) {
    // 快速检查：预先计算的布尔值，避免对象查找
    if (!this._logEnabled) {
      return; // 跳过日志写入
    }

    try {
      const resp = await fetch(this._logApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cat, msg }),
      });
      if (!resp.ok) {
        console.warn(`[MockLog] Failed to write log: ${resp.status}`);
      }
    } catch (err) {
      console.warn(`[MockLog] Write error: ${err.message}`);
    }
  }

  /**
   * 加载录制数据进行回放
   * @param {object} recordingData - 录制文件内容 { name, description, events: [...] }
   */
  loadRecording(recordingData) {
    if (!recordingData || !Array.isArray(recordingData.events)) {
      console.error('[MockGateway] Invalid recording data:', recordingData);
      return;
    }
    this._recordingEvents = recordingData.events;
    this._eventIndex = 0;
    this._state = createInitialState();
    this.scenario = 'recording';
    console.log(`[MockGateway] Loaded recording: ${recordingData.name || 'unnamed'}, ${this._recordingEvents.length} events`);
  }

  // ============================================================
  // 连接管理（模拟）
  // ============================================================

  connect(url, token) {
    // url/token 参数接受但忽略（Mock 模式不需要）
    this._connected = true;
    this._status = 'connected';
    setTimeout(() => {
      this._emit('status', 'connected');
      this._emit('connected', this.hello);
      this._startTicking();
    }, 100);
  }

  disconnect() {
    this._connected = false;
    this._status = 'disconnected';
    this._stopTicking();
    this._emit('status', 'disconnected');
    this._emit('disconnected');
  }

  /** 别名，对齐 GatewayClient.stop() */
  stop() {
    this.disconnect();
  }

  get connected() {
    return this._connected;
  }

  /** 连接状态（对齐 GatewayClient） */
  get status() {
    return this._status || (this._connected ? 'connected' : 'disconnected');
  }

  /** Mock hello-ok 数据 */
  get hello() {
    return {
      type: 'hello-ok',
      protocol: 3,
      server: { version: 'mock-0.1.0', connId: 'mock-conn-1' },
      features: { methods: [], events: [] },
    };
  }

  /** Mock 无错误 */
  get lastError() { return null; }
  get lastErrorCode() { return null; }

  // ============================================================
  // RPC 调用（模拟官方 Gateway 方法）
  // ============================================================

  async call(method, params = {}) {
    if (!this._connected) throw new Error('Not connected');

    switch (method) {
      case 'agents.list':
        return this._getAgentsList();
      case 'agent':
        return this._startAgentChat(params);
      case 'sessions.list':
        return this._getSessionsList(params);
      case 'sessions.usage':
        return this._getSessionsUsage();
      case 'chat.history':
        return this._getChatHistory(params.sessionKey, params.limit);
      case 'usage.cost':
        return this._getUsageCost(params);
      case 'sessions.preview':
        return this._getSessionsPreview(params);
      case 'clawdeck.action':
        return this._handleAction(params);
      case 'chat.send':
        console.log(`[MockGateway] chat.send → ${params.sessionKey}: ${params.message}`);
        return { ok: true };
      case 'chat.abort':
        console.log(`[MockGateway] chat.abort → ${params.sessionKey}`);
        return { ok: true };
      case 'exec.approval.resolve':
        console.log(`[MockGateway] exec.approval.resolve → ${params.id}: ${params.decision}`);
        return { ok: true };
      case 'health':
        return { status: 'ok', uptime: Date.now() - this._state._since, agents: Object.keys(this._state.agents).length };
      case 'models.list':
        return {
          models: [
            { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'anthropic' },
            { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic' },
            { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic' },
          ]
        };
      case 'sessions.patch':
        console.log(`[MockGateway] sessions.patch → ${params.key}`);
        return { ok: true };
      case 'sessions.reset':
        console.log(`[MockGateway] sessions.reset → ${params.key}`);
        return { ok: true, sessionId: params.key };
      case 'sessions.compact':
        return { ok: true, compactedCount: 2 };
      case 'cron.list':
        return { jobs: [] };
      case 'clawdeck.aiAdvices':
        return this._getAIAdvices();
      case 'logs.tail':
        return {
          file: 'openclaw.log',
          cursor: (params.cursor || 0) + 5,
          size: 10240,
          lines: [
            `[${new Date().toISOString()}] INFO  gateway started`,
            `[${new Date().toISOString()}] INFO  agent-1 session created`,
            `[${new Date().toISOString()}] DEBUG ws client connected`,
          ],
          truncated: false,
          reset: false,
        };
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  // ============================================================
  // 便捷方法（与 GatewayClient 一致）
  // ============================================================

  async sendInstruction(sessionKey, message) {
    return this.call('chat.send', { sessionKey, message, idempotencyKey: `mock-${Date.now()}` });
  }
  async startAgentChat(key, text) {
    return this.call('agent', { key, text });
  }
  async abortSession(sessionKey) { return this.call('chat.abort', { sessionKey }); }
  async resolveApproval(approvalId, decision = 'allow-once') {
    return this.call('exec.approval.resolve', { id: approvalId, decision });
  }
  async sendAction(action, sessionId, instruction) {
    return this.call('clawdeck.action', { action, sessionId, instruction });
  }

  // ============================================================
  // 事件监听（与 GatewayClient 一致）
  // ============================================================

  on(event, fn) {
    (this._listeners[event] ||= []).push(fn);
    return this;
  }

  off(event, fn) {
    const list = this._listeners[event];
    if (list) {
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    }
    return this;
  }

  // ============================================================
  // 内部：状态推进
  // ============================================================

  _emit(event, data) {
    (this._listeners[event] || []).forEach(fn => fn(data));
  }

  _startTicking() {
    this._stopTicking();
    this._tickTimer = setInterval(() => this._advanceTick(), this.tickInterval);
  }

  _stopTicking() {
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  }

  _advanceTick() {
    this._tick++;
    if (this.scenario === 'recording' && this._recordingEvents) {
      this._advanceRecording();
    } else if (this.scenario === 'replay' && this.replayData) {
      this._advanceReplay();
    } else if (this.scenario === 'stress') {
      this._advanceStress();
    } else {
      this._advanceDemo();
    }
  }

  // ============================================================
  // Recording 场景：基于事件回放
  // ============================================================

  _advanceRecording() {
    const events = this._recordingEvents;
    if (!events || this._eventIndex >= events.length) {
      // 录制结束，重置循环
      this._eventIndex = 0;
      this._state = createInitialState();
      console.log('[MockGateway] Recording finished, looping...');
      return;
    }

    // 每次推进处理 1-3 个事件（根据 delay）
    const batchSize = Math.min(3, events.length - this._eventIndex);
    for (let i = 0; i < batchSize && this._eventIndex < events.length; i++) {
      const event = events[this._eventIndex];
      this._processEvent(event);
      this._eventIndex++;
    }
  }

  /**
   * 处理单个事件，更新内部状态并触发事件
   */
  _processEvent(event) {
    const { type, params } = event;
    if (!params) return;

    switch (type) {
      case 'session_start':
        this._handleSessionStart(params);
        break;
      case 'session_end':
        this._handleSessionEnd(params);
        break;
      case 'llm_input':
        this._handleLlmInput(params);
        break;
      case 'llm_output':
        this._handleLlmOutput(params);
        break;
      case 'raw_agent_event':
        this._handleRawAgentEvent(params);
        break;
      case 'before_tool_call':
        this._handleBeforeToolCall(params);
        break;
      case 'after_tool_call':
        this._handleAfterToolCall(params);
        break;
      case 'agent_end':
        this._handleAgentEnd(params);
        break;
      case 'transcript_update':
        // transcript_update 主要用于日志，忽略或轻量处理
        break;
      case 'subagent_spawned':
        this._emit('subagent', params);
        break;
      case 'subagent_ended':
        this._emit('subagent', params);
        break;
      default:
        console.log(`[MockGateway] Unknown event type: ${type}`);
    }
  }

  _handleSessionStart(params) {
    const { sessionId, sessionKey, agentId } = params;
    this._currentSession = sessionId;

    // 记录日志
    this._log('hook', `session_start: ${sessionKey}`);

    // 从 sessionKey 提取 agentId（格式: agent:agent-id:source:direct:xxx）
    const parts = (sessionKey || '').split(':');
    const extractedAgentId = parts[1] || agentId || 'main';

    // 创建 session
    this._state.sessions[sessionId] = createSession(sessionId, sessionKey || `k:${sessionId}`, 'active');

    // 确保 agent 存在
    if (!this._state.agents[extractedAgentId]) {
      this._state.agents[extractedAgentId] = {
        id: extractedAgentId,
        name: `Agent ${extractedAgentId}`,
        status: 'working'
      };
    } else {
      this._state.agents[extractedAgentId].status = 'working';
    }

    this._emit('session', { sessionId, sessionKey, agentId: extractedAgentId, status: 'started' });
  }

  _handleSessionEnd(params) {
    const { sessionId, sessionKey } = params;

    // 记录日志
    this._log('hook', `session_end: ${sessionKey}`);

    const sess = this._state.sessions[sessionId];
    if (sess) {
      sess.status = 'completed';
    }

    // 更新 agent 状态
    const parts = (sessionKey || '').split(':');
    const agentId = parts[1] || 'main';
    if (this._state.agents[agentId]) {
      this._state.agents[agentId].status = 'idle';
    }

    this._currentSession = null;
    this._emit('session', { sessionId, sessionKey, status: 'ended' });
  }

  _handleLlmInput(params) {
    const { sessionId, runId, provider, model } = params;
    this._currentRunId = runId;

    // 记录日志
    this._log('hook', `llm_input: ${provider}/${model} (session: ${sessionId})`);

    const sess = this._state.sessions[sessionId];
    if (sess) {
      addStep(sess, 'llm_input', `LLM 请求 → ${provider || ''}/${model || ''}`);
    }

    this._emit('chat', {
      sessionKey: sess?.key || sessionId,
      type: 'final',
      content: { role: 'user', content: `LLM 请求 → ${provider || ''}/${model || ''}`, timestamp: Date.now() }
    });
  }

  _handleLlmOutput(params) {
    const { sessionId, runId, provider, model, usage } = params;

    // 记录日志
    const usageInfo = usage ? ` (${usage.input} in / ${usage.output} out)` : '';
    this._log('hook', `llm_output: ${provider}/${model}${usageInfo}`);

    const sess = this._state.sessions[sessionId];
    if (sess) {
      addStep(sess, 'llm_output', `LLM 响应 ← ${provider || ''}/${model || ''}`);
      if (usage) {
        sess.usage.input += usage.input || 0;
        sess.usage.output += usage.output || 0;
        sess.usage.cacheRead += usage.cacheRead || 0;
        sess.usage.cacheWrite += usage.cacheWrite || 0;
        sess.usage.total += usage.total || 0;
      }
    }
  }

  _handleRawAgentEvent(params) {
    const { runId, seq, stream, data, sessionKey } = params;

    // 解析 stream 和 phase
    const phase = data?.phase;

    if (stream === 'lifecycle') {
      switch (phase) {
        case 'start':
          // Agent 运行开始
          this._emit('agent', { runId, seq, sessionKey, data: { status: 'working' } });
          break;
        case 'end':
          // Agent 运行结束（正常）
          this._emit('agent', { runId, seq, sessionKey, data: { status: 'idle' } });
          break;
        case 'error':
          // Agent 运行错误
          this._emit('agent', { runId, seq, sessionKey, data: { status: 'error', error: data.error } });
          break;
        case 'fallback':
          // Provider 切换
          console.log(`[MockGateway] Provider fallback: ${data.selectedProvider} → ${data.activeProvider}`);
          this._emit('agent', { runId, seq, sessionKey, data: { fallback: data } });
          break;
      }
    } else if (stream === 'tool') {
      // 工具执行事件
      const toolName = data?.name;
      const toolCallId = data?.toolCallId;

      if (phase === 'start') {
        this._emit('tool', {
          runId, seq, sessionKey,
          type: 'start',
          toolName,
          toolCallId,
          args: data?.args
        });
      } else if (phase === 'result') {
        this._emit('tool', {
          runId, seq, sessionKey,
          type: 'result',
          toolName,
          toolCallId,
          result: data?.result,
          isError: data?.isError,
          meta: data?.meta
        });
      }
    }
  }

  _handleBeforeToolCall(params) {
    const { sessionId, toolName, toolCallId, runId } = params;

    // 记录日志
    this._log('hook', `tool_call: ${toolName} (session: ${sessionId})`);

    const sess = this._state.sessions[sessionId];
    if (sess) {
      addStep(sess, 'tool_call', `工具调用 → ${toolName}`);
    }

    this._emit('chat', {
      sessionKey: sess?.key || sessionId,
      type: 'final',
      content: {
        role: 'assistant',
        content: [
          { type: 'text', text: `执行工具: ${toolName}` },
          { type: 'tool_use', name: toolName, id: toolCallId, input: params.params || {} }
        ],
        timestamp: Date.now()
      }
    });
  }

  _handleAfterToolCall(params) {
    const { sessionId, toolName, toolCallId, durationMs, result, error } = params;

    // 记录日志
    const status = error ? `error: ${error}` : 'success';
    this._log('hook', `tool_result: ${toolName} (${status})`);

    const sess = this._state.sessions[sessionId];
    if (sess) {
      if (error) {
        addStep(sess, 'tool_result', `工具错误 ← ${toolName}: ${error}`);
      } else {
        addStep(sess, 'tool_result', `工具结果 ← ${toolName}`);
      }
    }

    this._emit('chat', {
      sessionKey: sess?.key || sessionId,
      type: 'final',
      content: {
        role: 'tool',
        toolCallId,
        content: error || result,
        isError: !!error,
        timestamp: Date.now()
      }
    });
  }

  _handleAgentEnd(params) {
    const { sessionId, success, durationMs } = params;

    // 记录日志
    this._log('hook', `agent_end: session=${sessionId}, success=${success}, duration=${durationMs}ms`);

    const sess = this._state.sessions[sessionId];
    if (sess) {
      sess.status = success ? 'completed' : 'error';
    }
    this._emit('agent', { sessionId, success, durationMs, status: 'ended' });
  }

  // ============================================================
  // Demo 场景：模拟 3 个 agent，动态创建/完成 session
  // 改为事件驱动：生成标准事件 → _processEvent() → _handleXxx() → 自动 _log() + _emit()
  // ============================================================

  _advanceDemo() {
    const s = this._state;
    const t = this._tick;

    if (t === 2) {
      // session_start + llm_input (含 Markdown 内容)
      this._processEvent({
        type: 'session_start',
        params: { sessionId: 'sess-1', sessionKey: 'agent:agent-1:mock:direct:demo', agentId: 'agent-1' }
      });
      this._processEvent({
        type: 'llm_input',
        params: { sessionId: 'sess-1', provider: 'anthropic', model: 'claude-opus-4-6' }
      });
    }

    if (t === 4) {
      // llm_output (含 Markdown 内容) + before_tool_call
      this._processEvent({
        type: 'llm_output',
        params: {
          sessionId: 'sess-1',
          provider: 'anthropic',
          model: 'claude-opus-4-6',
          usage: { input: 1200, output: 380, total: 1580 },
          content: [
            { type: 'text', text: `### 代码审查结果

这个 PR 包含了一些关键的修改。**整体看起来不错**，但有几个点需要注意：

#### 1. 新增的辅助函数
\`\`\`javascript
async function greet(name) {
  console.log(\`Hello, \${name}!\`);
  return true;
}
\`\`\`

#### 2. XSS 安全测试
以下代码在界面上**绝对不能作为 HTML 渲染**：
\`<script>alert("XSS test")</script>\`

#### 3. 表格测试
| 项目 | 状态 |
|---|---|
| 功能 A | ✅ 完成 |
| 功能 B | 🚧 进行中 |

#### 4. 图片测试
本地图片（开发环境下应该**正常显示**，部署路径变化时需同步调整）：
![Small Dot](data/pic/md_avatar_256.png)

外部图片（应该**被拦截**）：
![Bad](http://evil-server.com/track.png)

[官方文档链接](https://example.com)` }
          ]
        }
      });
      this._processEvent({
        type: 'before_tool_call',
        params: { sessionId: 'sess-1', toolName: 'Read', params: { path: '/src/app.ts' }, toolCallId: 'call_read_1' }
      });
    }

    if (t === 5) {
      // agent-2: session_start + llm_input (简单文本)
      this._processEvent({
        type: 'session_start',
        params: { sessionId: 'sess-2', sessionKey: 'agent:agent-2:mock:direct:demo', agentId: 'agent-2' }
      });
      this._processEvent({
        type: 'llm_input',
        params: { sessionId: 'sess-2', provider: 'anthropic', model: 'claude-sonnet-4-6' }
      });
    }

    if (t === 7) {
      // after_tool_call (工具结果含 JSON) + llm_input（第二轮）
      this._processEvent({
        type: 'after_tool_call',
        params: {
          sessionId: 'sess-1',
          toolName: 'Read',
          result: {
            content: [
              { type: 'text', text: '从 /src/app.ts 读取到以下内容:\n\`\`\`json\n{\n  "name": "clawdeck",\n  "version": "2.1.0",\n  "scripts": {\n    "dev": "node dev-server.cjs --mock",\n    "build": "tsc -p bridge/src/tsconfig.json"\n  }\n}\n\`\`\`' }
            ]
          },
          durationMs: 210,
          toolCallId: 'call_read_1'
        }
      });
      this._processEvent({
        type: 'llm_input',
        params: { sessionId: 'sess-1', provider: 'anthropic', model: 'claude-opus-4-6' }
      });
    }

    if (t === 9) {
      // llm_output (简单文本) + agent_end + session_end
      this._processEvent({
        type: 'llm_output',
        params: {
          sessionId: 'sess-1',
          provider: 'anthropic',
          model: 'claude-opus-4-6',
          usage: { input: 800, output: 150, total: 950 },
          content: [{ type: 'text', text: '代码审查已完成。所有修改符合规范，没有发现安全问题。' }]
        }
      });
      this._processEvent({
        type: 'agent_end',
        params: { sessionId: 'sess-1', success: true, durationMs: 2800 }
      });
      this._processEvent({
        type: 'session_end',
        params: { sessionId: 'sess-1', sessionKey: 'agent:agent-1:mock:direct:demo', messageCount: 4 }
      });
    }

    if (t === 11) {
      // error 场景 - 暂时直接 emit，不走事件处理
      // 因为 error 场景比较特殊，需要前端展示审批请求
      addStep(s.sessions['sess-2'], 'error', '工具错误 ← Bash: command not found');
      s.sessions['sess-2'].abortedLastRun = true;
      s.agents['agent-2'].status = 'error';
      this._emit('chat', { sessionKey: 'agent:agent-2:mock:direct:demo', type: 'error', error: 'command not found' });
      this._emit('exec.approval.requested', {
        requestId: `approval-${Date.now()}`, toolName: 'Bash',
        sessionKey: 'agent:agent-2:mock:direct:demo', params: { command: 'rm -rf /' }
      });
    }

    if (t === 13) {
      // tool_call + after_tool_call + session_end
      this._processEvent({
        type: 'before_tool_call',
        params: { sessionId: 'sess-2', toolName: 'Bash', params: { command: 'ls' }, toolCallId: 'call_bash_1' }
      });
      this._processEvent({
        type: 'after_tool_call',
        params: { sessionId: 'sess-2', toolName: 'Bash', result: { content: [{ type: 'text', text: 'files...' }] }, durationMs: 100, toolCallId: 'call_bash_1' }
      });
      this._processEvent({
        type: 'session_end',
        params: { sessionId: 'sess-2', sessionKey: 'agent:agent-2:mock:direct:demo', messageCount: 2 }
      });
      // 更新 agent 状态
      s.agents['agent-2'].status = 'idle';
    }

    if (t === 15) {
      // agent-3: session_start + llm_input
      this._processEvent({
        type: 'session_start',
        params: { sessionId: 'sess-3', sessionKey: 'agent:agent-3:mock:direct:demo', agentId: 'agent-3' }
      });
      this._processEvent({
        type: 'llm_input',
        params: { sessionId: 'sess-3', provider: 'anthropic', model: 'claude-haiku-4-5' }
      });
    }

    if (t >= 18) {
      this._tick = 0;
      this._state = createInitialState();
    }

    // 每 5 个 tick 发一次 health 心跳
    if (t % 5 === 0) {
      const activeCount = Object.values(s.sessions).filter(ss => ss.status === 'active').length;
      this._emit('health', {
        status: 'ok',
        agents: Object.keys(s.agents).length,
        activeSessions: activeCount,
        ts: Date.now(),
      });
    }
  }

  // ============================================================
  // Replay 场景
  // ============================================================

  _advanceReplay() {
    if (!this.replayData || this._replayIndex >= this.replayData.length) {
      this._replayIndex = 0;
    }
    this._state = this.replayData[this._replayIndex];
    this._replayIndex++;
  }

  // ============================================================
  // Stress 场景
  // ============================================================

  _advanceStress() {
    const s = this._state;
    const count = 10 + Math.floor(this._tick / 2);

    for (let i = 0; i < Math.min(count, 20); i++) {
      const aid = `stress-agent-${i}`;
      if (!s.agents[aid]) {
        s.agents[aid] = { id: aid, name: `Agent-${i}`, status: 'working' };
      }
      const sid = `stress-sess-${this._tick}-${i}`;
      s.sessions[sid] = createSession(sid, `agent:${aid}:mock:direct:stress`, Math.random() > 0.3 ? 'active' : 'completed');
    }

    const keys = Object.keys(s.sessions);
    if (keys.length > 50) {
      for (const k of keys.slice(0, keys.length - 50)) {
        delete s.sessions[k];
      }
    }
  }

  // ============================================================
  // 数据读取（模拟官方 Gateway 方法响应格式）
  // ============================================================

  /** 模拟 agents.list 响应 */
  _getAgentsList() {
    const agents = Object.values(this._state.agents).map(a => ({
      id: a.id,
      name: a.name,
      identity: {
        name: a.name,
        emoji: a.emoji || a.name?.[0] || '🤖',
        characteristics: a.characteristics || null
      },
    }));
    return { agents, defaultId: agents[0]?.id ?? '', mainKey: 'main', scope: 'global' };
  }

  /** 模拟 sessions.list 响应 */
  _getSessionsList(params = {}) {
    const { activeMinutes, limit = 50 } = params;
    let sessions = Object.values(this._state.sessions);

    // activeMinutes 过滤：只返回活跃 session
    if (activeMinutes) {
      sessions = sessions.filter(s => s.status === 'active');
    }

    const mapped = sessions.slice(0, limit).map(s => {
      // 从 sessionKey 提取 agentId（格式: agent:<agentId>:...），兜底为 session 的 agentId 字段或 'main'
      const keyParts = (s.key || '').split(':');
      const agentId = s.agentId || (keyParts.length >= 2 ? keyParts[1] : 'main');
      return {
        sessionId: s.sessionId,
        key: s.key,
        label: s.title || `Session ${s.sessionId.slice(0, 8)}`,
        updatedAt: Date.now(),
        inputTokens: s.usage?.input || 0,
        outputTokens: s.usage?.output || 0,
        totalTokens: s.usage?.total || 0,
        abortedLastRun: s.abortedLastRun || false,
        agentId,
      };
    });

    return { sessions: mapped, count: mapped.length };
  }

  /** 模拟 sessions.usage 响应 */
  _getSessionsUsage() {
    let totalTokens = 0;
    const agentTotals = {};
    for (const sess of Object.values(this._state.sessions)) {
      totalTokens += (sess.usage?.total || 0);
      const agentId = sess.agentId || (sess.key || '').split(':')[1] || 'main';
      if (!agentTotals[agentId]) agentTotals[agentId] = { input: 0, output: 0, totalTokens: 0, totalCost: 0 };
      agentTotals[agentId].input += (sess.usage?.input || 0);
      agentTotals[agentId].output += (sess.usage?.output || 0);
      agentTotals[agentId].totalTokens += (sess.usage?.total || 0);
      agentTotals[agentId].totalCost += (sess.usage?.total || 0) * 0.00001;
    }
    const byAgent = Object.entries(agentTotals).map(([id, totals]) => ({ agentId: id, totals }));

    return {
      totals: { totalTokens, totalCost: totalTokens * 0.00001 },
      aggregates: { byAgent },
    };
  }

  _getSessionDetail(sessionId) {
    const sess = this._state.sessions[sessionId];
    if (!sess) return null;
    return {
      ...sess,
      sessionKey: sess.key,
      agentLabel: this._extractAgentLabel(sess.key),
    };
  }

  /** 模拟 chat.history 响应：将 steps 转换为 Message[] 格式 */
  _getChatHistory(sessionKey, limit = 200) {
    // 从 sessions 中找到匹配的 session
    const sess = Object.values(this._state.sessions).find(s => s.key === sessionKey);
    if (!sess) return { sessionKey, sessionId: '', messages: [] };

    const messages = (sess.steps || []).slice(0, limit).map(step => {
      switch (step.type) {
        case 'llm_input':
          return { role: 'user', content: step.summary, timestamp: step.timestamp };
        case 'llm_output':
          return { role: 'assistant', content: step.summary, timestamp: step.timestamp };
        case 'tool_call':
          return {
            role: 'assistant',
            content: [
              { type: 'text', text: step.summary },
              { type: 'tool_use', name: step.summary.replace('工具调用 → ', ''), input: {} },
            ],
            timestamp: step.timestamp,
          };
        case 'tool_result':
          return {
            role: 'tool',
            content: step.summary,
            toolName: step.summary.replace('工具结果 ← ', ''),
            timestamp: step.timestamp,
          };
        case 'error':
          return { role: 'assistant', content: `[Error] ${step.summary}`, timestamp: step.timestamp };
        default:
          return { role: 'user', content: step.summary, timestamp: step.timestamp };
      }
    });

    return { sessionKey, sessionId: sess.sessionId, messages };
  }

  /** 模拟 usage.cost 响应 */
  _getUsageCost(params) {
    const days = params.days || 7;
    const daily = [];
    const now = Date.now();
    for (let i = 0; i < days; i++) {
      daily.push({
        date: new Date(now - i * 86400000).toISOString().slice(0, 10),
        cost: Math.random() * 0.5,
        tokens: Math.floor(Math.random() * 10000),
      });
    }
    return { daily, total: { cost: daily.reduce((s, d) => s + d.cost, 0), days } };
  }

  /** 模拟 clawdeck.aiAdvices 响应 */
  async _getAIAdvices() {
    try {
      const resp = await fetch('/plugin/data/ai-advices.json');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } catch (e) {
      console.warn('[MockGateway] 加载 AI 建议数据失败:', e.message);
      return { advices: [], config: { maxAdviceCount: 3 } };
    }
  }

  /** 模拟 sessions.preview 响应 */
  _getSessionsPreview(params) {
    const { keys = [], maxChars = 240 } = params;
    const previews = keys.map(key => {
      const sess = Object.values(this._state.sessions).find(s => s.key === key);
      const lastStep = sess?.steps?.[sess.steps.length - 1];
      return {
        key,
        preview: lastStep ? lastStep.summary.slice(0, maxChars) : '暂无预览',
      };
    });
    return { previews };
  }

  /** 从 sessionKey 提取 agent 标签 */
  _extractAgentLabel(key) {
    const parts = (key || '').split(':');
    const agentId = parts.length >= 2 ? parts[1] : key;
    const agent = this._state.agents[agentId];
    return agent?.name || agentId;
  }

  _startAgentChat(params = {}) {
    const agentId = String(params.key || params.agentId || '').trim();
    const text = String(params.text || params.message || '').trim();
    if (!agentId) throw new Error('Missing agent id');

    const sessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sessionKey = `agent:${agentId}:mock:direct:${this.scenario || 'demo'}`;

    // Create agent if missing, then mark as working.
    if (!this._state.agents[agentId]) {
      this._state.agents[agentId] = {
        id: agentId,
        name: `Agent ${agentId}`,
        status: 'working',
      };
    } else {
      this._state.agents[agentId].status = 'working';
    }
    this._state.agents[agentId].currentTask = text || this._state.agents[agentId].currentTask || null;

    const sess = createSession(sessionId, sessionKey, 'active', {
      title: (text || 'New session').slice(0, 60),
      agentId,
      lastMessage: text || '',
      steps: text ? [{ type: 'llm_input', summary: text }] : [],
    });
    this._state.sessions[sessionId] = sess;

    const runId = `run-${Date.now()}`;
    const startSeq = ++this._seq;
    this._emit('agent', { runId, seq: startSeq, sessionKey, stream: 'lifecycle', data: { phase: 'start' } });

    // Simulate a quick completion so UI can transition back to idle.
    setTimeout(() => {
      try {
        const cur = this._state.sessions[sessionId];
        if (cur) cur.status = 'completed';
        if (this._state.agents[agentId]) this._state.agents[agentId].status = 'idle';
        this._emit('agent', { runId, seq: ++this._seq, sessionKey, stream: 'lifecycle', data: { phase: 'end' } });
      } catch { }
    }, 600);

    // Keep return structure loose; callers only need success.
    return { ok: true, sessionId, sessionKey, runId };
  }

  _handleAction(params) {
    console.log(`[MockGateway] action=${params.action} session=${params.sessionId}`);
    return { ok: true, action: params.action, sessionId: params.sessionId };
  }

  // ============================================================
  // 工坊数据接口（为 workshop-panel 提供）
  // ============================================================

  /** 获取工坊格式的 Agent 列表 */
  getAgentsForWorkshop() {
    return Object.values(this._state.agents).map(a => ({
      id: a.id,
      label: a.name,
      icon: a.emoji || a.name?.[0] || '🤖',
      status: a.status || 'idle',
      currentTask: a.currentTask || null,
      steps: a.steps || [],
    }));
  }

  /** 获取工坊格式的 Session 列表 */
  getSessionsForWorkshop() {
    return Object.values(this._state.sessions).map(s => ({
      id: s.sessionId,
      sessionKey: s.key,
      title: s.title || `Session ${s.sessionId.slice(-3)}`,
      status: s.status || 'pending',
      agentId: s.agentId,
      lastMessage: s.lastMessage || '',
      pendingApproval: s.pendingApproval || null,
      steps: s.steps || [],
      usage: {
        input: s.usage?.input || s.inputTokens || Math.floor(Math.random() * 5000) + 1000,
        output: s.usage?.output || s.outputTokens || Math.floor(Math.random() * 3000) + 500,
        total: s.usage?.total || s.totalTokens || 0,
      },
    }));
  }
}

// ============================================================
// 工具函数
// ============================================================

function createInitialState() {
  return {
    _since: Date.now(),
    agents: {
      'agent-1': {
        id: 'agent-1',
        name: 'Daily Reporter',
        status: 'idle',
        emoji: '📰',
        characteristics: '细致 / 准时',
        currentTask: null,
        steps: [],
      },
      'agent-2': {
        id: 'agent-2',
        name: 'Code Reviewer',
        status: 'working',
        emoji: '🔍',
        characteristics: '严格 / 强迫症',
        currentTask: 'Review PR #123',
        steps: [
          { id: 'step-1', summary: 'Fetch PR changes', status: 'completed' },
          { id: 'step-2', summary: 'Analyze code structure', status: 'active' },
          { id: 'step-3', summary: 'Run tests', status: 'pending' },
        ],
      },
      'agent-3': {
        id: 'agent-3',
        name: 'Data Analyst',
        status: 'error',
        emoji: '📊',
        characteristics: '理性 / 谨慎',
        currentTask: 'Query database',
        steps: [
          { id: 'step-1', summary: 'Connect to database', status: 'completed' },
          { id: 'step-2', summary: 'Execute query', status: 'error' },
        ],
      },
      'agent-4': {
        id: 'agent-4',
        name: 'Content Writer',
        status: 'working',
        emoji: '✍️',
        characteristics: '灵感爆棚 / 猫娘',
        currentTask: 'Write blog post',
        steps: [
          { id: 'step-1', summary: 'Research topic', status: 'completed' },
          { id: 'step-2', summary: 'Outline article', status: 'completed' },
          { id: 'step-3', summary: 'Write content', status: 'active' },
        ],
      },
      'agent-5': {
        id: 'agent-5',
        name: 'Test Runner',
        status: 'idle',
        emoji: '🧪',
        // Intentional: leaving one agent without a characteristics property to verify fallback logic.
        currentTask: null,
        steps: [],
      },
    },
    sessions: {
      'session-001': createSession('session-001', 'main', 'active', {
        title: 'Review PR #123',
        agentId: 'agent-2',
        lastMessage: 'Analyzing code structure for potential issues...',
        pendingApproval: { id: 'approval-1', toolName: 'Bash', command: 'rm -rf /' },
        steps: [
          { type: 'llm_input', summary: 'Review code changes' },
          { type: 'tool_call', summary: 'Fetch PR diff' },
          {
            type: 'llm_output', summary: `### 代码审查结果 (PR #123)
这个 PR 包含了一些关键的修改。**整体看起来不错**，但有几个点需要注意：

#### 1. 新增的辅助函数
代码里加入了一个非常好用的工具。
\`\`\`javascript
async function greet(name) {
  // 这是带语法识别的代码块
  console.log(\`Hello, \${name}!\`);
  return true;
}
\`\`\`

#### 2. JSON 响应格式变更
配置项更新为如下结构，这是一个超长 JSON 块，应该触发 **自动折叠 (JSON Collapse)** 特性：
\`\`\`json
{
  "project": "ClawDeck",
  "version": "2.1.0",
  "features": ["markdown", "timeline", "copilot"],
  "security": {
    "xss_protection": true,
    "sanitizer": "DOMPurify"
  }
}
\`\`\`

#### 3. XSS 和原生 HTML 安全测试
以下代码在界面上**绝对不能作为 HTML 渲染**，而必须显示为纯代码或被过滤掉：
<script>alert("如果你看到弹窗，说明被XSS了！")</script>
<button onclick="badCode()">危险按钮(防注入机制应该清除onclick)</button>

#### 4. 各种 Markdown 格式测试
- [x] Checkbox 已完成
- [ ] Checkbox 未完成
- 嵌套列表：
  - 子项 A
  - 子项 B

> 这是一段块引用 (Blockquote)。
> 官方样式左侧会有一条粗线。

| 表头 1 | 表头 2 | 表头 3 |
|---|---|---|
| A1 | B1 | C1 |
| A2 | B2 | C2 |

#### 5. 图片链接防御测试
这是 Base64 格式内联图片（应该**正常显示**）：
![Inline Avatar](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI5NiIgaGVpZ2h0PSI5NiIgdmlld0JveD0iMCAwIDk2IDk2Ij48cmVjdCB3aWR0aD0iOTYiIGhlaWdodD0iOTYiIHJ4PSIyMCIgZmlsbD0iI0Y2RTdDMSIvPjxjaXJjbGUgY3g9IjQ4IiBjeT0iMzYiIHI9IjE4IiBmaWxsPSIjOEI2OTE0Ii8+PHJlY3QgeD0iMjAiIHk9IjU4IiB3aWR0aD0iNTYiIGhlaWdodD0iMjIiIHJ4PSIxMSIgZmlsbD0iI0UwN0E1RiIvPjwvc3ZnPg==)

这是外部图床链接（应该**被拦截/降级为纯文本**）：
![Hack Image](http://evil-server.com/track.png)

请点击 [官方文档链接](https://example.com) 验证它的 \`target="_blank"\` 以及 \`rel="noopener"\` 安全属性。
` },
          { type: 'tool_call', summary: 'Run test suite' },
          { type: 'tool_call', summary: 'Run test suite' },
          { type: 'tool_call', summary: 'Run test suite' },
          { type: 'tool_call', summary: 'Run test suite' },
          { type: 'tool_call', summary: 'Run test suite' },
          { type: 'tool_call', summary: 'Run test suite' },
          { type: 'tool_call', summary: 'Run test suite' },
          { type: 'tool_call', summary: 'Run test suite,Run test suiteRun test suiteRun test suiteRun test suiteRun test suiteRun test suiteRun test suiteRun test suiteRun test suiteRun test suiteRun test suiteRun test suiteRun test suiteRun test suiteRun test suiteRun test suiteRun test suiteRun test suiteRun test suiteRun test suiteRun test suiteRun test suiteRun test suiteRun test suite' },
        ],
      }),
      'session-002': createSession('session-002', 'main', 'active', {
        title: 'Write blog post',
        agentId: 'agent-4',
        lastMessage: 'Writing introduction paragraph...',
        pendingApproval: null,
        steps: [
          { type: 'llm_input', summary: 'Write blog about AI trends' },
          { type: 'llm_output', summary: 'Here is the outline...' },
        ],
      }),
      'session-003': createSession('session-003', 'main', 'pending', {
        title: 'Database query',
        agentId: 'agent-3',
        lastMessage: 'Query failed - connection timeout',
        pendingApproval: null,
        steps: [
          { type: 'llm_input', summary: 'Run analytics query' },
          { type: 'tool_call', summary: 'Connect to database' },
          { type: 'tool_result', summary: 'Connection timeout' },
        ],
      }),
      'session-004': createSession('session-004', 'main', 'completed', {
        title: 'Morning digest',
        agentId: 'agent-1',
        lastMessage: 'Digest sent successfully',
        pendingApproval: null,
        steps: [
          { type: 'llm_input', summary: 'Generate daily report' },
          { type: 'llm_output', summary: 'Report generated' },
        ],
      }),
      'session-005': createSession('session-005', 'main', 'completed', {
        title: 'Code refactor',
        agentId: 'agent-2',
        lastMessage: 'Refactoring complete',
        pendingApproval: null,
        steps: [
          { type: 'llm_input', summary: 'Refactor authentication' },
          { type: 'llm_output', summary: 'Code refactored successfully' },
        ],
      }),
    },
  };
}

let _stepId = 0;
function createSession(id, key, status, extra = {}) {
  return {
    sessionId: id,
    key,
    status,
    title: extra.title || `Session ${id.slice(-3)}`,
    agentId: extra.agentId || null,
    lastMessage: extra.lastMessage || '',
    pendingApproval: extra.pendingApproval || null,
    startedAt: Date.now(),
    steps: extra.steps || [],
    abortedLastRun: false,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function addStep(session, type, summary) {
  session.steps.push({
    id: `mock-step-${++_stepId}`,
    sessionId: session.sessionId,
    type,
    timestamp: Date.now(),
    summary,
    data: {},
  });
}
