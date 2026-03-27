// ui/log-panel.js — 插件生命周期日志面板

import { t, onLocaleChange } from '../i18n/index.js';

const MAX_ENTRIES = 200;

const TYPE_COLORS = {
  lifecycle: 'var(--accent-cyan)',
  success:   'var(--accent-green)',
  warn:      'var(--accent-yellow)',
  error:     'var(--accent-red)',
  info:      'var(--text-dim)',
};

export class LogPanel {
  constructor(container) {
    this.entries = [];
    this._collapsed = false;
    this._userScrolled = false;
    this._serverMode = false;
    this._logCursor = null;

    // Root element
    this.el = document.createElement('div');
    this.el.className = 'log-panel';

    // Header
    this._header = document.createElement('div');
    this._header.className = 'log-panel-header';
    this._renderHeader();
    
    this._header.addEventListener('click', (e) => {
      const toggleBtn = e.target.closest('.log-panel-toggle');
      if (toggleBtn) {
        this.toggle();
        return;
      }
      const sourceBtn = e.target.closest('.log-panel-source');
      if (sourceBtn) {
        this.setServerMode(!this._serverMode);
        return;
      }
    });
    this.el.appendChild(this._header);

    // 订阅语言变更
    this._unsubscribeLocale = onLocaleChange(() => {
      this._renderHeader();
      this.setServerMode(this._serverMode); // 更新按钮文案
    });

    // Body (scrollable log list)
    this._body = document.createElement('div');
    this._body.className = 'log-panel-body';
    this._body.addEventListener('scroll', () => this._onScroll());
    this.el.appendChild(this._body);

    container.appendChild(this.el);
  }

  _renderHeader() {
    this._header.innerHTML = `
      <span class="log-panel-title">${t('log.title')}</span>
      <span class="log-panel-count">${this.entries.length}</span>
      <button class="log-panel-source" title="${t('log.tooltip_source')}">${this._serverMode ? t('log.source_server') : t('log.source_local')}</button>
      <button class="log-panel-toggle" title="${t('log.tooltip_toggle')}">${this._collapsed ? '&#9650;' : '&#9660;'}</button>
    `;
  }

  /**
   * @param {'info'|'success'|'warn'|'error'|'lifecycle'} type
   * @param {string} message
   */
  log(type, message) {
    const now = new Date();
    const ts = _pad(now.getHours()) + ':' + _pad(now.getMinutes()) + ':' + _pad(now.getSeconds());

    const entry = { type, message, ts };
    this.entries.push(entry);

    // FIFO
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
      if (this._body.firstChild) this._body.removeChild(this._body.firstChild);
    }

    // Append DOM
    const row = document.createElement('div');
    row.className = 'log-entry';
    row.innerHTML = `<span class="log-ts">${ts}</span><span class="log-bar" style="background:${TYPE_COLORS[type] || TYPE_COLORS.info}"></span><span class="log-msg">${_esc(message)}</span>`;
    this._body.appendChild(row);

    // Update count
    this._header.querySelector('.log-panel-count').textContent = this.entries.length;

    // Auto-scroll (only if user hasn't scrolled up)
    if (!this._userScrolled) {
      this._body.scrollTop = this._body.scrollHeight;
    }
  }

  clear() {
    this.entries = [];
    this._body.innerHTML = '';
    this._header.querySelector('.log-panel-count').textContent = '0';
  }

  toggle() {
    this._collapsed = !this._collapsed;
    this.el.classList.toggle('collapsed', this._collapsed);
    this._header.querySelector('.log-panel-toggle').innerHTML = this._collapsed ? '&#9650;' : '&#9660;';
  }

  setServerMode(enabled) {
    this._serverMode = enabled;
    const btn = this._header.querySelector('.log-panel-source');
    if (btn) btn.textContent = enabled ? t('log.source_server') : t('log.source_local');
  }

  appendServerLogs(lines) {
    for (const line of lines) {
      this.log('info', `[server] ${line}`);
    }
  }

  _onScroll() {
    const el = this._body;
    // If user is near bottom (within 30px), re-enable auto-scroll
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    this._userScrolled = !atBottom;
  }

  destroy() {
    if (this._unsubscribeLocale) {
      this._unsubscribeLocale();
    }
  }
}

function _pad(n) {
  return n < 10 ? '0' + n : String(n);
}

function _esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
