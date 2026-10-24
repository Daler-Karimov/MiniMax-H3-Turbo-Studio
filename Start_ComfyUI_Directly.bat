@echo off
title FreeVideo / ComfyUI Direct [NVIDIA RTX 5080]

set "PROJECT_ROOT=%~dp0"
if "%PROJECT_ROOT:~-1%"=="\" set "PROJECT_ROOT=%PROJECT_ROOT:~0,-1%"

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

if not exist "%PROJECT_ROOT%\tmp" mkdir "%PROJECT_ROOT%\tmp"
if not exist "%PROJECT_ROOT%\cache" mkdir "%PROJECT_ROOT%\cache"
if not exist "%PROJECT_ROOT%\output" mkdir "%PROJECT_ROOT%\output"

set "COMFY_DIR=%PROJECT_ROOT%\SwarmUI\dlbackend\comfy\ComfyUI"

echo ======================================================================
echo             Starting ComfyUI Backend Directly (RTX 5080)
echo ======================================================================
echo URL: http://127.0.0.1:8188
echo Browser will open automatically.
echo Press Ctrl+C in this console to stop.
echo ======================================================================
echo.

cd /d "%COMFY_DIR%"
"%COMFY_DIR%\venv\Scripts\python.exe" main.py --auto-launch --preview-method auto

if errorlevel 1 (
    echo.
    echo [ERROR] ComfyUI exited with error.
    pause
)