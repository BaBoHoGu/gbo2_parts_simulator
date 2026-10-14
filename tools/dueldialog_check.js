// 대결 창이 **진짜 모달**로 도는가 — 실측(CSS 8단계).
//   node tools/dueldialog_check.js
//
// ■ 왜 — 대결 창은 div 에 z-index 70/71 을 손으로 골라 띄웠다. 그래서
//   · Tab 이 창 밖(상단바·파츠 목록)으로 새어 **안 보이는 뒤 화면**을 돌았고
//   · 닫아도 포커스가 연 단추로 안 돌아갔다(키보드 쓰는 사람은 자리를 잃는다).
//   <dialog> + showModal() 로 바꿨다. 이 자는 그 약속 다섯 가지를 본다:
//   ① 최상위 층에 뜬다(:modal) ② Tab 을 열 번 눌러도 창 안에 있다 ③ Esc 로 닫힌다
//   ④ 뒤판을 누르면 닫히고, 창 **안**을 누르면 안 닫힌다 ⑤ 닫으면 포커스가 연 단추로 간다
//   그리고 열 때 「닫기」에 포커스 고리가 그려지지 않는다(마우스로 열었는데 고리가 떴었다).
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

const state = pg => pg.evaluate(() => {
  const d = document.getElementById('duelModal');
  const a = document.activeElement;
  return {
    open: !!d && !d.hidden,
    modal: !!d && d.matches(':modal'),
    inside: !!d && (a === d || d.contains(a)),
    active: a ? (a.id || a.tagName + '.' + a.className).slice(0, 40) : null,
    ring: a ? getComputedStyle(a).outlineStyle : null,
  };
});

/* 상단바에 있는 「⚔ 대결」을 진짜 마우스로 누른다 — 접혀 있으면 넓은 화면을 쓴다 */
async function openByMouse(pg) {
  const b = await pg.evaluate(() => {
    const e = document.getElementById('duelBtn');
    const r = e.getBoundingClientRect();
    return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  });
  if (!b) return false;
  await pg.mouse.click(b.x, b.y);
  await sleep(700);
  return true;
}

