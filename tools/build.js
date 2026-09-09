// src/ + data/ 를 하나의 오프라인 HTML 파일로 합친다.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const readJson = (...p) => JSON.parse(read(...p));
const D = require('./lib/dataset.js');

const msData = readJson('data', 'msData.json');
// 공식 미러(gbo2.jp)에 아직 없는 기체(예: 갓 추가된 LV — 위키엔 있으나 미러 반영 전)를 보탠다.
// 병합 규칙은 tools/lib/dataset.js 한 곳에만 둔다 — 공유 갤러리 사전도 같은 목록을 써야 하는데,
// 예전엔 여기만 병합해서 앱에는 있고 사전에는 없는 기체가 생겼다(업로드가 조용히 거부됨).
{
  const n = D.mergeMsAdditions(ROOT, msData);
  if (n) console.log(`추가 기체 병합: ${n}기 (msData.additions.json)`);
}
// gbo2.jp 가 아직 반영 못 한 스탯·슬롯은 위키 값으로 교정한다 (extract_ms_wiki.js 가 만든 목록).
const overridePath = path.join(ROOT, 'data', 'msData.override.json');
if (fs.existsSync(overridePath)) {
  const override = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
  let n = 0;
  for (const m of msData) {
    const ov = override[m.MS名];
    if (ov) for (const [k, v] of Object.entries(ov)) { m[k] = v; n++; }
  }
  if (n) console.log(`위키 교정 적용: ${Object.keys(override).length}기 · ${n}개 필드`);
}
const parts = readJson('data', 'parts.json');
// 미러(gbo2.jp)에 아직 없는 파츠를 위키에서 보강한다 — 기체의 msData.additions.json 과 같은 역할.
{
  const n = D.mergePartAdditions(ROOT, parts);
  if (n) console.log(`파츠 보강: ${n}개 (parts.additions.json)`);
}
const fullst = readJson('data', 'fullst.json');
const weapons = readJson('data', 'weapons.json');
const skills = readJson('data', 'skills.json');

