#!/usr/bin/env bash
# WebQQ 部署脚本
# 用法: ./scripts/deploy.sh [--skip-build]
#   --skip-build  跳过前端构建（只同步已有 dist）

set -euo pipefail

# ── 配置 ──────────────────────────────────────────
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVER="${VPS_HOST:-43.153.148.187}"
REMOTE_DIR="/var/www/webQQ"
REMOTE_SSH_USER="root"
PM2_NAME="webqq-server"
SKIP_BUILD=false

# ── 颜色 ──────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── 参数 ──────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
    -h|--help)
      echo "用法: $0 [--skip-build]"
      echo "  --skip-build  跳过前端 npm run build"
      exit 0
      ;;
    *) error "未知参数: $arg" ;;
  esac
done

# ── 检查本地环境 ──────────────────────────────────
cd "$PROJECT_DIR"
command -v rsync >/dev/null 2>&1 || error "缺少 rsync，请安装"
command -v ssh >/dev/null 2>&1  || error "缺少 ssh，请安装"

# ── 1. 构建前端 ───────────────────────────────────
if [ "$SKIP_BUILD" = false ]; then
  info "构建前端..."
  (cd client && npm run build)
else
  warn "跳过前端构建"
  [ -d client/dist ] || error "client/dist 不存在，请去掉 --skip-build"
fi

# ── 2. 同步文件 ───────────────────────────────────
info "同步后端源码到 $SERVER:$REMOTE_DIR/server ..."
rsync -avz \
  --exclude 'node_modules' \
  --exclude 'data' \
  --exclude 'uploads' \
  server/ \
  "${REMOTE_SSH_USER}@${SERVER}:${REMOTE_DIR}/server/"

info "同步前端 dist 到 $SERVER:$REMOTE_DIR/client ..."
rsync -avz \
  client/dist/ \
  "${REMOTE_SSH_USER}@${SERVER}:${REMOTE_DIR}/client/"

# ── 3. 重启后端 ───────────────────────────────────
info "重启 ${PM2_NAME}..."
ssh "${REMOTE_SSH_USER}@${SERVER}" \
  "pm2 restart ${PM2_NAME} && pm2 status ${PM2_NAME} --no-header 2>/dev/null || pm2 status"

# ── 4. 验证 ───────────────────────────────────────
info "验证部署..."
sleep 2
HEALTH=$(ssh "${REMOTE_SSH_USER}@${SERVER}" \
  'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh";
   node -e "
     const http = require(\"http\");
     http.get(\"http://localhost:8850/api/health\", (res) => {
       let d = \"\"; res.on(\"data\", c => d += c);
       res.on(\"end\", () => console.log(d));
     }).on(\"error\", e => { console.log(\"FAIL:\" + e.message); process.exit(1); });
   " 2>/dev/null')

if [ -n "$HEALTH" ] && echo "$HEALTH" | grep -q '"ok":true'; then
  info "部署成功 ✓  http://$SERVER:8850"
  echo "  $HEALTH"
else
  warn "健康检查返回: $HEALTH"
  warn "手动检查: ssh ${REMOTE_SSH_USER}@${SERVER} 'pm2 logs ${PM2_NAME} --lines 20 --nostream'"
fi
