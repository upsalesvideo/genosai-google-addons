@echo off
chcp 65001 >nul

set "CLASP=%APPDATA%\npm\clasp.cmd"
if not exist "%CLASP%" set "CLASP=clasp"

echo A browser window will open. Pick the Google account with your presentation.
call "%CLASP%" login
echo.
pause
