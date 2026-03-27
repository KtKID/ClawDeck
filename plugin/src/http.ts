// plugin/src/http.ts — HTTP 路由：serve 前端静态资源
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { debugLog } from "./debug-log.js";

const PLUGIN_PATH = "/plugins/clawdeck";
const ASSETS_DIR = path.resolve(import.meta.dirname || __dirname, "..", "assets");
// ClawDeck 项目根目录（plugin/ 的父目录），用于 serve engine/world/ui/bridge/css
const PROJECT_ROOT = path.resolve(ASSETS_DIR, "..");
const PROFILE_DEFAULT_PATH = path.join(ASSETS_DIR, "agent-profiles.default.json");

/** 允许从项目根目录 serve 的子目录白名�?*/
const ALLOWED_ROOT_DIRS = ["engine", "world", "ui", "bridge", "css", "i18n"];

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png":  "image/png",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
};

export function registerHttpRoutes(api: OpenClawPluginApi): void {
  api.registerHttpRoute({
    path: PLUGIN_PATH,
    auth: "plugin",
    match: "prefix",
    handler: createHandler(api),
  });
  api.logger.info(`ClawDeck HTTP route registered at ${PLUGIN_PATH}/`);
}

function createHandler(api: OpenClawPluginApi) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = parseUrl(req.url);
    if (!url) return false;

    // 路径解析�?plugins/clawdeck/ �?index.html
    let relPath = url.pathname.slice(PLUGIN_PATH.length);
    if (relPath === "" || relPath === "/") relPath = "/index.html";

    const openclawHome = process.env.OPENCLAW_HOME || path.join(os.homedir(), ".openclaw");
    const statusFilePath = path.join(openclawHome, "workspace", "clawdeck-advice-status.json");
    const clawdeckWorkspaceDir = resolveClawdeckWorkspaceDir(openclawHome);
    const profileFilePath = path.join(clawdeckWorkspaceDir, "agent-profiles.json");
    const avatarDir = resolveClawdeckAvatarDir(openclawHome);
    ensureDir(avatarDir, "agent-avatars");

    // API: GET /api/agent-profiles - ��ȡ workspace profile�����������ʼ����
    if ((req.method === "GET" || req.method === "HEAD") && (relPath === "/api/agent-profiles" || relPath === "/api/agent-profiles/")) {
      const profiles = loadAgentProfiles(clawdeckWorkspaceDir, profileFilePath);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify(profiles));
      return true;
    }

    // API: PATCH /api/ai-advices/:id - 更新建议状态
    if (req.method === "PATCH" && relPath.startsWith("/api/ai-advices/")) {
      const adviceId = decodeURIComponent(relPath.slice("/api/ai-advices/".length));
      if (!adviceId) {
        respond(res, 400, "application/json", JSON.stringify({ error: "missing advice id" }));
        return true;
      }
      try {
        const body = await readBody(req);
        const { status, sessionId, runId, resultSummary } = JSON.parse(body);
        const validStatuses = ["pending", "dispatched", "running", "completed", "failed", "dismissed"];
        if (!status || !validStatuses.includes(status)) {
          respond(res, 400, "application/json", JSON.stringify({ error: "invalid status" }));
          return true;
        }
        // 读取现有状态文件
        let statusData: Record<string, any> = {};
        try {
          if (fs.existsSync(statusFilePath)) {
            statusData = JSON.parse(fs.readFileSync(statusFilePath, "utf-8"));
          }
        } catch { /* 文件不存在或解析失败，使用空对象 */ }
        // 更新状态，保留已有字段，避免 completed PATCH 覆盖 runId 或 sessionId
        statusData[adviceId] = {
          ...statusData[adviceId],
          status,
          ...(sessionId ? { sessionId } : {}),
          ...(runId ? { runId } : {}),
          ...(resultSummary ? { resultSummary } : {}),
          updatedAt: new Date().toISOString(),
        };
        // 原子写入：temp + rename
        const tmpPath = statusFilePath + ".tmp";
        fs.writeFileSync(tmpPath, JSON.stringify(statusData, null, 2), "utf-8");
        fs.renameSync(tmpPath, statusFilePath);
        debugLog("http", "ai-advices PATCH", { adviceId, status, sessionId: sessionId ?? null, runId: runId ?? null, resultSummary: resultSummary ?? null, written: statusData[adviceId] });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, adviceId, status }));
      } catch (e) {
        debugLog("http", "ai-advices PATCH error", { error: String(e) });
        respond(res, 500, "application/json", JSON.stringify({ error: String(e) }));
      }
      return true;
    }

    // �?API 路由的方法守卫：只允�?GET/HEAD
    if (relPath.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "PATCH") {
        respond(res, 405, "text/plain", "Method Not Allowed");
        return true;
      }
    } else {
      if (req.method !== "GET" && req.method !== "HEAD") {
        respond(res, 405, "text/plain", "Method Not Allowed");
        return true;
      }
    }

    // API: /api/ai-advices �?�?$OPENCLAW_HOME/workspace/suggestions/*.json + 合并状态文�?
    if (relPath === "/api/ai-advices" || relPath === "/api/ai-advices/") {
      const suggestionsDir = path.join(openclawHome, "workspace", "suggestions");
      const includeAll = url.searchParams.get("include") === "all";
      debugLog("http", "ai-advices OPENCLAW_HOME", { env: process.env.OPENCLAW_HOME });
      debugLog("http", "ai-advices suggestionsDir", { dir: suggestionsDir });
      try {
        const dirExists = fs.existsSync(suggestionsDir);
        debugLog("http", "ai-advices dirExists", { exists: dirExists });
        if (!dirExists) {
          debugLog("http", "ai-advices fallback: suggestions dir missing", {
            openclawHome,
            suggestionsDir,
            cwd: process.cwd(),
          });
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ advices: [], config: { maxAdviceCount: 3 } }));
          return true;
        }
        const files = fs.readdirSync(suggestionsDir).filter(f => f.endsWith(".json"));
        debugLog("http", "ai-advices json files", { files, count: files.length });
        if (files.length === 0) {
          debugLog("http", "ai-advices fallback: no json files", {
            openclawHome,
            suggestionsDir,
          });
        }
        const advices: any[] = [];
        let maxAdviceCount = 3;
        for (const file of files) {
          try {
            const filePath = path.join(suggestionsDir, file);
            const raw = fs.readFileSync(filePath, "utf-8");
            debugLog("http", "ai-advices file content", { file, filePath, content: raw.slice(0, 300) });
            const data = JSON.parse(raw);
            const adviceCount = Array.isArray(data.advices) ? data.advices.length : 0;
            debugLog("http", "ai-advices parsed file", {
              file,
              filePath,
              adviceCount,
              maxAdviceCount: data.config?.maxAdviceCount ?? null,
            });
            if (Array.isArray(data.advices)) advices.push(...data.advices);
            if (data.config?.maxAdviceCount) maxAdviceCount = data.config.maxAdviceCount;
          } catch (e) {
            debugLog("http", "ai-advices parse error", { file, error: String(e) });
          }
        }
        // 合并独立状态文件
        let statusData: Record<string, any> = {};
        try {
          if (fs.existsSync(statusFilePath)) {
            statusData = JSON.parse(fs.readFileSync(statusFilePath, "utf-8"));
          }
        } catch {
          /* 状态文件不存在或解析失败 */
        }
        // 合并 status 到每个 advice
        for (const advice of advices) {
          const st = statusData[advice.id];
          if (st) {
            advice.status = st.status;
            if (st.sessionId) advice.sessionId = st.sessionId;
            if (st.runId) advice.runId = st.runId;
            if (st.resultSummary) advice.resultSummary = st.resultSummary;
            if (st.updatedAt) advice.statusUpdatedAt = st.updatedAt;
          } else {
            advice.status = "pending";
          }
        }
        // 过滤：默认只返回 pending + dispatched，include=all 返回全部
        const filtered = includeAll
          ? advices
          : advices.filter(a => a.status === "pending" || a.status === "dispatched");
        filtered.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
        debugLog("http", "ai-advices response", {
          total: advices.length,
          filtered: filtered.length,
          includeAll,
          maxAdviceCount,
          adviceIds: advices.map(a => a.id ?? null),
          filteredIds: filtered.map(a => a.id ?? null),
        });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ advices: filtered, config: { maxAdviceCount } }));
      } catch (e) {
        debugLog("http", "ai-advices read error", {
          error: String(e),
          openclawHome,
          suggestionsDir,
          cwd: process.cwd(),
        });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ advices: [], config: { maxAdviceCount: 3 } }));
      }
      return true;
    }

    // 尝试解析文件：先 assets/，再 project root（白名单目录�?    
    // API: GET /avatars/* - workspace avatar assets
    if ((req.method === "GET" || req.method === "HEAD") && relPath.startsWith("/avatars/")) {
      const file = resolveAvatarFile(avatarDir, relPath);
      if (!file) {
        respond(res, 404, "text/plain", "Not Found");
        return true;
      }
      const ext = path.extname(file).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      });
      if (req.method === "HEAD") {
        res.end();
      } else {
        fs.createReadStream(file).pipe(res);
      }
      return true;
    }

    const resolved = resolveFile(relPath);
    if (!resolved) {
      respond(res, 404, "text/plain", "Not Found");
      return true;
    }

    try {
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {
        respond(res, 404, "text/plain", "Not Found");
        return true;
      }

      const ext = path.extname(resolved).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";

      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      });

      if (req.method === "HEAD") {
        res.end();
      } else {
        fs.createReadStream(resolved).pipe(res);
      }
      return true;
    } catch {
      respond(res, 404, "text/plain", "Not Found");
      return true;
    }
  };
}

