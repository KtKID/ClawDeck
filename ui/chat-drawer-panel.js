// ui/chat-drawer-panel.js — 聊天居中浮窗
// 右侧抽屉 → 居中浮窗（2026-03-26）
// position: fixed 居中浮窗，fade+scale 动画，叠在所有内容上层

import { t } from '../i18n/index.js';

export class ChatDrawerPanel {
  /**
   * @param {import('../bridge/data-router.js').DataRouter} dataSource
   * @param {import('../bridge/gateway-client.js').GatewayClient} [gateway]
   */
  constructor(dataSource, gateway) {
    this._dataSource = dataSource;
    this._gateway = gateway || null;
    this._visible = false;
    this._currentSessionKey = null;
    this._currentAgentId = null;    // 当前上下文 agent（用于下拉过滤）
    this._newSessionMode = false;   // "新会话"模式：发送时走 startAgentChat
    this._newSessionAgentId = null; // 新会话模式绑定的 agentId
    this._sessions = []; // 活跃 session 列表（用于 tabs，最近 2 分钟）
    this._allSessions = []; // 全量 session 列表（用于下拉选择器）

    // push:chat / push:agent 监听器引用（用于 destroy 时解绑）
    this._pushChatHandler = null;
    this._pushAgentHandler = null;
    this._pushFallbackHandler = null;
    this._fallbackToastTimer = null;
    this._markdownBound = false; // MarkdownRenderer.bind() 一次性注册，避免重复监听
    this._documentClickHandler = null; // document-level 点击外部关闭

    // 抽屉背景遮罩
    this._backdrop = document.createElement('div');
    this._backdrop.className = 'chat-drawer-backdrop';
    document.body.appendChild(this._backdrop);

    // 抽屉主体
    this.el = document.createElement('aside');
    this.el.className = 'chat-drawer-panel';
    document.body.appendChild(this.el);

    this._render();
    this._bindEvents();
    this._subscribePush();
  }

  // ============================================================
  // 公共接口
  // ============================================================

  get visible() { return this._visible; }

  /** 打开抽屉，可选择预选 sessionKey 和 agentId 上下文 */
  async show(sessionKey, agentId) {
    this._visible = true;
    this.el.classList.add('open');
    this._backdrop.classList.add('visible');

    // 打开时同步拉取一次 session 数据，确保 gateway 未连接或异步刷新未完成时也不空白
    if (this._dataSource && typeof this._dataSource.refreshSessions === 'function') {
      await this._dataSource.refreshSessions().catch(() => { });
    }
    if (this._dataSource && typeof this._dataSource.getAllSessionsForChat === 'function') {
      this.refreshDropdown(this._dataSource.getAllSessionsForChat());
    }

    // 更新 agent 上下文（始终重置，过滤器不残留）
    this._currentAgentId = agentId || null;
    this._renderDropdown();

    // 确定要选中的 session：
    // 1. 有明确 sessionKey 且在 allSessions 中存在 → 直接选中
    // 2. 无有效 sessionKey 但有 agentId → 从 allSessions 中取该 agent 最新 session
    // 3. 都没有 → 回退到第一个活跃 session
    let targetKey = sessionKey;
    if (targetKey && !this._allSessions.some(s => s.sessionKey === targetKey)) {
      targetKey = null; // sessionKey 无效（如误传了 agentId），清空
    }
    if (!targetKey && this._currentAgentId) {
      // 按 updatedAt 降序找该 agent 最新的 session（排除 heartbeat）
      const agentSorted = this._allSessions
        .filter(s => s.agentId === this._currentAgentId && !/heartbeat/i.test(s.title || '') && !/heartbeat/i.test(s.sessionKey || ''))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      targetKey = agentSorted[0]?.sessionKey || null;
    }

    if (targetKey && targetKey !== this._currentSessionKey) {
      this._selectSession(targetKey);
    } else if (!targetKey && this._currentAgentId) {
      // 该 agent 无任何 session → 显示空态（不跨 agent 回退）
      this._currentSessionKey = null;
      this._renderTabs();
      this._updateHeaderStatus();
      const messagesEl = this.el.querySelector('.chat-messages');
      if (messagesEl) {
        messagesEl.innerHTML = `
          <div class="chat-empty">
            <div class="chat-empty-icon">${t('chat.no_sessions_icon')}</div>
            <div class="chat-empty-text">${t('chat.agent_no_sessions')}</div>
          </div>
        `;
      }
    } else if (!this._currentSessionKey && this._sessions.length > 0) {
      // 无 agent 上下文时才回退到第一个活跃 session
      this._selectSession(this._sessions[0].sessionKey);
    }
  }

