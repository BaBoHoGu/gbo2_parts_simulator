// 누르는 것이 **모두 키보드로 닿고, Enter/Space 로 눌리는가** — 실측(CSS 10단계, 가이드 #12).
//   node tools/kbdreach_check.js
//
// ■ 왜 — 5단계에서 기체 카드·파츠 타일만 손으로 키보드에 달았다. 재 보니 onclick 만 있고 Tab 이
//   안 가는 것이 화면마다 남아 있었다(무장 줄 9 · 장착 칸 · 잠금 · 갤러리 카드 · 스킬 도감 302 ·
//   패치노트 카드 · 단계 표시 …). ui.js setupKbdAuto 가 **붙는 순간** 한 곳에서 단다.
//   이 자는 화면마다 「onclick 이 있는데 Tab 이 안 가는 것」 이 0 인지 세고,
//   몇 가지는 진짜 키보드로 눌러 클릭과 같은 일이 일어나는지 본다(달기만 하고 안 눌리면 헛것이다).
'use strict';
const GBO2Browser = require('./lib/browser.js');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let findChrome;
try { require('puppeteer-core'); ({ findChrome } = require('./lib/wiki_fetch.js')); }
catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }
const FILE = path.join(ROOT, 'dist', 'gbo2-simulator.html');
if (!fs.existsSync(FILE)) { console.log('SKIP  dist 없음'); process.exit(0); }
const URL = 'file:///' + FILE.split(path.sep).join('/').split(' ').join('%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label
    + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

/* onclick 이 있는데 Tab 이 안 가는 것 — 뒤판(누르면 닫히는 덮개)은 일부러 뺀 것이라 세지 않는다 */
const SCAN = () => {
  const NATIVE = /^(BUTTON|A|INPUT|SELECT|TEXTAREA|LABEL|SUMMARY|DIALOG|OPTION|DETAILS)$/;
  const out = {};
  for (const e of document.querySelectorAll('body *')) {
    if (typeof e.onclick !== 'function' || NATIVE.test(e.tagName) || e.tabIndex >= 0) continue;
    if (e.matches('.auto-modal-back, .drawer-back, .duel-back, .sheet-backdrop, [id$="Back"], [data-no-kbd]')) continue;
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const k = e.tagName + '.' + String(e.className).split(' ')[0];
    out[k] = (out[k] || 0) + 1;
  }
  return out;
};

(async () => {
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files', '--hide-scrollbars'] });
  const pg = await br.newPage();
  pg.on('dialog', d => d.accept('kbd').catch(() => {}));
  await pg.setViewport({ width: 1500, height: 1000, deviceScaleFactor: 1 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(2400);
  const scan = async tag => {
    const r = await pg.evaluate(SCAN);
    const n = Object.values(r).reduce((a, b) => a + b, 0);
    ok(tag + ' — onclick 이 있는데 Tab 이 안 가는 것이 없다 (' + n + '개)', n === 0, r);
  };

  await scan('기체 선택');
  await pg.evaluate(() => {
    const q = document.querySelector('#msQuery');
    q.value = '사자비'; q.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(500);
  await pg.evaluate(() => document.querySelector('#msList .ms-card').click());
  await sleep(600);
  await scan('기체 정보 칸');
  await pg.evaluate(() => { const g = document.querySelector('#infoGo'); if (g) g.click(); });
  await sleep(900);
  await pg.evaluate(() => { [...document.querySelectorAll('#partList .part-tile')].slice(0, 2).forEach(t => t.click()); });
  await sleep(500);
  await scan('파츠 적용');

  /* 장착 칸에 포커스 → Enter → 해제된다 (클릭과 같은 일) */
  const before = await pg.evaluate(() => document.querySelectorAll('#equipped .eq:not(.empty)').length);
  await pg.evaluate(() => document.querySelector('#equipped .eq:not(.empty)').focus());
  await pg.keyboard.press('Enter');
  await sleep(500);
  const after = await pg.evaluate(() => document.querySelectorAll('#equipped .eq:not(.empty)').length);
  ok('장착 칸에서 Enter — 파츠가 해제된다 (' + before + ' → ' + after + ')', after === before - 1, { before, after });

  /* 단계 표시 「기체 선택」 에 포커스 → Space → 기체 선택 화면으로. Space 가 화면을 내리지 않는다 */
  await pg.evaluate(() => window.scrollTo(0, 0));
  await pg.evaluate(() => document.querySelector('#stepper li[data-step="select"]').focus());
  const y0 = await pg.evaluate(() => scrollY);
  await pg.keyboard.press('Space');
  await sleep(600);
  const v = await pg.evaluate(() => ({ select: document.body.classList.contains('view-select'), y: scrollY }));
  ok('단계 표시에서 Space — 기체 선택으로 간다', v.select, v);
  ok('   Space 가 화면을 내리지 않는다', v.y === y0, { y0, y: v.y });

  /* 스킬 도감 — 302줄 중 아무 줄에 Enter → 그 줄이 골라진다 */
  await pg.evaluate(() => document.getElementById('codexBtn').click());
  await sleep(1500);
  await scan('스킬 도감');
  const pick = await pg.evaluate(() => {
    const it = [...document.querySelectorAll('.codex-item')][5];
    if (!it) return null;
    it.focus();
    return it.querySelector('.codex-nm') ? it.querySelector('.codex-nm').textContent : it.textContent;
  });
  await pg.keyboard.press('Enter');
  await sleep(600);
  const on = await pg.evaluate(() => {
    const e = document.querySelector('.codex-item.on .codex-nm') || document.querySelector('.codex-item.on');
    return e ? e.textContent : null;
  });
  ok('스킬 도감 줄에서 Enter — 그 줄이 골라진다', !!pick && on === pick, { pick, on });

  for (const [tag, id] of [['갤러리', 'galleryBtn'], ['패치노트', 'patchBtn'], ['토큰', 'tokenBtn'], ['강화 플랜', 'planBtn']]) {
    await pg.evaluate(id => { const b = document.getElementById(id); if (b) b.click(); }, id);
    await sleep(1500);
    await scan(tag);
  }

  /* 뒤판은 Tab 에 안 걸려야 한다 — 걸리면 「닫기」 를 두 번 지난다 */
  const backs = await pg.evaluate(() => [...document.querySelectorAll('.auto-modal-back, .drawer-back, .duel-back, .sheet-backdrop')]
    .filter(e => e.tabIndex >= 0).map(e => e.id || e.className));
  ok('뒤판(덮개)은 Tab 에 걸리지 않는다', backs.length === 0, backs);

  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
