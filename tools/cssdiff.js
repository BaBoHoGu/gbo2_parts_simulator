// CSS 를 **모양을 바꾸지 않고** 정리할 때 쓰는 자 — 화면을 찍어 픽셀로 맞댄다.
//
//   node tools/cssdiff.js --save <폴더>            기준 사진을 찍어 둔다
//   node tools/cssdiff.js --diff <폴더> [--max N]  지금 빌드와 맞대 본다 (기본 허용 0)
//
// ■ 왜 — 「겹겹이 덧붙인 규칙 합치기」·「미디어 조건을 body 클래스로 옮기기」 같은 정리는
//   **특이도가 바뀐다.** @media 안의 `.x` 는 (0,1,0) 인데 `body.compact .x` 는 (0,2,0) 이라,
//   뒤에 오는 다른 규칙과의 승부가 뒤집힐 수 있다. 「같은 조건을 옮길 뿐」이라는 말은
//   재 보지 않으면 믿을 수 없다 — 그래서 **사진으로** 재고, 다른 픽셀 수를 보고한다.
//
// ■ 쓰는 법 — 정리 **전에** `--save` 로 기준을 찍고, 고친 뒤 `--diff` 로 맞댄다.
//   의도한 변화가 있는 단계에서는 `--max` 로 허용치를 올리되, 어느 화면이 몇 픽셀
//   달라졌는지 눈으로 확인한 뒤에만 올린다(숫자만 올리면 자가 헛것이 된다).
'use strict';
const GBO2Browser = require('./lib/browser.js');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
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

const ARG = process.argv.slice(2);
const MODE = ARG.includes('--save') ? 'save' : ARG.includes('--diff') ? 'diff' : null;
const DIR = ARG[ARG.indexOf('--' + MODE) + 1];
const MAX = Number((ARG[ARG.indexOf('--max') + 1] || '0')) || 0;
if (!MODE || !DIR || DIR.startsWith('--')) {
  console.log('쓰기: node tools/cssdiff.js --save <폴더> | --diff <폴더> [--max N]');
  process.exit(2);
}

/* 기기 — ui_check 와 **같은 목록**을 쓴다. 두 벌로 두면 한쪽만 늘어난다. */
const VIEWS = [
  { tag: 'desktop', w: 1500, h: 1000, touch: false, mobile: false },
  { tag: 'notebook', w: 1280, h: 720, touch: false, mobile: false },
  { tag: 'tablet', w: 1024, h: 768, touch: true, mobile: false },
  { tag: 'phoneWide', w: 390, h: 844, touch: true, mobile: false, viewMode: 'wide' },
  { tag: 'phoneLarge', w: 390, h: 844, touch: true, mobile: true, viewMode: 'large' },
  { tag: 'phoneLand', w: 844, h: 390, touch: true, mobile: true },
  { tag: 'stylus', w: 800, h: 372, touch: false, mobile: true }
];

