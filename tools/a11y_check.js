// 대비 · 누르는 곳 · 포커스 — 실측.
//   node tools/a11y_check.js            검사 (한도를 넘으면 FAIL)
//   node tools/a11y_check.js --list     지금 상태만 줄줄이 적는다 (고칠 자리 찾기)
//
// ■ 왜 — 이 세 가지는 「되어 있다」고 믿기 쉬운데 값으로 재면 거의 늘 모자란다.
//   · 대비: opacity 로 흐리게 한 글자는 색 변수를 안 바꿔도 기준 아래로 떨어진다.
//   · 누르는 곳: 보이는 상자가 아니라 **실제로 눌리는 범위**가 중요하다. ::before 로
//     넓혀 둔 곳은 상자만 재면 작게 보이고, 안 넓힌 곳은 커 보여도 15×15 다.
//   · 포커스: 링이 **보이는지**(대비)와 **갈 수 있는지**(Tab)는 다른 문제다.
//     카드가 div 면 링을 아무리 밝게 해도 Tab 이 거기 가지 않는다.
//
// ■ 재는 법 — 글자색은 **불투명한 조상 배경**과 맞댄다(투명 배경은 뒤가 비친다).
//   누르는 곳은 가운데에서 네 방향으로 한 픽셀씩 나가 보며 그 요소가 잡히는 끝을 찾는다.
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
const LIST = process.argv.includes('--list');

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label
    + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

/* 한도 — 2026-10-14 실측에서 고친 뒤의 값으로 못 박는다.
   대비는 WCAG AA(보통 글자 4.5 · 큰 글자 3.0). 반올림 여유 0.05. */
const AA = 4.45, AA_BIG = 2.95, TAP = 24, FOCUS_RING = 2.95;

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
    await sleep(1300);
  }],
  ['패치노트', async pg => {
    await pg.evaluate(() => { const b = document.querySelector('#patchBtn'); if (b) b.click(); });
    await sleep(1200);
  }],
  ['스킬 도감', async pg => {
    await pg.evaluate(() => { const b = document.querySelector('#codexBtn'); if (b) b.click(); });
    await sleep(1200);
  }],
  ['토큰', async pg => {
    await pg.evaluate(() => { const b = document.querySelector('#tokenBtn'); if (b) b.click(); });
    await sleep(1100);
  }]
];

