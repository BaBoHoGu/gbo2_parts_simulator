// 글자 크기 토큰 정리 전후를 **계산값으로** 비교한다.
//
//   node tools/font_scale_check.js <이전 dist.html> [<이후 dist.html>]
//
// 왜 — font-size 를 토큰으로 합치면 「0.5px 차이」가 사라지는데, 그 0.5px 가 **모바일 축소
// 규칙**이었던 자리가 있다. 합치는 순간 덮어쓰기가 같은 값이 되어 조용히 무효가 된다.
// 규칙을 읽어서는 어느 자리가 그런지 알기 어려우므로, 실제 화면에서 모든 요소의
// getComputedStyle().fontSize 를 떠서 전후를 맞춰 본다.
//
// 「달라진 것이 없어야 한다」가 아니다 — 합쳤으니 달라지는 게 정상이다.
// 보려는 것은 **얼마나·어디가** 달라졌는지다. 1px 넘게 움직인 자리는 눈에 띄므로 따로 센다.
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

const before = process.argv[2];
const after = process.argv[3] || path.join(ROOT, 'dist', 'gbo2-simulator.html');
if (!before || !fs.existsSync(before)) {
  console.log('사용법: node tools/font_scale_check.js <이전 dist.html> [<이후 dist.html>]');
  process.exit(2);
}

const VIEWS = [
  { w: 1500, h: 1000, tag: 'desktop' },
  { w: 390, h: 844, tag: '폰세로' },
  { w: 844, h: 390, tag: '폰가로' }
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const url = f => 'file:///' + path.resolve(f).replace(/\\/g, '/').replace(/ /g, '%20');

/** 화면을 띄워 모든 요소의 (경로, 글자크기) 를 뜬다. */
async function snap(br, file, view) {
  const pg = await br.newPage();
  await pg.setViewport({ width: view.w, height: view.h });
  await pg.goto(url(file), { waitUntil: 'load', timeout: 180000 });
  await sleep(3500);
  // 기체를 하나 골라 파츠 화면까지 들어간다 — 목록 화면만 보면 대부분의 규칙이 안 걸린다.
  await pg.evaluate(() => {
    const i = document.querySelector('#msQuery');
    if (i) { i.value = '짐'; i.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await sleep(900);
  await pg.evaluate(() => { const c = document.querySelector('.ms-card'); if (c) c.click(); });
  await sleep(1100);
  await pg.evaluate(() => { const g = document.querySelector('#infoGo'); if (g) g.click(); });
  await sleep(1800);
  const out = await pg.evaluate(() => {
    const map = {};
    const pathOf = el => {
      const bits = [];
      for (let e = el; e && e.nodeType === 1 && bits.length < 6; e = e.parentElement) {
        let b = e.tagName.toLowerCase();
        if (e.id) { bits.unshift(b + '#' + e.id); break; }
        if (e.className && typeof e.className === 'string')
          b += '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.');
        const sibs = e.parentElement ? [...e.parentElement.children].filter(x => x.tagName === e.tagName) : [];
        if (sibs.length > 1) b += ':' + sibs.indexOf(e);
        bits.unshift(b);
      }
      return bits.join('>');
    };
    for (const el of document.querySelectorAll('*')) {
      if (!el.offsetParent && el.tagName !== 'BODY') continue;   // 안 보이는 것은 건너뛴다
      map[pathOf(el)] = parseFloat(getComputedStyle(el).fontSize);
    }
    return map;
  });
  await pg.close();
  return out;
}

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  let big = 0, small = 0, same = 0, onlyOne = 0;
  const bigList = [];
  for (const v of VIEWS) {
    const a = await snap(br, before, v);
    const b = await snap(br, after, v);
    let vs = 0, vb = 0, vsame = 0;
    for (const k of Object.keys(a)) {
      if (!(k in b)) { onlyOne++; continue; }
      const d = Math.round((b[k] - a[k]) * 100) / 100;
      if (d === 0) { vsame++; same++; continue; }
      if (Math.abs(d) > 0.5) { vb++; big++; bigList.push(v.tag + '  ' + k + '  ' + a[k] + ' → ' + b[k]); }
      else { vs++; small++; }
    }
    console.log('■ ' + v.tag + '  요소 ' + Object.keys(a).length
      + '  같음 ' + vsame + ' · 0.5px 이내 ' + vs + ' · 0.5px 초과 ' + vb);
  }
  await br.close();

  console.log('\n합계 — 같음 ' + same + ' · 0.5px 이내 ' + small + ' · **0.5px 초과 ' + big + '**'
    + (onlyOne ? ' (한쪽에만 있는 요소 ' + onlyOne + ' 는 제외)' : ''));
  if (bigList.length) {
    console.log('\n0.5px 넘게 움직인 자리 (눈에 띌 수 있다):');
    for (const l of [...new Set(bigList)].slice(0, 40)) console.log('  ' + l);
  }
  // 0.5px 이내는 합치기의 의도다. 그보다 크게 움직인 자리는 사람이 봐야 한다 —
  // 실패로 떨구지 않고 목록으로 낸다.
  console.log('\n※ 0.5px 이내는 합치기의 의도입니다. 초과분은 눈으로 확인하세요.');
})();
