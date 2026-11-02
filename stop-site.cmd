@echo off
rem Stop the Vancouver Directory site by port, never by process name.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$c = Get-NetTCPConnection -LocalPort 5050 -ErrorAction SilentlyContinue;" ^
  "if ($c) { $p = ($c | Select-Object -ExpandProperty OwningProcess -Unique); foreach ($procId in $p) { Stop-Process -Id $procId -Force; Write-Host ('stopped pid ' + $procId) } } else { Write-Host 'nothing listening on 5050' }"
