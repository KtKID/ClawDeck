// ui/cron-dialog.js — Cron 配置弹窗
// 居中浮窗，支持创建/编辑/克隆模式
// 4 区表单：基础信息 + 调度配置 + 执行配置 + 交付配置 + 高级选项

import { t } from '../i18n/index.js';
import { CronApi } from '../bridge/cron-api.js';
import { CronRunsView } from './cron-runs-view.js';

const DEFAULT_FORM = () => ({
  name: '',
  description: '',
  agentId: '',
  enabled: true,
  // 调度
  scheduleKind: 'cron',
  scheduleAt: '',
  everyAmount: '5',
  everyUnit: 'minutes',
  cronExpr: '',
  cronTz: '',
  scheduleExact: false,
  staggerAmount: '',
  staggerUnit: 'seconds',
  // 执行
  sessionTarget: 'isolated',
  wakeMode: 'now',
  payloadKind: 'agentTurn',
  payloadText: '',
  timeoutSeconds: '',
  // Agent 相关
  payloadModel: '',
  payloadThinking: '',
  payloadLightContext: false,
  // 交付
  deliveryMode: 'none',
  deliveryChannel: '',
  deliveryTo: '',
  deliveryBestEffort: false,
  // 高级
  deleteAfterRun: false,
  sessionKey: '',
  // 失败告警
  failureAlertMode: 'inherit',
  failureAlertAfter: '3',
  failureAlertCooldownSeconds: '300',
  failureAlertChannel: '',
  failureAlertTo: '',
});

export class CronDialog {
  /**
   * @param {import('../bridge/gateway-client.js').GatewayClient} gateway
   * @param {import('../bridge/data-router.js').DataRouter} dataSource
   * @param {Object} [callbacks]
   * @param {function} [callbacks.onSaved] - 保存后回调
   * @param {function} [callbacks.onDeleted] - 删除后回调
   * @param {function} [callbacks.onNavigateToChat] - 导航到会话
   */
  constructor(gateway, dataSource, callbacks = {}) {
    this._api = new CronApi(gateway);
    this._gateway = gateway;
    this._dataSource = dataSource;
    this._callbacks = callbacks;
    this._visible = false;
    this._mode = 'create'; // create | edit | clone
    this._editingJobId = null;
    this._form = DEFAULT_FORM();
    this._errors = {};
    this._busy = false;
    this._activeTab = 'config'; // config | runs
    this._runsView = null; // 运行日志子视图（P1 实现）

    // 遮罩
    this._backdrop = document.createElement('div');
    this._backdrop.className = 'cron-dialog-backdrop';
    document.body.appendChild(this._backdrop);

    // 弹窗主体
    this.el = document.createElement('div');
    this.el.className = 'cron-dialog';
    document.body.appendChild(this.el);

    this._render();
    this._bindEvents();
  }

  // ============================================================
  // 公共接口
  // ============================================================

  get visible() { return this._visible; }

  /** 打开弹窗 - 创建模式 */
  openCreate() {
    this._mode = 'create';
    this._editingJobId = null;
    this._form = DEFAULT_FORM();
    this._errors = {};
    this._activeTab = 'config';
    this._show();
  }

  /** 打开弹窗 - 编辑模式 */
  openEdit(jobId) {
    const job = this._dataSource.getCronJobRaw(jobId);
    if (!job) return;
    this._mode = 'edit';
    this._editingJobId = jobId;
    this._form = this._jobToForm(job);
    this._errors = {};
    this._activeTab = 'config';
    this._show();
  }

  /** 打开弹窗 - 克隆模式 */
  openClone(jobId) {
    const job = this._dataSource.getCronJobRaw(jobId);
    if (!job) return;
    this._mode = 'clone';
    this._editingJobId = null;
    this._form = this._jobToForm(job);
    this._form.name = job.name + ' (copy)';
    this._errors = {};
    this._activeTab = 'config';
    this._show();
  }

