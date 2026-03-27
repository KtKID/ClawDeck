// ui/refresh-tracker.js
// 刷新追踪工具 —— 注入各 refresh() 函数，在控制台输出调用来源和频率统计
// 用法：import { refreshTracker } from './refresh-tracker.js';
//        在 refresh() 开头调用 refreshTracker.track('YourComponent.refresh')
// 全局调用：window.refreshSummary() 查看频率汇总，window.refreshTracker.reset() 重置
// 后端写入：refreshTracker.setBackendLogger(fn) 接入 clawdeck.logs.write，日志持久化到 /tmp/ClawDeck

const WINDOW_MS = 10_000; // 10s 滑动窗口
const HIGH_FREQ = 10;     // >10次/10s → 红色警告
const MED_FREQ  = 3;      // >3次/10s  → 橙色提示

class RefreshTracker {
  constructor() {
    // name → { count, timestamps, lastCallers }
    this._stats = new Map();
    /** @type {((cat: string, msg: string) => void) | null} */
    this._backendLogger = null;
  }

  /**
   * 设置后端日志写入函数，接通 clawdeck.logs.write Gateway Method
   * @param {(cat: string, msg: string) => void} fn
   */
  setBackendLogger(fn) {
    this._backendLogger = fn;
  }

  /**
   * 在 refresh() 函数开头调用，记录本次调用的来源链路和频率
   * @param {string} name - 追踪名，如 'CatStationPanel.refresh'
   */
  track(name) {
    const callers = this._parseStack();
    const now = Date.now();

    if (!this._stats.has(name)) {
      this._stats.set(name, { count: 0, timestamps: [], lastCallers: [] });
    }
    const stat = this._stats.get(name);
    stat.count++;
    stat.timestamps.push(now);
    stat.lastCallers = callers;

    // 清理滑动窗口外的时间戳
    stat.timestamps = stat.timestamps.filter(t => now - t < WINDOW_MS);
    const freq = stat.timestamps.length;

    let badge, style;
    if (freq > HIGH_FREQ) {
      badge = '🔴';
      style = 'color:#f44336;font-weight:bold';
    } else if (freq > MED_FREQ) {
      badge = '🟡';
      style = 'color:#ff9800;font-weight:600';
    } else {
      badge = '🟢';
      style = 'color:#9e9e9e';
    }

    const chain = callers.slice(0, 4).join(' ← ');
    console.log(
      `%c${badge} [REFRESH] ${name.padEnd(38)} ${WINDOW_MS / 1000}s内: ${String(freq).padStart(3)}次  |  ${chain}`,
      style,
    );

    // 首次越过高频阈值时写后端警告（避免每次都写，只写关键事件）
    if (freq === HIGH_FREQ + 1 && this._backendLogger) {
      this._backendLogger(
        'refresh',
        `⚠️ HIGH_FREQ: ${name} 已达 ${freq}次/${WINDOW_MS / 1000}s | 调用链: ${chain}`,
      );
    }
  }

  /**
   * 打印所有被追踪函数的频率汇总（按最近频率排序）
   * 在浏览器控制台输入 window.refreshSummary() 使用
   */
  summary() {
    const now = Date.now();
    console.group('%c[REFRESH SUMMARY] 刷新频率汇总', 'color:#2196f3;font-weight:bold;font-size:13px');
    const rows = [];
    for (const [name, stat] of this._stats) {
      const recent = stat.timestamps.filter(t => now - t < WINDOW_MS).length;
      rows.push({ name, total: stat.count, recent, callers: stat.lastCallers });
    }
    rows.sort((a, b) => b.recent - a.recent);
    for (const row of rows) {
      const urgency = row.recent > HIGH_FREQ ? '🔴' : row.recent > MED_FREQ ? '🟡' : '🟢';
      console.log(
        `${urgency}  ${row.name.padEnd(42)}  总计:${String(row.total).padStart(5)}次  最近${WINDOW_MS / 1000}s: ${String(row.recent).padStart(3)}次`,
      );
      if (row.callers.length > 0) {
        console.log(`       调用链: ${row.callers.slice(0, 4).join(' ← ')}`);
      }
    }
    console.groupEnd();

    // 同时写入后端日志文件（持久化，方便离线分析）
    if (this._backendLogger && rows.length > 0) {
      const lines = rows.map(r => {
        const flag = r.recent > HIGH_FREQ ? '[HIGH]' : r.recent > MED_FREQ ? '[MED]' : '[OK]';
        return `${flag} ${r.name}: 总计${r.total}次, ${WINDOW_MS / 1000}s内:${r.recent}次`;
      });
      this._backendLogger('refresh', `[SUMMARY] ${lines.join(' | ')}`);
    }
  }

  /** 重置所有统计 */
  reset() {
    this._stats.clear();
    console.log('[REFRESH] 统计已重置');
  }

  /**
   * 解析当前调用栈，去掉 refresh-tracker.js 自身的帧，返回有意义的帧列表
   */
  _parseStack() {
    const stack = (new Error().stack) || '';
    return stack
      .split('\n')
      .slice(1) // 去掉 "Error" 行
      .filter(line => !line.includes('refresh-tracker.js')) // 跳过追踪器自身
      .map(line => {
        // Chrome: "    at ClassName.method (http://host/path/file.js:42:10)"
        // Firefox: "method@http://host/path/file.js:42:10"
        const m = line.match(
          /(?:at\s+)?(?:([\w.<>$]+(?:\s+\[as\s+[\w]+\])?)\s+\()?(?:https?:\/\/[^/]+)?\/([^/\s()]+\.(?:js|ts))(?::(\d+))?/
        );
        if (!m) return null;
        const fn   = (m[1] || '(anon)').replace(/\s+\[as .+?\]/, '');
        const file = m[2] || '';
        const line_ = m[3] || '';
        return file ? `${fn}@${file}:${line_}` : null;
      })
      .filter(Boolean)
      .slice(0, 6);
  }
}

export const refreshTracker = new RefreshTracker();
