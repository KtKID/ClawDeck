// plugin/index.ts — ClawDeck 插件入口
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { registerHooks } from "./src/hooks.js";
import { registerGatewayMethods } from "./src/gateway-methods.js";
import { registerHttpRoutes } from "./src/http.js";
import { EventRecorder } from "./src/event-recorder.js";
import { debugLog, initDebugLog } from "./src/debug-log.js";

// 插件配置接口
interface ClawDeckConfig {
  log?: {
    maxFileSize?: number;      // 最大文件大小（字节），默认 5MB
    autoCleanupDays?: number;  // 自动清理天数，0=不清理
    pollInterval?: number;     // 前端轮询间隔（毫秒），默认 5000
  };
}

const plugin = {
  id: "clawdeck",
  name: "ClawDeck",
  description: "OpenClaw 任务看板与可视化交互层插件",

  register(api: OpenClawPluginApi) {
    // 读取插件配置
    const cfg = (api.pluginConfig || {}) as ClawDeckConfig;
    const logCfg = cfg.log || {};

    // ⭐ 初始化日志（必须在所有 debugLog 调用之前）
    // 使用绝对路径：Windows 用 %TEMP%/ClawDeck，Unix/Linux/macOS 用 /tmp/ClawDeck
    const logDir = process.platform === 'win32'
      ? path.join(process.env.TEMP || process.env.TMP || path.join(os.homedir(), 'AppData', 'Local', 'Temp'), 'ClawDeck')
      : '/tmp/ClawDeck';
    // 确保目录存在
    fs.mkdirSync(logDir, { recursive: true });
    initDebugLog(logDir, {
      maxFileSize: logCfg.maxFileSize,
      autoCleanupDays: logCfg.autoCleanupDays,
    });

    debugLog("init", "ClawDeck plugin register() called", {
      config: { maxFileSize: logCfg.maxFileSize, autoCleanupDays: logCfg.autoCleanupDays }
    });

    // 事件录制器（默认启用，CLAWDECK_RECORD=0 可禁用）
    const recorder = new EventRecorder();
    if (recorder.enabled) {
      api.logger.info("ClawDeck event recorder enabled");
      debugLog("init", "Event recorder enabled");
    }

    // 1. Hook 采集（仅录制，steps 数据由前端通过 chat.history 获取）
    registerHooks(api, recorder);
    debugLog("init", "Hooks registered");

    // 2. 注册 Gateway Method（审计 + 录制）
    registerGatewayMethods(api, recorder);
    debugLog("init", "Gateway methods registered");

    // 3. 注册 HTTP 路由（serve 前端资源）
    registerHttpRoutes(api);
    debugLog("init", "HTTP routes registered");

    // 4. 注册服务（stop 时 flush 录制数据）
    api.registerService({
      id: "clawdeck-recorder",
      async start(ctx) {
        ctx.logger.info("ClawDeck recorder service started");
      },
      async stop(ctx) {
        if (recorder?.enabled) {
          const count = recorder.count;
          const savedPath = recorder.flush();
          if (savedPath) {
            ctx.logger.info(`ClawDeck recorder flushed ${count} events → ${savedPath}`);
          }
        }
        ctx.logger.info("ClawDeck recorder service stopped");
      },
    });
    debugLog("init", "Recorder service registered");

    api.logger.info("ClawDeck plugin registered");
    debugLog("init", "Plugin registration complete");
  },
};

export default plugin;
