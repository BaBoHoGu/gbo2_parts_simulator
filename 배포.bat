@echo off
rem GBO2 커스텀 파츠 시뮬레이터 - 배포본 만들기 (더블클릭, 개발용)
rem   데이터 갱신 -> dist 재빌드 -> 안드로이드 APK -> 배포 ZIP(모바일-앱.apk 동봉)까지 한 방에.
rem   결과: release\gbo2-simulator_<날짜>_<커밋>.zip  (최상위에 모바일-앱.apk 포함)
rem   * Android SDK/JDK(안드로이드 스튜디오) 가 있는 개발 PC에서만 APK 가 만들어집니다.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" -Release %*
