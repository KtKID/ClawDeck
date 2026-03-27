// plugin/src/hooks.ts — Hook 采集层（录制专用）
// 仅保留事件录制功能，steps 时间线由前端通过 chat.history 官方方法获取
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { EventRecorder } from "./event-recorder.js";
import { debugLog } from "./debug-log.js";

/**
 * 注册 Hook 事件录制。
 * 所有 LLM/工具调用事件仅用于录制，前端数据通过官方 Gateway 方法获取。
 */
export function registerHooks(
  api: OpenClawPluginApi,
  recorder?: EventRecorder,
): void {
  // ---- LLM 调用 ----
  api.on("llm_input", async (event: any, ctx: any) => {
    if (!recorder?.enabled) return;
    const params = {
      sessionId: event.sessionId || ctx.sessionId,
      runId: event.runId,
      provider: event.provider,
      model: event.model,
      timestamp: Date.now(),
    };
    debugLog("hook", "llm_input", { sessionId: params.sessionId, model: params.model });
    recorder.record("llm_input", params);
  });

  api.on("llm_output", async (event: any, ctx: any) => {
    if (!recorder?.enabled) return;
    const params = {
      sessionId: event.sessionId || ctx.sessionId,
      runId: event.runId,
      provider: event.provider,
      model: event.model,
      usage: event.usage || {},
      timestamp: Date.now(),
    };
    debugLog("hook", "llm_output", { sessionId: params.sessionId, model: params.model, usage: params.usage });
    recorder.record("llm_output", params);
  });

  // ---- 工具调用 ----
  api.on("before_tool_call", async (event: any, ctx: any) => {
    if (!recorder?.enabled) return;
    const params = {
      sessionId: ctx.sessionId,
      toolName: event.toolName,
      params: event.params,
      runId: event.runId,
      toolCallId: event.toolCallId,
      timestamp: Date.now(),
    };
    debugLog("hook", "before_tool_call", { sessionId: params.sessionId, toolName: params.toolName });
    recorder.record("before_tool_call", params);
  });

  api.on("after_tool_call", async (event: any, ctx: any) => {
    if (!recorder?.enabled) return;
    const params = {
      sessionId: ctx.sessionId,
      toolName: event.toolName,
      result: event.result,
      error: event.error,
      durationMs: event.durationMs,
      runId: event.runId,
      toolCallId: event.toolCallId,
      timestamp: Date.now(),
    };
    debugLog("hook", "after_tool_call", { sessionId: params.sessionId, toolName: params.toolName, error: params.error });
    recorder.record("after_tool_call", params);
  });

  api.logger.info("ClawDeck hooks registered" + (recorder?.enabled ? " (recording enabled)" : ""));
  debugLog("hook", "All hooks registered (recording only)");
}
