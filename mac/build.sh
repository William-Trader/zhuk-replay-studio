#!/bin/bash
# 交易训练室 · macOS 打包脚本
# 用法：bash mac/build.sh          → 生成 dist-mac/交易训练室.app
# 说明：先尽量用 npm run build 刷新 Web 产物；随后编译原生壳、生成图标、组装 .app。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAC="$ROOT/mac"
BUILD="$ROOT/.mac-build"
OUT="$ROOT/dist-mac"
APP_NAME="交易训练室"

# swiftc 在 TMPDIR 指向含非 ASCII 字符目录时会崩溃（Apple 工具链坑），统一用纯 ASCII 临时目录
export TMPDIR="$(mktemp -d /tmp/zk-mac-build.XXXXXX)"
trap 'rm -rf "$TMPDIR" 2>/dev/null || true' EXIT

# 0) 刷新 Web 产物（有 node_modules 时）
if command -v node >/dev/null 2>&1 && [ -d "$ROOT/node_modules" ]; then
  (cd "$ROOT" && npm run build >/dev/null)
fi
if [ ! -f "$ROOT/dist/index.html" ]; then
  echo "缺少 dist/index.html：请先执行 npm ci && npm run build" >&2
  exit 1
fi

mkdir -p "$BUILD" "$OUT" "$TMPDIR"
rm -rf "$BUILD/AppIcon.iconset"

# 1) 图标
swiftc -O "$MAC/ZhukReplay/IconGen.swift" -o "$BUILD/icongen"
"$BUILD/icongen" "$BUILD/AppIcon.iconset"
iconutil -c icns "$BUILD/AppIcon.iconset" -o "$BUILD/AppIcon.icns"

# 2) 编译原生壳
swiftc -O "$MAC/ZhukReplay/main.swift" "$MAC/ZhukReplay/App.swift" "$MAC/ZhukReplay/HTTPServer.swift" "$MAC/ZhukReplay/Services.swift" -o "$BUILD/ZhukReplay"

# 3) 组装 App Bundle
APP="$OUT/$APP_NAME.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BUILD/ZhukReplay" "$APP/Contents/MacOS/ZhukReplay"
cp "$BUILD/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
rm -rf "$APP/Contents/Resources/web"
cp -R "$ROOT/dist" "$APP/Contents/Resources/web"
rm -rf "$APP/Contents/Resources/python"
cp -R "$MAC/ZhukReplay/python" "$APP/Contents/Resources/python"
if [ -d "$ROOT/licenses" ]; then cp -R "$ROOT/licenses" "$APP/Contents/Resources/licenses"; fi
cp "$ROOT/THIRD_PARTY_NOTICES.md" "$APP/Contents/Resources/THIRD_PARTY_NOTICES.md"
printf 'APPL????' > "$APP/Contents/PkgInfo"

VER=""
if command -v node >/dev/null 2>&1; then
  VER="$(node -p "require('$ROOT/package.json').version" 2>/dev/null || true)"
fi
[ -n "$VER" ] || VER="0.3.0"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>交易训练室</string>
  <key>CFBundleDisplayName</key><string>交易训练室</string>
  <key>CFBundleIdentifier</key><string>com.william.zhuk-replay-studio</string>
  <key>CFBundleExecutable</key><string>ZhukReplay</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VER</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.finance</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSHumanReadableCopyright</key><string>本地离线工具 · 内置 OKX 历史快照</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST

xattr -cr "$APP" 2>/dev/null || true
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
echo "OK → $APP"
