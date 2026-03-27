// ============================================================
// 连接状态（移植自官方，增加 ClawDeck 缺失状态）
// ============================================================
/**
 * 完整连接生命周期状态
 *
 * 官方 GatewayBrowserClient 隐式状态 → ClawDeck 显式枚举：
 *   closed=true, ws=null           → DISCONNECTED
 *   ws created, readyState!=OPEN   → CONNECTING
 *   readyState=OPEN, 等 challenge  → HANDSHAKING（新增）
 *   connectSent=true, 等 hello-ok  → HANDSHAKING（新增）
 *   hello-ok received              → CONNECTED
 *   ws closed, scheduleReconnect   → RECONNECTING（新增）
 *   connect rejected / auth failed → AUTH_FAILED（新增）
 */
export const GW_STATUS = {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    HANDSHAKING: 'handshaking',
    CONNECTED: 'connected',
    RECONNECTING: 'reconnecting',
    AUTH_FAILED: 'auth_failed',
};
// ============================================================
// 连接错误（移植自官方 connect-error-details.ts）
// ============================================================
export const ConnectErrorCodes = {
    AUTH_REQUIRED: 'AUTH_REQUIRED',
    AUTH_UNAUTHORIZED: 'AUTH_UNAUTHORIZED',
    AUTH_TOKEN_MISSING: 'AUTH_TOKEN_MISSING',
    AUTH_TOKEN_MISMATCH: 'AUTH_TOKEN_MISMATCH',
    AUTH_TOKEN_NOT_CONFIGURED: 'AUTH_TOKEN_NOT_CONFIGURED',
    AUTH_PASSWORD_MISSING: 'AUTH_PASSWORD_MISSING',
    AUTH_PASSWORD_MISMATCH: 'AUTH_PASSWORD_MISMATCH',
    AUTH_PASSWORD_NOT_CONFIGURED: 'AUTH_PASSWORD_NOT_CONFIGURED',
    AUTH_DEVICE_TOKEN_MISMATCH: 'AUTH_DEVICE_TOKEN_MISMATCH',
    AUTH_RATE_LIMITED: 'AUTH_RATE_LIMITED',
    DEVICE_IDENTITY_REQUIRED: 'DEVICE_IDENTITY_REQUIRED',
    DEVICE_AUTH_INVALID: 'DEVICE_AUTH_INVALID',
    DEVICE_AUTH_SIGNATURE_EXPIRED: 'DEVICE_AUTH_SIGNATURE_EXPIRED',
    DEVICE_AUTH_NONCE_MISMATCH: 'DEVICE_AUTH_NONCE_MISMATCH',
    DEVICE_AUTH_SIGNATURE_INVALID: 'DEVICE_AUTH_SIGNATURE_INVALID',
    PAIRING_REQUIRED: 'PAIRING_REQUIRED',
};
/** Gateway close code 描述（移植自官方 GATEWAY_CLOSE_CODE_HINTS） */
export const CLOSE_CODE_HINTS = {
    1000: 'normal closure',
    1006: 'abnormal closure (no close frame)',
    1008: 'policy violation',
    1012: 'service restart',
    4000: 'watchdog heartbeat timeout',
    4008: 'connect failed',
};
