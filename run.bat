@echo off
rem GBO2 커스텀 파츠 시뮬레이터 - 실행 (더블클릭)
rem   업데이트를 확인해 변경이 있으면 반영한 뒤 시뮬레이터를 자동으로 엽니다.
rem   최근 확인했으면 그냥 바로 열립니다.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
