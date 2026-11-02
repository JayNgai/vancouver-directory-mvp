@echo off
rem Stop the Vancouver Directory site by port, never by process name.
rem Filter to State=Listen: a closed socket lingers as TimeWait on the same port, owned by PID 0
rem (System), and stopping that is both wrong and denied.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$c = Get-NetTCPConnection -LocalPort 5050 -State Listen -ErrorAction SilentlyContinue;" ^
  "if ($c) { $p = ($c | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 4 }); foreach ($procId in $p) { Stop-Process -Id $procId -Force -ErrorAction Stop; Write-Host ('stopped pid ' + $procId) } } else { Write-Host 'nothing listening on 5050' }"
