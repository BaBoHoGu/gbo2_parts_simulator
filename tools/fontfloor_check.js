// 화면에 **실제로 보이는 글자 크기**가 바닥을 넘는가 — 기기별 실측.
//   node tools/fontfloor_check.js
//
// ■ 왜 — CSS 에 적힌 크기와 눈에 보이는 크기가 다르다. 폰 「넓게 보기」는 768px 로 그린
//   화면을 기기 폭으로 **줄여** 보여 주므로, 390px 기기에서는 모든 글자가 ×0.508 이 된다.
//   9.5px 토큰은 거기서 **4.8px** 로 보인다. CSS 만 읽으면 이것을 못 본다.
//
// ■ 바닥을 둘로 나눈다 — 「크게 보기」는 읽는 화면이라 11px, 「넓게 보기」는 사용자가
//   **작게 보기를 고른** 모드라(두 손가락으로 키울 수 있다) 6px 로 둔다.
//   하나로 묶으면 넓게 보기를 맞추려 크게 보기가 지나치게 커진다.
//
// ■ 보이는 글자만 센다. 숨은 화면(갤러리·도감)의 요소까지 세면 손댈 수 없는 것으로
//   계속 울고, 그러면 자를 꺼 버리게 된다.
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

/* floor = 보이는 크기의 바닥(px). was = 바닥을 올리기 전 실측값(2026-10-14).
   11 에서 0.4 를 빼 둔다 — 글꼴 렌더가 소수 한 자리에서 흔들린다. */
const VIEWS = [
  { tag: '데스크톱 1500×1000', w: 1500, h: 1000, touch: false, mobile: false, floor: 10.6, was: 9.5 },
  { tag: '폰세로(크게) 390×844', w: 390, h: 844, touch: true, mobile: true, viewMode: 'large', floor: 10.6, was: 9.5 },
  { tag: '폰세로(넓게) 390×844', w: 390, h: 844, touch: true, mobile: false, viewMode: 'wide', floor: 5.4, was: 4.8 },
  { tag: '폰가로 844×390', w: 844, h: 390, touch: true, mobile: true, floor: 10.6, was: 10.5 }
];

