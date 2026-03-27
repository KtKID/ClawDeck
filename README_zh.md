# ClawDeck

[English](./README.md)

> **警告**：当前为 beta 版本，请勿用于生产环境。

用户打开 ClawDeck 后应能：

1. **看懂** — 当前有哪些 Agent 在运行、任务卡在哪、是否有异常
2. **判断** — 哪条任务值得跟进、哪个决策需要审批
3. **干预** — 发送指令、终止会话、批准或拒绝危险操作

ClawDeck 读取 OpenClaw Gateway 的实时数据（WebSocket 推送 + 轮询兜底），将任务状态、会话过程和资源消耗以结构化面板呈现。它是 OpenClaw 的可视化延伸，不是独立工具。

## 与 OpenClaw 内置界面的区别

| | OpenClaw CLI | ClawDeck |
|---|---|---|
| **交互方式** | 终端命令 | 浏览器图形界面 |
| **实时性** | 主动查询 | WebSocket 推送 + 面板刷新 |
| **干预能力** | 完整 | 最小可用子集（发指令/中止/审批） |
| **数据呈现** | 日志流 | 结构化卡片 + 时间线 + 统计 |

## 功能特性

- **工坊首页**：实时展示在线 Agent、活跃任务、今日完成统计
- **任务看板**：卡片式展示 Agent 运行状态，支持发送指令、中止会话
- **会话时间线**：展开查看每条消息的输入/输出/工具调用详情
- **AI 建议面板**：根据运行状态智能推荐下一步行动
- **日志面板**：服务端/客户端双模式日志，支持增量轮询
- **国际化**：内置英文/中文支持，主题跟随系统语言

## 快速开始

### 方式一：插件安装（推荐）

```bash
# 克隆本仓库到 OpenClaw 插件目录
git clone https://your-repo/ClawDeck.git /path/to/openclaw/plugins/clawdeck

# 启用插件
openclaw plugin enable clawdeck

# 重启 Gateway
openclaw gateway restart
```

打开 `http://localhost:<端口>/plugins/clawdeck/` 即可使用（运行 `openclaw web` 查看实际端口）。

### 方式二：独立开发服务器

```bash
# 安装依赖
npm install

# 编译 Bridge 层（TypeScript）
npm run build:bridge

# 启动开发服务器（Mock 模式，无需 OpenClaw）
node dev-server.cjs --mock
```

打开 `http://localhost:<端口>/?mock=demo` 进入 Mock 演示模式（运行 `openclaw web` 查看实际端口）。

### 方式三：连接真实 OpenClaw Gateway

```bash
# 确保 OpenClaw Gateway 运行中
openclaw gateway start

# 启动开发服务器（连接真实 Gateway）
node dev-server.cjs
```

## 项目结构

```
plugin/           插件入口 + 后端（TypeScript）
bridge/           数据桥接层（GatewayClient + DataRouter）
ui/               前端 UI 面板（纯 ES Module，零构建）
css/              样式文件
i18n/             国际化翻译
```

## 技术栈

- **前端**：原生 DOM + CSS，ES Modules 零构建
- **后端**：TypeScript + OpenClaw Plugin SDK
- **数据层**：WebSocket + 轮询双轨数据流
- **渲染**：无 Canvas，无 WebGL，纯 CSS 主题化

## 开发

```bash
# 运行测试
npm test

# 编译 Bridge 层
npm run build:bridge
```

## 许可证

MIT

## 联系方式

![微信](./docs/weixin.jpg)  欢迎交流
