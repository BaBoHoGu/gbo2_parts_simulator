// 갤러리·스킬 도감·토큰·강화 플랜에서 뒤로가기는 **언제나 기체 선택**으로 간다.
//   node tools/auxback_check.js
//
// 예전엔 '들어오기 전 화면'으로 돌아갔는데, 그 넷이 서로를 기억해서 고리에 갇혔다.
// 사용자가 겪은 그대로: 강화 플랜 → 토큰 → 뒤로(강화 플랜) → 뒤로(토큰) → …
// 그래서 **고리 자체**를 재현해 본다. 한 번만 눌러 보는 검사는 이 버그를 못 잡는다.
const GBO2Browser = require('./lib/browser.js');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let puppeteer, findChrome;
try {
  puppeteer = require('puppeteer-core');
  ({ findChrome } = require('./lib/wiki_fetch.js'));
} catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }
const URL = 'file:///' + path.join(ROOT, 'dist', 'gbo2-simulator.html').replace(/\\/g, '/').replace(/ /g, '%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label + (!good && extra != null ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

// 버튼 id → 그 화면의 view 이름 · 「‹ 돌아가기」 버튼
const AUX = [
  { btn: '#galleryBtn', view: 'gallery', back: '#galleryBack', name: '갤러리' },
  { btn: '#codexBtn', view: 'codex', back: '#codexBack', name: '스킬 도감' },
  { btn: '#tokenBtn', view: 'token', back: '#tokenBack', name: '토큰' },
  { btn: '#planBtn', view: 'plan', back: '#planBack', name: '강화 플랜' }
];

(async () => {
  const br = await GBO2Browser.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files']
  });
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
  pg.on('dialog', d => d.accept());
  await pg.setViewport({ width: 1500, height: 1000 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await sleep(1800);

  const view = () => pg.evaluate(() => (document.body.className.match(/view-(\w+)/) || [])[1] || '?');
  const go = async sel => { await pg.evaluate(s => document.querySelector(s).click(), sel); await sleep(700); };
  const backBtn = async sel => { await pg.evaluate(s => document.querySelector(s).click(), sel); await sleep(700); };
  const backKey = async () => {
    const r = await pg.evaluate(() => window.GBO2Back());
    await sleep(600);
    return r;
  };

  // ── ① 넷 각각: 열고 「‹ 돌아가기」 → 기체 선택
  for (const a of AUX) {
    await go(a.btn);
    const inIt = await view();
    await backBtn(a.back);
    const out = await view();
    ok(a.name + ' 에서 「‹ 돌아가기」가 기체 선택으로 간다',
      inIt === a.view && out === 'select', { 들어감: inIt, 나옴: out });
  }

  // ── ② 넷 각각: 폰 뒤로가기도 기체 선택
  for (const a of AUX) {
    await go(a.btn);
    const r = await backKey();
    const out = await view();
    ok(a.name + ' 에서 뒤로가기가 기체 선택으로 간다',
      r === 'back' && out === 'select', { r, out });
  }

  /* ── ③ 사용자가 겪은 고리 — 화면끼리 건너뛴 뒤 뒤로가기를 거듭 눌러도 갇히지 않는다.
     넷을 서로 모두 짝지어(12가지) 건너뛰고, 뒤로가기 한 번에 기체 선택으로 나오는지 본다. */
  const loops = [];
  for (const a of AUX) {
    for (const b of AUX) {
      if (a === b) continue;
      await pg.evaluate(() => { const s = document.querySelector('.stepper li[data-step="select"]'); if (s) s.click(); });
      await sleep(400);
      await go(a.btn);
      await go(b.btn);                 // 화면에서 화면으로 바로 건너뛴다
      const r1 = await backKey();
      const v1 = await view();
      if (v1 !== 'select') loops.push({ 경로: a.name + ' → ' + b.name, 뒤로한번: v1, r: r1 });
    }
  }
  ok('화면끼리 건너뛴 뒤 뒤로가기 한 번이면 기체 선택이다 (12가지)',
    loops.length === 0, loops.slice(0, 3));

  // ── ④ 거듭 눌러도 두 화면 사이를 오가지 않는다 (사용자가 적어 준 그 순서)
  await pg.evaluate(() => { const s = document.querySelector('.stepper li[data-step="select"]'); if (s) s.click(); });
  await sleep(400);
  await go('#planBtn');
  await go('#tokenBtn');
  const seq = [];
  for (let i = 0; i < 4; i++) { await backKey(); seq.push(await view()); }
  ok('강화 플랜 → 토큰 → 뒤로 ×4 가 화면 사이를 오가지 않는다',
    seq[0] === 'select' && seq.every(v => v === 'select'), seq);

  // ── ⑤ 파츠 화면에서 들렀다 나와도 구성이 남는다 (기체 선택으로 보내므로 확인한다)
  await pg.evaluate(() => {
    const i = document.querySelector('#msQuery');
    i.value = '건담 Ez8'; i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(900);
  await pg.evaluate(() => document.querySelector('#msList .ms-card').click());
  await sleep(1300);
  // 파츠를 몇 개 단다. 수는 **화면에서** 읽는다 — 검사를 위해 전역을 새로 만들지 않는다.
  await pg.evaluate(() => {
    const t = [...document.querySelectorAll('#partList > *')].filter(e => e.tagName !== 'BUTTON');
    for (const e of t.slice(0, 2)) e.click();
  });
  await sleep(900);
  const equippedCount = () => pg.evaluate(() =>
    document.querySelectorAll('#equipped > *:not(.empty)').length);
  const before = await equippedCount();
  await go('#tokenBtn');
  await backKey();
  const afterView = await view();
  const canReturn = await pg.evaluate(() => {
    const li = document.querySelector('.stepper li[data-step="build"]');
    if (!li) return null;
    li.click();
    return (document.body.className.match(/view-(\w+)/) || [])[1];
  });
  await sleep(500);
  const after = await equippedCount();
  ok('파츠 화면에서 들렀다 나오면 기체 선택이다', afterView === 'select', afterView);
  ok('「2 파츠 적용」로 바로 돌아갈 수 있다', canReturn === 'build', canReturn);
  ok('파츠를 실제로 달았다 (검사가 헛돌지 않게)', before > 0, before);
  ok('돌아갔을 때 장착 파츠가 그대로다', before === after, { before, after });

  ok('페이지 오류 없음', errs.length === 0, errs.slice(0, 3));
  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
