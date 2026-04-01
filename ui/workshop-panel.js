// ui/workshop-panel.js — 工坊风格首页面板
// 展示工坊风格的 Agent 任务看板

import { CatStationPanel } from './cat-station-panel.js';
import { GW_STATUS, Storage } from '../bridge/gateway-client.js';
import { WorkshopLogPanel } from './workshop-log-panel.js';
import { refreshTracker } from './refresh-tracker.js';
import { SchedulePanel } from './schedule-panel.js';
import { ChatDrawerPanel } from './chat-drawer-panel.js';
import { t, toggleLocale, onLocaleChange, getLocale } from '../i18n/index.js';

export class WorkshopPanel {
  /**
   * @param {HTMLElement} container - #hud 容器
   * @param {import('../bridge/data-router.js').DataRouter} dataSource
   * @param {import('../bridge/gateway-client.js').GatewayClient} gateway
   */
  constructor(container, dataSource, gateway) {
    this._container = container;
    this._dataSource = dataSource;
    this._gateway = gateway;
    this._visible = false;

    // 监听网关状态变化
    this._gateway.on('status', (status) => this._updateGatewayStatus(status));

    // 筛选状态
    this._filterStatus = 'all';
    this._searchKeyword = '';

    // 事件监听器存储（用于清理）
    this._gatewayEventListeners = [];

    // 网关表单草稿（用于在状态刷新时保留用户当前输入）
    this._gatewayDraft = {
      url: Storage.get('url') || 'ws://127.0.0.1:16968',
      token: Storage.get('token') || '',
    };

    // 创建 Workshop 覆盖层
    this.el = document.createElement('div');
    this.el.className = 'workshop-view';
    this.el.style.display = 'none';
    document.body.appendChild(this.el);

    // 绑定视图切换回调
    this._onViewChange = null;

    // 猫咪栏位区（初始化后创建）
    this._catStationPanel = null;

    // 聊天抽屉面板
    this._chatDrawerPanel = null;

    // cron 更新监听器引用（用于 destroy 时解绑）
    this._onCronUpdated = null;

    // 定时任务侧边栏
    this._schedulePanel = null;

    // 工单网格数据指纹缓存（用于跳过无变化的 DOM 重建）
    this._lastGridFingerprint = null;

    // 工坊日志面板
    this._workshopLogPanel = new WorkshopLogPanel(document.body);
    this.setLogPanel(this._workshopLogPanel);

    // 订阅语言变更事件
    this._cleanupI18n = onLocaleChange(() => {
      if (this._visible) this.refresh();
      this._updateLangButton();
    });

    this._render();
  }

  get visible() { return this._visible; }

  /** 设置视图切换回调 */
  setViewChangeCallback(callback) {
    this._onViewChange = callback;
  }

  /** 设置日志面板实例 */
  setLogPanel(logPanel) {
    this._logPanel = logPanel;
  }

  /** 记录日志到 LogPanel */
  _logToPanel(type, message) {
    if (this._logPanel && typeof this._logPanel.log === 'function') {
      this._logPanel.log(type, message);
    }
  }

  /** 显示 Workshop 视图 */
  show() {
    this._visible = true;
    this.el.style.display = 'block';
    document.body.setAttribute('data-view', 'workshop');
    this.refresh();
  }

  /** 隐藏 Workshop 视图 */
  hide() {
    this._visible = false;
    this.el.style.display = 'none';
  }

  /** 刷新数据并重新渲染内容 */
  refresh() {
    refreshTracker.track('WorkshopPanel.refresh');
    if (!this._visible) return;
    this._renderPageHeader();
    this._renderCorkBar();
    this._renderWorkStats();
    this._renderWorkOrdersGrid();

    // 刷新猫咪栏位区
    if (this._catStationPanel) {
      this._catStationPanel.refresh();
    }

    // 刷新聊天抽屉的 session 标签页（携带 agent 名字和图标）
    if (this._chatDrawerPanel) {
      const sessions = this._dataSource?.getSessionsForWorkshop?.() || [];
      const agents = this._dataSource?.getAgentsForWorkshop?.() || [];
      const agentMap = {};
      agents.forEach(a => { agentMap[a.id] = a; });
      const enrichedSessions = sessions.map(s => ({
        ...s,
        agentLabel: agentMap[s.agentId]?.label || s.agentId || t('chat.partner'),
        agentIcon: agentMap[s.agentId]?.icon || '🤖',
      }));
      this._chatDrawerPanel.refreshTabs(enrichedSessions);

      // 刷新下拉选择器（全量 session，包含历史记录）
      const allSessions = this._dataSource?.getAllSessionsForChat?.() || [];
      this._chatDrawerPanel.refreshDropdown(allSessions);
    }
  }

