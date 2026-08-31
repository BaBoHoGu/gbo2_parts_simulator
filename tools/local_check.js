// 국부 보정 실측 — 토글을 켜면 무장 표에 칩이 붙고, 피탄 시뮬 격파수가 배율만큼 바뀌는지.
//   node tools/local_check.js
//
// 어디에 맞는지는 시뮬레이터가 알 수 없다. 그래서 이 값은 켰을 때만 쓰며,
// 켜고 끈 결과가 배율과 정확히 맞아야 한다(틀리면 조용히 과대·과소 평가가 된다).
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
const URL = 'file:///' + FILE.replace(/\\/g, '/').replace(/ /g, '%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fails = 0;
const check = (label, ok, extra) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + label + (!ok && extra ? '  — ' + extra : ''));
  if (!ok) fails++;
};

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const pg = await br.newPage();
  await pg.setViewport({ width: 1500, height: 1000 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await sleep(1500);
  await pg.evaluate(() => { const q = document.querySelector('#msQuery'); q.value = '육전형 건담'; q.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(700);
  await pg.evaluate(() => document.querySelector('.ms-card').click());
  await sleep(1000);

  const chips = () => pg.evaluate(() => document.querySelectorAll('.w-local').length);
  check('끄면 칩이 없다', await chips() === 0);

  // 피탄 시뮬을 열고 토글한다
  await pg.evaluate(() => document.querySelector('#pietanBtn').click());
  await sleep(600);
  await pg.evaluate(() => { const q = document.querySelector('#pietanQuery'); q.value = '자쿠'; q.dispatchEvent(new Event('input')); });
  await sleep(700);
  await pg.evaluate(() => { const r = document.querySelector('#pietanModal .pietan-row'); if (r) r.click(); });
  await sleep(900);

  // 무장 이름 → 1트리거 피해. 격파수는 올림이라 배율이 작으면 안 바뀔 수 있어 피해로 본다.
  const readHits = () => pg.evaluate(() => {
    const out = {};
    for (const r of document.querySelectorAll('#pietanModal .pietan-out-row')) {
      const nm = (r.querySelector('.pietan-out-nm') || {}).textContent || '';
      const dm = (r.querySelector('.pietan-out-dmg') || {}).textContent || '';
      const m = dm.replace(/,/g, '').match(/(\d+)/);
      if (nm && m) out[nm.replace(/\s+/g, ' ').trim()] = Number(m[1]);
    }
    return out;
  });
  const before = await readHits();

  await pg.evaluate(() => document.querySelector('#pietanLocal').click());
  await sleep(900);
  const after = await readHits();
  const on = await pg.evaluate(() => document.querySelector('#pietanLocal').classList.contains('on'));
  check('토글이 켜진다', on);
  check('무장 표에 칩이 붙는다', await chips() > 0, '칩 ' + await chips() + '개');

  const names = Object.keys(before).filter(k => after[k] != null);
  const moved = names.filter(k => after[k] !== before[k]);
  console.log('  피해 비교 대상 ' + names.length + '종 · 변한 것 ' + moved.length + '종');
  for (const k of moved.slice(0, 4)) console.log('     ' + k + '  ' + before[k].toLocaleString() + ' → ' + after[k].toLocaleString());
  // '변했다' 로는 부족하다 — 위키 표기 배율과 정확히 맞는지 본다.
  const mults = await pg.evaluate(() => {
    const out = {};
    for (const c of document.querySelectorAll('.w-local')) {
      const row = c.closest('.weapon');
      const nm = row ? (row.querySelector('.w-nm') || {}).textContent || '' : '';
      const m = c.textContent.match(/([\d.]+)/);
      if (nm && m) out[nm.replace(/\s+/g, ' ').trim().replace(/[🦵🛡].*$/, '').trim()] = Number(m[1]);
    }
    return out;
  });
  let exact = 0, wrong = [];
  for (const k of moved) {
    const key = Object.keys(mults).find(x => x.startsWith(k) || k.startsWith(x));
    if (!key) continue;
    const want = Math.floor(before[k] * mults[key]);
    if (want === after[k]) exact++;
    else wrong.push(k + ' ' + before[k] + '×' + mults[key] + ' → ' + want + ' 인데 ' + after[k]);
  }
  console.log('  배율 대조 ' + exact + '종 일치' + (wrong.length ? ' · 불일치 ' + wrong.length : ''));
  for (const w of wrong.slice(0, 3)) console.log('     ' + w);
  check('국부 배율이 피해에 정확히 반영된다', names.length > 0 && exact > 0 && wrong.length === 0,
    names.length === 0 ? '피해 행을 못 읽음' : wrong.length ? '배율과 어긋남' : '대조할 무장이 없음');

  await br.close();
  console.log(fails ? '\n' + fails + '건 실패' : '\n국부 보정 실측 통과');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
