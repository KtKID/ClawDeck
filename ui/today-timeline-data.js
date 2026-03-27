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
  {
    id: 'evt_20260319_001',
    time: '01:09',
    title: '按照这个规则更新 skill',
    summary: '用户发起执行型请求',
    statusLabel: '进行中',
    statusTone: 'current',
    triggerLabel: '开始执行',
    actorName: '主助手',
    actorEmoji: '🤖',
  },
  {
    id: 'evt_20260319_002',
    time: '08:32',
    title: '任务完成',
    summary: '阶段已收尾，本次委托已解决',
    statusLabel: '已解决',
    statusTone: 'success',
    triggerLabel: '完成回执',
    actorName: '主助手',
    actorEmoji: '🤖',
  },
  {
    id: 'evt_20260319_003',
    time: '09:47',
    title: '解读 VCP 视频内容',
    summary: '用户发起执行型请求',
    statusLabel: '进行中',
    statusTone: 'current',
    triggerLabel: '开始执行',
    actorName: '主助手',
    actorEmoji: '🤖',
  },
  {
    id: 'evt_20260319_004',
    time: '09:49',
    title: '查看刚才用了什么 skill',
    summary: '追问上一步操作来源',
    statusLabel: '进行中',
    statusTone: 'current',
    triggerLabel: '继续跟进',
    actorName: '主助手',
    actorEmoji: '🤖',
  },
  {
    id: 'evt_20260319_005',
    time: '11:04',
    title: '优化 xClawSkill / daily-suggestion',
    summary: '先产出优化方案，等待确认后再动手',
    statusLabel: '进行中',
    statusTone: 'current',
    triggerLabel: '方案准备',
    actorName: '主助手',
    actorEmoji: '🤖',
  },
  {
    id: 'evt_20260319_006',
    time: '17:02',
    title: '部署 ClawDeck',
    summary: '任务执行失败，需要进一步排查',
    statusLabel: '未解决',
    statusTone: 'warning',
    triggerLabel: '失败告警',
    actorName: '主助手',
    actorEmoji: '🤖',
  },
  {
    id: 'evt_20260319_007',
    time: '17:13',
    title: '执行 event-collect 技能',
    summary: '继续收集结构化事件，补全时间线素材',
    statusLabel: '进行中',
    statusTone: 'current',
    triggerLabel: '开始执行',
    actorName: '主助手',
    actorEmoji: '🤖',
  },
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