  // ============================================================
  // 渲染基础结构
  // ============================================================

  _render() {
    this.el.innerHTML = `
      <div class="workshop-container">
        <!-- 顶部状态栏 -->
        <header class="workshop-header">
          <div class="workshop-header-left">
            <div class="workshop-logo">
              <div class="workshop-logo-icon">🐾</div>
              <div class="workshop-logo-text">Claw<span>Deck</span></div>
            </div>
            <div class="workshop-status-sign">
              <span class="workshop-status-dot"></span>
              <span>${t('nav.status_open')}</span>
            </div>
          </div>
          <div class="workshop-header-center">
            <button class="workshop-nav-btn" id="btn-alert" title="${t('nav.alert')}">
              🔔 <span class="badge-count" style="display: none;">0</span>
            </button>
          </div>
          <div class="workshop-header-right">
            <button class="workshop-nav-btn" id="btn-lang" title="Switch Language">🌐 ${t('lang.switch_to')}</button>
            <button class="workshop-nav-btn" id="btn-chat" title="${t('nav.chat')}">💬 ${t('nav.chat')}</button>
          </div>
        </header>

        <!-- 顶部标题区域 -->
        <div class="workshop-page-header">
          <div class="workshop-date" id="workshop-date"></div>
          <h1 class="workshop-page-title">${t('page.today_orders')}</h1>
        </div>

        <!-- 顶部软木摘要栏 -->
        <div class="workshop-top-cork-bar" id="cork-bar">
          <!-- 动态渲染 -->
        </div>

        <!-- 工单统计条 -->
        <div class="workshop-stats-bar" id="work-stats">
          <!-- 动态渲染 -->
        </div>

        <!-- 搜索和筛选 -->
        <div class="workshop-filter-bar">
          <div class="workshop-search-box">
            <span class="search-icon">🔍</span>
            <input type="text" id="workshop-search-input" placeholder="${t('placeholder.search')}">
          </div>
          <div class="workshop-filter-buttons">
            <button class="filter-btn active" data-filter="all">${t('filter.all')}</button>
            <button class="filter-btn" data-filter="pending">${t('filter.pending')}</button>
            <button class="filter-btn" data-filter="active">${t('filter.active')}</button>
            <button class="filter-btn" data-filter="completed">${t('filter.completed')}</button>
          </div>
        </div>

        <!-- 工单网格 -->
        <div class="workshop-orders-grid" id="work-orders">
          <!-- 动态渲染 -->
        </div>

        <!-- 猫咪栏位区 -->
        <div id="cat-station-container"></div>
      </div>
    `;

    // 绑定事件
    this._bindEvents();

    // 初始化聊天抽屉面板（需要 dataSource + gateway，先于 _initCatStation）
    if (this._dataSource) {
      this._chatDrawerPanel = new ChatDrawerPanel(this._dataSource, this._gateway);
    }

    // 初始化猫咪栏位区
    this._initCatStation();

    // 初始化定时任务侧边栏
    this._schedulePanel = new SchedulePanel(this.el);

    // 初始化 cron 面板数据 + 订阅更新事件
    // 只监听 data:cron-updated（refreshCronJobs 完成后发出），确保刷新时数据已是最新
    this._refreshSchedulePanel();
    if (this._dataSource) {
      this._onCronUpdated = () => this._refreshSchedulePanel();
      this._dataSource.on('data:cron-updated', this._onCronUpdated);
    }
  }

  /** 初始化猫咪栏位区（需在 this._chatDrawerPanel 初始化后调用，否则聊天按钮将静默失效） */
  _initCatStation() {
    const container = this.el.querySelector('#cat-station-container');
    if (container && this._dataSource && this._gateway) {
      this._catStationPanel = new CatStationPanel(container, this._dataSource, this._gateway, this._chatDrawerPanel);
    }
  }

  // ============================================================
  // 事件绑定
  // ============================================================

