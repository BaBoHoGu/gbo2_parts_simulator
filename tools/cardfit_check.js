// 첫 화면에 기체 카드가 **몇 장 온전히 보이는가** — 기기별 실측.
//   node tools/cardfit_check.js
//
// ■ 왜 — 폰을 가로로 돌리면 상단바 + 필터 + 안내문이 화면을 다 차지해 **카드가 한 장도
//   안 보였다**(2026-10-12 측정: 844×390 에서 0장). 스크롤을 내려야만 목록이 나왔다.
//   그런데 그걸 재는 자가 없었다 — 「가로에서 카드 0장」을 아무도 안 울었다.
//
// ■ 온전히 = 카드 전체가 목록 칸 안에 들어온다. 반쯤 잘린 것은 세지 않는다 —
//   잘린 카드는 「있는지 없는지」만 알려 주고 고르게 해 주지 않는다.
//
// ■ 이름이 잘리지 않는지도 같이 본다. 카드를 좁히면 수는 늘지만 「크로스본 건담 X2 개…」가
//   되어 LV 을 못 가린다. 두 값을 같이 재지 않으면 한쪽을 고치다 다른 쪽을 깬다.
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

/* min = 첫 화면에 온전히 보여야 하는 카드 수. 2026-10-14 실측에서 한 장 낮춰 잡았다 —
   글꼴 렌더가 기기마다 한 줄을 넘길 수 있다. was = 가로 수정 전 값(2026-10-12). */
const VIEWS = [
  { tag: '데스크톱 1500×1000', w: 1500, h: 1000, touch: false, mobile: false, min: 20, was: 30 },
  { tag: '노트북 1280×720', w: 1280, h: 720, touch: false, mobile: false, min: 10, was: 20 },
  { tag: '태블릿 1024×768', w: 1024, h: 768, touch: true, mobile: false, min: 8, was: 16 },
  { tag: '폰세로(넓게) 390×844', w: 390, h: 844, touch: true, mobile: false, viewMode: 'wide', min: 5, was: 4 },
  { tag: '폰세로(크게) 390×844', w: 390, h: 844, touch: true, mobile: true, viewMode: 'large', min: 5, was: 4 },
  { tag: '폰가로 844×390', w: 844, h: 390, touch: true, mobile: true, min: 2, was: 0 },
  { tag: '스타일러스 800×372', w: 800, h: 372, touch: false, mobile: true, min: 2, was: 0 }
];

