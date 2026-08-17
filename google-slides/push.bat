@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist .clasp.json (
  echo No .clasp.json here. Run: clasp-init.bat YOUR_SCRIPT_ID
  pause
  exit /b 1
)

clasp push -f
echo.
echo Done. Reload the Google Slides tab to see the new version.
pause
