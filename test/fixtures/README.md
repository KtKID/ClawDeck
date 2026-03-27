# 测试数据集格式说明

## 目录结构

```
test/fixtures/events/
├── all-event-types.json    ← 11 种事件类型各一条（基于真实录制格式）
├── basic-lifecycle.json    ← 单 agent 完整生命周期
├── error-recovery.json     ← Provider 失败 + Fallback 场景
├── multi-agent.json        ← 3 agent 并发
├── provider-fallback.json  ← Provider 认证失败切换场景（从真实录制提取）
├── subagent.json           ← 子 agent 生成与结束（罕见场景）
├── tool-execution.json     ← 多次工具调用场景（从真实录制提取）
└── README.md               ← 本文件
```

## 事件格式

每条事件包含三个字段：

```json
{
  "type": "session_start",
  "delay": 0,
  "params": { ... }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | string | 11 种事件类型之一（见下表） |
| `delay` | number | 回放延迟 (ms)。自动化测试忽略，调试面板使用 |
| `params` | object | 直接传给 `StateAggregator.on*()` 方法的参数 |

## 事件类型 → StateAggregator 方法映射

| type | StateAggregator 方法 | 来源 |
|------|---------------------|------|
| `session_start` | `onSessionStart(params)` | lifecycle hook |
| `session_end` | `onSessionEnd(params)` | lifecycle hook |
| `llm_input` | `onLlmInput(params)` | lifecycle hook |
| `llm_output` | `onLlmOutput(params)` | lifecycle hook |
| `before_tool_call` | `onToolCallStart(params)` | lifecycle hook |
| `after_tool_call` | `onToolCallEnd(params)` | lifecycle hook |
| `agent_end` | `onAgentEnd(params)` | lifecycle hook |
| `subagent_spawned` | `onSubagentSpawned(params)` | lifecycle hook |
| `subagent_ended` | `onSubagentEnded(params)` | lifecycle hook |
| `raw_agent_event` | `onRawAgentEvent(params)` | runtime event |
| `transcript_update` | `onTranscriptUpdate(params)` | runtime event |

## 关键字段格式（基于真实录制数据）

### sessionKey 格式

```
agent:<agent-id>:<source>:<type>:<identifier>
```

示例：
- `agent:main:feishu:direct:ou_49438f64bf8fa8d1c646955b7825f3d7`
- `agent:reviewer:telegram:direct:user_222222222`
- `agent:analyst:slack:direct:channel_C33333333`

### raw_agent_event 结构

```json
{
  "type": "raw_agent_event",
  "delay": 10,
  "params": {
    "runId": "xxx",
    "seq": 4,
    "stream": "tool",           // "lifecycle" | "tool"
    "data": {
      "phase": "start",         // lifecycle: start | end | error | fallback
                                // tool: start | result
      "name": "write",          // 工具名（仅 tool stream）
      "toolCallId": "call_xxx", // 工具调用 ID（仅 tool stream）
      "args": { ... },          // 工具参数（start phase）
      "result": { ... },        // 工具结果（result phase）
      "meta": "...",            // 结果摘要
      "isError": false,
      "error": "..."            // 错误信息（error phase）
    },
    "sessionKey": "agent:main:feishu:direct:xxx",
    "timestamp": 1772934022757
  }
}
```

### after_tool_call 的 result 结构

```json
{
  "result": {
    "content": [
      { "type": "text", "text": "Successfully wrote..." }
    ]
  }
}
```

## 时间戳约定

- 使用真实 Unix 时间戳（毫秒）如 `1772934013580`
- `delay` 字段为相对延迟，供调试面板实时回放使用
- 自动化测试应忽略 `delay`，直接依次执行所有事件

## 数据来源

- 可手工编写（基于真实录制格式）
- 可通过事件录制器 (`plugin/src/event-recorder.ts`) 从真实环境采集：
  ```bash
  CLAWDECK_RECORD=1 openclaw gateway start
  # 正常使用后停止 Gateway，录制文件自动保存到
  # report/recordings/recorded-<timestamp>.json
  ```
- 自定义输出路径：`CLAWDECK_RECORD_PATH=/path/to/output.json`
- 录制格式与本目录完全一致，可直接复制替换手工 fixtures

## 真实录制参考文件

真实录制数据保存在 `report/recordings/` 目录：
- `recorded-2026-03-08T01-39-03.json` - Provider fallback 场景
- `recorded-2026-03-08T01-44-57.json` - 多次工具调用场景

## 注意事项

- `subagent_spawned`/`subagent_ended` 在真实录制中未出现，保留用于兼容性测试
- 所有 fixture 文件已更新为真实录制数据格式
