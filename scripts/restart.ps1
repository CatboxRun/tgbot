# 停止当前 bot 并立即拉起新进程（不依赖 -Restart 参数）
$ErrorActionPreference = 'Stop'
$BotDir = Split-Path -Parent $PSScriptRoot
$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { $Node = 'C:\Program Files\nodejs\node.exe' }
$PidFile = Join-Path $BotDir 'data\bot.pid'
$OutLog = Join-Path $BotDir 'data\bot.out.log'
$ErrLog = Join-Path $BotDir 'data\bot.err.log'
$LogFile = Join-Path $BotDir 'data\watchdog.log'

function Write-Log([string]$msg) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function Stop-Bot {
  $killed = @()
  if (Test-Path $PidFile) {
    $id = 0
    [void][int]::TryParse((Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1), [ref]$id)
    if ($id -gt 0) {
      $p = Get-Process -Id $id -ErrorAction SilentlyContinue
      if ($p) {
        Stop-Process -Id $id -Force
        $killed += $id
      }
    }
  }
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -and (
        $_.CommandLine -like "*$BotDir*index.js*" -or
        ($_.CommandLine -eq '"C:\Program Files\nodejs\node.exe" index.js' -and $_.ExecutablePath)
      )
    } |
    ForEach-Object {
      $wd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.ProcessId)" -ErrorAction SilentlyContinue)
      if ($_.CommandLine -like '*index.js*') {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        $killed += $_.ProcessId
      }
    }
  return ($killed | Select-Object -Unique)
}

Write-Log 'restart.ps1: stopping bot'
$stopped = Stop-Bot
Write-Log ("restart.ps1: stopped pids={0}" -f (($stopped | ForEach-Object { $_ }) -join ','))
Start-Sleep -Seconds 2

Write-Log 'restart.ps1: starting bot'
$p = Start-Process -FilePath $Node -ArgumentList 'index.js' -WorkingDirectory $BotDir -WindowStyle Hidden -PassThru -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog
if ($p) {
  Set-Content -Path $PidFile -Value $p.Id -Encoding ASCII
  Write-Log ("restart.ps1: started pid={0}" -f $p.Id)
  Write-Host "Bot restarted pid=$($p.Id)"
} else {
  Write-Log 'restart.ps1: start failed'
  Write-Error 'Failed to start bot'
}
