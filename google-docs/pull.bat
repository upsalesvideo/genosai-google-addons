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

echo This overwrites local files with the version from Google.
pause
call "%CLASP%" pull
pause
