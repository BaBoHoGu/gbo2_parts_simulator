// 파츠 상세의 「끼우면 / 해제하면」 미리보기 실측.
//   node tools/preview_check.js
//
// PC 는 hover, 폰은 탭으로 같은 화면을 연다. 미장착·장착·칸 초과 세 경우가
// 각각 옳게 나오는지 본다. 이게 틀리면 사용자는 파츠를 실제로 끼워 보게 된다.
const path = require('path');
const ROOT = path.join(__dirname, '..');

let puppeteer, findChrome;
try {
  puppeteer = require('puppeteer-core');
  ({ findChrome } = require('./lib/wiki_fetch.js'));
} catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
const FILE = path.join(ROOT, 'dist', 'gbo2-simulator.html');
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }
const URL = 'file:///' + FILE.replace(/\\/g, '/').replace(/ /g, '%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fails = 0;
const check = (label, ok, extra) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + label + (extra ? '  — ' + extra : ''));
  if (!ok) fails++;
};

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const pg = await br.newPage();
  await pg.setViewport({ width: 1500, height: 1000 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await sleep(1500);
  await pg.evaluate(() => { const q = document.querySelector('#msQuery'); q.value = '크로스본 건담 X2'; q.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(600);
  await pg.evaluate(() => document.querySelector('.ms-card').click());
  await sleep(900);

  const hover = i => pg.evaluate(k => {
    const t = [...document.querySelectorAll('#partList .part-tile')][k];
    if (!t) return null;
    t.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    const p = document.querySelector('.d-preview');
    return {
      name: (document.querySelector('.d-name') || {}).textContent || '',
      text: p ? p.textContent.replace(/\s+/g, ' ').trim() : ''
    };
  }, i);

  // ① 미장착 파츠 — 「끼우면」 + 증가 + 들어감
  const a = await hover(6);
  console.log('① 미장착: ' + a.name + '\n     ' + a.text);
  check('「끼우면」 으로 열린다', /^끼우면/.test(a.text));
  check('증가분이 + 로 나온다', /\+\d/.test(a.text));
  check('슬롯 변화가 화살표로 나온다', /\d+\/\d+ → \d+\/\d+/.test(a.text));

  // ② 장착된 파츠 — 「해제하면」 + 감소 (하나 끼운 뒤에 본다)
  await pg.evaluate(() => { const t = document.querySelector("#partList .part-tile"); if (t) t.click(); });
  await sleep(800);
  const eq = await pg.evaluate(() => {
    const t = document.querySelector('#partList .part-tile.on');
    if (!t) return null;
    t.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    const p = document.querySelector('.d-preview');
    return { name: (document.querySelector('.d-name') || {}).textContent || '', text: p ? p.textContent.replace(/\s+/g, ' ').trim() : '' };
  });
  if (!eq) { console.log('② 장착된 파츠를 못 찾았습니다'); process.exit(1); }
  console.log('② 장착됨: ' + eq.name + '\n     ' + eq.text);
  check('「해제하면」 으로 열린다', /^해제하면/.test(eq.text));
  check('감소분이 - 로 나온다', /-\d/.test(eq.text));

  // ③ 칸을 채운 뒤 큰 파츠 — 「칸 초과」
  await pg.evaluate(() => {
    // 원거리를 많이 먹는 파츠부터 채운다
    const tiles = [...document.querySelectorAll('#partList .part-tile')];
    tiles.slice(0, 8).forEach(t => t.click());
  });
  await sleep(900);
  const over = await pg.evaluate(() => {
    for (const t of document.querySelectorAll('#partList .part-tile')) {
      t.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      const p = document.querySelector('.d-preview');
      const tx = p ? p.textContent.replace(/\s+/g, ' ').trim() : '';
      if (/칸 초과/.test(tx)) return { name: (document.querySelector('.d-name') || {}).textContent || '', text: tx };
    }
    return null;
  });
  if (over) { console.log('③ 칸 초과: ' + over.name + '\n     ' + over.text); check('칸이 넘치면 「칸 초과」 로 알린다', true); }
  else check('칸이 넘치면 「칸 초과」 로 알린다', false, '초과 사례를 못 만들었습니다');

  await br.close();
  console.log(fails ? '\n' + fails + '건 실패' : '\n미리보기 실측 통과');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
