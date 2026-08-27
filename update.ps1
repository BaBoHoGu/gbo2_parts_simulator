# GBO2 커스텀 파츠 시뮬레이터 - 자동 업데이트
#
#   .\update.ps1            신규/변경 기체·파츠·밸런스 패치를 감지해 받고 재빌드 + APK 까지 자동
#   .\update.ps1 -Check     감지만 하고 무엇이 바뀌는지 리포트 (반영 안 함)
#   .\update.ps1 -Rebuild   인터넷 없이 dist + APK 만 다시 만든다 (오버라이드 패치 적용용)
#   .\update.ps1 -NoApk     APK 빌드를 건너뛰고 웹(dist)만 갱신
#   .\update.ps1 -Release   데이터+dist+APK 에 더해 배포 ZIP(모바일-앱.apk 동봉)까지 한 방에 생성
#   .\update.ps1 -Publish   폰 OTA(data) + PC 배포본 ZIP 을 GitHub 에 올려 링크로 배포
#
# gbo2.jp 최신 데이터·일본 위키(밸런스 패치 목록 포함)에서 변경분만 가져와
# dist/gbo2-simulator.html 을 다시 만들고, 이어서 안드로이드 APK(dist/gbo2-simulator-debug.apk)
# 도 같은 데이터로 자동 빌드합니다. node 가 있어야 하며, APK 는 JDK(또는 Android Studio JBR)가
# 있을 때만 만들어집니다(없으면 웹만 갱신하고 건너뜁니다).
param([switch]$Check, [switch]$Rebuild, [switch]$NoApk, [switch]$Release, [switch]$Publish)

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
  # versionName 은 OTA 기준값이기도 하다 — 분 단위 타임스탬프라 같은 날 재배포도 폰에 반영된다.
  $vname = if ($script:VerStamp) { $script:VerStamp } else { Get-Date -Format 'yyyy-MM-dd-HHmm' }
  Write-Host "`n안드로이드 APK 빌드 중… (버전 $vname)" -ForegroundColor Cyan
  $env:JAVA_HOME = $jh
  Push-Location $androidDir
  $ok = $false
  # gradle 은 진행/경고를 stderr 로 내보내는데, $ErrorActionPreference='Stop' 이면 그게 예외로 잡혀
  # 정상 빌드도 실패로 오인된다. 이 구간만 Continue 로 바꾸고 실제 성공 여부는 $LASTEXITCODE 로 판정.
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $gradlew 'assembleDebug' "-Pvcode=$vcode" "-Pvname=$vname" '--console=plain' '-q'
    $ok = ($LASTEXITCODE -eq 0)
  } catch {
    $script:ApkFailed = $true; Write-Host "APK 빌드 중 예외: $_" -ForegroundColor Red
  } finally { $ErrorActionPreference = $prevEap; Pop-Location }

  if (-not $ok) { $script:ApkFailed = $true; Write-Host 'APK 빌드에 실패했습니다 (위 로그 확인). 웹 업데이트는 정상입니다.' -ForegroundColor Red; return }

  $apk = Join-Path $androidDir 'app\build\outputs\apk\debug\app-debug.apk'
  if (Test-Path $apk) {
    Copy-Item $apk (Join-Path $PSScriptRoot 'dist\gbo2-simulator-debug.apk') -Force
    Write-Host "APK 완료: dist\gbo2-simulator-debug.apk (버전 $vname) — 폰에 덮어쓰기 설치하세요." -ForegroundColor Green
  } else {
    $script:ApkFailed = $true; Write-Host 'APK 산출물을 찾지 못했습니다.' -ForegroundColor Red
  }
}

# 최신 데이터(version.json + gbo2-simulator.html)를 GitHub Release 'data' 에 올려
# 폰 앱이 자동으로 받아가게 한다(OTA). gh CLI 로그인이 돼 있어야 한다.
$OtaRepo = 'BaBoHoGu/gbo2_parts_simulator'

