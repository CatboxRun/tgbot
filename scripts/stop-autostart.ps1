# Stop watchdog + bot (does not unregister the scheduled task).
$ErrorActionPreference = 'Continue'
Get-ScheduledTask -TaskName 'LiminalTgBot' -ErrorAction SilentlyContinue | Stop-ScheduledTask
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*tg-bot*watchdog.ps1*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*tg-bot*index.js*' -or $_.CommandLine -like '*tg-bot\\index.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host 'Stopped Liminal TG bot watchdog and node process.'
