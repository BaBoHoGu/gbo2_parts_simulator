# GBO2 커스텀 파츠 시뮬레이터 - 자동 업데이트
#
#   .\update.ps1            신규/변경 기체·파츠·밸런스 패치를 감지해 받고 재빌드 + APK 까지 자동
#   .\update.ps1 -Check     감지만 하고 무엇이 바뀌는지 리포트 (반영 안 함)
#   .\update.ps1 -Rebuild   인터넷 없이 dist + APK 만 다시 만든다 (오버라이드 패치 적용용)
#   .\update.ps1 -NoApk     APK 빌드를 건너뛰고 웹(dist)만 갱신
#   .\update.ps1 -NoUiCheck 배포 전 UI 회귀 점검을 건너뛴다(권장하지 않음)
#   .\update.ps1 -NoSmoke   배포 전 데이터·번역 점검을 건너뛴다(권장하지 않음)
#   .\update.ps1 -Release   데이터+dist+APK 에 더해 배포 ZIP(모바일-앱.apk 동봉)까지 한 방에 생성
#   .\update.ps1 -Publish   폰 OTA(data) + PC 배포본 ZIP 을 GitHub 에 올려 링크로 배포
#   .\update.ps1 -SetDictKey  공유 갤러리 사전 계정을 이 PC 에 등록 (최초 1회, 이후 자동)
#   .\update.ps1 -SetSiteKey  Cloudflare 배포 자격 증명을 이 PC 에 등록 (최초 1회, 이후 자동)
#   .\update.ps1 -RulesPublished  Firebase 보안 규칙을 콘솔에 게시했다고 기록 (경고를 끈다)
#
# gbo2.jp 최신 데이터·일본 위키(밸런스 패치 목록 포함)에서 변경분만 가져와
# dist/gbo2-simulator.html 을 다시 만들고, 이어서 안드로이드 APK(dist/gbo2-simulator-debug.apk)
# 도 같은 데이터로 자동 빌드합니다. node 가 있어야 하며, APK 는 JDK(또는 Android Studio JBR)가
# 있을 때만 만들어집니다(없으면 웹만 갱신하고 건너뜁니다).
param([switch]$Check, [switch]$Rebuild, [switch]$NoApk, [switch]$NoUiCheck, [switch]$NoSmoke, [switch]$Release, [switch]$Publish, [switch]$SetDictKey, [switch]$SetSiteKey, [switch]$RulesPublished)

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
  # 더블클릭으로 연 창은 결과를 볼 새도 없이 닫히면 곤란해 Enter 를 기다린다.
  # 다만 비대화형(스크립트·CI·백그라운드 실행)에서는 아무도 Enter 를 못 눌러
  # 업로드까지 다 끝난 배포가 '안 끝난 것'처럼 매달려 있었다. 그때는 그냥 끝낸다.
  # 판정 기준은 stdin 이 콘솔인가다. UserInteractive 는 도구·서비스에서도 true 라 소용없고,
  # 실제 증상은 '입력이 리다이렉트돼 Read-Host 가 끝나지 않는 것'이었다.
  $piped = $true
  try { $piped = [Console]::IsInputRedirected } catch { $piped = $true }
  $interactive = (-not $piped) -and (-not $env:CI) -and (-not $env:GBO2_NONINTERACTIVE)
  if ($interactive) {
    try { Read-Host '끝났습니다 — Enter 키를 누르면 이 창이 닫힙니다' | Out-Null } catch {}
  } else {
    Write-Host '끝났습니다.'
  }
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

