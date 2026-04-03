// ui/cron-runs-view.js — Cron 运行日志子视图
// 嵌入 CronDialog 弹窗内，展示指定 Job 的运行历史

import { t } from '../i18n/index.js';
import { CronApi } from '../bridge/cron-api.js';

export class CronRunsView {
  /**
   * @param {HTMLElement} container - 渲染容器
   * @param {import('../bridge/gateway-client.js').GatewayClient} gateway
   * @param {Object} [callbacks]
   * @param {function} [callbacks.onNavigateToChat] - 点击会话链接
   */
  constructor(container, gateway, callbacks = {}) {
    this._container = container;
    this._api = new CronApi(gateway);
    this._callbacks = callbacks;
    this._jobId = null;
    this._runs = [];
    this._total = 0;
    this._offset = 0;
    this._limit = 20;
    this._hasMore = false;
    this._loading = false;
    this._statusFilter = 'all'; // all | ok | error | skipped
  }

  /** 更新渲染容器 */
  setContainer(el) {
    this._container = el;
  }

  /** 加载指定 Job 的运行日志 */
  async load(jobId) {
    this._jobId = jobId;
    this._runs = [];
    this._offset = 0;
    this._hasMore = false;
    this._statusFilter = 'all';
    await this._fetch();
    this._render();
  }

  /** 加载更多 */
  async loadMore() {
    if (!this._hasMore || this._loading) return;
    await this._fetch(true);
    this._render();
  }

  // ============================================================
  // 内部
  // ============================================================

  async _fetch(append = false) {
    if (!this._jobId) return;
    this._loading = true;

    try {
      const opts = {
        scope: 'job',
        id: this._jobId,
        limit: this._limit,
        offset: append ? this._offset : 0,
        sortDir: 'desc',
      };

      if (this._statusFilter !== 'all') {
        opts.statuses = [this._statusFilter];
      }

      const res = await this._api.runs(opts);
      const entries = res?.entries || res?.runs || [];
      this._total = res?.total || 0;

      if (append) {
        this._runs = this._runs.concat(entries);
      } else {
        this._runs = entries;
      }

      this._offset = this._runs.length;
      this._hasMore = this._runs.length < this._total;
    } catch (err) {
      console.error('[CronRunsView] fetch failed:', err);
    } finally {
      this._loading = false;
    }
  }

  _render() {
    if (!this._container) return;

    const filterHtml = `
      <div class="cron-runs-filters">
        <div class="cron-runs-filter-group">
          ${['all', 'ok', 'error', 'skipped'].map(s => `
            <button class="cron-runs-filter-btn ${this._statusFilter === s ? 'active' : ''}" data-status="${s}">
              ${t(`cron.runs.filter.${s}`)}
            </button>
          `).join('')}
        </div>
      </div>
    `;

    const listHtml = this._runs.length === 0
      ? `<div class="cron-runs-empty">${t('cron.runs.empty')}</div>`
      : `<div class="cron-runs-list">${this._runs.map(r => this._renderEntry(r)).join('')}</div>`;

    const moreHtml = this._hasMore
      ? `<div class="cron-load-more"><button class="cron-btn cron-btn-small" data-action="load-more">${t('cron.runs.load_more')}</button></div>`
      : '';

    this._container.innerHTML = filterHtml + listHtml + moreHtml;
    this._bindEvents();
  }

  _renderEntry(run) {
    const status = run.status || run.lastRunStatus || 'unknown';
    const chipClass = status === 'ok' ? 'cron-chip-ok'
                    : status === 'error' ? 'cron-chip-error'
                    : 'cron-chip-skipped';

    const statusLabel = status === 'ok' ? '✔ OK'
                      : status === 'error' ? '✖ Error'
                      : status === 'skipped' ? '⚠ Skipped'
                      : '– Unknown';

    const time = run.startedAtMs || run.ranAtMs || run.lastRunAtMs;
    const timeStr = time ? new Date(time).toLocaleString() : '--';
    const duration = run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : '--';
    const summary = this._esc(run.summary || run.error || '');
    const sessionKey = run.sessionKey || '';

    return `
      <div class="cron-run-entry">
        <div class="cron-run-header">
          <span class="cron-run-title">${timeStr}</span>
          <span class="cron-chip ${chipClass}">${statusLabel}</span>
        </div>
        ${summary ? `<div class="cron-run-summary">${summary}</div>` : ''}
        <div class="cron-run-meta">
          <span>⏱ ${t('cron.runs.duration')}: ${duration}</span>
          ${run.scheduledAtMs ? `<span>📅 ${t('cron.runs.scheduled')}: ${new Date(run.scheduledAtMs).toLocaleString()}</span>` : ''}
          ${sessionKey ? `<span class="cron-run-session-link" data-session="${this._esc(sessionKey)}">💬 ${t('cron.runs.view_session')}</span>` : ''}
        </div>
        ${run.error && status === 'error' ? `<div class="cron-run-error">${this._esc(run.error)}</div>` : ''}
      </div>
    `;
  }

  _bindEvents() {
    if (!this._container) return;

    // 过滤器点击
    this._container.querySelectorAll('.cron-runs-filter-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          this._statusFilter = btn.dataset.status;
          this._offset = 0;
          await this._fetch();
          this._render();
        } catch (err) {
          console.error('[CronRunsView] filter click failed:', err);
        }
      });
    });

    // 加载更多
    const moreBtn = this._container.querySelector('[data-action="load-more"]');
    moreBtn?.addEventListener('click', () => this.loadMore());

    // 会话跳转
    this._container.querySelectorAll('.cron-run-session-link').forEach(link => {
      link.addEventListener('click', () => {
        const key = link.dataset.session;
        if (key) this._callbacks.onNavigateToChat?.(key);
      });
    });
  }

  _esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
