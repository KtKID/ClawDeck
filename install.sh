#!/bin/bash
set -e

# ==============================================================================
# 用法示例 / Usage Examples
# ==============================================================================
#
# 📦 方式一：从 GitHub 下载安装（默认）
#    ./install.sh
#    ./install.sh --openclaw-home ~/.openclaw
#
# 📁 方式二：从本地源码部署（开发调试用）
#    ./install.sh --src /Volumes/machub_app/proj/ClawDeck --openclaw-home ~/.openclaw
#    ./install.sh --src /Volumes/machub_app/proj/ClawDeck --openclaw-home /Volumes/machub_app/proj/openclaw-agent-team/studio-team/docker-data
#
# 🔄 更新已安装的插件
#    ./install.sh
#
# 🗑️  卸载插件
#    ./install.sh --openclaw-home ~/.openclaw  # 选 2 卸载
#
# ==============================================================================

CLAWDECK_VERSION="0.1.0"
PLUGIN_NAME="clawdeck"
REPO="KtKID/ClawDeck"
BRANCH="main"
DEFAULT_SRC_DIR="$HOME/.clawdeck-src"
EXTENSIONS_DIR=""

FORCE=false
CUSTOM_SRC=""
CUSTOM_OPENCLAW_HOME=""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

HAS_TTY=false
if (echo >/dev/tty) 2>/dev/null; then
  HAS_TTY=true
fi

safe_read() {
  if [ "$HAS_TTY" = true ]; then
    read "$@" </dev/tty
  else
    local _var=""
    local _arg
    for _arg in "$@"; do
      case "$_arg" in
        -*) ;;
        *) _var="$_arg" ;;
      esac
    done
    if [ -n "$_var" ]; then
      eval "$_var=''"
    else
      REPLY=""
    fi
  fi
}

print_logo() {
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
}

print_help() {
  cat <<EOF
用法:
  ./install.sh [选项]

选项:
  --openclaw-home <路径>  指定 OpenClaw 根目录（会使用 <路径>/extensions）
  --src <路径>            使用本地源码安装（开发/调试）
  --force                 允许在安全条件下删除默认源码目录并强制使用 ~/.openclaw/extensions
  -h, --help              显示帮助

示例:
  ./install.sh
  ./install.sh --openclaw-home ~/.openclaw
  ./install.sh --src /path/to/ClawDeck --openclaw-home ~/.openclaw
EOF
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1
}

get_node_version() {
  local ver
  ver=$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1)
  echo "$ver"
}

resolve_extensions_dir() {
  local home="${HOME:-$(eval echo ~)}"

  if [ -n "$OPENCLAW_HOME" ]; then
    EXTENSIONS_DIR="$OPENCLAW_HOME/extensions"
    return 0
  fi

  if [ -d "$home/.openclaw/extensions" ]; then
    EXTENSIONS_DIR="$home/.openclaw/extensions"
    return 0
  fi

  if require_cmd openclaw; then
    local oc_home
    oc_home=$(openclaw config get home 2>/dev/null || echo "")
    if [ -n "$oc_home" ] && [ -d "$oc_home/extensions" ]; then
      EXTENSIONS_DIR="$oc_home/extensions"
      return 0
    fi
  fi

  if [ "$FORCE" = true ]; then
    EXTENSIONS_DIR="$home/.openclaw/extensions"
    return 0
  fi

  echo -e "${RED}❌ 未检测到 OpenClaw 安装目录。${NC}"
  echo -e "${YELLOW}请选择一种方式告诉我插件要装到哪里：${NC}"
  echo -e "  ${GREEN}--openclaw-home <路径>${NC}  指定 OpenClaw 根目录（会使用 <路径>/extensions）"
  echo -e "  ${GREEN}--force${NC}                 强制使用默认目录：~/.openclaw/extensions"
  exit 1
}

check_installed() {
  resolve_extensions_dir
  [ -d "$EXTENSIONS_DIR/$PLUGIN_NAME" ] || [ -L "$EXTENSIONS_DIR/$PLUGIN_NAME" ]
}

check_prerequisites() {
  local ok=true

  echo -e "${CYAN}正在检查依赖...${NC}"
  echo ""

  if require_cmd git; then
    echo -e "  ${GREEN}✓${NC} git $(git --version | cut -d' ' -f3)"
  else
    echo -e "  ${RED}✗ 未找到 git${NC}"
    ok=false
  fi

  if require_cmd node; then
    local node_ver
    node_ver=$(get_node_version)
    if [ "$node_ver" -ge 18 ] 2>/dev/null; then
      echo -e "  ${GREEN}✓${NC} node $(node --version)"
    else
      echo -e "  ${RED}✗ node $(node --version)（需要 18 及以上）${NC}"
      ok=false
    fi
  else
    echo -e "  ${RED}✗ 未找到 node${NC}"
    ok=false
  fi

  if require_cmd npm; then
    echo -e "  ${GREEN}✓${NC} npm $(npm --version 2>/dev/null)"
  else
    echo -e "  ${RED}✗ 未找到 npm${NC}"
    ok=false
  fi

  echo ""

  if [ "$ok" = false ]; then
    echo -e "${RED}依赖不完整，请先安装缺失组件。${NC}"
    exit 1
  fi
}

