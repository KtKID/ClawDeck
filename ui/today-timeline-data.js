// ui/today-timeline-data.js — 今日时间线 Mock 数据层
// 基于 test/timeline/2026-03-19.jsonl 的事件流数据整理。
import { t } from '../i18n/index.js';

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
/** 动态生成 ticker 文案（语言切换时需重新调用） */
export function getTickerEvents() {
  return [
    { type: 'info', text: t('timeline.ticker.tip_eventstream') },
    { type: 'success', text: t('timeline.ticker.tip_resolved') },
    { type: 'warning', text: t('timeline.ticker.tip_failed') },
    { type: 'info', text: t('timeline.ticker.tip_fallback') },
  ];
}

// 兼容旧引用（首次加载）
export const tickerEvents = getTickerEvents();
