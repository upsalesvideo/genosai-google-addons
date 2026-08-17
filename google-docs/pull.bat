@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist .clasp.json (
  echo No .clasp.json here. Run: clasp-init.bat YOUR_SCRIPT_ID
  pause
  exit /b 1
)

echo This overwrites local files with the version from Google.
pause
clasp pull
pause