print_install_summary() {
  local src_dir="$1"

  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}✅ 安装完成${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "${CYAN}插件目录：${NC} $EXTENSIONS_DIR/$PLUGIN_NAME"
  echo -e "${CYAN}源码目录：${NC} $src_dir"
  echo ""
  echo -e "${YELLOW}下一步：${NC}"
  echo -e "  1. 启用插件：${GREEN}openclaw plugins enable clawdeck${NC}"
  echo -e "     或使用配置命令：${GREEN}openclaw config set plugins.entries.clawdeck.enabled true --strict-json${NC}"
  echo -e "  2. 重启 Gateway：${GREEN}openclaw gateway restart${NC}"
  echo -e "  3. 浏览器打开：${GREEN}http://localhost:18789/plugins/clawdeck/${NC}"
  echo -e "  4. 如果端口不是 18789，请运行 ${GREEN}openclaw web${NC} 查看实际端口"
  echo ""
}

print_update_summary() {
  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}✅ 更新完成${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "${YELLOW}请重启 OpenClaw Gateway：${NC}${GREEN}openclaw gateway restart${NC}"
  echo ""
}

run_build_and_deploy() {
  echo -e "${BLUE}正在安装依赖...${NC}"
  npm install --no-audit --no-fund
  echo ""

  echo -e "${BLUE}正在编译 Bridge 层...${NC}"
  npm run build:bridge
  echo ""

  echo -e "${BLUE}正在部署插件...${NC}"
  node scripts/deploy-plugin.mjs --target "$EXTENSIONS_DIR/$PLUGIN_NAME"
  echo ""
}

install_local() {
  local src_dir="$1"

  echo ""
  echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}  从本地源码安装 ClawDeck${NC}"
  echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
  echo ""

  if [ ! -d "$src_dir" ]; then
    echo -e "${RED}❌ 源码目录不存在：$src_dir${NC}"
    exit 1
  fi

  echo -e "${CYAN}源码目录：${NC} $src_dir"
  echo -e "${CYAN}插件目录：${NC} $EXTENSIONS_DIR/$PLUGIN_NAME"
  echo ""

  check_prerequisites

  cd "$src_dir"
  run_build_and_deploy
  print_install_summary "$src_dir"
}

install_clawdeck() {
  local src_dir="$1"

  echo ""
  echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}  安装 ClawDeck${NC}"
  echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
  echo ""

  if [ -z "$src_dir" ]; then
    src_dir="$DEFAULT_SRC_DIR"
  fi

  check_prerequisites

  echo -e "${CYAN}源码目录：${NC} $src_dir"
  echo -e "${CYAN}插件目录：${NC} $EXTENSIONS_DIR/$PLUGIN_NAME"
  echo ""

  if [ -d "$src_dir/.git" ]; then
    echo -e "${BLUE}检测到已有源码，正在拉取最新代码...${NC}"
    cd "$src_dir"
    git pull origin "$BRANCH" || {
      echo -e "${YELLOW}⚠ 拉取失败，继续使用当前源码。${NC}"
    }
  else
    if [ -d "$src_dir" ]; then
      echo -e "${RED}❌ 目标目录已存在且不是 git 仓库：$src_dir${NC}"
      echo -e "${YELLOW}请使用 --src 指向已有源码，或手动清理该目录。${NC}"
      echo -e "${YELLOW}如需强制删除，请加 --force（仅允许删除默认目录）。${NC}"
      if [ "$FORCE" = true ]; then
        if [ "$src_dir" = "$DEFAULT_SRC_DIR" ]; then
          echo -e "${YELLOW}⚠ 强制删除默认源码目录：$src_dir${NC}"
          rm -rf "$src_dir"
        else
          echo -e "${RED}❌ 为安全起见，非默认目录不允许自动删除：$src_dir${NC}"
          exit 1
        fi
      else
        exit 1
      fi
    fi
    echo -e "${BLUE}正在克隆仓库...${NC}"
    git clone --depth 1 --branch "$BRANCH" "https://github.com/$REPO.git" "$src_dir"
    cd "$src_dir"
  fi

  run_build_and_deploy
  print_install_summary "$src_dir"
}

