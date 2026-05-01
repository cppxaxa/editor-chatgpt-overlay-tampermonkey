@echo off
REM run_app.cmd - launches chrome (per appsettings.json) and injects dist\source.js
setlocal
cd /d "%~dp0"

where go >nul 2>nul
if errorlevel 1 (
    echo Go is not installed. Install from https://go.dev/dl/ and retry.
    exit /b 1
)

go run run_app.go
exit /b %ERRORLEVEL%
