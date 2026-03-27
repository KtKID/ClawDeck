// ui/cost-panel.js — 成本/Token 实时显示面板

export class CostPanel {
  constructor(container) {
    this.el = document.createElement('div');
    this.el.className = 'cost-panel';
    container.appendChild(this.el);
    this._metrics = null;
    this._render();
  }

  /**
   * 更新指标数据
   * @param {object} metrics - Metrics 对象 from dataSource.getMetrics()
   */
  update(metrics) {
    this._metrics = metrics;
    this._render();
  }

  _render() {
    const m = this._metrics;
    if (!m) {
      this.el.innerHTML = `
        <div class="cost-row">
          <span class="cost-label">等待数据...</span>
        </div>
      `;
      return;
    }

    this.el.innerHTML = `
      <div class="cost-row">
        <div class="cost-item">
          <span class="cost-value">${formatTokens(m.totalTokens)}</span>
          <span class="cost-label">Token</span>
        </div>
        <div class="cost-item">
          <span class="cost-value">${m.activeSessions}</span>
          <span class="cost-label">活跃会话</span>
        </div>
        <div class="cost-item">
          <span class="cost-value">${m.activeAgents}</span>
          <span class="cost-label">在线伙伴</span>
        </div>
        <div class="cost-item">
          <span class="cost-value">${m.completedSessions}</span>
          <span class="cost-label">已完成</span>
        </div>
        ${m.totalErrors > 0 ? `
        <div class="cost-item cost-error">
          <span class="cost-value">${m.totalErrors}</span>
          <span class="cost-label">需要帮助</span>
        </div>
        ` : ''}
      </div>
    `;
  }
}

function formatTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}
