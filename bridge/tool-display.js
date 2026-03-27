// bridge/src/tool-display.ts
// 移植自 openclaw/src/agents/tool-display-overrides.json
// 提供工具名称到 emoji 和标题的映射
/**
 * 工具显示映射表
 * key: 工具名称（小写）
 * value: { emoji, title }
 */
export const TOOL_DISPLAY = {
    // 执行类
    exec: { emoji: '🛠️', title: 'Exec' },
    bash: { emoji: '🛠️', title: 'Exec' },
    tool_call: { emoji: '🧰', title: 'Tool Call' },
    tool_call_update: { emoji: '🧰', title: 'Tool Call' },
    apply_patch: { emoji: '🩹', title: 'Apply Patch' },
    // Web 类
    web_search: { emoji: '🔎', title: 'Web Search' },
    web_fetch: { emoji: '📄', title: 'Web Fetch' },
    // 记忆类
    memory_search: { emoji: '🧠', title: 'Memory Search' },
    memory_get: { emoji: '📓', title: 'Memory Get' },
    // 消息类
    message: { emoji: '✉️', title: 'Message' },
    // Session 类
    sessions_spawn: { emoji: '🧑‍🔧', title: 'Sub-agent' },
    sessions_send: { emoji: '📨', title: 'Session Send' },
    sessions_list: { emoji: '🗂️', title: 'Sessions' },
    sessions_history: { emoji: '🧾', title: 'Session History' },
    session_status: { emoji: '📊', title: 'Session Status' },
    // Agent 类
    subagents: { emoji: '🤖', title: 'Subagents' },
    agents_list: { emoji: '🧭', title: 'Agents' },
};
/** 默认回退 */
const FALLBACK = { emoji: '🧩', title: 'Tool' };
/**
 * 根据工具名称获取显示信息
 */
export function resolveToolDisplay(toolName) {
    if (!toolName)
        return FALLBACK;
    const key = String(toolName).trim().toLowerCase();
    return TOOL_DISPLAY[key] || FALLBACK;
}
/**
 * 获取工具的 emoji
 */
export function getToolEmoji(toolName) {
    return resolveToolDisplay(toolName).emoji;
}
/**
 * 获取工具的标题
 */
export function getToolTitle(toolName) {
    return resolveToolDisplay(toolName).title;
}