update_clawdeck() {
  echo ""
  echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${YELLOW}  更新 ClawDeck${NC}"
  echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
  echo ""

  local src_dir="$DEFAULT_SRC_DIR"
  if [ ! -d "$src_dir/.git" ]; then
    echo -e "${YELLOW}未找到默认源码目录，将重新安装。${NC}"
    install_clawdeck "$src_dir"
    return
  fi

  cd "$src_dir"

  local current_hash
  current_hash=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
  echo -e "${CYAN}当前版本：${NC} $current_hash"

  echo -e "${BLUE}正在拉取最新代码...${NC}"
  git pull origin "$BRANCH"

  local new_hash
  new_hash=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
  echo -e "${CYAN}最新版本：${NC} $new_hash"
  echo ""

  run_build_and_deploy
  print_update_summary
}

uninstall_clawdeck() {
  echo ""
  echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${YELLOW}  卸载 ClawDeck${NC}"
  echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
  echo ""

  local plugin_dir="$EXTENSIONS_DIR/$PLUGIN_NAME"
  local src_dir="$DEFAULT_SRC_DIR"

  echo -e "${CYAN}插件目录：${NC} $plugin_dir"
  if [ -d "$src_dir" ]; then
    echo -e "${CYAN}源码目录：${NC} $src_dir"
  fi
  echo ""

  if [ -d "$plugin_dir" ] || [ -L "$plugin_dir" ]; then
    if [ -L "$plugin_dir" ]; then
      echo -e "${YELLOW}注意：检测到符号链接，仅会删除链接本身。${NC}"
    fi
    echo -e "${CYAN}待删除插件目录：${NC} $plugin_dir"
    echo -n -e "${RED}确认删除上述插件目录？ [y/N] ${NC}"
    safe_read -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      local expected_suffix="/extensions/$PLUGIN_NAME"
      if [ -n "$plugin_dir" ] && [ "$plugin_dir" != "/" ] && [[ "$plugin_dir" == *"$expected_suffix" ]]; then
        rm -rf "$plugin_dir"
        echo -e "${GREEN}✓ 插件目录已删除${NC}"
      else
        echo -e "${RED}❌ 为安全起见，插件目录路径校验失败，已拒绝删除：$plugin_dir${NC}"
        exit 1
      fi
    fi
  else
    echo -e "${YELLOW}未找到插件目录。${NC}"
  fi

  if [ -d "$src_dir" ]; then
    echo -e "${CYAN}待删除源码目录：${NC} $src_dir"
    echo -n -e "${RED}是否同时删除默认源码目录（仅上述路径）？ [y/N] ${NC}"
    safe_read -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      rm -rf "$src_dir"
      echo -e "${GREEN}✓ 源码目录已删除${NC}"
    fi
  fi

  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}✅ 卸载完成${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "${YELLOW}请重启 OpenClaw Gateway：${NC}${GREEN}openclaw gateway restart${NC}"
  echo ""
}

print_logo

while [[ $# -gt 0 ]]; do
  case "$1" in
    --src)
      CUSTOM_SRC="$2"
      shift 2
      ;;
    --openclaw-home)
      CUSTOM_OPENCLAW_HOME="$2"
      shift 2
      ;;
    --force)
      FORCE=true
      shift
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    *)
      shift
      ;;
  esac
done

if [ -n "$CUSTOM_OPENCLAW_HOME" ]; then
  export OPENCLAW_HOME="$CUSTOM_OPENCLAW_HOME"
fi

resolve_extensions_dir

if [ -n "$CUSTOM_SRC" ]; then
  install_local "$CUSTOM_SRC"
  exit 0
fi

if check_installed; then
  echo -e "${GREEN}✓ 已检测到 ClawDeck${NC}"
  echo -e "${CYAN}位置：${NC} $EXTENSIONS_DIR/$PLUGIN_NAME"

  if [ -L "$EXTENSIONS_DIR/$PLUGIN_NAME" ]; then
    local_target=$(readlink "$EXTENSIONS_DIR/$PLUGIN_NAME" 2>/dev/null || echo "unknown")
    echo -e "${CYAN}模式：${NC} ${YELLOW}符号链接 -> $local_target${NC}"
  fi

  if [ "$HAS_TTY" = false ]; then
    echo ""
    echo -e "${CYAN}当前为非交互模式，自动执行更新。${NC}"
    update_clawdeck
    exit 0
  fi

  echo ""
  echo -e "${YELLOW}请选择操作：${NC}"
  echo "  1) 更新到最新版本"
  echo "  2) 卸载"
  echo "  3) 退出"
  echo ""
  echo -n "请输入选择 [1-3]："
  safe_read -n 1 -r CHOICE
  echo

  case $CHOICE in
    1)
      update_clawdeck
      ;;
    2)
      uninstall_clawdeck
      ;;
    3)
      echo -e "${YELLOW}已退出。${NC}"
      exit 0
      ;;
    *)
      echo -e "${RED}无效选择。${NC}"
      exit 1
      ;;
  esac
else
  install_clawdeck "$DEFAULT_SRC_DIR"
fi
