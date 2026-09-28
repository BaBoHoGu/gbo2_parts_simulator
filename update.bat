@echo off
rem 코드페이지를 여기서 먼저 잡는다 — PowerShell 안에서 바꾸면 창이 이미 열린 뒤라
rem 콘솔이 줄을 다시 그릴 때 한글이 두 번씩 찍힌다(사용자용 bat 은 원래 이렇게 한다).
chcp 65001 > nul
rem GBO2 커스텀 파츠 시뮬레이터 - 업데이트 (더블클릭)
rem   gbo2.jp / 위키에서 새 기체·파츠·밸런스를 받아 다시 빌드합니다.
rem   감지만 하려면(반영 안 함) 명령창에서:  update.bat -Check
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" %*