(async () => {
  const rows = [];
  for (const v of VIEWS) {
    const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new',
      args: ['--no-sandbox', '--allow-file-access-from-files', '--hide-scrollbars'] });
    const pg = await br.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e.message).slice(0, 120)));
    await pg.setViewport({ width: v.w, height: v.h, isMobile: v.mobile, hasTouch: v.touch,
      deviceScaleFactor: 1 });
    await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
    await sleep(2600);
    if (v.viewMode) {
      await pg.evaluate(m => { try { localStorage.setItem('gbo2.viewMode', m); } catch { /* 무시 */ } }, v.viewMode);
      await pg.reload({ waitUntil: 'load', timeout: 180000 });
      await sleep(2600);
    }
    const r = await pg.evaluate(() => {
      const grid = document.querySelector('#msList');
      if (!grid) return { 오류: '#msList 없음' };
      const gb = grid.getBoundingClientRect();
      /* 목록 칸은 스스로 스크롤한다 — 「보인다」는 **그 칸 안에** 온전히 들어오는 것이다.
         화면(innerHeight)으로 재면 칸 밖으로 넘어간 카드를 보인다고 센다. */
      const top = Math.max(gb.top, 0), bot = Math.min(gb.bottom, window.innerHeight);
      const cards = [...grid.querySelectorAll('.ms-card')];
      let full = 0, part = 0;
      for (const c of cards) {
        const b = c.getBoundingClientRect();
        if (b.top >= top - 0.5 && b.bottom <= bot + 0.5) full++;
        else if (b.bottom > top && b.top < bot) part++;
      }
      /* 이름이 잘렸는가 — 카드를 좁히면 수는 늘지만 이름이 「…개」가 된다. */
      let clipped = 0, nm = 0;
      for (const c of cards.slice(0, 60)) {
        const n = c.querySelector('.nm');
        if (!n) continue;
        nm++;
        if (n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1) clipped++;
      }
      const cw = cards[0] ? Math.round(cards[0].getBoundingClientRect().width) : 0;
      /* 필터를 접었으면 **접힌 것이 닿는가**를 같이 본다 — 높이만 되찾고 거르기가
         못 쓰게 되면 아낀 뜻이 없다. 「보인다」가 아니라 그 자리를 눌렀을 때 그것이
         잡히는지로 본다(가려진 것도 click 은 먹는다 — gate-hit-test 교훈).
         검색은 칸 바닥에 붙여 두었으므로 끝까지 굴려도 닿아야 한다. */
      const head = document.querySelector('.screen-select .select-head')
        || document.querySelector('.select-head');
      const hit = el => {
        if (!el) return false;
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) return false;
        const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return !!(e && (e === el || el.contains(e) || e.contains(el)));
      };
      let folded = false, searchHit = null, lastChipHit = null;
      if (head) {
        folded = head.scrollHeight > head.clientHeight + 1;
        /* **굴려서 닿는가**로 본다. 한 자리(끝까지 굴린 뒤)만 보면 좁다 — 접힌 칸에서
           마지막 칩줄은 끝이 아니라 중간쯤에 온다(뒤에 검색줄이 있다). 사용자는 굴릴 수
           있으니, 어느 자리에서든 닿으면 닿는 것이다. 자리를 훑어 본다. */
        const rows = [...head.querySelectorAll('.filter-row')]
          .filter(e => e.getBoundingClientRect().height > 0);
        const last = rows[rows.length - 1];
        const target = last && (last.querySelector('button') || last);
        const span = Math.max(1, head.scrollHeight - head.clientHeight);
        const reach = el => {
          for (let i = 0; i <= 10; i++) {
            head.scrollTop = Math.round(span * i / 10);
            if (hit(el)) return true;
          }
          return false;
        };
        lastChipHit = target ? reach(target) : null;
        /* 검색은 **어느 자리에서나** 보여야 한다 — 그게 바닥에 붙여 둔 이유다.
           「끝까지 굴린 뒤」만 보면 붙이지 않아도 통과한다(검색줄이 마지막 자식이라
           바닥에서는 저절로 보인다) — 심어 보고 알았다. 맨 위·중간·끝을 다 본다. */
        const q = head.querySelector('#msQuery');
        searchHit = true;
        for (const t of [0, Math.round(span / 2), span]) {
          head.scrollTop = t;
          if (!hit(q)) { searchHit = false; break; }
        }
        head.scrollTop = 0;
      }
      return { full, part, clipped, nm, cw, cards: cards.length, folded, searchHit, lastChipHit,
        listH: Math.round(bot - top), vh: window.innerHeight };
    });
    await br.close();
    rows.push({ v, r, errs });
    if (r.오류) { console.log('  ' + v.tag + ' — ' + r.오류); continue; }
    console.log('  ' + v.tag.padEnd(22) + ' 온전히 ' + String(r.full).padStart(3) + '장'
      + (v.was != null ? ' (was ' + v.was + ')' : '')
      + ' · 반쯤 ' + String(r.part).padStart(2)
      + ' · 목록높이 ' + String(r.listH).padStart(4) + 'px'
      + ' · 카드폭 ' + String(r.cw).padStart(3) + 'px'
      + ' · 이름 잘림 ' + r.clipped + '/' + r.nm);
  }
  console.log('');
  for (const { v, r, errs } of rows) {
    if (r.오류) { ok(v.tag + ' 목록을 찾았다', false, r.오류); continue; }
    ok(v.tag + ' 에서 카드가 ' + v.min + '장 이상 온전히 보인다 (지금 ' + r.full + '장'
      + (v.was != null ? ' · was ' + v.was : '') + ')', r.full >= v.min,
      { 온전히: r.full, 반쯤: r.part, 목록높이: r.listH });
    /* 수만 재면 「카드를 잘게 쪼개서 통과」가 된다 — 이름이 잘리지 않는지 같이 본다. */
    ok(v.tag + ' 에서 기체 이름이 잘리지 않는다 (' + r.clipped + '/' + r.nm + ')',
      r.clipped === 0, { 잘림: r.clipped, 센것: r.nm, 카드폭: r.cw });
    /* 접은 화면에서는 **접힌 것이 닿아야** 한다 — 안 접힌 화면은 볼 것이 없다. */
    if (r.folded) {
      ok(v.tag + ' 필터를 접었어도 검색칸이 늘 보인다 (맨 위·중간·끝)', r.searchHit === true, r);
      ok(v.tag + ' 필터를 접었어도 마지막 칩줄이 닿는다', r.lastChipHit === true, r);
    }
    ok(v.tag + ' 콘솔 오류 없음', errs.length === 0, errs.slice(0, 2));
  }
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
