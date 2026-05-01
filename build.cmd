@echo off
REM build.cmd - concatenate src\*.js, write dist\source.js, copy to clipboard.
setlocal
cd /d "%~dp0"

where go >nul 2>nul
if errorlevel 1 (
    echo Go is not installed. Install from https://go.dev/dl/ and retry.
    exit /b 1
)

go run build.go
exit /b %ERRORLEVEL%
