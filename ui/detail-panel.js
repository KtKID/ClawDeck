// ui/detail-panel.js — Right-side detail panel for selected entities

import { t } from '../i18n/index.js';

export class DetailPanel {
  constructor(container) {
    this.el = document.createElement('div');
    this.el.className = 'detail-panel';
    container.appendChild(this.el);
    this._currentEntity = null;
    this._currentActions = []; // D1 fix: 保存 actions 引用
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

  show(entity, actions) {
    this._currentEntity = entity;
    // D1 fix: 仅在显式传入时更新 actions，自动刷新时保留之前的
    if (actions !== undefined) {
      this._currentActions = actions || [];
    }
    this.el.classList.add('open');

    // Tab header
    let html = `
      <h3>${this._escape(entity.label || entity.type)}</h3>
      <div class="tab-bar">
        <button class="tab-btn ${this._currentTab === 'overview' ? 'active' : ''}" data-tab="overview">${t('detail.tab_overview')}</button>
        <button class="tab-btn ${this._currentTab === 'metrics' ? 'active' : ''}" data-tab="metrics">${t('detail.tab_metrics')}</button>
      </div>
      <div class="tab-content">
    `;

    // Render current tab
    if (this._currentTab === 'overview') {
      html += this._renderOverview(entity, this._currentActions);
    } else if (this._currentTab === 'metrics') {
      html += this._renderMetrics(entity);
    }

    html += '</div>';
    this.el.innerHTML = html;

    // Bind tab buttons — D1 fix: 不再传递 actions 参数，使用已保存的 _currentActions
    this.el.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._currentTab = btn.dataset.tab;
        this.show(this._currentEntity);
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
    this._currentActions = [];
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
      return `<div class="metrics-empty">${t('detail.no_telemetry')}</div>`;
    }

    const sessionId = entity.data?.sessionId || entity.id;
    const tracker = this._telemetryManager.getSession(sessionId);

    if (!tracker) {
      return `<div class="metrics-empty">${t('detail.no_session')}</div>`;
    }

    // D2 fix: 安全访问 stats 和 events
    const stats = tracker.stats || {};
    const events = Array.isArray(tracker.events) ? tracker.events.slice(-10) : [];
    const totalTokens = stats.totalTokens || {};
    const toolCallStats = stats.toolCalls || { success: 0, failed: 0 };
    const errorStats = stats.errors || { total: 0, byType: {} };

    let html = '';

    // Token usage section
    html += `
      <div class="metrics-section">
        <div class="metrics-title">${t('detail.token_usage')}</div>
        <div class="metrics-grid">
          <div class="metric-item">
            <div class="metric-value">${this._formatNumber(totalTokens.input || 0)}</div>
            <div class="metric-label">${t('detail.input')}</div>
          </div>
          <div class="metric-item">
            <div class="metric-value">${this._formatNumber(totalTokens.output || 0)}</div>
            <div class="metric-label">${t('detail.output')}</div>
          </div>
          <div class="metric-item">
            <div class="metric-value">${this._formatNumber(totalTokens.cacheRead || 0)}</div>
            <div class="metric-label">${t('detail.cache_read')}</div>
          </div>
          <div class="metric-item">
            <div class="metric-value">${this._formatNumber(totalTokens.cacheWrite || 0)}</div>
            <div class="metric-label">${t('detail.cache_write')}</div>
          </div>
        </div>
      </div>
    `;

    // Tool calls section
    html += `
      <div class="metrics-section">
        <div class="metrics-title">${t('detail.tool_calls')}</div>
        <div class="metrics-summary">
          <span class="success">✓ ${toolCallStats.success}</span>
          <span class="failed">✗ ${toolCallStats.failed}</span>
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
              <span class="tool-name">${this._escape(event.data?.name || 'unknown')}</span>
              <span class="tool-status">${t('detail.tool_running')}</span>
            </div>
          `;
        } else if (event.type === 'tool_result') {
          const statusClass = event.data?.success ? 'success' : 'failed';
          const statusIcon = event.data?.success ? '✓' : '✗';
          html += `
            <div class="tool-item ${statusClass}">
              <span class="tool-icon">${statusIcon}</span>
              <span class="tool-name">${this._escape(event.data?.name || event.data?.callId || 'unknown')}</span>
              <span class="tool-duration">${event.data?.durationMs || 0}ms</span>
            </div>
          `;
        }
      }
    } else {
      html += `<div class="metrics-empty">${t('detail.no_tool_calls')}</div>`;
    }

    html += '</div></div>';

    // Errors section (if any)
    if (errorStats.total > 0) {
      html += `
        <div class="metrics-section errors">
          <div class="metrics-title">${t('detail.errors', { count: errorStats.total })}</div>
      `;

      for (const [type, count] of Object.entries(errorStats.byType || {})) {
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
    const duration = typeof tracker.getDurationMs === 'function' ? tracker.getDurationMs() : 0;
    html += `
      <div class="metrics-section">
        <div class="metric-item">
          <div class="metric-value">${this._formatDuration(duration)}</div>
          <div class="metric-label">${t('detail.session_duration')}</div>
        </div>
      </div>
    `;

    return html;
  }

  _getFields(entity) {
    const fields = [[t('detail.field_type'), entity.type], [t('detail.field_state'), entity.state || 'N/A']];
    if (entity.type === 'agent') {
      if (entity.data?.model) fields.push(['Model', entity.data.model]);
      if (entity.data?.tools) fields.push(['Tools', entity.data.tools.join(', ')]);
      if (entity.data?.sessionId) fields.push(['Session', entity.data.sessionId]);
    }
    if (entity.type === 'task') {
      if (entity.progress > 0) fields.push(['Progress', Math.round(entity.progress * 100) + '%']);
    }
    return fields;
  }

  _formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return String(num || 0);
  }

  _formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  // D3 fix: 自动刷新时不丢失 actions
  _startAutoUpdate(entity) {
    this._stopAutoUpdate();

    if (this._currentTab === 'metrics' && entity.type === 'agent') {
      this._updateInterval = setInterval(() => {
        if (this._currentEntity && this._currentTab === 'metrics') {
          this.show(this._currentEntity); // 不传 actions，使用已保存的 _currentActions
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
