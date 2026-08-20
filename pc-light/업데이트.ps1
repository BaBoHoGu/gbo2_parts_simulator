# GBO2 시뮬레이터 (경량판) — GitHub 에서 최신 데이터(HTML)를 받아 교체한다.
#   * 직접 수집(스크래핑)하지 않고, 개발자가 올려둔 완성 데이터를 받는다 → 빠르고 node 불필요.
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; chcp 65001 > $null 2>&1 } catch {}

$repo = 'BaBoHoGu/gbo2_parts_simulator'
$base = "https://github.com/$repo/releases/download/data"
$here = $PSScriptRoot
$html = Join-Path $here 'gbo2-simulator.html'
$stampFile = Join-Path $here '.data-version'

try {
  $vjson = (Invoke-WebRequest -Uri "$base/version.json" -UseBasicParsing -TimeoutSec 15).Content
  $remote = ($vjson.TrimStart([char]0xFEFF) | ConvertFrom-Json).date
  $local = if (Test-Path $stampFile) { (Get-Content $stampFile -Raw).Trim() } else { '' }
  if ([string]::IsNullOrEmpty($remote)) { Write-Host '버전 정보를 읽지 못했습니다.' -ForegroundColor Yellow; return }
  if ($remote -le $local) { Write-Host "이미 최신입니다. (데이터 $local)" -ForegroundColor Green; return }

  Write-Host "최신 데이터를 받는 중… ($remote)" -ForegroundColor Cyan
  $tmp = "$html.tmp"
  Invoke-WebRequest -Uri "$base/gbo2-simulator.html" -OutFile $tmp -UseBasicParsing -TimeoutSec 180

  # 무결성: 최소 크기 + 문서 끝 태그 (잘린 다운로드/오류 페이지 거르기)
  $ok = (Test-Path $tmp) -and ((Get-Item $tmp).Length -gt 100000)
  if ($ok) { $tail = (Get-Content $tmp -Tail 5 -ErrorAction SilentlyContinue) -join "`n"; if ($tail -notmatch '</html>|</body>') { $ok = $false } }

  if ($ok) {
    Move-Item $tmp $html -Force
    Set-Content $stampFile $remote -Encoding ascii -NoNewline
    Write-Host "갱신 완료! (데이터 $remote) — 브라우저를 새로고침하세요." -ForegroundColor Green
  } else {
    Remove-Item $tmp -ErrorAction SilentlyContinue
    Write-Host '다운로드가 온전하지 않아 갱신을 취소했습니다. 기존 데이터로 사용하세요.' -ForegroundColor Yellow
  }
} catch {
  Write-Host '업데이트를 건너뜁니다 (인터넷/서버 확인). 기존 데이터로 그대로 사용됩니다.' -ForegroundColor Yellow
}