# 배포용 자격 증명 보관함. 저장소가 공개라 파일에 못 넣고, DPAPI 로 이 PC·이 Windows
# 계정에서만 풀리게 둔다. 사전(dict)·사이트(Cloudflare) 둘 다 여기를 쓴다.
# **두 블록보다 먼저 정의해야 한다** — 아래에서 정의하면 위 블록이 빈 경로를 잡는다.
$CredDir = Join-Path $env:LOCALAPPDATA 'gbo2-sim'
# 마지막으로 '게시했다' 고 확인한 보안 규칙의 해시. 서버의 규칙은 관리자 권한 없이 읽을 수
# 없으므로 **파일이 바뀌었는지만** 본다 — 확인이 아니라 알림이다.
$RulesSha = Join-Path $CredDir 'rules.sha'

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
  if ($up -eq 0) {
    # 릴리스 노트에 스탬프를 남긴다. PC 판은 file:// 라 릴리스 '자산' 을 CORS 로 못 읽지만
    # api.github.com 은 통과하고, 그 응답에 이 노트(body)가 들어 있다. 자산 업로드 시각
    # (updated_at)은 날짜까지만 쓸 수 있어 같은 날 재배포를 못 잡았다.
    # (아직 Continue 구간이다 — gh 가 stderr 로 뭘 내보내도 배포가 죽지 않게)
    & $gh release edit data --repo $OtaRepo --notes "데이터 $stamp" | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Host '  릴리스 노트에 스탬프를 남기지 못했습니다 — PC 판이 같은 날 재배포를 못 잡습니다.' -ForegroundColor Yellow
    }
    $ErrorActionPreference = $prevEap
    Write-Host "OTA 게시 완료 ($stamp) — 폰 앱이 실행 시 자동으로 최신 데이터를 받습니다." -ForegroundColor Green
  } else {
    $ErrorActionPreference = $prevEap
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

# ── 사이트 게시 (Cloudflare Pages) ──────────────────────────────────────────
# 왜 여기서 올리나: Git 연동으로 두면 Cloudflare 가 저장소를 받아 **다시 빌드**한다.
# 그러면 ui_check 로 검사한 그 파일이 아니라 새로 만든 파일이 나가고, 빌드 스탬프도
# 달라져 앱이 아는 자기 버전과 배포된 버전이 어긋난다. 그래서 검사를 통과한
# dist\web 을 직접 올린다(Direct Upload).
#
# 왜 GitHub Pages 가 아닌가: 실측 결과 GitHub 이 한국으로 79 KB/s 였다(1MB 에 13초).
# 같은 순간 Cloudflare 는 10,000 KB/s 였다. 회선이 아니라 GitHub 쪽 경로 문제다.
# 옛 주소는 지우지 않고 새 주소로 넘겨보내는 페이지만 남긴다 — 그건 몇 KB 라 느려도 괜찮다.
$SiteProject = 'gbo2-parts'
$SiteUrl     = "https://$SiteProject.pages.dev"
$SiteCred    = Join-Path $CredDir 'site.cred'

function Set-SiteKey {
  Write-Host 'Cloudflare 배포 자격 증명을 이 PC 에 등록합니다.' -ForegroundColor Cyan
  Write-Host '  Account ID : Workers & Pages 화면 오른쪽에 있는 32자리' -ForegroundColor DarkGray
  Write-Host '  API 토큰   : My Profile > API Tokens > Cloudflare Pages: Edit 권한' -ForegroundColor DarkGray
  $acct = (Read-Host 'Account ID').Trim()
  if (-not $acct) { Write-Host '취소했습니다.' -ForegroundColor Yellow; return }
  $tok = Read-Host 'API 토큰' -AsSecureString
  # 길이를 먼저 본다. 콘솔에 붙여넣기가 안 먹어 한두 글자만 들어가는 일이 실제로 있었는데,
  # -AsSecureString 은 화면에 아무것도 안 보여 눈치챌 수가 없다. 그대로 저장하면
  # 다음 배포에서 엉뚱한 오류(fetch failed)로 나타나 원인을 찾기 어렵다.
  $b0 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($tok)
  try { $len = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b0).Length }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b0) }
  if ($len -lt 20) {
    Write-Host "입력된 토큰이 $len 글자입니다 — Cloudflare 토큰은 40자 안팎입니다." -ForegroundColor Red
    Write-Host '  붙여넣기가 안 먹었을 수 있습니다. 창을 우클릭하거나 Ctrl+V 로 붙인 뒤' -ForegroundColor Yellow
    Write-Host '  Enter 를 누르세요 (입력해도 화면에는 아무것도 안 보이는 게 정상입니다).' -ForegroundColor Yellow
    Write-Host '  저장하지 않았습니다. 다시 실행해 주세요.' -ForegroundColor Yellow
    return
  }
  New-Item -ItemType Directory -Force $CredDir | Out-Null
  # DPAPI — 이 PC·이 Windows 계정에서만 풀린다. 저장소가 공개라 파일에 못 넣는다.
  Set-Content -Path $SiteCred -Encoding utf8 -Value @($acct, (ConvertFrom-SecureString $tok))
  Write-Host "등록했습니다 → $SiteCred" -ForegroundColor Green

  # 바로 확인한다 — 오타를 다음 배포 때 알게 되면 늦다.
  if (-not (Use-SiteCred)) { return }
  $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $list = & npx --no-install wrangler pages project list 2>&1 | Out-String
  $rc = $LASTEXITCODE
  if ($rc -ne 0) {
    $ErrorActionPreference = $prevEap; Clear-SiteCred
    Write-Host '등록은 됐지만 Cloudflare 에 접속하지 못했습니다 — 토큰 권한을 확인하세요.' -ForegroundColor Red
    Write-Host '  필요한 권한: Account · Cloudflare Pages · Edit' -ForegroundColor Yellow
    Write-Host ($list.Trim()) -ForegroundColor DarkGray
    return
  }
  # 대시보드에서 만들 필요 없다 — 없으면 여기서 만든다.
  # (지금 대시보드의 「Upload your static files」는 Pages 가 아니라 Workers 앱을 만든다)
  if ($list -notmatch [regex]::Escape($SiteProject)) {
    Write-Host "Pages 프로젝트 '$SiteProject' 를 만듭니다…" -ForegroundColor Cyan
    & npx --no-install wrangler pages project create $SiteProject --production-branch main
    if ($LASTEXITCODE -ne 0) {
      $ErrorActionPreference = $prevEap; Clear-SiteCred
      Write-Host '프로젝트를 만들지 못했습니다 (이름이 이미 쓰이고 있을 수 있습니다).' -ForegroundColor Red
      return
    }
  } else {
    Write-Host "Pages 프로젝트 '$SiteProject' 확인" -ForegroundColor DarkGray
  }
  $ErrorActionPreference = $prevEap
  Clear-SiteCred
  Write-Host "확인 완료 — 이제 -Publish 할 때마다 $SiteUrl 로 올라갑니다." -ForegroundColor Green
}

