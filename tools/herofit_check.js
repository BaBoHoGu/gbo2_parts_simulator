// 낮은 데스크톱에서 **파츠 목록이 첫 화면에 보이는가** · 접은 기체 칸이 **다 눌리는가** — 실측.
//   node tools/herofit_check.js
//
// ■ 왜 — 1280×720 에서 기체 칸이 233px 이라 파츠 목록이 첫 화면에 **20px**(타일 머리)만
//   보였다(2026-10-14 측정). 높이 ≤ 800 인 데스크톱에서 기체 칸을 한 줄로 접었다(CSS 6단계 ㉮).
//
// ■ 접으면 깨지는 것 셋을 같이 잰다 — 하나만 재면 다른 쪽을 깨고도 통과한다.
//   ① 목록이 보이는가 (바닥은 .screen-build 아래 끝 — 화면 밖·하단 고지 밑은 「보임」이 아니다)
//   ② 이름이 잘리지 않는가 — 「크로스본 건담 X2 개…」 가 되면 LV·개량형을 못 가린다
//   ③ 단추·선택칸이 판 밖으로 밀리거나 남에게 가리지 않는가 — elementFromPoint 로 닿는지 본다
//      (el.click() 은 가려진 것도 누른다 — gate-hit-test)
//   그리고 높이가 넉넉한 화면(1440×900)은 **안 접혀야** 한다 — 출격·적성 줄이 그대로 나온다.
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

/* minVis = 파츠 목록이 첫 화면에 보여야 하는 높이. 2026-10-14 실측 139/187 에서
   타일 한 줄(≈77px)이 온전히 들어오는 선으로 잡았다. was = 접기 전 값. */
const VIEWS = [
  { tag: '노트북 1280×720', w: 1280, h: 720, fold: true, minVis: 110, was: 20 },
  { tag: '노트북 1366×768', w: 1366, h: 768, fold: true, minVis: 150, was: 68 },
  { tag: '데스크톱 1440×900', w: 1440, h: 900, fold: false, minVis: 150, was: 200 },
];
/* 이름이 긴 기체와 LV 전환이 있는 기체 — 둘 다 한 줄을 넘기기 쉽다 */
const MECHS = ['크로스본 건담 X2 개량형', '사자비'];
/* 접은 칸에서 눌려야 하는 것 */
const CONTROLS = ['#backToSelect', '#msSwapBtn', '#clearParts', '#stageHelp', '#stageSeg .seg-btn',
  '#expHelp', '#expansion', '#expLevel', '#levelSwitch .seg-btn', '#heroName a'];

(async () => {
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files', '--hide-scrollbars'] });
  for (const v of VIEWS) for (const q of MECHS) {
    const pg = await br.newPage();
    await pg.setViewport({ width: v.w, height: v.h, deviceScaleFactor: 1 });
    await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
    await sleep(2400);
    await pg.evaluate(q => {
      const x = document.querySelector('#msQuery');
      x.value = q; x.dispatchEvent(new Event('input', { bubbles: true }));
    }, q);
    await sleep(600);
    await pg.evaluate(() => { const c = document.querySelector('#msList .ms-card'); if (c) c.click(); });
    await sleep(800);
    await pg.evaluate(() => { const g = document.querySelector('#infoGo'); if (g) g.click(); });
    await sleep(1300);
    /* 가장 긴 확장 스킬을 골라 둔다 — 「확장 스킬 없음」 만 재면 긴 이름에서 밀리는 걸 못 본다 */
    await pg.evaluate(() => {
      const s = document.querySelector('#expansion');
      if (!s || !s.options.length) return;
      let best = 0;
      [...s.options].forEach((o, i) => { if (o.text.length > s.options[best].text.length) best = i; });
      s.selectedIndex = best; s.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(500);
    const r = await pg.evaluate(CONTROLS => {
      const R = e => e.getBoundingClientRect();
      const list = document.querySelector('#partList');
      const lb = R(list), sb = R(document.querySelector('.screen-build'));
      const panel = R(document.querySelector('.hero').closest('.panel'));
      const name = document.querySelector('#heroName');
      const facts = document.querySelector('#heroFacts');
      const bad = [];
      for (const sel of CONTROLS) {
        const el = document.querySelector(sel);
        if (!el || el.closest('[hidden]')) continue;      // LV 전환이 없는 기체 등
        const b = R(el);
        if (!b.width || !b.height) { bad.push(sel + ' 크기 0'); continue; }
        if (b.left < panel.left - 1 || b.right > panel.right + 1) { bad.push(sel + ' 판 밖'); continue; }
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        if (!hit || !(hit === el || el.contains(hit))) bad.push(sel + ' 가림(' + (hit ? hit.tagName + '.' + hit.className : 'null') + ')');
      }
      return {
        hero: Math.round(R(document.querySelector('.hero')).height),
        vis: Math.round(Math.min(lb.bottom, sb.bottom, innerHeight) - lb.top),
        nameClip: name.scrollWidth > name.clientWidth + 1,
        name: name.innerText.trim(),
        expW: Math.round(R(document.querySelector('#expansion')).width),
        factsShown: !!(facts && facts.textContent.trim() && R(facts).height > 0),
        /* 접힌 칸에서도 보여야 하는 칩 — 예전엔 접으면 줄째 감춰 적성·판정력을 볼 곳이 없었다(2026-10-19 사용자 요청).
           줄 상자는 contents 로 풀리므로 상자 높이가 아니라 칩 하나하나가 그려졌는지 본다. */
        chips: [...document.querySelectorAll('#heroFacts .hf, #heroFacts2 .hf')]
          .filter(x => R(x).height > 0 && getComputedStyle(x).visibility !== 'hidden')
          .map(x => x.querySelector('i') ? x.querySelector('i').textContent : ''),
        bad,
      };
    }, CONTROLS);
    const t = v.tag + ' · ' + q;
    ok(t + ' — 파츠 목록이 ' + r.vis + 'px 보인다 (≥ ' + v.minVis + ', 접기 전 ' + v.was + ')', r.vis >= v.minVis, r);
    ok(t + ' — 이름이 잘리지 않는다 「' + r.name + '」', !r.nameClip, r);
    ok(t + ' — 단추·선택칸이 판 안에 있고 눌린다', r.bad.length === 0, r.bad);
    if (v.fold) {
      ok(t + ' — 기체 칸이 접혔다 (' + r.hero + 'px ≤ 135)', r.hero <= 135, r.hero);
      ok(t + ' — 확장 선택칸이 쓸 만한 폭이다 (' + r.expW + 'px ≥ 90)', r.expW >= 90, r.expW);
      ok(t + ' — 접혀도 적성 · 격투 판정력이 보인다', r.chips.includes('적성') && r.chips.includes('격투 판정력'), r.chips);
    } else {
      ok(t + ' — 높이가 넉넉하면 안 접는다 (출격·적성 줄이 보인다)', r.factsShown, r);
    }
    await pg.close();
  }
  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
