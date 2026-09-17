// 「기체 변경」 서랍이 실제로 도는지 실측한다.
//
//   node tools/msdrawer_check.js
//
// 목록·필터를 기체 선택 화면과 **한 벌로 나눠 쓴다.** 베껴 두면 반드시 어긋나므로
// 그렇게 했는데, 나눠 쓰면 이번엔 **한쪽만 갱신되는** 사고가 난다 —
// 필터를 서랍에서 만졌는데 저쪽 칩은 그대로이거나, 서랍을 닫아도 계속 그리거나.
// 그래서 여는 것만 보지 않고 **양쪽이 같이 움직이는지**까지 본다.
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

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  ' + extra : '')); }
};

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const pg = await br.newPage();
  await pg.setViewport({ width: 1500, height: 1000 });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 100)));
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(3500);

  // 파츠 화면까지 간다
  await pg.evaluate(() => {
    const i = document.querySelector('#msQuery');
    i.value = '건담 Ez8'; i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(800);
  await pg.evaluate(() => document.querySelector('.ms-card').click());
  await sleep(1000);
  await pg.evaluate(() => { const g = document.querySelector('#infoGo'); if (g) g.click(); });
  await sleep(1200);

  // 파츠를 몇 개 끼워 둔다 — 기체를 바꾸면 초기화된다고 알려야 한다
  await pg.evaluate(() => {
    const t = [...document.querySelectorAll('#partList .part-tile')].slice(0, 3);
    for (const x of t) x.click();
  });
  await sleep(700);
  const before = await pg.evaluate(() => ({
    ms: (document.querySelector('#heroName') || {}).textContent,
    parts: document.querySelectorAll('#equipped .eq:not(.empty)').length
  }));

  ok('서랍 버튼이 파츠 화면에 있다',
    await pg.evaluate(() => { const b = document.querySelector('#msSwapBtn'); return !!b && b.offsetParent !== null; }));

  await pg.evaluate(() => document.querySelector('#msSwapBtn').click());
  await sleep(700);
  const opened = await pg.evaluate(() => {
    const d = document.querySelector('#msDrawer');
    const r = d.getBoundingClientRect();
    return { open: d.classList.contains('open'), left: Math.round(r.left),
      cards: d.querySelectorAll('.ms-card').length,
      chips: d.querySelectorAll('.chip').length,
      count: (document.querySelector('#msDrawerCount') || {}).textContent };
  });
  ok('서랍이 왼쪽에서 열린다', opened.open && opened.left <= 1, '좌 ' + opened.left);
  ok('서랍에 기체 목록이 있다', opened.cards > 1, opened.cards + '개 · ' + opened.count);
  ok('서랍에 필터가 있다', opened.chips >= 10, '칩 ' + opened.chips + '개');
  // 서랍 카드에는 ⓘ 를 달지 않는다. 서랍은 파츠 화면 위에 열려 기체 정보 칸이 보일 자리가
  // 없어서, 달아 두면 눌러도 아무 일이 없는 죽은 손잡이가 된다(실측으로 확인했다).
  ok('서랍 카드에는 ⓘ 가 없다',
    await pg.evaluate(() => !document.querySelector('#msDrawerList .ms-card .ms-info')));

  // ── 필터: 서랍에서 만지면 양쪽이 같이 움직여야 한다 ──
  await pg.evaluate(() => {
    const chips = [...document.querySelectorAll('#dAttrChips .chip')];
    (chips[1] || chips[0]).click();      // 강습
  });
  await sleep(700);
  const sync = await pg.evaluate(() => {
    const on = sel => [...document.querySelectorAll(sel + ' .chip')].findIndex(c => c.classList.contains('on'));
    return { drawer: on('#dAttrChips'), select: on('#attrChips'),
      cards: document.querySelectorAll('#msDrawer .ms-card').length };
  });
  ok('서랍 필터가 기체 선택 화면과 같이 움직인다', sync.drawer === sync.select && sync.drawer > 0,
    '서랍 ' + sync.drawer + ' · 선택화면 ' + sync.select);
  ok('필터가 목록을 실제로 줄인다', sync.cards > 0 && sync.cards < 1709, sync.cards + '개');

  // ── 검색 ──
  await pg.evaluate(() => {
    const i = document.querySelector('#msDrawerQuery');
    i.value = '자쿠'; i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(800);
  const searched = await pg.evaluate(() => ({
    cards: document.querySelectorAll('#msDrawer .ms-card').length,
    mirrored: (document.querySelector('#msQuery') || {}).value
  }));
  ok('서랍에서 검색이 된다', searched.cards > 0, searched.cards + '개');
  ok('검색어가 양쪽 칸에 같이 적힌다', searched.mirrored === '자쿠', '「' + searched.mirrored + '」');

  // ── 고르면 그 자리에서 기체가 바뀐다 ──
  const pickName = await pg.evaluate(() => {
    const c = document.querySelector('#msDrawer .ms-card');
    const n = c.querySelector('.nm').textContent;
    c.click();
    return n;
  });
  await sleep(1200);
  const after = await pg.evaluate(() => ({
    ms: (document.querySelector('#heroName') || {}).textContent,
    view: document.body.className,
    open: document.querySelector('#msDrawer').classList.contains('open'),
    parts: document.querySelectorAll('#equipped .eq:not(.empty)').length
  }));
  ok('고르면 서랍이 닫힌다', !after.open);
  ok('파츠 화면에 그대로 머문다', /view-build/.test(after.view), after.view);
  ok('기체가 실제로 바뀐다', after.ms !== before.ms && after.ms.includes(pickName.split(' ')[0]),
    '전「' + before.ms + '」후「' + after.ms + '」고른 것「' + pickName + '」');
  ok('장착 파츠가 초기화된다', before.parts > 0 && after.parts === 0,
    '전 ' + before.parts + '개 → 후 ' + after.parts + '개');

  // ── 닫은 뒤에는 서랍 목록을 더 그리지 않는다 ──
  const stale = await pg.evaluate(() => {
    const n0 = document.querySelectorAll('#msDrawerList .ms-card').length;
    const i = document.querySelector('#msQuery');
    i.value = '건담'; i.dispatchEvent(new Event('input', { bubbles: true }));
    return { n0 };
  });
  await sleep(700);
  const after2 = await pg.evaluate(() => document.querySelectorAll('#msDrawerList .ms-card').length);
  ok('닫힌 서랍은 다시 그리지 않는다', after2 === stale.n0, '전 ' + stale.n0 + ' → 후 ' + after2);

  // ── 기체 카드: 본체는 바로 파츠로, ⓘ 로만 정보를 연다 ──
  // 자리는 사용자가 정했다 — 가로는 즐겨찾기 ★, 세로는 등급(★★★) 줄.
  // 바닥에서 띄워 잡으면 카드 높이가 달라질 때 어긋나고, 등급 줄 안에 그냥 넣으면
  // 줄이 접혀 카드가 커진다. 둘 다 실제로 밟았으므로 **자리까지** 잰다.
  await pg.evaluate(() => document.querySelector('#backToSelect').click());
  await sleep(900);
  const card = await pg.evaluate(() => {
    const c = document.querySelector('#msList .ms-card');
    const cb = c.getBoundingClientRect();
    const g = sel => { const e = c.querySelector(sel); if (!e) return null;
      const b = e.getBoundingClientRect();
      return { right: b.right - cb.right, midY: b.top + b.height / 2 - cb.top }; };
    return { fav: g('.ms-fav'), info: g('.ms-info'), stars: g('.stars'), h: cb.height };
  });
  ok('카드에 ⓘ 가 있다', !!card.info);
  if (card.info && card.fav) {
    ok('ⓘ 가 ★ 와 같은 가로에 있다', Math.abs(card.info.right - card.fav.right) <= 2,
      '차 ' + Math.round(Math.abs(card.info.right - card.fav.right)) + 'px');
  }
  if (card.info && card.stars) {
    ok('ⓘ 가 등급 줄과 같은 세로에 있다', Math.abs(card.info.midY - card.stars.midY) <= 3,
      '차 ' + Math.round(Math.abs(card.info.midY - card.stars.midY)) + 'px');
  }
  ok('카드가 한 줄 높이를 지킨다', card.h <= 84, '높이 ' + Math.round(card.h) + 'px');

  await pg.evaluate(() => document.querySelector('#msList .ms-card').click());
  await sleep(1100);
  ok('카드를 누르면 곧바로 파츠로 간다',
    await pg.evaluate(() => /view-build/.test(document.body.className)));
  await pg.evaluate(() => document.querySelector('#backToSelect').click());
  await sleep(900);
  await pg.evaluate(() => document.querySelector('#msList .ms-card .ms-info').click());
  await sleep(1000);
  const infoOpen = await pg.evaluate(() => ({
    cls: document.body.className,
    shown: (() => { const b = document.querySelector('#infoBody'); return !!b && !b.hidden; })()
  }));
  ok('ⓘ 를 누르면 기체 정보가 열린다',
    /info-open/.test(infoOpen.cls) && !/view-build/.test(infoOpen.cls) && infoOpen.shown,
    JSON.stringify(infoOpen));

  ok('스크립트 오류 없음', errs.length === 0, [...new Set(errs)].slice(0, 2).join(' | '));
  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