  close() {
    this._visible = false;
    this.el.classList.remove('open');
    this._backdrop.classList.remove('visible');
  }

  destroy() {
    this.el.remove();
    this._backdrop.remove();
  }

  // ============================================================
  // 内部：显示/渲染
  // ============================================================

  _show() {
    this._visible = true;
    this._renderContent();
    this.el.classList.add('open');
    this._backdrop.classList.add('visible');
  }

  _render() {
    this.el.innerHTML = `
      <div class="cron-dialog-header">
        <span class="cron-dialog-title"></span>
        <div class="cron-dialog-tabs"></div>
        <button class="cron-dialog-close" title="${t('cron.close')}">✕</button>
      </div>
      <div class="cron-dialog-body"></div>
      <div class="cron-dialog-footer"></div>
    `;
  }

  _renderContent() {
    // 标题
    const titleKey = this._mode === 'edit' ? 'cron.title.edit'
                   : this._mode === 'clone' ? 'cron.title.clone'
                   : 'cron.title.create';
    this.el.querySelector('.cron-dialog-title').textContent = t(titleKey);

    // tabs（仅编辑模式显示运行日志 tab）
    const tabsEl = this.el.querySelector('.cron-dialog-tabs');
    if (this._mode === 'edit') {
      tabsEl.innerHTML = `
        <button class="cron-dialog-tab ${this._activeTab === 'config' ? 'active' : ''}" data-tab="config">${t('cron.tab.config')}</button>
        <button class="cron-dialog-tab ${this._activeTab === 'runs' ? 'active' : ''}" data-tab="runs">${t('cron.tab.runs')}</button>
      `;
    } else {
      tabsEl.innerHTML = '';
    }

    // body
    if (this._activeTab === 'config') {
      this._renderForm();
    } else {
      this._renderRuns();
    }

    // footer
    this._renderFooter();
  }