function resolveClawdeckWorkspaceDir(openclawHome: string): string {
  return path.join(openclawHome, ".openclaw", "workspace", ".clawdeck");
}

function resolveClawdeckAvatarDir(openclawHome: string): string {
  return path.join(resolveClawdeckWorkspaceDir(openclawHome), "assets", "avatars");
}

function loadAgentProfiles(clawdeckDir: string, profileFilePath: string): { profiles: Record<string, any> } {
  try {
    fs.mkdirSync(clawdeckDir, { recursive: true });
  } catch (e) {
    debugLog("http", "agent-profiles mkdir failed", { error: String(e), dir: clawdeckDir });
  }
  if (!fs.existsSync(profileFilePath)) {
    try {
      if (fs.existsSync(PROFILE_DEFAULT_PATH)) {
        fs.copyFileSync(PROFILE_DEFAULT_PATH, profileFilePath);
      } else {
        fs.writeFileSync(profileFilePath, JSON.stringify({ profiles: {} }, null, 2), "utf-8");
      }
    } catch (e) {
      debugLog("http", "agent-profiles init failed", { error: String(e), path: profileFilePath });
      return { profiles: {} };
    }
  }
  try {
    const raw = fs.readFileSync(profileFilePath, "utf-8");
    const data = JSON.parse(raw);
    const profiles = data && typeof data === "object" && data.profiles && typeof data.profiles === "object"
      ? data.profiles
      : {};
    return { profiles };
  } catch (e) {
    debugLog("http", "agent-profiles read failed", { error: String(e), path: profileFilePath });
    return { profiles: {} };
  }
}

