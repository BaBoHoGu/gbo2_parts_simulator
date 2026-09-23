@echo off
rem GBO2 커스텀 파츠 시뮬레이터 - 배포본 만들기 + 폰 자동갱신 게시 (더블클릭, 개발용)
rem   데이터 갱신 ~ dist 재빌드 ~ APK ~ 배포 ZIP(모바일-앱.apk) ~ GitHub OTA 게시 까지 한 방에.
rem   ※ rem 줄에도 > 를 쓰지 말 것. cmd 는 주석에서도 리다이렉트로 읽어,
rem      「-> GitHub」 이 「> GitHub」 이 되어 빈 파일을 만들고 줄이 거기서 잘린다.
rem      실제로 0바이트 파일 GitHub 이 생겨 저장소에 커밋까지 됐다(2026-09-23 확인).
rem   결과: release\...zip (최상위 모바일-앱.apk) + 폰 앱이 실행 시 최신 데이터 자동 수신.
rem   * APK 는 Android SDK/JDK, OTA 게시는 gh CLI 로그인이 있는 개발 PC에서만 동작합니다.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" -Release -Publish %*