# gh CLI 경로 + 로그인 여부 확인. 안 되면 $null 반환(호출부에서 건너뛴다).
function Resolve-Gh {
  $ghCmd = Get-Command gh -ErrorAction SilentlyContinue
  $gh = if ($ghCmd) { $ghCmd.Source } else { 'C:\Program Files\GitHub CLI\gh.exe' }
  if (-not (Test-Path $gh)) { Write-Host 'gh CLI 를 찾지 못했습니다 (winget install GitHub.cli).' -ForegroundColor Yellow; return $null }
  & $gh auth status 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Host 'gh 로그인이 안 돼 있습니다 (gh auth login).' -ForegroundColor Yellow; return $null }
  return $gh
}

function Publish-Ota {
  $html = Join-Path $PSScriptRoot 'dist\gbo2-simulator.html'
  if (-not (Test-Path $html)) { Write-Host 'dist\gbo2-simulator.html 이 없어 OTA 게시를 건너뜁니다.' -ForegroundColor Yellow; return }
  $gh = Resolve-Gh
  if (-not $gh) { Write-Host '→ OTA 게시를 건너뜁니다.' -ForegroundColor Yellow; return }

  # version.json (데이터 날짜) 생성 — 앱의 JSON 파서가 BOM 에 걸리지 않게 BOM 없는 UTF-8 로 쓴다
  $vj = Join-Path $PSScriptRoot 'dist\version.json'
  $stamp = if ($script:VerStamp) { $script:VerStamp } else { Get-Date -Format 'yyyy-MM-dd-HHmm' }
  [System.IO.File]::WriteAllText($vj, ('{"date":"' + $stamp + '"}'), (New-Object System.Text.UTF8Encoding($false)))

  Write-Host "`nGitHub OTA 게시 중… ($OtaRepo / data)" -ForegroundColor Cyan
  $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  & $gh release upload data $vj $html --repo $OtaRepo --clobber
  $up = $LASTEXITCODE
  $ErrorActionPreference = $prevEap
  if ($up -eq 0) {
    Write-Host "OTA 게시 완료 — 폰 앱이 실행 시 자동으로 최신 데이터를 받습니다." -ForegroundColor Green
  } else {
    Write-Host "OTA 게시 실패 (위 로그 확인). release 'data' 채널이 있는지 확인하세요." -ForegroundColor Red
  }
}

