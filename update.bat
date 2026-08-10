@echo off
rem GBO2 커스텀 파츠 시뮬레이터 - 업데이트 (더블클릭)
rem   gbo2.jp / 위키에서 새 기체·파츠·밸런스를 받아 다시 빌드합니다.
rem   감지만 하려면(반영 안 함) 명령창에서:  update.bat -Check
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" %*
