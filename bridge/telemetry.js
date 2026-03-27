// bridge/telemetry.js — Telemetry event definitions and aggregation

/**
 * Telemetry Event Types
 * 
 * 设计目标：
 * - 统一的事件格式，便于序列化和传输
 * - 包含足够的信息用于监控、分析和调试
 * - 支持会话追踪和时间线重建
 */

// --- Event Types ---

export const TelemetryEventType = {
  AGENT_MESSAGE: 'agent:message',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  TOKEN_USAGE: 'token_usage',
  ERROR: 'error',
  SESSION_START: 'session:start',
  SESSION_END: 'session:end',
};

// --- Base Event Structure ---

/**
 * @typedef {Object} TelemetryEvent
 * @property {string} id - Unique event ID (UUID)
 * @property {string} type - Event type from TelemetryEventType
 * @property {number} timestamp - Unix timestamp in milliseconds
 * @property {string} sessionId - Session ID for correlation
 * @property {string} [agentId] - Agent ID if applicable
 * @property {Object} data - Event-specific payload
 */

/**
 * Generate a unique event ID
 */
function generateEventId() {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a base event with common fields
 */
function createBaseEvent(type, sessionId, agentId = null) {
  return {
    id: generateEventId(),
    type,
    timestamp: Date.now(),
    sessionId,
    ...(agentId && { agentId }),
  };
}

// --- Specific Event Factories ---

/**
 * Agent sent a message
 * @param {string} sessionId - Session ID
 * @param {string} agentId - Agent ID
 * @param {Object} message - Message content
 * @param {string} [message.role] - 'user' | 'assistant' | 'system'
 * @param {string} [message.content] - Message text (truncated if too long)
 * @param {number} [message.contentLength] - Full content length
 */
export function createAgentMessageEvent(sessionId, agentId, message) {
  const MAX_CONTENT_PREVIEW = 500;
  const content = message.content || '';
  
  return {
    ...createBaseEvent(TelemetryEventType.AGENT_MESSAGE, sessionId, agentId),
    data: {
      role: message.role || 'assistant',
      contentPreview: content.substring(0, MAX_CONTENT_PREVIEW),
      contentLength: content.length,
      hasAttachments: message.attachments?.length > 0 || false,
    },
  };
}

/**
 * Tool call initiated
 * @param {string} sessionId - Session ID
 * @param {string} agentId - Agent ID
 * @param {Object} toolCall - Tool call details
 * @param {string} toolCall.name - Tool name
 * @param {Object} toolCall.params - Tool parameters (sanitized)
 * @param {string} [toolCall.callId] - Unique call ID
 */
export function createToolCallEvent(sessionId, agentId, toolCall) {
  return {
    ...createBaseEvent(TelemetryEventType.TOOL_CALL, sessionId, agentId),
    data: {
      name: toolCall.name,
      callId: toolCall.callId || generateEventId(),
      paramsPreview: sanitizeParams(toolCall.params),
      paramsKeys: Object.keys(toolCall.params || {}),
    },
  };
}

/**
 * Tool call completed
 * @param {string} sessionId - Session ID
 * @param {string} agentId - Agent ID
 * @param {Object} result - Result details
 * @param {string} result.callId - Matching call ID from tool_call
 * @param {boolean} result.success - Whether call succeeded
 * @param {number} result.durationMs - Execution duration in milliseconds
 * @param {string} [result.error] - Error message if failed
 * @param {string} [result.resultPreview] - Preview of result (truncated)
 */
export function createToolResultEvent(sessionId, agentId, result) {
  const MAX_RESULT_PREVIEW = 300;
  
  return {
    ...createBaseEvent(TelemetryEventType.TOOL_RESULT, sessionId, agentId),
    data: {
      callId: result.callId,
      success: result.success,
      durationMs: result.durationMs,
      ...(result.error && { error: result.error }),
      ...(result.resultPreview && { 
        resultPreview: result.resultPreview.substring(0, MAX_RESULT_PREVIEW) 
      }),
    },
  };
}

/**
 * Token usage report
 * @param {string} sessionId - Session ID
 * @param {string} agentId - Agent ID
 * @param {Object} usage - Token usage details
 * @param {number} usage.inputTokens - Input tokens used
 * @param {number} usage.outputTokens - Output tokens generated
 * @param {number} [usage.cacheReadTokens] - Tokens read from cache
 * @param {number} [usage.cacheWriteTokens] - Tokens written to cache
 * @param {string} [usage.model] - Model identifier
 */
export function createTokenUsageEvent(sessionId, agentId, usage) {
  return {
    ...createBaseEvent(TelemetryEventType.TOKEN_USAGE, sessionId, agentId),
    data: {
      inputTokens: usage.inputTokens || 0,
      outputTokens: usage.outputTokens || 0,
      cacheReadTokens: usage.cacheReadTokens || 0,
      cacheWriteTokens: usage.cacheWriteTokens || 0,
      totalTokens: (usage.inputTokens || 0) + (usage.outputTokens || 0),
      ...(usage.model && { model: usage.model }),
    },
  };
}

/**
 * Error occurred
 * @param {string} sessionId - Session ID
 * @param {string} agentId - Agent ID
 * @param {Object} error - Error details
 * @param {string} error.type - Error type (network, api, timeout, validation, etc.)
 * @param {string} error.message - Error message
 * @param {string} [error.code] - Error code if available
 * @param {string} [error.stack] - Stack trace (for debugging)
 * @param {boolean} [error.recoverable] - Whether error is recoverable
 */
export function createErrorEvent(sessionId, agentId, error) {
  return {
    ...createBaseEvent(TelemetryEventType.ERROR, sessionId, agentId),
    data: {
      type: error.type || 'unknown',
      message: error.message,
      ...(error.code && { code: error.code }),
      ...(error.stack && { stack: error.stack }),
      recoverable: error.recoverable !== false,
    },
  };
}

/**
 * Session started
 * @param {string} sessionId - Session ID
 * @param {Object} session - Session details
 * @param {string} [session.agentId] - Agent ID
 * @param {string} [session.trigger] - What triggered the session
 */
export function createSessionStartEvent(sessionId, session = {}) {
  return {
    ...createBaseEvent(TelemetryEventType.SESSION_START, sessionId, session.agentId),
    data: {
      trigger: session.trigger || 'manual',
      startedAt: Date.now(),
    },
  };
}

/**
 * Session ended
 * @param {string} sessionId - Session ID
 * @param {Object} summary - Session summary
 * @param {string} [summary.status] - 'completed' | 'error' | 'cancelled'
 * @param {number} [summary.durationMs] - Total session duration
 * @param {number} [summary.totalTokens] - Total tokens used
 * @param {number} [summary.toolCalls] - Number of tool calls made
 */
export function createSessionEndEvent(sessionId, summary = {}) {
  return {
    ...createBaseEvent(TelemetryEventType.SESSION_END, sessionId),
    data: {
      status: summary.status || 'completed',
      endedAt: Date.now(),
      ...(summary.durationMs && { durationMs: summary.durationMs }),
      ...(summary.totalTokens && { totalTokens: summary.totalTokens }),
      ...(summary.toolCalls && { toolCalls: summary.toolCalls }),
    },
  };
}

// --- Parameter Sanitization ---

/**
 * Sanitize tool parameters for logging
 * - Truncates long strings
 * - Masks sensitive fields
 * - Limits depth for nested objects
 */
function sanitizeParams(params, depth = 0) {
  if (depth > 2) return '[deep nested]';
  if (!params || typeof params !== 'object') return params;
  
  const SENSITIVE_KEYS = ['password', 'token', 'secret', 'key', 'auth', 'credential'];
  const MAX_STRING_LENGTH = 100;
  
  const sanitized = {};
  
  for (const [key, value] of Object.entries(params)) {
    // Mask sensitive fields
    if (SENSITIVE_KEYS.some(sk => key.toLowerCase().includes(sk))) {
      sanitized[key] = '[REDACTED]';
      continue;
    }
    
    // Truncate long strings
    if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
      sanitized[key] = value.substring(0, MAX_STRING_LENGTH) + '...';
      continue;
    }
    
    // Recurse for nested objects
    if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeParams(value, depth + 1);
      continue;
    }
    
    sanitized[key] = value;
  }
  
  return sanitized;
}