# 자격 증명을 프로세스 환경 변수로만 올린다. 실패해도 배포를 죽이지 않는다.
function Use-SiteCred {
  if (-not (Test-Path $SiteCred)) { return $false }
  # wrangler 가 되묻지 않게 CI 를 잠깐 세우는데, Close-Window 도 같은 값으로 '대화형인가'
  # 를 판정한다. 남겨 두면 배포가 끝나는 순간 창이 그냥 닫혀 로그를 못 본다 —
  # 경고만 남기고 진행하는 것들(gh 만료·사전 실패)을 볼 방법이 사라진다. 원래대로 되돌린다.
  $script:PrevCI = if (Test-Path Env:\CI) { $env:CI } else { $null }
  try {
    $lines = @(Get-Content $SiteCred)
    if ($lines.Count -lt 2) { throw '파일 형식이 올바르지 않습니다' }
    $env:CLOUDFLARE_ACCOUNT_ID = $lines[0]
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR((ConvertTo-SecureString $lines[1]))
    try { $env:CLOUDFLARE_API_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    $env:CI = '1'          # wrangler 가 물어보지 않게
    return $true
  } catch {
    Clear-SiteCred
    Write-Host "`nCloudflare 자격 증명을 읽지 못했습니다 — 사이트 게시를 건너뜁니다. ($($_.Exception.Message))" -ForegroundColor Yellow
    Write-Host '  .\update.ps1 -SetSiteKey 로 다시 등록하세요 (다른 PC 의 것은 풀리지 않습니다).' -ForegroundColor Yellow
    return $false
  }
}
function Clear-SiteCred {
  $env:CLOUDFLARE_API_TOKEN = $null
  if ($null -eq $script:PrevCI) { Remove-Item Env:\CI -ErrorAction SilentlyContinue }
  else { $env:CI = $script:PrevCI }
}

function Publish-Site {
  $web = Join-Path $PSScriptRoot 'dist\web'
  Write-Host "`n사이트 빌드 중… (이미지 분리판)" -ForegroundColor Cyan
  $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  & $node (Join-Path $PSScriptRoot 'tools\build.js') '--web' | Out-Null
  $rc = $LASTEXITCODE
  $ErrorActionPreference = $prevEap
  if ($rc -ne 0 -or -not (Test-Path (Join-Path $web 'index.html'))) {
    Write-Host '사이트 빌드에 실패해 게시를 건너뜁니다.' -ForegroundColor Yellow; return
  }

  # wrangler 는 배포용 도구라 package.json 에 넣지 않았다 — 배포본을 받은 사용자가
  # npm install 할 때 100MB 를 같이 받게 되기 때문이다. 이 PC 에만 깔아 둔다.
  if (-not (Test-Path (Join-Path $PSScriptRoot 'node_modules\wrangler'))) {
    Write-Host "`nwrangler 가 없어 사이트 게시를 건너뜁니다." -ForegroundColor Yellow
    Write-Host '  npm install --no-save wrangler   로 설치하세요 (배포 PC 에서만 필요합니다).' -ForegroundColor Yellow
    return
  }
  # 옛 GitHub Pages 게시에 쓰던 저장소가 남아 있으면 통째로 업로드된다(6.7MB).
  Remove-Item (Join-Path $web '.git') -Recurse -Force -ErrorAction SilentlyContinue

  if (-not (Test-Path $SiteCred)) {
    Write-Host "`nCloudflare 계정이 등록돼 있지 않아 사이트 게시를 건너뜁니다." -ForegroundColor Yellow
    Write-Host '  .\update.ps1 -SetSiteKey 로 한 번만 등록하면 이후로는 자동입니다.' -ForegroundColor Yellow
    return
  }
  if (-not (Use-SiteCred)) { return }

  Write-Host "사이트 게시 중… ($SiteProject)" -ForegroundColor Cyan
  $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  & npx --no-install wrangler pages deploy $web --project-name $SiteProject --branch main
  $ok = ($LASTEXITCODE -eq 0)
  $ErrorActionPreference = $prevEap
  Clear-SiteCred

  if ($ok) {
    Write-Host "사이트 게시 완료 — $SiteUrl" -ForegroundColor Green
    Write-Host '  (검색 제외 상태입니다 — 주소를 아는 사람만 들어옵니다)' -ForegroundColor DarkGray
    Publish-SiteRedirect
  } else {
    Write-Host '사이트 게시에 실패했습니다 (위 로그 확인). 나머지 배포는 정상입니다.' -ForegroundColor Red
  }
}

# 옛 GitHub Pages 주소를 새 주소로 넘겨보낸다. 이미 그 주소를 아는 사람이 있을 수 있어
# 지우지 않는다. 내용이 몇 KB 뿐이라 GitHub 이 느려도 문제가 안 된다.
function Publish-SiteRedirect {
  $dir = Join-Path $PSScriptRoot 'dist\site-redirect'
  New-Item -ItemType Directory -Force $dir | Out-Null
  $html = @"
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="robots" content="noindex, nofollow">
<meta http-equiv="refresh" content="0; url=$SiteUrl">
<title>GBO2 커스텀 파츠 시뮬레이터</title>
<style>body{background:#0f1013;color:#e8eaef;font-family:system-ui,sans-serif;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
a{color:#ffc93c}</style>
</head>
<body>
<div>
<p>주소가 바뀌었습니다.</p>
<p><a href="$SiteUrl">$SiteUrl</a></p>
<p style="color:#8a91a0;font-size:.9em">자동으로 넘어가지 않으면 위 주소를 눌러 주세요.</p>
</div>
<script>location.replace("$SiteUrl");</script>
</body>
</html>
"@
  [System.IO.File]::WriteAllText((Join-Path $dir 'index.html'), $html, (New-Object System.Text.UTF8Encoding($false)))
  [System.IO.File]::WriteAllText((Join-Path $dir '404.html'), $html, (New-Object System.Text.UTF8Encoding($false)))
  [System.IO.File]::WriteAllText((Join-Path $dir '.nojekyll'), '')

  $gh = Resolve-Gh
  if (-not $gh) { return }
  $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    if (-not (Test-Path (Join-Path $dir '.git'))) {
      & git -C $dir init -q
      & git -C $dir remote add origin "https://github.com/$OtaRepo.git"
    }
    & git -C $dir config user.name  'gbo2-site-bot'
    & git -C $dir config user.email '41898282+github-actions[bot]@users.noreply.github.com'
    & git -C $dir checkout -q --orphan tmp 2>$null | Out-Null
    & git -C $dir add -A
    & git -C $dir commit -q -m "옛 주소 → $SiteUrl" | Out-Null
    & git -C $dir push -q --force origin HEAD:gh-pages
    if ($LASTEXITCODE -eq 0) { Write-Host '  옛 GitHub Pages 주소는 새 주소로 넘어갑니다.' -ForegroundColor DarkGray }
    & git -C $dir branch -q -M gh-pages 2>$null | Out-Null
  } catch {
    # 조용히 삼키면 옛 주소가 낡은 채로 남는다
    Write-Host "  옛 주소 안내 페이지를 갱신하지 못했습니다: $($_.Exception.Message)" -ForegroundColor Yellow
  } finally { $ErrorActionPreference = $prevEap }
}

# ── 공유 갤러리 사전(dict) 자동 게시 ────────────────────────────────────────
# 보안 규칙이 기체·파츠 이름을 사전과 대조하므로, 데이터가 갱신되면 사전도 같이 올려야 한다.
# 안 올리면 새 기체로 만든 구성은 업로드가 조용히 거부되고, 사용자 눈에는 이유가 안 보인다.
# 그래서 배포에 묶는다. 자격 증명은 저장소가 공개라 파일에 못 넣고, DPAPI 로 암호화해
# 이 PC·이 계정에서만 풀리는 형태로 %LOCALAPPDATA% 에 둔다 (-SetDictKey 로 최초 1회 등록).
$DictDir  = $CredDir
$DictCred = Join-Path $DictDir 'dict.cred'
$DictHash = Join-Path $DictDir 'dict.sha'

function Set-DictKey {
  Write-Host '공유 갤러리 사전 계정을 이 PC 에 등록합니다.' -ForegroundColor Cyan
  Write-Host '  (Firebase Authentication 에 만든 전용 계정 — 관리자 계정과 달라야 합니다)' -ForegroundColor DarkGray
  $email = Read-Host '이메일'
  if (-not $email) { Write-Host '취소했습니다.' -ForegroundColor Yellow; return }
  $pw = Read-Host '비밀번호' -AsSecureString
  New-Item -ItemType Directory -Force $DictDir | Out-Null
  # ConvertFrom-SecureString 은 DPAPI 로 현재 Windows 사용자에게 묶어 암호화한다.
  # 이 파일을 복사해 가도 다른 PC·다른 계정에서는 풀리지 않는다.
  Set-Content -Path $DictCred -Encoding utf8 -Value @($email, (ConvertFrom-SecureString $pw))
  Write-Host "등록했습니다 → $DictCred" -ForegroundColor Green

  # 바로 확인한다 — 오타나 권한 누락을 몇 주 뒤 배포 때 알게 되면 늦다.
  $env:GBO2_DICT_EMAIL = $email
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw)
  try { $env:GBO2_DICT_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  & $node (Join-Path $PSScriptRoot 'tools\push_dict.js') '--check'
  $rc = $LASTEXITCODE
  $ErrorActionPreference = $prevEap
  $env:GBO2_DICT_PASSWORD = $null
  if ($rc -eq 0) {
    Write-Host '이제 -Publish 할 때마다 사전이 바뀌었으면 자동으로 올라갑니다.' -ForegroundColor Green
  } else {
    Write-Host '등록은 됐지만 위 확인에 실패했습니다 — 이대로는 사전이 안 올라갑니다.' -ForegroundColor Red
  }
}

function Publish-Dict {
  # 사전을 먼저 만든다 — 데이터가 안 바뀌었으면 내용도 그대로다.
  # node 가 stderr 로 뭘 내보내도 배포가 죽지 않게 이 구간만 Continue 로 둔다.
  $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  & $node (Join-Path $PSScriptRoot 'tools\make_share_dict.js') '--dict' | Out-Null
  $ErrorActionPreference = $prevEap
  $src = Join-Path $PSScriptRoot 'dist\firebase-dict.json'
  if (-not (Test-Path $src)) { Write-Host '사전을 만들지 못해 게시를 건너뜁니다.' -ForegroundColor Yellow; return }

  # 안 바뀌었으면 올리지 않는다 (매 배포마다 75KB 를 밀어 넣을 이유가 없다)
  $now = (Get-FileHash $src -Algorithm SHA256).Hash
  $was = if (Test-Path $DictHash) { (Get-Content $DictHash -Raw).Trim() } else { '' }
  if ($now -eq $was) { Write-Host '공유 갤러리 사전: 변경 없음 — 건너뜁니다.' -ForegroundColor DarkGray; return }

  if (-not (Test-Path $DictCred)) {
    Write-Host "`n공유 갤러리 사전이 바뀌었는데 계정이 등록돼 있지 않습니다." -ForegroundColor Yellow
    Write-Host '  이대로 두면 새로 추가된 기체로 만든 구성은 갤러리에 올릴 수 없습니다.' -ForegroundColor Yellow
    Write-Host '  .\update.ps1 -SetDictKey 로 한 번만 등록하면 이후로는 자동입니다.' -ForegroundColor Yellow
    return
  }

  # 자격 증명이 깨져 있으면(잘린 파일, 다른 PC 에서 복사해 온 것 — DPAPI 는 안 풀린다)
  # ConvertTo-SecureString 이 던진다. 이 스크립트는 ErrorActionPreference='Stop' 이라
  # 그대로 두면 **배포 전체가 여기서 죽는다**. 사전은 배포의 곁가지이므로 경고만 하고 넘어간다.
  try {
    $lines = @(Get-Content $DictCred)
    if ($lines.Count -lt 2) { throw '파일 형식이 올바르지 않습니다' }
    $env:GBO2_DICT_EMAIL = $lines[0]
    # DPAPI 로 풀어 프로세스 환경 변수로만 넘긴다 — 디스크에 평문이 남지 않는다.
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR((ConvertTo-SecureString $lines[1]))
    try { $env:GBO2_DICT_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  } catch {
    $env:GBO2_DICT_PASSWORD = $null
    Write-Host "`n사전 계정을 읽지 못했습니다 — 게시를 건너뜁니다. ($($_.Exception.Message))" -ForegroundColor Yellow
    Write-Host '  .\update.ps1 -SetDictKey 로 다시 등록하세요 (다른 PC 의 자격 증명은 풀리지 않습니다).' -ForegroundColor Yellow
    return
  }

  Write-Host "`n공유 갤러리 사전 게시 중…" -ForegroundColor Cyan
  $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  & $node (Join-Path $PSScriptRoot 'tools\push_dict.js')
  $rc = $LASTEXITCODE
  $ErrorActionPreference = $prevEap
  $env:GBO2_DICT_PASSWORD = $null

  if ($rc -eq 0) {
    New-Item -ItemType Directory -Force $DictDir | Out-Null
    Set-Content -Path $DictHash -Encoding utf8 -Value $now
  } else {
    # 해시를 남기지 않는다 → 다음 배포에서 다시 시도한다.
    Write-Host '  사전 게시에 실패했습니다. 새 기체 구성은 아직 갤러리에 올릴 수 없습니다.' -ForegroundColor Red
    Write-Host '  (다음 배포에서 자동으로 다시 시도합니다)' -ForegroundColor Yellow
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

# 사전 계정 등록은 여기서 끝난다 — 데이터 수신·빌드를 할 이유가 없다.
if ($SetDictKey) { Set-DictKey; Close-Window 0 }
if ($SetSiteKey) { Set-SiteKey; Close-Window 0 }
if ($RulesPublished) {
  $rp = Join-Path $PSScriptRoot 'firebase\rules.json'
  if (-not (Test-Path $rp)) { Write-Host 'firebase\rules.json 을 찾지 못했습니다.' -ForegroundColor Red; Close-Window 1 }
  New-Item -ItemType Directory -Force $CredDir | Out-Null
  Set-Content -Path $RulesSha -Encoding utf8 -Value (Get-FileHash $rp -Algorithm SHA256).Hash
  Write-Host '현재 규칙을 게시된 것으로 기록했습니다 — 다음부터 경고가 뜨지 않습니다.' -ForegroundColor Green
  Write-Host '  (파일이 또 바뀌면 다시 알려 줍니다. 서버를 직접 확인하지는 않습니다)' -ForegroundColor DarkGray
  Close-Window 0
}

# 배포 전에 '사람이 해야 하는데 잊기 쉬운 둘' 을 확인한다. 막지는 않고 알려만 준다.
#   ① 소스 커밋·푸시 — 이 스크립트는 소스 저장소를 건드리지 않는다. 안 밀어 두면
#      저장소가 뒤처지고, PC 를 옮길 때 그만큼 사라진다.
#   ② 패치노트 — 경량판·완전판 ZIP 에 그대로 동봉되므로, 안 고치면 새 버전에
#      낡은 안내문이 들어간다.
# 빌드·업로드에 몇 분 쓰기 **전에** 알려 줘야 되돌릴 수 있어 여기 둔다.
function Test-DeployReady {
  $warn = @()
  $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    $dirty = @(& git -C $PSScriptRoot status --porcelain 2>$null)
    if ($LASTEXITCODE -eq 0) {
      if ($dirty.Count) { $warn += "커밋되지 않은 변경이 $($dirty.Count)개 있습니다." }
      $ahead = @(& git -C $PSScriptRoot rev-list '@{u}..HEAD' 2>$null)
      if ($LASTEXITCODE -eq 0 -and $ahead.Count) { $warn += "푸시되지 않은 커밋이 $($ahead.Count)개 있습니다." }
    }
  } catch { } finally { $ErrorActionPreference = $prevEap }

  # 패치노트에 오늘 날짜 '항목' 이 있는가 (여러 번 배포하는 날이면 첫 배포에만 뜬다).
  # 날짜 문자열이 어디에든 있으면 통과시키면 안 된다 — 본문·링크에 우연히 있을 수 있다.
  # 항목은 줄머리의 `_2026-09-09 업데이트_` 형태다.
  $pn = Join-Path $PSScriptRoot '패치노트.md'
  $today = Get-Date -Format 'yyyy-MM-dd'
  if ((Test-Path $pn) -and -not (Select-String -Path $pn -Pattern "^_$today 업데이트" -Quiet)) {
    $warn += "패치노트에 오늘($today) 항목이 없습니다 — 배포본 ZIP 에 그대로 들어갑니다."
  }

  # 보안 규칙이 마지막 게시 이후 바뀌었는가.
  # **서버를 직접 확인하는 게 아니다** — 규칙은 관리자 권한 없이 읽을 수 없어서 앱이
  # 확인할 방법이 없다. 파일이 바뀐 것만 보고 '잊지 않게' 알린다.
  # 규칙은 정의하지 않은 필드를 막으므로($other:false), 낡은 채로 앱만 나가면 새 필드를
  # 쓴 업로드가 전부 거부된다(작성자 기능에서 실제로 겪었다).
  $rules = Join-Path $PSScriptRoot 'firebase\rules.json'
  if (Test-Path $rules) {
    $now = (Get-FileHash $rules -Algorithm SHA256).Hash
    $was = if (Test-Path $RulesSha) { (Get-Content $RulesSha -Raw).Trim() } else { '' }
    if ($now -ne $was) {
      $warn += 'firebase/rules.json 이 마지막 게시 이후 바뀌었습니다 — 콘솔에 게시하지 않으면 새 필드를 쓴 업로드가 거부됩니다.'
      $warn += '  (게시를 마쳤다면  .\update.ps1 -RulesPublished  로 기록해 두세요)'
    }
  }

  if (-not $warn.Count) { return }
  Write-Host ''
  foreach ($w in $warn) { Write-Host "  ⚠ $w" -ForegroundColor Yellow }
  # 비대화형(스케줄러·이 스크립트를 도구가 부를 때)에서는 매달리지 않고 알리기만 한다.
  $piped = $true
  try { $piped = [Console]::IsInputRedirected } catch { $piped = $true }
  if ((-not $piped) -and (-not $env:CI) -and (-not $env:GBO2_NONINTERACTIVE)) {
    Write-Host '  이대로 배포하려면 Enter, 그만두려면 Ctrl+C' -ForegroundColor Yellow
    try { Read-Host | Out-Null } catch { }
  } else {
    Write-Host '  (비대화형이라 그대로 진행합니다)' -ForegroundColor DarkGray
  }
}
if ($Publish) { Test-DeployReady }

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
  # 이번 빌드의 버전 스탬프(분 단위) — APK versionName·OTA version.json·릴리스 노트가 같은 값을 쓴다.
  # **빌드된 HTML 안의 값을 읽어 온다.** 여기서 Get-Date 로 따로 찍으면 빌드와 몇 초 차이로
  # 분(심하면 날짜)이 어긋나, 앱이 아는 자기 버전과 배포된 버전이 달라진다.
  $script:VerStamp = $null
  $distHtmlPath = Join-Path $PSScriptRoot 'dist\gbo2-simulator.html'
  if (Test-Path $distHtmlPath) {
    # 찾을 때까지 앞에서부터 조금씩 읽는다. 예전엔 앞 200,000자만 봤는데, GBO2_BUILD 위치는
    # 그 앞에 놓인 CSS 길이에 따라 밀린다(지금 110,666자 · CSS 91,588자). CSS 가 커지면
    # 조용히 못 찾고 Get-Date 로 떨어져, 앱이 아는 버전과 배포된 버전이 어긋난다.
    $sr = New-Object System.IO.StreamReader($distHtmlPath, [System.Text.Encoding]::UTF8)
    try {
      $buf = New-Object char[] 65536
      $head = ''
      while (-not $script:VerStamp) {
        $n = $sr.Read($buf, 0, $buf.Length)
        if ($n -le 0) { break }
        $head += (New-Object string($buf, 0, $n))
        $m = [regex]::Match($head, '"stamp"\s*:\s*"(\d{4}-\d{2}-\d{2}-\d{4})"')
        if ($m.Success) { $script:VerStamp = $m.Groups[1].Value }
        # 데이터 블록까지 가면 이미 지나친 것이다 — 15MB 를 다 읽지 않는다
        elseif ($head.Length -gt 1000000) { break }
      }
    } finally { $sr.Dispose() }
  }
  if (-not $script:VerStamp) {
    # 폴백은 조용하면 안 된다. 이러면 APK·version.json·릴리스 노트가 앱이 아는 값과 달라진다.
    $script:VerStamp = Get-Date -Format 'yyyy-MM-dd-HHmm'
    Write-Host "`n  ⚠ 빌드된 HTML 에서 버전 스탬프를 찾지 못했습니다." -ForegroundColor Red
    Write-Host "    현재 시각($($script:VerStamp))으로 대신합니다 — 앱이 아는 자기 버전과" -ForegroundColor Yellow
    Write-Host '    배포된 버전이 어긋날 수 있습니다. tools/build.js 의 GBO2_BUILD 를 확인하세요.' -ForegroundColor Yellow
  }
  Write-Host "`n최신 결과물: dist\gbo2-simulator.html (브라우저에서 새로고침 하세요)" -ForegroundColor Green
  # 데이터가 갱신됐으면 APK 도 함께 최신화 (‑NoApk 로 건너뛸 수 있음)
  if (-not $NoApk) { Build-Apk }
  # APK 빌드가 실패했는데 그대로 진행하면, 배포본에 '지난번 APK' 가 동봉되고 GitHub 에도
  # 그게 올라간다. 실제로 그렇게 한 번 나갔다 - 실패하면 여기서 멈춘다.
  # 배포용이면 실제 Chrome 으로 화면을 훑어 회귀를 먼저 잡는다.
  # (여기 있는 항목은 전부 예전에 배포까지 나갔던 것들 — 닫힌 모달이 앱을 덮음,
  #  가로 폰이 데스크톱으로 뜸, 상단이 상태바에 먹힘, 안 눌리는 버튼, 가로 스크롤)
  # 데이터·번역 점검 — UI 점검보다 먼저(빠르고, 잡는 것이 다르다).
  # 「파츠/기체 사전 전수 번역」·「화면에 일본어 잔존 없음」이 여기 있는데 배포 게이트에는
  # 걸려 있지 않아, 자동 번역이 반쪽으로 만든 이름(「緊急修復모주루」)이 그대로 배포됐다.
  if (($Release -or $Publish) -and -not $NoSmoke) {
    Write-Host "`n데이터·번역 점검 중… (smoke)" -ForegroundColor Cyan
    $prevEap3 = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & $node (Join-Path $PSScriptRoot 'tools\smoke.js')
    $smokeCode = $LASTEXITCODE
    $ErrorActionPreference = $prevEap3
    if ($smokeCode -ne 0) {
      Write-Host "`n데이터·번역 점검에 걸려 배포를 중단합니다. (위 FAIL 항목 확인)" -ForegroundColor Red
      Write-Host '  번역이 덜 된 이름은 data/i18n/ms.json · parts.json 에 넣어 주세요.' -ForegroundColor Yellow
      Write-Host '  그래도 배포하려면 -NoSmoke 를 붙이세요.' -ForegroundColor Yellow
      Close-Window 1
    }
  }
  if (($Release -or $Publish) -and -not $NoUiCheck) {
    Write-Host "`nUI 회귀 점검 중… (실제 Chrome, 4개 화면 크기)" -ForegroundColor Cyan
    $prevEap2 = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & $node (Join-Path $PSScriptRoot 'tools\ui_check.js') '--shots'
    $uiCode = $LASTEXITCODE
    $ErrorActionPreference = $prevEap2
    if ($uiCode -ne 0) {
      Write-Host "`nUI 점검에 걸려 배포를 중단합니다. (위 목록 · dist\ui_check 스크린샷 확인)" -ForegroundColor Red
      Write-Host '  그래도 배포하려면 -NoUiCheck 를 붙이세요.' -ForegroundColor Yellow
      Close-Window 1
    }
  }
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
  # 사전을 먼저 올린다. 순서가 반대면, OTA 를 받은 사람이 새 기체로 구성을 만들었는데
  # 사전이 아직 낡아서 업로드가 거부되는 창이 잠깐 생긴다.
  if ($Publish) { Publish-Dict; Publish-Ota; Publish-Pc; Publish-Site }
}
Close-Window 0
