// 「끼워도 아무 수치도 안 바뀌는 파츠」를 전수로 찾아, 화면이 그 사실을 밝히는지 본다.
//
//   node tools/part_effect_check.js
//
// 왜 필요한가 — 파츠 효과는 위키 원문을 정규식으로 읽는다. 문구가 조금만 달라도 조용히
// 0 이 되는데, 설명은 화면에 그대로 보이니 아무도 모른다(part-effect-parser 메모).
// 그래서 코드를 읽지 않고 **실제로 끼웠다 빼며** 화면 숫자를 떠서 비교한다.
//
// 두 방향을 다 본다:
//   ① 아무것도 안 바뀌는데 「반영 안 됨」 고지가 없다  → 사용자가 슬롯을 헛되이 쓴다
//   ② 고지를 달아 뒀는데 실제로는 수치가 바뀐다        → 고지가 거짓말이다
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let puppeteer, findChrome;
try {
  puppeteer = require('puppeteer-core');
  ({ findChrome } = require('./lib/wiki_fetch.js'));
} catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }

const FILE = path.join(ROOT, 'dist', 'gbo2-simulator.html');
if (!fs.existsSync(FILE)) { console.log('SKIP  dist 없음'); process.exit(0); }
const URL = 'file:///' + FILE.replace(/\\/g, '/').replace(/ /g, '%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const parts = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/parts.json'), 'utf8'));
const i18n = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/i18n/parts.json'), 'utf8'));
const koOf = n => (i18n[n] && i18n[n].n) || n;
// 수치가 적힌 파츠만 본다 — 「효과 없음」이라 적힌 것까지 셀 필요는 없다.
const targets = Object.values(parts).flat()
  .filter(p => /\d+\s*[%％]|\d{2,}/.test(String(p.description || '')));

/* 조건이 맞아야만 수치가 움직이는 파츠 — 시험 기체에서는 안 변하는 것이 정상이다.
   (특수 연소제는 소이 무장이 있어야, 이레귤러 DBL 은 상태이상 무장이 있어야 걸린다)
   여기 적는 것은 「파서가 실제로 있다」를 확인하고 넣는다. */
const CONDITIONAL = new Set([
  '特殊燃焼剤', 'イレギュラーDBL', '試験型イレギュラーDBL_LV1',
  'AD-ASL_LV2', '電子防護システム_LV1'
]);

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const pg = await br.newPage();
  await pg.setViewport({ width: 1600, height: 1200 });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 80)));
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(4000);
  // 슬롯이 넉넉한 고레벨 기체로 — 슬롯 부족으로 못 끼우면 판정이 안 선다
  await pg.evaluate(() => {
    const i = document.querySelector('#msQuery'); i.value = '건담 Ez8';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(900);
  await pg.evaluate(() => { const c = document.querySelector('.ms-card'); if (c) c.click(); });
  await sleep(1100);
  await pg.evaluate(() => { const g = document.querySelector('#infoGo'); if (g) g.click(); });
  await sleep(1600);

  const SNAP = () => {
    const out = [];
    for (const sel of ['.stat-row', '.dura-row', '.thr-row', '.mi-sg', '#weaponList', '.stagger-row'])
      for (const el of document.querySelectorAll(sel))
        for (const m of (el.innerText || '').matchAll(/[\d,]+(?:\.\d+)?/g)) out.push(m[0]);
    return out.join('|');
  };

  let pass = 0, fail = 0;
  const bad1 = [], bad2 = [], skipped = [];
  for (const p of targets) {
    await pg.evaluate(() => { const b = document.querySelector('#clearParts'); if (b) b.click(); });
    await sleep(260);
    const before = await pg.evaluate(SNAP);
    const ok = await pg.evaluate(k => {
      const i = document.querySelector('#partQuery'); i.value = k;
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, koOf(p.name));
    await sleep(340);
    await pg.evaluate(() => { const c = document.querySelector('#partList > *'); if (c) c.click(); });
    await sleep(340);
    const on = await pg.evaluate(() => document.querySelectorAll('#equipped .eq:not(.empty)').length);
    if (!ok || !on) { skipped.push(p.name); continue; }
    const after = await pg.evaluate(SNAP);
    const moved = before !== after;
    const marked = await pg.evaluate(() => !!document.querySelector('#partDetail .d-unmod, .d-unmod'));
    if (!moved && !marked && !CONDITIONAL.has(p.name)) bad1.push(koOf(p.name));
    if (moved && marked) bad2.push(koOf(p.name));
  }
  await br.close();

  const check = (label, cond, extra) => {
    if (cond) { pass++; console.log('  PASS ' + label); }
    else { fail++; console.log('  FAIL ' + label + (extra ? '\n      ' + extra : '')); }
  };

  console.log('수치가 적힌 파츠 ' + targets.length + '종을 하나씩 끼워 봤다'
    + (skipped.length ? ' (못 끼운 것 ' + skipped.length + ' 제외)' : '') + '\n');
  check('아무것도 안 바뀌는데 고지가 없는 파츠가 없다', bad1.length === 0,
    bad1.length ? bad1.join(', ') + '\n      → UNMODELLED_FX 에 넣거나, 효과를 구현하세요.' : '');
  check('고지를 달았는데 수치가 바뀌는 파츠가 없다', bad2.length === 0,
    bad2.length ? bad2.join(', ') + '\n      → 구현됐으면 UNMODELLED_FX 에서 그 줄을 지우세요.' : '');
  check('스크립트 오류 없음', errs.length === 0, [...new Set(errs)].join(' / '));

  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
