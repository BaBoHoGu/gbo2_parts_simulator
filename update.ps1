# GBO2 커스텀 파츠 시뮬레이터 - 자동 업데이트
#
#   .\update.ps1            신규/변경 기체·파츠·밸런스 패치를 감지해 받고 재빌드까지 자동
#   .\update.ps1 -Check     감지만 하고 무엇이 바뀌는지 리포트 (반영 안 함)
#   .\update.ps1 -Rebuild   인터넷 없이 dist 만 다시 만든다 (오버라이드 패치 파일 적용용)
#
# gbo2.jp 최신 데이터·일본 위키(밸런스 패치 목록 포함)에서 변경분만 가져와
# dist/gbo2-simulator.html 을 다시 만듭니다. node 가 있어야 합니다(폴더에 동봉).
param([switch]$Check, [switch]$Rebuild)

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
}
Close-Window 0
