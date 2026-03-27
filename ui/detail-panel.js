// ui/detail-panel.js — Right-side detail panel for selected entities

export class DetailPanel {
  constructor(container) {
    this.el = document.createElement('div');
    this.el.className = 'detail-panel';
    container.appendChild(this.el);
    this._currentEntity = null;
    this._onAction = null;
    this._telemetryManager = null;
    this._currentTab = 'overview';
    this._updateInterval = null;
  }

  /**
   * Set telemetry manager for metrics display
   * @param {TelemetryManager} manager - Telemetry manager instance
   */
  setTelemetryManager(manager) {
    this._telemetryManager = manager;
    return this;
  }

  show(entity, actions = []) {
    this._currentEntity = entity;
    this.el.classList.add('open');

    // Tab header
    let html = `
      <h3>${this._escape(entity.label || entity.type)}</h3>
      <div class="tab-bar">
        <button class="tab-btn ${this._currentTab === 'overview' ? 'active' : ''}" data-tab="overview">Overview</button>
        <button class="tab-btn ${this._currentTab === 'metrics' ? 'active' : ''}" data-tab="metrics">Metrics</button>
      </div>
      <div class="tab-content">
    `;

    // Render current tab
    if (this._currentTab === 'overview') {
      html += this._renderOverview(entity, actions);
    } else if (this._currentTab === 'metrics') {
      html += this._renderMetrics(entity);
    }

    html += '</div>';
    this.el.innerHTML = html;

    // Bind tab buttons
    this.el.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._currentTab = btn.dataset.tab;
        this.show(this._currentEntity, actions);
      });
    });

    // Bind action buttons
    this.el.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (this._onAction) this._onAction(btn.dataset.action, this._currentEntity);
      });
    });

    // Start auto-update for metrics tab
    this._startAutoUpdate(entity);
  }

  hide() {
    this.el.classList.remove('open');
    this._currentEntity = null;
    this._stopAutoUpdate();
  }

  onAction(fn) {
    this._onAction = fn;
  }

  _renderOverview(entity, actions) {
    let html = '';

    // Fields based on entity type
    const fields = this._getFields(entity);
    for (const [label, value] of fields) {
      html += `
        <div class="field">
          <div class="field-label">${this._escape(label)}</div>
          <div class="field-value">${this._escape(String(value))}</div>
        </div>`;
    }

    // Action buttons
    if (actions.length > 0) {
      html += '<div class="actions">';
      for (const action of actions) {
        const cls = action.danger ? 'btn btn-danger' : 'btn';
        html += `<button class="${cls}" data-action="${this._escape(action.id)}">${this._escape(action.label)}</button>`;
      }
      html += '</div>';
    }

    return html;
  }

  _renderMetrics(entity) {
    if (!this._telemetryManager) {
      return '<div class="metrics-empty">No telemetry data available</div>';
    }

    const sessionId = entity.data?.sessionId || entity.id;
    const tracker = this._telemetryManager.getSession(sessionId);

    if (!tracker) {
      return '<div class="metrics-empty">No active session</div>';
    }

    const stats = tracker.stats;
    const events = tracker.events.slice(-10); // Last 10 events

    let html = '';

    // Token usage section
    html += `
      <div class="metrics-section">
        <div class="metrics-title">Token Usage</div>
        <div class="metrics-grid">
          <div class="metric-item">
            <div class="metric-value">${this._formatNumber(stats.totalTokens.input)}</div>
            <div class="metric-label">Input</div>
          </div>
          <div class="metric-item">
            <div class="metric-value">${this._formatNumber(stats.totalTokens.output)}</div>
            <div class="metric-label">Output</div>
          </div>
          <div class="metric-item">
            <div class="metric-value">${this._formatNumber(stats.totalTokens.cacheRead)}</div>
            <div class="metric-label">Cache Read</div>
          </div>
          <div class="metric-item">
            <div class="metric-value">${this._formatNumber(stats.totalTokens.cacheWrite)}</div>
            <div class="metric-label">Cache Write</div>
          </div>
        </div>
      </div>
    `;

    // Tool calls section
    html += `
      <div class="metrics-section">
        <div class="metrics-title">Tool Calls</div>
        <div class="metrics-summary">
          <span class="success">✓ ${stats.toolCalls.success}</span>
          <span class="failed">✗ ${stats.toolCalls.failed}</span>
        </div>
        <div class="tool-log">
    `;

    // Tool call events (last 5)
    const toolEvents = events.filter(e => e.type === 'tool_call' || e.type === 'tool_result').slice(-5);
    if (toolEvents.length > 0) {
      for (const event of toolEvents) {
        if (event.type === 'tool_call') {
          html += `
            <div class="tool-item pending">
              <span class="tool-icon">●</span>
              <span class="tool-name">${this._escape(event.data.name)}</span>
              <span class="tool-status">running</span>
            </div>
          `;
        } else if (event.type === 'tool_result') {
          const statusClass = event.data.success ? 'success' : 'failed';
          const statusIcon = event.data.success ? '✓' : '✗';
          html += `
            <div class="tool-item ${statusClass}">
              <span class="tool-icon">${statusIcon}</span>
              <span class="tool-name">${this._escape(event.data.callId)}</span>
              <span class="tool-duration">${event.data.durationMs}ms</span>
            </div>
          `;
        }
      }
    } else {
      html += '<div class="metrics-empty">No tool calls yet</div>';
    }

    html += '</div></div>';

    // Errors section (if any)
    if (stats.errors.total > 0) {
      html += `
        <div class="metrics-section errors">
          <div class="metrics-title">Errors (${stats.errors.total})</div>
      `;

      for (const [type, count] of Object.entries(stats.errors.byType)) {
        html += `
          <div class="error-item">
            <span class="error-type">${this._escape(type)}</span>
            <span class="error-count">${count}</span>
          </div>
        `;
      }

      html += '</div>';
    }

    // Session duration
    const duration = tracker.getDurationMs();
    html += `
      <div class="metrics-section">
        <div class="metric-item">
          <div class="metric-value">${this._formatDuration(duration)}</div>
          <div class="metric-label">Session Duration</div>
        </div>
      </div>
    `;

    return html;
  }

  _getFields(entity) {
    const fields = [['Type', entity.type], ['State', entity.state || 'N/A']];
    if (entity.type === 'agent') {
      if (entity.data.model) fields.push(['Model', entity.data.model]);
      if (entity.data.tools) fields.push(['Tools', entity.data.tools.join(', ')]);
      if (entity.data.sessionId) fields.push(['Session', entity.data.sessionId]);
    }
    if (entity.type === 'task') {
      if (entity.progress > 0) fields.push(['Progress', Math.round(entity.progress * 100) + '%']);
    }
    return fields;
  }

  _formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return String(num);
  }

  _formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  _startAutoUpdate(entity) {
    this._stopAutoUpdate();

    if (this._currentTab === 'metrics' && entity.type === 'agent') {
      // Update metrics every 2 seconds
      this._updateInterval = setInterval(() => {
        if (this._currentEntity && this._currentTab === 'metrics') {
          this.show(this._currentEntity, []);
        }
      }, 2000);
    }
  }

  _stopAutoUpdate() {
    if (this._updateInterval) {
      clearInterval(this._updateInterval);
      this._updateInterval = null;
    }
  }

  _escape(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
}
