// ui/schedule-panel.js — 定时任务侧边栏面板
// 数据来源：DataRouter.getCronJobsForPanel()（对接 cron.list API）
// 右侧 sticky 浮动，支持折叠/展开

import { t } from '../i18n/index.js';

export class SchedulePanel {
  /**
   * @param {HTMLElement} container - 挂载容器（workshop-view 元素）
   * @param {Object} [callbacks]
   * @param {function} [callbacks.onAdd] - 点击「+」新增按钮回调
   * @param {function} [callbacks.onEdit] - 点击列表项回调，参数为 jobId
   */
  constructor(container, callbacks = {}) {
    this._container = container;
    this._collapsed = false;
    this._schedules = [];
    this._onAdd = callbacks.onAdd || null;
    this._onEdit = callbacks.onEdit || null;

    this.el = document.createElement('aside');
    this.el.className = 'schedule-sidebar';
    this._container.appendChild(this.el);

    this._render();
    this._bindEvents();
  }

  /** 显示面板 */
  show() {
    this.el.style.display = '';
  }

  /** 隐藏面板 */
  hide() {
    this.el.style.display = 'none';
  }

  /** 刷新数据并重新渲染 */
  refresh(schedules) {
    if (schedules) {
      this._schedules = schedules;
    }
    this._renderList();
  }

  /** 销毁面板 */
  destroy() {
    this.el.remove();
  }

  // ============================================================
  // 渲染
  // ============================================================

  _render() {
    this.el.innerHTML = `
      <h3 class="schedule-sidebar-title">
        <span>${t('schedule.title')}</span>
        <span class="schedule-add-btn" title="${t('schedule.add')}">＋</span>
        <span class="schedule-collapse-btn">▲</span>
      </h3>
      <div class="schedule-list"></div>
    `;
    this._renderList();
  }

  _renderList() {
    const listEl = this.el.querySelector('.schedule-list');
    if (!listEl) return;

    if (this._schedules.length === 0) {
      listEl.innerHTML = `<div class="schedule-sidebar-empty">${t('schedule.empty')}</div>`;
      return;
    }

    listEl.innerHTML = this._schedules.map(item => {
      const statusIcon = item.lastStatus === 'ok'      ? `<span class="cron-status ok" title="${t('schedule.status.ok')}">✔</span>`
                       : item.lastStatus === 'error'   ? `<span class="cron-status error" title="${t('schedule.status.error')}">✖</span>`
                       : item.lastStatus === 'skipped' ? `<span class="cron-status skipped" title="${t('schedule.status.skipped')}">⚠</span>`
                       : `<span class="cron-status none" title="${t('schedule.status.none')}">–</span>`;
      const runningBadge = item.running ? '<span class="cron-running-dot"></span>' : '';
      const tagLabel = item.type === 'one-time' ? t('schedule.tag.onetime') : t('schedule.tag.recurring');
      const timePrefix = item.type === 'one-time' ? '' : t('schedule.next_run');
      const disabledClass = item.enabled === false ? ' disabled' : '';

      return `
        <div class="schedule-item ${item.type}${disabledClass}" data-id="${this._esc(item.id)}">
          ${runningBadge}
          <div class="schedule-time-marker"></div>
          <div class="schedule-item-content">
            <div class="schedule-item-title">${this._esc(item.title)}</div>
            <div class="schedule-item-time">
              <span class="schedule-tag ${item.type}">${tagLabel}</span>
              <span>${timePrefix}${item.nextRun}</span>
              ${statusIcon}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ============================================================
  // 事件
  // ============================================================

  _bindEvents() {
    this.el.addEventListener('click', (e) => {
      // 「+」按钮
      const addBtn = e.target.closest('.schedule-add-btn');
      if (addBtn) {
        e.stopPropagation();
        this._onAdd?.();
        return;
      }

      // 折叠按钮
      const collapseBtn = e.target.closest('.schedule-collapse-btn');
      if (collapseBtn) {
        e.stopPropagation();
        this._toggleCollapse();
        return;
      }

      // 标题栏（非按钮区域）也触发折叠
      const titleEl = e.target.closest('.schedule-sidebar-title');
      if (titleEl && !addBtn) {
        this._toggleCollapse();
        return;
      }

      // 列表项点击 → 编辑
      const item = e.target.closest('.schedule-item');
      if (item) {
        const jobId = item.dataset.id;
        if (jobId) this._onEdit?.(jobId);
      }
    });
  }

  _toggleCollapse() {
    this._collapsed = !this._collapsed;
    this.el.classList.toggle('collapsed', this._collapsed);
  }

  /** HTML 特殊字符转义，防止 XSS */
  _esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
