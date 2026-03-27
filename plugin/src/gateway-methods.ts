// plugin/src/gateway-methods.ts — Gateway Method 注册（精简版）
// 删除已废弃的 clawdeck.session.detail（被 chat.history 官方方法替代）
// 保留 clawdeck.action（审计日志入口）、clawdeck.recording / clawdeck.recording.flush
// AI 建议数据改由前端直接 HTTP GET /plugins/clawdeck/api/ai-advices（见 http.ts）
import * as fs from 'fs';
import * as path from 'path';
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { EventRecorder } from "./event-recorder.js";
import type { ActionRequest, ActionResult } from "./types.js";
import { debugLog, getServerLogs, getLatestLogId, getLogFilePath, getOptions } from "./debug-log.js";

/**
 * 注册 Gateway Method：审计 + 录制。
 */
export function registerGatewayMethods(api: OpenClawPluginApi, recorder?: EventRecorder): void {
  // ================================================================
  // 录制数据查询
  // ================================================================

  /** 查询录制的事件列表 + 摘要 */
  api.registerGatewayMethod("clawdeck.recording", async ({ respond }) => {
    if (!recorder) {
      respond(true, { enabled: false, count: 0, events: [] });
      return;
    }
    const summary = recorder.getSummary();
    respond(true, { ...summary, events: recorder.getEvents() });
  });

  /** 手动 flush 录制数据到文件 */
  api.registerGatewayMethod("clawdeck.recording.flush", async ({ respond }) => {
    if (!recorder) {
      respond(false, undefined, { message: "Recorder not available" });
      return;
    }
    const filePath = recorder.flush();
    respond(true, { flushed: !!filePath, path: filePath, count: recorder.count });
  });

  // ================================================================
  // 控制类（审计日志入口）
  // ================================================================

  /**
   * clawdeck.action — 统一控制审计入口
   *
   * params: ActionRequest { action, sessionId, instruction? }
   *
   * 注意：实际控制操作由前端直接调用 Gateway 内置方法完成：
   *   - instruct → chat.send({ sessionKey, message, idempotencyKey })
   *   - interrupt → chat.abort({ sessionKey })
   *   - approve  → exec.approval.resolve({ id, decision })
   *   - retry    → chat.send({ sessionKey, message: "/retry" })
   *
   * 此方法保留作为操作审计日志入口。
   */
  api.registerGatewayMethod("clawdeck.action", async ({ params, respond }) => {
    const req = params as unknown as ActionRequest;

    if (!req?.action || !req?.sessionId) {
      respond(false, undefined, { message: "action and sessionId are required" });
      return;
    }

    const result = await dispatchAction(api, req);
    respond(result.ok, result, result.ok ? undefined : { message: result.error });
  });

  // ================================================================
  // 日志查询
  // ================================================================

  /**
   * clawdeck.logs — 获取插件调试日志
   *
   * params: { sinceId?: number }
   * returns: { entries: LogEntry[], latestId: number, count: number, options: DebugLogOptions }
   */
  api.registerGatewayMethod("clawdeck.logs", async ({ params, respond }) => {
    try {
      const sinceId = (params as { sinceId?: number })?.sinceId || 0;
      const entries = getServerLogs(sinceId);
      debugLog("rpc", "clawdeck.logs", { sinceId, count: entries.length });
      respond(true, {
        entries,
        latestId: getLatestLogId(),
        count: entries.length,
        options: getOptions(),
      });
    } catch (err) {
      respond(false, undefined, { message: String(err) });
    }
  });

  /**
   * clawdeck.logs.path — 获取日志文件路径（调试用）
   */
  api.registerGatewayMethod("clawdeck.logs.path", async ({ respond }) => {
    respond(true, { path: getLogFilePath() });
  });

  /**
   * clawdeck.logs.write — 前端写入调试日志（供 refresh-tracker 等前端模块使用）
   *
   * params: { cat: string, msg: string }
   */
  api.registerGatewayMethod("clawdeck.logs.write", async ({ params, respond }) => {
    const { cat = 'frontend', msg = '' } = (params as { cat?: string; msg?: string }) || {};
    if (msg) debugLog(cat, msg);
    respond(true, {});
  });

  api.logger.info("ClawDeck gateway methods registered");
}

// ============================================================
// Action 分发（审计日志）
// ============================================================

async function dispatchAction(
  api: OpenClawPluginApi,
  req: ActionRequest,
): Promise<ActionResult> {
  const { action, sessionId } = req;

  switch (action) {
    case "interrupt":
      api.logger.info(`[ClawDeck] action=interrupt sessionId=${sessionId}`);
      return { ok: true, action, sessionId };

    case "approve":
      api.logger.info(`[ClawDeck] action=approve sessionId=${sessionId}`);
      return { ok: true, action, sessionId };

    case "retry":
      api.logger.info(`[ClawDeck] action=retry sessionId=${sessionId}`);
      return { ok: true, action, sessionId };

    case "instruct":
      api.logger.info(`[ClawDeck] action=instruct sessionId=${sessionId} instruction="${req.instruction || ""}"`);
      return { ok: true, action, sessionId };

    default:
      return { ok: false, action, sessionId, error: `Unknown action: ${action}` };
  }
}
