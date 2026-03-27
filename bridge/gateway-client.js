import { GW_STATUS, ConnectErrorCodes, CLOSE_CODE_HINTS, } from './types.js';
import { Storage } from './storage.js';
// Re-export for convenience
export { GW_STATUS, ConnectErrorCodes, CLOSE_CODE_HINTS } from './types.js';
export { Storage } from './storage.js';
const DEVICE_IDENTITY_KEY = 'openclaw-device-identity-v1';
function b64urlEncode(bytes) {
    let binary = '';
    for (const b of bytes)
        binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
    const norm = s.replace(/-/g, '+').replace(/_/g, '/');
    const padded = norm + '='.repeat((4 - norm.length % 4) % 4);
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        out[i] = bin.charCodeAt(i);
    return out;
}
async function fingerprintPublicKey(pubKeyBytes) {
    const hash = await crypto.subtle.digest('SHA-256', pubKeyBytes.buffer);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function generateDeviceIdentity() {
    // Ed25519 key pair via SubtleCrypto
    const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const pubKeyBuf = await crypto.subtle.exportKey('raw', keyPair.publicKey);
    const privKeyBuf = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
    // Ed25519 raw private key is the last 32 bytes of the PKCS8 DER structure
    const privBytes = new Uint8Array(privKeyBuf).slice(-32);
    const pubBytes = new Uint8Array(pubKeyBuf);
    const deviceId = await fingerprintPublicKey(pubBytes);
    const publicKey = b64urlEncode(pubBytes);
    const privateKey = b64urlEncode(privBytes);
    return { version: 1, deviceId, publicKey, privateKey, createdAtMs: Date.now() };
}
async function loadOrCreateDeviceIdentity() {
    if (typeof crypto === 'undefined' || !crypto.subtle)
        return null;
    try {
        const raw = localStorage.getItem(DEVICE_IDENTITY_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.version === 1 && parsed.deviceId && parsed.publicKey && parsed.privateKey) {
                return parsed;
            }
        }
    }
    catch { /* fall through */ }
    try {
        const identity = await generateDeviceIdentity();
        localStorage.setItem(DEVICE_IDENTITY_KEY, JSON.stringify(identity));
        return identity;
    }
    catch (e) {
        console.warn('[GatewayClient] device identity generation failed:', e);
        return null;
    }
}
async function signDevicePayload(privateKeyB64url, payload) {
    try {
        // Import Ed25519 private key from raw bytes (PKCS8 wrapping required for SubtleCrypto)
        const rawPriv = b64urlDecode(privateKeyB64url);
        // PKCS8 prefix for Ed25519: 30 2e 02 01 00 30 05 06 03 2b 65 70 04 22 04 20 + 32 bytes
        const pkcs8Prefix = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
        const pkcs8 = new Uint8Array(pkcs8Prefix.length + 32);
        pkcs8.set(pkcs8Prefix);
        pkcs8.set(rawPriv, pkcs8Prefix.length);
        const key = await crypto.subtle.importKey('pkcs8', pkcs8.buffer, { name: 'Ed25519' }, false, ['sign']);
        const data = new TextEncoder().encode(payload);
        const sig = await crypto.subtle.sign({ name: 'Ed25519' }, key, data);
        return b64urlEncode(new Uint8Array(sig));
    }
    catch (e) {
        console.warn('[GatewayClient] sign failed:', e);
        return null;
    }
}
/** 构建设备认证 payload 字符串（移植自官方 buildDeviceAuthPayload） */
function buildDeviceAuthPayload(params) {
    return [
        'v2',
        params.deviceId,
        params.clientId,
        params.clientMode,
        params.role,
        params.scopes.join(','),
        String(params.signedAtMs),
        params.token ?? '',
        params.nonce,
    ].join('|');
}
// ============================================================
// EventEmitter
// ============================================================
export class EventEmitter {
    constructor() {
        this._listeners = {};
    }
    on(event, fn) {
        var _a;
        ((_a = this._listeners)[event] || (_a[event] = [])).push(fn);
        return this;
    }
    off(event, fn) {
        const list = this._listeners[event];
        if (list) {
            const idx = list.indexOf(fn);
            if (idx >= 0)
                list.splice(idx, 1);
        }
        return this;
    }
    _emit(event, ...args) {
        (this._listeners[event] || []).forEach(fn => fn(...args));
    }
}
// ============================================================
// Constants
// ============================================================
const DEVICE_TOKEN_KEY = 'openclaw.device.auth.v1';
const DEFAULT_WS_URL = 'ws://127.0.0.1:16968';
// 4008 = 官方定义的连接失败关闭码（浏览器禁止客户端使用 1008）
const CONNECT_FAILED_CLOSE_CODE = 4008;
/** 指数退避参数（移植自官方 gateway.ts） */
const BACKOFF_INITIAL = 800;
const BACKOFF_MULTIPLIER = 1.7;
const BACKOFF_MAX = 15000;
/** 所有已知的认证错误码集合，用于 AUTH_FAILED 判定 */
const AUTH_ERROR_CODES = new Set(Object.values(ConnectErrorCodes));
export class GatewayClient extends EventEmitter {
    /** 当前是否存在活动中的连接/重连流程 */
    get hasActiveConnection() {
        return this._status === GW_STATUS.CONNECTING
            || this._status === GW_STATUS.HANDSHAKING
            || this._status === GW_STATUS.RECONNECTING
            || this._status === GW_STATUS.CONNECTED;
    }
    constructor(opts = {}) {
        super();
        this._ws = null;
        this._requestId = 0;
        this._pending = new Map();
        this._status = GW_STATUS.DISCONNECTED;
        this._handshakeDone = false;
        this._reconnectTimer = null;
        this._stopped = true; // 是否主动停止（阻止自动重连）
        /** 指数退避当前值 */
        this._backoff = BACKOFF_INITIAL;
        /** 事件序列号（用于 gap 检测） */
        this._lastSeq = -1;
        // === 公开只读属性 ===
        /** hello-ok 响应数据，连接成功后可用 */
        this.hello = null;
        /** 最近一次错误的可读描述 */
        this.lastError = null;
        /** 最近一次错误的结构化错误码 */
        this.lastErrorCode = null;
        /** 重连次数计数（连接成功后重置） */
        this._reconnectCount = 0;
        // 向后兼容：第一个参数为 string 时视为 wsUrl
        if (typeof opts === 'string') {
            opts = { url: opts };
        }
        // url/token 优先从 opts，其次从 Storage，再 fallback 默认值
        this.url = opts.url || Storage.get('url') || DEFAULT_WS_URL;
        this.token = opts.token ?? (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('token') : null) ?? undefined;
        this.password = opts.password ?? undefined;
        this.deviceToken = (typeof localStorage !== 'undefined' ? localStorage.getItem(DEVICE_TOKEN_KEY) : null) ?? undefined;
    }
    // ============================================================
    // 状态管理
    // ============================================================
    get status() {
        return this._status;
    }
    /** 向后兼容：握手完成 = connected */
    get connected() {
        return this._status === GW_STATUS.CONNECTED;
    }
    _setStatus(status) {
        if (this._status === status)
            return;
        const prevStatus = this._status;
        this._status = status;
        console.log(`[GatewayClient] status: ${prevStatus} -> ${status}`);
        this._emit('status', status);
    }
    // ============================================================
    // 连接管理
    // ============================================================
    applyConfig(url, token, password) {
        if (url !== undefined) {
            this.url = url.trim() || DEFAULT_WS_URL;
            Storage.set('url', this.url);
        }
        if (token !== undefined) {
            this.token = token.trim() || undefined;
            if (this.token) {
                Storage.set('token', this.token);
            }
            else {
                Storage.remove('token');
            }
        }
        if (password !== undefined) {
            this.password = password.trim() || undefined;
        }
    }
    /**
     * 建立连接。传参时先应用配置，再启动新的连接链路。
     * @param url  可选，传入后覆盖并持久化
     * @param token  可选，传入后覆盖并持久化
     */
    connect(url, token, password) {
        console.log(`[GatewayClient] connect() called, url=${url || this.url}, token=${token ? 'provided' : 'none'}, password=${password ? 'provided' : 'none'}, deviceToken=${this.deviceToken ? 'exists' : 'none'}`);
        this.applyConfig(url, token, password);
        this._startConnectionFlow();
    }
    /** 用当前配置重新启动连接链路 */
    reconnect() {
        this._startConnectionFlow();
    }
    /** 停止连接（对齐官方 stop() 命名） */
    stop() {
        console.log('[GatewayClient] stop() called, stopping active connection flow');
        this._stopped = true;
        this._clearReconnectTimer();
        this._teardownSocket(true);
        this._handshakeDone = false;
        this._flushPendingErrors('connection stopped');
        this._setStatus(GW_STATUS.DISCONNECTED);
    }
    _startConnectionFlow() {
        this._stopped = false;
        this._clearReconnectTimer();
        this._teardownSocket(true);
        this._handshakeDone = false;
        this._flushPendingErrors('connection restarted');
        this._doConnect();
    }
    _teardownSocket(suppressCloseHandler = false) {
        if (!this._ws)
            return;
        if (suppressCloseHandler) {
            this._ws.onclose = null;
        }
        this._ws.close();
        this._ws = null;
    }
    /** 别名 */
    disconnect() {
        this.stop();
    }
    // ============================================================
    // RPC 调用
    // ============================================================
    call(method, params = {}, timeout = 10000) {
        return new Promise((resolve, reject) => {
            if (!this._handshakeDone || this._status !== GW_STATUS.CONNECTED) {
                reject(new Error('Not connected'));
                return;
            }
            const id = String(++this._requestId);
            const timer = setTimeout(() => {
                this._pending.delete(id);
                reject(new Error(`Timeout: ${method}`));
            }, timeout);
            this._pending.set(id, { resolve, reject, timer });
            this._ws.send(JSON.stringify({
                type: 'req',
                id,
                method,
                params,
            }));
        });
    }
    // ============================================================
    // 便捷方法（保持不变）
    // ============================================================
    async sendInstruction(sessionKey, message) {
        const idempotencyKey = `instruct-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        return this.call('chat.send', { sessionKey, message, idempotencyKey });
    }
    async abortSession(sessionKey) {
        return this.call('chat.abort', { sessionKey });
    }
    async resolveApproval(approvalId, decision = 'allow-once') {
        return this.call('exec.approval.resolve', { id: approvalId, decision });
    }
    /** @deprecated 使用 sendInstruction/abortSession/resolveApproval 替代 */
    async sendAction(action, sessionId, instruction) {
        return this.call('clawdeck.action', { action, sessionId, instruction });
    }
    async pollLogs(sinceId = 0) {
        return this.call('clawdeck.logs', { sinceId });
    }
    /** 向 idle Agent 发送消息并创建新会话（对应 Gateway `agent` RPC） */
    async startAgentChat(agentId, message) {
        const idempotencyKey = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        return this.call('agent', { agentId, message, idempotencyKey });
    }
    // ============================================================
    // 内部：连接实现
    // ============================================================
    _doConnect() {
        this._handshakeDone = false;
        this._setStatus(GW_STATUS.CONNECTING);
        try {
            console.log(`[GatewayClient] creating WebSocket to ${this.url}...`);
            this._ws = new WebSocket(this.url);
        }
        catch (err) {
            this.lastError = `WebSocket creation failed: ${err.message}`;
            console.error(`[GatewayClient] WebSocket creation failed: ${err.message}, stack: ${err.stack}`);
            this._setStatus(GW_STATUS.DISCONNECTED);
            this._scheduleReconnect();
            return;
        }
        this._ws.onopen = () => {
            console.log('[GatewayClient] WebSocket open, waiting for challenge...');
            this._setStatus(GW_STATUS.HANDSHAKING);
        };
        this._ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                this._handleMessage(msg);
            }
            catch (err) {
                console.warn('[GatewayClient] parse error:', err);
            }
        };
        this._ws.onerror = () => {
            // onerror 不携带有用信息，onclose 会紧随其后
        };
        this._ws.onclose = (e) => {
            const wasConnected = this._status === GW_STATUS.CONNECTED;
            this._handshakeDone = false;
            this._flushPendingErrors('connection closed');
            // 1012 = service restart，静默重连（移植自官方 app-gateway.ts）
            if (e.code === 1012) {
                console.log('[GatewayClient] service restart (1012), reconnecting silently...');
            }
            else {
                const hint = CLOSE_CODE_HINTS[e.code] || '';
                const desc = hint ? ` (${hint})` : '';
                if (wasConnected) {
                    console.warn(`[GatewayClient] disconnected code=${e.code}${desc}`);
                }
                else {
                    console.warn(`[GatewayClient] connection failed code=${e.code}${desc} reason=${e.reason}`);
                }
                // 非 1012 才设置 lastError
                if (e.code !== 1000) {
                    this.lastError = `WebSocket closed: code=${e.code}${desc}`;
                }
            }
            this._emit('disconnected', { code: e.code, reason: e.reason });
            this._scheduleReconnect();
        };
    }
    // ============================================================
    // 内部：指数退避重连
    // ============================================================
    _scheduleReconnect() {
        if (this._stopped) {
            console.log(`[GatewayClient] reconnect skipped: _stopped=true, setting DISCONNECTED`);
            this._setStatus(GW_STATUS.DISCONNECTED);
            return;
        }
        if (this._status === GW_STATUS.AUTH_FAILED) {
            // 认证失败不自动重连
            console.log(`[GatewayClient] reconnect skipped: AUTH_FAILED, will not auto-reconnect`);
            return;
        }
        this._setStatus(GW_STATUS.RECONNECTING);
        const delay = this._backoff;
        this._backoff = Math.min(this._backoff * BACKOFF_MULTIPLIER, BACKOFF_MAX);
        this._reconnectCount++;
        console.log(`[GatewayClient] scheduling reconnect #${this._reconnectCount} in ${delay}ms (backoff=${this._backoff}, max=${BACKOFF_MAX})...`);
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            console.log(`[GatewayClient] reconnect timer fired, starting connection attempt #${this._reconnectCount}...`);
            this._doConnect();
        }, delay);
    }
    _clearReconnectTimer() {
        if (this._reconnectTimer !== null) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
    }
    /** 连接成功后重置退避 */
    _resetBackoff() {
        this._backoff = BACKOFF_INITIAL;
    }
    // ============================================================
    // 内部：消息处理
    // ============================================================
    _handleMessage(msg) {
        // 1. 事件帧
        if (msg.type === 'event') {
            // 握手第一步：challenge
            if (msg.event === 'connect.challenge') {
                const nonce = msg.payload?.nonce;
                if (!nonce) {
                    console.error('[GatewayClient] challenge missing nonce');
                    this._ws?.close(CONNECT_FAILED_CLOSE_CODE, 'missing nonce');
                    return;
                }
                console.log('[GatewayClient] received challenge, sending connect...');
                void this._sendConnect(nonce);
                return;
            }
            // gap 检测（移植自官方 gateway.ts:300-306）
            if (msg.seq != null) {
                if (this._lastSeq >= 0 && msg.seq !== this._lastSeq + 1) {
                    this._emit('gap', { expected: this._lastSeq + 1, received: msg.seq });
                }
                this._lastSeq = msg.seq;
            }
            // 透传推送事件
            if (msg.event) {
                this._emit(msg.event, msg.payload ?? msg);
            }
            return;
        }
        // 2. 响应帧
        if (msg.type === 'res' && msg.id != null) {
            const pending = this._pending.get(msg.id);
            if (!pending)
                return;
            this._pending.delete(msg.id);
            clearTimeout(pending.timer);
            if (msg.ok) {
                pending.resolve(msg.payload ?? msg);
            }
            else {
                const err = new Error(msg.error?.message ?? 'RPC error');
                err.code = msg.error?.code;
                err.details = msg.error?.details;
                pending.reject(err);
            }
            return;
        }
    }
    // ============================================================
    // 内部：握手
    // ============================================================
    async _sendConnect(nonce) {
        const id = String(++this._requestId);
        const clientId = 'webchat-ui';
        const clientMode = 'webchat';
        const role = 'operator';
        const scopes = ['operator.admin', 'operator.approvals', 'operator.pairing'];
        // 认证对象：gateway token 和 device token 分开发送（对齐官方 UI）
        const gatewayToken = this.token?.trim() || undefined;
        const authPassword = this.password?.trim() || undefined;
        // 没有显式 gateway token / password 时，回退使用存储的 device token
        const resolvedDeviceToken = !(gatewayToken || authPassword)
            ? (this.deviceToken ?? undefined)
            : undefined;
        const authToken = gatewayToken ?? resolvedDeviceToken;
        const auth = (authToken || authPassword) ? {
            token: authToken,
            deviceToken: (gatewayToken && this.deviceToken) ? this.deviceToken : undefined,
            password: authPassword,
        } : undefined;
        const params = {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
                id: clientId,
                displayName: 'ClawDeck',
                version: '0.1.0',
                platform: (typeof navigator !== 'undefined' ? navigator.platform : undefined) ?? 'browser',
                mode: clientMode,
            },
            caps: ['tool-events'],
            role,
            scopes,
            auth,
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
            locale: typeof navigator !== 'undefined' ? navigator.language : undefined,
        };
        // 设备身份认证（新版 OC 要求）
        const deviceIdentity = await loadOrCreateDeviceIdentity();
        if (deviceIdentity) {
            const signedAtMs = Date.now();
            const payload = buildDeviceAuthPayload({
                deviceId: deviceIdentity.deviceId,
                clientId,
                clientMode,
                role,
                scopes,
                signedAtMs,
                token: gatewayToken ?? null,
                nonce,
            });
            const signature = await signDevicePayload(deviceIdentity.privateKey, payload);
            if (signature) {
                params.device = {
                    id: deviceIdentity.deviceId,
                    publicKey: deviceIdentity.publicKey,
                    signature,
                    signedAt: signedAtMs,
                    nonce,
                };
            }
        }
        this._pending.set(id, {
            resolve: (payload) => {
                // 保存 hello-ok 数据
                this.hello = payload;
                // 检查并保存设备 Token
                const newDeviceToken = payload?.auth?.deviceToken;
                if (newDeviceToken) {
                    localStorage.setItem(DEVICE_TOKEN_KEY, newDeviceToken);
                    this.deviceToken = newDeviceToken;
                    console.log('[GatewayClient] device token updated');
                }
                this._handshakeDone = true;
                this._lastSeq = -1; // 重置序列号
                this._resetBackoff();
                this.lastError = null;
                this.lastErrorCode = null;
                // 连接成功后重置重连计数
                if (this._reconnectCount > 0) {
                    console.log(`[GatewayClient] handshake complete, connected after ${this._reconnectCount} reconnection attempts`);
                }
                else {
                    console.log('[GatewayClient] handshake complete, connected');
                }
                this._reconnectCount = 0;
                this._setStatus(GW_STATUS.CONNECTED);
                this._emit('connected', this.hello);
            },
            reject: (err) => {
                const errorCode = err.details?.code || err.code;
                console.error(`[GatewayClient] handshake failed: ${err.message}, code: ${errorCode}, details: ${JSON.stringify(err.details)}`);
                // AUTH_FAILED 判定（移植自官方 connect-error-details.ts）
                if (errorCode && AUTH_ERROR_CODES.has(errorCode)) {
                    this.lastError = err.message;
                    this.lastErrorCode = errorCode;
                    console.warn(`[GatewayClient] AUTH_FAILED, errorCode: ${errorCode}, message: ${err.message}`);
                    // DEVICE_TOKEN_MISMATCH 时清除设备 token
                    if (errorCode === ConnectErrorCodes.AUTH_DEVICE_TOKEN_MISMATCH && this.deviceToken) {
                        localStorage.removeItem(DEVICE_TOKEN_KEY);
                        this.deviceToken = undefined;
                        console.log('[GatewayClient] device token cleared due to mismatch');
                    }
                    this._setStatus(GW_STATUS.AUTH_FAILED);
                    this._emit('error', { message: err.message, code: errorCode, details: err.details });
                    this._ws?.close(CONNECT_FAILED_CLOSE_CODE, 'auth failed');
                    return;
                }
                // 非认证错误，正常关闭让 onclose 处理重连
                this.lastError = err.message;
                console.warn(`[GatewayClient] non-auth handshake error, will reconnect: ${err.message}`);
                this._emit('error', { message: err.message, code: errorCode });
                this._ws?.close(CONNECT_FAILED_CLOSE_CODE, 'handshake failed');
            },
            timer: setTimeout(() => {
                this._pending.delete(id);
                this.lastError = 'handshake timeout';
                console.error('[GatewayClient] handshake timeout (10s), closing WebSocket');
                this._ws?.close(CONNECT_FAILED_CLOSE_CODE, 'handshake timeout');
            }, 10000),
        });
        this._ws.send(JSON.stringify({
            type: 'req',
            id,
            method: 'connect',
            params,
        }));
    }
    _flushPendingErrors(reason) {
        for (const [id, { reject, timer }] of this._pending) {
            clearTimeout(timer);
            reject(new Error(reason));
        }
        this._pending.clear();
    }
}
