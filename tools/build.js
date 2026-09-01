// src/ + data/ 를 하나의 오프라인 HTML 파일로 합친다.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const readJson = (...p) => JSON.parse(read(...p));

const msData = readJson('data', 'msData.json');
// 공식 미러(gbo2.jp)에 아직 없는 기체(예: 갓 추가된 LV — 위키엔 있으나 미러 반영 전)를 보탠다.
// 이미 같은 MS名 이 있으면 건너뛴다 → 나중에 공식에 반영되면 이 추가분은 자동 무시된다.
{
  const addPath = path.join(ROOT, 'data', 'msData.additions.json');
  if (fs.existsSync(addPath)) {
    const adds = JSON.parse(fs.readFileSync(addPath, 'utf8'));
    const have = new Set(msData.map(m => m.MS名));
    let n = 0;
    for (const m of adds) if (!have.has(m.MS名)) { msData.push(m); n++; }
    if (n) console.log(`추가 기체 병합: ${n}기 (msData.additions.json)`);
  }
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
// 미러에 같은 이름이 생기면 그쪽이 이기고 추가분은 자동으로 빠진다(중복 걱정 없음).
{
  const add = readJson('data', 'parts.additions.json');
  let n = 0;
  for (const [cat, list] of Object.entries(add)) {
    if (cat.startsWith('_') || !Array.isArray(list)) continue;   // _주석 같은 메타 키는 건너뛴다
    if (!parts[cat]) parts[cat] = [];
    const have = new Set(parts[cat].map(x => x.name));
    for (const it of list) {
      if (!it || typeof it !== 'object' || !it.name) continue;    // 문자열 등 잘못된 항목 방어
      if (have.has(it.name)) continue;
      parts[cat].push(it); n++;
    }
  }
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
  kind: misc.kind
};

// </script> 가 데이터 안에 들어가도 파서가 깨지지 않도록 이스케이프한다.
const inline = (name, value) =>
  `window.${name}=` + JSON.stringify(value).replace(/<\/script/gi, '<\\/script') + ';';

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
      images[dir + '/' + f.normalize('NFC')] = 'data:image/webp;base64,' + buf.toString('base64');
      imgCount++; imgBytes += buf.length;
    }
  }
} else {
  console.warn('경고: assets/images 가 없습니다. `node tools/fetch_images.js` 를 먼저 실행하세요.');
}

// 데이터 신선도 배지용 — 빌드 시각과 총량을 앱에 주입한다.
const buildMeta = {
  date: new Date().toISOString().slice(0, 10),
  ms: msData.length,
  parts: Object.values(parts).reduce((a, b) => a + b.length, 0),
  weapons: Object.values(weapons).reduce((a, p) => a + p.weapons.length, 0)
};

const html = read('src', 'index.html')
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
  .replace('/*__UI__*/', () => read('src', 'ui.js'));

for (const marker of ['__CSS__', '__BUILD__', '__DATA__', '__IMAGES__', '__WEAPONS__', '__SKILLS__', '__I18N_DATA__', '__CORE__', '__I18N__', '__OPT__', '__DAMAGE__', '__UI__']) {
  if (html.includes('/*' + marker + '*/')) throw new Error('unreplaced marker: ' + marker);
}

const DIST = path.join(ROOT, 'dist');
fs.mkdirSync(DIST, { recursive: true });

// 이미지는 이제 HTML 에 data URI 로 인라인된다 → dist/images 폴더는 더 이상 필요 없다(진짜 단일 파일).
// 이전 빌드가 남긴 폴더가 있으면 지워 배포 크기를 줄인다.
fs.rmSync(path.join(DIST, 'images'), { recursive: true, force: true });

const out = path.join(DIST, 'gbo2-simulator.html');
fs.writeFileSync(out, html);
console.log('built', out, (Buffer.byteLength(html) / 1024 / 1024).toFixed(2) + ' MB',
  '| 이미지', imgCount + '개 ' + (imgBytes / 1024 / 1024).toFixed(2) + ' MB',
  '| MS', msData.length,
  '| parts', Object.values(parts).reduce((a, b) => a + b.length, 0),
  '| 무장', Object.values(weapons).reduce((a, p) => a + p.weapons.length, 0),
  '| 사전', Object.keys(i18n.ms).length + '기체 / ' + Object.keys(i18n.parts).length + '파츠');