  _renderForm() {
    const f = this._form;
    const body = this.el.querySelector('.cron-dialog-body');

    body.innerHTML = `
      <!-- 基础信息 -->
      <div class="cron-section">
        <div class="cron-section-title">📋 ${t('cron.section.basics')}</div>
        <div class="cron-form-grid">
          <div class="cron-field">
            <label>${t('cron.field.name')}<span class="cron-required">*</span></label>
            <input type="text" data-field="name" value="${this._esc(f.name)}" placeholder="${t('cron.field.name_placeholder')}">
          </div>
          <div class="cron-field">
            <label>${t('cron.field.agentId')}</label>
            <input type="text" data-field="agentId" value="${this._esc(f.agentId)}" placeholder="${t('cron.field.agentId_placeholder')}">
          </div>
          <div class="cron-field cron-span-2">
            <label>${t('cron.field.description')}</label>
            <input type="text" data-field="description" value="${this._esc(f.description)}" placeholder="${t('cron.field.description_placeholder')}">
          </div>
          <div class="cron-field">
            <label class="cron-checkbox">
              <input type="checkbox" data-field="enabled" ${f.enabled ? 'checked' : ''}>
              <span>${t('cron.field.enabled')}</span>
            </label>
          </div>
        </div>
      </div>

      <!-- 调度配置 -->
      <div class="cron-section">
        <div class="cron-section-title">⏰ ${t('cron.section.schedule')}</div>
        <div class="cron-radio-group" data-field="scheduleKind">
          <label><input type="radio" name="scheduleKind" value="at" ${f.scheduleKind === 'at' ? 'checked' : ''}><span>${t('cron.schedule.at')}</span></label>
          <label><input type="radio" name="scheduleKind" value="every" ${f.scheduleKind === 'every' ? 'checked' : ''}><span>${t('cron.schedule.every')}</span></label>
          <label><input type="radio" name="scheduleKind" value="cron" ${f.scheduleKind === 'cron' ? 'checked' : ''}><span>${t('cron.schedule.cron')}</span></label>
        </div>

        <!-- at 字段 -->
        <div class="cron-schedule-fields ${f.scheduleKind === 'at' ? 'active' : ''}" data-schedule="at">
          <div class="cron-form-grid">
            <div class="cron-field cron-span-2">
              <label>${t('cron.field.at')}<span class="cron-required">*</span></label>
              <input type="datetime-local" data-field="scheduleAt" value="${this._esc(f.scheduleAt)}">
            </div>
          </div>
        </div>

        <!-- every 字段 -->
        <div class="cron-schedule-fields ${f.scheduleKind === 'every' ? 'active' : ''}" data-schedule="every">
          <div class="cron-every-row">
            <div class="cron-field">
              <label>${t('cron.field.every_amount')}<span class="cron-required">*</span></label>
              <input type="number" data-field="everyAmount" value="${this._esc(f.everyAmount)}" min="1">
            </div>
            <div class="cron-field">
              <label>${t('cron.field.every_unit')}</label>
              <select data-field="everyUnit">
                <option value="minutes" ${f.everyUnit === 'minutes' ? 'selected' : ''}>${t('cron.unit.minutes')}</option>
                <option value="hours" ${f.everyUnit === 'hours' ? 'selected' : ''}>${t('cron.unit.hours')}</option>
                <option value="days" ${f.everyUnit === 'days' ? 'selected' : ''}>${t('cron.unit.days')}</option>
              </select>
            </div>
          </div>
        </div>

        <!-- cron 字段 -->
        <div class="cron-schedule-fields ${f.scheduleKind === 'cron' ? 'active' : ''}" data-schedule="cron">
          <div class="cron-form-grid">
            <div class="cron-field">
              <label>${t('cron.field.cron_expr')}<span class="cron-required">*</span></label>
              <input type="text" data-field="cronExpr" value="${this._esc(f.cronExpr)}" placeholder="${t('cron.field.cron_expr_placeholder')}">
            </div>
            <div class="cron-field">
              <label>${t('cron.field.cron_tz')}</label>
              <input type="text" data-field="cronTz" value="${this._esc(f.cronTz)}" placeholder="${t('cron.field.cron_tz_placeholder')}">
            </div>
          </div>
        </div>
      </div>

      <!-- 执行配置 -->
      <div class="cron-section">
        <div class="cron-section-title">⚡ ${t('cron.section.execution')}</div>
        <div class="cron-form-grid">
          <div class="cron-field">
            <label>${t('cron.field.sessionTarget')}</label>
            <select data-field="sessionTarget">
              <option value="main" ${f.sessionTarget === 'main' ? 'selected' : ''}>${t('cron.sessionTarget.main')}</option>
              <option value="isolated" ${f.sessionTarget === 'isolated' ? 'selected' : ''}>${t('cron.sessionTarget.isolated')}</option>
            </select>
          </div>
          <div class="cron-field">
            <label>${t('cron.field.wakeMode')}</label>
            <select data-field="wakeMode">
              <option value="now" ${f.wakeMode === 'now' ? 'selected' : ''}>${t('cron.wakeMode.now')}</option>
              <option value="next-heartbeat" ${f.wakeMode === 'next-heartbeat' ? 'selected' : ''}>${t('cron.wakeMode.next-heartbeat')}</option>
            </select>
          </div>
          <div class="cron-field">
            <label>${t('cron.field.payloadKind')}</label>
            <select data-field="payloadKind">
              <option value="systemEvent" ${f.payloadKind === 'systemEvent' ? 'selected' : ''}>${t('cron.payloadKind.systemEvent')}</option>
              <option value="agentTurn" ${f.payloadKind === 'agentTurn' ? 'selected' : ''}>${t('cron.payloadKind.agentTurn')}</option>
            </select>
          </div>
          ${f.payloadKind === 'agentTurn' ? `
          <div class="cron-field">
            <label>${t('cron.field.timeout')}</label>
            <input type="number" data-field="timeoutSeconds" value="${this._esc(f.timeoutSeconds)}" placeholder="${t('cron.field.timeout_placeholder')}" min="1">
          </div>` : ''}
          <div class="cron-field cron-span-2">
            <label>${f.payloadKind === 'agentTurn' ? t('cron.field.payloadText_agent') : t('cron.field.payloadText_system')}<span class="cron-required">*</span></label>
            <textarea data-field="payloadText" rows="3" placeholder="${t('cron.field.payloadText_placeholder')}">${this._esc(f.payloadText)}</textarea>
          </div>
        </div>
      </div>

      <!-- 交付配置 -->
      <div class="cron-section">
        <div class="cron-section-title">📤 ${t('cron.section.delivery')}</div>
        <div class="cron-form-grid">
          <div class="cron-field">
            <label>${t('cron.field.deliveryMode')}</label>
            <select data-field="deliveryMode">
              <option value="none" ${f.deliveryMode === 'none' ? 'selected' : ''}>${t('cron.deliveryMode.none')}</option>
              <option value="announce" ${f.deliveryMode === 'announce' ? 'selected' : ''}>${t('cron.deliveryMode.announce')}</option>
              <option value="webhook" ${f.deliveryMode === 'webhook' ? 'selected' : ''}>${t('cron.deliveryMode.webhook')}</option>
            </select>
          </div>
          ${f.deliveryMode === 'announce' ? `
          <div class="cron-field">
            <label>${t('cron.field.deliveryChannel')}</label>
            <input type="text" data-field="deliveryChannel" value="${this._esc(f.deliveryChannel)}" placeholder="${t('cron.field.deliveryChannel_placeholder')}">
          </div>
          <div class="cron-field">
            <label>${t('cron.field.deliveryTo')}</label>
            <input type="text" data-field="deliveryTo" value="${this._esc(f.deliveryTo)}" placeholder="${t('cron.field.deliveryTo_announce_placeholder')}">
          </div>` : ''}
          ${f.deliveryMode === 'webhook' ? `
          <div class="cron-field cron-span-2">
            <label>${t('cron.field.deliveryTo')}<span class="cron-required">*</span></label>
            <input type="text" data-field="deliveryTo" value="${this._esc(f.deliveryTo)}" placeholder="${t('cron.field.deliveryTo_webhook_placeholder')}">
          </div>` : ''}
          ${f.deliveryMode !== 'none' ? `
          <div class="cron-field">
            <label class="cron-checkbox">
              <input type="checkbox" data-field="deliveryBestEffort" ${f.deliveryBestEffort ? 'checked' : ''}>
              <span>${t('cron.field.deliveryBestEffort')}</span>
            </label>
          </div>` : ''}
        </div>
      </div>

      <!-- 高级选项 -->
      <details class="cron-advanced">
        <summary>${t('cron.section.advanced')}</summary>
        <div class="cron-advanced-content">
          <div class="cron-form-grid">
            <div class="cron-field">
              <label class="cron-checkbox">
                <input type="checkbox" data-field="deleteAfterRun" ${f.deleteAfterRun ? 'checked' : ''}>
                <span>${t('cron.field.deleteAfterRun')}</span>
              </label>
            </div>
            <div class="cron-field">
              <label>${t('cron.field.sessionKey')}</label>
              <input type="text" data-field="sessionKey" value="${this._esc(f.sessionKey)}" placeholder="${t('cron.field.sessionKey_placeholder')}">
            </div>
            ${f.scheduleKind === 'cron' ? `
            <div class="cron-field">
              <label class="cron-checkbox">
                <input type="checkbox" data-field="scheduleExact" ${f.scheduleExact ? 'checked' : ''}>
                <span>${t('cron.field.scheduleExact')}</span>
              </label>
            </div>
            ${!f.scheduleExact ? `
            <div class="cron-field">
              <label>${t('cron.field.stagger')}</label>
              <div class="cron-every-row">
                <input type="number" data-field="staggerAmount" value="${this._esc(f.staggerAmount)}" placeholder="${t('cron.field.stagger_placeholder')}" min="1" style="flex:1">
                <select data-field="staggerUnit" style="width:70px">
                  <option value="seconds" ${f.staggerUnit === 'seconds' ? 'selected' : ''}>${t('cron.stagger.seconds')}</option>
                  <option value="minutes" ${f.staggerUnit === 'minutes' ? 'selected' : ''}>${t('cron.stagger.minutes')}</option>
                </select>
              </div>
            </div>` : ''}` : ''}
            ${f.payloadKind === 'agentTurn' ? `
            <div class="cron-field">
              <label class="cron-checkbox">
                <input type="checkbox" data-field="payloadLightContext" ${f.payloadLightContext ? 'checked' : ''}>
                <span>${t('cron.field.lightContext')}</span>
              </label>
            </div>
            <div class="cron-field">
              <label>${t('cron.field.model')}</label>
              <input type="text" data-field="payloadModel" value="${this._esc(f.payloadModel)}" placeholder="${t('cron.field.model_placeholder')}">
            </div>
            <div class="cron-field">
              <label>${t('cron.field.thinking')}</label>
              <input type="text" data-field="payloadThinking" value="${this._esc(f.payloadThinking)}" placeholder="${t('cron.field.thinking_placeholder')}">
            </div>
            <!-- 失败告警 -->
            <div class="cron-field cron-span-2">
              <label>${t('cron.section.failureAlert')}</label>
              <select data-field="failureAlertMode">
                <option value="inherit" ${f.failureAlertMode === 'inherit' ? 'selected' : ''}>${t('cron.failureAlert.inherit')}</option>
                <option value="disabled" ${f.failureAlertMode === 'disabled' ? 'selected' : ''}>${t('cron.failureAlert.disabled')}</option>
                <option value="custom" ${f.failureAlertMode === 'custom' ? 'selected' : ''}>${t('cron.failureAlert.custom')}</option>
              </select>
            </div>
            ${f.failureAlertMode === 'custom' ? `
            <div class="cron-field">
              <label>${t('cron.field.alertAfter')}</label>
              <input type="number" data-field="failureAlertAfter" value="${this._esc(f.failureAlertAfter)}" min="1">
            </div>
            <div class="cron-field">
              <label>${t('cron.field.alertCooldown')}</label>
              <input type="number" data-field="failureAlertCooldownSeconds" value="${this._esc(f.failureAlertCooldownSeconds)}" min="0">
            </div>
            <div class="cron-field">
              <label>${t('cron.field.alertChannel')}</label>
              <input type="text" data-field="failureAlertChannel" value="${this._esc(f.failureAlertChannel)}">
            </div>
            <div class="cron-field">
              <label>${t('cron.field.alertTo')}</label>
              <input type="text" data-field="failureAlertTo" value="${this._esc(f.failureAlertTo)}">
            </div>` : ''}` : ''}
          </div>
        </div>
      </details>

      <!-- 验证错误 -->
      <div class="cron-validation" style="display:none" data-role="validation"></div>
    `;

    this._syncValidation();
  }

