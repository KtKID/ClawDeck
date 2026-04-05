// ui/today-timeline-panel.js — 今日时间线 DOM 面板
// 展示基于事件流的今日时间线与底部摘要条。

import { todayTasks, getTickerEvents } from './today-timeline-data.js';
import { escape } from './utils.js';
import { t } from '../i18n/index.js';

export class TodayTimelinePanel {
  /**
   * @param {HTMLElement} container - 挂载容器（section.today-tl-section）
   */
  constructor(container) {
    this._container = container;
    this._tasks = todayTasks;
    this._ticker = getTickerEvents();
    this._modalElements = null;
    this._bodyOverflow = '';
    this._bindEvents();
    this._render();
  }

  /** 更新事件数据并重新渲染（未来接真实数据时调用） */
  update(tasks, ticker) {
    if (tasks) this._tasks = tasks;
    if (ticker) this._ticker = ticker;
    this._render();
  }

  _render() {
    this._closeModal();
    this._ticker = getTickerEvents(); // 刷新 ticker 文案（语言可能已切换）
    const count = this._tasks.length;
    const stats = this._buildStats(this._tasks);

    this._container.innerHTML = `
      <div class="today-tl-header">
        <div>
          <span class="today-tl-title">${t('timeline.title')}</span>
          <div class="today-tl-subtitle">${t('timeline.subtitle')}</div>
        </div>
        <div class="today-tl-stats">
          <span class="today-tl-count total">${t('timeline.count_total', { count })}</span>
          <span class="today-tl-count success">✓ ${t('timeline.count_success', { count: stats.success })}</span>
          <span class="today-tl-count current">◐ ${t('timeline.count_current', { count: stats.current })}</span>
          <span class="today-tl-count warning">⚠ ${t('timeline.count_warning', { count: stats.warning })}</span>
        </div>
      </div>
      ${count === 0 ? this._renderEmpty() : this._renderTimeline()}
      ${this._renderTicker()}
      ${this._renderModal()}
    `;
    this._cacheModalElements();
  }

  _buildStats(tasks) {
    return tasks.reduce((acc, task) => {
      if (acc[task.statusTone] !== undefined) {
        acc[task.statusTone] += 1;
      }
      return acc;
    }, {
      success: 0,
      current: 0,
      warning: 0,
      pending: 0,
    });
  }

  _renderEmpty() {
    return `<div class="today-tl-empty">${t('timeline.empty')}</div>`;
  }

  _renderTimeline() {
    const items = this._tasks.map((task, index) => this._renderItem(task, index)).join('');
    return `
      <div class="today-tl-container">
        <div class="today-tl-track">
          ${items}
        </div>
      </div>
    `;
  }

