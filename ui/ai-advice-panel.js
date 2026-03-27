// ui/ai-advice-panel.js — AI 建议栏位组件

import { getPriorityInfo, limitAdvices } from './ai-advice-types.js';
import { escape } from './utils.js';
import { t } from '../i18n/index.js';

export class AIAdvicePanel {
  /**
   * @param {HTMLElement} container - 容器元素
   * @param {Object} options - 配置选项
   * @param {number} options.maxCount - 最大显示数量，默认3
   * @param {Function} options.onDispatch - 派遣任务回调 (advice)
   * @param {Function} options.onDismiss - 忽略回调 (advice)
   * @param {Function} options.onRedispatch - 重新委托回调 (advice)
   * @param {Function} options.onRefresh - 手动刷新回调
   */
  constructor(container, options = {}) {
    this._container = container;
    this._maxCount = options.maxCount || 3;
    this._onDispatch = options.onDispatch || null;
    this._onDismiss = options.onDismiss || null;
    this._onRedispatch = options.onRedispatch || null;
    this._onReactivate = options.onReactivate || null;
    this._onRefresh = options.onRefresh || null;
    this._advices = [];
    this._historyAdvices = [];
    this._historyExpanded = false;
    this._el = null;
  }

  /**
   * 设置建议数据
   * @param {Array} advices - 建议列表
   */
  setData(advices) {
    this._advices = limitAdvices(advices, this._maxCount);
    this._render();
  }

  /**
   * 设置最大显示数量
   * @param {number} maxCount
   */
  setMaxCount(maxCount) {
    this._maxCount = maxCount;
  }

  /**
   * 设置历史建议数据（completed/dismissed/failed）
   * @param {Array} advices - 已处理建议列表
   */
  setHistoryData(advices) {
    this._historyAdvices = advices || [];
    if (this._historyAdvices.length > 0) {
      this._historyExpanded = true;
    }
    this._render();
  }

  /**
   * 渲染头部
   */
  _renderHeader(level = 'h2') {
    return `
      <div class="ai-advice-header">
        <div class="ai-advice-header-main">
          <${level} class="ai-advice-title">${t('advice.title')}</${level}>
          <p class="ai-advice-desc">${t('advice.desc')}</p>
        </div>
        <button class="ai-advice-refresh-btn" data-action="refresh" type="button">${t('advice.refresh')}</button>
      </div>
    `;
  }

  /**
   * 渲染组件
   */
  _render() {
    if (!this._el) {
      this._el = document.createElement('div');
      this._el.className = 'ai-advice-panel';
      this._container.appendChild(this._el);
    }

    if (this._advices.length === 0) {
      this._el.style.display = 'block';
      this._el.innerHTML = `
        ${this._renderHeader('h3')}
        <div class="ai-advice-empty">
          <p>${t('advice.empty')}</p>
        </div>
        ${this._renderHistory()}
      `;
      this._bindEvents();
      return;
    }

    // 分组：活跃（pending）vs 执行中（dispatched）vs 已完成/失败
    const pending = this._advices.filter(a => !a.status || a.status === 'pending');
    const dispatched = this._advices.filter(a => a.status === 'dispatched');
    const completed = this._advices.filter(a => a.status === 'completed');
    const failed = this._advices.filter(a => a.status === 'failed');

    this._el.style.display = 'block';
    this._el.innerHTML = `
      ${this._renderHeader('h2')}
      ${pending.length > 0 ? `<div class="ai-advice-list">${pending.map(a => this._renderPendingCard(a)).join('')}</div>` : ''}
      ${dispatched.length > 0 ? `<div class="ai-advice-progress-list">${dispatched.map(a => this._renderDispatchedCard(a)).join('')}</div>` : ''}
      ${completed.length > 0 ? `<div class="ai-advice-result-list">${completed.map(a => this._renderCompletedCard(a)).join('')}</div>` : ''}
      ${failed.length > 0 ? `<div class="ai-advice-result-list">${failed.map(a => this._renderFailedCard(a)).join('')}</div>` : ''}
      ${this._renderHistory()}
    `;

    this._bindEvents();
  }

  /**
   * pending 状态：完整卡片（保持原样）
   */
  _renderPendingCard(advice) {
    const priorityInfo = getPriorityInfo(advice.priority);
    const escapedId = escape(advice.id);
    const escapedTitle = escape(advice.title);
    const escapedSummary = escape(advice.summary);

    return `
      <div class="ai-advice-card" data-id="${escapedId}">
        <div class="ai-advice-top">
          <span class="ai-advice-source">${t('advice.source', { source: escape(advice.source) })}</span>
          <span class="ai-advice-priority ${priorityInfo.className}">${priorityInfo.label}</span>
        </div>
        <h4 class="ai-advice-card-title">${escapedTitle}</h4>
        <p class="ai-advice-summary">${escapedSummary}</p>
        <div class="ai-advice-meta">
          <span>${t('advice.recommend', { owner: escape(advice.owner) })}</span>
          <span>${t('advice.eta', { time: advice.estimatedMinutes })}</span>
        </div>
        <div class="ai-advice-actions">
          <button class="ai-advice-btn primary" data-action="dispatch" data-id="${escapedId}">${t('advice.dispatch', { owner: escape(advice.owner) })}</button>
          <button class="ai-advice-btn secondary" data-action="dismiss" data-id="${escapedId}">${t('advice.dismiss')}</button>
        </div>
      </div>
    `;
  }

