# Liminal TG bot watchdog: keep a single node index.js alive.
$ErrorActionPreference = 'Continue'
$BotDir = Split-Path -Parent $PSScriptRoot
$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { $Node = 'C:\Program Files\nodejs\node.exe' }
$PidFile = Join-Path $BotDir 'data\bot.pid'
$LogFile = Join-Path $BotDir 'data\watchdog.log'
$OutLog = Join-Path $BotDir 'data\bot.out.log'
$ErrLog = Join-Path $BotDir 'data\bot.err.log'

New-Item -ItemType Directory -Force -Path (Join-Path $BotDir 'data') | Out-Null

function Write-Log([string]$msg) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function Get-BotProcess {
  if (Test-Path $PidFile) {
    $id = 0
    [void][int]::TryParse((Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1), [ref]$id)
    if ($id -gt 0) {
      $p = Get-Process -Id $id -ErrorAction SilentlyContinue
      if ($p -and $p.ProcessName -eq 'node') { return $p }
    }
  }
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -and (
        $_.CommandLine -like '*tg-bot*index.js*' -or
        $_.CommandLine -like '*tg-bot\\index.js*'
      )
    } |
    ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } |
    Select-Object -First 1
}

function Start-Bot {
  Write-Log 'starting bot'
  $p = Start-Process -FilePath $Node -ArgumentList 'index.js' -WorkingDirectory $BotDir -WindowStyle Hidden -PassThru -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog
  if ($p) {
    Set-Content -Path $PidFile -Value $p.Id -Encoding ASCII
    Write-Log ("started pid={0}" -f $p.Id)
  } else {
    Write-Log 'start failed'
  }
}

Write-Log 'watchdog online'
while ($true) {
  try {
    $bot = Get-BotProcess
    if (-not $bot) { Start-Bot }
  } catch {
    Write-Log ("watchdog error: {0}" -f $_.Exception.Message)
  }
  Start-Sleep -Seconds 20
}
