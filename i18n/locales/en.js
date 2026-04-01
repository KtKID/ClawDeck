// i18n/locales/en.js — English locale

export default {
  // ── Navigation ────────────────────────────────────────
  'nav.workshop': 'Workshop',
  'nav.starmap': 'Starmap',
  'nav.chat': 'Chat',
  'nav.alert': 'Pending',
  'nav.status_open': 'Open',

  // ── Date / Weekday ────────────────────────────────────
  'weekday.sun': 'Sun',
  'weekday.mon': 'Mon',
  'weekday.tue': 'Tue',
  'weekday.wed': 'Wed',
  'weekday.thu': 'Thu',
  'weekday.fri': 'Fri',
  'weekday.sat': 'Sat',
  'date.format': '{{weekday}}, {{month}}/{{day}}',

  // ── Orders Page ───────────────────────────────────────
  'page.today_orders': '📋 Today\'s Orders',
  'filter.all': 'All',
  'filter.pending': 'Pending',
  'filter.active': 'Active',
  'filter.completed': 'Completed',
  'placeholder.search': 'Search orders...',
  'empty.no_orders': 'No orders',

  // ── Cork Bar Summary Cards ────────────────────────────
  'cork.online_agents': 'Online',
  'cork.pending': 'Pending',
  'cork.token': 'Token',
  'cork.cost': 'Cost',

  // ── Gateway Card ──────────────────────────────────────
  'gateway.title': '🔗 Gateway',
  'gateway.disconnected': 'Disconnected',
  'gateway.connecting': 'Connecting...',
  'gateway.handshaking': 'Handshaking...',
  'gateway.connected': 'Connected',
  'gateway.reconnecting': 'Reconnecting...',
  'gateway.auth_failed': 'Auth Failed',
  'gateway.btn_connect': 'Connect',
  'gateway.btn_reconnect': 'Reconnect',
  'gateway.btn_disconnect': 'Disconnect',
  'gateway.btn_stop': 'Stop',
  'gateway.err.token_mismatch': 'Token mismatch — please check your token',
  'gateway.err.token_missing': 'Authentication required — please enter a token',
  'gateway.err.password_mismatch': 'Password incorrect',
  'gateway.err.rate_limited': 'Too many auth attempts — please wait',
  'gateway.err.pairing_required': 'Device pairing required — approve this device on the gateway host via: openclaw devices',
  'gateway.err.device_identity_required': 'Device identity required (use HTTPS or access from gateway host)',
  'gateway.err.device_token_mismatch': 'Device token expired, re-authenticating...',
  'gateway.err.connect_failed': 'Cannot connect to gateway — check URL and gateway status',
  'gateway.err.handshake_timeout': 'Handshake timeout — gateway not responding',
  'gateway.err.unknown_auth': 'Authentication failed',

  // ── Stats Bar ─────────────────────────────────────────
  'stats.pending_orders': 'Pending',
  'stats.attention': 'Needs Attention',
  'stats.completed_today': 'Done Today',

  // ── Order Card ────────────────────────────────────────
  'card.unnamed_task': 'Untitled Task',
  'card.responsible_cat': 'Agent',
  'card.duration': 'Duration',
  'card.last_action': 'Last Action',
  'card.steps_title': '📊 Steps',
  'card.supplement_placeholder': 'Add a note...',
  'card.send': 'Send',

  // ── Agent Status ──────────────────────────────────────
  'status.idle': 'Idle',
  'status.working': 'Working',
  'status.error': 'Error',

  // ── Session Run State ─────────────────────────────────
  'run.streaming': '💭 Thinking...',
  'run.running': '⚡ Running',
  'run.last_error': '⚠️ Last Error',
  'run.aborted': '⏹ Aborted',
  'run.pending_approval': '🔔 Awaiting Approval',
  'run.ready': '✅ Ready',
  'run.tool': '{{emoji}} {{title}}',

  // ── Approval Actions ──────────────────────────────────
  'action.approve': '✓ Approve',
  'action.reject': '✗ Reject',
  'action.retry': '↻ Retry',

  // ── Control Panel ─────────────────────────────────────
  'cp.no_agent': 'No agent selected',
  'cp.send_to': 'Send to {{name}}',
  'cp.session': 'Session {{id}}',
  'cp.approve': 'Approve',
  'cp.interrupt': 'Interrupt',
  'cp.retry': 'Retry',
  'cp.reset': 'Reset',
  'cp.input_placeholder': 'Enter instruction...',
  'cp.default_model': 'Default Model',

  // ── Cat Card ──────────────────────────────────────────
  'cat.current_order': 'Current Order',
  'cat.today_token': 'Today\'s Token',
  'cat.dispatch_placeholder': 'Assign a task...',
  'cat.supplement_placeholder': 'Add a note...',
  'cat.pending_approval': 'Awaiting approval: {{task}}',
  'cat.completed': 'Done: {{task}}',
  'cat.no_task': 'No task',

  // ── Chat Drawer ───────────────────────────────────────
  'chat.title': 'Claw · Context',
  'chat.close': 'Close',
  'chat.select_session': '— Select Session —',
  'chat.tab_all': 'All',
  'chat.status.idle': 'Idle',
  'chat.status.running': 'Running',
  'chat.status.streaming': 'Streaming',
  'chat.status.error': 'Error',
  'chat.status.aborted': 'Aborted',
  'chat.empty_icon': '🐱',
  'chat.empty_text': 'Select a task\nto view context',
  'chat.input_placeholder': 'Enter instruction or ask...',
  'chat.send': 'Send',
  'chat.loading': '⏳ Loading...',
  'chat.no_sessions_icon': '🌙',
  'chat.no_sessions_text': 'No active tasks\nAgents are resting',
  'chat.no_records': 'No records yet\nWaiting for task to start',
  'chat.load_failed': '⚠️ Load failed: {{error}}',
  'chat.waiting': 'Waiting',
  'chat.partner': 'Agent',
  'chat.send_failed': 'Send failed: {{error}}',
  'chat.user_input': 'User input',
  'chat.request_failed': 'Request failed',
  'chat.fallback_switched': '✅ Restored to {{model}}',
  'chat.fallback_switching': '🔄 Switching model... Now using {{model}}',
  'chat.fallback_model': 'Fallback model',

  // ── Meta Message Type Labels ──────────────────────────
  'meta.toolCall': '🔧 Tool Call',
  'meta.toolResult': '📋 Tool Result',
  'meta.thinking': '💭 Thinking',
  'meta.custom': '⚙️ Custom',
  'meta.model_change': '🤖 Model Change',
  'meta.thinking_level_change': '🧠 Thinking Level',
  'meta.session': '📌 Session',
  'meta.message': '💬 Message',
  'meta.meta': '📋 Meta',

  // ── Cat Station Panel ─────────────────────────────────
  'station.title': '🐱 Agent Squad',
  'station.loading': 'Loading agent data...',
  'station.empty': 'No agents online, please add an Agent first',

  // ── Log Panel ─────────────────────────────────────────
  'log.title': 'Voyage Log',
  'log.source_local': 'Local',
  'log.source_server': 'Server',
  'log.tooltip_source': 'Toggle local/server logs',
  'log.tooltip_toggle': 'Collapse/Expand',

  // ── Language Toggle ───────────────────────────────────
  'lang.switch_to': '中',
  'lang.current': 'EN',

  // ── AI Advice Panel ───────────────────────────────────
  'advice.title': '💡 Message in a Bottle (AI Advice)',
  'advice.desc': 'Information and action suggestions salvaged from the interstellar undercurrent that may be useful to you',
  'advice.refresh': 'Refresh Now',
  'advice.empty': 'The undercurrent is calm, no new bottles found',
  'advice.source': 'Source: {{source}}',
  'advice.recommend': 'Recommended Agent: {{owner}}',
  'advice.eta': 'Estimated time: {{time}} min',
  'advice.dispatch': 'Assign to {{owner}}',
  'advice.dismiss': 'Throw back',
  'advice.dispatched_status': '{{owner}} is processing...',
  'advice.completed': '{{owner}} completed: {{title}}',
  'advice.result_summary': 'Task completed',
  'advice.failed': '{{owner}} is stuck: {{title}}',
  'advice.redispatch': 'Re-assign',
  'advice.status.completed': 'Completed',
  'advice.status.dismissed': 'Dismissed',
  'advice.status.failed': 'Failed',
  'advice.reactivate': 'Reactivate',
  'advice.history_title': '📜 Processed tasks ({{count}})',

  // ── Today Timeline Panel ──────────────────────────────
  'timeline.title': '📅 Today\'s Track',
  'timeline.subtitle': 'Turning the moments of starting, finishing, and getting stuck into a readable event stream.',
  'timeline.count_total': '{{count}} Events',
  'timeline.count_success': '✓ {{count}} Resolved',
  'timeline.count_current': '◐ {{count}} Active',
  'timeline.count_warning': '⚠ {{count}} Pending',
  'timeline.empty': 'No new events have flowed in today, the squad is quietly on standby.',
  'timeline.unnamed_event': 'Unnamed Event',
  'timeline.unknown_partner': 'Unknown Agent',
  'timeline.processing': 'Processing',
  'timeline.modal.info': 'Event Info',
  'timeline.modal.time': 'Time',
  'timeline.modal.owner': 'Agent',
  'timeline.modal.session': 'Session ID',
  'timeline.modal.status': 'Status',
  'timeline.modal.content': 'Content',
  'timeline.modal.close': 'Close',
  'timeline.modal.no_details': 'No details',
  'timeline.status.success': 'Resolved',
  'timeline.status.current': 'Active',
  'timeline.status.warning': 'Pending',
  'timeline.status.unknown': 'Unknown',
  'timeline.ticker.label': 'Event Summary',

  // ── Schedule Panel ────────────────────────────────────
  'schedule.title': '⏰ Scheduled Tasks',
  'schedule.empty': 'No scheduled tasks',
  'schedule.status.ok': 'Last run successful',
  'schedule.status.error': 'Last run failed',
  'schedule.status.skipped': 'Last run skipped',
  'schedule.status.none': 'Not run yet',
  'schedule.tag.onetime': 'One-time',
  'schedule.tag.recurring': 'Recurring',
  'schedule.next_run': 'Next: ',

  // ── Toast Messages ─────────────────────────────────────
  'toast.dismissed': 'Returned to the undercurrent',
  'toast.refreshed': 'Refreshed — latest bottles retrieved',
  'toast.refresh_fail': 'Refresh failed, please try again',
  'toast.dispatched': 'Bottle handed to {{name}}~',
  'toast.dispatch_fail': 'Dispatch failed, please try again',

  // ── Priority Labels ─────────────────────────────────────
  'priority.high': 'High Priority',
  'priority.medium': 'Medium Priority',
  'priority.low': 'Low Priority',

  // ── Cat Status Labels ──────────────────────────────────
  'cat.status.idle': 'Idle',
  'cat.status.working': 'Working',
  'cat.status.pending': 'Pending Approval',
  'cat.status.error': 'Needs Help',

  // ── Control Panel ───────────────────────────────────────
  'cp.btn_send': 'Send',
  'cp.err_no_session': 'Missing sessionKey',
  'cp.err_no_approval': 'No pending approval request',

  // ── Cat Card ────────────────────────────────────────────
  'cat.btn_chat': 'Open Chat',

  // ── Chat Drawer ─────────────────────────────────────────
  'chat.unknown_error': 'Unknown error',
};