/* 화면 — 한 번 들어가면 되돌리기 어려운 것(모달)은 열고 닫는다. */
const SCENES = [
  { tag: 'select', go: async pg => { await sleep(600); } },
  { tag: 'build', go: async pg => {
    await pg.evaluate(() => {
      const q = document.querySelector('#msQuery');
      q.value = '사자비'; q.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(700);
    await pg.evaluate(() => { const c = document.querySelector('#msList .ms-card'); if (c) c.click(); });
    await sleep(900);
    await pg.evaluate(() => { const g = document.querySelector('#infoGo'); if (g) g.click(); });
    await sleep(1200);
  } },
  { tag: 'build+parts', go: async pg => {
    await pg.evaluate(() => {
      for (let i = 0; i < 3; i++) {
        const t = document.querySelector('#partList .part-tile:not(.blocked):not(.on)');
        if (t) t.click();
      }
    });
    await sleep(900);
  } },
  { tag: 'auto', go: async pg => {
    await pg.evaluate(() => { const b = document.querySelector('#openAuto'); if (b) b.click(); });
    await sleep(1100);
  } },
  { tag: 'autoClose', go: async pg => {
    await pg.evaluate(() => { const b = document.querySelector('#closeAuto'); if (b) b.click(); });
    await sleep(600);
  } },
  { tag: 'duel', go: async pg => {
    await pg.evaluate(() => { const b = document.querySelector('#duelBtn'); if (b) b.click(); });
    await sleep(1300);
  } },
  { tag: 'duelClose', go: async pg => {
    await pg.evaluate(() => { const b = document.querySelector('#duelClose'); if (b) b.click(); });
    await sleep(600);
  } },
  { tag: 'compare', go: async pg => {
    await pg.evaluate(() => { const b = document.querySelector('#compareBtn'); if (b) b.click(); });
    await sleep(1100);
  } },
  { tag: 'compareClose', go: async pg => {
    await pg.evaluate(() => { const b = document.querySelector('#compareModalClose'); if (b) b.click(); });
    await sleep(500);
  } },
  { tag: 'patch', go: async pg => {
    await pg.evaluate(() => { const b = document.querySelector('#patchBtn'); if (b) b.click(); });
    await sleep(1200);
  } },
  { tag: 'codex', go: async pg => {
    await pg.evaluate(() => { const b = document.querySelector('#codexBtn'); if (b) b.click(); });
    await sleep(1200);
  } },
  { tag: 'token', go: async pg => {
    await pg.evaluate(() => { const b = document.querySelector('#tokenBtn'); if (b) b.click(); });
    await sleep(1100);
  } }
];

/** PNG 를 날 픽셀로 — 라이브러리 없이 IDAT 를 풀어 읽는다(8비트 RGBA/RGB 만). */
function pngPixels(buf) {
  let i = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, idat = [];
  while (i < buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    const data = buf.slice(i + 8, i + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    i += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) return null;
  const ch = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * ch);
  const stride = w * ch;
  let p = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[p++];
    const line = raw.slice(p, p + stride); p += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, ch, px: out };
}

/** 두 PNG 를 맞댄다 — {n, box} 또는 음수(코드). box 는 다른 픽셀을 감싸는 사각형.
 *  **어디가 달라졌는지 알려 주는 것이 수보다 중요하다** — 숫자만 보면 레이아웃이 밀린
 *  것인지, 글자 한 줄이 바뀐 것인지(날짜처럼 날마다 달라지는 것) 가릴 수 없다. */
function diffPng(a, b) {
  const A = pngPixels(a), B = pngPixels(b);
  if (!A || !B) return -2;
  if (A.w !== B.w || A.h !== B.h || A.ch !== B.ch) return -1;
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let i = 0, p = 0; i < A.px.length; i += A.ch, p++) {
    let d = false;
    for (let k = 0; k < A.ch; k++) if (A.px[i + k] !== B.px[i + k]) { d = true; break; }
    if (!d) continue;
    n++;
    const x = p % A.w, y = (p - x) / A.w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { n, box: n ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null,
    size: { w: A.w, h: A.h } };
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  let shots = 0, bad = 0, missing = 0;
  const report = [];

  for (const v of VIEWS) {
    const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new',
      args: ['--no-sandbox', '--allow-file-access-from-files', '--force-device-scale-factor=1',
        '--hide-scrollbars', '--font-render-hinting=none'] });
    const pg = await br.newPage();
    /* **시계를 얼린다.** 토큰 계산기는 오늘 날짜를 칸에 채우고, 픽업 남은 일수를 센다 —
       날이 바뀌면 글자 한 자가 달라져 자가 헛되이 운다(실제로 9×10 픽셀 한 자였다).
       CSS 를 재는 자리이므로 시각은 고정해 둔다. 모든 스크립트보다 먼저 걸어야 한다. */
    await pg.evaluateOnNewDocument(() => {
      const FIXED = 1768521600000;   // 2026-01-16 00:00 (현지)
      const Real = Date;
      function Fake(...a) { return a.length ? new Real(...a) : new Real(FIXED); }
      Fake.prototype = Real.prototype;
      Fake.now = () => FIXED;
      Fake.parse = Real.parse;
      Fake.UTC = Real.UTC;
      window.Date = Fake;
    });
    await pg.setViewport({ width: v.w, height: v.h, isMobile: v.mobile, hasTouch: v.touch,
      deviceScaleFactor: 1 });
    await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
    await sleep(3200);
    /* 화면 모드를 맞춘다 — 폰 세로는 「넓게/크게」 둘이라 한쪽만 보면 다른 쪽이 깨진다. */
    if (v.viewMode) {
      await pg.evaluate(m => {
        try { localStorage.setItem('gbo2.viewMode', m); } catch { /* 무시 */ }
      }, v.viewMode);
      await pg.reload({ waitUntil: 'load', timeout: 180000 });
      await sleep(3000);
    }
    /* 움직이는 것을 멈춘다 — 토스트·전환은 찍는 순간마다 달라 자가 헛되이 운다. */
    await pg.addStyleTag({ content:
      '*,*::before,*::after{transition:none!important;animation:none!important}' +
      '#toast{display:none!important}' });
    /* 빌드 스탬프는 **다시 빌드할 때마다** 바뀐다(「데이터 2026-10-13-0954 …」).
       시계와 달리 Date 로 막을 수 없으니 글자를 고정한다 — 35×8 픽셀이 그것이었다. */
    await pg.evaluate(() => {
      const d = document.getElementById('dataFresh');
      if (d) d.textContent = '데이터 고정 · 기체 0 · 파츠 0 · 무장 0';
    });

    for (const sc of SCENES) {
      try { await sc.go(pg); } catch { /* 그 화면이 없으면 건너뛴다 */ }
      const name = v.tag + '__' + sc.tag + '.png';
      const buf = await pg.screenshot({ fullPage: false });
      shots++;
      const at = path.join(DIR, name);
      if (MODE === 'save') { fs.writeFileSync(at, buf); continue; }
      if (!fs.existsSync(at)) { missing++; report.push([name, '기준 사진 없음']); continue; }
      const r = diffPng(fs.readFileSync(at), buf);
      if (r === -2) { report.push([name, 'PNG 를 못 읽음']); bad++; continue; }
      if (r === -1) { report.push([name, '크기가 달라졌다']); bad++; continue; }
      if (r.n > MAX) {
        const b2 = r.box;
        report.push([name, r.n.toLocaleString() + ' 픽셀 · 자리 x' + b2.x + ' y' + b2.y
          + ' ' + b2.w + '×' + b2.h + ' (화면 ' + r.size.w + '×' + r.size.h + ')']);
        bad++;
        /* 달라진 쪽 사진을 남긴다 — 눈으로 봐야 「날짜가 바뀐 것」과 「배치가 밀린 것」이 갈린다. */
        try { fs.writeFileSync(path.join(DIR, 'NOW__' + name), buf); } catch { /* 무시 */ }
      }
    }
    await br.close();
  }

  if (MODE === 'save') {
    console.log('기준 사진 ' + shots + '장 → ' + DIR);
    process.exit(0);
  }
  console.log('맞댄 사진 ' + shots + '장 · 허용 ' + MAX + ' 픽셀');
  for (const [n, why] of report) console.log('  ' + (why.includes('없음') ? 'SKIP' : 'FAIL') + ' ' + n + ' — ' + why);
  if (missing) console.log('  (기준 사진이 없는 ' + missing + '장은 셈에서 빼고 넘어간다)');
  console.log(bad ? '\n' + bad + '장이 달라졌다' : '\n' + (shots - missing) + '장 모두 같다');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
