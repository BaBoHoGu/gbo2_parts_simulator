// 기체 티어 탭이 제대로 도는지 실측한다.
//
//   node tools/tier_check.js
//
// 서버 없이 돌린다 — 투표 응답을 가로채 아는 값을 넣고, 순위가 그 값대로 나오는지 본다.
// 실제 서버를 쓰면 표가 바뀔 때마다 결과가 달라져 점검이 못 된다.
//
// 이 화면은 갤러리와 **같은 필터를 나눠 쓴다.** 그래서 「티어에서만 숨어야 할 것」이
// 실제로 숨는지가 핵심이다 — 실제로 한 번 안 숨었다(.gallery-grid 의 display:grid 가
// [hidden] 을 이겼다. 이 저장소가 같은 함정을 아홉 번 개별 규칙으로 막아 온 그것이다).
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

// 아는 값 — 순위·점수·비율이 이 값대로 나와야 한다
const TOTALS = {
  'ガンダムEz8': [12, 1],    // +11 · 92% · 13표
  'ゲルググ': [3, 7],        // -4  · 30% · 10표
  'ザクⅡ': [8, 2],          // +6  · 80% · 10표
  'V2ガンダム': [20, 3],     // +17 · 87% · 23표
  'ペーネロペー': [1, 0],     // +1  · 100% · 1표  ← 표가 적어 비율이 거짓말하는 사례
  'ガザC': [5, 5]            // 0   · 50% · 10표
};

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const pg = await br.newPage();
  await pg.setViewport({ width: 1500, height: 1100 });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 120)));
  await pg.evaluateOnNewDocument(t => {
    const real = window.fetch;
    window.fetch = async (u, o) => {
      if (String(u).includes('/votes')) {
        return new Response(JSON.stringify({ ok: true, kind: 'ms', totals: t, mine: {},
          left: { up: 5, down: 3 }, limit: { up: 5, down: 3 }, dev: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return real(u, o);
    };
  }, TOTALS);
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(3500);

  ok('갤러리에 티어 탭이 있다',
    await pg.evaluate(() => !!document.querySelector('#galleryTab button[data-t="ms"]')));

  await pg.evaluate(() => document.querySelector('#galleryBtn').click());
  await sleep(1400);
  await pg.evaluate(() => document.querySelector('#galleryTab button[data-t="ms"]').click());
  await sleep(1600);

  const read = () => pg.evaluate(() =>
    [...document.querySelectorAll('#tierResults .tier-row')].map(e => ({
      rank: (e.querySelector('.tier-rank') || {}).textContent,
      nm: (e.querySelector('.tier-nm') || {}).textContent,
      net: (e.querySelector('.tier-net') || {}).textContent,
      sub: (e.querySelector('.tier-sub') || {}).textContent
    })));

  const rows = await read();
  ok('순위가 그려진다 (표 있는 6기)', rows.length === 6, rows.length + '줄');
  ok('1위는 점수가 가장 높은 기체다',
    rows[0] && rows[0].rank === '1' && rows[0].net === '+17',
    JSON.stringify(rows[0]));
  ok('점수가 내림차순이다',
    rows.every((r, i) => i === 0 || Number(rows[i - 1].net) >= Number(r.net)),
    rows.map(r => r.net).join(' '));
  ok('비추가 많으면 음수로 내려간다',
    rows[rows.length - 1] && rows[rows.length - 1].net === '-4',
    JSON.stringify(rows[rows.length - 1]));

  /* 티어에서만 숨어야 할 것 — 갤러리 카드·구성 전용 필터·올리기.
     [hidden] 이 display 규칙에 져서 그대로 보인 적이 있어 **실제 높이**로 잰다. */
  const hid = await pg.evaluate(() => {
    const h = sel => { const e = document.querySelector(sel);
      return !e || e.getBoundingClientRect().height === 0; };
    return {
      gallery: h('#galleryResults'), lv: h('#galleryLvGroup'),
      upload: h('#galleryUpload'), tierShown: !h('#tierResults')
    };
  });
  ok('티어 보기에서 갤러리 카드가 숨는다', hid.gallery);
  ok('티어 보기에서 레벨 필터가 숨는다', hid.lv);        // 표는 LV 을 안 가른다
  ok('티어 보기에서 올리기 버튼이 숨는다', hid.upload);
  ok('티어 목록이 보인다', hid.tierShown);

  // 추천률 정렬 — 1표짜리 100% 가 위로 올라오면 안 된다
  await pg.evaluate(() =>
    [...document.querySelectorAll('#tierSortChips .chip')].find(c => c.textContent === '추천률').click());
  await sleep(800);
  const byRatio = await read();
  ok('추천률 정렬에서 표 적은 기체가 1위가 아니다',
    byRatio[0] && !/1표/.test(byRatio[0].sub || ''), JSON.stringify(byRatio[0]));

  // 필터가 티어에도 걸린다
  await pg.evaluate(() =>
    [...document.querySelectorAll('#galleryAttrChips .chip')].find(c => /강습/.test(c.textContent)).click());
  await sleep(800);
  const filtered = await read();
  ok('속성 필터가 티어에도 걸린다', filtered.length > 0 && filtered.length < rows.length,
    filtered.length + '기');

  ok('스크립트 오류 없음', errs.length === 0, [...new Set(errs)].slice(0, 2).join(' | '));
  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