  _renderRuns() {
    const body = this.el.querySelector('.cron-dialog-body');
    if (!this._runsView) {
      this._runsView = new CronRunsView(body, this._gateway, {
        onNavigateToChat: (sessionKey) => {
          this.close();
          this._callbacks.onNavigateToChat?.(sessionKey);
        },
      });
    } else {
      this._runsView.setContainer(body);
    }
    if (this._editingJobId) {
      this._runsView.load(this._editingJobId);
    } else {
      body.innerHTML = `<div class="cron-runs-empty">${t('cron.runs.empty')}</div>`;
    }
  }

  _renderFooter() {
    const footer = this.el.querySelector('.cron-dialog-footer');
    const isEdit = this._mode === 'edit';

    footer.innerHTML = `
      <div class="cron-dialog-footer-left">
        ${isEdit ? `
          <button class="cron-btn cron-btn-danger cron-btn-small" data-action="delete">${t('cron.btn.delete')}</button>
          <button class="cron-btn cron-btn-small" data-action="run">${t('cron.btn.run')}</button>
          <button class="cron-btn cron-btn-small" data-action="clone">${t('cron.btn.clone')}</button>
        ` : ''}
      </div>
      <button class="cron-btn" data-action="cancel">${t('cron.btn.cancel')}</button>
      <button class="cron-btn cron-btn-primary" data-action="save" ${this._busy ? 'disabled' : ''}>${t('cron.btn.save')}</button>
    `;
  }

