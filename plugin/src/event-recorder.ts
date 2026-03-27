// plugin/src/event-recorder.ts — 真实环境事件录制器
// 在 OpenClaw 中运行时，将所有 hook/runtime 事件录制为 test/fixtures 格式的 JSON
// 默认启用，设置 CLAWDECK_RECORD=0 可禁用
// 输出路径：CLAWDECK_RECORD_PATH 或默认 <plugin-root>/data/recordings/recorded-<ts>.json

import fs from "node:fs";
import path from "node:path";

export interface RecordedEvent {
  type: string;
  delay: number;
  params: Record<string, unknown>;
}

export class EventRecorder {
  private events: RecordedEvent[] = [];
  private lastTs = 0;
  private startTs = 0;
  private savePath: string;
  private _enabled: boolean;

  constructor(opts?: { savePath?: string }) {
    this._enabled = process.env.CLAWDECK_RECORD !== "0";
    this.startTs = Date.now();
    this.lastTs = this.startTs;

    if (opts?.savePath) {
      this.savePath = opts.savePath;
    } else if (process.env.CLAWDECK_RECORD_PATH) {
      this.savePath = process.env.CLAWDECK_RECORD_PATH;
    } else {
      // 默认：plugin/data/recordings/
      const recordingsDir = path.resolve(
        import.meta.dirname || __dirname,
        "..",
        "data",
        "recordings",
      );
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      this.savePath = path.join(recordingsDir, `recorded-${ts}.json`);
    }

    // 构造时主动创建目录，不等到 flush 时才创建
    const dir = path.dirname(this.savePath);
    fs.mkdirSync(dir, { recursive: true });
  }

  get enabled(): boolean {
    return this._enabled;
  }

  /**
   * 录制一条事件。delay 为与上一条事件的时间差（ms）。
   * params 中的 timestamp 保留原值（真实时间戳），供后续分析。
   */
  record(type: string, params: Record<string, unknown>): void {
    if (!this._enabled) return;

    const now = Date.now();
    const delay = this.events.length === 0 ? 0 : now - this.lastTs;
    this.lastTs = now;

    // 深拷贝 params，避免后续修改影响录制数据
    const cloned = JSON.parse(JSON.stringify(params));

    this.events.push({ type, delay, params: cloned });
  }

  /**
   * 将录制的事件写入 JSON 文件。
   * 返回写入路径，若无事件则返回 null。
   */
  flush(): string | null {
    if (!this._enabled || this.events.length === 0) return null;

    const durationSec = Math.round((Date.now() - this.startTs) / 1000);
    const output = {
      name: `recorded-${new Date(this.startTs).toISOString().slice(0, 19)}`,
      description: `真实环境录制，时长 ${durationSec}s，${this.events.length} 条事件`,
      recordedAt: new Date(this.startTs).toISOString(),
      events: this.events,
    };

    // 确保目录存在
    const dir = path.dirname(this.savePath);
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(this.savePath, JSON.stringify(output, null, 2) + "\n", "utf-8");

    const count = this.events.length;
    this.events = [];
    return this.savePath;
  }

  /** 当前已录制的事件数 */
  get count(): number {
    return this.events.length;
  }

  /** 返回已录制的事件列表（只读副本） */
  getEvents(): RecordedEvent[] {
    return [...this.events];
  }

  /** 返回录制摘要 */
  getSummary(): { enabled: boolean; count: number; startedAt: string } {
    return {
      enabled: this._enabled,
      count: this.events.length,
      startedAt: new Date(this.startTs).toISOString(),
    };
  }
}
