#!/bin/bash
# 交易训练室 · macOS 双击启动（浏览器模式，等同 Windows 的 启动交易训练室.cmd）
cd "$(dirname "$0")" || exit 1

find_node() {
  if command -v node >/dev/null 2>&1; then command -v node; return 0; fi
  local p
  for p in /opt/homebrew/bin/node /usr/local/bin/node "$HOME"/.nvm/versions/node/*/bin/node; do
    [ -x "$p" ] && { echo "$p"; return 0; }
  done
  return 1
}

NODE="$(find_node || true)"
if [ -z "$NODE" ]; then
  echo "未找到 Node.js 22.13+，请先安装：https://nodejs.org/"
  osascript -e 'display alert "交易训练室" message "未找到 Node.js，请先安装 Node.js 22.13 或更高版本。" as critical' >/dev/null 2>&1 || true
  read -r -p "按回车退出…" _ || true
  exit 1
fi

NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js 版本过低（$("$NODE" -v)），需要 22.13 或更高。"
  read -r -p "按回车退出…" _ || true
  exit 1
fi

if [ ! -f dist/index.html ]; then
  echo "缺少构建产物 dist/。请先在本目录执行：npm ci && npm run build"
  read -r -p "按回车退出…" _ || true
  exit 1
fi

export PORT="${PORT:-8808}"
echo "交易训练室"
echo "浏览器打开 http://127.0.0.1:$PORT/"
echo "保持本窗口运行，关闭窗口或按 Ctrl+C 停止服务。"
( sleep 1; open "http://127.0.0.1:$PORT/" >/dev/null 2>&1 || true ) &
exec "$NODE" serve.mjs
