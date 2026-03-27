// ui/cat-station-panel.js — 猫咪栏位容器

import { getAgentsForCatCards } from './cat-data-mapper.js';
import { CatCard } from './cat-card.js';
import { refreshTracker } from './refresh-tracker.js';
import { t, onLocaleChange } from '../i18n/index.js';

// 常量定义
const ANIMATION_DELAY = {
  ENTER: 80,
};

export class CatStationPanel {
  /**
   * @param {HTMLElement} container
   * @param {import('../bridge/data-router.js').DataRouter} dataRouter
   * @param {import('../bridge/gateway-client.js').GatewayClient} gateway
   */
  constructor(container, dataRouter, gateway, chatDrawerPanel = null) {
    this.container = container;
    this.dataRouter = dataRouter;
    this.gateway = gateway;
    this.chatDrawerPanel = chatDrawerPanel;

    this.el = document.createElement('div');
    this.el.className = 'cat-station-panel';
    container.appendChild(this.el);

    this._catCards = [];
    this._isLoading = false;

    // 订阅推送事件
    this._setupPushHandlers();

    // 订阅语言变更，重新渲染组件
    this._unsubscribeLocale = onLocaleChange(() => this.refresh());

    this._render();
  }

  /**
   * 刷新猫咪列表
   * 修复：先渲染容器（_render），再向容器插入卡片（_updateCatCards）
   * 避免在容器不存在时插入卡片导致失败
   */
  async refresh() {
    refreshTracker.track('CatStationPanel.refresh');
    if (this._isLoading) return;
    this._isLoading = true;
    try {
      // 1. 先获取数据
      const agents = getAgentsForCatCards(this.dataRouter);

      // 2. 标记加载完成（必须在 _render() 之前，否则 _render() 会检测到 _isLoading=true 直接 return）
      this._isLoading = false;

      // 3. 渲染容器（此时 .cat-station-scroll 容器存在于 DOM）
      this._render();

      // 4. 向容器插入卡片（此时 querySelector 能找到容器）
      this._updateCatCards(agents);
    } catch (error) {
      console.error('CatStationPanel: Failed to refresh:', error);
      this._isLoading = false;
    }
  }

  /**
   * 更新猫咪卡片
   */
  _updateCatCards(agents) {
    const newIds = agents.map(a => a.id);
    const existingIds = this._catCards.map(c => c._props.id);
    const sameList = newIds.length === existingIds.length &&
      newIds.every((id, i) => id === existingIds[i]);

    if (sameList) {
      // agent 列表未变化 → 只 patch 动态字段，不触发入场动画
      agents.forEach((agent, i) => {
        this._catCards[i].update({
          status: agent.status,
          currentTask: agent.currentTask,
          latestStep: agent.latestStep,
          usage: agent.usage,
        });
      });
      return;
    }

    // agent 列表有增减 → 全量重建（触发入场动画）
    this._catCards.forEach(card => card.destroy());
    this._catCards = [];
    agents.forEach((agent, index) => {
      const card = new CatCard(this.el.querySelector('.cat-station-scroll'), {
        ...agent,
        onSendCommand: (message) => this._sendCommand(agent.id, message),
        onChatClick: (sessionKey) => {
          // sessionKey 可能为 null（无活跃 session），由 ChatDrawerPanel 自动选择该 agent 最新 session
          console.log('[CatStation] chat click:', sessionKey, 'agentId:', agent.id);
          if (this.chatDrawerPanel) {
            this.chatDrawerPanel.toggle(sessionKey || null, agent.id);
          } else {
            console.warn('[CatStation] chatDrawerPanel not available');
          }
        },
      });
      setTimeout(() => {
        card.el.classList.add('entering');
      }, index * ANIMATION_DELAY.ENTER);
      this._catCards.push(card);
    });
  }

  /**
   * 发送命令
   * @param {string} agentId - Agent ID
   * @param {string} message - 指令内容
   */
  async _sendCommand(agentId, message) {
    try {
      // 从 DataRouter 获取该 Agent 的活跃 Session
      const activeSessions = this.dataRouter.getSessionsForWorkshop();
      const agentSession = activeSessions.find(s => s.agentId === agentId);

      if (agentSession) {
        // 有活跃 Session，使用 chat.send 发送指令
        await this.gateway.sendInstruction(agentSession.sessionKey, message);
        console.log(`CatStationPanel: Command sent to agent ${agentId} (session):`, message);
      } else {
        // 没有活跃 Session（idle 状态），通过 agent RPC 创建新会话并发送消息
        await this.gateway.startAgentChat(agentId, message);
        console.log(`CatStationPanel: Command sent to agent ${agentId} (new session):`, message);
      }

    } catch (error) {
      console.error('CatStationPanel: Failed to send command:', error);
      throw error;
    }
  }

