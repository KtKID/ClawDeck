// ui/control-panel.js — 控制面板（中断/批准/重试/指令）

import { t } from '../i18n/index.js';

export class ControlPanel {
  /**
   * @param {HTMLElement} container
   * @param {import('../bridge/gateway-client.js').GatewayClient} gateway
   */
  constructor(container, gateway) {
    this.el = document.createElement('div');
    this.el.className = 'control-panel';
    container.appendChild(this.el);
    this._gateway = gateway;
    this._sessionId = null;
    this._sessionKey = null;
    this._agentLabel = null;
    this._sessionStatus = null;
    this._onResult = null;
    this._pendingApprovalId = null;
    this._models = [];
    this._selectedModel = null;
    this._render();
  }

  /**
   * 绑定到指定 session
   * @param {{ sessionId: string, sessionKey?: string, agentLabel?: string, sessionStatus?: string }} opts
   */
  bind(opts) {
    if (typeof opts === 'string') {
      // 兼容旧调用 bind(sessionId)
      opts = { sessionId: opts };
    }
    this._sessionId = opts.sessionId || null;
    this._sessionKey = opts.sessionKey || null;
    this._agentLabel = opts.agentLabel || null;
    this._sessionStatus = opts.sessionStatus || null;
    this._updateHeader();
    this._updateButtons();
  }

  /** 解除绑定 */
  unbind() {
    this._sessionId = null;
    this._sessionKey = null;
    this._agentLabel = null;
    this._sessionStatus = null;
    this._updateHeader();
    this._updateButtons();
  }

  /** 监听操作结果 */
  onResult(fn) {
    this._onResult = fn;
  }

  /** 设置待审批请求 ID，启用批准按钮 */
  setPendingApproval(requestId) {
    this._pendingApprovalId = requestId;
    this._updateButtons();
  }

  /** 清除待审批状态 */
  clearPendingApproval() {
    this._pendingApprovalId = null;
    this._updateButtons();
  }

  /** 设置可用模型列表 */
  setModels(models) {
    this._models = models;
    this._renderModelSelect();
  }

  _renderModelSelect() {
    const select = this.el.querySelector('.cp-model-select');
    if (!select) return;
    const current = this._selectedModel;
    select.innerHTML = `<option value="">${t('cp.default_model')}</option>`;
    for (const m of this._models) {
      const label = m.label || m.id;
      select.innerHTML += `<option value="${m.id}" ${m.id === current ? 'selected' : ''}>${label}</option>`;
    }
    select.disabled = this._models.length === 0;
  }

  _render() {
    this.el.innerHTML = `
      <div class="cp-header">${t('cp.no_agent')}</div>
      <div class="cp-row">
        <button class="cp-btn cp-approve" data-action="approve" title="${t('cp.approve')}" disabled>
          <span class="cp-icon">\u{2714}</span>
          <span class="cp-label">${t('cp.approve')}</span>
        </button>
        <button class="cp-btn cp-interrupt" data-action="interrupt" title="${t('cp.interrupt')}">
          <span class="cp-icon">\u{23F9}</span>
          <span class="cp-label">${t('cp.interrupt')}</span>
        </button>
        <button class="cp-btn cp-retry" data-action="retry" title="${t('cp.retry')}">
          <span class="cp-icon">\u{21BB}</span>
          <span class="cp-label">${t('cp.retry')}</span>
        </button>
        <button class="cp-btn cp-reset" data-action="reset" title="${t('cp.reset')}">
          <span class="cp-icon">\u{21BA}</span>
          <span class="cp-label">${t('cp.reset')}</span>
        </button>
      </div>
      <div class="cp-instruct-row">
        <input class="cp-input" type="text" placeholder="${t('cp.input_placeholder')}" />
        <button class="cp-btn cp-send" data-action="instruct" title="${t('cp.btn_send')}">
          <span class="cp-icon">\u{27A4}</span>
        </button>
      </div>
      <div class="cp-model-row">
        <select class="cp-model-select" disabled>
          <option value="">${t('cp.default_model')}</option>
        </select>
      </div>
    `;

    // 绑定按钮事件
    this.el.querySelectorAll('.cp-btn').forEach(btn => {
      btn.addEventListener('click', () => this._handleAction(btn.dataset.action));
    });

    // 回车发送指令
    const input = this.el.querySelector('.cp-input');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        this._handleAction('instruct');
      }
    });

    this._updateButtons();
  }

  _updateHeader() {
    const header = this.el.querySelector('.cp-header');
    if (!header) return;
    if (this._sessionId && this._agentLabel) {
      header.textContent = t('cp.send_to', { name: this._agentLabel });
      header.classList.add('cp-header-active');
    } else if (this._sessionId) {
      header.textContent = t('cp.session', { id: this._sessionId.slice(0, 8) });
      header.classList.add('cp-header-active');
    } else {
      header.textContent = t('cp.no_agent');
      header.classList.remove('cp-header-active');
    }
  }

  _updateButtons() {
    const status = this._sessionStatus;
    const hasBind = !!this._sessionId;

    const interruptBtn = this.el.querySelector('.cp-interrupt');
    const retryBtn = this.el.querySelector('.cp-retry');
    const approveBtn = this.el.querySelector('.cp-approve');
    const resetBtn = this.el.querySelector('.cp-reset');
    const sendBtn = this.el.querySelector('.cp-send');
    const input = this.el.querySelector('.cp-input');

    // 中断：仅有 sessionKey 且 active 时可点
    interruptBtn.disabled = !this._sessionKey || status !== 'active';
    // 重试：仅有 sessionKey 且 error 或 completed 时可点
    retryBtn.disabled = !this._sessionKey || (status !== 'error' && status !== 'completed');
    // 批准：有待审批时启用
    approveBtn.disabled = !this._pendingApprovalId;
    // 重置：有 sessionKey 时可点
    if (resetBtn) resetBtn.disabled = !this._sessionKey;
    // 指令+发送：有 sessionKey 时可用
    sendBtn.disabled = !this._sessionKey;
    if (input) input.disabled = !this._sessionKey;
  }

  async _handleAction(action) {
    if (!this._gateway) return;

    const input = this.el.querySelector('.cp-input');
    const instruction = action === 'instruct' ? input.value.trim() : undefined;

    if (action === 'instruct' && !instruction) return;

    try {
      switch (action) {
        case 'instruct':
          if (!this._sessionKey) throw new Error(t('cp.err_no_session'));
          await this._gateway.sendInstruction(this._sessionKey, instruction);
          input.value = '';
          break;
        case 'interrupt':
          if (!this._sessionKey) throw new Error(t('cp.err_no_session'));
          await this._gateway.abortSession(this._sessionKey);
          break;
        case 'approve':
          if (!this._pendingApprovalId) throw new Error(t('cp.err_no_approval'));
          await this._gateway.resolveApproval(this._pendingApprovalId);
          this.clearPendingApproval();
          break;
        case 'retry':
          if (!this._sessionKey) throw new Error(t('cp.err_no_session'));
          await this._gateway.sendInstruction(this._sessionKey, '/retry');
          break;
        case 'reset':
          if (!this._sessionKey) throw new Error(t('cp.err_no_session'));
          await this._gateway.call('sessions.reset', { key: this._sessionKey });
          break;
        default:
          // 回退到旧方法（兼容）
          await this._gateway.sendAction(action, this._sessionId, instruction);
      }
      if (this._onResult) this._onResult({ ok: true, action, sessionId: this._sessionId });
    } catch (err) {
      if (this._onResult) this._onResult({ ok: false, action, sessionId: this._sessionId, error: err.message });
    }
  }
}
