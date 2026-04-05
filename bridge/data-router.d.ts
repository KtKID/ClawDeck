import { EventEmitter, GatewayClient } from './gateway-client.js';
import type { SessionRunState } from './types.js';
declare let t: (key: string, params?: Record<string, any>) => string;
interface RouteEntry {
    caller: string;
    method: string;
    layer: string;
    durationMs: number;
    error?: boolean;
}
interface AIAdvice {
    id: string;
    source: string;
    priority: number;
    title: string;
    summary: string;
    owner: string;
    estimatedMinutes: number;
    status?: 'pending' | 'dispatched' | 'running' | 'completed' | 'failed' | 'dismissed';
    runId?: string;
    sessionId?: string;
    resultSummary?: string;
    statusUpdatedAt?: string;
}
export declare class DataRouter extends EventEmitter {
    /** 注入 i18n 翻译函数（由 index.html 初始化时调用） */
    static setTranslator(fn: typeof t): void;
    private _gateway;
    private _agents;
    private _activeSessions;
    private _allSessions;
    /** 下拉选择器专用：含 global/unknown 类型，由 refreshAllSessionsForDropdown() 维护 */
    private _allSessionsForDropdown;
    private _usage;
    private _routeCallback;
    private _pushHandlers;
    private _pendingApprovals;
    private _health;
    private _models;
    private _cronJobs;
    private _agentProfiles;
    private _refreshTimer;
    /** in-flight 去重：多个调用者共享同一个 Promise */
    private _refreshing;
    /** 轮询定时器 */
    private _pollTimerLight;
    private _pollTimerHeavy;
    /** 动态轮询间隔（默认 5s，空闲时 30s） */
    private _currentPollInterval;
    private _idleCount;
    /** gateway status 监听器引用（用于 cleanup） */
    private _statusHandler;
    /** 会话实时运行状态表（sessionKey -> SessionRunState） */
    private _sessionRunState;
    /** AI 建议数据缓存（null = 未加载，[] = 加载后为空） */
    private _aiAdvices;
    private _aiAdviceMaxCount;
    /** AI 建议延迟请求定时器 */
    private _aiAdviceTimer;
    /** sessionKey → adviceId 映射（dispatch 时写入，session 完成时查找） */
    private _adviceSessionMap;
    /** runId → adviceId 映射（dispatch 时写入，lifecycle.start 桥接后删除） */
    private _adviceRunMap;
    /** runId → sessionKey 暂存（lifecycle.start 早于 dispatched 到达时补偿桥接） */
    private _pendingAdviceRunSessions;
    constructor(gateway: GatewayClient);
    /** 监听 gateway 状态变化，自动管理轮询生命周期 */
    private _bindGatewayStatus;
    startPolling(): void;
    stopPolling(): void;
    /** 动态调整 session 轮询间隔 */
    private _adjustPollInterval;
    /** 重建 session 轮询定时器（保持 usage 定时器不变） */
    private _restartLightTimer;
    onRoute(callback: (entry: RouteEntry) => void): void;
    /** 刷新 Agent 列表（只在连接成功时调用一次） */
    refreshAgents(): Promise<void>;
    refreshAgentProfiles(): Promise<void>;
    /** 刷新 Session 列表（去重入口：同一时刻只允许一个请求在飞） */
    refreshSessions(): Promise<void>;
    /**
     * 为聊天抽屉下拉选择器专项刷新全量 session。
     * 参数说明（来自官方 sessions.list schema + sessions.ts 源码）：
     *   - includeGlobal: true  → 包含 key === "global" 的单例 session（全局执行上下文）
     *                            ⚠️ 不是 cron/hook/node sessions，那些默认已在返回值中
     *   - includeUnknown: true → 包含 key === "unknown" 的单例 session
     *   - limit: 200           → 更大的结果集（官方 sessions.list 默认 200）
     * cron/hook/node sessions（cron:xxx / hook:xxx / node-xxx）默认已包含，无需特殊参数。
     * sessions.list 天然跨 agent（服务端 loadCombinedSessionStoreForGateway 自动合并所有 agent store）。
     * 参考：openclaw_base/ui/src/ui/controllers/sessions.ts
     */
    refreshAllSessionsForDropdown(): Promise<void>;
    /** 实际刷新逻辑：单次 sessions.list + 客户端过滤 active sessions */
    private _doRefreshSessions;
    /** 全量刷新（保持向后兼容，用于首次连接） */
    refresh(): Promise<void>;
    refreshUsage(): Promise<void>;
    refreshCronJobs(): Promise<void>;
    /** 延迟 5 秒触发 AI 建议请求（重复调用自动取消前一个定时器） */
    private _scheduleAIAdvicesRefresh;
    refreshAIAdvices(): Promise<void>;
    getAIAdvices(): {
        advices: AIAdvice[] | null;
        maxCount: number;
    };
    /** 获取全量建议（含已处理的），用于历史栏 */
    getAllAdvices(): Promise<AIAdvice[]>;
    /** 更新建议状态（调用 PATCH API，成功后刷新列表） */
    updateAdviceStatus(id: string, status: string, meta?: {
        sessionId?: string;
        runId?: string;
        resultSummary?: string;
    }): Promise<boolean>;
    getCronJobsForPanel(): any[];
    private _formatNextRun;
    getSessionDetail(sessionKey: string): Promise<any>;
    getSessionTimeline(sessionKey: string): Promise<any[]>;
    getUsageCost(opts?: Record<string, any>): Promise<any>;
    getSessionsPreview(keys: string[]): Promise<any>;
    getHealth(probe?: boolean): Promise<any>;
    get health(): any;
    /** 获取指定会话的运行状态 */
    getSessionRunState(sessionKey: string): SessionRunState | undefined;
    /** 获取所有会话的运行状态 */
    getAllSessionRunStates(): Map<string, SessionRunState>;
    getModels(): Promise<any[]>;
    patchSession(key: string, patch: Record<string, any>): Promise<any>;
    resetSession(key: string, note: string): Promise<any>;
    compactSessions(): Promise<any>;
    tailLogs(cursor: number, limit?: number): Promise<any>;
    subscribePush(): void;
    unsubscribePush(): void;
    private _onAgentPush;
    /** 从 agent 事件更新会话运行状态 */
    private _updateSessionRunStateFromAgent;
    private _onChatPush;
    private _onApprovalPush;
    private _onHealthPush;
    private _onCronPush;
    private _debouncedRefresh;
    getPendingApprovals(): any[];
    resolveApproval(requestId: string): void;
    getAgentsForStarMap(): any[];
    getActiveSessionsForStarMap(): any[];
    getMetrics(): any;
    getAgentUsage(agentId: string): {
        input: number;
        output: number;
        totalTokens: number;
    } | null;
    getAgentsForWorkshop(): any[];
    getSessionsForWorkshop(): any[];
    private static readonly _KIND_ICONS;
    /**
     * 返回用于聊天抽屉下拉选择器的全量 session 列表，包含 agent 名字和图标。
     * 与 getSessionsForWorkshop 的区别：不限制 2 分钟活跃窗口，包含所有 session 类型。
     *
     * kind 词汇（与官方 CLI sessions_list 对齐）：
     *   direct / group / cron / hook / node / global / other
     * 降级：_allSessionsForDropdown 为空时（首次连接前）回退到 _allSessions
     */
    getAllSessionsForChat(): any[];
    _messagesToSteps(messages: any[], agentId?: string): any[];
    /** B5: 去除 fallback 重试导致的重复用户消息 */
    private _dedupFallbackRetries;
    /** 从消息中提取文本内容 */
    private _extractTextContent;
    /**
     * B7: 剥离 OpenClaw 注入的 inbound metadata 前缀
     * 参考官方实现：src/auto-reply/reply/strip-inbound-meta.ts
     */
    private _stripInboundMetadata;
    private _truncate;
    private _extractLastMessagePreview;
    /**
     * 统一错误处理的 gateway.call 封装（改进版）
     * 错误时返回 null + emit error 事件，不阻断流程
     */
    _callWithLog(caller: string, method: string, layer: string, params: Record<string, any>): Promise<any>;
    private _extractAgentId;
    /**
     * 按 session key 前缀识别 session 类型和 agentId。
     * Session key 格式（来自 openclaw CLI + 服务端源码）：
     *   agent:<agentId>:<mainKey>              → direct（普通 agent 对话）
     *   agent:<agentId>:<ch>:group/<ch>/<id>  → group（群组）
     *   cron:<job.id>                          → cron（定时任务）
     *   hook:<uuid>                            → hook（Webhook 触发）
     *   node-<nodeId>                          → node（Node 任务）
     *   global                                 → global（全局执行上下文单例）
     *   unknown / 其他                         → other
     */
    private _parseSessionKey;
    private _deriveAgentStatus;
    /** 检查 session 完成时是否有关联的 AI 建议需要回填 */
    private _checkAdviceSessionComplete;
    /** 检查 session 出错时是否有关联的 AI 建议需要标记失败 */
    private _checkAdviceSessionFailed;
}
export {};
