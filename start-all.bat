@echo off
chcp 65001 >nul
cd /d %~dp0

set "NODE=C:\Users\Administrator\.workbuddy\binaries\node\versions\22.12.0\node.exe"
set "NODE_PATH=C:\Users\Administrator\.workbuddy\binaries\node\workspace\node_modules"

if not exist "%NODE%" (
  echo [错误] 找不到 Node.js，请修改本文件顶部的 NODE 路径
  pause
  exit /b
)

echo ============================================
echo  本地测试一键启动（程序启动器模式）
echo  浏览器地址: http://localhost:3000
echo  先确认 programs.json 里的 exe 路径已填好
echo ============================================
echo.

echo [1/2] 启动中继服务 (HTTP 3000 + WS 3001) ...
start "中继服务" cmd /k "%NODE% server.js"
timeout /t 1 /nobreak >nul

echo [2/2] 启动本地客户端（负责启动/切换 exe）...
start "本地客户端" cmd /k "%NODE% local-client.js"
timeout /t 1 /nobreak >nul

echo.
echo 全部启动完成！请打开浏览器访问 http://localhost:3000
echo 点击任意「启动」按钮，现场电脑会自动打开对应 exe。
echo 测试完直接关闭两个黑色窗口即可。
pause
