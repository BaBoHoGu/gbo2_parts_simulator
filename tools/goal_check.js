// 피탄 시뮬 → 자동 구성 목표 전달 실측.
//   node tools/goal_check.js
//
// 「이 무장 N발 버티기」 를 누르면 자동 구성의 실효 HP 하한이 걸려야 한다.
// 목표가 안 걸리면 관통·폭풍 경감 장갑 같은 조건부 파츠는 계속 안 뽑힌다.
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
  await pg.setViewport({ width: 1500, height: 1000 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await sleep(1500);
  await pg.evaluate(() => { const q = document.querySelector('#msQuery'); q.value = '짐 스나이퍼'; q.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(700);
  await pg.evaluate(() => document.querySelector('.ms-card').click());
  await sleep(1000);

  // 피탄 시뮬에서 적 기체·무장 선택
  await pg.evaluate(() => document.querySelector('#pietanBtn').click());
  await sleep(600);
  await pg.evaluate(() => { const q = document.querySelector('#pietanQuery'); q.value = '자쿠'; q.dispatchEvent(new Event('input')); });
  await sleep(700);
  await pg.evaluate(() => { const r = document.querySelector('#pietanModal .pietan-row'); if (r) r.click(); });
  await sleep(900);
  await pg.evaluate(() => { const r = [...document.querySelectorAll('#pietanModal .pietan-row')].pop(); if (r) r.click(); });
  await sleep(900);

  const before = await pg.evaluate(() => {
    const g = document.querySelector('.pietan-goal');
    if (!g) return null;
    const hit = [...document.querySelectorAll('#pietanModal .pietan-metric')]
      .find(m => /격파까지/.test(m.textContent));
    return {
      goal: g.textContent.replace(/\s+/g, ' ').trim(),
      hits: hit ? hit.textContent.replace(/\s+/g, ' ').trim() : '',
      n: (g.querySelector('input') || {}).value
    };
  });
  check('「버티기 목표」 줄이 나온다', !!before);
  if (!before) { await br.close(); process.exit(1); }
  console.log('   ' + before.hits.slice(0, 60));
  console.log('   ' + before.goal.slice(0, 90));

  // 목표 전달
  await pg.evaluate(() => document.querySelector('.pietan-goal .btn-primary').click());
  await sleep(1000);

  const after = await pg.evaluate(() => {
    const drawerOpen = !!document.querySelector('.drawer.open, #autoDrawer:not([hidden])')
      || getComputedStyle(document.querySelector('#autoGrid').closest('.drawer') || document.body).display !== 'none';
    // 자동 구성 표에서 실효 HP 행의 하한 값을 읽는다
    const rows = [...document.querySelectorAll('#autoGrid > *')].map(e => e.textContent.trim());
    const inputs = [...document.querySelectorAll('#autoGrid input')].map(i => i.value);
    const idx = rows.findIndex(t => /실효 HP/.test(t));
    return { drawerOpen, label: rows[idx] || '', filled: inputs.filter(Boolean) };
  });
  check('자동 구성 표에 실효 HP 축이 있다', /실효 HP/.test(after.label), after.label);
  check('하한 목표가 채워졌다', after.filled.length > 0, '채워진 칸 ' + after.filled.length + '개');
  console.log('   채워진 값: ' + after.filled.join(', '));

  // 목표를 건 채로 실제 구성을 뽑고, 그 구성이 정말 그만큼 버티는지 되본다
  const goal = Number(before.n || 0) || (Number((before.hits.match(/(\d+)발/) || [])[1]) + 1);
  await pg.evaluate(() => document.querySelector('#runAuto').click());
  await sleep(20000);
  const cands = await pg.evaluate(() => document.querySelectorAll('#autoResults .auto-cand').length);
  check('목표를 만족하는 구성이 나온다', cands > 0, '후보 0개');
  if (cands > 0) {
    await pg.evaluate(() => document.querySelector('#autoResults .auto-cand').click());
    await sleep(1200);
    const applied = await pg.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => /적용/.test(x.textContent) && x.offsetParent);
      if (b) { b.click(); return true; } return false;
    });
    await sleep(1500);
    if (!applied) console.log('   (적용 버튼을 못 찾아 선택 상태로만 확인)');
    await pg.evaluate(() => document.querySelector('#pietanBtn').click());
    await sleep(1500);
    const now = await pg.evaluate(() => {
      const m = [...document.querySelectorAll('#pietanModal .pietan-metric')].find(x => /격파까지/.test(x.textContent));
      return m ? m.textContent.replace(/\s+/g, ' ').trim() : '';
    });
    const nowHits = Number((now.match(/(\d+)발/) || [])[1]);
    check(`구성 적용 후 ${goal}발 이상 버틴다`, nowHits >= goal, `실제 ${nowHits}발`);
    console.log('   ' + now.slice(0, 60));
  }

  await br.close();
  console.log(fails ? '\n' + fails + '건 실패' : '\n목표 전달 실측 통과');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