  /**
   * dispatched 状态：精简进度行
   */
  _renderDispatchedCard(advice) {
    const escapedId = escape(advice.id);
    return `
      <div class="ai-advice-card dispatched" data-id="${escapedId}">
        <div class="ai-advice-dispatched-row">
          <span class="ai-advice-dispatched-icon">\u{1F680}</span>
          <span class="ai-advice-dispatched-title">${escape(advice.title)}</span>
          <span class="ai-advice-dispatched-status">${t('advice.dispatched_status', { owner: escape(advice.owner) })}</span>
        </div>
      </div>
    `;
  }

  /**
   * completed 状态：成功摘要行
   */
  _renderCompletedCard(advice) {
    const escapedId = escape(advice.id);
    const summary = advice.resultSummary || t('advice.result_summary');
    return `
      <div class="ai-advice-card completed" data-id="${escapedId}">
        <div class="ai-advice-result-row">
          <span class="ai-advice-result-icon">\u2705</span>
          <span class="ai-advice-result-title">${t('advice.completed', { owner: escape(advice.owner), title: escape(advice.title) })}</span>
        </div>
        <p class="ai-advice-result-summary">${escape(summary)}</p>
      </div>
    `;
  }

  /**
   * failed 状态：警示行 + 重新委托
   */
  _renderFailedCard(advice) {
    const escapedId = escape(advice.id);
    return `
      <div class="ai-advice-card failed" data-id="${escapedId}">
        <div class="ai-advice-result-row">
          <span class="ai-advice-result-icon">\u{1F613}</span>
          <span class="ai-advice-result-title">${t('advice.failed', { owner: escape(advice.owner), title: escape(advice.title) })}</span>
          <button class="ai-advice-btn primary small" data-action="redispatch" data-id="${escapedId}">${t('advice.redispatch')}</button>
        </div>
      </div>
    `;
  }

  /**
   * 兼容旧调用：根据 status 分发渲染
   */
  _renderCard(advice) {
    const status = advice.status || 'pending';
    switch (status) {
      case 'dispatched': return this._renderDispatchedCard(advice);
      case 'completed': return this._renderCompletedCard(advice);
      case 'failed': return this._renderFailedCard(advice);
      default: return this._renderPendingCard(advice);
    }
  }

  /**
   * 渲染已处理建议历史栏
   */
  _renderHistory() {
    if (!this._historyAdvices || this._historyAdvices.length === 0) return '';

    const items = this._historyAdvices.map(a => {
      const statusLabel = { completed: t('advice.status.completed'), dismissed: t('advice.status.dismissed'), failed: t('advice.status.failed') }[a.status] || a.status;
      const statusClass = a.status || 'dismissed';
      const isDismissed = a.status === 'dismissed';
      return `
        <div class="ai-advice-history-item">
          <span class="status-tag ${escape(statusClass)}">${escape(statusLabel)}</span>
          <span>${escape(a.title)}</span>
          ${isDismissed ? `<button class="ai-advice-reactivate-btn" data-action="reactivate" data-id="${escape(a.id)}">${t('advice.reactivate')}</button>` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="ai-advice-history">
        <button class="ai-advice-history-toggle" data-action="toggle-history">
          <span class="ai-advice-history-arrow ${this._historyExpanded ? 'expanded' : ''}">\u25B6</span>
          <span>\u{1F4DC} ${t('advice.history_title', { count: this._historyAdvices.length })}</span>
        </button>
        ${this._historyExpanded ? `<div class="ai-advice-history-list">${items}</div>` : ''}
      </div>
    `;
  }

  /**
   * 绑定事件
   */
  _bindEvents() {
    this._el.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        const advice = this._advices.find(a => a.id === id);

        if (action === 'refresh' && this._onRefresh) {
          this._onRefresh();
        } else if (action === 'dispatch' && this._onDispatch) {
          this._onDispatch(advice);
        } else {
          // 空值守卫
          if (!advice) return;
        }

        if (action === 'dismiss' && this._onDismiss) {
          // 先从 UI 移除（乐观更新），持久化由 onDismiss 回调完成
          this._advices = this._advices.filter(a => a.id !== id);
          this._render();
          this._onDismiss(advice);
        } else if (action === 'redispatch' && this._onRedispatch) {
          this._onRedispatch(advice);
        } else if (action === 'redispatch' && this._onDispatch) {
          // fallback: 没有专门的 redispatch 回调时用 dispatch
          this._onDispatch(advice);
        } else if (action === 'reactivate' && this._onReactivate) {
          const historyAdvice = this._historyAdvices.find(a => a.id === id);
          if (historyAdvice) this._onReactivate(historyAdvice);
        } else if (action === 'toggle-history') {
          this._historyExpanded = !this._historyExpanded;
          this._render();
        }
      });
    });
    // toggle-history 按钮不在 [data-action] 循环内时的兜底
    const toggleBtn = this._el.querySelector('[data-action="toggle-history"]');
    if (toggleBtn && !toggleBtn._bound) {
      toggleBtn._bound = true;
      toggleBtn.addEventListener('click', () => {
        this._historyExpanded = !this._historyExpanded;
        this._render();
      });
    }
  }

  /**
   * 销毁组件
   */
  destroy() {
    if (this._el && this._el.parentNode) {
      this._el.parentNode.removeChild(this._el);
    }
    this._el = null;
  }
}
