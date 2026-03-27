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
export declare const GW_STATUS: {
    readonly DISCONNECTED: "disconnected";
    readonly CONNECTING: "connecting";
    readonly HANDSHAKING: "handshaking";
    readonly CONNECTED: "connected";
    readonly RECONNECTING: "reconnecting";
    readonly AUTH_FAILED: "auth_failed";
};
export type GwStatus = typeof GW_STATUS[keyof typeof GW_STATUS];
export declare const ConnectErrorCodes: {
    readonly AUTH_REQUIRED: "AUTH_REQUIRED";
    readonly AUTH_UNAUTHORIZED: "AUTH_UNAUTHORIZED";
    readonly AUTH_TOKEN_MISSING: "AUTH_TOKEN_MISSING";
    readonly AUTH_TOKEN_MISMATCH: "AUTH_TOKEN_MISMATCH";
    readonly AUTH_TOKEN_NOT_CONFIGURED: "AUTH_TOKEN_NOT_CONFIGURED";
    readonly AUTH_PASSWORD_MISSING: "AUTH_PASSWORD_MISSING";
    readonly AUTH_PASSWORD_MISMATCH: "AUTH_PASSWORD_MISMATCH";
    readonly AUTH_PASSWORD_NOT_CONFIGURED: "AUTH_PASSWORD_NOT_CONFIGURED";
    readonly AUTH_DEVICE_TOKEN_MISMATCH: "AUTH_DEVICE_TOKEN_MISMATCH";
    readonly AUTH_RATE_LIMITED: "AUTH_RATE_LIMITED";
    readonly DEVICE_IDENTITY_REQUIRED: "DEVICE_IDENTITY_REQUIRED";
    readonly DEVICE_AUTH_INVALID: "DEVICE_AUTH_INVALID";
    readonly DEVICE_AUTH_SIGNATURE_EXPIRED: "DEVICE_AUTH_SIGNATURE_EXPIRED";
    readonly DEVICE_AUTH_NONCE_MISMATCH: "DEVICE_AUTH_NONCE_MISMATCH";
    readonly DEVICE_AUTH_SIGNATURE_INVALID: "DEVICE_AUTH_SIGNATURE_INVALID";
    readonly PAIRING_REQUIRED: "PAIRING_REQUIRED";
};
export type ConnectErrorCode = typeof ConnectErrorCodes[keyof typeof ConnectErrorCodes];
/** Gateway close code 描述（移植自官方 GATEWAY_CLOSE_CODE_HINTS） */
export declare const CLOSE_CODE_HINTS: Record<number, string>;
export interface GatewayHelloOk {
    type: 'hello-ok';
    protocol: number;
    server?: {
        version?: string;
        connId?: string;
    };
    features?: {
        methods?: string[];
        events?: string[];
    };
    snapshot?: unknown;
    auth?: {
        deviceToken?: string;
        role?: string;
        scopes?: string[];
        issuedAtMs?: number;
    };
    policy?: {
        tickIntervalMs?: number;
    };
}
export interface GatewayErrorInfo {
    code: string;
    message: string;
    details?: unknown;
}
export interface GatewayAgentRow {
    id: string;
    name?: string;
    identity?: {
        name?: string;
        emoji?: string;
    };
}
export interface GatewaySessionRow {
    key: string;
    sessionId?: string;
    label?: string;
    displayName?: string;
    status?: string;
    abortedLastRun?: boolean;
    totalTokens?: number;
    lastMessage?: {
        role?: string;
        content?: any;
    };
    startTime?: number;
    lastActionTime?: number;
}
export interface SessionsUsageResult {
    totals?: {
        totalTokens?: number;
        totalCost?: number;
    };
}
export interface RpcRequest {
    type: 'req';
    id: string;
    method: string;
    params: Record<string, any>;
}
export interface RpcResponse {
    type: 'res';
    id: string;
    ok: boolean;
    payload?: any;
    error?: GatewayErrorInfo;
}
export interface EventFrame {
    type: 'event';
    event: string;
    payload?: any;
    seq?: number;
    stateVersion?: {
        presence: number;
        health: number;
    };
}
export interface MessageObject {
    role: 'assistant' | 'user';
    content: string | Array<{
        type: string;
        text?: string;
    }>;
    timestamp?: number;
}
export interface ChatPushPayload {
    sessionKey: string;
    runId: string;
    state: 'delta' | 'final' | 'aborted' | 'error';
    message?: MessageObject;
    errorMessage?: string;
}
export interface ApprovalPushPayload {
    requestId: string;
    toolName: string;
    sessionKey: string;
    expiresAtMs?: number;
}
export interface StorageSchema {
    'url': string;
    'token': string;
    'layout'?: any;
    'camera'?: any;
    'settings'?: any;
    'filters'?: any;
}
export type EventHandler = (...args: any[]) => void;
/** 会话运行状态类型 */
export type SessionRunStatus = 'idle' | 'running' | 'streaming' | 'tool' | 'error' | 'aborted';
/** 会话实时运行状态 */
export interface SessionRunState {
    /** 运行状态 */
    status: SessionRunStatus;
    /** 工具名称（stream=tool 时） */
    toolName?: string;
    /** 工具 emoji（从 TOOL_DISPLAY 映射） */
    toolEmoji?: string;
    /** 工具标题（从 TOOL_DISPLAY 映射） */
    toolTitle?: string;
    /** 当前 runId */
    runId?: string;
    /** 状态变更时间戳 */
    updatedAt: number;
    /** session 开始执行的时间戳（lifecycle.start 时记录） */
    startedAt?: number | null;
}
/** Agent 事件流类型 */
export type AgentEventStream = 'lifecycle' | 'tool' | 'assistant' | 'error' | string;
/** Agent 事件载荷 */
export interface AgentEventPayload {
    runId: string;
    seq: number;
    stream: AgentEventStream;
    ts: number;
    data: Record<string, unknown>;
    sessionKey?: string;
}
