@echo off
setlocal

set "APP_DIR=%~dp0"
for %%I in ("%APP_DIR%..") do set "ROOT_DIR=%%~fI"
set "PORT=8787"
set "URL=http://127.0.0.1:%PORT%/TranslatorApp_v2/index.html"

where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  set "PY_CMD=py -3"
) else (
  where python >nul 2>nul
  if %ERRORLEVEL% NEQ 0 goto NO_PYTHON
  set "PY_CMD=python"
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$port = %PORT%; $url = '%URL%'; $root = '%ROOT_DIR:\=/%';" ^
  "$isOpen = $false;" ^
  "try { $client = [Net.Sockets.TcpClient]::new(); $async = $client.BeginConnect('127.0.0.1', $port, $null, $null); $isOpen = $async.AsyncWaitHandle.WaitOne(250); if ($isOpen) { $client.EndConnect($async) }; $client.Close() } catch {}" ^
  "if (-not $isOpen) { Start-Process -WindowStyle Hidden -FilePath '%ComSpec%' -ArgumentList '/c cd /d ""%ROOT_DIR%"" && %PY_CMD% -m http.server %PORT% --bind 127.0.0.1 --directory ""%ROOT_DIR%""' }" ^
  "Start-Sleep -Milliseconds 500;" ^
  "Start-Process $url"

exit /b 0

:NO_PYTHON
echo Python was not found. Please install Python 3 or run a local static server manually.
echo Then open:
echo %URL%
pause
exit /b 1
