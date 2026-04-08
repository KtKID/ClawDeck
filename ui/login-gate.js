// ui/login-gate.js — Login Gate 组件（纯 JS，无框架依赖）
import { t } from '../i18n/index.js';

/**
 * 眼睛 SVG 图标（内联，避免额外请求）
 */
const ICON_EYE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const ICON_EYE_OFF = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

/** 全局错误码 → i18n key 映射 */
const AUTH_HINT_KEYS = {
  'AUTH_REQUIRED': 'overview.auth.required',
  'AUTH_TOKEN_MISMATCH': 'gateway.err.token_mismatch',
  'AUTH_PASSWORD_MISMATCH': 'gateway.err.password_mismatch',
  'AUTH_RATE_LIMITED': 'gateway.err.rate_limited',
  'PAIRING_REQUIRED': 'overview.pairing.hint',
  'DEVICE_IDENTITY_REQUIRED': 'gateway.err.device_identity_required',
  'DEVICE_TOKEN_MISMATCH': 'gateway.err.device_token_mismatch',
  'CONNECT_FAILED': 'gateway.err.connect_failed',
  'HANDSHAKE_TIMEOUT': 'gateway.err.handshake_timeout',
  'UNKNOWN_AUTH': 'gateway.err.unknown_auth',
};

export class LoginGate {
  /** @type {HTMLElement|null} */
  #overlay = null;

  /** @type {HTMLInputElement|null} */
  #wsInput = null;
  #tokenInput = null;
  #pwInput = null;

  /** @type {boolean} */
  #showToken = false;
  #showPassword = false;

  /** @type {import('../bridge/gateway-client.js').GatewayClient} */
  #gateway;

  /** @type {(hide: () => void) => void} */
  #onConnected;

  /**
   * @param {import('../bridge/gateway-client.js').GatewayClient} gateway
   * @param {(hide: () => void) => void} onConnected - 连接成功后调用，传入 hide() 回调用于卸载 Login Gate
   */
  constructor(gateway, onConnected) {
    this.#gateway = gateway;
    this.#onConnected = onConnected;
  }

  /** 挂载到 document.body 并绑定 gateway 事件 */
  mount() {
    this.#buildDOM();
    document.body.appendChild(this.#overlay);

    this.#gateway.on('connected', () => {
      // 通知调用者连接成功，传入 hide 回调让 workshop 显示后自动卸载 Login Gate
      this.#onConnected(() => this.unmount());
    });

