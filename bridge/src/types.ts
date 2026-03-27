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
} as const;

export type GwStatus = typeof GW_STATUS[keyof typeof GW_STATUS];

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
} as const;

export type ConnectErrorCode = typeof ConnectErrorCodes[keyof typeof ConnectErrorCodes];

/** Gateway close code 描述（移植自官方 GATEWAY_CLOSE_CODE_HINTS） */
export const CLOSE_CODE_HINTS: Record<number, string> = {
  1000: 'normal closure',
  1006: 'abnormal closure (no close frame)',
  1008: 'policy violation',
  1012: 'service restart',
  4000: 'watchdog heartbeat timeout',
  4008: 'connect failed',
};

// ============================================================
// Hello-Ok 响应（移植自官方 GatewayHelloOk）
// ============================================================

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

// ============================================================
// 结构化错误信息（移植自官方 GatewayErrorInfo）
// ============================================================

export interface GatewayErrorInfo {
  code: string;
  message: string;
  details?: unknown;
}

// ============================================================
// 数据类型
// ============================================================

export interface GatewayAgentRow {
  id: string;
  name?: string;
  identity?: { name?: string; emoji?: string };
}

export interface GatewaySessionRow {
  key: string;
  sessionId?: string;
  label?: string;
  displayName?: string;
  status?: string;
  abortedLastRun?: boolean;
  totalTokens?: number;
  lastMessage?: { role?: string; content?: any };
  startTime?: number;
  lastActionTime?: number;
}

export interface SessionsUsageResult {
  totals?: { totalTokens?: number; totalCost?: number };
}

// ============================================================
// RPC 帧
// ============================================================

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
  stateVersion?: { presence: number; health: number };
}

// ============================================================
// 推送事件
// ============================================================

export interface MessageObject {
  role: 'assistant' | 'user';
  content: string | Array<{ type: string; text?: string }>;
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

// ============================================================
// Storage
// ============================================================

export interface StorageSchema {
  'url': string;
  'token': string;
  'layout'?: any;
  'camera'?: any;
  'settings'?: any;
  'filters'?: any;
}

// ============================================================
// EventEmitter
// ============================================================

export type EventHandler = (...args: any[]) => void;

// ============================================================
// Session Run State（会话实时运行状态）
// ============================================================

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
