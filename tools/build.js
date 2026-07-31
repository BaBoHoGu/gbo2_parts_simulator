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
  skillText: autoJson('skill_text.json'),   // 스킬 효과·설명 번역 (jp→ko)
  attr: misc.attr,
  kind: misc.kind
};

// </script> 가 데이터 안에 들어가도 파서가 깨지지 않도록 이스케이프한다.
const inline = (name, value) =>
  `window.${name}=` + JSON.stringify(value).replace(/<\/script/gi, '<\\/script') + ';';

const html = read('src', 'index.html')
  .replace('/*__CSS__*/', () => read('src', 'style.css'))
  .replace('/*__DATA__*/', () => inline('GBO2_DATA', { msData, parts, fullst, msSkills }))
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
