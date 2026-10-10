@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22.13 或更高版本。
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo 首次构建：npm.cmd ci ^&^& npm.cmd run build
  pause
  exit /b 1
)
title 交易训练室
echo 交易训练室
if not defined PORT set "PORT=8808"
echo 浏览器打开 http://127.0.0.1:%PORT%/
echo 保持本窗口运行，关闭窗口或按 Ctrl+C 停止服务。
node serve.mjs
if errorlevel 1 pause
