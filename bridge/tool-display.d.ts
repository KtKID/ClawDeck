export interface ToolDisplay {
    emoji: string;
    title: string;
}
/**
 * 工具显示映射表
 * key: 工具名称（小写）
 * value: { emoji, title }
 */
export declare const TOOL_DISPLAY: Record<string, ToolDisplay>;
/**
 * 根据工具名称获取显示信息
 */
export declare function resolveToolDisplay(toolName: string | undefined | null): ToolDisplay;
/**
 * 获取工具的 emoji
 */
export declare function getToolEmoji(toolName: string): string;
/**
 * 获取工具的标题
 */
export declare function getToolTitle(toolName: string): string;
