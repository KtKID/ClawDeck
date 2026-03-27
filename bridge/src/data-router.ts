import { EventEmitter, GatewayClient, GW_STATUS } from './gateway-client.js';
import type { GwStatus, ChatPushPayload, SessionRunState, AgentEventPayload } from './types.js';
import { resolveToolDisplay } from './tool-display.js';

// ============================================================
// DataRouter — 前端数据路由器
// 统一管理所有数据获取：推送事件 + 定时轮询双保险
// ============================================================

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

export class DataRouter extends EventEmitter {
  private _gateway: GatewayClient;
  private _agents: any[] = [];
  private _activeSessions: any[] = [];
  private _allSessions: any[] = [];
  /** 下拉选择器专用：含 global/unknown 类型，由 refreshAllSessionsForDropdown() 维护 */
  private _allSessionsForDropdown: any[] = [];
  private _usage: any = null;
  private _routeCallback: ((entry: RouteEntry) => void) | null = null;
  private _pushHandlers: Record<string, (p: any) => void> | null = null;
  private _pendingApprovals: any[] = [];
  private _health: any = null;
  private _models: any[] = [];
  private _cronJobs: any[] = [];
  private _agentProfiles: Record<string, any> = {};
  private _refreshTimer: ReturnType<typeof setTimeout> | null = null;

  /** in-flight 去重：多个调用者共享同一个 Promise */
  private _refreshing: Promise<void> | null = null;

  /** 轮询定时器 */
  private _pollTimerLight: ReturnType<typeof setInterval> | null = null;
  private _pollTimerHeavy: ReturnType<typeof setInterval> | null = null;

  /** 动态轮询间隔（默认 5s，空闲时 30s） */
  private _currentPollInterval: number = 5000;
  private _idleCount: number = 0;

  /** gateway status 监听器引用（用于 cleanup） */
  private _statusHandler: ((s: GwStatus) => void) | null = null;

  /** 会话实时运行状态表（sessionKey -> SessionRunState） */
  private _sessionRunState: Map<string, SessionRunState> = new Map();

  /** AI 建议数据缓存（null = 未加载，[] = 加载后为空） */
  private _aiAdvices: AIAdvice[] | null = null;
  private _aiAdviceMaxCount: number = 3;
  /** AI 建议延迟请求定时器 */
  private _aiAdviceTimer: ReturnType<typeof setTimeout> | null = null;
  /** sessionKey → adviceId 映射（dispatch 时写入，session 完成时查找） */
  private _adviceSessionMap: Map<string, string> = new Map();
  /** runId → adviceId 映射（dispatch 时写入，lifecycle.start 桥接后删除） */
  private _adviceRunMap: Map<string, string> = new Map();
  /** runId → sessionKey 暂存（lifecycle.start 早于 dispatched 到达时补偿桥接） */
  private _pendingAdviceRunSessions: Map<string, string> = new Map();

  constructor(gateway: GatewayClient) {
    super();
    this._gateway = gateway;
    this._bindGatewayStatus();
  }

  // ============================================================
  // 轮询生命周期（新增）
  // ============================================================

  /** 监听 gateway 状态变化，自动管理轮询生命周期 */
  private _bindGatewayStatus(): void {
    this._statusHandler = (status: GwStatus) => {
      if (status === GW_STATUS.CONNECTED) {
        this.startPolling();
        // 连接成功：先拉 agents（一次性），再拉 sessions
        this.refreshAgents().catch(() => { });
        this.refreshAgentProfiles().catch(() => { });
        this.refreshSessions().catch(() => { });
        this.refreshUsage().catch(() => { });
        this.refreshCronJobs().catch(() => { });
        this.refreshAllSessionsForDropdown().catch(() => { });
        // AI 建议：连接成功后延迟 5 秒再请求（等待 session 数据先就位）
        this._scheduleAIAdvicesRefresh();
      } else if (status === GW_STATUS.DISCONNECTED || status === GW_STATUS.RECONNECTING) {
        this.stopPolling();
      }
    };
    this._gateway.on('status', this._statusHandler);
  }

  startPolling(): void {
    this.stopPolling();
    this._currentPollInterval = 5000;
    this._idleCount = 0;
    // 轮询只刷新 sessions，agents 只在连接成功时拉一次
    this._pollTimerLight = setInterval(() => {
      this.refreshSessions().catch(() => { });
    }, this._currentPollInterval);
    this._pollTimerHeavy = setInterval(() => {
      this.refreshUsage().catch(() => { });
      this.refreshAllSessionsForDropdown().catch(() => { });
    }, 60000);
  }

  stopPolling(): void {
    if (this._pollTimerLight) { clearInterval(this._pollTimerLight); this._pollTimerLight = null; }
    if (this._pollTimerHeavy) { clearInterval(this._pollTimerHeavy); this._pollTimerHeavy = null; }
    if (this._aiAdviceTimer) { clearTimeout(this._aiAdviceTimer); this._aiAdviceTimer = null; }
  }

  /** 动态调整 session 轮询间隔 */
  private _adjustPollInterval(): void {
    const hasActive = this._activeSessions.length > 0;
    if (hasActive) {
      this._idleCount = 0;
      if (this._currentPollInterval !== 5000) {
        this._currentPollInterval = 5000;
        this._restartLightTimer();
      }
    } else {
      this._idleCount++;
      // 连续 2 次无活跃才切到慢速（滞后窗口，避免抖动）
      if (this._idleCount >= 2 && this._currentPollInterval !== 30000) {
        this._currentPollInterval = 30000;
        this._restartLightTimer();
      }
    }
  }

  /** 重建 session 轮询定时器（保持 usage 定时器不变） */
  private _restartLightTimer(): void {
    // stopPolling 后两个 timer 均为 null，表示轮询已停止，不重建（防止 in-flight 请求回来时创建孤立 timer）
    if (this._pollTimerLight === null && this._pollTimerHeavy === null) return;
    if (this._pollTimerLight) { clearInterval(this._pollTimerLight); }
    this._pollTimerLight = setInterval(() => {
      this.refreshSessions().catch(() => { });
    }, this._currentPollInterval);
  }

