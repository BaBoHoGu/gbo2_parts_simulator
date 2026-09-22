// 배포 패키지(자기 업데이트 가능본)를 만든다.
//   node tools/build_release.js
//
// 산출물: release/gbo2-simulator_<날짜>_<커밋>/  폴더와 같은 이름의 .zip
// 구성:  시뮬레이터 HTML + 이미지 + 업데이트 도구(update.ps1 + tools + data + src)
//        + 내장 node.exe  → 사용자는 아무것도 설치하지 않고 update.ps1 만 실행하면 갱신됨.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const p = (...x) => path.join(ROOT, ...x);

// dist 가 최신인지 먼저 확인 — 없으면 빌드
if (!fs.existsSync(p('dist', 'gbo2-simulator.html'))) {
  console.log('dist 가 없어 먼저 빌드합니다…');
  execFileSync(process.execPath, [p('tools', 'build.js')], { cwd: ROOT, stdio: 'inherit' });
}

let commit = 'nogit';
try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim(); } catch {}
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
// --light: HTML + 업데이트 스크립트만(≈16MB, GitHub 에서 데이터 받음). 기본: 완전판(node·도구 동봉).
const LIGHT = process.argv.includes('--light');
// 버전 스탬프. --stamp 로 받는 게 정상 경로(update.ps1 이 넘긴다)지만, 손으로 실행할 때를
// 대비해 **빌드된 HTML 에서 직접 읽는다.** 예전엔 없으면 빈 값을 써서, 그 경량판을 받은
// 사람이 설치 직후 같은 내용을 15.87MB 다시 받았다. 스탬프의 원본은 언제나 그 HTML 이다.
const stampArg = (() => {
  const i = process.argv.indexOf('--stamp');
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  try {
    const h = fs.readFileSync(p('dist', 'gbo2-simulator.html'), 'utf8');
    const m = h.match(/"stamp"\s*:\s*"(\d{4}-\d{2}-\d{2}-\d{4})"/);
    if (m) return m[1];
  } catch { /* dist 가 없으면 아래에서 빈 값 */ }
  return null;
})();
const NAME = `gbo2-simulator${LIGHT ? '-light' : ''}_${stamp}_${commit}`;
const STAGE = p('release', NAME);

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

const copyFile = (src, dst) => { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); };
const copyDir = (src, dst, filter) => {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (filter && !filter(s, e)) continue;
    if (e.isDirectory()) copyDir(s, d, filter);
    else copyFile(s, d);
  }
};

