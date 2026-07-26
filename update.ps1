# GBO2 커스텀 파츠 시뮬레이터 - 자동 업데이트
#
#   .\update.ps1            신규/변경 기체·파츠를 감지해 받고 추출·재빌드까지 자동
#   .\update.ps1 -Check     감지만 하고 무엇이 바뀌는지 리포트 (반영 안 함)
#
# gbo2.jp 최신 데이터와 일본 위키에서 새 기체·파츠·무장을 가져와
# dist/gbo2-simulator.html 을 다시 만듭니다. node 가 설치돼 있어야 합니다.
param([switch]$Check)

$ErrorActionPreference = 'Stop'
# 한글이 깨지지 않도록 콘솔 출력을 UTF-8 로 맞춘다.
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
  chcp 65001 > $null 2>&1
} catch {}
Set-Location -Path $PSScriptRoot

# node 결정 — 배포본에 함께 넣은 node\node.exe 를 먼저 쓰고, 없으면 시스템 node 를 쓴다.
$bundled = Join-Path $PSScriptRoot 'node\node.exe'
if (Test-Path $bundled) {
  $node = $bundled
} else {
  $sys = Get-Command node -ErrorAction SilentlyContinue
  if (-not $sys) {
    Write-Host "node(Node.js)를 찾을 수 없습니다." -ForegroundColor Red
    Write-Host "이 폴더의 node\node.exe 가 지워졌거나, 시스템에 Node.js 가 설치돼 있지 않습니다." -ForegroundColor Red
    Write-Host "https://nodejs.org 에서 설치 후 다시 실행하세요." -ForegroundColor Yellow
    exit 1
  }
  $node = $sys.Source
}

$nodeArgs = @('tools/update.js')
if ($Check) { $nodeArgs += '--check' }

& $node @nodeArgs
$code = $LASTEXITCODE

if ($code -ne 0) {
  Write-Host "`n업데이트 중 오류가 발생했습니다 (종료 코드 $code)." -ForegroundColor Red
  exit $code
}

if (-not $Check) {
  Write-Host "`n최신 결과물: dist\gbo2-simulator.html" -ForegroundColor Green
}
