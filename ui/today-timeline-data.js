// ui/today-timeline-data.js — 今日时间线 Mock 数据层
// 基于 test/timeline/2026-03-19.jsonl 的事件流数据整理。

/**
 * @typedef {Object} TimelineEvent
 * @property {string} id
 * @property {string} time
 * @property {string} title
 * @property {string} summary
 * @property {string} statusLabel
 * @property {string} statusTone   - success | current | warning | pending
 * @property {string} triggerLabel
 * @property {string} actorName
 * @property {string} actorEmoji
 * @property {string=} sessionId
 * @property {string=} content
 */

/**
 * 今日事件流（节选自 2026-03-19.jsonl）
 * 用于模拟“开始 / 完成 / 失败”混合状态的时间线。
 * @type {TimelineEvent[]}
 */
export const todayTasks = [
];

/**
 * @typedef {Object} TickerEvent
 * @property {string} type
 * @property {string} text
 */

/**
 * 摘要条：避免重复标题，强调状态与上下文。
 * @type {TickerEvent[]}
 */
export const tickerEvents = [
  { type: 'info', text: '今天的时间线更像事件流，而不是单纯的已完成清单' },
  { type: 'success', text: '已解决事件会突出“完成回执”，方便一眼扫过收尾节点' },
  { type: 'warning', text: '失败事件会单独提亮，避免被埋在普通进行中卡片里' },
  { type: 'info', text: '标题缺失时优先回退到用户原话，再退到摘要文案' },
];