/* 들러 볼 화면 — 작은 글자가 몰려 있는 곳들. */
const SCENES = [
  ['기체 선택', async () => {}],
  ['파츠 적용', async pg => {
    await pg.evaluate(() => {
      const q = document.querySelector('#msQuery');
      q.value = '사자비'; q.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(700);
    await pg.evaluate(() => { const c = document.querySelector('#msList .ms-card'); if (c) c.click(); });
    await sleep(900);
    await pg.evaluate(() => { const g = document.querySelector('#infoGo'); if (g) g.click(); });
    await sleep(1200);
  }],
  ['스킬 도감', async pg => {
    await pg.evaluate(() => { const b = document.querySelector('#codexBtn'); if (b) b.click(); });
    await sleep(1200);
  }]
];

(async () => {
  for (const v of VIEWS) {
    const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new',
      args: ['--no-sandbox', '--allow-file-access-from-files', '--hide-scrollbars'] });
    const pg = await br.newPage();
    /* **screen.width 를 기기 폭으로 맞춘다.** 헤드리스는 800 을 보고하는데, 앱은 그 값으로
       「넓게 보기」의 배율을 정한다(initial-scale = screen.width / 768). 800/768 = 1.04 라
       자가 **확대**로 읽어, 390px 기기에서 실제로 일어나는 ×0.508 축소를 못 봤다.
       실기가 보고하는 값으로 바꿔 줘야 앱이 실기와 같은 결정을 한다. */
    await pg.evaluateOnNewDocument(w => {
      try {
        Object.defineProperty(window.screen, 'width', { get: () => w, configurable: true });
        Object.defineProperty(window.screen, 'availWidth', { get: () => w, configurable: true });
      } catch { /* 못 바꾸면 그대로 */ }
    }, v.w);
    await pg.setViewport({ width: v.w, height: v.h, isMobile: v.mobile, hasTouch: v.touch,
      deviceScaleFactor: 1 });
    await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
    await sleep(2600);
    if (v.viewMode) {
      await pg.evaluate(m => { try { localStorage.setItem('gbo2.viewMode', m); } catch { /* 무시 */ } }, v.viewMode);
      await pg.reload({ waitUntil: 'load', timeout: 180000 });
      await sleep(2600);
    }
    const worst = new Map();
    for (const [name, go] of SCENES) {
      try { await go(pg); } catch { /* 없는 화면은 넘어간다 */ }
      const r = await pg.evaluate(() => {
        /* 보이는 배율 — **앱이 적어 둔 initial-scale 을 읽는다.**
           「넓게 보기」는 viewport 를 width=768, initial-scale=<기기폭/768> 로 잡아
           기기 폭만큼 줄여 보여 준다. 그 값이 곧 글자가 작아지는 비율이다.
           screen.width 로 계산하려 했더니 헤드리스에서 그 값이 800 이라
           **데스크톱이 ×0.533 으로 나왔다**(1500 → 800/1500). 앱이 말하는 값을 쓴다. */
        const meta = document.querySelector('meta[name="viewport"]');
        const m = meta && String(meta.getAttribute('content') || '')
          .match(/initial-scale\s*=\s*([\d.]+)/);
        const scale = m ? Math.min(1, Number(m[1]) || 1) : 1;
        const out = [];
        const seen = new Set();
        for (const el of document.querySelectorAll('*')) {
          if (!el.getClientRects().length) continue;          // 안 보이는 것은 센지 않는다
          // 글자를 **직접** 담은 요소만 (부모까지 세면 같은 글자를 여러 번 센다)
          let txt = '';
          for (const n of el.childNodes) if (n.nodeType === 3) txt += n.nodeValue;
          if (!txt.trim()) continue;
          const cs = getComputedStyle(el);
          const px = parseFloat(cs.fontSize) || 0;
          if (!px) continue;
          const vis = Math.round(px * scale * 10) / 10;
          const key = (el.className || el.tagName) + '|' + vis;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ cls: String(el.className || el.tagName).slice(0, 44), px, vis,
            foot: !!el.closest('.app-foot'),      // 고지는 바닥에서 뺀 예외다
            t: txt.trim().slice(0, 18) });
        }
        out.sort((a, b) => a.vis - b.vis);
        /* 고지는 **따로** 가장 작은 것을 집어 준다 — 데스크톱에서는 11px 이라
           「가장 작은 10개」에 못 들어, 그 목록만 보면 못 재고 null 이 된다. */
        const fo = out.filter(x => x.foot);
        return { scale, worst: out.slice(0, 10), n: out.length,
          footMin: fo.length ? fo[0] : null };
      });
      for (const x of r.worst) {
        const k = x.cls + '|' + x.vis;
        if (!worst.has(k)) worst.set(k, { ...x, scene: name });
      }
      if (r.footMin) {
        const k = 'FOOT|' + r.footMin.cls + '|' + r.footMin.vis;
        if (!worst.has(k)) worst.set(k, { ...r.footMin, scene: name });
      }
      console.log('  ' + v.tag.padEnd(22) + ' · ' + name.padEnd(8)
        + ' 배율 ×' + r.scale.toFixed(3) + ' · 글자 종류 ' + r.n
        + ' · 가장 작은 것 ' + (r.worst[0] ? r.worst[0].vis + 'px (' + r.worst[0].cls + ')' : '-'));
    }
    await br.close();
    const all = [...worst.values()].sort((a, b) => a.vis - b.vis);
    /* **고지(.app-foot)는 바닥에서 뺀다.** 기능 글(파츠 이름·LV·사유)이 작아서 못 읽히는
       것이 바닥을 올린 이유이고, 고지는 한 번 읽는 글이다. 폰에서 바닥을 올리니 안내문이
       78 → 100px 로 커져 2단계에서 되찾은 높이가 통째로 사라졌다 — 그래서 --fs-foot 로
       따로 두었다(style.css 의 그 주석과 짝이다). 빼는 대신 **아래에서 따로 못 박는다.** */
    const list = all.filter(x => !x.foot);
    const bad = list.filter(x => x.vis < v.floor);
    ok(v.tag + ' 기능 글이 ' + v.floor + 'px 미만이 없다 (was ' + v.was + 'px · 가장 작은 것 '
      + (list[0] ? list[0].vis : '-') + 'px)', bad.length === 0,
      bad.slice(0, 6).map(x => x.cls + ' ' + x.px + 'px→' + x.vis + 'px (' + x.scene + ')'));
    /* 고지가 **더 작아지지 않았는가** — 10.5px 로 두기로 한 것이니 그 아래로 내려가면 운다.
       (예외를 두면서 아무도 안 보면, 그 예외가 다음에 조용히 더 작아진다.) */
    const foots = all.filter(x => x.foot);
    const smallest = foots.length ? foots[0].px : null;
    ok(v.tag + ' 고지 글자가 10.5px 보다 작아지지 않았다 (지금 ' + smallest + 'px)',
      smallest != null && smallest >= 10.4,
      foots.slice(0, 4).map(x => x.cls + ' ' + x.px + 'px'));
  }
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