// 위키 5891 실측표 — 특수 연소제를 꼈을 때 실제로 재 본 1틱·히트.
// 소이 히트 수는 계산으로 한 값을 못 낸다(지속÷간격 내림이라 두 정수에 걸린다).
// 실측이 있는 무장만 그 값을 쓰고, 나머지는 앱이 범위로 낸다.
// 기본값이 지금 데이터와 다르면 붙이지 않는다 — 밸런스 패치로 위력이 바뀌면
// 옛 실측을 그대로 쓰는 게 더 나쁘기 때문이다.
{
  const ov = fs.existsSync(path.join(ROOT, 'data', 'burn.override.json'))
    ? readJson('data', 'burn.override.json') : {};
  let n = 0, stale = 0;
  for (const [key, v] of Object.entries(ov)) {
    const i = key.indexOf('|');
    const page = weapons[key.slice(0, i)];
    const w = page && (page.weapons || []).find(x => x.name === key.slice(i + 1));
    if (!w) continue;
    const m = ((w.info && w.info['備考']) || '').match(/(\d+)\s*固定ダメージ\s*[（(]\s*(\d+)\s*[x×ｘ]\s*(\d+)\s*HIT/i);
    if (!m || Number(m[2]) !== v.base[0] || Number(m[3]) !== v.base[1]) { stale++; continue; }
    (w.mods = w.mods || {}).burnSoi = v.soi;
    n++;
  }
  if (n || stale) console.log(`소이 실측 반영: ${n}종` + (stale ? ` · 기본값이 달라 건너뜀 ${stale}종` : ''));
}

// 사이코뮤 태깅 오버라이드 — 록온 자동 태깅의 오탐/누락을 빌드 시 교정.
// (작은 override 파일만 배포해 재빌드하면 패치됨 — extract 재수신 불필요, update 후에도 유지)
{
  const ovPath = path.join(ROOT, 'data', 'psycommu.override.json');
  if (fs.existsSync(ovPath)) {
    const ov = JSON.parse(fs.readFileSync(ovPath, 'utf8'));
    const ex = ov.exclude || [], inc = ov.include || [];
    let nEx = 0, nInc = 0;
    for (const pg of Object.values(weapons)) for (const wp of pg.weapons || []) {
      if (ex.some(s => wp.name.includes(s))) { if (wp.psycommu) { delete wp.psycommu; nEx++; } }
      else if (inc.some(s => wp.name.includes(s))) { if (!wp.psycommu) { wp.psycommu = true; nInc++; } }
    }
    if (nEx || nInc) console.log(`사이코뮤 오버라이드 적용: 제외 ${nEx} · 추가 ${nInc}`);
  }
}

const misc = readJson('data', 'i18n', 'misc.json');
// 신규 기체·파츠 자동 번역(*.auto.json)을 밑에 깔고, 수작업 사전이 덮어쓴다(수작업 우선).
const autoJson = f => fs.existsSync(path.join(ROOT, 'data', 'i18n', f)) ? readJson('data', 'i18n', f) : {};
const msSkills = fs.existsSync(path.join(ROOT, 'data', 'ms_skills.json')) ? readJson('data', 'ms_skills.json') : {};
const i18n = {
  ms: { ...autoJson('ms.auto.json'), ...readJson('data', 'i18n', 'ms.json') },
  parts: { ...autoJson('parts.auto.json'), ...readJson('data', 'i18n', 'parts.json') },
  weapons: readJson('data', 'i18n', 'weapons.json'),
  // 설명문 안의 고유명사도 같은 사전으로 옮긴다
  terms: readJson('data', 'i18n', 'weapon_terms.json'),
  skillText: autoJson('skill_text.json'),     // 스킬 효과·설명 번역 (jp→ko)
  weaponNote: autoJson('weapon_note.json'),   // 무장 備考 번역 (jp→ko), 없으면 UI 하드코딩 폴백
  attr: misc.attr,
  kind: misc.kind,
  fullst: misc.fullst,             // 강화리스트 항목 이름
  fullstEffect: misc.fullstEffect  // 강화리스트 효과 키
};

// </script> 가 데이터 안에 들어가도 파서가 깨지지 않도록 이스케이프한다.
const inline = (name, value) =>
  `window.${name}=` + JSON.stringify(value).replace(/<\/script/gi, '<\\/script') + ';';

// --web : 사이트용 산출물(dist/web). 이미지를 인라인하지 않고 images/ 로 따로 낸다.
//   왜 나누나 — 인라인은 file:// 에서 캔버스 오염을 피하려고 한 것이라 오프라인판에는 필수지만,
//   사이트에서는 손해만 남는다. base64 가 압축을 방해해 전송량이 0.58MB → 6.00MB 로 불고,
//   img 의 loading="lazy" 도 무력화돼(이미 HTML 안에 있으니) 첫 화면에 안 보이는 736장까지 받는다.
//   분리하면 첫 방문 1.17MB · 재배포 후 0.58MB 가 된다.
// 기본(플래그 없음) 산출물은 예전 그대로다 — APK·경량판·완전판이 그 파일을 쓴다.
const WEB = process.argv.includes('--web');

// 이미지를 data URI 로 인라인 — 진짜 단일 파일이 되고, file:// 에서도 캔버스 오염 없이
// PNG 카드에 기체·파츠 이미지를 그릴 수 있다. 키는 '<dir>/<NFC파일명>.webp'.
const IMG_SRC = path.join(ROOT, 'assets', 'images');
const images = {};
let imgCount = 0, imgBytes = 0;
if (fs.existsSync(IMG_SRC)) {
  for (const dir of fs.readdirSync(IMG_SRC)) {
    const dp = path.join(IMG_SRC, dir);
    if (!fs.statSync(dp).isDirectory()) continue;
    for (const f of fs.readdirSync(dp)) {
      if (!/\.webp$/i.test(f)) continue;
      const buf = fs.readFileSync(path.join(dp, f));
      // 사이트판은 경로만 알면 되므로 내용을 담지 않는다(HTML 이 8.47MB → 0.58MB 압축).
      if (!WEB) images[dir + '/' + f.normalize('NFC')] = 'data:image/webp;base64,' + buf.toString('base64');
      imgCount++; imgBytes += buf.length;
    }
  }
} else {
  console.warn('경고: assets/images 가 없습니다. `node tools/fetch_images.js` 를 먼저 실행하세요.');
}

// 데이터 신선도 배지용 — 빌드 시각과 총량을 앱에 주입한다.
// stamp 는 분 단위(로컬) — 배포 스탬프의 **원본**이다. update.ps1 이 이 값을 읽어
// APK versionName·OTA version.json·릴리스 노트에 그대로 쓴다. 예전엔 배포 때 Get-Date 로
// 따로 찍어서, 앱이 아는 값과 배포된 값이 서로 달랐다(같은 날 재배포를 PC 가 못 잡던 원인).
// date 와 stamp 는 **같은 시각에서 뽑는다.** 예전엔 date 만 UTC(toISOString)였는데,
// 한국 기준 00~09시에 빌드하면 date 가 하루 뒤처져 배지와 스탬프가 서로 다른 날을 가리켰다
// (갤러리에 기록되는 ver 도 같이 어긋난다).
const pad = n => String(n).padStart(2, '0');
const now = new Date();
const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const buildMeta = {
  date: day,
  stamp: `${day}-${pad(now.getHours())}${pad(now.getMinutes())}`,
  ms: msData.length,
  parts: Object.values(parts).reduce((a, b) => a + b.length, 0),
  weapons: Object.values(weapons).reduce((a, p) => a + p.weapons.length, 0)
};

// 사이트판만 검색 제외 표시를 단다. 주소를 아는 사람은 열 수 있지만 검색에는 안 잡힌다
// — 지금 파일을 주고받는 것과 같은 노출 수준이다. 나중에 열고 싶으면 이 한 줄과
// robots.txt 를 빼면 된다(오프라인판에는 애초에 들어가지 않는다).
const NOINDEX = '<meta name="robots" content="noindex, nofollow">\n';

const html = read('src', 'index.html')
  .replace('<title>', () => (WEB ? NOINDEX : '') + '<title>')
  .replace('/*__CSS__*/', () => read('src', 'style.css'))
  .replace('/*__BUILD__*/', () => inline('GBO2_BUILD', buildMeta))
  .replace('/*__DATA__*/', () => inline('GBO2_DATA', { msData, parts, fullst, msSkills }))
  .replace('/*__IMAGES__*/', () => inline('GBO2_IMAGES', images))
  .replace('/*__WEAPONS__*/', () => inline('GBO2_WEAPONS', weapons))
  .replace('/*__SKILLS__*/', () => inline('GBO2_SKILLS', skills))
  .replace('/*__I18N_DATA__*/', () => inline('GBO2_I18N', i18n))
  .replace('/*__CORE__*/', () => read('src', 'core.js'))
  .replace('/*__I18N__*/', () => read('src', 'i18n.js'))
  .replace('/*__OPT__*/', () => read('src', 'optimizer.js'))
  .replace('/*__DAMAGE__*/', () => read('src', 'damage.js'))
  .replace('/*__SHARE__*/', () => read('src', 'share.js'))
  .replace('/*__UI__*/', () => read('src', 'ui.js'));

for (const marker of ['__CSS__', '__BUILD__', '__DATA__', '__IMAGES__', '__WEAPONS__', '__SKILLS__', '__I18N_DATA__', '__CORE__', '__I18N__', '__OPT__', '__DAMAGE__', '__SHARE__', '__UI__']) {
  if (html.includes('/*' + marker + '*/')) throw new Error('unreplaced marker: ' + marker);
}

const DIST = WEB ? path.join(ROOT, 'dist', 'web') : path.join(ROOT, 'dist');
// 사이트판은 폴더를 통째로 비우고 다시 만든다. 배포는 이 폴더를 그대로 업로드하므로,
// 더 이상 만들지 않는 파일이 남아 있으면 계속 사이트에 올라간다(옛 배포에 쓰던 .git 도).
// 오프라인판의 dist 는 APK·배포본이 함께 쓰는 곳이라 비우지 않는다.
if (WEB) fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// 오프라인판은 이미지가 HTML 안에 있어 dist/images 가 필요 없다(진짜 단일 파일).
// 이전 빌드가 남긴 폴더가 있으면 지워 배포 크기를 줄인다.
// 사이트판은 반대로 여기에 이미지를 깐다 — 지웠다 다시 깔아 지워진 이미지가 남지 않게 한다.
fs.rmSync(path.join(DIST, 'images'), { recursive: true, force: true });
if (WEB && fs.existsSync(IMG_SRC)) fs.cpSync(IMG_SRC, path.join(DIST, 'images'), { recursive: true });
if (WEB) {
  fs.writeFileSync(path.join(DIST, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  // GitHub Pages 는 기본으로 Jekyll 을 돌리는데, Jekyll 은 '_' 로 시작하는 파일을 빼 버린다.
  // 우리 기본 이미지가 _default.webp 라 이게 없으면 그 이미지들이 통째로 404 가 된다.
  fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
}
const out = path.join(DIST, WEB ? 'index.html' : 'gbo2-simulator.html');
fs.writeFileSync(out, html);
console.log('built', out, (Buffer.byteLength(html) / 1024 / 1024).toFixed(2) + ' MB',
  '| 이미지', imgCount + '개 ' + (imgBytes / 1024 / 1024).toFixed(2) + ' MB',
  '| MS', msData.length,
  '| parts', Object.values(parts).reduce((a, b) => a + b.length, 0),
  '| 무장', Object.values(weapons).reduce((a, p) => a + p.weapons.length, 0),
  '| 사전', Object.keys(i18n.ms).length + '기체 / ' + Object.keys(i18n.parts).length + '파츠');