  // ============================================================
  // 路由日志
  // ============================================================

  onRoute(callback: (entry: RouteEntry) => void): void {
    this._routeCallback = callback;
  }

  // ============================================================
  // 数据刷新
  // ============================================================

  /** 刷新 Agent 列表（只在连接成功时调用一次） */
  async refreshAgents(): Promise<void> {
    const agentsRes = await this._callWithLog('refreshAgents', 'agents.list', 'gateway', {});
    this._agents = agentsRes?.agents || [];
  }

  async refreshAgentProfiles(): Promise<void> {
    try {
      const resp = await fetch('/plugins/clawdeck/api/agent-profiles');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const res = await resp.json();
      const profiles = res?.profiles;
      this._agentProfiles = profiles && typeof profiles === 'object' ? profiles : {};

      if (profiles && typeof profiles === 'object') {
        for (const [agentId, profile] of Object.entries(profiles)) {
          const profileData: any = profile;
          const avatarUrl = profileData?.avatarUrl;
          if (avatarUrl && typeof avatarUrl !== 'string') {
            console.warn('[AgentProfiles] avatarUrl must be string:', agentId);
          } else if (typeof avatarUrl === 'string' && !avatarUrl.startsWith('/plugins/clawdeck/avatars/')) {
            console.warn('[AgentProfiles] avatarUrl should start with /plugins/clawdeck/avatars/:', agentId, avatarUrl);
          }

          const traits = profileData?.traits;
          if (traits && !Array.isArray(traits)) {
            console.warn('[AgentProfiles] traits must be string[]:', agentId);
          }
        }
      }
    } catch (err) {
      console.warn('[AgentProfiles] refresh failed:', err);
      this._agentProfiles = {};
    }
  }

  /** 刷新 Session 列表（去重入口：同一时刻只允许一个请求在飞） */
  async refreshSessions(): Promise<void> {
    if (this._refreshing) return this._refreshing;
    this._refreshing = this._doRefreshSessions();
    try { await this._refreshing; } finally { this._refreshing = null; }
  }

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
  async refreshAllSessionsForDropdown(): Promise<void> {
    const res = await this._callWithLog('refreshAllSessionsForDropdown', 'sessions.list', 'gateway', {
      includeGlobal: true, includeUnknown: true, limit: 200,
    });
    this._allSessionsForDropdown = res?.sessions || [];
  }

  /** 实际刷新逻辑：单次 sessions.list + 客户端过滤 active sessions */
  private async _doRefreshSessions(): Promise<void> {
    const res = await this._callWithLog('refreshSessions', 'sessions.list', 'gateway', {
      limit: 100, includeLastMessage: true, includeDerivedTitles: true,
    });
    const all = res?.sessions || [];
    const cutoff = Date.now() - 2 * 60_000;
    this._activeSessions = all.filter((s: any) => (s.updatedAt ?? 0) >= cutoff);
    this._allSessions = all;
    this._emit('data:updated');
    this._adjustPollInterval();
  }

  /** 全量刷新（保持向后兼容，用于首次连接） */
  async refresh(): Promise<void> {
    await Promise.all([
      this.refreshAgents(),
      this.refreshAgentProfiles(),
      this.refreshSessions(),
    ]);
  }

  async refreshUsage(): Promise<void> {
    this._usage = await this._callWithLog('refreshUsage', 'sessions.usage', 'gateway', { limit: 50, days: 1 });
  }

  async refreshCronJobs(): Promise<void> {
    const res = await this._callWithLog('refreshCronJobs', 'cron.list', 'gateway', { limit: 50 });
    this._cronJobs = res?.jobs || [];
    this._emit('data:cron-updated');
  }

  /** 延迟 5 秒触发 AI 建议请求（重复调用自动取消前一个定时器） */
  private _scheduleAIAdvicesRefresh(): void {
    if (this._aiAdviceTimer) { clearTimeout(this._aiAdviceTimer); }
    console.log('[AIAdvice] 调度5秒后刷新AI建议数据，请求路径: /plugins/clawdeck/api/ai-advices');
    this._aiAdviceTimer = setTimeout(() => {
      this._aiAdviceTimer = null;
      console.log('[AIAdvice] 5秒定时器触发，开始请求AI建议数据...');
      this.refreshAIAdvices().catch(() => { });
    }, 5000);
  }

  async refreshAIAdvices(): Promise<void> {
    console.log('[AIAdvice] 开始请求AI建议数据，请求路径: /plugins/clawdeck/api/ai-advices');
    try {
      const resp = await fetch('/plugins/clawdeck/api/ai-advices');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const res = await resp.json();
      console.log('[AIAdvice] 原始响应数据:', res);
      this._aiAdvices = res.advices || [];
      this._aiAdviceMaxCount = res.config?.maxAdviceCount || 3;
    } catch (err) {
      console.warn('[AIAdvice] 请求失败:', err);
      this._aiAdvices = [];
    }
    console.log('[AIAdvice] 处理后的建议数据:', this._aiAdvices, 'maxCount:', this._aiAdviceMaxCount);
    // 恢复 runId 映射（页面刷新后重建内存 Map）
    for (const advice of this._aiAdvices!) {
      if (advice.status === 'dispatched' && (advice as any).runId) {
        if (!this._adviceRunMap.has((advice as any).runId)) {
          this._adviceRunMap.set((advice as any).runId, advice.id);
          console.log(`[AIAdvice] 恢复 runId 映射: ${(advice as any).runId} → ${advice.id}`);
        }
      }
      if (advice.status === 'running' && (advice as any).sessionId) {
        if (!this._adviceSessionMap.has((advice as any).sessionId)) {
          this._adviceSessionMap.set((advice as any).sessionId, advice.id);
          console.log(`[AIAdvice] 恢复 sessionKey 映射: ${(advice as any).sessionId} → ${advice.id}`);
        }
      }
    }
    this._emit('data:ai-advices-updated');
  }

