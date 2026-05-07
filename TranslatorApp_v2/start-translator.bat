@echo off
setlocal

set "APP_DIR=%~dp0"
for %%I in ("%APP_DIR%..") do set "ROOT_DIR=%%~fI"
set "DEFAULT_PORT=8787"

where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  set "PY_CMD=py -3"
) else (
  where python >nul 2>nul
  if %ERRORLEVEL% NEQ 0 goto NO_PYTHON
  set "PY_CMD=python"
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = '%ROOT_DIR%'; $pyCmd = '%PY_CMD%'; $defaultPort = %DEFAULT_PORT%;" ^
  "$ports = @($defaultPort) + (8788..8797);" ^
  "function Test-AppServer([int]$port) {" ^
  "  try {" ^
  "    $url = 'http://127.0.0.1:' + $port + '/TranslatorApp_v2/index.html';" ^
  "    $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 1;" ^
  "    return ($response.StatusCode -eq 200 -and $response.Content -like '*Game CSV Translator Tool*' -and $response.Content -like '*./js/main.js*');" ^
  "  } catch { return $false }" ^
  "}" ^
  "function Test-PortOpen([int]$port) {" ^
  "  $client = $null;" ^
  "  try {" ^
  "    $client = [Net.Sockets.TcpClient]::new();" ^
  "    $async = $client.BeginConnect('127.0.0.1', $port, $null, $null);" ^
  "    $open = $async.AsyncWaitHandle.WaitOne(250);" ^
  "    if ($open) { $client.EndConnect($async) };" ^
  "    return $open;" ^
  "  } catch { return $false } finally { if ($client) { $client.Close() } }" ^
  "}" ^
  "$port = $null;" ^
  "foreach ($candidate in $ports) {" ^
  "  if (Test-AppServer $candidate) { $port = $candidate; break }" ^
  "  if (-not (Test-PortOpen $candidate)) { $port = $candidate; break }" ^
  "}" ^
  "if (-not $port) { Write-Host 'No free local port found in 8787-8797.'; Read-Host 'Press Enter to exit'; exit 1 }" ^
  "if (-not (Test-AppServer $port)) {" ^
  "  Start-Process -WindowStyle Hidden -FilePath $env:ComSpec -ArgumentList ('/c cd /d ""' + $root + '"" && ' + $pyCmd + ' -m http.server ' + $port + ' --bind 127.0.0.1 --directory ""' + $root + '""');" ^
  "  Start-Sleep -Milliseconds 800;" ^
  "}" ^
  "$url = 'http://127.0.0.1:' + $port + '/TranslatorApp_v2/index.html';" ^
  "if (-not (Test-AppServer $port)) { Write-Host ('Failed to start TranslatorApp_v2 at ' + $url); Read-Host 'Press Enter to exit'; exit 1 }" ^
  "Start-Process $url"

exit /b 0

:NO_PYTHON
echo Python was not found. Please install Python 3 or run a local static server manually.
echo Then open:
echo http://127.0.0.1:8787/TranslatorApp_v2/index.html
pause
exit /b 1