  /** 以"新会话"模式打开抽屉：不选已有 session，发送时创建新 session */
  async showNewSession(agentId) {
    try {
      this._newSessionMode = true;
      this._newSessionAgentId = agentId;
      this._currentSessionKey = null;
      this._currentAgentId = agentId;

      this._visible = true;
      this.el.classList.add('open');
      this._backdrop.classList.add('visible');

      // 清空消息区，显示新会话提示
      const messagesEl = this.el.querySelector('.chat-messages');
      if (messagesEl) {
        messagesEl.innerHTML = `<div class="chat-empty">${t('chat.new_session_hint')}</div>`;
      }

      // 下拉显示"新会话"
      const selectEl = this.el.querySelector('.chat-session-select');
      if (selectEl) {
        selectEl.innerHTML = `<option value="" selected>${t('chat.new_session_label')}</option>`;
        selectEl.disabled = true;
      }

      // 更新标题（选择器与 _updateHeaderStatus 保持一致）
      const agentLabel = this._findAgentLabel(agentId);
      const titleEl = this.el.querySelector('.chat-title-text');
      if (titleEl) {
        titleEl.textContent = `✨ ${agentLabel} — ${t('chat.new_session_label')}`;
      }
    } catch (err) {
      console.error('[ChatDrawer] showNewSession error:', err);
      // 确保即使出错也打开窗口
      this._visible = true;
      this.el.classList.add('open');
      this._backdrop.classList.add('visible');
    }
  }

  /** 查找 agent 显示名 */
  _findAgentLabel(agentId) {
    const session = this._allSessions.find(s => s.agentId === agentId);
    return session?.agentLabel || agentId || '?';
  }

  /** 退出新会话模式 */
  _exitNewSessionMode() {
    this._newSessionMode = false;
    this._newSessionAgentId = null;
    const selectEl = this.el.querySelector('.chat-session-select');
    if (selectEl) selectEl.disabled = false;
  }

  /** 关闭抽屉 */
  hide() {
    this._visible = false;
    this.el.classList.remove('open');
    this._backdrop.classList.remove('visible');
    this._exitNewSessionMode();
  }

  /** 切换开/关（不同 agent 时直接切换，同 agent 时关闭） */
  async toggle(sessionKey, agentId) {
    if (this._visible && (!agentId || agentId === this._currentAgentId)) {
      // 同一个 agent（或无 agentId）→ 关闭
      this.hide();
    } else {
      // 未打开或不同 agent → 打开/切换
      await this.show(sessionKey, agentId);
    }
  }

  /** 刷新全量 session 下拉选择器（由 WorkshopPanel 在 data:updated 后调用） */
  refreshDropdown(allSessions) {
    this._allSessions = allSessions || [];
    // 新会话模式 或 等待新 session 创建期间，只更新数据不重绘 UI
    if (!this._newSessionMode) {
      this._renderDropdown();
    }
    this.refreshSidebar();
  }

  /** 刷新 session 标签页列表（由 WorkshopPanel 在 data:updated 后调用） */
  refreshTabs(sessions) {
    this._sessions = sessions || [];
    if (!this._newSessionMode) {
      this._renderTabs();
      this._updateHeaderStatus();
    }
  }

  /** 销毁组件，清理资源 */
  destroy() {
    this._unsubscribePush();
    this._backdrop.remove();
    this.el.remove();
  }

  // ============================================================
  // 渲染
  // ============================================================

  _render() {
    this.el.innerHTML = `
      <!-- Agent 侧边栏 -->
      <div class="chat-agent-sidebar">
        ${this._renderAgentSidebar()}
      </div>

      <!-- 主内容区 -->
      <div class="chat-main-content">
        <!-- 头部 -->
        <div class="chat-header">
          <div class="chat-header-session">
            <div class="chat-session-title">
              <span class="paw-icon">🐾</span>
              <span class="chat-title-text">${t('chat.title')}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
              <div class="chat-session-status idle">
                <span class="status-dot"></span>
                <span class="chat-status-label">${t('chat.status.idle')}</span>
              </div>
              <button class="chat-close-btn" title="${t('chat.close')}">✕</button>
            </div>
          </div>
          <!-- Session 下拉选择器 -->
          <div class="chat-session-selector">
            <select class="chat-session-select">
              <option value="">${t('chat.select_session')}</option>
            </select>
          </div>
          <!-- 标签页（活跃 session 快捷切换） -->
          <div class="chat-tabs">
            <button class="chat-tab active" data-session-key="">${t('chat.tab_all')}</button>
          </div>
        </div>

        <!-- 消息区域 -->
        <div class="chat-messages">
          <div class="chat-empty">
            <div class="chat-empty-icon">${t('chat.empty_icon')}</div>
            <div class="chat-empty-text">${t('chat.empty_text').replace('\n', '<br>')}</div>
          </div>
        </div>

        <!-- 输入区域 -->
        <div class="chat-input-area">
          <div class="chat-input-wrapper">
            <input type="text" class="chat-input" placeholder="${t('chat.input_placeholder')}">
            <button class="chat-send-btn" title="${t('chat.send')}">➤</button>
          </div>
        </div>
      </div>
    `;
    this._bindAgentAvatars();
  }