  // ============================================================
  // 事件绑定
  // ============================================================

  _bindEvents() {
    // 遮罩点击关闭
    this._backdrop.addEventListener('click', () => this.close());

    // 关闭按钮
    this.el.addEventListener('click', (e) => {
      if (e.target.closest('.cron-dialog-close')) {
        this.close();
        return;
      }

      // tab 切换
      const tab = e.target.closest('.cron-dialog-tab');
      if (tab) {
        this._activeTab = tab.dataset.tab;
        this._renderContent();
        return;
      }

      // footer 按钮
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action) {
        this._handleAction(action);
        return;
      }
    });

    // 表单字段变化 → 同步到 _form + 条件渲染
    this.el.addEventListener('input', (e) => {
      const field = e.target.dataset?.field;
      if (!field) return;
      this._syncField(field, e.target);
    });

    this.el.addEventListener('change', (e) => {
      const field = e.target.dataset?.field;
      if (!field) return;
      this._syncField(field, e.target);

      // 需要重新渲染的字段
      const rerenderFields = ['scheduleKind', 'payloadKind', 'deliveryMode', 'failureAlertMode', 'scheduleExact'];
      if (rerenderFields.includes(field)) {
        this._renderForm();
      }
    });

    // radio group: scheduleKind 已由上面的 change 监听器通过 rerenderFields 处理
    // 无需额外监听器（B1 修复：移除重复监听器）
  }

  _syncField(field, el) {
    if (el.type === 'checkbox') {
      this._form[field] = el.checked;
    } else {
      this._form[field] = el.value;
    }
  }

  // ============================================================
  // 操作
  // ============================================================

  async _handleAction(action) {
    if (this._busy) return;

    switch (action) {
      case 'save':
        await this._save();
        break;
      case 'cancel':
        this.close();
        break;
      case 'delete':
        await this._delete();
        break;
      case 'run':
        await this._runNow();
        break;
      case 'clone':
        this.openClone(this._editingJobId);
        break;
    }
  }

  async _save() {
    const validation = this._validate();
    if (!validation.valid) {
      this._errors = validation.errors;
      this._syncValidation();
      return;
    }

    this._busy = true;
    this._renderFooter();

    try {
      const jobDef = this._formToJobDef();

      if (this._mode === 'edit' && this._editingJobId) {
        await this._api.update(this._editingJobId, jobDef);
      } else {
        await this._api.add(jobDef);
      }

      // 刷新列表
      await this._dataSource.refreshCronJobs();
      this._callbacks.onSaved?.();
      this.close();
    } catch (err) {
      console.error('[CronDialog] save failed:', err);
      this._errors = { _global: err.message };
      this._syncValidation();
    } finally {
      this._busy = false;
      this._renderFooter();
    }
  }

  async _delete() {
    if (!this._editingJobId) return;
    if (!confirm(t('cron.confirm.delete'))) return;

    this._busy = true;
    this._renderFooter();

    try {
      await this._api.remove(this._editingJobId);
      await this._dataSource.refreshCronJobs();
      this._callbacks.onDeleted?.();
      this.close();
    } catch (err) {
      console.error('[CronDialog] delete failed:', err);
      this._errors = { _global: err.message };
      this._syncValidation();
    } finally {
      this._busy = false;
      this._renderFooter();
    }
  }

  async _runNow() {
    if (!this._editingJobId) return;
    this._busy = true;
    this._renderFooter();

    try {
      await this._api.run(this._editingJobId, 'force');
    } catch (err) {
      console.error('[CronDialog] run failed:', err);
      this._errors = { _global: err.message };
      this._syncValidation();
    } finally {
      this._busy = false;
      this._renderFooter();
    }
  }

  // ============================================================
  // 验证
  // ============================================================

  _validate() {
    const f = this._form;
    const errors = {};

    if (!f.name.trim()) errors.name = t('cron.validation.name_required');

    if (f.scheduleKind === 'at' && !f.scheduleAt) errors.scheduleAt = t('cron.validation.at_required');
    if (f.scheduleKind === 'every' && (!f.everyAmount || Number(f.everyAmount) <= 0)) errors.everyAmount = t('cron.validation.every_required');
    if (f.scheduleKind === 'cron' && !f.cronExpr.trim()) errors.cronExpr = t('cron.validation.cron_required');

    if (!f.payloadText.trim()) errors.payloadText = t('cron.validation.text_required');

    if (f.deliveryMode === 'webhook') {
      if (!f.deliveryTo.trim()) errors.deliveryTo = t('cron.validation.webhook_required');
      else if (!f.deliveryTo.startsWith('http://') && !f.deliveryTo.startsWith('https://')) errors.deliveryTo = t('cron.validation.webhook_format');
    }

    return { valid: Object.keys(errors).length === 0, errors };
  }

  _syncValidation() {
    const el = this.el.querySelector('[data-role="validation"]');
    if (!el) return;

    const keys = Object.keys(this._errors);
    if (keys.length === 0) {
      el.style.display = 'none';
      return;
    }

    el.style.display = '';
    el.innerHTML = `
      <div class="cron-validation-title">${t('cron.validation.title')}</div>
      <ul class="cron-validation-list">
        ${keys.map(k => `<li><a data-focus="${k}">${this._errors[k]}</a></li>`).join('')}
      </ul>
    `;

    // 点击错误项跳转到对应字段
    el.querySelectorAll('[data-focus]').forEach(a => {
      a.addEventListener('click', () => {
        const field = a.dataset.focus;
        const input = this.el.querySelector(`[data-field="${field}"]`);
        input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        input?.focus();
      });
    });
  }

  // ============================================================
  // 数据转换
  // ============================================================

  _formToJobDef() {
    const f = this._form;
    const def = {
      name: f.name.trim(),
      description: f.description.trim() || undefined,
      agentId: f.agentId.trim() || undefined,
      enabled: f.enabled,
      sessionTarget: f.sessionTarget,
      wakeMode: f.wakeMode,
      sessionKey: f.sessionKey.trim() || undefined,
    };

    // schedule
    if (f.scheduleKind === 'at') {
      def.schedule = { kind: 'at', at: new Date(f.scheduleAt).toISOString() };
    } else if (f.scheduleKind === 'every') {
      const ms = Number(f.everyAmount) * { minutes: 60000, hours: 3600000, days: 86400000 }[f.everyUnit];
      def.schedule = { kind: 'every', everyMs: ms };
    } else {
      def.schedule = { kind: 'cron', expr: f.cronExpr.trim() };
      if (f.cronTz.trim()) def.schedule.tz = f.cronTz.trim();
      if (!f.scheduleExact && f.staggerAmount) {
        const stMs = Number(f.staggerAmount) * (f.staggerUnit === 'minutes' ? 60000 : 1000);
        if (stMs > 0) def.schedule.staggerMs = stMs;
      }
    }

    // payload
    if (f.payloadKind === 'systemEvent') {
      def.payload = { kind: 'systemEvent', text: f.payloadText.trim() };
    } else {
      def.payload = { kind: 'agentTurn', message: f.payloadText.trim() };
      if (f.timeoutSeconds) def.payload.timeoutSeconds = Number(f.timeoutSeconds);
      if (f.payloadModel.trim()) def.payload.model = f.payloadModel.trim();
      if (f.payloadThinking.trim()) def.payload.thinking = f.payloadThinking.trim();
      if (f.payloadLightContext) def.payload.lightContext = true;
    }

    // delivery
    if (f.deliveryMode !== 'none') {
      def.delivery = { mode: f.deliveryMode };
      if (f.deliveryChannel.trim()) def.delivery.channel = f.deliveryChannel.trim();
      if (f.deliveryTo.trim()) def.delivery.to = f.deliveryTo.trim();
      if (f.deliveryBestEffort) def.delivery.bestEffort = true;
    }

    // failure alert
    if (f.payloadKind === 'agentTurn') {
      if (f.failureAlertMode === 'disabled') {
        def.failureAlert = false;
      } else if (f.failureAlertMode === 'custom') {
        def.failureAlert = {
          after: Number(f.failureAlertAfter) || 3,
          cooldownMs: (Number(f.failureAlertCooldownSeconds) || 300) * 1000,
        };
        if (f.failureAlertChannel.trim()) def.failureAlert.channel = f.failureAlertChannel.trim();
        if (f.failureAlertTo.trim()) def.failureAlert.to = f.failureAlertTo.trim();
      }
    }

    if (f.deleteAfterRun) def.deleteAfterRun = true;

    return def;
  }

  _jobToForm(job) {
    const f = DEFAULT_FORM();
    f.name = job.name || '';
    f.description = job.description || '';
    f.agentId = job.agentId || '';
    f.enabled = job.enabled !== false;
    f.sessionTarget = job.sessionTarget || 'isolated';
    f.wakeMode = job.wakeMode || 'now';
    f.sessionKey = job.sessionKey || '';

    // schedule
    const s = job.schedule;
    if (s) {
      f.scheduleKind = s.kind || 'cron';
      if (s.kind === 'at' && s.at) {
        f.scheduleAt = new Date(s.at).toISOString().slice(0, 16);
      } else if (s.kind === 'every') {
        const ms = s.everyMs || 300000;
        if (ms >= 86400000) { f.everyAmount = String(ms / 86400000); f.everyUnit = 'days'; }
        else if (ms >= 3600000) { f.everyAmount = String(ms / 3600000); f.everyUnit = 'hours'; }
        else { f.everyAmount = String(ms / 60000); f.everyUnit = 'minutes'; }
      } else if (s.kind === 'cron') {
        f.cronExpr = s.expr || '';
        f.cronTz = s.tz || '';
        if (s.staggerMs) {
          if (s.staggerMs >= 60000) { f.staggerAmount = String(s.staggerMs / 60000); f.staggerUnit = 'minutes'; }
          else { f.staggerAmount = String(s.staggerMs / 1000); f.staggerUnit = 'seconds'; }
        }
      }
    }

    // payload
    const p = job.payload;
    if (p) {
      f.payloadKind = p.kind || 'agentTurn';
      f.payloadText = p.text || p.message || '';
      if (p.timeoutSeconds) f.timeoutSeconds = String(p.timeoutSeconds);
      if (p.model) f.payloadModel = p.model;
      if (p.thinking) f.payloadThinking = p.thinking;
      if (p.lightContext) f.payloadLightContext = true;
    }

    // delivery
    const d = job.delivery;
    if (d) {
      f.deliveryMode = d.mode || 'none';
      f.deliveryChannel = d.channel || '';
      f.deliveryTo = d.to || '';
      f.deliveryBestEffort = !!d.bestEffort;
    }

    // failure alert
    const fa = job.failureAlert;
    if (fa === false) {
      f.failureAlertMode = 'disabled';
    } else if (fa && typeof fa === 'object') {
      f.failureAlertMode = 'custom';
      f.failureAlertAfter = String(fa.after || 3);
      f.failureAlertCooldownSeconds = String((fa.cooldownMs || 300000) / 1000);
      f.failureAlertChannel = fa.channel || '';
      f.failureAlertTo = fa.to || '';
    }

    if (job.deleteAfterRun) f.deleteAfterRun = true;

    return f;
  }

  // ============================================================
  // 工具
  // ============================================================

  _esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