(async () => {
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files', '--hide-scrollbars'] });
  const pg = await br.newPage();
  await pg.setViewport({ width: 1500, height: 950, deviceScaleFactor: 1 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(2600);
  await pg.evaluate(() => {
    const q = document.querySelector('#msQuery');
    q.value = '사자비'; q.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(500);
  await pg.evaluate(() => document.querySelector('#msList .ms-card').click());
  await sleep(700);
  await pg.evaluate(() => { const g = document.querySelector('#infoGo'); if (g) g.click(); });
  await sleep(1200);

  /* ① 열기 — 마우스로 */
  ok('「⚔ 대결」 단추가 상단바에 보인다', await openByMouse(pg));
  let s = await state(pg);
  ok('① 열면 최상위 층(:modal)에 뜬다', s.open && s.modal, s);
  ok('   열 때 포커스는 창 안에 있고 고리가 그려지지 않는다', s.inside && s.ring === 'none', s);

  /* ② Tab 이 새지 않는다 */
  const trail = [];
  for (let i = 0; i < 12; i++) {
    await pg.keyboard.press('Tab');
    trail.push(await state(pg));
  }
  const out = trail.filter(t => !t.inside).map(t => t.active);
  ok('② Tab 을 열두 번 눌러도 포커스가 창 밖으로 안 나간다', out.length === 0, out);

  /* ⑤-a 창 안을 누르면 안 닫힌다 — 머리줄 제목 자리 */
  const head = await pg.evaluate(() => {
    const r = document.querySelector('#duelModal .duel-head b').getBoundingClientRect();
    return { x: r.left + 5, y: r.top + r.height / 2 };
  });
  await pg.mouse.click(head.x, head.y);
  await sleep(300);
  ok('④ 창 안을 누르면 닫히지 않는다', (await state(pg)).open);

  /* ③ Esc */
  await pg.keyboard.press('Escape');
  await sleep(400);
  s = await state(pg);
  ok('③ Esc 로 닫힌다', !s.open && !s.modal, s);
  ok('⑤ 닫으면 포커스가 연 단추(⚔ 대결)로 돌아간다', s.active === 'duelBtn', s);
  const scroll = await pg.evaluate(() => document.documentElement.style.overflow);
  ok('   닫으면 뒤 화면 스크롤 잠금이 풀린다', scroll === '', scroll);

  /* ④ 뒤판 */
  await openByMouse(pg);
  const bd = await pg.evaluate(() => {
    const r = document.getElementById('duelModal').getBoundingClientRect();
    return { x: Math.max(2, r.left / 2), y: innerHeight - Math.max(2, (innerHeight - r.bottom) / 2) };
  });
  await pg.mouse.click(bd.x, bd.y);
  await sleep(400);
  s = await state(pg);
  ok('④ 뒤판(창 밖)을 누르면 닫힌다', !s.open, { ...s, 누른곳: bd });

  /* ⑥ 폰 「⋯」 메뉴에서 여는 길 — 메뉴 항목은 원본 단추를 click() 한다(포인터 없이).
     이 길에서는 Chrome 이 포커스 고리를 **그린다** — 마우스 길만 재면 「닫기」 고리를 못 본다. */
  /* **새 페이지에서** 잰다 — 앞에서 마우스를 쓴 페이지는 Chrome 이 「마우스 쓰는 중」 으로 기억해
     고리를 안 그린다(그래서 심어 봐도 안 울었다). 아무것도 안 누른 첫 화면이 폰 메뉴 길과 같다. */
  {
    const p2 = await br.newPage();
    /* **폰 크기**에서 — 데스크톱은 첫 칸이 검색창이라 고리가 안 보이고, 폰은 첫 단추가 「닫기」 라
       고리가 그려졌다(실측: 1500 은 INPUT.ds-search, 390 은 #duelClose · solid). */
    await p2.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await p2.goto(URL, { waitUntil: 'load', timeout: 180000 });
    await sleep(2400);
    await p2.evaluate(() => document.getElementById('duelBtn').click());
    await sleep(700);
    const s2 = await state(p2);
    ok('⑥ 메뉴 길(click())로 열어도 「닫기」 에 고리가 안 그려진다', s2.open && s2.inside && s2.ring === 'none', s2);
    await p2.close();
  }
  await pg.evaluate(() => document.getElementById('duelBtn').click());
  await sleep(700);

  /* ⑦ 폰 뒤로가기 몸짓 — 키 없이 dialog 에 cancel 만 온다(close watcher).
     cancel 을 안 받으면 창은 브라우저가 닫는데 hidden · 스크롤 잠금이 그대로 남는다. */
  const rc = await pg.evaluate(async () => {
    const d = document.getElementById('duelModal');
    if (typeof d.requestClose !== 'function') return { skip: true };
    d.requestClose();
    await new Promise(r => setTimeout(r, 300));
    return { hidden: d.hidden, modal: d.matches(':modal'), lock: document.documentElement.style.overflow };
  });
  if (rc.skip) console.log('  (참고) 이 Chrome 에 requestClose 가 없어 ⑦ 을 건너뛴다');
  else ok('⑦ 뒤로가기 몸짓(cancel)으로 닫히면 hidden · 스크롤 잠금도 풀린다',
    rc.hidden === true && !rc.modal && rc.lock === '', rc);

  /* 다시 열고 「닫기」 단추 — 앱의 뒤로가기(navBack)와 같은 길 */
  await openByMouse(pg);
  await pg.evaluate(() => document.getElementById('duelClose').click());
  await sleep(300);
  s = await state(pg);
  ok('   「닫기」 단추로 닫힌다 (:modal 도 풀린다)', !s.open && !s.modal, s);

  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