if (LIGHT) {
  // ── 경량판: HTML + 업데이트 스크립트만 (node·도구·이미지 제외, GitHub 에서 데이터 받음) ──
  copyFile(p('dist', 'gbo2-simulator.html'), path.join(STAGE, 'gbo2-simulator.html'));
  copyDir(p('pc-light'), STAGE);                                    // 실행.bat·업데이트.bat·업데이트.ps1·사용법.txt
  fs.writeFileSync(path.join(STAGE, '.data-version'), stampArg || '');   // 첫 실행 시 불필요 다운로드 방지
  const apkSrc = p('dist', 'gbo2-simulator-debug.apk');
  if (fs.existsSync(apkSrc)) copyFile(apkSrc, path.join(STAGE, '모바일-앱.apk'));   // 모바일 APK 도 동봉
  if (fs.existsSync(p('패치노트.md'))) fs.copyFileSync(p('패치노트.md'), path.join(STAGE, '패치노트.md'));
} else {

// 개발 저장소와 같은 레이아웃으로 담는다 → update.ps1 이 도구 수정 없이 그대로 동작한다.
// 사용자는 dist\gbo2-simulator.html 을 연다.

// 1) 시뮬레이터 본체 (사용자가 여는 파일) — 이미지는 HTML 에 data URI 로 인라인돼 있어 별도 폴더 불필요.
copyFile(p('dist', 'gbo2-simulator.html'), path.join(STAGE, 'dist', 'gbo2-simulator.html'));

// 1.5) 모바일 APK (미리 빌드된 것) — 일반 사용자 PC 엔 Android SDK 가 없어 직접 빌드할 수 없으므로,
//      개발 빌드에서 만든 APK 를 "완성본 파일"로 최상위에 동봉한다. 폰에 옮겨 바로 설치.
{
  const apkSrc = p('dist', 'gbo2-simulator-debug.apk');
  if (fs.existsSync(apkSrc)) {
    copyFile(apkSrc, path.join(STAGE, '모바일-앱.apk'));
    console.log('  모바일 APK 동봉: 모바일-앱.apk');
  } else {
    console.log('  ⚠ dist\\gbo2-simulator-debug.apk 없음 — 모바일 APK 미동봉 (먼저 .\\update.ps1 실행)');
  }
}

// 2) 재빌드용 이미지 원본 (build.js 가 assets/images → dist/images 로 복사)
copyDir(p('assets', 'images'), path.join(STAGE, 'assets', 'images'));
// 「배포처에 이미지가 아예 없는 기체」 목록. smoke 가 이걸로 **우리 잘못이 아닌 누락**을 가른다.
// 안 담으면 배포본에서만 그 기체가 실패로 잡힌다 — 실제로 ペイルライダー［軽装備仕様］ 하나 때문에
// 배포본의 검사가 늘 빨간불이었다(2026-09-23 확인).
// favicon 은 build.js 가 HTML 에 박아 넣는다 — 없으면 **재빌드가 통째로 죽는다**(ENOENT).
// 배포본의 자체 재빌드가 이것 하나 때문에 안 됐다(2026-09-23 확인).
if (fs.existsSync(p('assets', 'favicon.png'))) {
  copyFile(p('assets', 'favicon.png'), path.join(STAGE, 'assets', 'favicon.png'));
}
// 일러스트는 **이름 목록만** 담는다. 그림 16MB 는 사이트에서 URL 로 부르므로 필요 없지만,
// 목록이 없으면 재빌드한 배포본에서 일러스트가 통째로 사라진다.
if (fs.existsSync(p('assets', 'illust'))) {
  const names = fs.readdirSync(p('assets', 'illust'))
    .filter(f => /\.webp$/i.test(f))
    .map(f => f.replace(/\.webp$/i, '').normalize('NFC'));
  fs.mkdirSync(path.join(STAGE, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(STAGE, 'assets', 'illust-index.json'),
    JSON.stringify(names, null, 0));
  console.log(`  일러스트 목록 동봉: ${names.length}기 (그림은 사이트에서 URL 로 부른다)`);
}
if (fs.existsSync(p('assets', 'missing.txt'))) {
  copyFile(p('assets', 'missing.txt'), path.join(STAGE, 'assets', 'missing.txt'));
}

// 3) 업데이트 파이프라인 (검증 전용 스크립트 _*.js 는 뺀다)
copyFile(p('update.ps1'), path.join(STAGE, 'update.ps1'));
copyFile(p('run.ps1'), path.join(STAGE, 'run.ps1'));   // 업데이트 확인 후 자동 실행 런처
copyFile(p('run.bat'), path.join(STAGE, 'run.bat'));       // 더블클릭 실행 (run.ps1 래퍼)
copyFile(p('update.bat'), path.join(STAGE, 'update.bat')); // 더블클릭 업데이트 (update.ps1 래퍼)
copyFile(p('package.json'), path.join(STAGE, 'package.json'));
copyDir(p('tools'), path.join(STAGE, 'tools'), (s, e) => !(e.isFile() && e.name.startsWith('_')));
copyDir(p('src'), path.join(STAGE, 'src'));

// 3.5) 위키 자동복구용 puppeteer-core (+의존성 트리) — 릴리스 사용자도 Cloudflare 를 통과해
//      신기체 무장·스킬을 자동 수신한다. 브라우저 자체는 안 담고 시스템 Edge/Chrome 을 구동한다.
{
  const seen = new Set();
  const collect = name => {
    if (seen.has(name)) return;
    const pj = p('node_modules', name, 'package.json');
    if (!fs.existsSync(pj)) return;
    seen.add(name);
    const pkg = JSON.parse(fs.readFileSync(pj, 'utf8'));
    for (const d of Object.keys(pkg.dependencies || {})) collect(d);
  };
  collect('puppeteer-core');
  /* jsdom 도 담는다 — smoke 가 이것으로 dist 를 실제로 열어 본다.
     없으면 배포본에서 `require('jsdom')` 에서 죽어, **사용자가 스스로 데이터를 다시 받았을 때
     검사가 하나도 안 도는** 상태가 된다. 위키 표 모양이 바뀌거나 번역이 빠져도 아무도 안 잡는다.
     (2026-09-22 에 카풀 무장 5종이 조용히 빠져 있던 것이 이 부류다) */
  collect('jsdom');
  let n = 0;
  for (const name of seen) {
    const src = p('node_modules', name);
    if (fs.existsSync(src)) { copyDir(src, path.join(STAGE, 'node_modules', name)); n++; }
  }
  if (n) console.log(`  도구 동봉: ${n}개 패키지 (puppeteer-core = 위키 자동복구 · jsdom = 검사)`);
  else console.log('  ⚠ puppeteer-core 미설치 — 릴리스에 위키 자동복구가 빠집니다 (npm install --no-save puppeteer-core)');
}

// 4) 데이터 (진단용 buff_skills.json 은 뺀다)
copyDir(p('data'), path.join(STAGE, 'data'), s => !s.endsWith('buff_skills.json'));

// 4) 내장 node.exe — 설치 없이 update.ps1 이 바로 동작하도록.
//    빌드 머신의 node 를 그대로 복사하므로, 배포 대상(win-x64)과 다른 환경에서
//    빌드하면 사용자 PC에서 실행되지 않는다. 아키텍처가 다르면 경고한다.
if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.warn(`⚠ 경고: 이 node 는 ${process.platform}/${process.arch} 용입니다. `
    + '대부분의 사용자(win-x64)에게 맞지 않으니 win-x64 환경에서 빌드하세요.');
}
copyFile(process.execPath, path.join(STAGE, 'node', 'node.exe'));

// 5) 사용법 + 패치노트(변경사항 안내)
fs.copyFileSync(p('release', '사용법.txt'), path.join(STAGE, '사용법.txt'));
if (fs.existsSync(p('패치노트.md'))) fs.copyFileSync(p('패치노트.md'), path.join(STAGE, '패치노트.md'));

}   // end else(완전판)

// 6) 압축 (Windows 기본 PowerShell Compress-Archive)
const zip = STAGE + '.zip';
fs.rmSync(zip, { force: true });
execFileSync('powershell', ['-NoProfile', '-Command',
  `Compress-Archive -Path '${STAGE}\\*' -DestinationPath '${zip}' -Force`],
  { stdio: 'inherit' });

// 요약
const size = d => { let b = 0; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); b += e.isDirectory() ? size(f) : fs.statSync(f).size; } return b; };
const mb = n => (n / 1024 / 1024).toFixed(1) + ' MB';
console.log('\n■ 배포 패키지 완성');
console.log('  폴더 :', path.relative(ROOT, STAGE), '(' + mb(size(STAGE)) + ')');
console.log('  압축 :', path.relative(ROOT, zip), '(' + mb(fs.statSync(zip).size) + ')');
console.log(LIGHT ? '  경량판 — 업데이트.bat 로 GitHub 에서 최신 데이터를 받습니다.'
                  : '  완전판 — 내장 node.exe 로 update.ps1 이 직접 수집·재빌드합니다.');
