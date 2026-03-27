// ui/utils.js — 通用工具函数

/**
 * HTML 转义
 * @param {any} str
 * @returns {string}
 */
export function escape(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
