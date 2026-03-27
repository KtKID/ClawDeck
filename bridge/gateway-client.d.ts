import { GwStatus, GatewayHelloOk, EventHandler } from './types.js';
export { GW_STATUS, ConnectErrorCodes, CLOSE_CODE_HINTS } from './types.js';
export { Storage } from './storage.js';
export declare class EventEmitter {
    private _listeners;
    on(event: string, fn: EventHandler): this;
    off(event: string, fn: EventHandler): this;
    protected _emit(event: string, ...args: any[]): void;
}
export interface GatewayClientOptions {
    url?: string;
    token?: string;
    password?: string;
    reconnectDelay?: number;
}
export declare class GatewayClient extends EventEmitter {
    private _ws;
    private _requestId;
    private _pending;
    private _status;
    private _handshakeDone;
    private _reconnectTimer;
    private _stopped;
    /** 指数退避当前值 */
    private _backoff;
    /** 事件序列号（用于 gap 检测） */
    private _lastSeq;
    /** hello-ok 响应数据，连接成功后可用 */
    hello: GatewayHelloOk | null;
    /** 最近一次错误的可读描述 */
    lastError: string | null;
    /** 最近一次错误的结构化错误码 */
    lastErrorCode: string | null;
    /** 当前 WebSocket URL */
    url: string;
    /** 当前 Gateway Token（URL 参数或手动传入） */
    token: string | undefined;
    /** 当前密码（手动传入） */
    password: string | undefined;
    /** 当前是否存在活动中的连接/重连流程 */
    get hasActiveConnection(): boolean;
    /** 设备 Auth Token（localStorage 持久化，由 gateway 签发） */
    deviceToken: string | undefined;
    /** 重连次数计数（连接成功后重置） */
    private _reconnectCount;
    constructor(opts?: GatewayClientOptions | string);
    get status(): GwStatus;
    /** 向后兼容：握手完成 = connected */
    get connected(): boolean;
    private _setStatus;
    applyConfig(url?: string, token?: string, password?: string): void;
    /**
     * 建立连接。传参时先应用配置，再启动新的连接链路。
     * @param url  可选，传入后覆盖并持久化
     * @param token  可选，传入后覆盖并持久化
     */
    connect(url?: string, token?: string, password?: string): void;
    /** 用当前配置重新启动连接链路 */
    reconnect(): void;
    /** 停止连接（对齐官方 stop() 命名） */
    stop(): void;
    private _startConnectionFlow;
    private _teardownSocket;
    /** 别名 */
    disconnect(): void;
    call(method: string, params?: Record<string, any>, timeout?: number): Promise<any>;
    sendInstruction(sessionKey: string, message: string): Promise<any>;
    abortSession(sessionKey: string): Promise<any>;
    resolveApproval(approvalId: string, decision?: string): Promise<any>;
    /** @deprecated 使用 sendInstruction/abortSession/resolveApproval 替代 */
    sendAction(action: string, sessionId: string, instruction: string): Promise<any>;
    pollLogs(sinceId?: number): Promise<any>;
    /** 向 idle Agent 发送消息并创建新会话（对应 Gateway `agent` RPC） */
    startAgentChat(agentId: string, message: string): Promise<any>;
    private _doConnect;
    private _scheduleReconnect;
    private _clearReconnectTimer;
    /** 连接成功后重置退避 */
    private _resetBackoff;
    private _handleMessage;
    private _sendConnect;
    private _flushPendingErrors;
}
