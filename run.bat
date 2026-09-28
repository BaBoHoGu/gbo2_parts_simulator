@echo off
rem 코드페이지를 여기서 먼저 잡는다 — PowerShell 안에서 바꾸면 창이 이미 열린 뒤라
rem 콘솔이 줄을 다시 그릴 때 한글이 두 번씩 찍힌다(사용자용 bat 은 원래 이렇게 한다).
chcp 65001 > nul
rem GBO2 커스텀 파츠 시뮬레이터 - 실행 (더블클릭)
rem   업데이트를 확인해 변경이 있으면 반영한 뒤 시뮬레이터를 자동으로 엽니다.
rem   최근 확인했으면 그냥 바로 열립니다.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