const MEASURE = () => {
  /* ── 색 ──────────────────────────────────────────────────────────── */
  const rgb = s => {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(x => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = c => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
  };
  const over = (fg, bg) => {   // 반투명 글자색을 배경 위에 얹는다
    if (fg.a >= 1) return fg;
    return { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 };
  };
  /** 글자 뒤의 **실제** 배경색. 못 구하면 null — 그라데이션·이미지 위는 재지 않는다.
   *  반투명 배경은 **쌓아서** 센다. 건너뛰면 「accent 글자 + 14% accent 바탕」처럼
   *  옅은 칠을 깔아 둔 자리를 그 아래 불투명 색으로만 재어 대비를 **후하게** 읽는다. */
  const bgOf = el => {
    const layers = [];
    let e = el, base = null;
    while (e && e !== document.documentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = rgb(cs.backgroundColor);
      if (c && c.a > 0.001) {
        if (c.a >= 0.999) { base = c; break; }
        layers.push(c);                       // 위에서 아래 순서로 모은다
      }
      e = e.parentElement;
    }
    if (!base) return null;
    let out = base;
    for (let i = layers.length - 1; i >= 0; i--) out = over(layers[i], out);   // 아래에서 위로 얹는다
    return out;
  };

  const texts = [], taps = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('*')) {
    if (!el.getClientRects().length) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden') continue;

    /* 글자를 **직접** 담은 요소만 — 부모까지 세면 같은 글자를 여러 번 센다. */
    let txt = '';
    for (const n of el.childNodes) if (n.nodeType === 3) txt += n.nodeValue;
    /* **못 쓰는 단추의 글자는 대비 기준의 예외다**(WCAG 1.4.3 — inactive UI component).
       막힌 파츠 타일의 이름·LV 가 그렇다 — 흐린 것 자체가 「못 고른다」는 표시다.
       단 **사유(pt-why)는 예외가 아니다** — 왜 못 끼우는지 알려 주는 글이라 읽혀야 한다.
       그래서 예전엔 타일째 흐려 사유까지 2.05 였던 것을 고쳤다. */
    const inactive = !!el.closest('.part-tile.blocked') && !el.closest('.pt-why');
    if (txt.trim() && !inactive) {
      const bg = bgOf(el);
      const fg0 = rgb(cs.color);
      if (bg && fg0) {
        /* opacity 는 조상까지 곱해진다 — 흐리게 해 둔 글자가 여기서 드러난다. */
        let op = 1, e2 = el;
        while (e2 && e2 !== document.documentElement) {
          op *= parseFloat(getComputedStyle(e2).opacity || '1') || 1;
          e2 = e2.parentElement;
        }
        const fg = over({ ...fg0, a: (fg0.a || 1) * op }, bg);
        const px = parseFloat(cs.fontSize) || 0;
        const wgt = Number(cs.fontWeight) || 400;
        const big = px >= 18.66 || (px >= 14 && wgt >= 700);
        const cls = String(el.className || el.tagName).slice(0, 40);
        const key = cls + '|' + cs.color + '|' + Math.round(px) + '|' + op.toFixed(2);
        if (!seen.has(key)) {
          seen.add(key);
          texts.push({ cls, r: ratio(fg, bg), px: Math.round(px * 10) / 10, big,
            op: Math.round(op * 100) / 100, t: txt.trim().slice(0, 14) });
        }
      }
    }

    /* 누르는 곳 — 눌리는 것만. 실제로 잡히는 범위를 네 방향으로 재 본다. */
    const clickable = el.matches('button, a[href], input, select, textarea, label, [role="button"], [tabindex]')
      || (el.onclick != null);
    if (!clickable) continue;
    let r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.width >= 44 && r.height >= 44) continue;        // 넉넉한 것은 셀 필요 없다
    /* **먼저 화면 가운데로 올린다.** 스크롤 칸 끝에 걸쳐 있으면 아래쪽이 칸 밖이라
       elementFromPoint 가 칸 자체를 돌려주고, 「덮였다」로 잘못 읽는다 — 토큰의 ± 단추가
       30×30 인데 30×20 으로 나왔다(아래 8px 이 칸 밖이었다). tap_target_check 와 같은 법이다. */
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) continue;
    /* <label for=…> 는 그 입력칸이 **24px 이상이면 예외**다(WCAG 2.5.8 — 같은 기능을
       하는 다른 컨트롤이 기준을 넘으면 된다). 토큰 계산기의 「오늘 날짜」 같은 라벨이
       21px 이지만, 눌러서 하는 일(입력칸에 커서 두기)은 그 아래 큰 입력칸이 한다. */
    if (el.matches('label[for]')) {
      const tgt = document.getElementById(el.getAttribute('for'));
      const tb = tgt && tgt.getBoundingClientRect();
      if (tb && tb.width >= 24 && tb.height >= 24) continue;
    }
    /* 하단 출처 링크는 WCAG 2.5.8 의 「문장 안의 링크」 예외다 — 「공식 사이트 · gbo2.jp · 위키 …」 처럼 글줄 안에
       이어져 있어 크기가 그 줄 높이로 정해진다. 폰에서 두 줄로 접히면 줄 사이가 15px 이라 두 줄이 다 24px 를 가질
       수 없고, 줄을 벌리면 하단 고지 높이 한도(foot_height_check, 운영자 결정)를 넘는다. 그동안은 이 검사가 클래스 없는
       A 를 **처음 하나만** 재서 GitHub 링크만 보고 지나갔다 — 2026-10-24 그 링크를 지우자 드러났다. */
    if (el.matches('.app-foot .foot-links a')) continue;
    /* 「?」 단추를 감싼 라벨은 그 단추와 같은 일을 한다 — 단추가 기준을 넘으면 된다. */
    if (el.matches('label') && !el.getAttribute('for') && el.querySelector('button')) continue;
    const cls2 = (el.id ? '#' + el.id : String(el.className || el.tagName)).slice(0, 40);
    if (seen.has('T|' + cls2)) continue;
    seen.add('T|' + cls2);
    const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
    const mine = q => { let e = q; while (e) { if (e === el) return true; e = e.parentElement; } return false; };
    if (!mine(document.elementFromPoint(cx, cy))) continue;   // 가려진 것은 셀 수 없다
    /* 한 방향 15px 까지만 본다 — 24px 를 넘으면 충분하고, 더 가면 **이웃을 넘어가** 거짓으로
       커 보인다. 멈춘 것은 sat 로 적어, 「61×19」처럼 가로가 멀쩡해 보이는 착각을 막는다
       (30 까지 보다가 30+30+1 = 61 이 되어 그렇게 읽혔다). */
    const CAP = 15;
    let sat = false;
    const reach = (dx, dy) => {
      for (let d = 1; d <= CAP; d++) {
        if (!mine(document.elementFromPoint(cx + dx * d, cy + dy * d))) return d - 1;
      }
      sat = true;
      return CAP;
    };
    const w = reach(-1, 0) + reach(1, 0) + 1, h = reach(0, -1) + reach(0, 1) + 1;
    taps.push({ cls: cls2, box: Math.round(r.width) + '×' + Math.round(r.height), w, h, sat });
  }

  /* ── 포커스 ─────────────────────────────────────────────────────── */
  /* **보이는 것만** 센다 — 분모까지. 숨은 화면의 카드까지 분모에 넣으면, 토큰 화면에서
     재었을 때 「0/5」로 나와 고친 뒤에도 운다(실제로 그렇게 울었다). */
  const vis = sel => [...document.querySelectorAll(sel)].filter(e => e.getClientRects().length);
  const focusable = sel => vis(sel)
    .filter(e => e.tabIndex >= 0 || e.matches('button, a[href], input, select, textarea')).length;
  const cards = vis('.ms-card').length;
  const tiles = vis('.part-tile').length;
  return { texts, taps,
    focus: { cards, cardsFocusable: focusable('.ms-card'),
      tiles, tilesFocusable: focusable('.part-tile') } };
};

