# GBO2 커스텀 파츠 시뮬레이터 - 자동 업데이트
#
#   .\update.ps1            신규/변경 기체·파츠·밸런스 패치를 감지해 받고 재빌드 + APK 까지 자동
#   .\update.ps1 -Check     감지만 하고 무엇이 바뀌는지 리포트 (반영 안 함)
#   .\update.ps1 -Rebuild   인터넷 없이 dist + APK 만 다시 만든다 (오버라이드 패치 적용용)
#   .\update.ps1 -NoApk     APK 빌드를 건너뛰고 웹(dist)만 갱신
#
# gbo2.jp 최신 데이터·일본 위키(밸런스 패치 목록 포함)에서 변경분만 가져와
# dist/gbo2-simulator.html 을 다시 만들고, 이어서 안드로이드 APK(dist/gbo2-simulator-debug.apk)
# 도 같은 데이터로 자동 빌드합니다. node 가 있어야 하며, APK 는 JDK(또는 Android Studio JBR)가
# 있을 때만 만들어집니다(없으면 웹만 갱신하고 건너뜁니다).
param([switch]$Check, [switch]$Rebuild, [switch]$NoApk)

$ErrorActionPreference = 'Stop'
# 한글이 깨지지 않도록 콘솔 출력을 UTF-8 로 맞춘다.
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
  chcp 65001 > $null 2>&1
} catch {}
Set-Location -Path $PSScriptRoot

# 더블클릭·"PowerShell에서 실행" 으로 열면 끝나는 순간 창이 닫혀 결과를 못 본다.
# 그래서 마지막에 Enter 를 기다렸다가 닫는다. (비대화형 실행 시에는 그냥 지나간다)
function Close-Window([int]$code) {
  Write-Host ''
  try { Read-Host '끝났습니다 — Enter 키를 누르면 이 창이 닫힙니다' | Out-Null } catch {}
  exit $code
}

# dist 재빌드 후, 같은 데이터로 안드로이드 APK 도 자동 빌드한다.
# (호스팅 없이도 "PC 업데이트 = 최신 APK 생성" — 폰엔 그 APK 만 설치)
# 안드로이드 도구(JDK/gradlew)가 없으면 경고만 하고 건너뛴다(웹 업데이트는 그대로 성공).
function Build-Apk {
  $androidDir = Join-Path $PSScriptRoot 'android'
  $gradlew = Join-Path $androidDir 'gradlew.bat'
  $distHtml = Join-Path $PSScriptRoot 'dist\gbo2-simulator.html'
  if (-not (Test-Path $gradlew)) {
    Write-Host 'APK 빌드 도구(android 프로젝트)가 없어 APK 는 만들지 않습니다.' -ForegroundColor DarkGray
    Write-Host '  (배포본에는 미리 빌드된 「모바일-앱.apk」 가 최상위에 동봉돼 있습니다 — 그걸 폰에 설치하세요)' -ForegroundColor DarkGray
    return
  }
  if (-not (Test-Path $distHtml)) { Write-Host 'dist\gbo2-simulator.html 이 없어 APK 빌드를 건너뜁니다.' -ForegroundColor Yellow; return }

  # JAVA_HOME 결정: 환경변수 → Android Studio 내장 JBR
  $jh = $env:JAVA_HOME
  if (-not $jh -or -not (Test-Path (Join-Path $jh 'bin\java.exe'))) {
    $jbr = 'C:\Program Files\Android\Android Studio\jbr'
    if (Test-Path (Join-Path $jbr 'bin\java.exe')) { $jh = $jbr } else { $jh = $null }
  }
  if (-not $jh) {
    Write-Host 'JDK(JAVA_HOME 또는 Android Studio JBR)를 찾지 못해 APK 빌드를 건너뜁니다.' -ForegroundColor Yellow
    Write-Host '웹 업데이트는 완료됐습니다. APK 가 필요하면 JDK 설치 후 다시 실행하세요.' -ForegroundColor Yellow
    return
  }

  # 최신 dist 를 assets 로 복사
  Copy-Item $distHtml (Join-Path $androidDir 'app\src\main\assets\index.html') -Force

  $vcode = Get-Date -Format 'yyyyMMdd'
  $vname = Get-Date -Format 'yyyy-MM-dd'
  Write-Host "`n안드로이드 APK 빌드 중… (버전 $vname)" -ForegroundColor Cyan
  $env:JAVA_HOME = $jh
  Push-Location $androidDir
  $ok = $false
  try {
    & $gradlew 'assembleDebug' "-Pvcode=$vcode" "-Pvname=$vname" '--console=plain' '-q'
    $ok = ($LASTEXITCODE -eq 0)
  } catch {
    Write-Host "APK 빌드 중 예외: $_" -ForegroundColor Red
  } finally { Pop-Location }

  if (-not $ok) { Write-Host 'APK 빌드에 실패했습니다 (위 로그 확인). 웹 업데이트는 정상입니다.' -ForegroundColor Red; return }

  $apk = Join-Path $androidDir 'app\build\outputs\apk\debug\app-debug.apk'
  if (Test-Path $apk) {
    Copy-Item $apk (Join-Path $PSScriptRoot 'dist\gbo2-simulator-debug.apk') -Force
    Write-Host "APK 완료: dist\gbo2-simulator-debug.apk (버전 $vname) — 폰에 덮어쓰기 설치하세요." -ForegroundColor Green
  } else {
    Write-Host 'APK 산출물을 찾지 못했습니다.' -ForegroundColor Red
  }
}

# node 결정 — 폴더에 동봉한 node\node.exe 를 먼저 쓰고, 없으면 시스템 node 를 쓴다.
$bundled = Join-Path $PSScriptRoot 'node\node.exe'
if (Test-Path $bundled) {
  $node = $bundled
} else {
  $sys = Get-Command node -ErrorAction SilentlyContinue
  if (-not $sys) {
    Write-Host "node(Node.js)를 찾을 수 없습니다." -ForegroundColor Red
    Write-Host "이 폴더의 node\node.exe 가 지워졌거나, 시스템에 Node.js 가 설치돼 있지 않습니다." -ForegroundColor Red
    Write-Host "https://nodejs.org 에서 설치 후 다시 실행하세요." -ForegroundColor Yellow
    Close-Window 1
  }
  $node = $sys.Source
}

# -Rebuild: 데이터 재수신 없이 build.js 만 실행 (psycommu.override.json 등 오버라이드 패치 적용)
if ($Rebuild) {
  $nodeArgs = @('tools/build.js')
} else {
  $nodeArgs = @('tools/update.js')
  if ($Check) { $nodeArgs += '--check' }
}

$code = 0
try {
  & $node @nodeArgs
  $code = $LASTEXITCODE
} catch {
  Write-Host "`n실행 중 예외가 발생했습니다: $_" -ForegroundColor Red
  Close-Window 1
}

if ($code -ne 0) {
  Write-Host "`n업데이트 중 오류가 발생했습니다 (종료 코드 $code)." -ForegroundColor Red
  Close-Window $code
}

if (-not $Check) {
  Write-Host "`n최신 결과물: dist\gbo2-simulator.html (브라우저에서 새로고침 하세요)" -ForegroundColor Green
  # 데이터가 갱신됐으면 APK 도 함께 최신화 (‑NoApk 로 건너뛸 수 있음)
  if (-not $NoApk) { Build-Apk }
}
Close-Window 0
