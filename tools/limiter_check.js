// 「사격출력 리미터 해제」 는 본 무장의 2단 집속을 여는 것뿐이라 OH 는 본 무장을 따라가야 한다.
//   node tools/limiter_check.js
//
// 예전엔 이 무장이 비-빔으로 분류돼(damage.js 의 이름 예외) 빔 OH 단축 파츠가 안 걸렸다.
// 본 무장만 「10.4초 (-20%)」 로 줄고 리미터 해제는 「13초」 그대로였다.
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
  await pg.evaluate(() => { const q = document.querySelector('#msQuery'); q.value = '슈퍼 건담'; q.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(700);
  await pg.evaluate(() => document.querySelector('.ms-card').click());
  await sleep(1000);

  // 빔 OH 를 줄이는 파츠(보조 제네레이터)를 낀다
  const part = await pg.evaluate(() => {
    // 타일 글자는 「LV5보조 제너레이터」 처럼 LV 가 앞에 온다 — 두 조각을 따로 본다.
    const t = [...document.querySelectorAll('#partList .part-tile')]
      .find(x => /보조 제너레이터/.test(x.textContent) && /LV5/.test(x.textContent));
    if (!t) return null;
    t.click();
    return t.textContent.replace(/\s+/g, ' ').trim();
  });
  if (!part) { console.log('FAIL  보조 제너레이터 LV5 를 찾지 못했습니다'); await br.close(); process.exit(1); }
  await sleep(900);
  console.log('장착: ' + part);

  const rows = await pg.evaluate(() => [...document.querySelectorAll('#weaponList > *')].map(r => ({
    nm: ((r.querySelector('.w-nm-top') || r.querySelector('.w-nm') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    oh: ((r.querySelector('.w-reload') || {}).textContent || '').replace(/\s+/g, ' ').trim()
  })));
  for (const r of rows) if (r.oh && r.oh !== '—') console.log('   ' + r.nm.padEnd(28) + r.oh);

  const base = rows.find(r => /롱 라이플$|롱 라이플 /.test(r.nm) && !/속사/.test(r.nm));
  const lim = rows.find(r => /리미터 해제/.test(r.nm));
  check('본 무장을 찾았다', !!base);
  check('리미터 해제 무장을 찾았다', !!lim);
  if (base && lim) {
    const cut = s => (s.match(/\((-\d+)%\)/) || [])[1] || null;
    console.log('\n  본 무장 감소율 ' + (cut(base.oh) || '없음') + ' · 리미터 해제 감소율 ' + (cut(lim.oh) || '없음'));
    check('리미터 해제도 OH 단축을 받는다', !!cut(lim.oh), '본 무장만 줄고 리미터 해제는 그대로');
    check('두 무장의 감소율이 같다', cut(base.oh) === cut(lim.oh), base.oh + ' vs ' + lim.oh);
  }

  await br.close();
  console.log(fails ? '\n' + fails + '건 실패' : '\n리미터 해제 OH 실측 통과');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
