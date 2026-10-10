#!/bin/bash
# 工业级校验流水线：类型 → 单元测试 → 静态质量门（可加 --build 出产物）
set -euo pipefail
cd "$(dirname "$0")/.."
echo "① 类型检查"; npx tsc -b
echo "② 单元测试"; npx vitest run
echo "③ 静态质量门"; node scripts/check.mjs
if [ "${1:-}" = "--build" ]; then echo "④ 构建"; npx vite build; fi
echo "全部通过"
