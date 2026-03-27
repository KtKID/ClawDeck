#!/bin/bash
# install.sh — ClawDeck 安装脚本

set -e

CLAWDECK_VERSION="0.1.0"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 检测 OpenClaw 安装路径
detect_openclaw_dir() {
  if [ -n "$OPENCLAW_HOME" ] && [ -d "$OPENCLAW_HOME/plugins" ]; then
    echo "$OPENCLAW_HOME"
    return
  fi

  local local_dir="$SCRIPT_DIR"
  if [ -d "$local_dir/.openclaw" ] || [ -f "$local_dir/openclaw.config.js" ]; then
    echo "$local_dir"
    return
  fi

  echo ""
}

install_plugin() {
  local openclaw_dir="$1"
  local target_dir="$openclaw_dir/plugins/clawdeck"

  echo "📦 安装 ClawDeck 到 $target_dir ..."

  # 如果目标已存在，先备份
  if [ -d "$target_dir" ]; then
    local backup_dir="${target_dir}.backup.$(date +%Y%m%d%H%M%S)"
    echo "⚠️  检测到已有安装，备份到 $backup_dir"
    mv "$target_dir" "$backup_dir"
  fi

  # 复制插件目录
  mkdir -p "$(dirname "$target_dir")"
  cp -r "$SCRIPT_DIR/plugin" "$target_dir"

  # 复制前端资源到插件 assets
  cp "$SCRIPT_DIR/index.html" "$target_dir/assets/" 2>/dev/null || true

  echo "✅ 安装完成！"
  echo ""
  echo "下一步："
  echo "  1. 启用插件：openclaw plugin enable clawdeck"
  echo "  2. 重启 Gateway：openclaw gateway restart"
  echo "  3. 访问：运行 \`openclaw web\` 查看实际端口后访问 http://localhost:<端口>/plugins/clawdeck/"
}

# 主流程
main() {
  cat <<'EOF'
  ██████╗██╗      █████╗ ██╗    ██╗██████╗ ███████╗ ██████╗██╗  ██╗
 ██╔════╝██║     ██╔══██╗██║    ██║██╔══██╗██╔════╝██╔════╝██║ ██╔╝
 ██║     ██║     ███████║██║ █╗ ██║██║  ██║█████╗  ██║     █████╔╝
 ██║     ██║     ██╔══██║██║███╗██║██║  ██║██╔══╝  ██║     ██╔═██╗
 ╚██████╗███████╗██║  ██║╚███╔███╔╝██████╔╝███████╗╚██████╗██║  ██╗
  ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝ ╚═════╝ ╚══════╝ ╚═════╝╚═╝  ╚═╝
EOF
  echo ""
  echo -e "  \033[90mClawDeck v${CLAWDECK_VERSION} — OpenClaw 任务看板插件\033[0m"
  echo -e "  \033[90m================================================\033[0m"
  echo ""

  local openclaw_dir
  openclaw_dir=$(detect_openclaw_dir)

  if [ -z "$openclaw_dir" ]; then
    echo "❌ 未找到 OpenClaw 安装目录"
    echo ""
    echo "请设置 OPENCLAW_HOME 环境变量指向 OpenClaw 根目录："
    echo "  export OPENCLAW_HOME=/path/to/openclaw"
    echo ""
    echo "或者直接手动复制 plugin/ 目录到 OpenClaw 的 plugins/ 目录下"
    exit 1
  fi

  echo "🔍 检测到 OpenClaw 目录：$openclaw_dir"
  echo ""
  install_plugin "$openclaw_dir"
}

main "$@"
