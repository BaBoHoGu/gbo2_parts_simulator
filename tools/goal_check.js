// 피탄 시뮬 → 자동 구성 목표 전달 실측.
//   node tools/goal_check.js
//
// 「이 무장 N발 버티기」 를 누르면 자동 구성의 실효 HP 하한이 걸려야 한다.
// 목표가 안 걸리면 관통·폭풍 경감 장갑 같은 조건부 파츠는 계속 안 뽑힌다.
const GBO2Browser = require('./lib/browser.js');   // 크롬 임시 프로필 정리가 프로세스를 죽이지 않게
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
const WAIT = require('./lib/waits.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fails = 0;
const check = (label, ok, extra) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + label + (!ok && extra ? '  — ' + extra : ''));
  if (!ok) fails++;
};

(async () => {
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const pg = await br.newPage();
  await pg.setViewport({ width: 1500, height: 1000 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await sleep(1500);
  await pg.evaluate(() => { const q = document.querySelector('#msQuery'); q.value = '짐 스나이퍼'; q.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(700);
  await pg.evaluate(() => document.querySelector('.ms-card').click());
  // 카드를 누르면 기체 정보 칸이 열릴 뿐이다 — 「파츠 고르기」까지 눌러야 기체가 바뀐다.
  await sleep(900);
  await pg.evaluate(() => { const g = document.querySelector('#infoGo'); if (g) g.click(); });
  await sleep(1100);
  await sleep(1000);

  /* 대결 시뮬에서 상대를 세우고 **상대가 쏘게** 한다 — 버티기 목표는 맞는 쪽이
     내 구성(왼쪽)일 때만 뜻이 있다. (피탄 시뮬이 있던 자리) */
  const DG = require('./lib/duelgate.js');
  const shot = await DG.measure(pg, { me: null, foe: 'ザクⅡ', from: 'R' });
  check('대결에서 상대 무장으로 계산된다', !shot.오류, JSON.stringify(shot).slice(0, 160));

  const before = await pg.evaluate(() => {
    const g = document.querySelector('#duelModal .goal-row');
    if (!g) return null;
    const c = document.querySelector('#duelModal .dc-card .dc-kill');
    return {
      goal: g.textContent.replace(/\s+/g, ' ').trim(),
      hits: c ? c.textContent.replace(/\s+/g, ' ').trim() : '',
      n: (g.querySelector('input') || {}).value
    };
  });
  check('「버티기 목표」 줄이 나온다', !!before);
  if (!before) { await br.close(); process.exit(1); }
  console.log('   ' + before.hits.slice(0, 60));
  console.log('   ' + before.goal.slice(0, 90));

  // 목표 전달
  await pg.evaluate(() => document.querySelector('#duelModal .goal-row .btn-primary').click());
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
  /* 자동 구성이 **끝났다는 신호**까지 기다린다 — 전에는 20초를 통째로 쉬었다.
       #runAuto 의 disabled 는 결과를 다 그린 뒤 풀린다(src/ui.js runAuto 의 finally).
       후보가 나타나기만 보면 중간 상태를 읽어 흔들릴 수 있어 둘을 같이 본다.
       못 끝나면 같은 20초에 타임아웃하므로, 뒤따르는 검사는 전과 똑같이 걸린다. */
  await WAIT.waitAutoDone(pg, 20000);
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
    /* 구성을 적용한 뒤 **같은 짝**을 다시 재서 발수가 목표를 넘는지 본다.
       화면 글자가 아니라 attack() 의 발수를 쓴다 — 글자는 바뀌어도 뜻은 안 바뀐다. */
    const re2 = await DG.measure(pg, { me: null, foe: 'ザクⅡ', from: 'R',
      weaponExact: shot.무장 });
    const nowHits = re2.오류 ? 0 : re2.발수;
    const now = re2.오류 ? JSON.stringify(re2) : (re2.무장 + ' — ' + re2.발수 + '발 (한발 ' + re2.한발 + ')');
    check(`구성 적용 후 ${goal}발 이상 버틴다`, nowHits >= goal, `실제 ${nowHits}발`);
    console.log('   ' + now.slice(0, 60));
  }

  await br.close();
  console.log(fails ? '\n' + fails + '건 실패' : '\n목표 전달 실측 통과');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
