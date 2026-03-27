// plugin/src/types.ts — ClawDeck 共享类型定义（精简版）
// Session/Step 类型已由前端直接使用官方 chat.history 返回的结构。
// 保留控制命令类型（审计用）。

// ============================================================
// 控制命令（审计日志用）
// ============================================================

export type ActionType = "approve" | "interrupt" | "retry" | "instruct";

export interface ActionRequest {
  action: ActionType;
  sessionId: string;
  /** instruct 时附带的指令文本 */
  instruction?: string;
}

export interface ActionResult {
  ok: boolean;
  action: ActionType;
  sessionId: string;
  error?: string;
}
