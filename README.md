# ClawDeck

[中文说明](./README_zh.md)

> **Warning**: This is a beta version. Do not use in production environments.

When users open ClawDeck, they should be able to:

1. **See** — which Agents are running, where tasks are stuck, and whether there are errors
2. **Judge** — which tasks are worth following up, which decisions need approval
3. **Act** — send instructions, abort sessions, approve or reject dangerous operations

ClawDeck reads real-time data from OpenClaw Gateway (WebSocket push + polling fallback) and presents task status, session history, and resource usage through structured panels. It is a visual extension of OpenClaw, not a standalone tool.

## How It Differs from OpenClaw Built-in UI

| | OpenClaw CLI | ClawDeck |
|---|---|---|
| **Interaction** | Terminal commands | Browser GUI |
| **Real-time** | Active polling | WebSocket push + panel refresh |
| **Actions** | Full access | Minimal viable set (instruct/abort/approve) |
| **Data view** | Log stream | Structured cards + timeline + stats |

## Features

- **Workshop Home**: Real-time display of online Agents, active tasks, today's completed count
- **Task Board**: Card-based Agent status view with send-instruction and abort-session support
- **Session Timeline**: Expandable view of each message's input/output/tool call details
- **AI Advice Panel**: Intelligent recommendations based on running status
- **Log Panel**: Dual-mode logs (server-side/client-side) with incremental polling
- **i18n**: Built-in English/Chinese support, language follows system settings

## Quick Start

### Option 1: Plugin Install (Recommended)

```bash
# Clone repo to OpenClaw plugins directory
git clone https://your-repo/ClawDeck.git /path/to/openclaw/plugins/clawdeck

# Enable plugin
openclaw plugin enable clawdeck

# Restart Gateway
openclaw gateway restart
```

Then open `http://localhost:<port>/plugins/clawdeck/` (run `openclaw web` to find the actual port).

### Option 2: Standalone Dev Server

```bash
# Install dependencies
npm install

# Build Bridge layer (TypeScript)
npm run build:bridge

# Start dev server (Mock mode, no OpenClaw required)
node dev-server.cjs --mock
```

Then open `http://localhost:<port>/?mock=demo` (run `openclaw web` to find the actual port).

### Option 3: Connect to Real OpenClaw Gateway

```bash
# Ensure OpenClaw Gateway is running
openclaw gateway start

# Start dev server (connects to real Gateway)
node dev-server.cjs
```

## Project Structure

```
plugin/           Plugin entry + backend (TypeScript)
bridge/           Data bridge layer (GatewayClient + DataRouter)
ui/               Frontend UI panels (pure ES Module, zero build)
css/              Stylesheets
i18n/             Internationalization
```

## Tech Stack

- **Frontend**: Native DOM + CSS, ES Modules, zero build step
- **Backend**: TypeScript + OpenClaw Plugin SDK
- **Data**: WebSocket + polling dual-track flow
- **Rendering**: No Canvas, no WebGL, pure CSS theming

## Development

```bash
# Run tests
npm test

# Build Bridge layer
npm run build:bridge
```

## License

MIT

## Contact

![微信](./docs/weixin.jpg)  Welcome to connect
