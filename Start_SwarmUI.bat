@echo off
title FreeVideo + Qwen-Image [SwarmUI RTX 5080]

:: Set base project directory
set "PROJECT_ROOT=%~dp0"
if "%PROJECT_ROOT:~-1%"=="\" set "PROJECT_ROOT=%PROJECT_ROOT:~0,-1%"

:: Force all caches, temporary files and downloads strictly into project folder
set "FREEVIDEO_HOME=%PROJECT_ROOT%"
set "FREEVIDEO_BOOTSTRAP_ROOT=%PROJECT_ROOT%\.freevideo\bootstrap"
set "FREEVIDEO_OUTPUT=%PROJECT_ROOT%\output"
set "HF_HOME=%PROJECT_ROOT%\cache\huggingface"
set "HUGGINGFACE_HUB_CACHE=%PROJECT_ROOT%\cache\huggingface\hub"
set "TORCH_HOME=%PROJECT_ROOT%\cache\torch"
set "TRITON_CACHE_DIR=%PROJECT_ROOT%\cache\triton"
set "MODELSCOPE_CACHE=%PROJECT_ROOT%\cache\modelscope"
set "PIP_CACHE_DIR=%PROJECT_ROOT%\cache\pip"
set "UV_CACHE_DIR=%PROJECT_ROOT%\cache\uv"
set "TEMP=%PROJECT_ROOT%\tmp"
set "TMP=%PROJECT_ROOT%\tmp"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

:: Ensure local cache and tmp folders exist
if not exist "%PROJECT_ROOT%\tmp" mkdir "%PROJECT_ROOT%\tmp"
if not exist "%PROJECT_ROOT%\cache" mkdir "%PROJECT_ROOT%\cache"
if not exist "%PROJECT_ROOT%\output" mkdir "%PROJECT_ROOT%\output"

:: Add dotnet to PATH
set "PATH=C:\Program Files\dotnet;%PATH%"

echo ======================================================================
echo   FreeVideo + Qwen-Image 2.1 in SwarmUI (NVIDIA GeForce RTX 5080)
echo ======================================================================
echo   Project Root   : %PROJECT_ROOT%
echo   Isolated Cache : %PROJECT_ROOT%\cache
echo   Temp Directory : %PROJECT_ROOT%\tmp
echo   Web Interface  : http://localhost:7801
echo ======================================================================
echo.

: Launch browser only AFTER ComfyUI on port 7821 is fully started
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%PROJECT_ROOT%\tools\wait_comfy.ps1"

cd /d "%PROJECT_ROOT%\SwarmUI"
call launch-windows.bat --launch_mode none %*

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] SwarmUI stopped with exit code %ERRORLEVEL%
    pause
)
