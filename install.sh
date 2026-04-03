#!/bin/bash
set -e

# ==============================================================================
# ClawDeck Docker Link 部署脚本
# 宿主机编译 → 容器内 link 安装 → 重启容器
#
# 用法：
#   ./install.sh          首次安装（install -l + enable + restart）
#   ./install.sh restart   仅重启容器（编译后快速生效）
#
# 前提：
#   1. Docker 容器已运行，且 ClawDeck-g 目录已映射到容器内
#   2. 修改下方常量匹配你的环境
# ==============================================================================

# ── 常量配置 ──────────────────────────────────────────────────────────────────
CONTAINER_NAME="openclaw_official-openclaw-gateway-1"
CONTAINER_CLAWDECK_PATH="/home/node/ClawDeck-g"
# ─────────────────────────────────────────────────────────────────────────────

PLUGIN_NAME="clawdeck"
PLUGIN_DIST_REL="dist/plugin-package/$PLUGIN_NAME"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}▸ $1${NC}"; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }

run() {
  log "$1"
  shift
  if "$@"; then
    ok "成功"
  else
    fail "失败（退出码 $?）: $*"
  fi
}

cd "$SCRIPT_DIR"

# ── 检查 Docker 容器 ─────────────────────────────────────────────────────────
check_container() {
  log "检查容器 $CONTAINER_NAME ..."
  if ! docker inspect "$CONTAINER_NAME" &>/dev/null; then
    fail "容器 $CONTAINER_NAME 未找到，请检查 CONTAINER_NAME 常量"
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null)" != "true" ]; then
    fail "容器 $CONTAINER_NAME 未运行"
  fi
  ok "容器运行中"
}

# ── 宿主机编译 ────────────────────────────────────────────────────────────────
build() {
  run "编译 Bridge 层" npm run build:bridge
  run "打包插件" npm run package:plugin

  local dist_dir="$SCRIPT_DIR/$PLUGIN_DIST_REL"
  if [ ! -d "$dist_dir" ]; then
    fail "打包产物不存在: $dist_dir"
  fi
  ok "产物目录: $dist_dir"
}

# ── 容器内安装 ────────────────────────────────────────────────────────────────
install_link() {
  local plugin_path="$CONTAINER_CLAWDECK_PATH/$PLUGIN_DIST_REL"
  local ext_dir="/home/node/.openclaw/extensions/$PLUGIN_NAME"

  # 清理旧插件（目录或链接），避免 "plugin already exists" 报错
  if docker exec "$CONTAINER_NAME" test -e "$ext_dir" 2>/dev/null; then
    run "清理旧插件 $ext_dir" \
      docker exec "$CONTAINER_NAME" rm -rf "$ext_dir"
  fi

  run "安装插件 (link → $plugin_path)" \
    docker exec "$CONTAINER_NAME" openclaw plugins install -l "$plugin_path"

  log "启用插件 $PLUGIN_NAME"
  if docker exec "$CONTAINER_NAME" openclaw plugins enable "$PLUGIN_NAME"; then
    ok "成功"
  else
    warn "enable 退出异常（可忽略，restart 后会自动加载）"
  fi
}

# ── 重启容器 ──────────────────────────────────────────────────────────────────
restart() {
  run "重启容器 $CONTAINER_NAME" docker restart "$CONTAINER_NAME"
}

# ── 主流程 ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}ClawDeck Deploy (link mode)${NC}"
echo -e "${CYAN}容器: $CONTAINER_NAME${NC}"
echo -e "${CYAN}映射: $CONTAINER_CLAWDECK_PATH${NC}"
echo ""

case "${1:-install}" in
  restart)
    check_container
    build
    restart
    ;;
  install|*)
    check_container
    build
    install_link
    restart
    ;;
esac

echo ""
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}  部署完成${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"
