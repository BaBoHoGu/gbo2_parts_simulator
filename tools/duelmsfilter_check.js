// 대결 「기체 고르기」 의 속성 · 코스트 · 레벨 필터 — 실측.
//   node tools/duelmsfilter_check.js
//
// ■ 왜 — 대결에서 기체를 바꿀 때 검색칸 하나뿐이라 597기 가운데 앞 120기만 보였다(사용자 요청
//   2026-10-15). 필터를 붙였다. 코스트는 LV 마다 다르다(같은 기체 LV1 300 · LV2 350 …) —
//   그래서 「LV2 · 300」 을 고르면 **LV2 의 코스트가 300 인** 기체만 남아야 하고, 누르면 그 LV 로
//   들어가야 한다. 남은 줄이 조건에 다 맞는지 · 누른 결과가 맞는지 · 칩이 데이터와 같은지를 잰다.
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

const MS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'msData.json'), 'utf8'));
const COSTS = [...new Set(MS.map(m => Number(m['コスト'])).filter(c => c > 0))].sort((a, b) => a - b).map(String);

(async () => {
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files', '--hide-scrollbars'] });
  for (const view of [{ tag: '데스크톱', width: 1500, height: 1000 }, { tag: '폰', width: 390, height: 844, isMobile: true, hasTouch: true }]) {
    const pg = await br.newPage();
    await pg.setViewport({ ...view, deviceScaleFactor: 1 });
    await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
    await sleep(2400);
    await pg.evaluate(() => window.GBO2Duel.open());
    await sleep(700);
    /* 오른쪽(상대)은 처음에 「고르기」 상태다. 폰에서는 탭이 「나의 기체」 라 상대 탭으로 옮긴다 */
    await pg.evaluate(() => { const t = document.querySelector('.duel-tabs [data-t="R"]'); if (t) t.click(); });
    await sleep(300);
    const SIDE = '.duel-side[data-side="R"]';
    const st = () => pg.evaluate(SIDE => {
      const p = document.querySelector(SIDE + ' .ds-mspick');
      if (!p) return null;
      return { count: parseInt(p.querySelector('.ds-mscount').textContent, 10),
        rows: [...p.querySelectorAll('.ds-msrow small')].map(e => e.textContent.trim()) };
    }, SIDE);
    const tap = (row, t) => pg.evaluate((SIDE, row, t) => {
      const r = [...document.querySelectorAll(SIDE + ' .ds-mf-row')].find(x => x.querySelector('.ds-mf-lb').textContent === row);
      const c = r && [...r.querySelectorAll('.chip')].find(e => e.textContent === t);
      if (c) c.click();
      return !!c;
    }, SIDE, row, t);
    const T = view.tag + ' · ';

    if (view.tag === '데스크톱') {
      const chips = await pg.evaluate(SIDE => {
        const r = [...document.querySelectorAll(SIDE + ' .ds-mf-row')].find(x => x.querySelector('.ds-mf-lb').textContent === '코스트');
        return r ? [...r.querySelectorAll('.chip')].map(e => e.textContent).filter(t => t !== '전체') : [];
      }, SIDE);
      ok('코스트 칩이 데이터의 코스트와 같다 (' + COSTS.length + '가지)', JSON.stringify(chips) === JSON.stringify(COSTS), { chips, COSTS });
    }

    const s0 = await st();
    ok(T + '처음 목록이 나온다 (' + (s0 && s0.count) + '기)', !!s0 && s0.count > 100, s0);
    await tap('속성', '강습'); await sleep(200);
    const s1 = await st();
    ok(T + '강습 — 남은 줄이 전부 강습이다 (' + s1.count + '기)',
      s1.count < s0.count && s1.rows.length > 0 && s1.rows.every(t => t.startsWith('강습')), s1.rows.filter(t => !t.startsWith('강습')).slice(0, 3));
    await tap('코스트', '300'); await sleep(200);
    const s2 = await st();
    ok(T + '+ 코스트 300 — 전부 300 이다 (' + s2.count + '기)',
      s2.count <= s1.count && s2.rows.length > 0 && s2.rows.every(t => /· 300$/.test(t)), s2.rows.slice(0, 3));
    await tap('레벨', 'LV2'); await sleep(200);
    const s3 = await st();
    ok(T + '+ LV2 — 전부 「강습 · LV2 · 300」 이다 (' + s3.count + '기)',
      s3.rows.length > 0 && s3.rows.every(t => t === '강습 · LV2 · 300'), s3.rows.slice(0, 3));

    if (view.tag === '데스크톱') {
      /* 누르면 그 LV 의 기체로 들어간다 — 가장 높은 LV 로 들어가면 코스트가 달라진다 */
      await pg.evaluate(SIDE => document.querySelector(SIDE + ' .ds-msrow').click(), SIDE);
      await sleep(600);
      const got = await pg.evaluate(() => {
        const m = window.GBO2Duel.state.R.ms;
        return m && { name: m.MS名, cost: Number(m.コスト), attr: m.属性 };
      });
      ok('줄을 누르면 고른 조건의 기체로 들어간다 (LV2 · 300 · 강습)',
        !!got && /_LV2$/.test(got.name) && got.cost === 300 && got.attr === '強襲', got);
      /* 다시 고르기를 열면 필터가 남아 있다(같은 조건으로 다른 기체를 보기 쉽게) */
      await pg.evaluate(SIDE => {
        const b = [...document.querySelectorAll(SIDE + ' button')].find(e => /기체 변경/.test(e.textContent));
        if (b) b.click();
      }, SIDE);
      await sleep(400);
      const again = await st();
      ok('기체 변경을 다시 열면 필터가 그대로다', !!again && again.count === s3.count, again && again.count);
      await tap('속성', '전체'); await tap('코스트', '전체'); await tap('레벨', '전체'); await sleep(200);
      const back = await st();
      ok('「전체」 로 되돌리면 처음 개수로 돌아온다 (' + back.count + ' = ' + s0.count + ')', back.count === s0.count, back.count);
    } else {
      /* 폰 — 칩 줄이 판 밖으로 넘치지 않는다(가로 스크롤이 생기지 않는다) */
      const over = await pg.evaluate(SIDE => {
        const f = document.querySelector(SIDE + ' .ds-msfilter');
        const p = document.querySelector(SIDE);
        const fr = f.getBoundingClientRect(), pr = p.getBoundingClientRect();
        return { fw: f.scrollWidth, cw: f.clientWidth, right: Math.round(fr.right), pRight: Math.round(pr.right) };
      }, SIDE);
      ok('폰 — 필터 칩이 판 안에 들어온다', over.fw <= over.cw + 1 && over.right <= over.pRight + 1, over);
    }
    await pg.close();
  }
  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
