// bridge/cron-api.js — Cron Gateway API 封装
// 基于 GatewayClient.call() 封装所有 cron 相关 RPC 调用

export class CronApi {
  constructor(gateway) {
    this._gw = gateway;
  }

  // ============================================================
  // 查询
  // ============================================================

  async status() {
    return this._gw.call('cron.status', {});
  }

  async list(opts = {}) {
    return this._gw.call('cron.list', { includeDisabled: true, limit: 50, ...opts });
  }

  async runs(opts = {}) {
    return this._gw.call('cron.runs', { limit: 30, ...opts });
  }

  // ============================================================
  // 变更
  // ============================================================

  async add(jobDef) {
    return this._gw.call('cron.add', jobDef);
  }

  async update(id, patch) {
    return this._gw.call('cron.update', { id, patch });
  }

  async remove(id) {
    return this._gw.call('cron.remove', { id });
  }

  async run(id, mode = 'force') {
    return this._gw.call('cron.run', { id, mode });
  }

  // ============================================================
  // 辅助
  // ============================================================

  async listModels() {
    return this._gw.call('models.list', {});
  }
}
