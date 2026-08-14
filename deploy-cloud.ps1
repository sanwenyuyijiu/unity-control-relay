# deploy-cloud.ps1 — 云端一键部署脚本（在云服务器上运行）
# 作用：从公开 CDN 拉取修复后的 server.js / index.html，覆盖到 C:\relay，并重启中继服务。
# 用法（在云服务器 RDP 会话的 PowerShell 里粘贴一行）：
#   iex(iwr https://cdn.jsdelivr.net/gh/sanwenyuyijiu/unity-control-relay@main/deploy-cloud.ps1 -UseBasicParsing)

$ErrorActionPreference = "Continue"
$relayDir = "C:\relay"
$pubDir   = Join-Path $relayDir "public"
$log      = Join-Path $relayDir "deploy.log"

function Log($m){ $t = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m"; Write-Host $t; Add-Content -Path $log -Value $t -Encoding utf8 -ErrorAction SilentlyContinue }

# 多源下载（jsDelivr 优先，GitHub raw 兜底）。返回是否成功。
function Get-File($relPath, $destPath){
  $sources = @(
    "https://cdn.jsdelivr.net/gh/sanwenyuyijiu/unity-control-relay@main/$relPath",
    "https://raw.githubusercontent.com/sanwenyuyijiu/unity-control-relay/main/$relPath",
    "https://cdn.jsdelivr.net/gh/sanwenyuyijiu/unity-control-relay@master/$relPath",
    "https://raw.githubusercontent.com/sanwenyuyijiu/unity-control-relay/master/$relPath"
  )
  foreach ($u in $sources){
    try {
      Log "下载 $relPath <- $u"
      Invoke-WebRequest -Uri $u -OutFile $destPath -TimeoutSec 30 -UseBasicParsing -ErrorAction Stop
      if ((Test-Path $destPath) -and ((Get-Item $destPath).Length -gt 100)){
        Log "  ✅ 成功 ($((Get-Item $destPath).Length) 字节)"
        return $true
      }
    } catch {
      Log "  ⚠️ 失败: $($_.Exception.Message)"
    }
  }
  return $false
}

Log "===== 云端部署开始 ====="
if (-not (Test-Path $relayDir)){ New-Item -ItemType Directory -Path $relayDir -Force | Out-Null }
if (-not (Test-Path $pubDir)){ New-Item -ItemType Directory -Path $pubDir -Force | Out-Null }

$ok1 = Get-File "server.js"            (Join-Path $relayDir "server.js")
$ok2 = Get-File "public/index.html"    (Join-Path $pubDir "index.html")

if (-not ($ok1 -and $ok2)){
  Log "❌ 文件下载失败，请检查云服务器是否能访问 jsDelivr / GitHub（国内建议用 jsDelivr）。部署中止。"
  Write-Host "按任意键退出..."; [void][System.Console]::ReadKey($true)
  exit 1
}

# ---- 重启中继服务 ----
Log "停止旧服务..."
# 1) 停止计划任务（若存在）
try { Stop-ScheduledTask -TaskName "UnityRelay" -ErrorAction SilentlyContinue; Log "  已停止 UnityRelay 计划任务" } catch { Log "  无 UnityRelay 任务（忽略）" }
# 2) 杀掉正在跑的 server.js 进程
try {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*server.js*' } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Log "  已结束旧 node 进程 PID=$($_.ProcessId)"
  }
} catch { Log "  无运行中的 node 进程（忽略）" }

Start-Sleep -Seconds 2

Log "启动新服务..."
$task = $null
try { $task = Get-ScheduledTask -TaskName "UnityRelay" -ErrorAction Stop } catch { $task = $null }
if ($task){
  try { Start-ScheduledTask -TaskName "UnityRelay"; Log "  ✅ 已通过 UnityRelay 计划任务启动" } catch { Log "  ⚠️ 任务启动失败，尝试直接运行 node" }
}
# 兜底：若没有任务或任务启动失败，直接拉起 node
$stillRunning = (Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*server.js*' }).Count -gt 0
if (-not $stillRunning){
  $nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
  if ($nodePath){
    Start-Process -FilePath $nodePath -ArgumentList (Join-Path $relayDir "server.js") -WorkingDirectory $relayDir -WindowStyle Hidden
    Log "  ✅ 已直接启动 node server.js"
  } else {
    Log "  ❌ 未找到 node，无法启动。请在云服务器安装 Node.js 后重试。"
  }
}

Start-Sleep -Seconds 3
# 验证
try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:8080/api/status" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
  Log "  ✅ 本地验证 /api/status: $($r.Content)"
} catch {
  Log "  ⚠️ 本地验证失败: $($_.Exception.Message)"
}

Log "===== 部署完成 ====="
Write-Host ""
Write-Host "手机现在可以用浏览器/微信扫码打开 http://115.159.222.101:8080 ，应显示「设备在线」。"
Write-Host "按任意键退出..."; [void][System.Console]::ReadKey($true)
