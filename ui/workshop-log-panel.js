// ui/workshop-log-panel.js — 工坊日志面板组件

const MAX_ENTRIES = 200;

const TYPE_COLORS = {
  lifecycle: 'var(--accent-cyan)',
  success:   'var(--accent-green)',
  warn:      'var(--accent-yellow)',
  error:     'var(--accent-red)',
  info:      'var(--text-dim)',
};

export class WorkshopLogPanel {
  constructor(container) {
    this.entries = [];
    this._collapsed = false;
    this._userScrolled = false;
    this._serverMode = false;
    this._logCursor = null;

    // 高度拉伸相关
    this._isResizing = false;
    this._startY = 0;
    this._startHeight = 0;
    this._minHeight = 150;
    this._maxHeight = 600;

    // Root element
    this.el = document.createElement('div');
    this.el.className = 'workshop-log-panel';

    // Header
    this._header = document.createElement('div');
    this._header.className = 'workshop-log-panel-header';
    this._header.innerHTML = `
      <span class="workshop-log-panel-title">📋 工坊日志</span>
      <span class="workshop-log-panel-count">0</span>
      <button class="workshop-log-panel-source" title="切换本地/服务端日志">本地</button>
      <button class="workshop-log-panel-toggle" title="折叠/展开">&#9660;</button>
    `;
    this._header.querySelector('.workshop-log-panel-toggle').addEventListener('click', () => this.toggle());
    this._header.querySelector('.workshop-log-panel-source').addEventListener('click', () => this.setServerMode(!this._serverMode));
    this.el.appendChild(this._header);

    // Resize handle (拖拽调整高度)
    this._resizeHandle = document.createElement('div');
    this._resizeHandle.className = 'workshop-log-panel-resize-handle';
    this._resizeHandle.addEventListener('mousedown', (e) => this._startResize(e));
    this.el.appendChild(this._resizeHandle);

    // Body (scrollable log list)
    this._body = document.createElement('div');
    this._body.className = 'workshop-log-panel-body';
    this._body.addEventListener('scroll', () => this._onScroll());
    this.el.appendChild(this._body);

    container.appendChild(this.el);
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
    row.className = 'workshop-log-entry';
    row.innerHTML = `<span class="workshop-log-ts">${ts}</span><span class="workshop-log-bar" style="background:${TYPE_COLORS[type] || TYPE_COLORS.info}"></span><span class="workshop-log-msg">${_esc(message)}</span>`;
    this._body.appendChild(row);

    // Update count
    this._header.querySelector('.workshop-log-panel-count').textContent = this.entries.length;

    // Auto-scroll (only if user hasn't scrolled up)
    if (!this._userScrolled) {
      this._body.scrollTop = this._body.scrollHeight;
    }
  }

  clear() {
    this.entries = [];
    this._body.innerHTML = '';
    this._header.querySelector('.workshop-log-panel-count').textContent = '0';
  }

  toggle() {
    this._collapsed = !this._collapsed;
    this.el.classList.toggle('collapsed', this._collapsed);
    this._header.querySelector('.workshop-log-panel-toggle').innerHTML = this._collapsed ? '&#9650;' : '&#9660;';
  }

  setServerMode(enabled) {
    this._serverMode = enabled;
    const btn = this._header.querySelector('.workshop-log-panel-source');
    if (btn) btn.textContent = enabled ? '服务端' : '本地';
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

  // ============================================================
  // 高度拉伸功能
  // ============================================================

  _startResize(e) {
    e.preventDefault();
    this._isResizing = true;
    this._startY = e.clientY;
    this._startHeight = this.el.offsetHeight;

    document.addEventListener('mousemove', (e) => this._doResize(e));
    document.addEventListener('mouseup', () => this._stopResize(), { once: true });
  }

  _doResize(e) {
    if (!this._isResizing) return;

    const deltaY = this._startY - e.clientY; // 向上为正
    let newHeight = this._startHeight + deltaY;

    // 限制高度范围
    newHeight = Math.max(this._minHeight, Math.min(this._maxHeight, newHeight));

    this.el.style.height = `${newHeight}px`;
  }

  _stopResize() {
    this._isResizing = false;
    document.removeEventListener('mousemove', (e) => this._doResize(e));
  }
}

function _pad(n) {
  return n < 10 ? '0' + n : String(n);
}

function _esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

WorkshopLogPanel.prototype.destroy = function() {
  // 从 DOM 中移除
  if (this.el && this.el.parentNode) {
    this.el.parentNode.removeChild(this.el);
  }
};

