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
const NAME = `gbo2-simulator_${stamp}_${commit}`;
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

// 개발 저장소와 같은 레이아웃으로 담는다 → update.ps1 이 도구 수정 없이 그대로 동작한다.
// 사용자는 dist\gbo2-simulator.html 을 연다.

// 1) 시뮬레이터 본체 (사용자가 여는 파일)
copyFile(p('dist', 'gbo2-simulator.html'), path.join(STAGE, 'dist', 'gbo2-simulator.html'));
copyDir(p('dist', 'images'), path.join(STAGE, 'dist', 'images'));

// 2) 재빌드용 이미지 원본 (build.js 가 assets/images → dist/images 로 복사)
copyDir(p('assets', 'images'), path.join(STAGE, 'assets', 'images'));

// 3) 업데이트 파이프라인 (검증 전용 스크립트 _*.js 는 뺀다)
copyFile(p('update.ps1'), path.join(STAGE, 'update.ps1'));
copyDir(p('tools'), path.join(STAGE, 'tools'), (s, e) => !(e.isFile() && e.name.startsWith('_')));
copyDir(p('src'), path.join(STAGE, 'src'));

// 4) 데이터 (진단용 buff_skills.json 은 뺀다)
copyDir(p('data'), path.join(STAGE, 'data'), s => !s.endsWith('buff_skills.json'));

// 4) 내장 node.exe — 설치 없이 update.ps1 이 바로 동작하도록
copyFile(process.execPath, path.join(STAGE, 'node', 'node.exe'));

// 5) 사용법
fs.copyFileSync(p('release', '사용법.txt'), path.join(STAGE, '사용법.txt'));

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
console.log('  내장 node.exe 포함 — 사용자는 update.ps1 실행만으로 최신화됩니다.');
