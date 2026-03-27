// i18n/index.js — 极简国际化核心模块（零依赖，ES Module）

import zh from './locales/zh.js';
import en from './locales/en.js';

const LOCALES = { zh, en };
const STORAGE_KEY = 'clawdeck_locale';
const DEFAULT_LOCALE = 'zh';

/**
 * 根据浏览器语言自动检测适合的 locale
 * @returns {'zh'|'en'}
 */
function detectBrowserLocale() {
  const browserLangs = navigator.languages || [navigator.language];
  for (const lang of browserLangs) {
    if (lang.startsWith('zh')) return 'zh';
    if (lang.startsWith('en')) return 'en';
  }
  return DEFAULT_LOCALE;
}

let _locale = localStorage.getItem(STORAGE_KEY) || detectBrowserLocale();
const _listeners = new Set();

/**
 * 翻译 key，支持简单变量替换 {{varName}}
 * @param {string} key
 * @param {Record<string, string|number>} [vars]
 * @returns {string}
 */
export function t(key, vars) {
  const dict = LOCALES[_locale] || LOCALES[DEFAULT_LOCALE];
  let str = dict[key];

  // 回退到默认语言
  if (str === undefined) {
    str = LOCALES[DEFAULT_LOCALE][key];
    if (str === undefined) {
      console.warn(`[i18n] missing key: "${key}"`);
      return key;
    }
  }

  // 变量替换 {{varName}}
  if (vars) {
    str = str.replace(/\{\{(\w+)\}\}/g, (_, k) =>
      vars[k] !== undefined ? String(vars[k]) : `{{${k}}}`
    );
  }

  return str;
}

/**
 * 切换语言
 * @param {'zh'|'en'} lang
 */
export function setLocale(lang) {
  if (!LOCALES[lang]) {
    console.warn(`[i18n] unsupported locale: "${lang}"`);
    return;
  }
  if (_locale === lang) return;
  _locale = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  _listeners.forEach(fn => fn(lang));
}

/** 获取当前语言 */
export function getLocale() {
  return _locale;
}

/**
 * 切换到另一种语言（zh↔en）
 */
export function toggleLocale() {
  setLocale(_locale === 'zh' ? 'en' : 'zh');
}

/**
 * 订阅语言变更事件
 * @param {(lang: string) => void} fn
 * @returns {() => void} 取消订阅函数
 */
export function onLocaleChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

// 初始化 html lang 属性
document.documentElement.lang = _locale === 'zh' ? 'zh-CN' : 'en';

/** 可用语言列表 */
export const AVAILABLE_LOCALES = Object.keys(LOCALES); // ['zh', 'en']

/**
 * 检查某个 key 在当前语言是否有翻译
 * @param {string} key
 * @returns {boolean}
 */
export function hasKey(key) {
  return LOCALES[_locale]?.[key] !== undefined;
}