  /**
   * 订阅推送事件
   */
  _setupPushHandlers() {
    // 只响应 lifecycle 事件（session 开始/结束/报错）
    // 高频 tool/streaming token 事件由 WorkshopPanel 处理，不触发全量重建
    this._onAgentPush = (payload) => {
      if (payload.stream !== 'lifecycle') return;
      const sessionKey = payload.sessionKey;
      if (!sessionKey) return;
      this._patchCardRunState(sessionKey);
    };

    this.dataRouter.on('push:agent', this._onAgentPush);
  }

  /**
   * 定向 patch 单张卡片的运行状态（仅在状态实际变化时更新）
   * @param {string} sessionKey
   */
  _patchCardRunState(sessionKey) {
    // agentId 获取：优先从活跃 sessions 中取；session 结束后立即从 _activeSessions 移除，
    // 此时从 sessionKey 直接解析（格式 <type>:<agentId>[:<suffix>]，与 DataRouter._extractAgentId 逻辑一致）
    const sessions = this.dataRouter.getSessionsForWorkshop();
    const activeSession = sessions.find(s => s.sessionKey === sessionKey);
    const agentId = activeSession?.agentId ?? sessionKey.split(':')[1] ?? sessionKey;

    const card = this._catCards.find(c => c._props.id === agentId);
    if (!card) return;

    // pending 由审批系统管理，lifecycle 事件不覆盖
    if (card._props.status === 'pending') return;

    // _sessionRunState 在 push:agent 触发前已由 _updateSessionRunStateFromAgent 更新
    const runState = this.dataRouter.getSessionRunState(sessionKey);
    if (!runState) return;

    // 状态映射基于官方 SessionRunStatus：idle|running|streaming|tool|error|aborted
    const statusMap = {
      running: 'working', streaming: 'working', tool: 'working',
      idle: 'idle', error: 'error', aborted: 'error',
    };
    const newStatus = statusMap[runState.status] || card._props.status;

    if (newStatus !== card._props.status) {
      card.update({ status: newStatus });
    }
  }

  /**
   * 渲染 UI
   */
  _render() {
    const agents = this._catCards.length > 0
      ? this._catCards.map(c => c._props)
      : getAgentsForCatCards(this.dataRouter);

    if (this._isLoading) {
      this.el.innerHTML = `
        <div class="cat-station-title">${t('station.title')}</div>
        <div class="cat-station-loading">
          ${t('station.loading')}
        </div>
      `;
      return;
    }

    if (agents.length === 0) {
      this.el.innerHTML = `
        <div class="cat-station-title">${t('station.title')}</div>
        <div class="cat-station-empty">
          ${t('station.empty')}
        </div>
      `;
      return;
    }

    // 容器结构已存在时跳过 innerHTML 重置（避免 5s 轮询触发无效 DOM 重建）
    if (!this.el.querySelector('.cat-station-scroll')) {
      this.el.innerHTML = `
        <div class="cat-station-title">${t('station.title')}</div>
        <div class="cat-station-scroll">
        </div>
      `;
    }

    // 卡片已创建时确保它们在 DOM 内（首次建容器或卡片被意外移除时补回）
    if (this._catCards.length > 0) {
      const scrollContainer = this.el.querySelector('.cat-station-scroll');
      this._catCards.forEach(card => {
        if (!scrollContainer.contains(card.el)) scrollContainer.appendChild(card.el);
      });
    }
  }

  /**
   * 销毁面板
   */
  destroy() {
    // 取消订阅
    if (this._onAgentPush) {
      this.dataRouter.off('push:agent', this._onAgentPush);
    }
    if (this._unsubscribeLocale) {
      this._unsubscribeLocale();
    }

    // 销毁卡片
    this._catCards.forEach(card => card.destroy());
    this._catCards = [];

    // 移除 DOM
    this.el.remove();
  }
}
