# GBO2 커스텀 파츠 시뮬레이터 - 실행 런처
#
#   .\run.ps1            업데이트를 확인해 변경이 있으면 자동 반영한 뒤 시뮬레이터를 연다
#   .\run.ps1 -NoUpdate  업데이트 확인 없이 바로 연다 (즉시 실행)
#
# 변경이 없으면 확인만 하고(수 초) 곧바로 열립니다. 변경이 있을 때만 받아서 재빌드합니다.
# 업데이트에 실패해도(오프라인 등) 있는 결과물을 그대로 엽니다.
param([switch]$NoUpdate)

$ErrorActionPreference = 'Continue'
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
  chcp 65001 > $null 2>&1
} catch {}
Set-Location -Path $PSScriptRoot

$html = Join-Path $PSScriptRoot 'dist\gbo2-simulator.html'

if (-not $NoUpdate) {
  # node 결정 — 동봉한 node\node.exe 우선, 없으면 시스템 node
  $bundled = Join-Path $PSScriptRoot 'node\node.exe'
  if (Test-Path $bundled) {
    $node = $bundled
  } else {
    $sys = Get-Command node -ErrorAction SilentlyContinue
    $node = if ($sys) { $sys.Source } else { $null }
  }

  if ($node) {
    Write-Host '업데이트 확인 중… (변경이 없으면 곧 열립니다)' -ForegroundColor Cyan
    try {
      & $node 'tools/update.js'
      if ($LASTEXITCODE -ne 0) {
        Write-Host "업데이트 중 문제가 있었지만(코드 $LASTEXITCODE) 있는 결과물로 엽니다." -ForegroundColor Yellow
      }
    } catch {
      Write-Host "업데이트를 건너뜁니다(오프라인 등): $_" -ForegroundColor Yellow
    }
  } else {
    Write-Host 'node 를 찾지 못해 업데이트 확인을 건너뜁니다.' -ForegroundColor Yellow
  }
}

if (Test-Path $html) {
  Write-Host "시뮬레이터를 엽니다: $html" -ForegroundColor Green
  Start-Process $html
} else {
  Write-Host "dist\gbo2-simulator.html 이 없습니다 — .\update.ps1 로 먼저 빌드하세요." -ForegroundColor Red
}
