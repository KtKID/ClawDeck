// i18n/locales/zh.js — 中文词条

export default {
  // ── 导航 ──────────────────────────────────────────────
  'nav.workshop': '工坊',
  'nav.starmap': '星图',
  'nav.chat': '聊天',
  'nav.alert': '待审批',
  'nav.status_open': '营业中',

  // ── 日期 / 周几 ───────────────────────────────────────
  'weekday.sun': '周日',
  'weekday.mon': '周一',
  'weekday.tue': '周二',
  'weekday.wed': '周三',
  'weekday.thu': '周四',
  'weekday.fri': '周五',
  'weekday.sat': '周六',
  'date.format': '{{month}}月{{day}}日 {{weekday}}',

  // ── 工单页面 ──────────────────────────────────────────
  'page.today_orders': '📋 今日工单',
  'filter.all': '全部',
  'filter.pending': '待处理',
  'filter.active': '进行中',
  'filter.completed': '已完成',
  'placeholder.search': '搜索工单...',
  'empty.no_orders': '暂无工单',

  // ── 软木栏 摘要卡片 ───────────────────────────────────
  'cork.online_agents': '在线伙伴',
  'cork.pending': '待办',
  'cork.token': 'Token',
  'cork.cost': '费用',

  // ── 网关卡片 ──────────────────────────────────────────
  'gateway.title': '🔗 网关',
  'gateway.disconnected': '未连接',
  'gateway.connecting': '连接中...',
  'gateway.handshaking': '握手中...',
  'gateway.connected': '已连接',
  'gateway.reconnecting': '重连中...',
  'gateway.auth_failed': '认证失败',
  'gateway.btn_connect': '连接',
  'gateway.btn_reconnect': '重新连接',
  'gateway.btn_disconnect': '断开',
  'gateway.btn_stop': '停止',
  'gateway.err.token_mismatch': 'Token 不匹配，请检查 Token 是否正确',
  'gateway.err.token_missing': '网关需要认证，请填写 Token 后连接',
  'gateway.err.password_mismatch': '密码错误',
  'gateway.err.rate_limited': '认证尝试过于频繁，请稍后再试',
  'gateway.err.pairing_required': '此设备需要网关主机的配对批准，请在网关主机上执行 openclaw devices 批准此设备',
  'gateway.err.device_identity_required': '需要设备标识（请使用 HTTPS 或在网关主机上直接访问）',
  'gateway.err.device_token_mismatch': '设备 Token 已失效，正在重新认证...',
  'gateway.err.connect_failed': '无法连接到网关，请检查地址和网关是否运行',
  'gateway.err.handshake_timeout': '握手超时，网关无响应',
  'gateway.err.unknown_auth': '认证失败',

  // ── 工单统计条 ────────────────────────────────────────
  'stats.pending_orders': '需要批准的工单',
  'stats.attention': '今日异常工单',
  'stats.completed_today': '今日已处理',

  // ── 工单卡片 ──────────────────────────────────────────
  'card.unnamed_task': '未命名任务',
  'card.responsible_cat': '负责猫咪',
  'card.duration': '执行时长',
  'card.last_action': '最近动作',
  'card.steps_title': '📊 执行步骤',
  'card.supplement_placeholder': '补充说明...',
  'card.send': '发送',

  // ── Agent 状态 ────────────────────────────────────────
  'status.idle': '空闲中',
  'status.working': '工作中',
  'status.error': '遇到问题',

  // ── Session 运行状态 ──────────────────────────────────
  'run.streaming': '💭 思考中',
  'run.running': '⚡ 运行中',
  'run.last_error': '⚠️ 上次异常',
  'run.aborted': '⏹ 已中止',
  'run.pending_approval': '🔔 等待审批',
  'run.ready': '✅ 就绪',
  'run.tool': '{{emoji}} {{title}}',

  // ── 审批按钮 ──────────────────────────────────────────
  'action.approve': '✓ 批准',
  'action.reject': '✗ 拒绝',
  'action.retry': '↻ 重试',

  // ── 控制面板 ──────────────────────────────────────────
  'cp.no_agent': '未选中伙伴',
  'cp.send_to': '向 {{name}} 发送',
  'cp.session': '会话 {{id}}',
  'cp.approve': '批准',
  'cp.interrupt': '中断',
  'cp.retry': '重试',
  'cp.reset': '重置',
  'cp.input_placeholder': '输入补充指令...',
  'cp.default_model': '默认模型',

  // ── 猫咪卡片 ──────────────────────────────────────────
  'cat.current_order': '当前订单',
  'cat.today_token': '今日Token',
  'cat.dispatch_placeholder': '派发任务...',
  'cat.supplement_placeholder': '补充说明...',
  'cat.pending_approval': '等待批准: {{task}}',
  'cat.completed': '已完成: {{task}}',
  'cat.no_task': '暂无任务',

  // ── 聊天抽屉 ──────────────────────────────────────────
  'chat.title': '爪爪 · 上下文',
  'chat.close': '关闭',
  'chat.select_session': '— 选择会话 —',
  'chat.tab_all': '全部',
  'chat.status.idle': '空闲',
  'chat.status.running': '执行中',
  'chat.status.streaming': '输出中',
  'chat.status.error': '出错了',
  'chat.status.aborted': '已中止',
  'chat.empty_icon': '🐱',
  'chat.empty_text': '选择一个委托\n查看执行上下文',
  'chat.input_placeholder': '输入指令或询问...',
  'chat.send': '发送',
  'chat.loading': '⏳ 加载中...',
  'chat.no_sessions_icon': '🌙',
  'chat.no_sessions_text': '暂无活跃委托\n伙伴们都在休息中',
  'chat.agent_no_sessions': '该伙伴暂无对话记录',
  'chat.no_records': '暂无执行记录\n等待委托开始',
  'chat.load_failed': '⚠️ 加载失败: {{error}}',
  'chat.waiting': '等待中',
  'chat.partner': '伙伴',
  'chat.send_failed': '发送失败: {{error}}',
  'chat.user_input': '用户输入',
  'chat.request_failed': '请求失败',
  'chat.fallback_switched': '✅ 已恢复使用 {{model}}',
  'chat.fallback_switching': '🔄 伙伴正在切换协作方式... 正在使用 {{model}}',
  'chat.fallback_model': '备用模型',

  // ── 消息元数据类型标签 ────────────────────────────────
  'meta.toolCall': '🔧 工具调用',
  'meta.toolResult': '📋 工具结果',
  'meta.thinking': '💭 思考',
  'meta.custom': '⚙️ 自定义',
  'meta.model_change': '🤖 模型切换',
  'meta.thinking_level_change': '🧠 思考级别',
  'meta.session': '📌 会话',
  'meta.message': '💬 消息',
  'meta.meta': '📋 元信息',

  // ── 第三个面板 ───────────────────────────────────────
  'station.title': '🐱 猫咪特工队',
  'station.loading': '正在加载猫咪数据...',
  'station.empty': '暂无猫咪在线，请先添加 Agent',

  // ── 日志面板 ──────────────────────────────────────────
  'log.title': '航行日志',
  'log.source_local': '本地',
  'log.source_server': '服务端',
  'log.tooltip_source': '切换本地/服务端日志',
  'log.tooltip_toggle': '折叠/展开',

  // ── 语言切换按钮 ──────────────────────────────────────
  'lang.switch_to': 'EN',
  'lang.current': '中',

  // ── AI 建议面板 (ai-advice-panel) ─────────────────────
  'advice.title': '💡 漂流瓶拾取 (AI 建议)',
  'advice.desc': '智脑从星际暗流中打捞到的可能对您有用的信息与行动建议',
  'advice.refresh': '立即刷新',
  'advice.empty': '暗流平静，暂无新的漂流瓶',
  'advice.source': '来源：{{source}}',
  'advice.recommend': '推荐伙伴：{{owner}}',
  'advice.eta': '预计耗时：{{time}} 分钟',
  'advice.dispatch': '委托给 {{owner}}',
  'advice.dismiss': '放回暗流',
  'advice.dispatched_status': '{{owner}} 正在处理中...',
  'advice.completed': '{{owner}} 已完成：{{title}}',
  'advice.result_summary': '任务已完成',
  'advice.failed': '{{owner}} 卡住了：{{title}}',
  'advice.redispatch': '重新委托',
  'advice.status.completed': '已完成',
  'advice.status.dismissed': '已搁置',
  'advice.status.failed': '失败',
  'advice.reactivate': '重新激活',
  'advice.history_title': '📜 已处理委托 ({{count}})',

  // ── 今日时间线面板 (today-timeline-panel) ───────────
  'timeline.title': '📅 今日轨迹',
  'timeline.subtitle': '把开始、收尾与卡住的瞬间，整理成一条可读的事件流。',
  'timeline.count_total': '{{count}} 条事件',
  'timeline.count_success': '✓ {{count}} 已解决',
  'timeline.count_current': '◐ {{count}} 进行中',
  'timeline.count_warning': '⚠ {{count}} 待处理',
  'timeline.empty': '今天还没有新的事件流入，小队正在安静待命。',
  'timeline.unnamed_event': '未命名事件',
  'timeline.unknown_partner': '未知伙伴',
  'timeline.processing': '处理中',
  'timeline.modal.info': '事件信息',
  'timeline.modal.time': '发生时间',
  'timeline.modal.owner': '执行伙伴',
  'timeline.modal.session': '会话 ID',
  'timeline.modal.status': '当前状态',
  'timeline.modal.content': '事件内容',
  'timeline.modal.close': '关闭',
  'timeline.modal.no_details': '暂无详情',
  'timeline.status.success': '已解决',
  'timeline.status.current': '进行中',
  'timeline.status.warning': '待处理',
  'timeline.status.unknown': '未知',
  'timeline.ticker.label': '事件摘要',

  // ── 定时任务侧边栏 (schedule-panel) ───────────────────
  'schedule.title': '⏰ 定时任务',
  'schedule.empty': '暂无定时任务',
  'schedule.status.ok': '上次执行成功',
  'schedule.status.error': '上次执行失败',
  'schedule.status.skipped': '上次执行被跳过',
  'schedule.status.none': '尚未执行',
  'schedule.tag.onetime': '单次',
  'schedule.tag.recurring': '定期',
  'schedule.next_run': '下次: ',

  // ── Toast 消息 ──────────────────────────────────────────
  'toast.dismissed': '已放回暗流',
  'toast.refreshed': '已重新打捞最新漂流瓶',
  'toast.refresh_fail': '刷新失败，请稍后再试',
  'toast.dispatched': '漂流瓶已交给 {{name}}~',
  'toast.dispatch_fail': '派遣失败，请稍后重试',

  // ── 优先级标签 ──────────────────────────────────────────
  'priority.high': '高优先级',
  'priority.medium': '中优先级',
  'priority.low': '低优先级',

  // ── 猫咪状态标签 ────────────────────────────────────────
  'cat.status.idle': '空闲',
  'cat.status.working': '执行中',
  'cat.status.pending': '待批准',
  'cat.status.error': '需要帮助',

  // ── 控制面板补充 ────────────────────────────────────────
  'cp.btn_send': '发送',
  'cp.err_no_session': '缺少 sessionKey',
  'cp.err_no_approval': '无待审批请求',

  // ── 猫咪卡片 ──────────────────────────────────────────
  'cat.btn_chat': '打开对话',

  // ── 聊天抽屉补充 ────────────────────────────────────────
  'chat.unknown_error': '未知错误',
};
