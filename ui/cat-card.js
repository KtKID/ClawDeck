// ui/cat-card.js — 猫咪卡片 UI 组件

import { getStatusInfo } from './cat-data-mapper.js';
import { t } from '../i18n/index.js';

// 常量定义
const ANIMATION_DURATION = {
  SUCCESS: 600,
  ERROR: 1500,
};

export class CatCard {
  /**
   * @param {HTMLElement} container
   * @param {{
   *   id: string,
   *   name: string,
   *   icon: string,
   *   characteristics: string | null,
   *   status: 'idle' | 'working' | 'pending' | 'error',
   *   currentTask: string | null,
   *   latestStep: string | null,
   *   avatarUrl: string | null,
   *   traits: string[] | null,
   *   onSendCommand: ((message: string) => Promise<void>) | null,
   *   onNewSessionClick: (() => void) | null,
   *   onChatClick: ((agentId: string) => void) | null
   * }} props
   */
  constructor(container, props) {
    this.el = document.createElement('div');
    this.el.className = 'cat-card entering';
    this.el.dataset.agentId = props.id;
    container.appendChild(this.el);

    this._props = props;
    this._isSending = false;
    // 保存事件监听器引用，用于清理
    this._handleSend = null;
    this._handleKeypress = null;
    this._handleChatBubble = null;
    this._handleAvatarError = null;
    this._render();
  }

  /**
   * 更新卡片数据
   * @param {object} props
   */
  update(props) {
    this._props = { ...this._props, ...props };
    this._render();
  }

  /**
   * 渲染 UI
   */
  _render() {
    const props = this._props;
    const statusInfo = getStatusInfo(props.status);

    const traitsText = Array.isArray(props.traits) && props.traits.length > 0
      ? props.traits.join(" / ")
      : "";
    const avatarClass = props.avatarUrl ? "has-image" : "";
    const avatarHtml = props.avatarUrl
      ? `<img class="cat-avatar-img" src="${this._escapeHtml(props.avatarUrl)}" alt="${this._escapeHtml(props.name)}">`
      : this._escapeHtml(props.icon);

    // 根据状态确定 placeholder
    const placeholder = props.status === 'idle' ? t('cat.dispatch_placeholder') : t('cat.supplement_placeholder');

    // 获取任务显示内容
    const taskContent = this._getTaskContent();

    this.el.innerHTML = `
      <div class="cat-card-header">
        <span class="cat-status ${statusInfo.className}">
          ${statusInfo.icon} ${statusInfo.label}
        </span>
      </div>
      <div class="cat-avatar-wrapper">
        <div class="cat-avatar ${props.status} ${avatarClass}">
          ${avatarHtml}
        </div>
        <button class="cat-chat-bubble" title="${t('cat.btn_chat')}" ${props.onChatClick ? '' : 'disabled'}>
          💬
        </button>
      </div>
      <div class="cat-name">${this._escapeHtml(props.name)}</div>
      ${traitsText ? `<div class="cat-role">${this._escapeHtml(traitsText)}</div>` : ""}
      ${props.characteristics ? `<div class="cat-characteristics">${this._escapeHtml(props.characteristics)}</div>` : ''}
      <div class="cat-task">
        <div class="cat-task-label">${t('cat.current_order')}</div>
        <div class="cat-task-content" title="${this._escapeHtml(taskContent)}">
          ${this._escapeHtml(taskContent)}
        </div>
      </div>
      ${props.usage && (props.usage.input > 0 || props.usage.output > 0) ? `
      <div class="cat-task" style="margin-top: 4px;">
        <div class="cat-task-label">${t('cat.today_token')}</div>
        <div class="cat-task-content" style="color: var(--text-secondary); opacity: 0.9;">
          ${this._escapeHtml(this._formatTokenUsage(props.usage))}
        </div>
      </div>
      ` : ''}
      <div class="cat-command">
        <input
          type="text"
          placeholder="${placeholder}"
          ${this._isSending ? 'disabled' : ''}
        >
        <button class="cat-cmd-send" ${this._isSending ? 'disabled' : ''}>
          ${this._isSending ? '...' : '➤'}
        </button>
        ${props.onNewSessionClick ? `
          <button class="cat-cmd-new" title="${t('cat.btn_new_session')}">
            +
          </button>
        ` : ''}
      </div>
    `;

    // 绑定事件
    this._bindEvents();
    this._bindAvatarImage();
  }

