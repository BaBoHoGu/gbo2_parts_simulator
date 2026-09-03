// 빌드 비교 2~4칸 실측.
//   node tools/compare_check.js
//
// 칸을 늘렸을 때 헤더·행의 칸 수가 맞는지, Δ 열이 2칸에서만 나오는지,
// 3칸 이상에서 최고값 표시가 붙는지, 가로로 페이지를 밀지 않는지 본다.
const path = require('path');
const ROOT = path.join(__dirname, '..');

let puppeteer, findChrome;
try {
  puppeteer = require('puppeteer-core');
  ({ findChrome } = require('./lib/wiki_fetch.js'));
} catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }
const URL = 'file:///' + path.join(ROOT, 'dist', 'gbo2-simulator.html').replace(/\\/g, '/').replace(/ /g, '%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fails = 0;
const check = (label, ok, extra) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + label + (!ok && extra ? '  — ' + extra : ''));
  if (!ok) fails++;
};

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const pg = await br.newPage();
  // 시작 시 스크립트가 죽으면 화면은 그럴듯하게 뜨고 배선만 끊긴다 — 조용히 지나가지 않게 잡는다
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 120)));
  await pg.setViewport({ width: 1500, height: 1000 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await sleep(1500);
  await pg.evaluate(() => { const q = document.querySelector('#msQuery'); q.value = '짐 스나이퍼'; q.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(700);
  await pg.evaluate(() => document.querySelector('.ms-card').click());
  await sleep(1200);

  // 비교 대상이 4개는 있어야 하므로, 앱의 저장 기능을 그대로 써서 구성을 만든다
  // (localStorage 를 직접 건드리면 저장 형식이 바뀌었을 때 점검이 조용히 헛돈다)
  for (let i = 1; i <= 3; i++) {
    await pg.evaluate(n => { window.prompt = () => '테스트' + n; }, i);
    // 매번 파츠를 하나 더 얹어 서로 다른 구성으로 만든다
    await pg.evaluate(k => {
      const tiles = [...document.querySelectorAll('.part-tile')];
      if (tiles[k]) tiles[k].click();
    }, i);
    await sleep(500);
    await pg.evaluate(() => document.querySelector('#save').click());
    await sleep(500);
  }
  const saved = await pg.evaluate(() => JSON.parse(localStorage.getItem('gbo2-offline-builds') || '[]').length);
  check('저장 구성 3개 준비', saved >= 3, '저장 ' + saved + '개');

  await pg.evaluate(() => document.querySelector('#compareBtn').click());
  await sleep(1200);

  const two = await pg.evaluate(() => {
    const row = document.querySelector('#compareBody .cmp-row');
    return {
      picks: document.querySelectorAll('#comparePick select').length,
      cols: row ? row.querySelectorAll('.cmp-v').length : 0,
      delta: !!(row && row.querySelector('.cmp-d')),
      addBtn: !!document.querySelector('.cmp-add')
    };
  });
  check('기본은 2칸', two.picks === 2 && two.cols === 2, `선택 ${two.picks} · 값 ${two.cols}`);
  check('2칸에는 Δ 열이 있다', two.delta);
  check('「구성 추가」 버튼이 있다', two.addBtn);

  // 4칸까지 늘린다
  for (let i = 0; i < 2; i++) {
    await pg.evaluate(() => document.querySelector('.cmp-add').click());
    await sleep(700);
  }
  const four = await pg.evaluate(() => {
    const row = document.querySelector('#compareBody .cmp-row');
    const heads = document.querySelectorAll('#compareBody .cmp-head .cmp-id').length;
    return {
      picks: document.querySelectorAll('#comparePick select').length,
      cols: row ? row.querySelectorAll('.cmp-v').length : 0,
      heads,
      delta: !!(row && row.querySelector('.cmp-d')),
      best: document.querySelectorAll('#compareBody .cmp-v.best').length,
      drops: document.querySelectorAll('.cmp-drop').length,
      addBtn: !!document.querySelector('.cmp-add'),
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      rows: document.querySelectorAll('#compareBody .cmp-row').length
    };
  });
  check('4칸으로 늘어난다', four.picks === 4 && four.cols === 4 && four.heads === 4,
    `선택 ${four.picks} · 값 ${four.cols} · 헤더 ${four.heads}`);
  check('3칸 이상에서는 Δ 열이 빠진다', !four.delta);
  check('최고값 표시가 붙는다', four.best > 0, '표시 ' + four.best + '개');
  check('A·B 는 못 빼고 C·D 만 뺄 수 있다', four.drops === 2, '× 버튼 ' + four.drops + '개');
  check('4칸이면 추가 버튼이 사라진다', !four.addBtn);
  check('페이지가 가로로 밀리지 않는다', !four.pageOverflow);
  console.log('   비교 행 ' + four.rows + '개');

  // 칸 빼기
  await pg.evaluate(() => document.querySelector('.cmp-drop').click());
  await sleep(700);
  const three = await pg.evaluate(() => ({
    picks: document.querySelectorAll('#comparePick select').length,
    cols: document.querySelector('#compareBody .cmp-row').querySelectorAll('.cmp-v').length
  }));
  check('칸을 빼면 3칸이 된다', three.picks === 3 && three.cols === 3, `선택 ${three.picks} · 값 ${three.cols}`);

  // 폰 세로에서도 표가 자기 안에서만 스크롤되는지
  await pg.setViewport({ width: 390, height: 844 });
  await sleep(900);
  const phone = await pg.evaluate(() => {
    const b = document.querySelector('#compareBody');
    return { page: document.documentElement.scrollWidth > window.innerWidth + 1,
      inner: b.scrollWidth > b.clientWidth };
  });
  check('폰에서도 페이지가 가로로 밀리지 않는다', !phone.page);
  check('폰에서는 표가 자기 안에서 가로 스크롤된다', phone.inner);

  check('스크립트 오류 없음', errs.length === 0, errs.join(' / '));

  await br.close();
  console.log(fails ? '\n' + fails + '건 실패' : '\n비교 다칸 실측 통과');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