  /** 渲染左侧 Agent 头像栏 */
  _renderAgentSidebar() {
    const agents = this._getUniqueAgents();
    if (agents.length === 0) {
      return ''; // 无 agent 时隐藏侧边栏
    }
    return agents.map(a => {
      const isActive = a.agentId === this._currentAgentId ? 'active' : '';
      const isRunning = a.runState === 'running' || a.runState === 'streaming' ? 'running' : '';
      return `
        <div class="chat-agent-avatar ${isActive} ${isRunning}"
             data-agent-id="${this._escapeAttr(a.agentId)}"
             title="${this._escapeAttr(a.agentLabel || a.agentId)}">
          ${this._escapeHtml(a.agentIcon || '🐱')}
          <span class="agent-badge"></span>
        </div>
      `;
    }).join('');
  }

  /** 从 allSessions 中提取不重复的 Agent 列表（按 updatedAt 降序，跳过 kind=other 的兜底 session） */
  _getUniqueAgents() {
    const map = new Map();
    const sorted = [...this._allSessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    for (const s of sorted) {
      // 跳过 kind=other（无法匹配 session key 模式的兜底 session），它们没有真实 agentId
      if (s.kind === 'other') continue;
      if (!s.agentId) continue;
      if (!map.has(s.agentId)) {
        map.set(s.agentId, {
          agentId: s.agentId,
          agentIcon: s.agentIcon,
          agentLabel: s.agentLabel,
          runState: s.runState?.status,
        });
      }
    }
    return Array.from(map.values());
  }

  /** 刷新侧边栏头像（对外暴露，由外部 data:updated 后调用） */
  refreshSidebar() {
    const sidebar = this.el.querySelector('.chat-agent-sidebar');
    if (!sidebar) return;
    sidebar.innerHTML = this._renderAgentSidebar();
    this._bindAgentAvatars();
  }

  _bindAgentAvatars() {
    const sidebar = this.el.querySelector('.chat-agent-sidebar');
    if (!sidebar) return;
    sidebar.onclick = (e) => {
      const avatar = e.target.closest('.chat-agent-avatar');
      if (!avatar) return;
      const agentId = avatar.dataset.agentId || null;
      this._selectAgent(agentId);
    };
  }

  /** 选中 Agent：更新 _currentAgentId，同步侧边栏 + 下拉 + 消息 */
  _selectAgent(agentId) {
    this._currentAgentId = agentId;

    // 同步侧边栏高亮
    this.el.querySelectorAll('.chat-agent-avatar').forEach(a => {
      a.classList.toggle('active', (a.dataset.agentId || null) === agentId);
    });

    // 重新渲染下拉（只显示该 agent 的 session）
    this._renderDropdown();

    // 如果当前有该 agent 的活跃 session，自动切换过去（排除 heartbeat）
    let targetKey = null;
    if (agentId) {
      const agentSessions = this._allSessions
        .filter(s => s.agentId === agentId && !/heartbeat/i.test(s.title || '') && !/heartbeat/i.test(s.sessionKey || ''))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      targetKey = agentSessions[0]?.sessionKey || null;
    }

    if (targetKey && targetKey !== this._currentSessionKey) {
      this._selectSession(targetKey);
    } else if (!targetKey && agentId) {
      // 该 agent 无任何 session，显示空态提示
      this._currentSessionKey = null;
      this._renderTabs();
      this._updateHeaderStatus();
      const messagesEl = this.el.querySelector('.chat-messages');
      if (messagesEl) {
        messagesEl.innerHTML = `
          <div class="chat-empty">
            <div class="chat-empty-icon">${t('chat.no_sessions_icon')}</div>
            <div class="chat-empty-text">${t('chat.agent_no_sessions')}</div>
          </div>
        `;
      }
    } else if (!targetKey) {
      // 清空了 agent filter，切到全部
      this._selectSession(null);
    } else {
      // 同 agent 下只是重排 session，刷新 tabs 即可
      this._renderTabs();
    }
  }

  _renderDropdown() {
    const selectEl = this.el.querySelector('.chat-session-select');
    if (!selectEl) return;

    const currentKey = this._currentSessionKey || '';

    // 按 updatedAt 降序排列；过滤 heartbeat 内部 session；若有 agentId 上下文则只显示该 agent 的 session
    let sorted = [...this._allSessions]
      .filter(s => !/heartbeat/i.test(s.title || '') && !/heartbeat/i.test(s.sessionKey || ''))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (this._currentAgentId) {
      sorted = sorted.filter(s => s.agentId === this._currentAgentId);
    }

    selectEl.innerHTML = `
      <option value="">${t('chat.select_session')}</option>
      ${sorted.map(s => {
        const label = `${s.agentIcon || '🤖'} ${s.agentLabel || ''} · ${this._truncateText(s.title, 20)}`;
        const selected = s.sessionKey === currentKey ? 'selected' : '';
        return `<option value="${this._escapeAttr(s.sessionKey)}" ${selected}>${this._escapeHtml(label)}</option>`;
      }).join('')}
    `;
  }

  _truncateText(str, max) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max) + '…' : str;
  }

  _escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  _renderTabs() {
    const tabsEl = this.el.querySelector('.chat-tabs');
    if (!tabsEl) return;

    // 若有当前 Agent，按 Agent 过滤；排除 heartbeat 内部 session
    const source = this._sessions
      .filter(s => !/heartbeat/i.test(s.title || '') && !/heartbeat/i.test(s.sessionKey || ''));
    const filtered = this._currentAgentId
      ? source.filter(s => s.agentId === this._currentAgentId)
      : source;
    const sorted = [...filtered]
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 5);
    const activeKey = this._currentSessionKey || '';

    tabsEl.innerHTML = sorted.map(s => `
      <button class="chat-tab ${activeKey === s.sessionKey ? 'active' : ''}"
              data-session-key="${s.sessionKey}"
              title="${s.title}">
        ${s.title.length > 8 ? s.title.slice(0, 8) + '…' : s.title}
      </button>
    `).join('');

    // 重新绑定 tab 点击
    tabsEl.querySelectorAll('.chat-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.sessionKey || null;
        this._selectSession(key);
      });
    });
  }

  _updateHeaderStatus() {
    if (!this._currentSessionKey) {
      // 没有选中 session，重置标题和状态 badge
      const titleEl = this.el.querySelector('.chat-title-text');
      if (titleEl) titleEl.textContent = t('chat.title');
      const statusEl = this.el.querySelector('.chat-session-status');
      const labelEl = this.el.querySelector('.chat-status-label');
      if (statusEl) statusEl.className = 'chat-session-status idle';
      if (labelEl) labelEl.textContent = t('chat.status.idle');
      return;
    }
    const session = this._sessions.find(s => s.sessionKey === this._currentSessionKey)
      || this._allSessions.find(s => s.sessionKey === this._currentSessionKey);
    const statusEl = this.el.querySelector('.chat-session-status');
    const labelEl = this.el.querySelector('.chat-status-label');
    const titleEl = this.el.querySelector('.chat-title-text');
    if (!statusEl || !labelEl) return;

    const runState = session?.runState?.status || 'idle';
    statusEl.className = 'chat-session-status ' + (runState === 'running' || runState === 'streaming' ? 'running' : runState === 'error' ? 'error' : 'idle');

    const statusText = {
      running: t('chat.status.running'),
      streaming: t('chat.status.streaming'),
      error: t('chat.status.error'),
      aborted: t('chat.status.aborted'),
      idle: t('chat.status.idle'),
    };
    labelEl.textContent = statusText[runState] || t('chat.status.idle');

    // 标题显示选中 agent 的名字和图标；若 session 已过期不在列表中则回退默认
    if (titleEl) {
      if (session) {
        const icon = session.agentIcon || '🐾';
        const name = session.agentLabel || session.title || t('chat.partner');
        titleEl.textContent = `${icon} ${name}`;
      } else {
        titleEl.textContent = t('chat.title');
      }
    }
  }

  // ============================================================
  // 消息渲染（#5）
  // ============================================================

  /** 将 steps 数组渲染到消息区域（最多 200 条，与 chat.history limit 对齐） */
  _renderMessages(steps) {
    const messagesEl = this.el.querySelector('.chat-messages');
    if (!messagesEl) return;

    if (!steps || steps.length === 0) {
      messagesEl.innerHTML = `
        <div class="chat-empty">
          <div class="chat-empty-icon">${t('chat.empty_icon')}</div>
          <div class="chat-empty-text">${t('chat.no_records').replace('\n', '<br>')}</div>
        </div>
      `;
      return;
    }

    messagesEl.innerHTML = steps.map(step => this._stepToHTML(step)).join('');
    this._scrollToBottom(true);
    // 全量渲染后一次性绑定 Markdown 代码块复制按钮
    if (!this._markdownBound && typeof window.MarkdownRenderer !== 'undefined') {
      window.MarkdownRenderer.bind(messagesEl);
      this._markdownBound = true;
    }
  }

  /** 单条 step 转 HTML 字符串 */
  _stepToHTML(step) {
    // B6: 内部事件（model-snapshot、fallback 重试等）不渲染
    if (step.type === 'internal') return '';

    const time = step.timestamp ? new Date(step.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

    // B1: 错误类型渲染为错误卡片
    if (step.type === 'error') {
      const errorText = step.summary || t('chat.request_failed');
      return `
        <div class="message-system error">
          ⚠️ ${this._escapeHtml(errorText)}
        </div>
      `;
    }

    // 气泡样式：只有 llm_input/llm_output 使用气泡，其他都用 meta 样式
    if (step.type === 'llm_output') {
      const avatar = this._getAgentIcon(step.agentId, this._currentSessionKey);
      return `
        <div class="message-ai">
          <div class="avatar">${this._escapeHtml(avatar)}</div>
          <div class="message-content">
            <div class="markdown-content">${this._safeMarkdownRender(this._extractFullText(step))}</div>
            ${time ? `<div class="message-time">${time}</div>` : ''}
          </div>
        </div>
      `;
    }

    if (step.type === 'llm_input') {
      return `
        <div class="message-user">
          <div class="avatar">🙋</div>
          <div class="message-content">
            <div>${this._escapeHtml(this._extractFullText(step) || t('chat.user_input'))}</div>
            ${time ? `<div class="message-time">${time}</div>` : ''}
          </div>
        </div>
      `;
    }

    // meta 样式：其他所有类型
    return this._stepToMetaHTML(step, time);
  }

  /** 非 text 类型转 meta 样式 HTML */
  _stepToMetaHTML(step, time) {
    // 将 step.type 映射到 switch case 期望的 type 名，step.type 更具体时优先
    const typeMap = {
      'tool_result': 'toolResult',
      'tool_call': 'toolCall',
    };
    const mapped = typeMap[step.type];
    const type = mapped || step.originalType || step.type;
    const data = step.data || {};

    // 构建字段展示
    const fields = [];

    // 通用字段
    if (data.id) fields.push({ key: 'id', value: data.id });
    if (data.timestamp) fields.push({ key: 'timestamp', value: new Date(data.timestamp).toLocaleString('zh-CN') });
    if (data.parentId) fields.push({ key: 'parentId', value: data.parentId });

    // 根据类型添加特定字段
    switch (type) {
      case 'toolCall':
        if (data.name) fields.push({ key: 'name', value: data.name });
        if (data.arguments) {
          const args = typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments, null, 2);
          fields.push({ key: 'arguments', value: args });
        }
        if (data.id) fields.push({ key: 'toolId', value: data.id });
        break;

      case 'toolResult': {
        // 兼容两种格式：直接在 data 上或在 data.message 上
        const inner = data.message || data;
        if (inner.toolName) fields.push({ key: 'toolName', value: inner.toolName });
        if (inner.toolCallId) fields.push({ key: 'toolCallId', value: inner.toolCallId });
        if (inner.content) {
          const content = typeof inner.content === 'string' ? inner.content : JSON.stringify(inner.content, null, 2);
          fields.push({ key: 'content', value: content });
        }
        if (inner.details) fields.push({ key: 'details', value: JSON.stringify(inner.details, null, 2) });
        if (inner.isError !== undefined) fields.push({ key: 'isError', value: inner.isError ? 'true' : 'false' });
        break;
      }

      case 'thinking':
        if (data.thinking) fields.push({ key: 'thinking', value: data.thinking });
        if (data.thinkingSignature) fields.push({ key: 'thinkingSignature', value: data.thinkingSignature });
        break;

      case 'custom':
        if (data.customType) fields.push({ key: 'customType', value: data.customType });
        if (data.data) fields.push({ key: 'data', value: JSON.stringify(data.data, null, 2) });
        break;

      case 'model_change':
        if (data.provider) fields.push({ key: 'provider', value: data.provider });
        if (data.modelId) fields.push({ key: 'modelId', value: data.modelId });
        break;

      case 'thinking_level_change':
        if (data.thinkingLevel) fields.push({ key: 'thinkingLevel', value: data.thinkingLevel });
        break;

      case 'session':
        if (data.version) fields.push({ key: 'version', value: data.version });
        if (data.cwd) fields.push({ key: 'cwd', value: data.cwd });
        break;

      case 'message':
        if (data.message?.role) fields.push({ key: 'role', value: data.message.role });
        if (data.message?.content) {
          const content = typeof data.message.content === 'string' ? data.message.content : JSON.stringify(data.message.content, null, 2);
          fields.push({ key: 'content', value: content });
        }
        break;
    }

    // 错误状态样式
    const isError = data.isError === true || step.isError === true;
    const errorClass = isError ? ' error' : '';

    // 类型标签和摘要
    const typeLabel = {
      'toolCall': t('meta.toolCall'),
      'toolResult': t('meta.toolResult'),
      'thinking': t('meta.thinking'),
      'custom': t('meta.custom'),
      'model_change': t('meta.model_change'),
      'thinking_level_change': t('meta.thinking_level_change'),
      'session': t('meta.session'),
      'message': t('meta.message'),
      'meta': t('meta.meta'),
    }[type] || `📋 ${type}`;

    return `
      <div class="message-meta${errorClass}" data-type="${type}">
        <div class="message-meta-header">
          <span class="meta-type">${typeLabel}</span>
          ${time ? `<span class="meta-time">${time}</span>` : ''}
        </div>
        <div class="message-meta-content">
          ${fields.map(f => {
            // 对大对象进行截断处理，避免性能问题
            let value = f.value;
            if (typeof value === 'object' && value !== null) {
              const str = JSON.stringify(value);
              if (str.length > 500) {
                value = str.slice(0, 500) + '...(truncated)';
              } else {
                value = str;
              }
            }
            return `
            <div class="meta-field">
              <span class="meta-key">${f.key}:</span>
              <pre class="meta-value">${this._escapeHtml(String(value).slice(0, 500))}${String(value).length > 500 ? '...' : ''}</pre>
            </div>
          `}).join('')}
        </div>
      </div>
    `;
  }

  /** 追加单条 step（实时推送用，#7） */
  _appendStep(step) {
    const messagesEl = this.el.querySelector('.chat-messages');
    if (!messagesEl) return;

    // 移除空状态
    const empty = messagesEl.querySelector('.chat-empty');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.innerHTML = this._stepToHTML(step).trim();
    const node = div.firstElementChild;
    if (node) {
      messagesEl.appendChild(node);
      this._scrollToBottom();
      // 一次性绑定 Markdown 代码块复制按钮（幂等）
      if (!this._markdownBound && typeof window.MarkdownRenderer !== 'undefined') {
        window.MarkdownRenderer.bind(messagesEl);
        this._markdownBound = true;
      }
    }
  }

  _scrollToBottom(instant = false) {
    // 使用 requestAnimationFrame 确保 DOM 渲染完成后再滚动
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const messagesEl = this.el.querySelector('.chat-messages');
        if (messagesEl) {
          if (instant) {
            // 直接定位，不触发平滑滚动动画（用于打开时的历史记录定位）
            messagesEl.style.scrollBehavior = 'auto';
            messagesEl.scrollTop = messagesEl.scrollHeight;
            messagesEl.style.scrollBehavior = '';
          } else {
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
        }
      });
    });
  }

  _extractFullText(step) {
    // 兼容两种格式：直接 content 或嵌套在 message.content
    const content = step.data?.content || step.data?.message?.content;
    if (!content) return step.summary || '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const text = content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      return text || step.summary || '';
    }
    return step.summary || '';
  }

  /** 安全渲染 Markdown（有 MarkdownRenderer 时用 DOMPurify 净化，否则兜底纯转义） */
  _safeMarkdownRender(text) {
    const raw = text || '';
    if (typeof window.MarkdownRenderer !== 'undefined') {
      return window.MarkdownRenderer.render(raw);
    }
    return this._escapeHtml(raw);
  }

  /** 根据 agentId（优先）或当前 sessionKey 回退查找 agent 图标 */
  _getAgentIcon(agentId, sessionKey) {
    // 优先用 step 上的 agentId（由 bridge._messagesToSteps 注入）
    if (agentId) {
      const s = this._allSessions.find(s => s.agentId === agentId);
      if (s?.agentIcon) return s.agentIcon;
    }
    // 回退：用当前 sessionKey 查
    if (sessionKey) {
      const s = this._allSessions.find(s => s.sessionKey === sessionKey);
      if (s?.agentIcon) return s.agentIcon;
    }
    return '🐱';
  }

  _escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ============================================================
  // 会话加载（#6）
  // ============================================================

  async _selectSession(sessionKey) {
    this._currentSessionKey = sessionKey || null;

    // 同步侧边栏 Agent 头像高亮（找到当前 session 属于哪个 agent）
    const session = this._allSessions.find(s => s.sessionKey === sessionKey);
    const agentId = session?.agentId || null;
    if (agentId !== this._currentAgentId) {
      this._currentAgentId = agentId;
      this.refreshSidebar();
      this._renderDropdown(); // Agent 变了，下拉也要按新 agent 过滤重绘
      this._renderTabs();
    } else {
      // 仅更新高亮，不重新渲染整条侧边栏
      this.el.querySelectorAll('.chat-agent-avatar').forEach(a => {
        a.classList.toggle('active', (a.dataset.agentId || null) === agentId);
      });
    }

    // 更新 tab 高亮
    this.el.querySelectorAll('.chat-tab').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.sessionKey || null) === this._currentSessionKey);
    });

    // 同步下拉选中值
    const selectEl = this.el.querySelector('.chat-session-select');
    if (selectEl) selectEl.value = this._currentSessionKey || '';

    // 更新标题状态
    this._updateHeaderStatus();

    // 显示加载状态
    const messagesEl = this.el.querySelector('.chat-messages');
    if (messagesEl) {
      messagesEl.innerHTML = `<div class="chat-loading">${t('chat.loading')}</div>`;
    }

    if (!sessionKey) {
      // "全部" tab — 显示所有活跃 session 最后一条消息的系统提示
      if (this._sessions.length === 0) {
        if (messagesEl) {
          messagesEl.innerHTML = `
            <div class="chat-empty">
              <div class="chat-empty-icon">${t('chat.no_sessions_icon')}</div>
              <div class="chat-empty-text">${t('chat.no_sessions_text').replace('\n', '<br>')}</div>
            </div>
          `;
        }
      } else {
        // 展示所有活跃 session 的概览
        if (messagesEl) {
          messagesEl.innerHTML = this._sessions.slice(0, 10).map(s => `
            <div class="message-system">
              ${this._escapeHtml(s.title)} · ${s.lastMessage ? this._escapeHtml(String(s.lastMessage).slice(0, 40)) : t('chat.waiting')}
            </div>
          `).join('');
        }
      }
      return;
    }

    // 加载指定 session 历史
    try {
      const detail = await this._dataSource.getSessionDetail(sessionKey);
      // 竞态防护：若用户在 await 期间已切走，丢弃过期响应
      if (sessionKey !== this._currentSessionKey) return;
      const steps = detail?.steps || [];
      this._renderMessages(steps);
    } catch (err) {
      // 竞态防护：仅当仍为当前 session 时渲染错误
      if (sessionKey !== this._currentSessionKey) return;
      const messagesElAfter = this.el.querySelector('.chat-messages');
      if (messagesElAfter) {
        messagesElAfter.innerHTML = `
          <div class="message-system error">
            ${t('chat.load_failed', { error: err.message || t('chat.unknown_error') })}
          </div>
        `;
      }
    }
  }

  // ============================================================
  // 实时推送（#7）
  // ============================================================

  _subscribePush() {
    this._pushChatHandler = ({ sessionKey, step }) => {
      // 只有当前选中的 session 才处理
      if (this._visible && sessionKey === this._currentSessionKey) {
        // 新消息到达时，隐藏阅读指示器并刷新消息列表
        // 注意：_refreshMessages() 会从 API 获取完整历史（已包含最新消息），不需要再 append
        this._hideReadingIndicator();
        this._refreshMessages();
      }
    };
    this._dataSource.on('push:chat', this._pushChatHandler);

    // push:agent lifecycle.end → 可靠的 AI 响应完成信号，主动刷新历史
    // 用于弥补 push:chat 在 gateway 不发 payload.message 时失效的情况
    this._pushAgentHandler = (payload) => {
      if (!this._visible || payload.sessionKey !== this._currentSessionKey) return;

      // B2: Reading Indicator — 在 AI 响应过程中显示三点动画
      if (payload.stream === 'lifecycle') {
        if (payload.data?.phase === 'start') {
          this._showReadingIndicator();
        } else if (payload.data?.phase === 'end' || payload.data?.phase === 'error') {
          this._hideReadingIndicator();
          this._refreshMessages();
        }
      } else if (payload.stream === 'assistant') {
        this._showReadingIndicator();
      }
    };
    this._dataSource.on('push:agent', this._pushAgentHandler);

    // B3: Fallback 模型切换提示
    this._pushFallbackHandler = ({ sessionKey, phase, activeModel, activeProvider }) => {
      if (!this._visible || sessionKey !== this._currentSessionKey) return;
      this._showFallbackToast(phase, activeModel, activeProvider);
    };
    this._dataSource.on('push:fallback', this._pushFallbackHandler);
  }

  _unsubscribePush() {
    if (this._pushChatHandler) {
      this._dataSource.off('push:chat', this._pushChatHandler);
      this._pushChatHandler = null;
    }
    if (this._pushAgentHandler) {
      this._dataSource.off('push:agent', this._pushAgentHandler);
      this._pushAgentHandler = null;
    }
    if (this._pushFallbackHandler) {
      this._dataSource.off('push:fallback', this._pushFallbackHandler);
      this._pushFallbackHandler = null;
    }
    if (this._documentClickHandler) {
      document.removeEventListener('click', this._documentClickHandler);
      this._documentClickHandler = null;
    }
  }

  /** 轻量刷新：静默重新获取当前 session 历史，不触发 loading 状态 */
  async _refreshMessages() {
    const key = this._currentSessionKey;
    if (!key) return;
    try {
      const detail = await this._dataSource.getSessionDetail(key);
      // 竞态防护：若 await 期间用户切走，丢弃过期响应
      if (key !== this._currentSessionKey) return;
      this._renderMessages(detail?.steps || []);
    } catch { /* 静默失败，不影响已显示内容 */ }
  }

  // ============================================================
  // B2: Reading Indicator（三点等待动画）
  // ============================================================

  /** 显示三点等待动画 */
  _showReadingIndicator() {
    if (this.el.querySelector('.chat-reading-indicator')) return; // 已存在
    const messagesEl = this.el.querySelector('.chat-messages');
    if (!messagesEl) return;
    const empty = messagesEl.querySelector('.chat-empty');
    if (empty) empty.remove();

    const indicator = document.createElement('div');
    indicator.className = 'chat-reading-indicator';
    const agentIcon = this._getAgentIcon(null, this._currentSessionKey);
    indicator.innerHTML = `
      <div class="avatar">${agentIcon}</div>
      <div class="message-content">
        <span class="chat-reading-dots">
          <span></span><span></span><span></span>
        </span>
      </div>
    `;
    messagesEl.appendChild(indicator);
    this._scrollToBottom();
  }

  /** 移除三点等待动画 */
  _hideReadingIndicator() {
    const indicator = this.el.querySelector('.chat-reading-indicator');
    if (indicator) indicator.remove();
  }

  // ============================================================
  // B3: Fallback 模型切换提示
  // ============================================================

  /** 显示 fallback 切换 toast */
  _showFallbackToast(phase, model, provider) {
    this._hideFallbackToast();
    const messagesEl = this.el.querySelector('.chat-messages');
    if (!messagesEl) return;

    const toast = document.createElement('div');
    toast.className = 'chat-fallback-toast';
    const label = model || provider || t('chat.fallback_model');
    toast.textContent = phase === 'cleared'
      ? t('chat.fallback_switched', { model: label })
      : t('chat.fallback_switching', { model: label });
    messagesEl.appendChild(toast);
    this._scrollToBottom();

    this._fallbackToastTimer = setTimeout(() => this._hideFallbackToast(), 8000);
  }

  /** 移除 fallback toast */
  _hideFallbackToast() {
    if (this._fallbackToastTimer) {
      clearTimeout(this._fallbackToastTimer);
      this._fallbackToastTimer = null;
    }
    const toast = this.el.querySelector('.chat-fallback-toast');
    if (toast) toast.remove();
  }

  // ============================================================
  // 事件绑定（#11/#12）
  // ============================================================

  _bindEvents() {
    // 关闭按钮（独立处理，不阻止冒泡）
    this.el.addEventListener('click', (e) => {
      if (e.target.closest('.chat-close-btn')) {
        this.hide();
      }
    });

    // ==============================================================
    // backdrop 和 outside-click 关闭逻辑
    // ==============================================================
    // backdrop 点击关闭（backdrop pointer-events:none，点击直接透过，
    // 事件会传到 canvas/HUD，document handler 用 elementFromPoint 判断是否在面板外来关闭）
    this._backdrop.addEventListener('click', () => this.hide());

    // 点击外部关闭（document-level 检测，用于 backdrop 覆盖不到的角落区域）
    this._documentClickHandler = (e) => {
      if (!this._visible) return;
      const clicked = document.elementFromPoint(e.clientX, e.clientY);
      if (!clicked || (!this.el.contains(clicked) && clicked !== this.el)) {
        this.hide();
      }
    };
    document.addEventListener('click', this._documentClickHandler);

    // Session 下拉切换
    const selectEl = this.el.querySelector('.chat-session-select');
    selectEl?.addEventListener('change', (e) => {
      const key = e.target.value || null;
      this._selectSession(key);
    });

    // 发送按钮
    const sendBtn = this.el.querySelector('.chat-send-btn');
    const input = this.el.querySelector('.chat-input');

    sendBtn?.addEventListener('click', () => this._handleSend());
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._handleSend();
      }
    });
  }

  /** 发送处理：立即追加气泡 + 调用 API */
  async _handleSend() {
    const input = this.el.querySelector('.chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    // 新会话模式：调用 startAgentChat 创建新 session
    if (this._newSessionMode && this._newSessionAgentId) {
      const agentId = this._newSessionAgentId; // 先保存，_exitNewSessionMode 会清空
      input.value = '';
      this._appendStep({
        id: `user-${Date.now()}`,
        type: 'llm_input',
        summary: text,
        timestamp: Date.now(),
      });

      if (this._gateway) {
        try {
          await this._gateway.startAgentChat(agentId, text);
          // 保持 _newSessionMode=true 防止外部 refresh 覆盖 UI，延迟后再退出
          await new Promise(r => setTimeout(r, 2000));
          this._exitNewSessionMode();
          // 刷新 session 列表，尝试找到新 session
          if (this._dataSource) {
            await this._dataSource.refreshSessions().catch(() => {});
            const allSessions = this._dataSource.getAllSessionsForChat?.() || [];
            this.refreshDropdown(allSessions);
            const newest = allSessions
              .filter(s => s.agentId === agentId && !/heartbeat/i.test(s.title || '') && !/heartbeat/i.test(s.sessionKey || ''))
              .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
            if (newest) {
              this._selectSession(newest.sessionKey);
            }
          }
        } catch (err) {
          this._appendStep({
            id: `err-${Date.now()}`,
            type: 'error',
            summary: t('chat.send_failed', { error: err.message || t('chat.unknown_error') }),
            timestamp: Date.now(),
          });
        }
      }
      return;
    }

    // 普通模式：发送到已有 session
    if (!this._currentSessionKey) return;

    input.value = '';
    this._appendStep({
      id: `user-${Date.now()}`,
      type: 'llm_input',
      summary: text,
      timestamp: Date.now(),
    });

    if (this._gateway) {
      try {
        await this._gateway.sendInstruction(this._currentSessionKey, text);
      } catch (err) {
        this._appendStep({
          id: `err-${Date.now()}`,
          type: 'error',
          summary: t('chat.send_failed', { error: err.message || t('chat.unknown_error') }),
          timestamp: Date.now(),
        });
      }
    }
  }
}
