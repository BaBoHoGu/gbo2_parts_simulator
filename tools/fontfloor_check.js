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

/* floor = 보이는 크기의 바닥(px). was = 2026-10-14 실측(바닥 올리기 전 최소값). */
const VIEWS = [
  { tag: '데스크톱 1500×1000', w: 1500, h: 1000, touch: false, mobile: false, floor: 9.4 },
  { tag: '폰세로(크게) 390×844', w: 390, h: 844, touch: true, mobile: true, viewMode: 'large', floor: 9.4 },
  { tag: '폰세로(넓게) 390×844', w: 390, h: 844, touch: true, mobile: false, viewMode: 'wide', floor: 4.7 },
  { tag: '폰가로 844×390', w: 844, h: 390, touch: true, mobile: true, floor: 9.4 }
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
        /* 보이는 배율 — 「넓게 보기」는 viewport 를 768 로 잡아 기기 폭으로 줄인다.
           screen.width 가 실제 기기 폭이고 innerWidth 는 잡은 폭이다. */
        const dev = Number((window.screen || {}).width) || window.innerWidth;
        const scale = window.innerWidth > dev ? dev / window.innerWidth : 1;
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
            t: txt.trim().slice(0, 18) });
        }
        out.sort((a, b) => a.vis - b.vis);
        return { scale, worst: out.slice(0, 10), n: out.length };
      });
      for (const x of r.worst) {
        const k = x.cls + '|' + x.vis;
        if (!worst.has(k)) worst.set(k, { ...x, scene: name });
      }
      console.log('  ' + v.tag.padEnd(22) + ' · ' + name.padEnd(8)
        + ' 배율 ×' + r.scale.toFixed(3) + ' · 글자 종류 ' + r.n
        + ' · 가장 작은 것 ' + (r.worst[0] ? r.worst[0].vis + 'px (' + r.worst[0].cls + ')' : '-'));
    }
    await br.close();
    const list = [...worst.values()].sort((a, b) => a.vis - b.vis);
    const bad = list.filter(x => x.vis < v.floor);
    ok(v.tag + ' 보이는 글자가 ' + v.floor + 'px 미만이 없다 (가장 작은 것 '
      + (list[0] ? list[0].vis : '-') + 'px)', bad.length === 0,
      bad.slice(0, 6).map(x => x.cls + ' ' + x.px + 'px→' + x.vis + 'px (' + x.scene + ')'));
  }
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
