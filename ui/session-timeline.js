// ui/session-timeline.js — 会话步骤时间线面板
// 展示选中 session 的 StepState 列表（LLM / Tool / Error 分类）

export class SessionTimeline {
  constructor(container) {
    this.el = document.createElement('div');
    this.el.className = 'session-timeline';
    container.appendChild(this.el);
    this._sessionId = null;
    this._sessionKey = null;
    this._steps = [];
    this._visible = false;
  }

  /**
   * 显示指定 session 的时间线
   * @param {string} sessionId
   * @param {Array} steps - StepState[]
   * @param {string|null} sessionKey
   */
  show(sessionId, steps = [], sessionKey = null) {
    this._sessionId = sessionId;
    this._sessionKey = sessionKey;
    this._steps = steps;
    this._visible = true;
    this.el.classList.add('open');
    this._render();
  }

  /** 更新步骤数据（增量刷新） */
  update(steps) {
    this._steps = steps;
    if (this._visible) this._render();
  }

  hide() {
    this._visible = false;
    this._sessionId = null;
    this._sessionKey = null;
    this.el.classList.remove('open');
  }

  get visible() { return this._visible; }
  get sessionId() { return this._sessionId; }
  get sessionKey() { return this._sessionKey; }

  /** 追加单个步骤（推送事件用） */
  appendStep(step) {
    this._steps.push(step);
    if (this._visible) this._render();
  }

  _render() {
    if (!this._steps.length) {
      this.el.innerHTML = `
        <div class="timeline-header">
          <span class="timeline-title">会话时间线</span>
          <button class="timeline-close">&times;</button>
        </div>
        <div class="timeline-empty">暂无步骤</div>
      `;
      this._bindClose();
      return;
    }

    let html = `
      <div class="timeline-header">
        <span class="timeline-title">会话时间线</span>
        <span class="timeline-count">${this._steps.length} 步</span>
        <button class="timeline-close">&times;</button>
      </div>
      <div class="timeline-list">
    `;

    for (const step of this._steps) {
      const icon = stepIcon(step.type);
      const cls = stepClass(step.type);
      const time = formatTime(step.timestamp);
      const duration = step.durationMs ? ` · ${step.durationMs}ms` : '';

      html += `
        <div class="timeline-item ${cls}">
          <span class="timeline-icon">${icon}</span>
          <div class="timeline-body">
            <div class="timeline-summary">${escape(step.summary)}</div>
            <div class="timeline-meta">${time}${duration}</div>
          </div>
        </div>
      `;
    }

    html += '</div>';
    this.el.innerHTML = html;
    this._bindClose();

    // 自动滚动到底部
    const list = this.el.querySelector('.timeline-list');
    if (list) list.scrollTop = list.scrollHeight;
  }

  _bindClose() {
    const btn = this.el.querySelector('.timeline-close');
    if (btn) btn.addEventListener('click', () => this.hide());
  }
}

// ============================================================
// 工具函数
// ============================================================

function stepIcon(type) {
  switch (type) {
    case 'llm_input':   return '\u{1F4AC}'; // 💬
    case 'llm_output':  return '\u{2728}';   // ✨
    case 'tool_call':   return '\u{1F527}';  // 🔧
    case 'tool_result': return '\u{2705}';   // ✅
    case 'error':       return '\u{26A0}';   // ⚠
    case 'subagent':    return '\u{1F916}';  // 🤖
    default:            return '\u{25CF}';   // ●
  }
}

function stepClass(type) {
  switch (type) {
    case 'llm_input':
    case 'llm_output':  return 'step-llm';
    case 'tool_call':
    case 'tool_result': return 'step-tool';
    case 'error':       return 'step-error';
    case 'subagent':    return 'step-sub';
    default:            return '';
  }
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

function escape(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