    this.#gateway.on('error', ({ code, message }) => {
      this.#showError(code, message);
    });

    // 初始状态：已连接则立即隐藏（无需两次触发）
    if (this.#gateway.connected) {
      this.#onConnected(() => this.unmount());
    }
  }

  /** 卸载 DOM */
  unmount() {
    this.#overlay?.remove();
    this.#overlay = null;
  }

  #buildDOM() {
    this.#overlay = document.createElement('div');
    this.#overlay.className = 'login-gate';
    this.#overlay.innerHTML = `
      <div class="login-gate__card">
        <div class="login-gate__header">
          <img class="login-gate__logo" src="img/cat-idle.png" alt="ClawDeck" />
          <div class="login-gate__title">${t('login.title')}</div>
          <div class="login-gate__sub">${t('login.subtitle')}</div>
        </div>
        <div class="login-gate__form">
          <label class="field">
            <span>${t('overview.access.wsUrl')}</span>
            <input
              id="lg-ws"
              type="text"
              autocomplete="url"
              spellcheck="false"
              placeholder="ws://127.0.0.1:16968"
            />
          </label>
          <label class="field">
            <span>${t('overview.access.token')}</span>
            <div class="login-gate__secret-row">
              <input
                id="lg-token"
                type="password"
                autocomplete="off"
                spellcheck="false"
                placeholder="${t('login.passwordPlaceholder')}"
              />
              <button type="button" class="btn btn--icon lg-toggle-token" aria-label="Toggle token visibility" title="Show/Hide token">
                ${ICON_EYE}
              </button>
            </div>
          </label>
          <label class="field">
            <span>${t('overview.access.password')}</span>
            <div class="login-gate__secret-row">
              <input
                id="lg-pw"
                type="password"
                autocomplete="off"
                spellcheck="false"
                placeholder="${t('login.passwordPlaceholder')}"
              />
              <button type="button" class="btn btn--icon lg-toggle-pw" aria-label="Toggle password visibility" title="Show/Hide password">
                ${ICON_EYE}
              </button>
            </div>
          </label>
          <button class="btn primary login-gate__connect" id="lg-connect">
            ${t('common.connect')}
          </button>
        </div>
        <div class="login-gate__error callout danger" id="lg-error" style="display:none"></div>
        <div class="login-gate__help">
          <div class="login-gate__help-title">${t('overview.connection.title')}</div>
          <ol class="login-gate__steps">
            <li>${t('overview.connection.step1')}<code>openclaw gateway run</code></li>
            <li>${t('overview.connection.step2')}<code>openclaw dashboard --no-open</code></li>
            <li>${t('overview.connection.step3')}</li>
          </ol>
          <div class="login-gate__docs">
            <a class="session-link" href="https://docs.openclaw.ai/web/dashboard" target="_blank" rel="noreferrer">
              ${t('overview.connection.docsLink')}
            </a>
          </div>
        </div>
      </div>
    `;

    // 缓存 input 引用
    this.#wsInput = this.#overlay.querySelector('#lg-ws');
    this.#tokenInput = this.#overlay.querySelector('#lg-token');
    this.#pwInput = this.#overlay.querySelector('#lg-pw');

    // 预填已有配置
    if (this.#gateway.url) this.#wsInput.value = this.#gateway.url;
    if (this.#gateway.token) this.#tokenInput.value = this.#gateway.token;

    // 绑定按钮事件
    this.#overlay.querySelector('#lg-connect').addEventListener('click', () => this.#doConnect());
    this.#wsInput.addEventListener('keydown', e => { if (e.key === 'Enter') this.#doConnect(); });
    this.#tokenInput.addEventListener('keydown', e => { if (e.key === 'Enter') this.#doConnect(); });
    this.#pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') this.#doConnect(); });

    // 眼睛切换：token
    const tokenToggle = this.#overlay.querySelector('.lg-toggle-token');
    tokenToggle.addEventListener('click', () => {
      this.#showToken = !this.#showToken;
      this.#tokenInput.type = this.#showToken ? 'text' : 'password';
      tokenToggle.innerHTML = this.#showToken ? ICON_EYE_OFF : ICON_EYE;
      tokenToggle.setAttribute('aria-pressed', String(this.#showToken));
    });

    // 眼睛切换：password
    const pwToggle = this.#overlay.querySelector('.lg-toggle-pw');
    pwToggle.addEventListener('click', () => {
      this.#showPassword = !this.#showPassword;
      this.#pwInput.type = this.#showPassword ? 'text' : 'password';
      pwToggle.innerHTML = this.#showPassword ? ICON_EYE_OFF : ICON_EYE;
      pwToggle.setAttribute('aria-pressed', String(this.#showPassword));
    });
  }

  #doConnect() {
    const wsUrl = this.#wsInput.value.trim();
    const token = this.#tokenInput.value;
    const password = this.#pwInput.value;
    this.#hideError();
    // applyConfig + connect 会处理空值
    this.#gateway.connect(wsUrl || undefined, token || undefined, password || undefined);
  }

  #showError(code, message) {
    const el = this.#overlay?.querySelector('#lg-error');
    if (!el) return;

    // 优先用 i18n 翻译错误码，否则用原始消息
    let hintKey = AUTH_HINT_KEYS[code];
    let text;
    if (hintKey) {
      // PAIRING_REQUIRED 特殊处理：加移动端提示
      if (code === 'PAIRING_REQUIRED') {
        text = t('overview.pairing.hint') + '\n' + t('overview.pairing.mobileHint');
      } else {
        text = t(hintKey, { reason: message });
      }
    } else if (code) {
      text = t('overview.auth.failed', { reason: message || code });
    } else {
      text = message || t('overview.auth.required');
    }

    el.textContent = text;
    el.style.display = 'block';
  }

  #hideError() {
    const el = this.#overlay?.querySelector('#lg-error');
    if (el) el.style.display = 'none';
  }
}
