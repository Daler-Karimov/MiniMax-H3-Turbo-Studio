@echo off
if "%~1"=="" (
    call "%~dp0run_freevideo.bat"
    exit /b %ERRORLEVEL%
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0freevideo.ps1" %*
exit /b %ERRORLEVEL%
