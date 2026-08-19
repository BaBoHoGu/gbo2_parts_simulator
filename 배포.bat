@echo off
rem GBO2 커스텀 파츠 시뮬레이터 - 배포본 만들기 + 폰 자동갱신 게시 (더블클릭, 개발용)
rem   데이터 갱신 -> dist 재빌드 -> APK -> 배포 ZIP(모바일-앱.apk) -> GitHub OTA 게시 까지 한 방에.
rem   결과: release\...zip (최상위 모바일-앱.apk) + 폰 앱이 실행 시 최신 데이터 자동 수신.
rem   * APK 는 Android SDK/JDK, OTA 게시는 gh CLI 로그인이 있는 개발 PC에서만 동작합니다.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" -Release -Publish %*