  _renderItem(task, index) {
    const tone = this._normalizeTone(task.statusTone);
    const fullTitle = this._resolveText(task.title, task.summary, t('timeline.unnamed_event'));
    const shortTitle = fullTitle.length > 5 ? fullTitle.slice(0, 5) + '...' : fullTitle;
    const actor = this._resolveText(task.actorName, '', t('timeline.unknown_partner'));
    const actorEmoji = task.actorEmoji || '🛰️';
    const statusLabel = this._resolveText(task.statusLabel, '', t('timeline.processing'));

    return `
      <div class="today-tl-item" data-task-index="${index}">
        <div class="today-tl-node ${escape(tone)}"></div>
        <div class="today-tl-time">${escape(task.time || '--:--')}</div>
        <div class="today-tl-card-wrapper">
          <div class="today-tl-card ${escape(tone)}" data-task-index="${index}">
            <div class="today-tl-card-title" title="${escape(fullTitle)}">${escape(shortTitle)}</div>
            <div class="today-tl-card-meta">
              <span class="today-tl-card-status-pill ${escape(tone)}">${escape(statusLabel)}</span>
              <span class="today-tl-card-owner" title="${escape(actor)}">${escape(actorEmoji)} <span class="owner-name">${escape(actor)}</span></span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _renderModal() {
    return `
      <div class="today-tl-modal-overlay" data-role="timeline-modal" aria-hidden="true">
        <div class="today-tl-modal" role="dialog" aria-modal="true">
          <div class="today-tl-modal-header">
            <div class="today-tl-modal-title-row" data-role="modal-title-row">
              <div class="today-tl-modal-icon" data-role="modal-icon"></div>
              <div class="today-tl-modal-title-info">
                <h3 class="today-tl-modal-title" data-role="modal-title"></h3>
                <span class="today-tl-modal-status" data-role="modal-status"></span>
              </div>
            </div>
            <button class="today-tl-modal-close" data-role="modal-close" aria-label="Close">&times;</button>
          </div>
          <div class="today-tl-modal-body">
            <div class="today-tl-modal-section">
              <div class="today-tl-modal-section-title">${t('timeline.modal.info')}</div>
              <div class="today-tl-modal-info-grid">
                <div class="today-tl-modal-info-item">
                  <div class="today-tl-modal-info-label">${t('timeline.modal.time')}</div>
                  <div class="today-tl-modal-info-value" data-role="modal-time"></div>
                </div>
                <div class="today-tl-modal-info-item">
                  <div class="today-tl-modal-info-label">${t('timeline.modal.owner')}</div>
                  <div class="today-tl-modal-info-value" data-role="modal-owner"></div>
                </div>
                <div class="today-tl-modal-info-item">
                  <div class="today-tl-modal-info-label">${t('timeline.modal.session')}</div>
                  <div class="today-tl-modal-info-value mono" data-role="modal-session"></div>
                </div>
                <div class="today-tl-modal-info-item">
                  <div class="today-tl-modal-info-label">${t('timeline.modal.status')}</div>
                  <div class="today-tl-modal-info-value" data-role="modal-status-text"></div>
                </div>
              </div>
            </div>
            <div class="today-tl-modal-section">
              <div class="today-tl-modal-section-title">${t('timeline.modal.content')}</div>
              <div class="today-tl-modal-content-text" data-role="modal-content"></div>
            </div>
          </div>
          <div class="today-tl-modal-footer">
            <button class="today-tl-modal-btn secondary" data-role="modal-cancel">${t('timeline.modal.close')}</button>
          </div>
        </div>
      </div>
    `;
  }

  _normalizeTone(tone) {
    if (tone === 'success' || tone === 'current' || tone === 'warning' || tone === 'pending') {
      return tone;
    }
    return 'pending';
  }

  _resolveText(primary, secondary, fallback) {
    return [primary, secondary, fallback].find(value => value && String(value).trim()) || fallback;
  }

  _bindEvents() {
    this._handleContainerClick = (event) => {
      const card = event.target.closest('.today-tl-card');
      if (card && this._container.contains(card)) {
        const index = Number(card.dataset.taskIndex);
        if (!Number.isNaN(index) && this._tasks[index]) {
          this._openModal(this._tasks[index]);
        }
        return;
      }

      const closeBtn = event.target.closest('[data-role="modal-close"]');
      const cancelBtn = event.target.closest('[data-role="modal-cancel"]');
      if (closeBtn || cancelBtn) {
        this._closeModal();
        return;
      }

      const overlay = this._modalElements?.overlay;
      if (overlay && event.target === overlay) {
        this._closeModal();
      }
    };

    this._handleKeydown = (event) => {
      if (event.key === 'Escape' && this._modalElements?.overlay?.classList.contains('is-active')) {
        this._closeModal();
      }
    };

    this._container.addEventListener('click', this._handleContainerClick);
    document.addEventListener('keydown', this._handleKeydown);
  }

  _cacheModalElements() {
    this._modalElements = {
      overlay: this._container.querySelector('.today-tl-modal-overlay'),
      titleRow: this._container.querySelector('[data-role="modal-title-row"]'),
      icon: this._container.querySelector('[data-role="modal-icon"]'),
      title: this._container.querySelector('[data-role="modal-title"]'),
      status: this._container.querySelector('[data-role="modal-status"]'),
      time: this._container.querySelector('[data-role="modal-time"]'),
      owner: this._container.querySelector('[data-role="modal-owner"]'),
      session: this._container.querySelector('[data-role="modal-session"]'),
      statusText: this._container.querySelector('[data-role="modal-status-text"]'),
      content: this._container.querySelector('[data-role="modal-content"]'),
    };
  }

  _resolveStatusMeta(tone, label) {
    const map = {
      success: { className: 'success', icon: '✓', fallback: t('timeline.status.success') },
      current: { className: 'current', icon: '◐', fallback: t('timeline.status.current') },
      warning: { className: 'warning', icon: '⚠', fallback: t('timeline.status.warning') },
      pending: { className: 'pending', icon: '○', fallback: t('timeline.status.unknown') },
    };
    const meta = map[tone] || map.pending;
    return {
      className: meta.className,
      icon: meta.icon,
      text: this._resolveText(label, meta.fallback, meta.fallback),
    };
  }

  _openModal(task) {
    if (!this._modalElements?.overlay) return;

    const tone = this._normalizeTone(task.statusTone);
    const title = this._resolveText(task.title, task.summary, t('timeline.unnamed_event'));
    const ownerName = this._resolveText(task.actorName, '', t('timeline.unknown_partner'));
    const ownerEmoji = task.actorEmoji || '';
    const owner = [ownerEmoji, ownerName].filter(Boolean).join(' ').trim();
    const sessionId = this._resolveText(task.sessionId, task.id, 'N/A');
    const content = this._resolveText(task.content, task.summary, task.triggerLabel || t('timeline.modal.no_details'));
    const statusMeta = this._resolveStatusMeta(tone, task.statusLabel);

    this._modalElements.title.textContent = title;
    this._modalElements.time.textContent = task.time || '--:--';
    this._modalElements.owner.textContent = owner || t('timeline.unknown_partner');
    this._modalElements.session.textContent = sessionId;
    this._modalElements.statusText.textContent = statusMeta.text;

    if (window.MarkdownRenderer) {
      this._modalElements.content.innerHTML = window.MarkdownRenderer.render(content);
      this._modalElements.content.classList.add('markdown-content');
      window.MarkdownRenderer.bind(this._modalElements.content);
    } else {
      this._modalElements.content.textContent = content;
    }

    this._modalElements.status.textContent = `${statusMeta.icon} ${statusMeta.text}`;
    this._modalElements.status.className = `today-tl-modal-status ${statusMeta.className}`;
    this._modalElements.icon.textContent = statusMeta.icon;

    this._modalElements.titleRow.className = 'today-tl-modal-title-row';
    this._modalElements.titleRow.classList.add(`is-${statusMeta.className}`);

    const wasActive = this._modalElements.overlay.classList.contains('is-active');
    this._modalElements.overlay.classList.add('is-active');
    this._modalElements.overlay.setAttribute('aria-hidden', 'false');
    if (!wasActive) {
      this._bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
  }

  _closeModal() {
    if (!this._modalElements?.overlay) return;
    this._modalElements.overlay.classList.remove('is-active');
    this._modalElements.overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = this._bodyOverflow || '';
  }

  _renderTicker() {
    if (!this._ticker || this._ticker.length === 0) return '';

    const items = this._ticker.map(ev => `
      <span class="today-tl-ticker-item">
        <span class="today-tl-ticker-dot ${escape(ev.type)}"></span>
        ${escape(ev.text)}
      </span>
    `).join('');

    return `
      <div class="today-tl-ticker">
        <div class="today-tl-ticker-label">${t('timeline.ticker.label')}</div>
        <div class="today-tl-ticker-content">
          ${items}
        </div>
      </div>
    `;
  }
}
