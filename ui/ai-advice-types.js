// ui/ai-advice-types.js — AI 建议数据类型定义

import { t } from '../i18n/index.js';

/**
 * AI 建议数据类型
 * @typedef {Object} AIAdvice
 * @property {string} id - 建议唯一 ID
 * @property {string} source - 来源（代码扫描、Issue扫描、AI规划等）
 * @property {number} priority - 优先级（1-5，5最高）
 * @property {string} title - 建议标题
 * @property {string} summary - 建议摘要
 * @property {string} owner - 负责人
 * @property {number} estimatedMinutes - 预计时间（分钟）
 */

/**
 * 优先级映射配置
 */
export const PRIORITY_CONFIG = {
  HIGH: { min: 5, max: 5, key: 'priority.high', className: 'high' },
  MEDIUM: { min: 3, max: 4, key: 'priority.medium', className: 'medium' },
  LOW: { min: 1, max: 2, key: 'priority.low', className: 'low' },
};

/**
 * 最大建议数量默认值
 */
export const MAX_ADVICE_COUNT = 3;

/**
 * 将优先级数值转换为显示信息
 * @param {number} priority - 优先级数值（1-5）
 * @returns {{label: string, className: string}}
 */
export function getPriorityInfo(priority) {
  if (priority >= PRIORITY_CONFIG.HIGH.min) {
    return { label: t(PRIORITY_CONFIG.HIGH.key), className: PRIORITY_CONFIG.HIGH.className };
  }
  if (priority >= PRIORITY_CONFIG.MEDIUM.min) {
    return { label: t(PRIORITY_CONFIG.MEDIUM.key), className: PRIORITY_CONFIG.MEDIUM.className };
  }
  return { label: t(PRIORITY_CONFIG.LOW.key), className: PRIORITY_CONFIG.LOW.className };
}

/**
 * 过滤并限制建议数量
 * @param {AIAdvice[]} advices - 建议列表
 * @param {number} maxCount - 最大数量，默认 MAX_ADVICE_COUNT
 * @returns {AIAdvice[]}
 */
export function limitAdvices(advices, maxCount = MAX_ADVICE_COUNT) {
  if (!advices) return [];
  return advices.slice(0, maxCount);
}
