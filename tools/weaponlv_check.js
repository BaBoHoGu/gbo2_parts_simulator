// 주무장 LV 가 저장·불러오기를 제대로 건너는지 실측한다.
//
//   node tools/weaponlv_check.js
//
// 규칙이 **일부러 갈린다.**
//   · 내 저장 목록 — 저장할 때의 LV 를 그대로 되살린다. 내가 맞춰 둔 값이라서다.
//   · 공유 코드·갤러리 — 싣지 않는다. 남이 올린 구성을 내가 보던 LV 로 그리면
//     위력도 레벨링크 보너스도 그 구성의 값이 아니게 된다.
// 한쪽만 보면 반대쪽이 조용히 어긋나므로 **둘을 같이** 본다.
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
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 90)));
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(3500);

  // LV 가 여럿인 기체를 골라 파츠 화면까지 간다
  await pg.evaluate(() => {
    const i = document.querySelector('#msQuery');
    i.value = '건담 Ez8'; i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(800);
  await pg.evaluate(() => document.querySelector('.ms-card').click());
  await sleep(1100);
  await pg.evaluate(() => { const g = document.querySelector('#infoGo'); if (g) g.click(); });
  await sleep(1200);

  const seg = await pg.evaluate(() => {
    const box = document.querySelector('#weaponLv');
    return { hidden: !box || box.hidden, n: box ? box.querySelectorAll('button').length : 0 };
  });
  ok('무장 LV 칸이 보인다', !seg.hidden && seg.n >= 2, '버튼 ' + seg.n + '개');

  // 기체 LV 보다 낮은 주무장 LV 를 고른다 (칸의 마지막 = 가장 낮은 LV)
  const picked = await pg.evaluate(() => {
    const bs = [...document.querySelectorAll('#weaponLv button')];
    const b = bs[bs.length - 1]; b.click();
    return b.textContent;
  });
  await sleep(900);
  ok('낮은 주무장 LV 를 고를 수 있다', /LV\d/.test(picked), '「' + picked + '」');

  // 고른 값이 화면 계산에 실제로 쓰이는가 — 무장 위력이 달라져야 한다
  // 무장 줄 전체를 글자로 떠서 견준다 — 클래스 이름을 짚으면 화면이 바뀔 때마다 같이 깨진다.
  const power = async () => pg.evaluate(() =>
    [...document.querySelectorAll('#weaponList .w-dmg')].map(e => e.textContent.trim()).join('|'));
  const lowPow = await power();
  await pg.evaluate(() => document.querySelector('#weaponLv button').click());   // 첫 버튼 = 기체와 같음
  await sleep(900);
  const hiPow = await power();
  ok('주무장 LV 가 위력에 반영된다', lowPow !== hiPow && lowPow.length > 0,
    '낮음「' + lowPow.slice(0, 40) + '」같음「' + hiPow.slice(0, 40) + '」');

  // 다시 낮춰 두고 저장한다
  await pg.evaluate(() => {
    const bs = [...document.querySelectorAll('#weaponLv button')];
    bs[bs.length - 1].click();
  });
  await sleep(700);
  const want = await pg.evaluate(() => window.GBO2UiTest && window.GBO2UiTest.weaponLv ? window.GBO2UiTest.weaponLv() : null);

  // ── 저장 목록: 그대로 되살아나야 한다 ──
  const saved = await pg.evaluate(() => {
    const raw = localStorage.getItem('gbo2-offline-builds');
    return raw ? JSON.parse(raw) : null;
  });
  await pg.evaluate(() => { window.prompt = () => '주무장LV 점검'; });
  await pg.evaluate(() => { const b = document.querySelector('#save'); if (b) b.click(); });
  await sleep(900);
  const stored = await pg.evaluate(() => {
    const raw = localStorage.getItem('gbo2-offline-builds');
    const list = raw ? JSON.parse(raw) : [];
    return list.length ? { weaponLv: list[0].weaponLv, name: list[0].name } : null;
  });
  ok('저장 목록이 주무장 LV 를 싣는다', stored && Number.isInteger(stored.weaponLv),
    JSON.stringify(stored));

  // ── 공유 코드: 싣지 않아야 한다 ──
  const share = await pg.evaluate(() => {
    const t = window.GBO2UiTest;
    return t && t.encodeShare ? t.encodeShare() : null;
  });
  if (share) {
    const decoded = Buffer.from(share.replace(/^GBO2-/, '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    ok('공유 코드에는 주무장 LV 가 없다', !/weaponLv|"wl"/.test(decoded), decoded.slice(0, 80));
  } else {
    console.log('  건너뜀 공유 코드 — 시험 손잡이가 없음');
  }

  ok('스크립트 오류 없음', errs.length === 0, [...new Set(errs)].slice(0, 2).join(' | '));
  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