// --- Session Tracker ---

/**
 * Tracks telemetry events for a session
 * Aggregates statistics and manages event storage
 */
export class SessionTracker {
  constructor(sessionId, agentId = null) {
    this.sessionId = sessionId;
    this.agentId = agentId;
    this.events = [];
    this.startTime = Date.now();
    
    // Aggregated statistics
    this.stats = {
      totalTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      toolCalls: { total: 0, success: 0, failed: 0 },
      errors: { total: 0, byType: {} },
      messages: { user: 0, assistant: 0, system: 0 },
    };
    
    // Pending tool calls (for duration tracking)
    this.pendingToolCalls = new Map();
  }
  
  /**
   * Record an event
   */
  recordEvent(event) {
    this.events.push(event);
    this._updateStats(event);
    return event;
  }
  
  /**
   * Record agent message
   */
  recordMessage(message) {
    const event = createAgentMessageEvent(this.sessionId, this.agentId, message);
    return this.recordEvent(event);
  }
  
  /**
   * Record tool call start
   */
  recordToolCall(toolCall) {
    const event = createToolCallEvent(this.sessionId, this.agentId, toolCall);
    this.pendingToolCalls.set(event.data.callId, { event, startTime: Date.now() });
    return this.recordEvent(event);
  }
  
  /**
   * Record tool call result
   */
  recordToolResult(result) {
    const pending = this.pendingToolCalls.get(result.callId);
    if (pending) {
      result.durationMs = Date.now() - pending.startTime;
      this.pendingToolCalls.delete(result.callId);
    }
    const event = createToolResultEvent(this.sessionId, this.agentId, result);
    return this.recordEvent(event);
  }
  
