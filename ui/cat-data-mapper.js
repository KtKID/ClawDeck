// ui/cat-data-mapper.js — 数据映射层：将 DataRouter 数据转换为猫咪卡片所需格式
import { t } from '../i18n/index.js';

/**
 * 从 DataRouter 获取数据并转换为猫咪卡片所需格式
 * @param {import('../bridge/data-router.js').DataRouter} dataRouter
 * @returns {Array<{
 *   id: string,
 *   name: string,
 *   icon: string,
 *   status: 'idle' | 'working' | 'pending' | 'error',
 *   currentTask: string | null,
 *   latestStep: string | null,
 *   sessionKey: string | null,
 *   avatarUrl: string | null,
 *   traits: string[] | null
 * }>}
 */
export function getAgentsForCatCards(dataRouter) {
  // 获取 Agent 列表
  const agents = dataRouter.getAgentsForWorkshop();

  // 获取待审批列表
  const pendingApprovals = dataRouter.getPendingApprovals();

  // 获取活跃 Session 列表（用于查找 sessionKey）
  const activeSessions = dataRouter.getSessionsForWorkshop();

  // 转换为猫咪卡片格式
  return agents.map(agent => {
    // 检查该 Agent 是否有待审批
    const hasPendingApproval = checkPendingApproval(agent.id, pendingApprovals, activeSessions);

    // 确定最终状态（有待审批时优先显示"待批准"）
    const status = hasPendingApproval ? 'pending' : mapStatus(agent.status);

    // 提取最新步骤信息
    const latestStep = getLatestStep(agent.steps);

    // 查找该 agent 对应的活跃 sessionKey
    const agentSession = activeSessions.find(s => s.agentId === agent.id);
    const sessionKey = agentSession?.sessionKey || null;

    return {
      id: agent.id,
      name: agent.label,
      icon: agent.icon,
      status: status,
      characteristics: agent.characteristics,
      currentTask: agent.currentTask,
      latestStep: latestStep,
      sessionKey: sessionKey,
      avatarUrl: agent.avatarUrl || null,
      traits: Array.isArray(agent.traits) ? agent.traits : null,
      usage: typeof dataRouter.getAgentUsage === 'function' ? dataRouter.getAgentUsage(agent.id) : null,
    };
  });
}

/**
 * 检查 Agent 是否有待审批
 * @param {string} agentId
 * @param {Array} pendingApprovals
 * @param {Array} activeSessions
 * @returns {boolean}
 */
function checkPendingApproval(agentId, pendingApprovals, activeSessions) {
  // 查找该 Agent 的活跃 Session
  const agentSessions = activeSessions.filter(s => s.agentId === agentId);

  // 检查是否有待审批
  return pendingApprovals.some(approval =>
    agentSessions.some(session => session.sessionKey === approval.sessionKey)
  );
}

/**
 * 映射 Agent 状态到猫咪状态
 * @param {string} status - DataRouter 返回的状态 ('idle' | 'working' | 'error')
 * @returns {'idle' | 'working' | 'error'}
 */
function mapStatus(status) {
  const statusMap = {
    'idle': 'idle',
    'working': 'working',
    'error': 'error',
  };
  return statusMap[status] || 'idle';
}

/**
 * 获取状态显示信息
 * @param {'idle' | 'working' | 'pending' | 'error'} status
 * @returns {{icon: string, label: string, className: string}}
 */
export function getStatusInfo(status) {
  const statusInfoMap = {
    'idle': {
      icon: '😴',
      label: t('cat.status.idle'),
      className: 'status-idle',
    },
    'working': {
      icon: '🔄',
      label: t('cat.status.working'),
      className: 'status-working',
    },
    'pending': {
      icon: '⏳',
      label: t('cat.status.pending'),
      className: 'status-pending',
    },
    'error': {
      icon: '⚠️',
      label: t('cat.status.error'),
      className: 'status-error',
    },
  };

  return statusInfoMap[status] || statusInfoMap['idle'];
}

/**
 * 从 steps 数组提取最新步骤信息
 * @param {Array} steps
 * @returns {string | null}
 */
function getLatestStep(steps) {
  if (!steps || steps.length === 0) {
    return null;
  }

  // 获取最新的步骤
  const latestStep = steps[steps.length - 1];

  // 返回步骤摘要
  return latestStep?.summary || latestStep?.type || null;
}