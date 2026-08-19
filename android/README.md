# GBO2 시뮬레이터 — 안드로이드 APK 래퍼

오프라인 단일 HTML(`dist/gbo2-simulator.html`)을 **WebView 하나로 감싼** 안드로이드 앱입니다.
네이티브 기능·권한을 쓰지 않으며(인터넷 권한도 없음), 완전 오프라인으로 동작합니다.

## 갤러리(사진첩) 오염 없음

이미지는 HTML 안에 **data URI 로 인라인**되어 있어 저장소에 이미지 *파일*이 생기지 않습니다.
APK 의 `assets/` 는 APK 내부에 들어가므로 안드로이드 **미디어 스캐너(갤러리)가 스캔하지 않습니다.**
→ 설치해도 **사진첩이 지저분해지지 않습니다.** 저장 데이터(구성·즐겨찾기)는 앱 전용 영역(localStorage)에 보관됩니다.

## 구조

```
android/
  settings.gradle · build.gradle · gradle.properties · local.properties
  app/
    build.gradle
    src/main/
      AndroidManifest.xml
      java/com/gbo2/sim/MainActivity.java   ← WebView 로더 + 뒤로가기 처리
      assets/index.html                     ← dist 복사본 (빌드 시 갱신, git 제외)
```

## 업데이트/재빌드 (자동 — 권장)

프로젝트 루트에서 **`.\update.ps1`** 한 번이면 데이터 갱신 → dist 재빌드 → **APK까지 자동 생성**됩니다.
호스팅이 없어도 "PC 업데이트 = 최신 APK 생성"이 되고, 폰엔 나온 APK만 덮어쓰기 설치하면 됩니다.

- `.\update.ps1` — 데이터 수신 + dist + APK
- `.\update.ps1 -Rebuild` — 인터넷 없이 dist + APK 만
- `.\update.ps1 -NoApk` — 웹(dist)만, APK 건너뜀
- APK 버전은 빌드 날짜로 자동 부여(versionCode=yyyyMMdd, versionName=yyyy-MM-dd).
- JDK(또는 Android Studio JBR)가 없으면 APK 는 건너뛰고 웹만 갱신됩니다.

결과 APK: `dist/gbo2-simulator-debug.apk` (원본: `android/app/build/outputs/apk/debug/app-debug.apk`)

## 수동 빌드

```
node tools/build.js
cp dist/gbo2-simulator.html android/app/src/main/assets/index.html
cd android
./gradlew assembleDebug     # Windows: gradlew.bat assembleDebug
```
필요 환경: `JAVA_HOME`(JDK 17+), SDK(`android/local.properties` 의 sdk.dir, platform-36).

## 설치

- APK 를 폰으로 옮겨 실행 → "출처를 알 수 없는 앱 설치" 허용 후 설치(디버그 빌드).
- Play 스토어 배포용 서명 APK 가 필요하면 keystore 로 릴리스 서명이 필요합니다.

## 참고

- 16MB 단일 HTML 이라 첫 실행 시 로딩이 잠깐 걸릴 수 있습니다(거대 base64 파싱). 필요하면 APK 용으로 이미지를 실제 파일로 분리해 가속할 수 있습니다.
- 모바일 레이아웃은 `src/style.css` 의 `@media (max-width: …)` 규칙으로 대응합니다(데스크톱 앱은 영향 없음).
