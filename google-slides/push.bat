@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "CLASP=%APPDATA%\npm\clasp.cmd"
if not exist "%CLASP%" set "CLASP=clasp"

if not exist .clasp.json (
  echo No .clasp.json here. Run clasp-init.bat with your Script ID first.
  pause
  exit /b 1
)

call "%CLASP%" push -f
echo.
echo Done. Reload the Google Slides tab to see the new version.
pause
