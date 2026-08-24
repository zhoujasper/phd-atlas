@echo off
setlocal
cd /d "%~dp0.."

set "PHD_ATLAS_DESKTOP=1"
set "HOST=127.0.0.1"
if not defined PORT set "PORT=4318"

echo Starting PhD Atlas desktop runtime on http://127.0.0.1:%PORT%
echo Close this window to stop the app.

start "" "http://127.0.0.1:%PORT%"

if exist "desktop\resources\runtime\node.exe" (
  "desktop\resources\runtime\node.exe" "desktop\launch-runtime.mjs"
) else (
  node "desktop\launch-runtime.mjs"
)