  /**
   * Record token usage
   */
  recordTokenUsage(usage) {
    const event = createTokenUsageEvent(this.sessionId, this.agentId, usage);
    return this.recordEvent(event);
  }
  
  /**
   * Record error
   */
  recordError(error) {
    const event = createErrorEvent(this.sessionId, this.agentId, error);
    return this.recordEvent(event);
  }
  
  /**
   * Get session duration
   */
  getDurationMs() {
    return Date.now() - this.startTime;
  }
  
  /**
   * Get session summary
   */
  getSummary() {
    return {
      sessionId: this.sessionId,
      agentId: this.agentId,
      durationMs: this.getDurationMs(),
      eventCount: this.events.length,
      stats: this.stats,
    };
  }
  
  /**
   * Export events for persistence
   */
  exportEvents() {
    return this.events.map(e => JSON.stringify(e)).join('\n');
  }
  
  /**
   * Update aggregated statistics
   */
  _updateStats(event) {
    switch (event.type) {
      case TelemetryEventType.AGENT_MESSAGE:
        this.stats.messages[event.data.role] = (this.stats.messages[event.data.role] || 0) + 1;
        break;
        
      case TelemetryEventType.TOOL_CALL:
        this.stats.toolCalls.total++;
        break;
        
      case TelemetryEventType.TOOL_RESULT:
        if (event.data.success) {
          this.stats.toolCalls.success++;
        } else {
          this.stats.toolCalls.failed++;
        }
        break;
        
      case TelemetryEventType.TOKEN_USAGE:
        this.stats.totalTokens.input += event.data.inputTokens;
        this.stats.totalTokens.output += event.data.outputTokens;
        this.stats.totalTokens.cacheRead += event.data.cacheReadTokens;
        this.stats.totalTokens.cacheWrite += event.data.cacheWriteTokens;
        break;
        
      case TelemetryEventType.ERROR:
        this.stats.errors.total++;
        this.stats.errors.byType[event.data.type] = 
          (this.stats.errors.byType[event.data.type] || 0) + 1;
        break;
    }
  }
}

// --- Telemetry Manager ---

/**
 * Global telemetry manager
 * Manages multiple session trackers and provides event broadcasting
 */
export class TelemetryManager {
  constructor(eventStream = null) {
    this.sessions = new Map();
    this.eventStream = eventStream;
    this.listeners = new Set();
  }
  
  /**
   * Start a new session
   */
  startSession(sessionId, agentId = null) {
    const tracker = new SessionTracker(sessionId, agentId);
    this.sessions.set(sessionId, tracker);
    
    const event = createSessionStartEvent(sessionId, { agentId });
    tracker.recordEvent(event);
    this._broadcast(event);
    
    return tracker;
  }
  
  /**
   * End a session
   */
  endSession(sessionId) {
    const tracker = this.sessions.get(sessionId);
    if (!tracker) return null;
    
    const summary = tracker.getSummary();
    const event = createSessionEndEvent(sessionId, {
      status: 'completed',
      durationMs: summary.durationMs,
      totalTokens: summary.stats.totalTokens.input + summary.stats.totalTokens.output,
      toolCalls: summary.stats.toolCalls.total,
    });
    
    tracker.recordEvent(event);
    this._broadcast(event);
    
    return summary;
  }
  
  /**
   * Get session tracker
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }
  
  /**
   * Add event listener
   */
  addListener(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  
  /**
   * Broadcast event to listeners
   */
  _broadcast(event) {
    if (this.eventStream) {
      this.eventStream._emit('telemetry', event);
    }
    this.listeners.forEach(fn => fn(event));
  }
}