  _bindEvents() {
    // 聊天抽屉触发按钮
    // 注意：必须使用 capture phase stopPropagation()，阻止事件冒泡到 document。
    // 否则 document-level 外部关闭逻辑会在 toggle()->show() 之后立即执行，
    // elementFromPoint 仍返回按钮本身（而非面板），导致 hide() 被错误调用。
    const btnChat = this.el.querySelector('#btn-chat');
    btnChat?.addEventListener('click', (e) => {
      e.stopPropagation(); // 阻止冒泡到 document，避免触发 outside-click hide()
      this._chatDrawerPanel?.toggle();
    }, { capture: true });

    // 语言切换按钮
    const btnLang = this.el.querySelector('#btn-lang');
    btnLang?.addEventListener('click', () => {
      toggleLocale();
    });

    this._updateLangButton();

    // 筛选按钮
    this.el.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.el.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._filterStatus = btn.dataset.filter;
        this._renderWorkOrdersGrid();
      });
    });

    // 搜索输入
    const searchInput = this.el.querySelector('#workshop-search-input');
    searchInput?.addEventListener('input', (e) => {
      this._searchKeyword = e.target.value.toLowerCase();
      this._renderWorkOrdersGrid();
    });
  }

  // ============================================================
  // 渲染方法
  // ============================================================

  _updateLangButton() {
    const btnLang = this.el.querySelector('#btn-lang');
    if (btnLang) {
      btnLang.innerHTML = `🌐 ${t('lang.switch_to')}`;
    }
  }

  /** 渲染软木摘要栏 */
  // ============================================================

  /** 渲染顶部标题区域 */
  _renderPageHeader() {
    const dateEl = this.el.querySelector('#workshop-date');
    if (!dateEl) return;

    const now = new Date();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const weekdays = [
      t('weekday.sun'), t('weekday.mon'), t('weekday.tue'),
      t('weekday.wed'), t('weekday.thu'), t('weekday.fri'), t('weekday.sat')
    ];
    const weekday = weekdays[now.getDay()];
    dateEl.textContent = t('date.format', { month, day, weekday });
  }

  _renderCorkBar() {
    const agents = this._getAgentsData();
    const sessions = this._getSessionsData();
    const metrics = this._getMetricsData();

    // 在线伙伴 = 状态为 working 或 idle 的 agent（error/离线不计入）
    const onlineAgents = agents.filter(a => a.status === 'working' || a.status === 'idle').length;
    const pendingSessions = sessions.filter(s => s.pendingApproval).length;
    // 从 getMetrics() 取 Token/费用（来源 sessions.usage API）
    const totalTokens = metrics.totalTokens || 0;
    const totalCost = metrics.totalCost || 0;

    const html = `
      <div class="workshop-cork-card">
        <div class="workshop-cork-card-icon active">👥</div>
        <div class="workshop-cork-card-info">
          <div class="workshop-cork-card-label">${t('cork.online_agents')}</div>
          <div class="workshop-cork-card-value">${onlineAgents}/${agents.length}</div>
        </div>
      </div>
      <div class="workshop-cork-card">
        <div class="workshop-cork-card-icon pending">📋</div>
        <div class="workshop-cork-card-info">
          <div class="workshop-cork-card-label">${t('cork.pending')}</div>
          <div class="workshop-cork-card-value">${pendingSessions}</div>
        </div>
      </div>
      <div class="workshop-cork-card">
        <div class="workshop-cork-card-icon token">🪙</div>
        <div class="workshop-cork-card-info">
          <div class="workshop-cork-card-label">${t('cork.token')}</div>
          <div class="workshop-cork-card-value">${this._formatNumber(totalTokens)}</div>
        </div>
      </div>
      <div class="workshop-cork-card">
        <div class="workshop-cork-card-icon bill">💰</div>
        <div class="workshop-cork-card-info">
          <div class="workshop-cork-card-label">${t('cork.cost')}</div>
          <div class="workshop-cork-card-value">$${totalCost.toFixed(4)}</div>
        </div>
      </div>
      ${this._renderGatewayCard()}
    `;

    this._cleanupGatewayEvents();
    const corkBar = this.el.querySelector('#cork-bar');
    if (corkBar) corkBar.innerHTML = html;

    // 绑定网关卡片事件
    this._bindGatewayEvents();
  }

  /** 渲染网关连接卡片 */
  _renderGatewayCard() {
    const status = this._gateway?.status || 'disconnected';
    const draftUrl = this._gatewayDraft?.url ?? Storage.get('url') ?? 'ws://127.0.0.1:16968';
    const draftToken = this._gatewayDraft?.token ?? Storage.get('token') ?? '';

    const statusText = {
      disconnected: t('gateway.disconnected'),
      connecting: t('gateway.connecting'),
      handshaking: t('gateway.handshaking'),
      connected: t('gateway.connected'),
      reconnecting: t('gateway.reconnecting'),
      auth_failed: t('gateway.auth_failed'),
    };

    const statusClass = {
      disconnected: '',
      connecting: 'connecting',
      handshaking: 'connecting',
      connected: 'connected',
      reconnecting: 'connecting',
      auth_failed: 'error',
    };

    const isConnected = status === 'connected';
    const isBusy = this._gateway?.hasActiveConnection || false;
    const isAuthFailed = status === 'auth_failed';
    const connectLabel = isBusy ? '重新连接' : '连接';
    const disconnectDisabled = !isBusy;

    const errorHint = this._formatGatewayError(status);

    return `
      <div class="workshop-cork-card gateway">
        <div class="gw-header">
          <span>${t('gateway.title')}</span>
          <div class="gw-status">
            <span class="gw-status-dot ${statusClass[status] || ''}"></span>
            <span>${statusText[status] || status}</span>
          </div>
        </div>
        ${errorHint}
        <div class="gw-row">
          <input class="gw-input gw-url" type="text" value="${draftUrl}" placeholder="ws://127.0.0.1:16968" />
        </div>
        <div class="gw-row">
          <input class="gw-input gw-token ${isAuthFailed ? 'gw-input-error' : ''}" type="password" value="${draftToken}" placeholder="Token" />
          <button class="gw-btn connect">${isBusy ? t('gateway.btn_reconnect') : t('gateway.btn_connect')}</button>
          <button class="gw-btn disconnect" ${disconnectDisabled ? 'disabled' : ''}>${isConnected ? t('gateway.btn_disconnect') : t('gateway.btn_stop')}</button>
        </div>
      </div>
    `;
  }

  /** 根据错误码生成用户友好的错误提示 HTML（参考官方 formatConnectError） */
  _formatGatewayError(status) {
    const gw = this._gateway;
    if (!gw) return '';

    const errorCode = gw.lastErrorCode || '';
    const rawError = gw.lastError || '';

    // 仅在有错误信息且非正常连接时显示
    if (!rawError || status === 'connected') return '';

    // 错误码 → i18n key 映射
    const codeToKey = {
      AUTH_TOKEN_MISMATCH: 'gateway.err.token_mismatch',
      AUTH_TOKEN_MISSING: 'gateway.err.token_missing',
      AUTH_TOKEN_NOT_CONFIGURED: 'gateway.err.token_missing',
      AUTH_REQUIRED: 'gateway.err.token_missing',
      AUTH_UNAUTHORIZED: 'gateway.err.unknown_auth',
      AUTH_PASSWORD_MISMATCH: 'gateway.err.password_mismatch',
      AUTH_PASSWORD_MISSING: 'gateway.err.token_missing',
      AUTH_RATE_LIMITED: 'gateway.err.rate_limited',
      PAIRING_REQUIRED: 'gateway.err.pairing_required',
      DEVICE_IDENTITY_REQUIRED: 'gateway.err.device_identity_required',
      CONTROL_UI_DEVICE_IDENTITY_REQUIRED: 'gateway.err.device_identity_required',
      AUTH_DEVICE_TOKEN_MISMATCH: 'gateway.err.device_token_mismatch',
      DEVICE_AUTH_INVALID: 'gateway.err.unknown_auth',
      DEVICE_AUTH_SIGNATURE_EXPIRED: 'gateway.err.unknown_auth',
      DEVICE_AUTH_SIGNATURE_INVALID: 'gateway.err.unknown_auth',
    };

    let message;
    if (errorCode && codeToKey[errorCode]) {
      message = t(codeToKey[errorCode]);
    } else if (rawError.includes('timeout') || rawError.includes('Timeout')) {
      message = t('gateway.err.handshake_timeout');
    } else if (rawError.includes('connect') || rawError.includes('fetch') || status === 'disconnected' || status === 'reconnecting') {
      message = t('gateway.err.connect_failed');
    } else if (status === 'auth_failed') {
      message = t('gateway.err.unknown_auth');
    } else {
      message = rawError;
    }

    // 配对提示需要额外醒目标注
    const isPairing = errorCode === 'PAIRING_REQUIRED';
    const extraClass = isPairing ? ' gw-error-pairing' : '';

    return `<div class="gw-error-hint${extraClass}">${this._escapeHtml(message)}</div>`;
  }

  _syncGatewayDraft(url, token) {
    const fallbackUrl = this._gatewayDraft?.url ?? Storage.get('url') ?? 'ws://127.0.0.1:16968';
    const fallbackToken = this._gatewayDraft?.token ?? Storage.get('token') ?? '';

    this._gatewayDraft = {
      url: url ?? fallbackUrl,
      token: token ?? fallbackToken,
    };
  }

  /** 绑定网关卡片事件 */
  _bindGatewayEvents() {
    const corkBar = this.el.querySelector('#cork-bar');
    if (!corkBar) return;

    const gatewayCard = corkBar.querySelector('.gateway');
    if (!gatewayCard) return;

    const handlers = {};
    handlers.cardClick = (e) => e.stopPropagation();
    gatewayCard.addEventListener('click', handlers.cardClick);

    const urlInput = gatewayCard.querySelector('.gw-url');
    const tokenInput = gatewayCard.querySelector('.gw-token');

    [urlInput, tokenInput].forEach(input => {
      if (input) {
        const inputHandlers = {
          click: (e) => e.stopPropagation(),
          input: (e) => {
            e.stopPropagation();
            this._syncGatewayDraft(urlInput?.value ?? '', tokenInput?.value ?? '');
          },
          keydown: (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              this._syncGatewayDraft(urlInput?.value ?? '', tokenInput?.value ?? '');
              this._gateway?.connect(this._gatewayDraft.url, this._gatewayDraft.token);
            }
          },
        };
        input.addEventListener('click', inputHandlers.click);
        input.addEventListener('input', inputHandlers.input);
        input.addEventListener('keydown', inputHandlers.keydown);

        if (input === urlInput) handlers.urlInput = inputHandlers;
        else handlers.tokenInput = inputHandlers;
      }
    });

    const connectBtn = gatewayCard.querySelector('.gw-btn.connect');
    handlers.connectClick = (e) => {
      e.stopPropagation();
      this._syncGatewayDraft(urlInput?.value ?? '', tokenInput?.value ?? '');
      this._gateway?.connect(this._gatewayDraft.url, this._gatewayDraft.token);
    };
    connectBtn?.addEventListener('click', handlers.connectClick);

    const disconnectBtn = gatewayCard.querySelector('.gw-btn.disconnect');
    handlers.disconnectClick = (e) => {
      e.stopPropagation();
      this._gateway?.stop();
    };
    disconnectBtn?.addEventListener('click', handlers.disconnectClick);

    this._gatewayEventListeners.push({ element: gatewayCard, handlers });
  }

  /** 更新网关状态显示 */
  _updateGatewayStatus() {
    this._syncGatewayDraft();
    if (this._visible) {
      this._renderCorkBar();
    }
  }

  /** 渲染工单统计条 */
  /** 渲染工单统计条 */
  _renderWorkStats() {
    const sessions = this._getSessionsData();
    const metrics = this._getMetricsData();

    // 需要批准的工单 = 待审批的会话数
    const pending = sessions.filter(s => s.pendingApproval).length;
    // 今日异常工单 = 今日发生异常的会话数
    const attention = sessions.filter(s => s.abortedLastRun).length;
    // 今日已处理 = 从 getMetrics().todayCompletedSessions 取值
    const completed = metrics.todayCompletedSessions || 0;

    const html = `
      <div class="work-stat-item pending">
        <span class="work-stat-value">${pending}</span>
        <span class="work-stat-label">${t('stats.pending_orders')}</span>
      </div>
      <div class="work-stat-item attention">
        <span class="work-stat-value">${attention}</span>
        <span class="work-stat-label">${t('stats.attention')}</span>
      </div>
      <div class="work-stat-item done">
        <span class="work-stat-value">${completed}</span>
        <span class="work-stat-label">${t('stats.completed_today')}</span>
      </div>
    `;

    const workStats = this.el.querySelector('#work-stats');
    if (workStats) workStats.innerHTML = html;
  }

  /** 渲染工单网格 */
  _renderWorkOrdersGrid() {
    refreshTracker.track('WorkshopPanel._renderWorkOrdersGrid [DOM rebuild]');
    let agents = this._getAgentsData();
    let sessions = this._getSessionsData();

    // 应用筛选状态
    if (this._filterStatus !== 'all') {
      agents = agents.filter(agent => {
        const agentSessions = sessions.filter(s => s.agentId === agent.id);
        const activeSession = agentSessions.find(s => s.status === 'active');
        const sessionStatus = activeSession?.status || agent.status;

        if (this._filterStatus === 'pending') {
          return sessionStatus === 'pending';
        } else if (this._filterStatus === 'active') {
          return sessionStatus === 'active' || agent.status === 'working';
        } else if (this._filterStatus === 'completed') {
          return sessionStatus === 'completed';
        }
        return true;
      });
    }

    // 应用搜索关键词
    if (this._searchKeyword) {
      agents = agents.filter(agent => {
        const agentSessions = sessions.filter(s => s.agentId === agent.id);
        const activeSession = agentSessions[0];
        const title = (activeSession?.title || '').toLowerCase();
        const label = (agent.label || '').toLowerCase();
        const id = (agent.id || '').toLowerCase();
        return title.includes(this._searchKeyword) || label.includes(this._searchKeyword) || id.includes(this._searchKeyword);
      });
    }

    if (agents.length === 0) {
      const grid = this.el.querySelector('#work-orders');
      if (grid) grid.innerHTML = `<div class="workshop-order-empty">${t('empty.no_orders')}</div>`;
      return;
    }

    // 过滤出有 session 的 agents（没有 session 的不渲染工单）
    const agentsWithSessions = agents.filter(agent => {
      const agentSessions = sessions.filter(s => s.agentId === agent.id);
      return agentSessions.length > 0;
    });

    // 如果没有工单，显示空状态
    if (agentsWithSessions.length === 0) {
      const grid = this.el.querySelector('#work-orders');
      if (grid) grid.innerHTML = `<div class="workshop-order-empty">${t('empty.no_orders')}</div>`;
      this._lastGridFingerprint = null; // 清除指纹，下次有工单时强制重建
      return;
    }

    // 数据指纹检测：只有数据真正变化时才重建 DOM
    // 指纹覆盖影响渲染的字段，排除 updatedAt（纯时间戳，不影响状态显示）
    const fingerprint = agentsWithSessions.map(agent => {
      const agentSessions = sessions.filter(s => s.agentId === agent.id);
      const active = agentSessions.find(s => s.status === 'active') || agentSessions[0];
      return [
        agent.id, agent.status,
        active?.sessionKey || '',
        active?.title || '',
        active?.abortedLastRun ? '1' : '0',
        active?.runState?.status || '',
        active?.runState?.toolTitle || '',
        active?.pendingApproval?.id || '',
      ].join(':');
    }).join('|');

    if (fingerprint === this._lastGridFingerprint) return;
    this._lastGridFingerprint = fingerprint;

    const html = agentsWithSessions.map(agent => {
      const agentSessions = sessions.filter(s => s.agentId === agent.id);
      const activeSession = agentSessions.find(s => s.status === 'active') || agentSessions[0];

      return this._renderWorkOrderCard(agent, activeSession);
    }).join('');

    const grid = this.el.querySelector('#work-orders');
    if (grid) grid.innerHTML = html;

    // 绑定卡片事件
    this._bindCardEvents();
  }

  /** 渲染单个工单卡片 */
  _renderWorkOrderCard(agent, session) {
    const agentStatusText = {
      idle: t('status.idle'),
      working: t('status.working'),
      error: t('status.error'),
    };

    // 实时运行状态文案（来自 agent 事件流）
    const runState = session?.runState;
    const abortedLastRun = session?.abortedLastRun;

    // 根据运行状态确定显示文字
    let statusDisplayText;
    let statusClass;

    if (runState?.status === 'tool') {
      // 正在执行工具
      statusDisplayText = t('run.tool', {
        emoji: runState.toolEmoji || '🧰',
        title: runState.toolTitle || 'Tool'
      });
      statusClass = 'working';
    } else if (runState?.status === 'streaming') {
      // 模型正在输出
      statusDisplayText = t('run.streaming');
      statusClass = 'working';
    } else if (runState?.status === 'running') {
      // 正在运行
      statusDisplayText = t('run.running');
      statusClass = 'working';
    } else if (runState?.status === 'error' || abortedLastRun) {
      // 上次异常
      statusDisplayText = t('run.last_error');
      statusClass = 'error';
    } else if (runState?.status === 'aborted') {
      // 已中止
      statusDisplayText = t('run.aborted');
      statusClass = 'error';
    } else if (session?.pendingApproval) {
      // 等待审批
      statusDisplayText = t('run.pending_approval');
      statusClass = 'pending';
    } else {
      // 就绪/空闲
      statusDisplayText = t('run.ready');
      statusClass = 'idle';
    }

    const hasApproval = session?.pendingApproval;

    // 渲染步骤
    const stepsHtml = (agent.steps || []).map((step, idx) => {
      const stepStatus = step.status === 'completed' ? 'completed' :
        step.status === 'active' ? 'active' : '';
      return `
        <div class="step-item">
          <span class="step-dot ${stepStatus}"></span>
          <span>${step.summary}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="workshop-order-card" data-agent-id="${agent.id}">
        <div class="workshop-order-illustration">
          <span class="workshop-order-img">${agent.icon}</span>
          ${agent.status === 'working' ? '<span class="workshop-order-badge">Working</span>' : ''}
        </div>
        <div class="workshop-order-header">
          <div>
            <div class="workshop-order-title">${session?.title || agent.label || t('card.unnamed_task')}</div>
            <div class="workshop-order-id">#${agent.id.slice(0, 8)}</div>
          </div>
          <span class="workshop-order-status ${statusClass}">${statusDisplayText}</span>
        </div>
        <div class="workshop-order-info">
          <div class="info-item">
            <div class="info-label">${t('card.responsible_cat')}</div>
            <div class="info-value">${agent.icon} ${agent.label}</div>
          </div>
          <div class="info-item">
            <div class="info-label">${t('card.duration')}</div>
            <div class="info-value">${this._getSessionDuration(session)}</div>
          </div>
          <div class="info-item">
            <div class="info-label">${t('card.last_action')}</div>
            <div class="info-value">${this._getLastActionTime(session)}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Token</div>
            <div class="info-value">${this._formatTokenUsage(session?.usage)}</div>
          </div>
        </div>
        ${agent.steps && agent.steps.length > 0 ? `
        <div class="workshop-order-steps">
          <div class="steps-title">${t('card.steps_title')}</div>
          ${stepsHtml}
        </div>
        ` : ''}
        ${hasApproval ? `
        <div class="workshop-order-actions">
          <button class="workshop-action-btn approve" data-action="approve" data-session="${session.sessionKey}" data-approval="${session.pendingApproval.id}">${t('action.approve')}</button>
          <button class="workshop-action-btn reject" data-action="reject" data-session="${session.sessionKey}" data-approval="${session.pendingApproval.id}">${t('action.reject')}</button>
          <button class="workshop-action-btn retry" data-action="retry" data-session="${session.sessionKey}">${t('action.retry')}</button>
        </div>
        ` : ''}
        <div class="workshop-supplement-input" data-session="${session?.sessionKey || ''}">
          <input type="text" placeholder="${t('card.supplement_placeholder')}" ${!session ? 'disabled' : ''} />
          <button class="btn-send">${t('card.send')}</button>
          ${this._canAbort(session) ? `<button class="btn-abort" data-session="${session.sessionKey}" title="Abort">⏹</button>` : ''}
        </div>
      </div>
    `;
  }

  // ============================================================
  // 事件处理
  // ============================================================

  _bindCardEvents() {
    // 审批按钮
    this.el.querySelectorAll('.workshop-action-btn[data-action]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const sessionKey = btn.dataset.session;
        const approvalId = btn.dataset.approval;

        try {
          await this._gateway.resolveApproval(approvalId, action === 'approve' ? 'allow-once' : 'deny');
          this.refresh();
        } catch (err) {
          console.error('[WorkshopPanel] 审批失败:', err);
        }
      });
    });

    // 发送按钮
    this.el.querySelectorAll('.workshop-supplement-input').forEach(container => {
      const input = container.querySelector('input');
      const btn = container.querySelector('.btn-send');

      const sendMessage = async () => {
        const message = input.value.trim();
        const sessionKey = container.dataset.session;
        if (!message || !sessionKey) return;

        try {
          await this._gateway.sendInstruction(sessionKey, message);
          input.value = '';
          this.refresh();
        } catch (err) {
          console.error('[WorkshopPanel] 发送指令失败:', err);
        }
      };

      btn?.addEventListener('click', sendMessage);
      input?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
      });

      // 打断按钮
      const abortBtn = container.querySelector('.btn-abort');
      abortBtn?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const sessionKey = container.dataset.session;
        if (!sessionKey) return;

        try {
          await this._gateway.abortSession(sessionKey);
          this.refresh();
        } catch (err) {
          console.error('[WorkshopPanel] 中断任务失败:', err);
        }
      });
    });
  }

  // ============================================================
  // 数据获取
  // ============================================================

  _refreshSchedulePanel() {
    if (!this._schedulePanel || !this._dataSource) return;
    if (typeof this._dataSource.getCronJobsForPanel !== 'function') return;
    const jobs = this._dataSource.getCronJobsForPanel();
    this._schedulePanel.refresh(jobs);
  }

  _getAgentsData() {
    // 优先使用 DataRouter，否则使用 Gateway 的 Mock 方法
    if (this._dataSource && typeof this._dataSource.getAgentsForWorkshop === 'function') {
      return this._dataSource.getAgentsForWorkshop();
    }
    if (this._gateway && typeof this._gateway.getAgentsForWorkshop === 'function') {
      return this._gateway.getAgentsForWorkshop();
    }
    return [];
  }

  _getSessionsData() {
    if (this._dataSource && typeof this._dataSource.getSessionsForWorkshop === 'function') {
      return this._dataSource.getSessionsForWorkshop();
    }
    if (this._gateway && typeof this._gateway.getSessionsForWorkshop === 'function') {
      return this._gateway.getSessionsForWorkshop();
    }
    return [];
  }

  _getMetricsData() {
    if (this._dataSource && typeof this._dataSource.getMetrics === 'function') {
      return this._dataSource.getMetrics();
    }
    if (this._gateway && typeof this._gateway.getMetrics === 'function') {
      return this._gateway.getMetrics();
    }
    return {
      totalTokens: 0,
      totalCost: 0,
      completedSessions: 0,
      totalErrors: 0,
    };
  }

  _getSessionsForWorkshop() {
    // 从 DataRouter 获取 session 数据
    if (!this._dataSource) return [];

    const sessions = this._dataSource._activeSessions || [];
    return sessions.map(s => ({
      id: s.sessionId,
      sessionKey: s.key,
      title: s.label || 'Untitled',
      status: s.status || 'pending',
      agentId: this._extractAgentId(s.key),
      lastMessage: s.lastMessagePreview || '',
      pendingApproval: null,
      steps: [],
      usage: { total: s.totalTokens || 0 },
    }));
  }

  _extractAgentId(sessionKey) {
    if (!sessionKey) return null;
    const parts = sessionKey.split(':');
    return parts.length >= 2 ? parts[1] : null;
  }

  // ============================================================
  // 工具方法
  // ============================================================

  _formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }

  /** 格式化 token 数量（区分 input/output） */
  _formatTokenUsage(usage) {
    if (!usage) return '-';
    const input = usage.input || 0;
    const output = usage.output || 0;
    if (input === 0 && output === 0) return '-';
    return `↑${this._formatNumber(input)} / ↓${this._formatNumber(output)}`;
  }

  /** 获取 session 最近活动时间（使用官方 updatedAt 字段） */
  _getSessionDuration(session) {
    if (!session || !session.updatedAt) return '-';
    return this._formatRelativeTime(session.updatedAt);
  }

  /** 获取最近动作时间（使用官方 updatedAt 字段） */
  _getLastActionTime(session) {
    if (!session || !session.updatedAt) return '-';
    return this._formatRelativeTime(session.updatedAt);
  }

  /** 判断是否可中断任务（仅在运行状态下显示打断按钮） */
  _canAbort(session) {
    if (!session?.id) return false;
    const runState = session?.runState?.status;
    // 只有运行中状态才显示打断按钮：running, streaming, tool
    if (runState === 'running' || runState === 'streaming' || runState === 'tool') {
      return true;
    }
    return false;
  }

  /** 格式化相对时间 */
  _formatRelativeTime(timestamp) {
    if (!timestamp) return '-';
    const time = new Date(timestamp);
    const now = new Date();
    const diff = Math.floor((now - time) / 1000);
    if (diff < 60) return `${diff}秒前`;
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
    return `${Math.floor(diff / 86400)}天前`;
  }

  // ============================================================
  // 跻加事件监听器清理方法
  // ============================================================

  _cleanupGatewayEvents() {
    this._gatewayEventListeners.forEach(({ element, handlers }) => {
      if (handlers.cardClick) element.removeEventListener('click', handlers.cardClick);
      if (handlers.urlInput?.click) element.querySelector('.gw-url')?.removeEventListener('click', handlers.urlInput.click);
      if (handlers.urlInput?.input) element.querySelector('.gw-url')?.removeEventListener('input', handlers.urlInput.input);
      if (handlers.urlInput?.keydown) element.querySelector('.gw-url')?.removeEventListener('keydown', handlers.urlInput.keydown);
      if (handlers.tokenInput?.click) element.querySelector('.gw-token')?.removeEventListener('click', handlers.tokenInput.click);
      if (handlers.tokenInput?.input) element.querySelector('.gw-token')?.removeEventListener('input', handlers.tokenInput.input);
      if (handlers.tokenInput?.keydown) element.querySelector('.gw-token')?.removeEventListener('keydown', handlers.tokenInput.keydown);
      if (handlers.connectClick) element.querySelector('.gw-btn.connect')?.removeEventListener('click', handlers.connectClick);
      if (handlers.disconnectClick) element.querySelector('.gw-btn.disconnect')?.removeEventListener('click', handlers.disconnectClick);
    });
    this._gatewayEventListeners = [];
  }

  _escapeHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  /** 清理组件资源 */
  destroy() {
    // 清理事件监听器
    if (this._cleanupI18n) this._cleanupI18n();
    this._cleanupGatewayEvents();
    if (this._dataSource && this._onCronUpdated) {
      this._dataSource.off('data:cron-updated', this._onCronUpdated);
      this._onCronUpdated = null;
    }

    // 清理日志面板
    if (this._workshopLogPanel && typeof this._workshopLogPanel.destroy === 'function') {
      this._workshopLogPanel.destroy();
    }

    // 清理猫咪栏位区
    if (this._catStationPanel && typeof this._catStationPanel.destroy === 'function') {
      this._catStationPanel.destroy();
    }

    // 清理定时任务侧边栏
    if (this._schedulePanel && typeof this._schedulePanel.destroy === 'function') {
      this._schedulePanel.destroy();
    }

    // 清理聊天抽屉面板
    if (this._chatDrawerPanel && typeof this._chatDrawerPanel.destroy === 'function') {
      this._chatDrawerPanel.destroy();
    }

    // 从 DOM 中移除
    if (this.el && this.el.parentNode) {
      this.el.parentNode.removeChild(this.el);
    }
  }
}
