@echo off
title Qwen-Image-2.1 Model Downloader
cd /d "%~dp0"
echo ==============================================================
echo Downloading Qwen-Image-2.1 Uncensored Quantized Models...
echo ==============================================================
.\SwarmUI\dlbackend\comfy\ComfyUI\venv\Scripts\python.exe download_models.py
pause
