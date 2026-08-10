# GBO2 커스텀 파츠 시뮬레이터 - 실행 런처
#
#   .\run.ps1            (필요하면) 업데이트를 확인·반영한 뒤 시뮬레이터를 연다
#   .\run.ps1 -Force     방금 확인했더라도 이번엔 업데이트를 다시 확인한다
#   .\run.ps1 -NoUpdate  업데이트 확인 없이 바로 연다 (즉시 실행)
#
# 최근(기본 3시간) 확인했으면 그냥 바로 엽니다(가볍게). 그보다 오래됐을 때만 확인하고,
# 변경이 있으면 받아서 재빌드합니다. 업데이트 실패(오프라인 등)해도 있는 결과물을 엽니다.
param([switch]$NoUpdate, [switch]$Force)

$ErrorActionPreference = 'Continue'
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
  chcp 65001 > $null 2>&1
} catch {}
Set-Location -Path $PSScriptRoot

$html  = Join-Path $PSScriptRoot 'dist\gbo2-simulator.html'
$stamp = Join-Path $PSScriptRoot '.last-update-check'
$ThrottleHours = 3

# 최근에 확인했는지 (throttle)
$recent = $false
if ((Test-Path $stamp) -and -not $Force) {
  try {
    $last = [DateTime]::Parse((Get-Content $stamp -Raw).Trim())
    if (((Get-Date) - $last).TotalHours -lt $ThrottleHours) { $recent = $true }
  } catch {}
}

if (-not $NoUpdate -and -not $recent) {
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
      # 성공적으로 한 번 확인했으면 시각을 기록(다음 3시간은 건너뜀)
      try { Set-Content -Path $stamp -Value ((Get-Date).ToString('o')) -Encoding utf8 } catch {}
    } catch {
      Write-Host "업데이트를 건너뜁니다(오프라인 등): $_" -ForegroundColor Yellow
    }
  } else {
    Write-Host 'node 를 찾지 못해 업데이트 확인을 건너뜁니다.' -ForegroundColor Yellow
  }
} elseif ($recent) {
  Write-Host "최근 확인함 — 바로 엽니다. (다시 확인하려면 .\run.ps1 -Force)" -ForegroundColor DarkGray
}

if (Test-Path $html) {
  Write-Host "시뮬레이터를 엽니다: $html" -ForegroundColor Green
  Start-Process $html
} else {
  Write-Host "dist\gbo2-simulator.html 이 없습니다 — .\update.ps1 로 먼저 빌드하세요." -ForegroundColor Red
}
