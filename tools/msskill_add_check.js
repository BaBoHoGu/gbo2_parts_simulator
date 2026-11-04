// 위키 스킬 표가 빠뜨린 스킬 보탬(data/ms_skills.additions.json)이 앱까지 가는가 · 위키가 따라잡으면 저절로 빠지는가.
//
//   node tools/msskill_add_check.js        (먼저 node tools/build.js)
//
// 건담 DX 는 인게임 스킬이 16개인데 위키 표에는 15개다 — ダメージコントロール LV2 가 출시 때부터 빠져 있어
// 갱신으로는 영영 안 들어왔다(사용자 인게임 확인 2026-11-03). 이 스킬은 경직 누적치(160%)에 닿아 대결 계산도 달라진다.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const D = require('./lib/dataset.js');

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra != null ? '  ' + JSON.stringify(extra) : '')); }
};
const rd = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));
const rowsOf = groups => (groups || []).flatMap(g => g.skills || []);

/* ① 보탬 파일 — 근거(src)가 있고, 대상 기체가 스킬 데이터에 있다 */
const ADD = rd('data', 'ms_skills.additions.json');
const S0 = rd('data', 'ms_skills.json');
const entries = Object.entries(ADD).filter(([k]) => !k.startsWith('_')).flatMap(([ms, l]) => l.map(a => [ms, a]));
ok('보탠 행마다 근거(src)가 적혀 있다', entries.length > 0 && entries.every(([, a]) => a.src && a.row && a.row.name && a.row.lv),
  entries.filter(([, a]) => !a.src).map(([ms]) => ms));
ok('보탠 기체가 스킬 데이터에 있다', entries.every(([ms]) => S0[ms]), entries.filter(([ms]) => !S0[ms]).map(([ms]) => ms));

/* ② 합친 결과 — DX 에 ダメージコントロール LV2 가 생기고, 인게임 16개가 된다 */
ok('mergeMsSkillAdditions 가 있다', typeof D.mergeMsSkillAdditions === 'function');
if (typeof D.mergeMsSkillAdditions === 'function') {
  const S = rd('data', 'ms_skills.json');
  const r = D.mergeMsSkillAdditions(ROOT, S);
  const dx = rowsOf(S['ガンダムDX']);
  ok('건담 DX 에 ダメージコントロール LV2 가 있다', dx.some(x => x.name === 'ダメージコントロール' && x.lv === 'LV2'), r);
  ok('건담 DX 스킬이 인게임처럼 16개다(바닥)', dx.length >= 16, { 개수: dx.length });
  /* ②-2 같은 이름의 다른 LV 를 나누어 보탠 행(sameLv) — 공식 「LV3以上の機体スキル「強制噴射装置LV2」を「LV3」に上昇」, 위키 표는 LV2 한 줄뿐 */
  const kp = rowsOf(S['カプール']).filter(x => x.name === '強制噴射装置' && x.lv === 'LV3');
  ok('카풀 カプール 에 強制噴射装置 LV3 (LV3～) 행이 있다', kp.length === 1 && kp[0].msLv === 'LV3～', kp);
  /* ③ 위키가 따라잡으면 — 같은 이름이 이미 있으면 보태지 않는다(두 줄이 되면 안 된다) */
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'msadd-'));
  try {
    fs.mkdirSync(path.join(T, 'data'));
    fs.copyFileSync(path.join(ROOT, 'data', 'ms_skills.additions.json'), path.join(T, 'data', 'ms_skills.additions.json'));
    const S2 = rd('data', 'ms_skills.json');
    S2['ガンダムDX'][0].skills.push({ name: 'ダメージコントロール', lv: 'LV3', msLv: 'LV1～' });   // 위키가 (다른 LV 로) 적었다고 치자
    const r2 = D.mergeMsSkillAdditions(T, S2);
    ok('위키에 같은 이름이 생기면 보태지 않고 따라잡음으로 알린다',
      rowsOf(S2['ガンダムDX']).filter(x => x.name === 'ダメージコントロール').length === 1 && r2.caught.length >= 1, r2);
    const S3 = rd('data', 'ms_skills.json');
    S3['カプール'][0].skills.push({ name: '強制噴射装置', lv: 'LV3', msLv: 'LV3～' });   // 위키가 LV3 행을 적었다고 치자
    D.mergeMsSkillAdditions(T, S3);
    ok('sameLv 행은 같은 LV 가 위키에 생기면 저절로 빠진다',
      rowsOf(S3['カプール']).filter(x => x.name === '強制噴射装置' && x.lv === 'LV3').length === 1);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
}

/* ④ 빌드된 앱 — 앱이 실제로 읽는 데이터에 실렸는가 */
(async () => {
  const FILE = path.join(ROOT, 'dist', 'gbo2-simulator.html');
  let puppeteer, findChrome;
  try { puppeteer = require('puppeteer-core'); ({ findChrome } = require('./lib/wiki_fetch.js')); } catch { puppeteer = null; }
  const CHROME = puppeteer && findChrome();
  if (!fs.existsSync(FILE) || !CHROME) console.log('  (앱 확인 건너뜀 — dist 또는 Chrome 없음)');
  else {
    const GBO2Browser = require('./lib/browser.js');
    const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
    try {
      const pg = await br.newPage();
      await pg.goto('file:///' + FILE.replace(/\\/g, '/').replace(/ /g, '%20'), { waitUntil: 'load', timeout: 180000 });
      const got = await pg.evaluate(() => ((window.GBO2_DATA || {}).msSkills || {})['ガンダムDX'] || null);
      const rows = rowsOf(got);
      ok('앱 데이터의 건담 DX 에 ダメージコントロール LV2 가 있다', rows.some(x => x.name === 'ダメージコントロール' && x.lv === 'LV2'), { 개수: rows.length });
    } finally { await br.close(); }
  }
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
