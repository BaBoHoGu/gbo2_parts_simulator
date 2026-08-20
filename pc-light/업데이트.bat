@echo off
chcp 65001 > nul
cd /d "%~dp0"
rem GitHub 에서 최신 데이터를 받아 교체합니다 (개발자가 올려둔 완성 데이터).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0업데이트.ps1"
echo.
pause