  /**
   * Handle avatar image load failure
   */
  _bindAvatarImage() {
    const avatarImg = this.el.querySelector(".cat-avatar-img");
    if (!avatarImg) {
      this._handleAvatarError = null;
      return;
    }
    if (this._handleAvatarError) {
      avatarImg.removeEventListener("error", this._handleAvatarError);
    }
    this._handleAvatarError = () => {
      const avatar = this.el.querySelector(".cat-avatar");
      if (!avatar) return;
      avatar.classList.remove("has-image");
      avatar.classList.add("avatar-missing");
      avatar.title = "Avatar load failed";
      avatar.innerHTML = this._escapeHtml(this._props.icon);
    };
    avatarImg.addEventListener("error", this._handleAvatarError, { once: true });
  }

  _getTaskContent() {
    const props = this._props;

    if (props.status === 'pending') {
      return t('cat.pending_approval', { task: props.currentTask || t('card.unnamed_task') });
    }

    if (props.status === 'idle') {
      return props.currentTask ? t('cat.completed', { task: props.currentTask }) : t('cat.no_task');
    }

    if (props.currentTask) {
      // 显示最新步骤或任务名称
      return props.latestStep || props.currentTask;
    }

    return t('cat.no_task');
  }

  /**
   * 绑定事件
   */
  _bindEvents() {
    // 事件委托绑在 this.el 上（永不被 innerHTML 替换）
    // 只绑一次，后续 _render 不需要重新绑定
    if (this._eventsBound) return;
    this._eventsBound = true;

    this.el.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;

      if (btn.classList.contains('cat-cmd-send')) {
        const input = this.el.querySelector('.cat-command input');
        const message = input?.value?.trim();
        if (!message || this._isSending) return;
        this._sendCommand(message);
      } else if (btn.classList.contains('cat-cmd-new')) {
        e.stopPropagation(); // 阻止冒泡到 document，避免 outside-click 立即关闭抽屉
        if (this._props.onNewSessionClick) {
          this._props.onNewSessionClick();
        }
      }
    });

    this.el.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && e.target.matches('.cat-command input')) {
        const message = e.target.value?.trim();
        if (!message || this._isSending) return;
        this._sendCommand(message);
      }
    });

    // 聊天气泡也通过委托处理
    this.el.addEventListener('click', (e) => {
      if (e.target.closest('.cat-chat-bubble') && this._props.onChatClick) {
        e.stopPropagation();
        this._props.onChatClick(this._props.sessionKey || this._props.id);
      }
    }, true);
  }

  /**
   * 发送命令
   */
  async _sendCommand(message) {
    if (!this._props.onSendCommand) {
      console.warn('CatCard: onSendCommand callback not provided');
      return;
    }

    this._isSending = true;
    this._render();

    try {
      await this._props.onSendCommand(message);

      // 发送成功
      this.el.classList.add('success');
      setTimeout(() => {
        this.el.classList.remove('success');
      }, ANIMATION_DURATION.SUCCESS);

      // 清空输入框
      const input = this.el.querySelector('.cat-command input');
      if (input) input.value = '';

    } catch (error) {
      console.error('CatCard: Failed to send command:', error);
      // 显示错误状态
      this.el.classList.add('error');
      setTimeout(() => {
        this.el.classList.remove('error');
      }, ANIMATION_DURATION.ERROR);
    } finally {
      this._isSending = false;
      this._render();
    }
  }

  /**
   * HTML 转义
   */
  _escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  _formatTokenUsage(usage) {
    if (!usage) return '--';
    const inTokens = this._formatTokenNumber(usage.input || 0);
    const outTokens = this._formatTokenNumber(usage.output || 0);
    return `↑${inTokens} / ↓${outTokens}`;
  }

  _formatTokenNumber(num) {
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  /**
   * 销毁卡片
   */
  destroy() {
    // 清理事件监听器
    const input = this.el.querySelector('.cat-command input');
    // 事件监听器绑在 this.el 上，remove 时自动 GC

    // 移除 DOM
    this.el.remove();
  }
}