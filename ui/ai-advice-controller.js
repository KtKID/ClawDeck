// ui/ai-advice-controller.js — AI 建议控制器
// 负责 AI 建议的数据订阅、刷新、派遣、状态更新全流程。
// 挂载方式：new AIAdviceController(containerEl, dataSource, gateway)

import { AIAdvicePanel } from './ai-advice-panel.js';
import { t } from '../i18n/index.js';

export class AIAdviceController {
  /**
   * @param {HTMLElement} container - 挂载容器
   * @param {object} dataSource - DataRouter 实例
   * @param {object} gateway - GatewayClient 实例（用于派遣任务）
   */
  constructor(container, dataSource, gateway) {
    this._container = container;
    this._dataSource = dataSource || null;
    this._gateway = gateway || null;
    this._panel = null;

    this._initPanel();

    if (dataSource) {
      dataSource.on('data:ai-advices-updated', () => this._refresh());
      this._refresh();
    }
  }

  _initPanel() {
    this._panel = new AIAdvicePanel(this._container, {
      maxCount: 3,
      onRefresh: () => this._handleManualRefresh(),
      onDispatch: (advice) => this._dispatch(advice),
      onDismiss: async (advice) => {
        if (this._dataSource?.updateAdviceStatus) {
          await this._dataSource.updateAdviceStatus(advice.id, 'dismissed');
        }
        this._showToast(t('toast.dismissed'));
      },
      onReactivate: async (advice) => {
        if (this._dataSource?.updateAdviceStatus) {
          await this._dataSource.updateAdviceStatus(advice.id, 'pending');
          this._refreshHistory();
        }
      },
    });
  }

  _refresh() {
    if (!this._dataSource || !this._panel) return;
    const { advices, maxCount } = this._dataSource.getAIAdvices();
    if (advices === null) return;
    this._panel.setMaxCount(maxCount);
    this._panel.setData(advices);
    this._refreshHistory();
  }

  async _refreshHistory() {
    if (!this._dataSource || !this._panel || !this._dataSource.getAllAdvices) return;
    try {
      const all = await this._dataSource.getAllAdvices();
      const history = all.filter(a =>
        a.status === 'completed' || a.status === 'dismissed' || a.status === 'failed'
      );
      this._panel.setHistoryData(history);
    } catch (e) {
      console.warn('[AIAdvice] 刷新历史栏失败:', e);
    }
  }

  async _handleManualRefresh() {
    if (!this._dataSource?.refreshAIAdvices) return;
    try {
      await this._dataSource.refreshAIAdvices();
      this._showToast(t('toast.refreshed'));
    } catch (error) {
      console.warn('[AIAdvice] 手动刷新失败:', error);
      this._showToast(t('toast.refresh_fail'));
    }
  }

  async _dispatch(advice) {
    if (!this._gateway || !this._dataSource) {
      console.warn('[AIAdvice] gateway 或 dataSource 未就绪，无法派遣任务');
      return;
    }

    const agents = this._dataSource.getAgentsForWorkshop();
    const ownerLower = advice.owner?.toLowerCase();

    let matched = agents.find(a => a.label === advice.owner);
    if (!matched && ownerLower) matched = agents.find(a => a.label?.toLowerCase() === ownerLower);
    if (!matched && ownerLower) matched = agents.find(a => a.id?.toLowerCase() === ownerLower);

    const agentId = matched?.id;
    if (!agentId) {
      console.warn(`[AIAdvice] 未找到伙伴 "${advice.owner}"，可用伙伴:`, agents.map(a => `${a.label}(${a.id})`).join(', '));
      return;
    }

    const message = `${advice.title}\n\n${advice.summary}`;
    try {
      console.log(`[AIAdvice][dispatch] 开始派遣 adviceId=${advice.id} → agentId=${agentId}(${matched.label})`);
      const result = await this._gateway.startAgentChat(agentId, message);
      console.log(`[AIAdvice][dispatch] startAgentChat 完整返回值:`, JSON.stringify(result));
      const runId = result?.runId || null;
      if (!runId) {
        console.warn(`[AIAdvice][dispatch] ⚠️ runId 为空！返回值中无 runId，状态将无法自动流转。result keys:`, result ? Object.keys(result) : 'null');
      }
      console.log(`[AIAdvice][dispatch] 提取 runId=${runId}，准备调用 updateAdviceStatus`);
      if (this._dataSource?.updateAdviceStatus) {
        const meta = runId ? { runId } : undefined;
        console.log(`[AIAdvice][dispatch] PATCH meta=`, JSON.stringify(meta));
        await this._dataSource.updateAdviceStatus(advice.id, 'dispatched', meta);
      }
      this._showToast(t('toast.dispatched', { name: matched.label }));
    } catch (error) {
      console.error('[AIAdvice] 派遣任务失败:', error);
      this._showToast(t('toast.dispatch_fail'));
    }
  }

  _showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--bg-card);color:var(--text-primary);padding:10px 24px;border-radius:12px;border:2px solid var(--border-wood);box-shadow:var(--shadow-card);font-size:0.85rem;z-index:9999;animation:fadeSlideUp 0.4s ease-out;';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }
}
