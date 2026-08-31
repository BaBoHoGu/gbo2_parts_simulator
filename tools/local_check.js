// 국부(局部) 보정 실측.
//   node tools/local_check.js
//
// 국부 보정은 **부위 파괴에만 걸린다 — 기체 HP 피해에는 영향이 없다**(2026-08-31 사용자 확인).
// 그래서 두 가지를 본다:
//   ① 무장 표 「국부」 열이 위키 표기대로 나오는가
//   ② 그 값이 격파수·피해 계산에 새어 들어가지 않는가  ← 한 번 잘못 넣었던 자리다
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

  // ① 열이 제자리에 있고 값이 나오는가
  const cols = await pg.evaluate(() => {
    const r = document.querySelector('#weaponList > *');
    const head = [...document.querySelectorAll('.weapon-head span')];
    return { head: head.length, row: r ? r.children.length : 0, last: (head[head.length - 1] || {}).textContent.trim() };
  });
  check('머리글과 행의 칸 수가 같다', cols.head === cols.row, cols.head + ' vs ' + cols.row);
  check('마지막 열이 「국부」 다', cols.last === '국부', cols.last);

  const rows = await pg.evaluate(() => [...document.querySelectorAll('#weaponList > *')].map(r => ({
    nm: ((r.querySelector('.w-nm') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    v: ((r.querySelector('.w-base') || {}).textContent || '').trim()
  })));
  for (const r of rows) console.log('     ' + r.nm.padEnd(24) + '  ' + r.v);
  check('배율이 표기된 무장이 있다', rows.some(r => /배$/.test(r.v)));
  check('집속 표기(a→b배)를 살린다', rows.some(r => /→/.test(r.v)));

  // ② 격파 계산에 새어 들어가지 않는가.
  //    무장 표의 논차지 합계(기본+증가)와 피탄 시뮬의 피해가 같아야 한다.
  //    국부 배율이 곱해졌다면 그만큼 어긋난다.
  const table = await pg.evaluate(() => {
    const out = {};
    for (const r of document.querySelectorAll('#weaponList > *')) {
      const nm = ((r.querySelector('.w-nm') || {}).textContent || '').replace(/\s+/g, ' ').trim();
      const d = r.querySelector('.w-dmg');
      if (!nm || !d) continue;
      const t = d.textContent.replace(/,/g, '');
      const b = t.match(/^(\d+)/);
      if (!b) continue;
      let v = Number(b[1]);
      for (const x of (t.match(/\((\+|-)\d+\)/g) || [])) v += Number(x.replace(/[()+]/g, ''));
      out[nm] = v;
    }
    return out;
  });

  await pg.evaluate(() => document.querySelector('#pietanBtn').click());
  await sleep(600);
  await pg.evaluate(() => { const q = document.querySelector('#pietanQuery'); q.value = '자쿠'; q.dispatchEvent(new Event('input')); });
  await sleep(700);
  await pg.evaluate(() => { const r = document.querySelector('#pietanModal .pietan-row'); if (r) r.click(); });
  await sleep(900);
  const dmgs = await pg.evaluate(() => {
    const out = {};
    for (const r of document.querySelectorAll('#pietanModal .pietan-out-row')) {
      const nm = ((r.querySelector('.pietan-out-nm') || {}).textContent || '').replace(/\s+/g, ' ').trim();
      const m = ((r.querySelector('.pietan-out-dmg') || {}).textContent || '').replace(/,/g, '').match(/(\d+)/);
      if (nm && m) out[nm] = Number(m[1]);
    }
    return out;
  });

  let checked = 0; const leaked = [];
  for (const row of rows) {
    if (!/^[\d.]+배$/.test(row.v)) continue;             // 집속 갈림·무표기는 건너뛴다
    const mult = Number(row.v.replace('배', ''));
    if (mult === 1) continue;
    const key = Object.keys(table).find(k => row.nm.startsWith(k) || k.startsWith(row.nm));
    const hitK = Object.keys(dmgs).find(k => row.nm.startsWith(k) || k.startsWith(row.nm));
    if (!key || !hitK) continue;
    checked++;
    const want = Math.floor(table[key] * mult);
    if (Math.abs(dmgs[hitK] - want) <= 1 && Math.abs(dmgs[hitK] - table[key]) > 1) {
      leaked.push(row.nm + ' 표 ' + table[key] + ' × ' + mult + ' → 피탄 ' + dmgs[hitK]);
    }
  }
  console.log('  격파 계산 대조 ' + checked + '종');
  for (const l of leaked) console.log('     새어 들어감: ' + l);
  check('국부 배율이 격파 계산에 섞이지 않는다', checked > 0 && leaked.length === 0,
    checked === 0 ? '대조할 무장이 없음' : leaked.join(' / '));

  await br.close();
  console.log(fails ? '\n' + fails + '건 실패' : '\n국부 보정 실측 통과');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