/**
 * 解析请求路径到磁盘文件�? * 1. 优先�?assets/ 查找
 * 2. 若路径以白名单目录开头，�?project root 查找
 * 所有路径均做目录穿越检查�? */
function ensureDir(dir: string, label: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    debugLog("http", `${label} mkdir failed`, { error: String(e), dir });
  }
}

function resolveAvatarFile(avatarDir: string, relPath: string): string | null {
  const rel = relPath.slice("/avatars/".length);
  if (!rel) return null;
  const resolved = path.resolve(avatarDir, rel);
  if (!resolved.startsWith(avatarDir)) return null;
  if (!fileExists(resolved)) return null;
  return resolved;
}

function resolveFile(relPath: string): string | null {
  // 1. assets/ 优先
  const assetPath = path.resolve(ASSETS_DIR, "." + relPath);
  if (assetPath.startsWith(ASSETS_DIR) && fileExists(assetPath)) {
    return assetPath;
  }

  // 2. 白名单目�?fallback（engine/, world/, ui/, bridge/, css/�?
  const firstSeg = relPath.split("/").filter(Boolean)[0];
  if (firstSeg && ALLOWED_ROOT_DIRS.includes(firstSeg)) {
    const rootPath = path.resolve(PROJECT_ROOT, "." + relPath);
    if (rootPath.startsWith(PROJECT_ROOT) && fileExists(rootPath)) {
      return rootPath;
    }
  }

  return null;
}

function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function parseUrl(raw?: string): URL | null {
  if (!raw) return null;
  try {
    return new URL(raw, "http://127.0.0.1");
  } catch {
    return null;
  }
}

function respond(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

/** 读取请求体（用于 PATCH 等非 GET 请求�?*/
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}





