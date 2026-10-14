// 호버가 **마우스에서는 걸리고 터치에서는 안 남는가** — 실측.
//   node tools/hover_check.js
//
// ■ 왜 — 터치 기기에서 :hover 는 손가락을 뗀 뒤에도 **남는다.** 누른 카드가 밝게 남아
//   「골라진 것」처럼 보인다. 그래서 :hover 를 @media (hover: hover) 로 감쌌다(CSS 5단계).
//   그런데 감싸는 일은 **사진으로 못 잰다** — 정적 사진에는 호버가 안 찍힌다.
//   그리고 감싸다 실수하면 **마우스에서도 호버가 사라지는데**, 그것 역시 사진에 안 나온다.
//   그래서 두 쪽을 다 직접 잰다: 마우스로 올리면 바뀌는가 · 터치로 누른 뒤 남지 않는가.
//
// ■ 섞인 규칙 — 「.a:hover, .a:focus-visible」 을 통째로 감싸면 터치에서 **포커스 표시까지**
//   꺼진다. 감쌀 때 갈랐는지를 포커스 쪽에서 본다.
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

/* 호버로 무엇이 바뀌는지 — 이 몇 가지만 보면 「바뀌었는가」를 알 수 있다. */
const LOOK = el => {
  const cs = getComputedStyle(el);
  return [cs.backgroundColor, cs.borderColor, cs.color, cs.boxShadow, cs.transform,
    cs.textDecorationLine].join('|');
};

async function open(touch) {
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files', '--hide-scrollbars'] });
  const pg = await br.newPage();
  await pg.setViewport({ width: touch ? 390 : 1500, height: touch ? 844 : 1000,
    isMobile: !!touch, hasTouch: !!touch, deviceScaleFactor: 1 });
  /* 터치 기기는 (hover: none) 을 보고해야 한다 — 에뮬레이션 플래그로 맞춘다. */
  if (touch) {
    const cdp = await pg.target().createCDPSession();
    await cdp.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
  }
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(2800);
  return { br, pg };
}

(async () => {
  /* ── ① 마우스: 올리면 바뀐다 ───────────────────────────────────────── */
  const m = await open(false);
  const hoverMq = await m.pg.evaluate(() => matchMedia('(hover: hover)').matches);
  ok('데스크톱은 (hover: hover) 를 보고한다', hoverMq === true, hoverMq);

  const targets = ['#msList .ms-card', '.btn-ghost', '.chip'];
  for (const sel of targets) {
    const box = await m.pg.evaluate(s => {
      /* **켜진 것(.on · .sel)은 고르지 않는다** — 켜진 칩은 호버 모양이 켜진 모양과 같아
         「바뀌지 않는다」로 읽힌다(첫 칩이 「전체」라 켜져 있었다). */
      const el = [...document.querySelectorAll(s)].find(e => {
        const b = e.getBoundingClientRect();
        return b.width && b.height && b.top >= 0 && b.bottom <= innerHeight
          && !e.classList.contains('on') && !e.classList.contains('sel');
      });
      if (!el) return null;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const b = el.getBoundingClientRect();
      el.dataset.hv = '1';
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, sel);
    if (!box) { ok(sel + ' 을 찾았다', false); continue; }
    await m.pg.mouse.move(5, 5);
    await sleep(150);
    const before = await m.pg.evaluate(LOOK_SRC => {
      const el = document.querySelector('[data-hv="1"]');
      return (new Function('el', 'return (' + LOOK_SRC + ')(el)'))(el);
    }, LOOK.toString());
    await m.pg.mouse.move(box.x, box.y);
    await sleep(200);
    const after = await m.pg.evaluate(LOOK_SRC => {
      const el = document.querySelector('[data-hv="1"]');
      const r = (new Function('el', 'return (' + LOOK_SRC + ')(el)'))(el);
      el.removeAttribute('data-hv');
      return r;
    }, LOOK.toString());
    ok('마우스를 올리면 ' + sel + ' 의 모양이 바뀐다 (감싸다 호버를 지우지 않았다)',
      before !== after, { before, after });
  }
  await m.br.close();

  /* ── ② 터치: 누른 뒤 호버가 남지 않는다 ─────────────────────────────── */
  const t = await open(true);
  const hoverT = await t.pg.evaluate(() => matchMedia('(hover: hover)').matches);
  ok('터치 폰은 (hover: hover) 가 아니다', hoverT === false, hoverT);
  /* 감싸 둔 규칙이 터치에서는 **아예 안 걸리는지**를 CSSOM 으로 본다 —
     손가락 흉내로는 「남는 호버」를 안정적으로 재현할 수 없다(브라우저마다 다르다).
     :hover 를 가진 규칙이 모두 (hover: hover) 안에 있으면, 터치에서 걸릴 수가 없다. */
  const bare = await t.pg.evaluate(() => {
    const out = [];
    const visit = (rules, inHover) => {
      for (const r of rules) {
        if (r.type === CSSRule.MEDIA_RULE) {
          visit(r.cssRules, inHover || /hover\s*:\s*hover/.test(r.conditionText || r.media.mediaText));
        } else if (r.selectorText && /:hover/.test(r.selectorText) && !inHover) {
          out.push(r.selectorText.slice(0, 60));
        }
      }
    };
    for (const sh of document.styleSheets) {
      try { visit(sh.cssRules, false); } catch { /* 다른 출처 시트는 못 읽는다 */ }
    }
    return out;
  });
  ok(':hover 규칙이 모두 (hover: hover) 안에 있다 — 터치에서 안 남는다 (' + bare.length + '개 맨몸)',
    bare.length === 0, bare.slice(0, 6));

  /* 섞인 규칙을 통째로 감싸면 :focus-visible 까지 터치에서 꺼진다 — 포커스 쪽을 본다.
     키보드 포커스 표시는 터치 폰(블루투스 키보드)에서도 그려져야 한다. */
  const focusInsideHover = await t.pg.evaluate(() => {
    const out = [];
    const visit = (rules, inHover) => {
      for (const r of rules) {
        if (r.type === CSSRule.MEDIA_RULE) {
          visit(r.cssRules, inHover || /hover\s*:\s*hover/.test(r.conditionText || r.media.mediaText));
        } else if (r.selectorText && inHover && /:focus/.test(r.selectorText)) {
          out.push(r.selectorText.slice(0, 60));
        }
      }
    };
    for (const sh of document.styleSheets) {
      try { visit(sh.cssRules, false); } catch { /* 무시 */ }
    }
    return out;
  });
  ok('포커스 규칙이 (hover: hover) 안에 갇히지 않았다 — 섞인 규칙을 갈랐다 ('
    + focusInsideHover.length + '개)', focusInsideHover.length === 0, focusInsideHover.slice(0, 6));
  await t.br.close();

  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
