// 상단바가 **모든 폭에서** 한 줄인가 · 접힌 버튼이 「⋯」 에 다 있는가 · 토스트가 고지를 안 가리는가 — 실측.
//   node tools/topfit_check.js
//
// ■ 왜 — topbar_check 는 1920·1500·1280 세 폭만 봤다. 그 사이 대결 버튼이 붙어
//   **1600px 에서 두 줄(91px), 900~1101px 에서 세 줄(99px)** 이 됐는데 아무도 안 울었다
//   (2026-10-14 측정). 손으로 적은 폭 기준(1399 · 1560)은 버튼이 늘 때마다 어긋난다.
//   그래서 ui.js 가 재서 접게 바꿨고(fitTopbar), 이 자는 **촘촘한 폭**에서 그것을 본다.
//
// ■ 줄 수만 보면 「다 지워서 통과」 가 된다 — 접힌 버튼이 「⋯」 메뉴에 **다 있는지**,
//   그리고 「⋯」 위 숫자가 실제로 접힌 수와 같은지를 같이 본다.
//   너무 많이 접는 것도 잰다: 넓은 화면(1440 이상)에서는 아무 버튼도 접히지 않아야 한다.
//
// ■ 토스트(#8) — CSS 의 bottom:26px 이 안내문 한가운데라 모든 크기에서 고지를 40px 가렸다.
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

/* 촘촘하게 — 실제로 깨졌던 폭(1600 · 1101 · 900)을 꼭 넣는다. noFold = 아무것도 안 접혀야 하는 폭 */
const VIEWS = [
  { w: 2560, h: 1440, noFold: true }, { w: 1920, h: 1080, noFold: true }, { w: 1600, h: 900, noFold: true },
  { w: 1440, h: 900, noFold: true }, { w: 1366, h: 768 }, { w: 1280, h: 720 }, { w: 1180, h: 820 },
  { w: 1101, h: 800 }, { w: 1024, h: 768 }, { w: 900, h: 700 }, { w: 820, h: 1180 },
  { w: 390, h: 844, mobile: true },
];
/* 파츠 화면에서 닿아야 하는 것 — 상단바에 보이거나 「⋯」 메뉴에 있어야 한다 */
const FOLDABLE = ['#compareBtn', '#galleryBtn', '#codexBtn', '#tokenBtn', '#planBtn', '#duelBtn'];

(async () => {
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files', '--hide-scrollbars'] });
  for (const v of VIEWS) {
    const pg = await br.newPage();
    pg.on('dialog', d => d.accept('topfit').catch(() => {}));
    await pg.setViewport({ width: v.w, height: v.h, deviceScaleFactor: 1,
      isMobile: !!v.mobile, hasTouch: !!v.mobile });
    await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
    await sleep(2400);
    const tag = v.w + '×' + v.h;
    const bar = () => pg.evaluate(() => {
      const b = document.querySelector('.topbar');
      const items = [...b.children].filter(x => {
        const r = x.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !x.classList.contains('spacer');
      });
      const rects = items.map(x => x.getBoundingClientRect());
      const firstBottom = Math.min(...rects.map(r => r.bottom));
      const wrapped = rects.some(r => r.top >= firstBottom - 1);
      const cut = items.filter(x => { const r = x.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1; })
        .map(x => x.id || x.className);
      return { h: Math.round(b.getBoundingClientRect().height), wrapped, cut,
        scroll: b.scrollWidth > b.clientWidth + 1 };
    });
    const a = await bar();
    ok(tag + ' 기체 선택 — 상단바가 한 줄이다', !a.wrapped && !a.cut.length && !a.scroll, a);

    await pg.evaluate(() => {
      const q = document.querySelector('#msQuery');
      q.value = '사자비'; q.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(500);
    await pg.evaluate(() => document.querySelector('#msList .ms-card').click());
    await sleep(700);
    await pg.evaluate(() => { const g = document.querySelector('#infoGo'); if (g) g.click(); });
    await sleep(1200);
    const b = await bar();
    ok(tag + ' 파츠 화면 — 상단바가 한 줄이다 (' + b.h + 'px)', !b.wrapped && !b.cut.length && !b.scroll, b);

    /* 접힌 것이 「⋯」 에 다 있는가 · 숫자가 맞는가 */
    const r = await pg.evaluate(async FOLDABLE => {
      const folded = FOLDABLE.filter(s => { const e = document.querySelector(s); return e && e.getBoundingClientRect().width === 0; });
      const more = document.querySelector('#topbarMore');
      const badge = more ? (more.dataset.folded || '') : null;
      more.click();
      await new Promise(r => setTimeout(r, 200));
      const m = document.querySelector('.more-menu');
      const items = m ? [...m.querySelectorAll('.pm-t')].map(x => x.textContent.trim()) : [];
      if (m) m.remove();
      const missing = folded.filter(s => !items.includes(document.querySelector(s).textContent.trim()));
      return { folded, badge, missing };
    }, FOLDABLE);
    ok(tag + ' 접힌 버튼 ' + r.folded.length + '개가 모두 「⋯」 메뉴에 있다', r.missing.length === 0, r);
    ok(tag + ' 「⋯」 숫자가 접힌 수와 같다 (' + (r.badge || '없음') + ')',
      (r.badge || '') === (r.folded.length ? String(r.folded.length) : ''), r);
    if (v.noFold) ok(tag + ' 넓은 화면은 아무 버튼도 안 접는다', r.folded.length === 0, r.folded);

    /* 토스트 — 저장하면 뜬다. 안내문·아래 행동 바와 겹치지 않아야 한다 */
    const t = await pg.evaluate(async () => {
      const s = document.querySelector('#save'); if (s) s.click();
      await new Promise(r => setTimeout(r, 450));
      const el = document.querySelector('#toast.show');
      if (!el) return { none: true };
      const r = el.getBoundingClientRect();
      const hit = [];
      for (const sel of ['.app-foot', '.m-actionbar']) {
        const e = document.querySelector(sel); if (!e) continue;
        const q = e.getBoundingClientRect();
        if (!q.height) continue;
        const ov = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
        const ox = Math.min(r.right, q.right) - Math.max(r.left, q.left);
        if (ov > 0 && ox > 0) hit.push(sel + ' ' + Math.round(ov) + 'px');
      }
      return { hit, onScreen: r.top >= 0 && r.bottom <= innerHeight };
    });
    ok(tag + ' 토스트가 화면 안에 뜨고 안내문을 안 가린다', !t.none && t.onScreen && !t.hit.length, t);
    await pg.close();
  }
  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
