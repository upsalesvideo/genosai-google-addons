@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "ID=%~1"
if "%ID%"=="" set /p ID=Script ID (Apps Script - Project Settings - Script ID):
if "%ID%"=="" (
  echo Script ID is empty. Nothing done.
  pause
  exit /b 1
)

> .clasp.json echo {"scriptId":"%ID%","rootDir":"."}
echo.
echo .clasp.json created for %ID%
echo Now run push.bat to upload the add-on.
pause