  getAIAdvices(): { advices: AIAdvice[] | null; maxCount: number } {
    return { advices: this._aiAdvices, maxCount: this._aiAdviceMaxCount };
  }

  /** 获取全量建议（含已处理的），用于历史栏 */
  async getAllAdvices(): Promise<AIAdvice[]> {
    try {
      const resp = await fetch('/plugins/clawdeck/api/ai-advices?include=all');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const res = await resp.json();
      return res.advices || [];
    } catch (err) {
      console.warn('[AIAdvice] getAllAdvices 失败:', err);
      return [];
    }
  }

  /** 更新建议状态（调用 PATCH API，成功后刷新列表） */
  async updateAdviceStatus(id: string, status: string, meta?: { sessionId?: string; runId?: string; resultSummary?: string }): Promise<boolean> {
    const patchBody = { status, ...meta };
    console.log(`[AIAdvice][updateAdviceStatus] 开始 PATCH adviceId=${id} status=${status} meta=${JSON.stringify(meta)} patchBody=${JSON.stringify(patchBody)}`);
    try {
      const resp = await fetch(`/plugins/clawdeck/api/ai-advices/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      console.log(`[AIAdvice][updateAdviceStatus] PATCH 成功: ${id} → ${status}`);
      // dispatch 时注册 runId → adviceId 映射
      if (status === 'dispatched' && meta?.runId) {
        this._adviceRunMap.set(meta.runId, id);
        console.log(`[AIAdvice][updateAdviceStatus] 注册 runId 映射: ${meta.runId} → ${id}，当前 _adviceRunMap size=${this._adviceRunMap.size}`);

        const pendingSessionKey = this._pendingAdviceRunSessions.get(meta.runId);
        if (pendingSessionKey) {
          this._pendingAdviceRunSessions.delete(meta.runId);
          this._adviceSessionMap.set(pendingSessionKey, id);
          this._adviceRunMap.delete(meta.runId);
          console.log(`[AIAdvice][updateAdviceStatus] 补偿乱序桥接成功: ${meta.runId} → ${pendingSessionKey} → adviceId: ${id}`);
          this.updateAdviceStatus(id, 'running', { sessionId: pendingSessionKey }).catch(() => { });
        }
      } else if (status === 'dispatched' && !meta?.runId) {
        console.warn(`[AIAdvice][updateAdviceStatus] ⚠️ dispatched 但 runId 为空，_adviceRunMap 未注册，状态流转将断裂！meta=${JSON.stringify(meta)}`);
      }
      // running 状态时注册 sessionKey 映射（页面刷新后可通过持久化的 sessionId 恢复）
      if (status === 'running' && meta?.sessionId) {
        this._adviceSessionMap.set(meta.sessionId, id);
        console.log(`[AIAdvice][updateAdviceStatus] 注册 session 映射: ${meta.sessionId} → ${id}`);
      } else if (status === 'running' && !meta?.sessionId) {
        console.warn(`[AIAdvice][updateAdviceStatus] ⚠️ running 但 sessionId 为空，_adviceSessionMap 未注册，状态流转将断裂！meta=${JSON.stringify(meta)}`);
      }
      // 刷新列表
      await this.refreshAIAdvices();
      return true;
    } catch (err) {
      console.warn(`[AIAdvice][updateAdviceStatus] 状态更新失败: ${id} → ${status}`, err);
      return false;
    }
  }

  getCronJobsForPanel(): any[] {
    return this._cronJobs.map(job => ({
      id: job.id,
      title: job.name,
      type: job.schedule?.kind === 'at' ? 'one-time' : 'recurring',
      nextRun: this._formatNextRun(job.state?.nextRunAtMs),
      enabled: job.enabled,
      lastStatus: (job.state?.lastStatus as string) || null,
      running: !!job.state?.runningAtMs,
    }));
  }

  private _formatNextRun(ms?: number): string {
    if (!ms) return '--';
    const now = Date.now();
    if (ms < now) return '待执行';
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    if (d.toDateString() === new Date().toDateString()) return `${hh}:${mm}`;
    return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
  }

  async getSessionDetail(sessionKey: string): Promise<any> {
    const result = await this._callWithLog('getSessionDetail', 'chat.history', 'gateway', {
      sessionKey, limit: 200,
    });
    if (!result) return { steps: [], sessionKey, sessionId: '' };
    return {
      ...result,
      steps: this._messagesToSteps(result.messages, result.agentId),
    };
  }

  async getSessionTimeline(sessionKey: string): Promise<any[]> {
    const detail = await this.getSessionDetail(sessionKey);
    return detail?.steps || [];
  }

  async getUsageCost(opts: Record<string, any> = {}): Promise<any> {
    const defaults = { days: 7, mode: 'gateway' };
    return this._callWithLog('getUsageCost', 'usage.cost', 'gateway', { ...defaults, ...opts });
  }

  async getSessionsPreview(keys: string[]): Promise<any> {
    return this._callWithLog('getSessionsPreview', 'sessions.preview', 'gateway', {
      keys, limit: 12, maxChars: 240,
    });
  }

  async getHealth(probe = false): Promise<any> {
    this._health = await this._callWithLog('getHealth', 'health', 'gateway', { probe });
    return this._health;
  }

  get health(): any { return this._health; }

  /** 获取指定会话的运行状态 */
  getSessionRunState(sessionKey: string): SessionRunState | undefined {
    return this._sessionRunState.get(sessionKey);
  }

  /** 获取所有会话的运行状态 */
  getAllSessionRunStates(): Map<string, SessionRunState> {
    return this._sessionRunState;
  }

  async getModels(): Promise<any[]> {
    const result = await this._callWithLog('getModels', 'models.list', 'gateway', {});
    this._models = result?.models || [];
    return this._models;
  }

  async patchSession(key: string, patch: Record<string, any>): Promise<any> {
    return this._callWithLog('patchSession', 'sessions.patch', 'gateway', { key, patch });
  }

  async resetSession(key: string, note: string): Promise<any> {
    return this._callWithLog('resetSession', 'sessions.reset', 'gateway', { key, note });
  }

  async compactSessions(): Promise<any> {
    return this._callWithLog('compactSessions', 'sessions.compact', 'gateway', {});
  }

  async tailLogs(cursor: number, limit = 100): Promise<any> {
    return this._callWithLog('tailLogs', 'logs.tail', 'gateway', { cursor, limit });
  }

  // ============================================================
  // 推送事件订阅
  // ============================================================

  subscribePush(): void {
    if (this._pushHandlers) return;
    const handlers: Record<string, (p: any) => void> = {
      agent: (p) => this._onAgentPush(p),
      chat: (p) => this._onChatPush(p),
      'exec.approval.requested': (p) => this._onApprovalPush(p),
      health: (p) => this._onHealthPush(p),
      cron: (p) => this._onCronPush(p),
    };
    for (const [event, handler] of Object.entries(handlers)) {
      this._gateway.on(event, handler);
    }
    this._pushHandlers = handlers;
  }

  unsubscribePush(): void {
    if (!this._pushHandlers) return;
    for (const [event, handler] of Object.entries(this._pushHandlers)) {
      this._gateway.off(event, handler);
    }
    this._pushHandlers = null;
  }

  // ============================================================
  // 推送事件处理器
  // ============================================================

  private _onAgentPush(payload: AgentEventPayload): void {
    this._routeCallback?.({ caller: 'push', method: 'agent', layer: 'push', durationMs: 0 });

    // 解析 agent 事件，更新实时状态表
    this._updateSessionRunStateFromAgent(payload);

    // B3: 识别 fallback 事件并通知 UI 层
    if (payload.stream === 'lifecycle') {
      const phase = (payload.data?.phase as string) || '';
      if (phase === 'fallback' || phase === 'fallback_cleared') {
        this._emit('push:fallback', {
          sessionKey: payload.sessionKey,
          phase: phase === 'fallback_cleared' ? 'cleared' : 'active',
          activeModel: payload.data?.activeModel || payload.data?.toModel,
          activeProvider: payload.data?.activeProvider || payload.data?.toProvider,
          selectedModel: payload.data?.selectedModel || payload.data?.fromModel,
          reason: payload.data?.reasonSummary || payload.data?.reason,
        });
      }
    }

    // 只触发 push:agent 事件，不刷新 sessions
    this._emit('push:agent', payload);
  }

  /** 从 agent 事件更新会话运行状态 */
  private _updateSessionRunStateFromAgent(payload: AgentEventPayload): void {
    const { sessionKey, stream, data, runId } = payload;
    if (!sessionKey) return;

    const currentState = this._sessionRunState.get(sessionKey);

    if (stream === 'lifecycle') {
      const phase = (data?.phase as string) || '';
      console.log(`[AIAdvice][lifecycle] 收到事件 phase=${phase} sessionKey=${sessionKey} runId=${runId ?? 'null'} _adviceRunMap.size=${this._adviceRunMap.size} _adviceSessionMap.size=${this._adviceSessionMap.size}`);
      if (phase === 'start') {
        // 记录 session 开始时间
        this._sessionRunState.set(sessionKey, {
          status: 'running',
          runId,
          startedAt: Date.now(), // 记录开始时间
          updatedAt: Date.now(),
        });
        // 桥接 runId → sessionKey → adviceId
        if (runId && sessionKey) {
          const adviceId = this._adviceRunMap.get(runId);
          if (adviceId) {
            this._adviceSessionMap.set(sessionKey, adviceId);
            this._adviceRunMap.delete(runId);
            this._pendingAdviceRunSessions.delete(runId);
            console.log(`[AIAdvice][lifecycle] runId→sessionKey 桥接成功: ${runId} → ${sessionKey} → adviceId: ${adviceId}`);
            // 触发 running 状态转换，持久化 sessionKey 到后端
            this.updateAdviceStatus(adviceId, 'running', { sessionId: sessionKey }).catch(() => { });
          } else {
            this._pendingAdviceRunSessions.set(runId, sessionKey);
            console.warn(`[AIAdvice][lifecycle] ⚠️ lifecycle.start 早于 dispatched 注册到达，先暂存 runId=${runId} → sessionKey=${sessionKey}，当前 map keys: [${[...this._adviceRunMap.keys()].join(', ')}]`);
          }
        } else {
          console.warn(`[AIAdvice][lifecycle] ⚠️ lifecycle.start 缺少 runId，无法建立 runId→adviceId 桥接。runId=${runId ?? 'null'}`);
        }
      } else if (phase === 'end') {
        // session 结束，保留开始时间（用于显示最终执行时长）
        this._sessionRunState.set(sessionKey, {
          status: 'idle',
          runId,
          startedAt: currentState?.startedAt || Date.now(), // 保留开始时间
          updatedAt: Date.now(),
        });
        const adviceIdForEnd = this._adviceSessionMap.get(sessionKey);
        console.log(`[AIAdvice][lifecycle] lifecycle.end → sessionKey=${sessionKey} 对应 adviceId=${adviceIdForEnd ?? '未找到（无法自动完成）'}`);
        // 检查是否有关联的 AI 建议需要自动回填
        this._checkAdviceSessionComplete(sessionKey);
      } else if (phase === 'error') {
        // 出错时保留开始时间
        this._sessionRunState.set(sessionKey, {
          status: 'error',
          runId,
          startedAt: currentState?.startedAt || Date.now(),
          updatedAt: Date.now(),
        });
        const adviceIdForError = this._adviceSessionMap.get(sessionKey);
        console.log(`[AIAdvice][lifecycle] lifecycle.error → sessionKey=${sessionKey} 对应 adviceId=${adviceIdForError ?? '未找到（无法自动失败）'}`);
        // 检查是否有关联的 AI 建议需要标记失败
        this._checkAdviceSessionFailed(sessionKey);
      }
    } else if (stream === 'tool') {
      const phase = (data?.phase as string) || '';
      const toolName = (data?.name as string) || '';
      const { emoji, title } = resolveToolDisplay(toolName);

      if (phase === 'start') {
        this._sessionRunState.set(sessionKey, {
          status: 'tool',
          toolName,
          toolEmoji: emoji,
          toolTitle: title,
          runId,
          updatedAt: Date.now(),
        });
      } else if (phase === 'result') {
        // 工具执行完毕，回到 running 状态
        this._sessionRunState.set(sessionKey, {
          status: 'running',
          runId,
          updatedAt: Date.now(),
        });
      }
    } else if (stream === 'assistant') {
      // 模型正在输出
      this._sessionRunState.set(sessionKey, {
        status: 'streaming',
        runId,
        updatedAt: Date.now(),
      });
    }
  }

  private _onChatPush(payload: ChatPushPayload): void {
    this._routeCallback?.({ caller: 'push', method: 'chat', layer: 'push', durationMs: 0 });
    const { sessionKey, state, runId } = payload;

    // 更新会话运行状态
    if (sessionKey) {
      if (state === 'aborted') {
        this._sessionRunState.set(sessionKey, {
          status: 'aborted',
          runId,
          updatedAt: Date.now(),
        });
      } else if (state === 'error') {
        this._sessionRunState.set(sessionKey, {
          status: 'error',
          runId,
          updatedAt: Date.now(),
        });
      } else if (state === 'final') {
        // 正常完成，回到 idle
        this._sessionRunState.set(sessionKey, {
          status: 'idle',
          runId,
          updatedAt: Date.now(),
        });
      }
    }

    if (state === 'final' && payload.message) {
      const steps = this._messagesToSteps([payload.message]);
      if (steps.length > 0) {
        this._emit('push:chat', { sessionKey, step: steps[0] });
      }
      // chat final 也检查 advice 关联
      if (sessionKey) this._checkAdviceSessionComplete(sessionKey, payload.message);
    } else if (state === 'aborted') {
      if (payload.message && payload.message.role === 'assistant') {
        const steps = this._messagesToSteps([payload.message]);
        if (steps.length > 0) {
          this._emit('push:chat', { sessionKey, step: { ...steps[0], type: 'aborted' } });
        }
      }
    } else if (state === 'error') {
      this._emit('push:chat', {
        sessionKey,
        step: { id: `push-err-${Date.now()}`, type: 'error', summary: payload.errorMessage || '未知错误', timestamp: Date.now(), data: payload },
      });
    }
  }

  private _onApprovalPush(payload: any): void {
    this._routeCallback?.({ caller: 'push', method: 'exec.approval.requested', layer: 'push', durationMs: 0 });
    this._pendingApprovals.push(payload);
    this._emit('push:approval', payload);
  }

  private _onHealthPush(payload: any): void {
    this._routeCallback?.({ caller: 'push', method: 'health', layer: 'push', durationMs: 0 });
    this._health = payload;
    this._emit('push:health', payload);
  }

  private _onCronPush(payload: any): void {
    this._routeCallback?.({ caller: 'push', method: 'cron', layer: 'push', durationMs: 0 });
    this.refreshCronJobs().catch(() => { });
    this._emit('push:cron', payload);
  }

  private _debouncedRefresh(): void {
    if (this._refreshTimer) return;
    this._refreshTimer = setTimeout(async () => {
      this._refreshTimer = null;
      // 推送后只刷新 sessions，不刷 agents
      try { await this.refreshSessions(); this._emit('push:refreshed'); } catch { }
    }, 1000);
  }

  // ============================================================
  // 审批管理
  // ============================================================

  getPendingApprovals(): any[] { return this._pendingApprovals; }

  resolveApproval(requestId: string): void {
    this._pendingApprovals = this._pendingApprovals.filter(a => a.requestId !== requestId);
  }

  // ============================================================
  // 数据格式转换 — StarMap
  // ============================================================

  getAgentsForStarMap(): any[] {
    return this._agents.map(agent => ({
      id: agent.id,
      label: agent.identity?.name || agent.name || agent.id,
      icon: agent.identity?.emoji || '🤖',
      status: this._deriveAgentStatus(agent.id),
    }));
  }

  getActiveSessionsForStarMap(): any[] {
    return this._activeSessions.map(s => ({
      id: s.sessionId || s.key,
      sessionKey: s.key,
      label: s.label || s.displayName || `Session ${(s.sessionId || s.key).slice(0, 8)}`,
      agentId: this._extractAgentId(s.key),
      status: s.abortedLastRun ? 'error' : 'active',
      lastMessagePreview: this._extractLastMessagePreview(s.lastMessage),
    }));
  }

  getMetrics(): any {
    const activeKeys = new Set(this._activeSessions.map(s => this._extractAgentId(s.key)));
    const totals = this._usage?.totals;

    // 计算今日完成的 session 数量（updatedAt 在今日且不在活跃列表中）
    const now = Date.now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();

    const activeSessionKeys = new Set(this._activeSessions.map(s => s.key));
    const todayCompleted = (this._allSessions || []).filter(s =>
      !activeSessionKeys.has(s.key) && s.updatedAt >= todayStartMs
    ).length;

    return {
      agents: this._agents.length,
      activeSessions: this._activeSessions.length,
      activeAgents: activeKeys.size,
      totalTokens: totals?.totalTokens || 0,
      totalCost: totals?.totalCost || 0,
      completedSessions: Math.max(0, (this._allSessions?.length || 0) - this._activeSessions.length),
      todayCompletedSessions: todayCompleted,
      totalErrors: this._activeSessions.filter(s => s.abortedLastRun).length,
    };
  }

  getAgentUsage(agentId: string): { input: number; output: number; totalTokens: number } | null {
    if (!this._usage || !this._usage.aggregates || !this._usage.aggregates.byAgent) return null;
    const agentUsage = this._usage.aggregates.byAgent.find((a: any) => a.agentId === agentId);
    if (!agentUsage || !agentUsage.totals) return null;
    return {
      input: agentUsage.totals.input || 0,
      output: agentUsage.totals.output || 0,
      totalTokens: agentUsage.totals.totalTokens || 0,
    };
  }

  // ============================================================
  // 数据格式转换 — Workshop
  // ============================================================

  getAgentsForWorkshop(): any[] {
    return this._agents.map(agent => {
      const agentId = agent.id;
      const profile = this._agentProfiles[agentId] || {};
      const agentSessions = this._activeSessions.filter(s => this._extractAgentId(s.key) === agentId);
      const activeSession = agentSessions[0];
      const status = this._deriveAgentStatus(agentId);

      let steps: any[] = [];
      if (activeSession?.steps) {
        steps = activeSession.steps;
      }

      return {
        id: agent.id,
        label: agent.identity?.name || agent.name || agent.id,
        icon: agent.identity?.emoji || '🤖',
        avatarUrl: profile?.avatarUrl || null,
        traits: Array.isArray(profile?.traits) ? profile.traits : null,
        characteristics:
          agent.identity?.characteristics ||
          agent.profile?.characteristics ||
          agent.identity?.features ||
          agent.profile?.features ||
          agent.characteristics ||
          (Array.isArray(profile?.traits) && profile.traits.length > 0 ? profile.traits.join(' / ') : null),
        status,
        currentTask: activeSession?.label || null,
        steps,
      };
    });
  }

  getSessionsForWorkshop(): any[] {
    return this._activeSessions.map(s => {
      const agentId = this._extractAgentId(s.key);
      const pendingApproval = this._pendingApprovals.find(p => p.sessionKey === s.key) || null;
      const runState = this._sessionRunState.get(s.key) || null;

      return {
        id: s.sessionId || s.key,
        sessionKey: s.key,
        title: s.label || s.displayName || `Session ${(s.sessionId || s.key).slice(0, 8)}`,
        // 官方字段：abortedLastRun 标记异常
        abortedLastRun: !!s.abortedLastRun,
        agentId,
        lastMessage: this._extractLastMessagePreview(s.lastMessage),
        pendingApproval: pendingApproval ? {
          id: pendingApproval.requestId,
          toolName: pendingApproval.toolName,
        } : null,
        steps: [],
        usage: {
          input: s.usage?.input || s.inputTokens || 0,
          output: s.usage?.output || s.outputTokens || 0,
          total: s.totalTokens || s.usage?.total || 0,
        },
        // 官方字段：最后更新时间
        updatedAt: s.updatedAt,
        // 实时运行状态（来自 agent 事件流）
        runState,
      };
    });
  }

  private static readonly _KIND_META: Record<string, { label: string; icon: string }> = {
    cron: { label: '定时任务', icon: '⏰' },
    hook: { label: 'Webhook', icon: '🔗' },
    node: { label: 'Node 任务', icon: '⚙️' },
    global: { label: '全局', icon: '🌐' },
    other: { label: '其他', icon: '❓' },
  };

  /**
   * 返回用于聊天抽屉下拉选择器的全量 session 列表，包含 agent 名字和图标。
   * 与 getSessionsForWorkshop 的区别：不限制 2 分钟活跃窗口，包含所有 session 类型。
   *
   * kind 词汇（与官方 CLI sessions_list 对齐）：
   *   direct / group / cron / hook / node / global / other
   * 降级：_allSessionsForDropdown 为空时（首次连接前）回退到 _allSessions
   */
  getAllSessionsForChat(): any[] {
    const source = this._allSessionsForDropdown.length > 0
      ? this._allSessionsForDropdown
      : this._allSessions;

    return source.map(s => {
      const { agentId, sessionKind } = this._parseSessionKey(s.key);
      const agent = agentId ? this._agents.find((a: any) => a.id === agentId) : null;
      const meta = DataRouter._KIND_META[sessionKind];

      return {
        sessionKey: s.key,
        kind: sessionKind,
        title: s.label || s.displayName || `Session ${s.key.slice(0, 16)}`,
        agentId,
        agentLabel: agent?.identity?.name || agent?.name || meta?.label || agentId || '未知',
        agentIcon: agent?.identity?.emoji || meta?.icon || '🤖',
        updatedAt: s.updatedAt,
        abortedLastRun: !!s.abortedLastRun,
      };
    });
  }

  // ============================================================
  // 内部工具
  // ============================================================

  _messagesToSteps(messages: any[], agentId?: string): any[] {
    if (!messages || !Array.isArray(messages)) return [];

    // 保留所有类型，内部事件标记为 'internal'
    const steps = messages.map((msg, i) => {
      const step: any = {
        id: msg.id || `msg-${i}`,
        timestamp: msg.timestamp || Date.now(),
        data: msg, // 保留原始数据的所有字段
        agentId,   // 注入 session 级别的 agentId，供 UI 层渲染正确的头像
      };

      // 优先使用原始 type 字段
      const msgType = msg.type;
      step.originalType = msgType;

      // 根据原始 type 决定渲染类型
      switch (msgType) {
        case 'text':
          // text 类型根据 role 区分用户输入/AI 输出
          if (msg.role === 'user') {
            step.type = 'llm_input';
            // B7: 剥离 inbound metadata 前缀
            step.summary = this._stripInboundMetadata(this._extractTextContent(msg));
          } else if (msg.role === 'assistant') {
            step.type = 'llm_output';
          } else {
            step.type = 'llm_output';
          }
          if (step.type === 'llm_output') {
            step.summary = this._extractTextContent(msg);
          }
          break;

        case 'toolCall':
          step.type = 'tool_call';
          step.summary = `工具调用 → ${msg.name || 'unknown'}`;
          break;

        case 'toolResult':
          step.type = 'tool_result';
          step.summary = `工具结果 ← ${msg.toolName || 'unknown'}`;
          // 保留 isError 状态
          step.isError = msg.isError;
          break;

        case 'thinking':
          step.type = 'thinking';
          step.summary = msg.thinking || '思考中...';
          break;

        case 'custom':
          // B6: model-snapshot 是内部状态标记，不应对用户可见
          if (msg.customType === 'model-snapshot') {
            step.type = 'internal';
            step.summary = `model-snapshot: ${msg.data?.modelId || ''}`;
          } else {
            step.type = 'custom';
            step.summary = msg.customType || 'custom';
          }
          break;

        case 'session':
          step.type = 'session';
          step.summary = `会话: ${msg.id?.slice(0, 8) || ''}`;
          break;

        case 'model_change':
          step.type = 'model_change';
          step.summary = `模型切换: ${msg.modelId || ''}`;
          break;

        case 'thinking_level_change':
          step.type = 'thinking_level_change';
          step.summary = `思考级别: ${msg.thinkingLevel || ''}`;
          break;

        case 'message': {
          // message 类型包含实际内容，根据 message.role 判断
          const msgContent = msg.message?.content;
          const isEmptyContent = !msgContent || (Array.isArray(msgContent) && msgContent.length === 0);
          const isErrorStop = msg.message?.stopReason === 'error';

          if (msg.message?.role === 'user') {
            step.type = 'llm_input';
            // B7: 剥离 inbound metadata 前缀
            step.summary = this._stripInboundMetadata(this._extractTextContent(msg.message));
          } else if (msg.message?.role === 'assistant') {
            if (isErrorStop && isEmptyContent) {
              // B1: 错误回复 content=[] + stopReason=error → 渲染为错误卡片
              step.type = 'error';
              step.isError = true;
              step.summary = msg.message.errorMessage
                ? this._truncate(msg.message.errorMessage, 200)
                : '模型请求失败';
            } else if (Array.isArray(msgContent) && msgContent.length > 0
              && msgContent.every((c: any) => c.type === 'toolCall' || c.type === 'tool_use')) {
              // B4: content 全部是 toolCall → 渲染为 tool_call
              const toolName = msgContent[0]?.name || 'unknown';
              step.type = 'tool_call';
              step.summary = `工具调用 → ${toolName}`;
            } else if (Array.isArray(msgContent) && msgContent.length > 0
              && msgContent.every((c: any) => c.type === 'thinking')) {
              // content 全部是 thinking → 渲染为 thinking meta 卡片
              step.type = 'thinking';
              step.summary = msgContent.map((c: any) => c.thinking || '').join('\n');
              // 将 thinking 内容提升到 data 顶层，供 _stepToMetaHTML case 'thinking' 读取
              step.data = { ...step.data, thinking: step.summary, thinkingSignature: msgContent[0]?.thinkingSignature };
            } else {
              step.type = 'llm_output';
              step.summary = this._extractTextContent(msg.message);
            }
          } else if (msg.message?.role === 'toolResult') {
            step.type = 'tool_result';
            step.summary = `工具结果 ← ${msg.message.toolName || 'unknown'}`;
            step.isError = msg.message.isError;
          } else {
            step.type = 'meta';
          }
          break;
        }

        default:
          // 兼容无 type 字段但有 role 的消息格式（push payload / API 直接格式）
          if (msg.role === 'user') {
            step.type = 'llm_input';
            // B7: 剥离 inbound metadata 前缀
            step.summary = this._stripInboundMetadata(this._extractTextContent(msg));
          } else if (msg.role === 'assistant') {
            // B4: 检测 content 是否全部是 toolCall/tool_use
            const defContent = msg.content;
            if (Array.isArray(defContent) && defContent.length > 0
              && defContent.every((c: any) => c.type === 'toolCall' || c.type === 'tool_use')) {
              const toolName = defContent[0]?.name || 'unknown';
              step.type = 'tool_call';
              step.summary = `工具调用 → ${toolName}`;
            } else {
              step.type = 'llm_output';
              step.summary = this._extractTextContent(msg);
            }
          } else if (msg.role === 'tool') {
            // 兼容 role=tool 的消息格式
            step.type = 'tool_result';
            step.summary = `工具结果 ← ${msg.toolName || 'unknown'}`;
          } else if (msg.role === 'toolResult') {
            step.type = 'tool_result';
            step.summary = `工具结果 ← ${msg.toolName || 'unknown'}`;
            step.isError = msg.isError;
          } else {
            // 其他类型使用 meta 样式
            step.type = 'meta';
            step.summary = msgType || 'unknown';
          }
      }

      return step;
    });

    // B5: 去重 fallback 重试产生的重复用户消息
    return this._dedupFallbackRetries(steps);
  }

  /** B5: 去除 fallback 重试导致的重复用户消息 */
  private _dedupFallbackRetries(steps: any[]): any[] {
    const result: any[] = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'llm_input' && result.length > 0) {
        // 向回查找最近的 llm_input，检查是否内容相同
        // 只跳过 error/internal/model_change 等非实质性步骤
        let isDup = false;
        for (let j = result.length - 1; j >= 0; j--) {
          const prev = result[j];
          if (prev.type === 'llm_input') {
            if (prev.summary === step.summary) isDup = true;
            break;
          }
          if (['error', 'internal', 'model_change', 'thinking_level_change'].includes(prev.type)) {
            continue;
          }
          break;
        }
        if (isDup) {
          // 标记为内部事件，不渲染
          step.type = 'internal';
          step.summary = `(fallback 重试) ${step.summary}`;
        }
      }
      result.push(step);
    }
    return result;
  }

  /** 从消息中提取文本内容 */
  private _extractTextContent(msg: any): string {
    if (!msg) return '';
    // 如果是 message 类型，从 message.content 取
    const content = msg.content || msg.message?.content;
    if (!content) return '';
    if (typeof content === 'string') return this._truncate(content, 200);
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const b of content) {
        if (b.type === 'text' && b.text) {
          parts.push(b.text);
        } else if (b.type === 'thinking' && b.thinking) {
          parts.push(b.thinking);
        }
      }
      return this._truncate(parts.join('\n'), 200);
    }
    return '';
  }

  /**
   * B7: 剥离 OpenClaw 注入的 inbound metadata 前缀
   * 参考官方实现：src/auto-reply/reply/strip-inbound-meta.ts
   */
  private _stripInboundMetadata(text: string): string {
    if (!text) return '';
    // 快速路径：没有已知 sentinel 关键词
    if (!text.includes('(untrusted metadata)') && !text.includes('[message_id:')) {
      return text;
    }
    // 移除已知 sentinel 块：Sender/Conversation info/Replied message/Channel info/Forwarded message/Untrusted context
    let stripped = text.replace(
      /(?:Conversation info|Sender|Replied message|Untrusted context|Channel info|Forwarded message)\s*\(untrusted metadata\):\s*```json\s*[\s\S]*?```\s*/g,
      ''
    );
    // 移除 [message_id: xxx] 行
    stripped = stripped.replace(/\[message_id:\s*[^\]]+\]\s*/g, '');
    // 移除时间戳前缀 "[Sat 2026-03-14 18:07 GMT+8] " 和 "Username: " 前缀
    stripped = stripped.replace(/^\[.*?\]\s*/gm, '');
    stripped = stripped.replace(/^[A-Za-z0-9_]+:\s*/m, '');
    return stripped.trim();
  }

  private _truncate(str: string, max: number): string {
    if (!str) return '';
    return str.length > max ? str.slice(0, max) + '...' : str;
  }

  private _extractLastMessagePreview(lastMessage: any): string | undefined {
    if (!lastMessage) return undefined;
    if (typeof lastMessage.content === 'string') return lastMessage.content;
    if (Array.isArray(lastMessage.content)) {
      const textBlock = lastMessage.content.find((b: any) => b.type === 'text');
      return textBlock?.text;
    }
    return undefined;
  }

  /**
   * 统一错误处理的 gateway.call 封装（改进版）
   * 错误时返回 null + emit error 事件，不阻断流程
   */
  async _callWithLog(caller: string, method: string, layer: string, params: Record<string, any>): Promise<any> {
    const start = Date.now();
    try {
      const result = await this._gateway.call(method, params);
      const durationMs = Date.now() - start;
      this._routeCallback?.({ caller, method, layer, durationMs });
      return result;
    } catch (err: any) {
      const durationMs = Date.now() - start;
      this._routeCallback?.({ caller, method, layer, durationMs, error: true });
      this._emit('error', { caller, method, error: err });
      return null;
    }
  }

  private _extractAgentId(key: string): string {
    const parts = (key || '').split(':');
    return parts.length >= 2 ? parts[1] : key;
  }

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
  private _parseSessionKey(key: string): {
    agentId: string | null;
    sessionKind: 'direct' | 'group' | 'cron' | 'hook' | 'node' | 'global' | 'other';
  } {
    if (!key) return { agentId: null, sessionKind: 'other' };
    if (key === 'global') return { agentId: null, sessionKind: 'global' };
    if (key === 'unknown') return { agentId: null, sessionKind: 'other' };
    if (key.startsWith('cron:')) return { agentId: null, sessionKind: 'cron' };
    if (key.startsWith('hook:')) return { agentId: null, sessionKind: 'hook' };
    if (key.startsWith('node-')) return { agentId: null, sessionKind: 'node' };
    const parts = key.split(':');
    if (parts[0] === 'agent' && parts.length >= 3) {
      // group key: agent:<agentId>:<channel>:group:<id> 或 :channel:<id>
      const isGroup = parts.length >= 4 && (parts[3] === 'group' || parts[3] === 'channel');
      return { agentId: parts[1], sessionKind: isGroup ? 'group' : 'direct' };
    }
    return { agentId: null, sessionKind: 'other' };
  }

  private _deriveAgentStatus(agentId: string): string {
    const hasSessions = this._activeSessions.some(
      s => this._extractAgentId(s.key) === agentId
    );
    if (!hasSessions) return 'idle';
    const hasError = this._activeSessions.some(
      s => this._extractAgentId(s.key) === agentId && s.abortedLastRun
    );
    return hasError ? 'error' : 'working';
  }

  /** 检查 session 完成时是否有关联的 AI 建议需要回填 */
  private _checkAdviceSessionComplete(sessionKey: string, lastMessage?: any): void {
    const adviceId = this._adviceSessionMap.get(sessionKey);
    if (!adviceId) return;
    console.log(`[AIAdvice] Session 完成，自动回填建议: ${adviceId} (session: ${sessionKey})`);
    // 提取最后一条消息作为结果摘要
    let resultSummary = '任务已完成';
    if (lastMessage) {
      const text = this._extractTextContent(lastMessage);
      if (text) resultSummary = text.slice(0, 200);
    }
    this._adviceSessionMap.delete(sessionKey);
    this.updateAdviceStatus(adviceId, 'completed', { resultSummary }).catch(() => { });
  }

  /** 检查 session 出错时是否有关联的 AI 建议需要标记失败 */
  private _checkAdviceSessionFailed(sessionKey: string): void {
    const adviceId = this._adviceSessionMap.get(sessionKey);
    if (!adviceId) return;
    console.log(`[AIAdvice] Session 失败，标记建议: ${adviceId} (session: ${sessionKey})`);
    this._adviceSessionMap.delete(sessionKey);
    this.updateAdviceStatus(adviceId, 'failed').catch(() => { });
  }
}