/* 한 기기로 화면들을 돌며 잰다. 대비는 포인터와 상관없어 데스크톱에서,
   누르는 곳은 **터치 폰**에서 잰다 — 판정을 넓히는 규칙이 @media (pointer: coarse) 에만
   걸려 있고(손가락 기준), 가이드 #9 도 터치 기기 기준이다. 데스크톱 마우스로 재면
   넓혀 둔 것이 안 보여 「작다」가 거짓으로 늘어난다(실제로 그렇게 19개로 읽었다). */
async function runOn(view) {
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files', '--hide-scrollbars'] });
  const pg = await br.newPage();
  if (view.touch) {
    await pg.evaluateOnNewDocument(w => {
      try { Object.defineProperty(window.screen, 'width', { get: () => w, configurable: true }); } catch { /* 무시 */ }
    }, view.w);
  }
  await pg.setViewport({ width: view.w, height: view.h, isMobile: !!view.touch,
    hasTouch: !!view.touch, deviceScaleFactor: 1 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(2800);
  if (view.viewMode) {
    await pg.evaluate(m => { try { localStorage.setItem('gbo2.viewMode', m); } catch { /* 무시 */ } }, view.viewMode);
    await pg.reload({ waitUntil: 'load', timeout: 180000 });
    await sleep(2800);
  }
  const out = [];
  for (const [name, go] of SCENES) {
    try { await go(pg); } catch { /* 없는 화면은 넘어간다 */ }
    out.push([name, await pg.evaluate(MEASURE)]);
  }
  return { br, pg, out };
}

(async () => {
  const badText = new Map(), badTap = new Map();
  let focus = null;

  const desk = await runOn({ w: 1500, h: 1000 });
  /* 카드는 기체 선택에서, 타일은 파츠 적용에서 보인다 — 화면마다 **보인 수가 가장 많은**
     것을 집는다. 마지막 화면 하나만 보면 거기서 안 보이는 것은 0 으로 남는다. */
  const fc = { cards: 0, cardsFocusable: 0, tiles: 0, tilesFocusable: 0 };
  for (const [, r] of desk.out) {
    if (r.focus.cards > fc.cards) { fc.cards = r.focus.cards; fc.cardsFocusable = r.focus.cardsFocusable; }
    if (r.focus.tiles > fc.tiles) { fc.tiles = r.focus.tiles; fc.tilesFocusable = r.focus.tilesFocusable; }
  }
  focus = fc;
  for (const [name, r] of desk.out) {
    for (const t of r.texts) {
      const lim = t.big ? AA_BIG : AA;
      if (t.r >= lim) continue;
      const k = t.cls + '|' + t.r;
      if (!badText.has(k)) badText.set(k, { ...t, scene: name, lim });
    }
    console.log('  [데스크톱] ' + name.padEnd(8) + ' 글자 ' + r.texts.length + '종');
  }
  const pg = desk.pg, br = desk.br;

  const phone = await runOn({ w: 390, h: 844, touch: true, viewMode: 'large' });
  for (const [name, r] of phone.out) {
    for (const t of r.taps) {
      if (t.w >= TAP && t.h >= TAP) continue;
      const k = t.cls;
      if (!badTap.has(k)) badTap.set(k, { ...t, scene: name });
    }
    console.log('  [폰 터치] ' + name.padEnd(8) + ' 눌리는 것 ' + r.taps.length + '개 (작은 것만)');
  }
  await phone.br.close();

  /* 포커스 링이 **보이는가.** :focus-visible 은 「키보드로 왔을 때」만 걸린다 —
     el.focus() 로 재면 outline-style:none 이 나와 「링이 없다」로 읽힌다(그렇게 읽었다).
     그래서 **Tab 키를 눌러** 옮긴 뒤 잰다. */
  const ring = await pg.evaluate(() => { document.body.focus(); return true; })
    .then(async () => {
      for (let i = 0; i < 3; i++) await pg.keyboard.press('Tab');
      return pg.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        return { on: (el.id ? '#' + el.id : el.tagName), color: cs.outlineColor,
          width: cs.outlineWidth, style: cs.outlineStyle, offset: cs.outlineOffset };
      });
    });
  await br.close();

  const texts = [...badText.values()].sort((a, b) => a.r - b.r);
  const taps = [...badTap.values()].sort((a, b) => (a.w * a.h) - (b.w * b.h));
  if (LIST) {
    console.log('\n■ 대비가 모자란 글자 ' + texts.length + '종');
    for (const t of texts) console.log('   ' + String(t.r).padStart(5) + ' (한도 ' + t.lim + ') '
      + t.px + 'px' + (t.op < 1 ? ' op' + t.op : '') + '  ' + t.cls + '  「' + t.t + '」 ' + t.scene);
    console.log('\n■ 누르는 곳이 ' + TAP + 'px 미만 ' + taps.length + '개');
    for (const t of taps) console.log('   ' + String(t.w + '×' + t.h).padStart(7)
      + ' (상자 ' + t.box + ')  ' + t.cls + '  ' + t.scene);
    console.log('\n■ 포커스 ' + JSON.stringify({ ring, ...focus }));
    process.exit(0);
  }

  ok('대비가 AA 미만인 글자가 없다 (' + texts.length + '종)', texts.length === 0,
    texts.slice(0, 8).map(t => t.cls + ' ' + t.r + '<' + t.lim + ' ' + t.px + 'px'));
  ok('눌리는 곳이 모두 ' + TAP + 'px 이상이다 (' + taps.length + '개 모자람)', taps.length === 0,
    taps.slice(0, 8).map(t => t.cls + ' ' + t.w + '×' + t.h));
  ok('포커스 링이 그려진다', !!ring && ring.style !== 'none' && parseFloat(ring.width) >= 2, ring);
  ok('기체 카드에 Tab 으로 갈 수 있다 (' + focus.cardsFocusable + '/' + focus.cards + ')',
    focus.cards > 0 && focus.cardsFocusable === focus.cards, focus);
  ok('파츠 타일에 Tab 으로 갈 수 있다 (' + focus.tilesFocusable + '/' + focus.tiles + ')',
    focus.tiles > 0 && focus.tilesFocusable === focus.tiles, focus);

  /* **갈 수 있는 것과 고를 수 있는 것은 다르다.** tabindex 만 달면 Tab 은 가지만
     Enter 를 눌러도 아무 일도 없다(div 는 Enter 를 클릭으로 바꾸지 않는다).
     진짜 키보드로 가서 진짜 키를 눌러, 화면이 실제로 바뀌는지 본다. */
  const kb = await runOn({ w: 1500, h: 1000 });
  const kpg = kb.pg;
  // 기체 선택 화면으로 되돌린다 (runOn 이 화면들을 다 돌고 끝났다)
  await kpg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(2800);
  const before = await kpg.evaluate(() => document.body.className);
  await kpg.evaluate(() => {
    const c = document.querySelector('#msList .ms-card');
    if (c) c.focus();
  });
  const focusedCard = await kpg.evaluate(() =>
    !!(document.activeElement && document.activeElement.classList.contains('ms-card')));
  await kpg.keyboard.press('Enter');
  await sleep(1200);
  const picked = await kpg.evaluate(() => ({
    infoOpen: document.body.classList.contains('info-open'),
    sel: !!document.querySelector('#msList .ms-card.sel'),
    view: document.body.className.slice(0, 80)
  }));
  ok('기체 카드에 Tab 으로 간 뒤 Enter 로 고를 수 있다',
    focusedCard && (picked.infoOpen || picked.sel || picked.view !== before), { focusedCard, picked });
  // Space 는 화면을 내리면 안 된다 — 막았는지 본다
  await kpg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(2800);
  const sp = await kpg.evaluate(async () => {
    const g = document.querySelector('#msList');
    const c = document.querySelector('#msList .ms-card');
    if (!g || !c) return null;
    c.focus();
    const y0 = g.scrollTop;
    const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    const notPrevented = c.dispatchEvent(ev);
    return { y0, y1: g.scrollTop, prevented: !notPrevented };
  });
  ok('Space 로 눌러도 화면이 내려가지 않는다 (기본 동작을 막는다)',
    !!sp && sp.prevented === true, sp);
  await kb.br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