# PC 배포본(자기업데이트 ZIP)을 GitHub Releases 'pc' 에 고정 이름으로 올려 다운로드 링크를 준다.
# (ZIP 이 50MB 를 넘어 직접 공유가 어려우므로 링크로 배포 — Releases 는 2GB 까지 허용)
function Publish-Pc {
  $relDir = Join-Path $PSScriptRoot 'release'
  # 완전판: gbo2-simulator_* / 경량판: gbo2-simulator-light_* (고정이름 -pc*.zip 은 대시라 안 걸림)
  $full  = Get-ChildItem $relDir -Filter 'gbo2-simulator_*.zip' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $light = Get-ChildItem $relDir -Filter 'gbo2-simulator-light_*.zip' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $full -and -not $light) { Write-Host '배포 ZIP 이 없어 PC 링크 게시를 건너뜁니다 (-Release 로 먼저 생성).' -ForegroundColor Yellow; return }
  $gh = Resolve-Gh
  if (-not $gh) { Write-Host '→ PC 배포본 게시를 건너뜁니다.' -ForegroundColor Yellow; return }

  $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  & $gh release view pc --repo $OtaRepo 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { & $gh release create pc --repo $OtaRepo --title 'PC 버전 (최신)' --notes 'PC용 오프라인 시뮬레이터. 경량판(권장, GitHub 데이터)·완전판(오프라인 자립).' | Out-Null }

  foreach ($item in @(
      @{ zip = $light; name = 'gbo2-simulator-pc.zip';      label = '경량판' },
      @{ zip = $full;  name = 'gbo2-simulator-pc-full.zip'; label = '완전판' })) {
    if (-not $item.zip) { continue }
    $named = Join-Path $relDir $item.name
    Copy-Item $item.zip.FullName $named -Force
    Write-Host "`nGitHub $($item.label) 업로드 중… ($([math]::Round($item.zip.Length/1MB,1)) MB)" -ForegroundColor Cyan
    & $gh release upload pc $named --repo $OtaRepo --clobber
    if ($LASTEXITCODE -eq 0) { Write-Host "  $($item.label) 링크: https://github.com/$OtaRepo/releases/download/pc/$($item.name)" -ForegroundColor Green }
    else { Write-Host "  $($item.label) 업로드 실패." -ForegroundColor Red }
  }
  # 모바일 APK 도 직접 링크로 (ASCII 이름으로 URL 깔끔하게)
  $apk = Join-Path $PSScriptRoot 'dist\gbo2-simulator-debug.apk'
  if (Test-Path $apk) {
    $apkNamed = Join-Path $relDir 'gbo2-simulator.apk'
    Copy-Item $apk $apkNamed -Force
    Write-Host "`nGitHub 모바일 APK 업로드 중… ($([math]::Round((Get-Item $apk).Length/1MB,1)) MB)" -ForegroundColor Cyan
    & $gh release upload pc $apkNamed --repo $OtaRepo --clobber
    if ($LASTEXITCODE -eq 0) { Write-Host "  APK 링크: https://github.com/$OtaRepo/releases/download/pc/gbo2-simulator.apk" -ForegroundColor Green }
    else { Write-Host '  APK 업로드 실패.' -ForegroundColor Red }
  }
  $ErrorActionPreference = $prevEap
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
  # 이번 빌드의 버전 스탬프(분 단위) — APK versionName 과 OTA version.json 이 같은 값을 쓰게 한다.
  $script:VerStamp = Get-Date -Format 'yyyy-MM-dd-HHmm'
  Write-Host "`n최신 결과물: dist\gbo2-simulator.html (브라우저에서 새로고침 하세요)" -ForegroundColor Green
  # 데이터가 갱신됐으면 APK 도 함께 최신화 (‑NoApk 로 건너뛸 수 있음)
  if (-not $NoApk) { Build-Apk }
  # APK 빌드가 실패했는데 그대로 진행하면, 배포본에 '지난번 APK' 가 동봉되고 GitHub 에도
  # 그게 올라간다. 실제로 그렇게 한 번 나갔다 - 실패하면 여기서 멈춘다.
  if ($script:ApkFailed -and ($Release -or $Publish)) {
    Write-Host "`nAPK 빌드가 실패해 배포를 중단합니다." -ForegroundColor Red
    Write-Host '  (그대로 두면 지난번 APK 가 배포본·GitHub 에 올라갑니다)' -ForegroundColor Yellow
    Write-Host '  APK 없이 웹만 배포하려면 -NoApk 를 붙여 실행하세요.' -ForegroundColor Yellow
    Close-Window 1
  }
  # -Release: 배포 ZIP 을 완전판 + 경량판 두 가지로 생성 (모바일-앱.apk 동봉)
  if ($Release) {
    Write-Host "`n배포 패키지 생성 중… (완전판 + 경량판)" -ForegroundColor Cyan
    & $node (Join-Path $PSScriptRoot 'tools\build_release.js')
    if ($LASTEXITCODE -ne 0) { Write-Host '완전판 생성 실패 (위 로그 확인).' -ForegroundColor Red }
    & $node (Join-Path $PSScriptRoot 'tools\build_release.js') '--light' '--stamp' $script:VerStamp
    if ($LASTEXITCODE -ne 0) { Write-Host '경량판 생성 실패 (위 로그 확인).' -ForegroundColor Red }
  }
  # -Publish: 폰 자동 갱신용 데이터(OTA) + PC 배포본 ZIP 을 GitHub 에 올린다
  if ($Publish) { Publish-Ota; Publish-Pc }
}
Close-Window 0
