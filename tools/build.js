// src/ + data/ 를 하나의 오프라인 HTML 파일로 합친다.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const readJson = (...p) => JSON.parse(read(...p));

const msData = readJson('data', 'msData.json');
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
const fullst = readJson('data', 'fullst.json');
const weapons = readJson('data', 'weapons.json');
const skills = readJson('data', 'skills.json');

const misc = readJson('data', 'i18n', 'misc.json');
// 신규 기체 자동 음차(ms.auto.json)를 밑에 깔고, 수작업 사전(ms.json)이 덮어쓴다.
const msAuto = fs.existsSync(path.join(__dirname, '..', 'data', 'i18n', 'ms.auto.json'))
  ? readJson('data', 'i18n', 'ms.auto.json') : {};
const i18n = {
  ms: { ...msAuto, ...readJson('data', 'i18n', 'ms.json') },
  parts: readJson('data', 'i18n', 'parts.json'),
  weapons: readJson('data', 'i18n', 'weapons.json'),
  // 설명문 안의 고유명사도 같은 사전으로 옮긴다
  terms: readJson('data', 'i18n', 'weapon_terms.json'),
  attr: misc.attr,
  kind: misc.kind
};

// </script> 가 데이터 안에 들어가도 파서가 깨지지 않도록 이스케이프한다.
const inline = (name, value) =>
  `window.${name}=` + JSON.stringify(value).replace(/<\/script/gi, '<\\/script') + ';';

const html = read('src', 'index.html')
  .replace('/*__CSS__*/', () => read('src', 'style.css'))
  .replace('/*__DATA__*/', () => inline('GBO2_DATA', { msData, parts, fullst }))
  .replace('/*__WEAPONS__*/', () => inline('GBO2_WEAPONS', weapons))
  .replace('/*__SKILLS__*/', () => inline('GBO2_SKILLS', skills))
  .replace('/*__I18N_DATA__*/', () => inline('GBO2_I18N', i18n))
  .replace('/*__CORE__*/', () => read('src', 'core.js'))
  .replace('/*__I18N__*/', () => read('src', 'i18n.js'))
  .replace('/*__OPT__*/', () => read('src', 'optimizer.js'))
  .replace('/*__DAMAGE__*/', () => read('src', 'damage.js'))
  .replace('/*__UI__*/', () => read('src', 'ui.js'));

for (const marker of ['__CSS__', '__DATA__', '__WEAPONS__', '__SKILLS__', '__I18N_DATA__', '__CORE__', '__I18N__', '__OPT__', '__DAMAGE__', '__UI__']) {
  if (html.includes('/*' + marker + '*/')) throw new Error('unreplaced marker: ' + marker);
}

const DIST = path.join(ROOT, 'dist');
fs.mkdirSync(DIST, { recursive: true });

// 이미지는 용량이 커서 인라인하지 않고 HTML 옆 폴더로 복사한다 (file:// 에서도 로드됨).
const IMG_SRC = path.join(ROOT, 'assets', 'images');
let imgCount = 0, imgBytes = 0;
if (fs.existsSync(IMG_SRC)) {
  fs.rmSync(path.join(DIST, 'images'), { recursive: true, force: true });
  fs.cpSync(IMG_SRC, path.join(DIST, 'images'), { recursive: true });
  for (const dir of fs.readdirSync(path.join(DIST, 'images'))) {
    for (const f of fs.readdirSync(path.join(DIST, 'images', dir))) {
      imgCount++;
      imgBytes += fs.statSync(path.join(DIST, 'images', dir, f)).size;
    }
  }
} else {
  console.warn('경고: assets/images 가 없습니다. `node tools/fetch_images.js` 를 먼저 실행하세요.');
}

const out = path.join(DIST, 'gbo2-simulator.html');
fs.writeFileSync(out, html);
console.log('built', out, (Buffer.byteLength(html) / 1024 / 1024).toFixed(2) + ' MB',
  '| 이미지', imgCount + '개 ' + (imgBytes / 1024 / 1024).toFixed(2) + ' MB',
  '| MS', msData.length,
  '| parts', Object.values(parts).reduce((a, b) => a + b.length, 0),
  '| 무장', Object.values(weapons).reduce((a, p) => a + p.weapons.length, 0),
  '| 사전', Object.keys(i18n.ms).length + '기체 / ' + Object.keys(i18n.parts).length + '파츠');
